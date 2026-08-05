import type { ArchiveManifest, ArchiveMetadata, ArchivePatch, ArchivePreview, SharedArchive } from "@fontinass/contracts";
import type {
  ArchiveInspector,
  ArchiveLibrary,
  ArchiveRecord,
  ArchiveRepository,
  ArchiveUploadInput,
  PendingArchiveStore,
  PublishedArchiveStore,
} from "./index.js";

export class ArchiveLibraryError extends Error {
  constructor(message: string, readonly code: "not_found" | "invalid" | "rate_limited" | "storage_unavailable") {
    super(message);
  }
}

export interface ArchiveLibraryOptions {
  maxFileSize: number;
  dailyContributionLimit: number;
}

export class DefaultArchiveLibrary implements ArchiveLibrary {
  constructor(
    private readonly repository: ArchiveRepository,
    private readonly published: PublishedArchiveStore,
    private readonly pending: PendingArchiveStore,
    private readonly inspector: ArchiveInspector,
    private readonly options: ArchiveLibraryOptions,
  ) {}

  listPublished(): SharedArchive[] {
    return this.repository.listPublished().map((record) => ({
      ...toPublicArchive(record),
      download_url: record.r2_key ? this.published.publicUrl(record.r2_key) : null,
    }));
  }

  listPending(): SharedArchive[] {
    return this.repository.listPending().map(toPublicArchive);
  }

  async publish(input: ArchiveUploadInput): Promise<SharedArchive> {
    if (!this.published.isConfigured()) throw new ArchiveLibraryError("R2 is not configured", "storage_unavailable");
    const inspection = await this.validate(input);
    const key = archiveKey(input.metadata, input.filename);
    await this.published.put(key, input.bytes, archiveMimeType(inspection.type));
    const existing = this.repository.findByStorageKey(key);
    if (existing) {
      this.repository.delete(existing.id);
      await this.pending.delete(existing.pending_path);
    }
    const record = makeRecord(input, inspection, { status: "published", storageKey: key, pendingPath: null });
    record.download_url = this.published.publicUrl(key);
    this.repository.insert(record);
    await this.writeManifest();
    return toPublicArchive(record);
  }

  async contribute(input: ArchiveUploadInput, ipHash: string): Promise<SharedArchive> {
    const date = new Date().toISOString().slice(0, 10);
    if (!this.repository.consumeRateLimit(ipHash, date, this.options.dailyContributionLimit)) {
      throw new ArchiveLibraryError(`Rate limit exceeded (max ${this.options.dailyContributionLimit} uploads/day)`, "rate_limited");
    }
    const inspection = await this.validate(input);
    const id = randomId();
    const path = await this.pending.put(id, input.filename, input.bytes);
    const record = makeRecord(input, inspection, { id, status: "pending", storageKey: null, pendingPath: path });
    this.repository.insert(record);
    return toPublicArchive(record);
  }

  async approve(id: string): Promise<SharedArchive> {
    if (!this.published.isConfigured()) throw new ArchiveLibraryError("R2 is not configured", "storage_unavailable");
    const record = this.repository.findById(id);
    if (!record || record.status !== "pending") throw new ArchiveLibraryError("Archive not found or not pending", "not_found");
    if (!record.pending_path) throw new ArchiveLibraryError("Pending archive file is unavailable", "not_found");
    const bytes = await this.pending.get(record.pending_path);
    if (!bytes) throw new ArchiveLibraryError("Pending archive file is unavailable", "not_found");
    const key = archiveKey(record, record.filename);
    const inspection = await this.inspector.inspect(record.filename, bytes);
    await this.published.put(key, bytes, archiveMimeType(inspection.type));
    const collision = this.repository.findByStorageKey(key);
    if (collision && collision.id !== id) this.repository.delete(collision.id);
    const updated = this.repository.update(id, {
      status: "published",
      r2_key: key,
      download_url: this.published.publicUrl(key),
      pending_path: null,
      updated_at: new Date().toISOString(),
    });
    await this.pending.delete(record.pending_path);
    if (!updated) throw new ArchiveLibraryError("Archive disappeared during approval", "not_found");
    await this.writeManifest();
    return toPublicArchive(updated);
  }

  async reject(id: string): Promise<SharedArchive> {
    const record = this.repository.findById(id);
    if (!record || record.status !== "pending") throw new ArchiveLibraryError("Archive not found or not pending", "not_found");
    const updated = this.repository.update(id, { status: "rejected", pending_path: null, updated_at: new Date().toISOString() });
    await this.pending.delete(record.pending_path);
    if (!updated) throw new ArchiveLibraryError("Archive disappeared during rejection", "not_found");
    return toPublicArchive(updated);
  }

  async remove(id: string): Promise<void> {
    const record = this.repository.delete(id);
    if (!record) throw new ArchiveLibraryError("Archive not found", "not_found");
    if (record.r2_key && this.published.isConfigured()) await this.published.delete(record.r2_key);
    await this.pending.delete(record.pending_path);
    if (record.status === "published") await this.writeManifest();
  }

