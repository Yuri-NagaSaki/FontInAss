/**
 * In-memory LRU cache for processed subtitle results.
 *
 * Replaces Cloudflare KV namespace — zero I/O latency, process-local.
 * Uses a Map with insertion-order to implement simple LRU eviction.
 */

import { config } from "./config.js";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CacheEntry {
  data: Uint8Array;
  expires: number;
}

// Ordered Map for LRU: oldest entries are at the beginning (insertion order).
const store = new Map<string, CacheEntry>();

function evict(): void {
  const now = Date.now();
  // First pass: remove expired entries
  for (const [key, entry] of store) {
    if (entry.expires < now) store.delete(key);
  }
  // If still over limit, remove oldest (first) entries
  while (store.size > config.cacheMaxEntries) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
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
    store.delete(key);
    return null;
  }
  // Move to end for LRU (re-insert)
  store.delete(key);
  store.set(key, entry);
  return entry.data;
}

export function setInCache(key: string, data: Uint8Array): void {
  // Remove existing to reset position
  store.delete(key);
  store.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
  // Evict in the background (don't block)
  if (store.size > config.cacheMaxEntries) {
    Promise.resolve().then(evict);
  }
}

export function getCacheStats(): { size: number; maxSize: number } {
  return { size: store.size, maxSize: config.cacheMaxEntries };
}
