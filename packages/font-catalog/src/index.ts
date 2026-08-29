import { createHash } from "node:crypto";
import type {
  BrowseResponse,
  DedupResponse,
  DuplicateGroup,
  FontListResponse,
  FontStats,
  IndexFontsResponse,
  ScanFontsResponse,
  UploadResult,
} from "@fontinass/contracts";

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export interface FontFaceMetadata {
  index: number;
  familyNames: string[];
  weight: number;
  bold: boolean;
  italic: boolean;
}

export interface FontInspector {
  inspect(bytes: Uint8Array): FontFaceMetadata[];
  validate(filename: string, bytes: Uint8Array): { valid: boolean; error?: string };
}

export interface FontLookupRow {
  nameLower: string;
  fontIndex: number;
  weight: number;
  bold: boolean;
  italic: boolean;
  key: string;
  /** File size in bytes; used as tie-breaker to prefer full fonts over stubs/subsets. */
  size: number;
}

export interface FontFileRecord {
  id: string;
  filename: string;
  key: string;
  size: number;
  sha256: string | null;
  createdAt: string;
}

export interface FontCatalogRepository {
  lookupByNames(names: string[]): FontLookupRow[];
  lookupByLooseNames(normalizedNames: string[]): FontLookupRow[];
  findExistingKeys(keys: string[]): Set<string>;
  insertFile(file: Omit<FontFileRecord, "createdAt">, faces: FontFaceMetadata[]): void;
  replaceFaces(fileId: string, faces: FontFaceMetadata[]): void;
  listBrokenFiles(): FontFileRecord[];
  listFileEntries(): FontFileRecord[];
  countFiles(): number;
  listFiles(query: { page: number; limit: number; search: string }): FontListResponse;
  countByTopFolder(): Array<{ prefix: string; count: number }>;
  findById(id: string): FontFileRecord | null;
  findByKey(key: string): FontFileRecord | null;
  findBySha256(sha256: string): (FontFileRecord & { faces: number }) | null;
  setSha256(id: string, sha256: string): void;
  deleteByIds(ids: string[]): FontFileRecord[];
}

export interface FontFileObject {
  key: string;
  size: number;
  name: string;
}

export interface FontFileStore {
  ensureReady(): void;
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): boolean;
  browse(prefix: string): { folders: string[]; files: FontFileObject[] };
  list(prefix?: string): FontFileObject[];
  /** Count font files under a prefix (optional for lightweight stores). */
  count?(prefix?: string): number;
}

export interface FontMatchRequest {
  key: string;
  nameLower: string;
  targetWeight: number;
  targetItalic: boolean;
}

export interface FontMatch {
  key: string;
  fontIndex: number;
  weight: number;
  italic: boolean;
}

export interface FontContributionResult {
  filename: string;
  status: "success" | "duplicate" | "rejected";
  fontId: string | null;
  faces: number;
  sha256: string | null;
  error: string | null;
}

const WEIGHT_SUFFIXES: Array<[string, number]> = [
  ["extra light", 200], ["extra-light", 200], ["ultra light", 200], ["ultra-light", 200],
  ["semi bold", 600], ["semi-bold", 600], ["demi bold", 600], ["demi-bold", 600],
  ["extra bold", 800], ["extra-bold", 800], ["ultra bold", 800], ["ultra-bold", 800],
  ["extralight", 200], ["ultralight", 200], ["semibold", 600], ["demibold", 600],
  ["extrabold", 800], ["ultrabold", 800], ["hairline", 100], ["thin", 100],
  ["light", 300], ["regular", 400], ["normal", 400], ["book", 400], ["medium", 500],
  ["bold", 700], ["black", 900], ["heavy", 900],
];

function stripWeightSuffix(nameLower: string): { base: string; weight: number } | null {
  for (const [suffix, weight] of WEIGHT_SUFFIXES) {
    if (!nameLower.endsWith(` ${suffix}`)) continue;
    const base = nameLower.slice(0, -suffix.length - 1).trimEnd();
    if (base) return { base, weight };
  }
  return null;
}

export function normalizeLooseFontName(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/[\s_-]+/g, "");
}

/** Prefer style/weight fit; when tied, prefer the larger file (full fonts over stubs/subsets). */
export function pickBest(variants: FontLookupRow[], targetWeight: number, targetItalic: boolean): FontMatch {
  const targetBold = targetWeight >= 600;
  const styleScore = (variant: FontLookupRow) =>
    Number(variant.bold !== targetBold) * 200 +
    Number(variant.italic !== targetItalic) * 100 +
    Math.abs(variant.weight - targetWeight);

  const best = [...variants].sort((a, b) => {
    const byStyle = styleScore(a) - styleScore(b);
    if (byStyle !== 0) return byStyle;
    const bySize = (b.size ?? 0) - (a.size ?? 0);
    if (bySize !== 0) return bySize;
    return a.key.localeCompare(b.key);
  })[0];

  return { key: best.key, fontIndex: best.fontIndex, weight: best.weight, italic: best.italic };
}

