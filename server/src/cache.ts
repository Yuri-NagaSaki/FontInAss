/**
 * In-memory LRU cache for processed subtitle results.
 *
 * Replaces Cloudflare KV namespace — zero I/O latency, process-local.
 * Uses a Map with insertion-order to implement simple LRU eviction.
 * Eviction is triggered by both entry count AND total byte size to prevent OOM.
 */

import { config } from "./config.js";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
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

export async function computeCacheKey(
  subtitleBytes: Uint8Array,
  options: Record<string, string | boolean>,
): Promise<string> {
  const optStr = JSON.stringify(options, Object.keys(options).sort());
  const optBytes = new TextEncoder().encode(optStr);
  const combined = new Uint8Array(subtitleBytes.length + optBytes.length);
  combined.set(subtitleBytes, 0);
  combined.set(optBytes, subtitleBytes.length);
  const hashBuffer = await crypto.subtle.digest("SHA-256", combined);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return "subset:" + hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
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
  // Evict synchronously to ensure we never exceed the memory cap
  if (store.size > config.cacheMaxEntries || totalBytes > CACHE_MAX_BYTES) {
    evict();
  }
}

export function getCacheStats(): { size: number; maxSize: number; totalBytes: number; maxBytes: number } {
  return { size: store.size, maxSize: config.cacheMaxEntries, totalBytes, maxBytes: CACHE_MAX_BYTES };
}
