import { existsSync, lstatSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { AwsClient } from "aws4fetch";
import { ARCHIVE_MANIFEST_KEY, ArchiveManifestSchema, type ArchiveManifest } from "@fontinass/contracts";
import type { FontFileObject, FontFileStore } from "@fontinass/font-catalog";
import type { PendingArchiveStore, PublishedArchiveStore } from "@fontinass/archive-library";

const FONT_EXTENSIONS = new Set(["ttf", "otf", "ttc", "otc"]);

export class FsFontFileStore implements FontFileStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  ensureReady(): void {
    mkdirSync(this.root, { recursive: true });
  }

  private path(key: string): string {
    const normalized = key.replace(/\\/g, "/").replace(/^\/+/, "");
    const path = resolve(this.root, normalized);
    const rel = relative(this.root, path);
    if (rel === ".." || rel.startsWith(`..${sep}`) || resolve(path) === resolve(this.root, "..")) {
      throw new Error(`Path traversal blocked: ${key}`);
    }
    for (let current = path; current !== this.root; current = dirname(current)) {
      try { if (lstatSync(current).isSymbolicLink()) throw new Error("Font symlinks are not supported"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    return path;
  }

  localPath(key: string): string | null {
    try { const path = this.path(key); return statSync(path).isFile() ? path : null; } catch { return null; }
  }

  async get(key: string): Promise<Uint8Array | null> {
    try { return new Uint8Array(await readFile(this.path(key))); } catch { return null; }
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const path = this.path(key);
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    try { await writeFile(temporary, bytes, { flag: "wx" }); await rename(temporary, path); }
    finally { await rm(temporary, { force: true }); }
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  exists(key: string): boolean {
    try { return existsSync(this.path(key)); } catch { return false; }
  }

  browse(prefix: string): { folders: string[]; files: FontFileObject[] } {
    const cleanPrefix = prefix.replace(/^\/+/, "").replace(/\/$/, "");
    const directory = this.path(cleanPrefix);
    if (!existsSync(directory)) return { folders: [], files: [] };
    const basePrefix = cleanPrefix ? `${cleanPrefix}/` : "";
    const folders: string[] = [];
    const files: FontFileObject[] = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) folders.push(`${basePrefix}${entry.name}/`);
      else if (entry.isFile() && FONT_EXTENSIONS.has(entry.name.split(".").pop()?.toLowerCase() ?? "")) {
        const key = `${basePrefix}${entry.name}`;
        files.push({ key, name: entry.name, size: statSync(this.path(key)).size });
      }
    }
    return { folders: folders.sort(), files: files.sort((a, b) => a.name.localeCompare(b.name)) };
  }

  list(prefix = ""): FontFileObject[] {
    const cleanPrefix = prefix.replace(/^\/+/, "").replace(/\/$/, "");
    const start = this.path(cleanPrefix);
    if (!existsSync(start)) return [];
    const results: FontFileObject[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === ".git" || entry.name === "node_modules") continue;
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.isFile() && FONT_EXTENSIONS.has(entry.name.split(".").pop()?.toLowerCase() ?? "")) {
          const key = relative(this.root, path).split(sep).join("/");
          results.push({ key, name: entry.name, size: statSync(path).size });
        }
      }
    };
    walk(start);
    return results.sort((a, b) => a.key.localeCompare(b.key));
  }

  /** Count font files under a prefix without loading metadata. */
  count(prefix = ""): number {
    const cleanPrefix = prefix.replace(/^\/+/, "").replace(/\/$/, "");
    const start = this.path(cleanPrefix);
    if (!existsSync(start)) return 0;
    let total = 0;
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === ".git" || entry.name === "node_modules") continue;
        if (entry.isDirectory()) walk(resolve(directory, entry.name));
        else if (entry.isFile() && FONT_EXTENSIONS.has(entry.name.split(".").pop()?.toLowerCase() ?? "")) total++;
      }
    };
    walk(start);
    return total;
  }
}