  async edit(id: string, patch: ArchivePatch): Promise<SharedArchive> {
    const record = this.repository.findById(id);
    if (!record) throw new ArchiveLibraryError("Archive not found", "not_found");
    const next: Partial<ArchiveRecord> = { ...patch, updated_at: new Date().toISOString() };
    if (record.status === "published" && record.r2_key && (patch.name_cn || patch.letter || patch.season)) {
      const metadata = { ...record, ...patch };
      const nextKey = archiveKey(metadata, record.filename);
      if (nextKey !== record.r2_key) {
        const { bytes } = await this.published.get(record.r2_key);
        const inspection = await this.inspector.inspect(record.filename, bytes);
        await this.published.put(nextKey, bytes, archiveMimeType(inspection.type));
        await this.published.delete(record.r2_key);
        next.r2_key = nextKey;
        next.download_url = this.published.publicUrl(nextKey);
      }
    }
    const updated = this.repository.update(id, next);
    if (!updated) throw new ArchiveLibraryError("Archive not found", "not_found");
    if (updated.status === "published") await this.writeManifest();
    return toPublicArchive(updated);
  }

  async preview(id: string): Promise<ArchivePreview> {
    const record = this.repository.findById(id);
    if (!record) throw new ArchiveLibraryError("Archive not found", "not_found");
    const bytes = await this.readBytes(record);
    const inspection = await this.inspector.inspect(record.filename, bytes);
    const files = inspection.filenames.map((name) => {
      const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
      return { name, ext, isSubtitle: [".ass", ".ssa", ".srt"].includes(ext) };
    });
    return { filename: record.filename, totalFiles: files.length, subtitleFiles: files.filter((file) => file.isSubtitle).length, files };
  }

  async download(id: string): Promise<{ filename: string; bytes: Uint8Array }> {
    const record = this.repository.findById(id);
    if (!record) throw new ArchiveLibraryError("Archive not found", "not_found");
    return { filename: record.filename, bytes: await this.readBytes(record) };
  }

  async restoreFromManifest(): Promise<number> {
    const manifest = await this.published.readManifest();
    if (!manifest) return 0;
    const records = manifest.archives.map((archive) => ({
      ...archive,
      download_url: archive.r2_key ? this.published.publicUrl(archive.r2_key) : null,
      pending_path: null,
    }));
    this.repository.replacePublished(records);
    return records.length;
  }

  async writeManifest(): Promise<void> {
    if (!this.published.isConfigured()) return;
    const archives = this.repository.listPublished().map(({ pending_path: _pendingPath, ...record }) => ({
      ...record,
      status: "published" as const,
      download_url: undefined,
    }));
    const manifest = {
      version: 1 as const,
      generated_at: new Date().toISOString(),
      archives: archives.map(({ download_url: _downloadUrl, ...archive }) => archive),
    } satisfies ArchiveManifest;
    await this.published.writeManifest(manifest);
  }

  private async validate(input: ArchiveUploadInput) {
    if (input.bytes.byteLength > this.options.maxFileSize) {
      throw new ArchiveLibraryError(`File too large (max ${Math.round(this.options.maxFileSize / 1024 / 1024)}MB)`, "invalid");
    }
    const result = await this.inspector.inspect(input.filename, input.bytes);
    if (!result.valid) throw new ArchiveLibraryError(`Invalid archive: ${result.error ?? "unknown error"}`, "invalid");
    return result;
  }

  private async readBytes(record: ArchiveRecord): Promise<Uint8Array> {
    if (record.pending_path) {
      const bytes = await this.pending.get(record.pending_path);
      if (bytes) return bytes;
    }
    if (record.r2_key) return (await this.published.get(record.r2_key)).bytes;
    throw new ArchiveLibraryError("Archive file is unavailable", "not_found");
  }
}

function makeRecord(
  input: ArchiveUploadInput,
  inspection: Awaited<ReturnType<ArchiveInspector["inspect"]>>,
  state: { id?: string; status: "pending" | "published"; storageKey: string | null; pendingPath: string | null },
): ArchiveRecord {
  const now = new Date().toISOString();
  return {
    id: state.id ?? randomId(),
    name_cn: input.metadata.name_cn,
    letter: input.metadata.letter,
    season: input.metadata.season,
    sub_group: input.metadata.sub_group,
    languages: input.metadata.languages,
    subtitle_formats: inspection.subtitleFormats,
    episode_count: inspection.subtitleCount,
    has_fonts: input.metadata.has_fonts,
    filename: input.filename,
    r2_key: state.storageKey,
    file_size: input.bytes.byteLength,
    file_count: inspection.filenames.length,
    download_url: state.storageKey ? null : null,
    pending_path: state.pendingPath,
    status: state.status,
    contributor: input.metadata.contributor ?? null,
    sub_entries: [],
    created_at: now,
    updated_at: now,
  };
}

function toPublicArchive(record: ArchiveRecord): SharedArchive {
  const { pending_path: _pendingPath, ...archive } = record;
  return archive;
}

function safeSegment(value: string): string {
  return value.trim().replace(/[/\\]/g, "_").replace(/\.\.+/g, "_");
}

function archiveKey(metadata: Pick<ArchiveMetadata, "letter" | "name_cn" | "season">, filename: string): string {
  return `${safeSegment(metadata.letter)}/${safeSegment(metadata.name_cn)}/${safeSegment(metadata.season)}/${safeSegment(filename)}`;
}

function archiveMimeType(type: "zip" | "7z" | null): string {
  return type === "7z" ? "application/x-7z-compressed" : "application/zip";
}

function randomId(size = 21): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return Array.from(bytes, (byte) => alphabet[byte & 63]).join("");
}
