import type { ArchiveManifest, ArchiveMetadata, ArchivePatch, ArchivePreview, SharedArchive } from "@fontinass/contracts";

export interface ArchiveInspection {
  valid: boolean;
  error?: string;
  type: "zip" | "7z" | null;
  filenames: string[];
  subtitleFormats: string[];
  subtitleCount: number;
}

export interface ArchiveInspector {
  inspect(filename: string, bytes: Uint8Array): Promise<ArchiveInspection>;
}

export interface PublishedArchiveStore {
  isConfigured(): boolean;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ bytes: Uint8Array; contentLength: number }>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  publicUrl(key: string): string | null;
  readManifest(): Promise<ArchiveManifest | null>;
  writeManifest(manifest: ArchiveManifest): Promise<void>;
}

export interface PendingArchiveStore {
  put(id: string, filename: string, bytes: Uint8Array): Promise<string>;
  get(path: string): Promise<Uint8Array | null>;
  delete(path: string | null): Promise<void>;
}

export interface ArchiveRecord extends SharedArchive {
  pending_path: string | null;
}

export interface ArchiveRepository {
  listPublished(): ArchiveRecord[];
  listPending(): ArchiveRecord[];
  findById(id: string): ArchiveRecord | null;
  findByStorageKey(key: string): ArchiveRecord | null;
  insert(record: ArchiveRecord): void;
  update(id: string, patch: Partial<ArchiveRecord>): ArchiveRecord | null;
  delete(id: string): ArchiveRecord | null;
  replacePublished(records: ArchiveRecord[]): void;
  consumeRateLimit(ipHash: string, date: string, limit: number): boolean;
  expirePending(before: string): ArchiveRecord[];
}

export interface ArchiveUploadInput {
  filename: string;
  bytes: Uint8Array;
  metadata: ArchiveMetadata;
}

export interface ArchiveLibrary {
  listPublished(): SharedArchive[];
  listPending(): SharedArchive[];
  publish(input: ArchiveUploadInput): Promise<SharedArchive>;
  contribute(input: ArchiveUploadInput, ipHash: string): Promise<SharedArchive>;
  approve(id: string): Promise<SharedArchive>;
  reject(id: string): Promise<SharedArchive>;
  remove(id: string): Promise<void>;
  edit(id: string, patch: ArchivePatch): Promise<SharedArchive>;
  preview(id: string): Promise<ArchivePreview>;
  download(id: string): Promise<{ filename: string; bytes: Uint8Array }>;
  restoreFromManifest(): Promise<number>;
  writeManifest(): Promise<void>;
}

export * from "./inspector.js";
export * from "./library.js";