export class FsPendingArchiveStore implements PendingArchiveStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
    mkdirSync(this.root, { recursive: true });
  }

  private safePath(path: string): string {
    const absolute = resolve(path);
    const rel = relative(this.root, absolute);
    if (!rel || dirname(absolute) === this.root || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("Pending path outside configured archive directory");
    return absolute;
  }

  async put(id: string, filename: string, bytes: Uint8Array): Promise<string> {
    const directory = resolve(this.root, id);
    mkdirSync(directory, { recursive: true });
    const path = this.safePath(resolve(directory, basename(filename)));
    await writeFile(path, bytes);
    return path;
  }

  async get(path: string): Promise<Uint8Array | null> {
    try { return new Uint8Array(await readFile(this.safePath(path))); } catch { return null; }
  }

  async delete(path: string | null): Promise<void> {
    if (!path) return;
    const safe = this.safePath(path);
    await rm(safe, { force: true });
    await rm(dirname(safe), { recursive: true, force: true });
  }
}

export interface R2ArchiveStoreConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicUrl: string;
}

export class R2PublishedArchiveStore implements PublishedArchiveStore {
  private client: AwsClient | null = null;

  constructor(private readonly config: R2ArchiveStoreConfig) {}

  isConfigured(): boolean {
    return Boolean(this.config.accountId && this.config.accessKeyId && this.config.secretAccessKey && this.config.bucketName);
  }

  private getClient(): AwsClient {
    if (!this.isConfigured()) throw new Error("R2 credentials are not configured");
    return this.client ??= new AwsClient({ accessKeyId: this.config.accessKeyId, secretAccessKey: this.config.secretAccessKey, region: "auto", service: "s3" });
  }

  private endpoint(key: string): string {
    const encoded = encodeObjectKey(key);
    return `https://${this.config.accountId}.r2.cloudflarestorage.com/${this.config.bucketName}/${encoded}`;
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const response = await this.getClient().fetch(this.endpoint(key), {
      method: "PUT",
      headers: { "Content-Type": contentType, "Content-Length": String(bytes.byteLength) },
      body: bytes as unknown as BodyInit,
    });
    if (!response.ok) throw new Error(`R2 upload failed (${response.status}): ${await response.text()}`);
  }

  async get(key: string): Promise<{ bytes: Uint8Array; contentLength: number }> {
    const response = await this.getClient().fetch(this.endpoint(key));
    if (!response.ok) throw new Error(`R2 object not found: ${key} (${response.status})`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { bytes, contentLength: Number(response.headers.get("content-length") ?? bytes.byteLength) };
  }

  async delete(key: string): Promise<void> {
    const response = await this.getClient().fetch(this.endpoint(key), { method: "DELETE" });
    if (!response.ok && response.status !== 404) throw new Error(`R2 delete failed (${response.status}): ${await response.text()}`);
  }

  async exists(key: string): Promise<boolean> {
    try { return (await this.getClient().fetch(this.endpoint(key), { method: "HEAD" })).ok; } catch { return false; }
  }

  publicUrl(key: string): string | null {
    const base = this.config.publicUrl.replace(/\/+$/, "");
    return base ? `${base}/${encodeObjectKey(key)}` : null;
  }

  async readManifest(): Promise<ArchiveManifest | null> {
    if (!(await this.exists(ARCHIVE_MANIFEST_KEY))) return null;
    const { bytes } = await this.get(ARCHIVE_MANIFEST_KEY);
    return ArchiveManifestSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  }

  async writeManifest(manifest: ArchiveManifest): Promise<void> {
    const data = new TextEncoder().encode(JSON.stringify(ArchiveManifestSchema.parse(manifest), null, 2));
    await this.put(ARCHIVE_MANIFEST_KEY, data, "application/json; charset=utf-8");
  }
}

function encodeObjectKey(key: string): string {
  return key.split("/").map((segment) =>
    encodeURIComponent(segment).replace(/[!'()*]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    ),
  ).join("/");
}
