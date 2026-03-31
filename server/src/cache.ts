/**
 * In-memory LRU cache for processed subtitle results.
 *
 * Replaces Cloudflare KV namespace — zero I/O latency, process-local.
 * Uses a Map with insertion-order to implement simple LRU eviction.
 * Eviction is triggered by both entry count AND total byte size to prevent OOM.
 */

import { config } from "./config.js";
import { createHash } from "node:crypto";

const CACHE_TTL_MS = 2 * 24 * 60 * 60 * 1000; // 48 hours
const CACHE_MAX_BYTES = 256 * 1024 * 1024;      // 256 MB total cap regardless of entry count

interface CacheEntry {
  data: Uint8Array;
  expires: number;
}

// Ordered Map for LRU: oldest entries are at the beginning (insertion order).
const store = new Map<string, CacheEntry>();
let totalBytes = 0;

function evict(): void {
  const now = Date.now();
  // Remove expired entries first
  for (const [key, entry] of store) {
    if (entry.expires < now) {
      totalBytes -= entry.data.length;
      store.delete(key);
    }
  }
  // Evict oldest entries until within both limits
  while (store.size > config.cacheMaxEntries || totalBytes > CACHE_MAX_BYTES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    const entry = store.get(oldest)!;
    totalBytes -= entry.data.length;
    store.delete(oldest);
  }
}

export function computeCacheKey(
  subtitleBytes: Uint8Array,
  options: Record<string, string | boolean>,
): string {
  const optStr = JSON.stringify(options, Object.keys(options).sort());
  return "subset:" + createHash("sha256").update(subtitleBytes).update(optStr).digest("hex");
}

export function getFromCache(key: string): Uint8Array | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    totalBytes -= entry.data.length;
    store.delete(key);
    return null;
  }
  // Move to end for LRU (re-insert)
  store.delete(key);
  store.set(key, entry);
  return entry.data;
}

export function setInCache(key: string, data: Uint8Array): void {
  // Remove existing entry to reset position and byte count
  if (store.has(key)) {
    totalBytes -= store.get(key)!.data.length;
    store.delete(key);
  }
  store.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
  totalBytes += data.length;
  // Evict synchronously to prevent memory spikes from concurrent requests
  if (store.size > config.cacheMaxEntries || totalBytes > CACHE_MAX_BYTES) {
    evict();
  }
}

export function getCacheStats(): { size: number; maxSize: number; totalBytes: number; maxBytes: number } {
  return { size: store.size, maxSize: config.cacheMaxEntries, totalBytes, maxBytes: CACHE_MAX_BYTES };
}