function groupByName(rows: FontLookupRow[]): Map<string, FontLookupRow[]> {
  const grouped = new Map<string, FontLookupRow[]>();
  for (const row of rows) grouped.set(row.nameLower, [...(grouped.get(row.nameLower) ?? []), row]);
  return grouped;
}

export class FontCatalog {
  private readonly contributions = new Map<string, Promise<FontContributionResult>>();

  constructor(
    private readonly repository: FontCatalogRepository,
    private readonly files: FontFileStore,
    private readonly inspector: FontInspector,
    private readonly logger: Logger,
    private readonly concurrency = 5,
  ) {}

  match(requests: FontMatchRequest[]): Map<string, FontMatch | null> {
    const result = new Map<string, FontMatch | null>();
    if (requests.length === 0) return result;

    const exact = groupByName(this.repository.lookupByNames([...new Set(requests.map((request) => request.nameLower))]));
    for (const request of requests) {
      const variants = exact.get(request.nameLower);
      result.set(request.key, variants?.length ? pickBest(variants, request.targetWeight, request.targetItalic) : null);
    }

    const unmatched = requests.filter((request) => result.get(request.key) === null);
    const fallbacks = new Map<string, { base: string; weight: number }>();
    for (const request of unmatched) {
      const fallback = stripWeightSuffix(request.nameLower);
      if (fallback) fallbacks.set(request.nameLower, fallback);
    }
    if (fallbacks.size) {
      const rows = groupByName(this.repository.lookupByNames([...new Set([...fallbacks.values()].map((value) => value.base))]));
      for (const request of unmatched) {
        const fallback = fallbacks.get(request.nameLower);
        const variants = fallback ? rows.get(fallback.base) : undefined;
        if (fallback && variants?.length) result.set(request.key, pickBest(variants, fallback.weight, request.targetItalic));
      }
    }

    const looseRequests = requests.filter((request) => result.get(request.key) === null);
    if (looseRequests.length) {
      const normalized = looseRequests.map((request) => normalizeLooseFontName(request.nameLower));
      const loose = groupByName(this.repository.lookupByLooseNames(normalized));
      for (const request of looseRequests) {
        const variants = loose.get(normalizeLooseFontName(request.nameLower));
        if (variants?.length) result.set(request.key, pickBest(variants, request.targetWeight, request.targetItalic));
      }
    }
    return result;
  }

  async load(key: string): Promise<{ bytes: Uint8Array; resolvedKey: string } | null> {
    const bytes = await this.files.get(key);
    return bytes ? { bytes, resolvedKey: key } : null;
  }

  async index(filename: string, bytes: Uint8Array, existingKey?: string, sha256?: string): Promise<UploadResult> {
    const contentHash = sha256 ?? createHash("sha256").update(bytes).digest("hex");
    let faces = this.inspector.inspect(bytes);
    if (faces.length === 0 || faces.every((face) => face.familyNames.length === 0)) {
      const fallbackName = filename.replace(/\.(ttf|otf|ttc|otc)$/i, "").trim();
      if (!fallbackName) return { filename, id: "", faces: 0, error: "Could not parse font metadata" };
      this.logger.warn(`[font-catalog] metadata fallback for ${filename}`);
      faces = [{ index: 0, familyNames: [fallbackName], weight: 400, bold: false, italic: false }];
    }

    const id = crypto.randomUUID();
    const key = existingKey ?? `fonts/${id}/${filename}`;
    if (!existingKey) await this.files.put(key, bytes);
    this.repository.insertFile({ id, filename, key, size: bytes.length, sha256: contentHash }, faces);
    return { filename, id, faces: faces.length };
  }

  async upload(filename: string, bytes: Uint8Array, targetDirectory?: string): Promise<UploadResult> {
    const validation = this.validate(filename, bytes);
    if (!validation.valid) return { filename, id: "", faces: 0, error: validation.error ?? "Invalid font" };
    const directory = sanitizeDirectory(targetDirectory ?? "");
    if (!directory) return this.index(filename, bytes);
    const key = `${directory}${filename.replace(/[/\\]/g, "_")}`;
    const existing = this.repository.findByKey(key);
    if (existing) this.repository.deleteByIds([existing.id]);
    await this.files.put(key, bytes);
    return this.index(filename, bytes, key);
  }

