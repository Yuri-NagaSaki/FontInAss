/**
 * Scheduler — periodic background tasks.
 *
 * - Auto-index: scans FONT_DIR for new unindexed fonts every N hours
 * - Auto-dedup: detects and removes duplicate font files by SHA-256 hash
 */

import { config, log } from "../config.js";
import { getDb, findExistingKeys, deleteFontsByIds } from "../db.js";
import { scanAllFonts, getFile, deleteFile } from "../storage.js";
import { indexFont } from "./font-manager.js";
import { createHash } from "node:crypto";

let _intervalId: ReturnType<typeof setInterval> | null = null;

/** Start the periodic scheduler. */
export function startScheduler(): void {
  const hours = config.autoIndexIntervalHours;
  if (hours <= 0) {
    log("info", "[scheduler] disabled (AUTO_INDEX_INTERVAL_HOURS=0)");
    return;
  }

  const intervalMs = hours * 60 * 60 * 1000;
  log("info", `[scheduler] starting — auto-index + dedup every ${hours}h`);

  // Run once on startup after a short delay
  setTimeout(() => runScheduledTasks(), 10_000);

  _intervalId = setInterval(() => runScheduledTasks(), intervalMs);
}

/** Stop the scheduler. */
export function stopScheduler(): void {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
}

async function runScheduledTasks(): Promise<void> {
  log("info", "[scheduler] running scheduled tasks…");
  const t0 = Date.now();

  try {
    await autoIndex();
  } catch (e) {
    log("error", "[scheduler] auto-index failed:", e);
  }

  try {
    await autoDedup();
  } catch (e) {
    log("error", "[scheduler] auto-dedup failed:", e);
  }

  log("info", `[scheduler] tasks completed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

// ─── Auto-index ───────────────────────────────────────────────────────────────

async function autoIndex(): Promise<void> {
  const allFonts = scanAllFonts();
  const alreadyIndexed = findExistingKeys(allFonts.map(f => f.key));
  const toIndex = allFonts.filter(f => !alreadyIndexed.has(f.key));

  if (toIndex.length === 0) {
    log("info", "[scheduler:index] no new fonts to index");
    return;
  }

  log("info", `[scheduler:index] found ${toIndex.length} new font(s) to index`);

  let indexed = 0;
  let errors = 0;
  const CONCURRENCY = config.subsetConcurrency;

  for (let i = 0; i < toIndex.length; i += CONCURRENCY) {
    const chunk = toIndex.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async (obj) => {
        const bytes = await getFile(obj.key);
        if (!bytes) throw new Error("File not found");
        const filename = obj.key.split("/").pop() ?? obj.key;
        const result = await indexFont(filename, bytes, obj.key);
        if (result.error) throw new Error(result.error);
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled") indexed++;
      else errors++;
    }
  }

  // Purge orphaned DB entries
  const currentKeys = new Set(allFonts.map(f => f.key));
  const db = getDb();
  const allDbRows = db.prepare<{ id: string; r2_key: string }, []>(
    "SELECT id, r2_key FROM font_files"
  ).all();
  const orphanIds = allDbRows
    .filter(row => !currentKeys.has(row.r2_key))
    .map(row => row.id);
  if (orphanIds.length > 0) {
    deleteFontsByIds(orphanIds);
  }

  log("info", `[scheduler:index] done — indexed=${indexed}, errors=${errors}, purged=${orphanIds.length}`);
}

// ─── Auto-dedup ───────────────────────────────────────────────────────────────

async function autoDedup(): Promise<void> {
  const db = getDb();
  const allRows = db.prepare<{ id: string; r2_key: string; size: number }, []>(
    "SELECT id, r2_key, size FROM font_files"
  ).all();

  // Group by size first (cheap pre-filter), then hash
  const bySize = new Map<number, typeof allRows>();
  for (const row of allRows) {
    const group = bySize.get(row.size) ?? [];
    group.push(row);
    bySize.set(row.size, group);
  }

  const potentialDups = [...bySize.values()].filter(g => g.length > 1);
  if (potentialDups.length === 0) {
    log("info", "[scheduler:dedup] no potential duplicates found");
    return;
  }

  let dupSets = 0;
  let removed = 0;

  for (const group of potentialDups) {
    const hashMap = new Map<string, typeof group>();

    for (const row of group) {
      const bytes = await getFile(row.r2_key);
      if (!bytes) continue;
      const hash = createHash("sha256").update(bytes).digest("hex");
      const existing = hashMap.get(hash) ?? [];
      existing.push(row);
      hashMap.set(hash, existing);
    }

    for (const [, entries] of hashMap) {
      if (entries.length <= 1) continue;
      dupSets++;

      // Keep the first entry, remove the rest
      const [keep, ...dups] = entries;
      const dupIds = dups.map(d => d.id);

      log("info", `[scheduler:dedup] keeping "${keep.r2_key}", removing ${dups.length} duplicate(s): ${dups.map(d => d.r2_key).join(", ")}`);

      // Delete from DB (cascades to font_info + font_names)
      deleteFontsByIds(dupIds);

      // Delete files from disk
      for (const dup of dups) {
        try {
          await deleteFile(dup.r2_key);
        } catch { /* file may already be gone */ }
      }

      removed += dups.length;
    }
  }

  log("info", `[scheduler:dedup] done — ${dupSets} duplicate set(s), ${removed} file(s) removed`);
}

// ─── Manual dedup (for API endpoint) ──────────────────────────────────────────

export interface DuplicateGroup {
  hash: string;
  size: number;
  entries: Array<{ id: string; r2_key: string; filename: string }>;
}

/** Find duplicate font files without removing them. */
export async function findDuplicates(): Promise<DuplicateGroup[]> {
  const db = getDb();
  const allRows = db.prepare<{ id: string; r2_key: string; filename: string; size: number }, []>(
    "SELECT id, r2_key, filename, size FROM font_files"
  ).all();

  const bySize = new Map<number, typeof allRows>();
  for (const row of allRows) {
    const group = bySize.get(row.size) ?? [];
    group.push(row);
    bySize.set(row.size, group);
  }

  const result: DuplicateGroup[] = [];

  for (const group of bySize.values()) {
    if (group.length <= 1) continue;

    const hashMap = new Map<string, { entries: typeof group; size: number }>();
    for (const row of group) {
      const bytes = await getFile(row.r2_key);
      if (!bytes) continue;
      const hash = createHash("sha256").update(bytes).digest("hex");
      const existing = hashMap.get(hash);
      if (existing) {
        existing.entries.push(row);
      } else {
        hashMap.set(hash, { entries: [row], size: row.size });
      }
    }

    for (const [hash, { entries, size }] of hashMap) {
      if (entries.length > 1) {
        result.push({
          hash,
          size,
          entries: entries.map(e => ({ id: e.id, r2_key: e.r2_key, filename: e.filename })),
        });
      }
    }
  }

  return result;
}

/** Remove duplicate fonts, keeping one per group. Returns count of removed entries. */
export async function removeDuplicates(): Promise<{ removed: number; groups: number }> {
  const groups = await findDuplicates();
  let removed = 0;

  for (const group of groups) {
    const [, ...dups] = group.entries;
    const dupIds = dups.map(d => d.id);
    deleteFontsByIds(dupIds);
    for (const dup of dups) {
      try { await deleteFile(dup.r2_key); } catch { /* ok */ }
    }
    removed += dups.length;
  }

  return { removed, groups: groups.length };
}
