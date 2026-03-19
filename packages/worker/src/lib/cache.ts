/**
 * KV cache for processed subtitle results.
 * Key: SHA-256 of (subtitle bytes + options flags)
 * Value: processed subtitle bytes (base64 encoded for KV storage)
 */

import type { Env } from "../types.js";

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const CACHE_PREFIX = "subset:";

/**
 * Compute cache key from subtitle content + processing options.
 */
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
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  return CACHE_PREFIX + hashHex;
}

/**
 * Get cached processed subtitle bytes, or null if not cached.
 */
export async function getFromCache(env: Env, key: string): Promise<Uint8Array | null> {
  const cached = await env.CACHE.get(key, "arrayBuffer");
  if (!cached) return null;
  return new Uint8Array(cached);
}

/**
 * Store processed subtitle bytes in KV cache.
 */
export async function setInCache(env: Env, key: string, data: Uint8Array): Promise<void> {
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  await env.CACHE.put(key, buf, { expirationTtl: CACHE_TTL_SECONDS });
}