  async contribute(filename: string, bytes: Uint8Array, targetDirectory: string): Promise<FontContributionResult> {
    const validation = this.validate(filename, bytes);
    if (!validation.valid) {
      return { filename, status: "rejected", fontId: null, faces: 0, sha256: null, error: validation.error ?? "Invalid font" };
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const pending = this.contributions.get(sha256);
    if (pending) return { ...(await pending), filename };

    const contribution = this.contributeUnique(filename, bytes, targetDirectory, sha256);
    this.contributions.set(sha256, contribution);
    try {
      return await contribution;
    } finally {
      this.contributions.delete(sha256);
    }
  }

  private async contributeUnique(filename: string, bytes: Uint8Array, targetDirectory: string, sha256: string): Promise<FontContributionResult> {
    const duplicate = this.repository.findBySha256(sha256);
    if (duplicate) return { filename, status: "duplicate", fontId: duplicate.id, faces: duplicate.faces, sha256, error: null };
    const safeName = filename.replace(/[/\\]/g, "_");
    const directory = sanitizeDirectory(targetDirectory);
    const dot = safeName.lastIndexOf(".");
    const stem = dot > 0 ? safeName.slice(0, dot) : safeName;
    const extension = dot > 0 ? safeName.slice(dot) : "";
    let key = `${directory}${stem}-${sha256.slice(0, 12)}${extension}`;
    if (this.repository.findByKey(key)) key = `${directory}${stem}-${sha256.slice(0, 24)}${extension}`;
    if (this.repository.findByKey(key)) key = `${directory}${stem}-${crypto.randomUUID()}${extension}`;
    await this.files.put(key, bytes);
    try {
      const indexed = await this.index(filename, bytes, key, sha256);
      if (indexed.error) throw new Error(indexed.error);
      return { filename, status: "success", fontId: indexed.id, faces: indexed.faces, sha256, error: null };
    } catch (error) {
      await this.files.delete(key).catch(() => undefined);
      throw error;
    }
  }

  list(query: { page: number; limit: number; search: string }): FontListResponse {
    return this.repository.listFiles(query);
  }

  validate(filename: string, bytes: Uint8Array): { valid: boolean; error?: string } {
    return this.inspector.validate(filename, bytes);
  }

  async download(id: string): Promise<{ filename: string; bytes: Uint8Array } | null> {
    const record = this.repository.findById(id);
    if (!record) return null;
    const bytes = await this.files.get(record.key);
    return bytes ? { filename: record.filename, bytes } : null;
  }

  async delete(ids: string[]): Promise<number> {
    const deleted = this.repository.deleteByIds(ids);
    await Promise.all(deleted.map((entry) => this.files.delete(entry.key)));
    return deleted.length;
  }

  stats(): FontStats {
    const indexedByFolder = new Map(this.repository.countByTopFolder().map((item) => [item.prefix, item.count]));
    for (const folder of this.files.browse("").folders) if (!indexedByFolder.has(folder)) indexedByFolder.set(folder, 0);

    const countOnDisk = (prefix: string): number => {
      if (this.files.count) return this.files.count(prefix);
      return this.files.list(prefix).length;
    };

    const folders = [...indexedByFolder.entries()].map(([prefix, indexed]) => {
      const onDisk = countOnDisk(prefix === "(root)/" ? "" : prefix);
      const status =
        onDisk === 0 && indexed === 0 ? "empty" as const
        : indexed < onDisk ? "pending" as const
        : indexed > onDisk ? "stale" as const
        : "synced" as const;
      return { prefix, count: indexed, indexed, onDisk, status };
    }).sort((a, b) => b.onDisk - a.onDisk || b.indexed - a.indexed || a.prefix.localeCompare(b.prefix));

    const onDisk = folders.reduce((sum, folder) => sum + folder.onDisk, 0);
    const total = this.repository.countFiles();
    const unindexed = folders.reduce((sum, folder) => sum + Math.max(0, folder.onDisk - folder.indexed), 0);
    return { total, onDisk, unindexed, folders };
  }

  browse(prefix: string): BrowseResponse {
    const listing = this.files.browse(prefix);
    const indexed = this.repository.findExistingKeys(listing.files.map((file) => file.key));
    return {
      folders: listing.folders,
      files: listing.files.map((file) => ({ ...file, indexed: indexed.has(file.key) })),
      cursor: null,
      done: true,
    };
  }

  listKeys(prefix = ""): Array<{ key: string; size: number }> {
    return this.files.list(prefix).map(({ key, size }) => ({ key, size }));
  }

  async indexKeys(input: { prefix?: string; keys?: string[]; batchSize: number }): Promise<IndexFontsResponse> {
    const selected = input.keys?.length
      ? input.keys.map((key) => ({ key, size: 0, name: key.split("/").pop() ?? key }))
      : this.files.list(input.prefix ?? "").slice(0, input.batchSize);
    const existing = this.repository.findExistingKeys(selected.map((file) => file.key));
    const pending = selected.filter((file) => !existing.has(file.key));
    const errors: string[] = [];
    let indexed = 0;
    for (let offset = 0; offset < pending.length; offset += this.concurrency) {
      const chunk = pending.slice(offset, offset + this.concurrency);
      const results = await Promise.allSettled(chunk.map(async (file) => {
        const bytes = await this.files.get(file.key);
        if (!bytes) throw new Error("File not found");
        const result = await this.index(file.name, bytes, file.key);
        if (result.error) throw new Error(result.error);
      }));
      results.forEach((result, index) => {
        if (result.status === "fulfilled") indexed++;
        else errors.push(`${chunk[index].key}: ${String(result.reason)}`);
      });
      const completed = Math.min(offset + chunk.length, pending.length);
      if (pending.length > 100 && (completed === pending.length || completed % 500 < chunk.length)) {
        this.logger.info(`[font-catalog] indexed ${completed}/${pending.length}`);
      }
    }
    return { indexed, skipped: existing.size, errors, done: true };
  }

  async scan(): Promise<ScanFontsResponse> {
    const all = this.files.list("");
    const indexedKeys = this.repository.findExistingKeys(all.map((file) => file.key));
    const result = await this.indexKeys({ keys: all.filter((file) => !indexedKeys.has(file.key)).map((file) => file.key), batchSize: all.length || 1 });
    const live = new Set(all.map((file) => file.key));
    const orphans = this.repository.listFileEntries().filter((entry) => !live.has(entry.key));
    if (orphans.length) this.repository.deleteByIds(orphans.map((entry) => entry.id));
    return { total: all.length, indexed: result.indexed, skipped: indexedKeys.size, purged: orphans.length, errors: result.errors.slice(0, 100) };
  }

  async repairUnnamed(): Promise<{ attempted: number; repaired: number; failed: number }> {
    const broken = this.repository.listBrokenFiles();
    let repaired = 0;
    let failed = 0;
    for (const file of broken) {
      const bytes = await this.files.get(file.key);
      const faces = bytes ? this.inspector.inspect(bytes) : [];
      if (!bytes || faces.length === 0 || faces.every((face) => face.familyNames.length === 0)) { failed++; continue; }
      this.repository.replaceFaces(file.id, faces);
      repaired++;
    }
    return { attempted: broken.length, repaired, failed };
  }

  async findDuplicates(): Promise<DuplicateGroup[]> {
    const entries = this.repository.listFileEntries();
    const groups = new Map<string, FontFileRecord[]>();
    for (const entry of entries) {
      let sha256 = entry.sha256;
      if (!sha256) {
        const bytes = await this.files.get(entry.key);
        if (!bytes) continue;
        sha256 = createHash("sha256").update(bytes).digest("hex");
        this.repository.setSha256(entry.id, sha256);
      }
      groups.set(sha256, [...(groups.get(sha256) ?? []), { ...entry, sha256 }]);
    }
    return [...groups.entries()].filter(([, files]) => files.length > 1).map(([sha256, files]) => ({
      sha256,
      files: files.map((file) => ({ id: file.id, filename: file.filename, r2_key: file.key, size: file.size, sha256 })),
      wastedBytes: files.slice(1).reduce((total, file) => total + file.size, 0),
    }));
  }

  async deduplicate(): Promise<DedupResponse> {
    const groups = await this.findDuplicates();
    let removed = 0;
    let freedBytes = 0;
    for (const group of groups) {
      const duplicates = group.files.slice(1);
      removed += await this.delete(duplicates.map((file) => file.id));
      freedBytes += duplicates.reduce((total, file) => total + file.size, 0);
    }
    return { groups: groups.length, removed, freedBytes };
  }
}

export function sanitizeDirectory(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/\.\.+/g, "").replace(/^\/+/, "").replace(/\/{2,}/g, "/");
  return normalized ? normalized.replace(/\/?$/, "/") : "";
}

export function fontMimeType(filename: string): string {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (extension === "ttf") return "font/ttf";
  if (extension === "otf") return "font/otf";
  if (extension === "ttc" || extension === "otc") return "font/collection";
  return "application/octet-stream";
}
