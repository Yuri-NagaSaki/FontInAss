/**
 * Processing logs API routes.
 *
 * GET  /api/logs              - List processing logs (paginated, searchable)
 * GET  /api/logs/missing-fonts - Aggregated missing font ranking
 * GET  /api/logs/stats        - Processing statistics
 * POST /api/logs/missing-fonts/resolve   - Mark font as resolved (auth)
 * POST /api/logs/missing-fonts/unresolve - Unmark resolved font (auth)
 */

import { Hono } from "hono";
import { config, log, checkApiKey } from "../config.js";
import { getDb } from "../db.js";

const logs = new Hono();

// ─── List processing logs ─────────────────────────────────────────────────────

logs.get("/", (c) => {
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10));
  const limit = Math.min(200, Math.max(1, parseInt(c.req.query("limit") ?? "50", 10)));
  const search = (c.req.query("search") ?? "").trim().toLowerCase();
  const codeFilter = c.req.query("code") ?? "";
  const offset = (page - 1) * limit;

  try {
    const db = getDb();
    let total: number;
    let rows: unknown[];

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (search) {
      conditions.push("(LOWER(filename) LIKE ? OR LOWER(missing_fonts) LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }
    if (codeFilter) {
      conditions.push("code = ?");
      params.push(parseInt(codeFilter, 10));
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    total = db.prepare<{ cnt: number }, unknown[]>(
      `SELECT COUNT(*) as cnt FROM processing_logs ${where}`
    ).get(...params)?.cnt ?? 0;

    rows = db.prepare(
      `SELECT id, filename, code, messages, missing_fonts, font_count, file_size, elapsed_ms, processed_at FROM processing_logs ${where} ORDER BY processed_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    return c.json({ total, page, limit, data: rows }, 200, {
      "Cache-Control": "no-cache, no-store",
    });
  } catch (e) {
    log("error", "[logs/list] error:", e);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ─── Missing font ranking ─────────────────────────────────────────────────────

logs.get("/missing-fonts", (c) => {
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") ?? "50", 10)));
  const showResolved = c.req.query("show_resolved") === "true";

  try {
    const db = getDb();
    const rows = db.prepare<{ missing_fonts: string }, []>(
      "SELECT missing_fonts FROM processing_logs WHERE missing_fonts IS NOT NULL AND missing_fonts != '[]' AND missing_fonts != ''"
    ).all();

    // Get resolved set
    const resolvedRows = db.prepare<{ font_name: string; resolved_at: string }, []>(
      "SELECT font_name, resolved_at FROM resolved_fonts"
    ).all();
    const resolvedMap = new Map(resolvedRows.map(r => [r.font_name, r.resolved_at]));

    // Count occurrences of each missing font
    const fontCounts = new Map<string, number>();
    for (const row of rows) {
      try {
        const fonts: string[] = JSON.parse(row.missing_fonts);
        for (const font of fonts) {
          fontCounts.set(font, (fontCounts.get(font) ?? 0) + 1);
        }
      } catch { /* skip malformed */ }
    }

    // Build ranking with resolved flag
    let ranking = [...fontCounts.entries()]
      .map(([name, count]) => ({
        font_name: name,
        count,
        resolved: resolvedMap.has(name),
        resolved_at: resolvedMap.get(name) ?? null,
      }))
      .sort((a, b) => b.count - a.count);

    // Filter out resolved unless show_resolved
    if (!showResolved) {
      ranking = ranking.filter(r => !r.resolved);
    }

    return c.json({ total: ranking.length, data: ranking.slice(0, limit) });
  } catch (e) {
    log("error", "[logs/missing-fonts] error:", e);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ─── Mark font as resolved ────────────────────────────────────────────────────

logs.post("/missing-fonts/resolve", async (c) => {
  if (!checkApiKey(c)) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json<{ font_name: string }>().catch(() => null);
  if (!body?.font_name) return c.json({ error: "font_name required" }, 400);

  try {
    const db = getDb();
    db.prepare("INSERT OR IGNORE INTO resolved_fonts (font_name) VALUES (?)").run(body.font_name);
    return c.json({ ok: true, font_name: body.font_name });
  } catch (e) {
    log("error", "[logs/resolve] error:", e);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ─── Unmark resolved font ─────────────────────────────────────────────────────

logs.post("/missing-fonts/unresolve", async (c) => {
  if (!checkApiKey(c)) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json<{ font_name: string }>().catch(() => null);
  if (!body?.font_name) return c.json({ error: "font_name required" }, 400);

  try {
    const db = getDb();
    db.prepare("DELETE FROM resolved_fonts WHERE font_name = ?").run(body.font_name);
    return c.json({ ok: true, font_name: body.font_name });
  } catch (e) {
    log("error", "[logs/unresolve] error:", e);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ─── Processing stats ─────────────────────────────────────────────────────────

logs.get("/stats", (c) => {
  try {
    const db = getDb();

    const total = db.prepare<{ cnt: number }, []>(
      "SELECT COUNT(*) as cnt FROM processing_logs"
    ).get()?.cnt ?? 0;

    const today = new Date().toISOString().slice(0, 10);
    const todayCount = db.prepare<{ cnt: number }, [string]>(
      "SELECT COUNT(*) as cnt FROM processing_logs WHERE processed_at >= ?"
    ).get(today)?.cnt ?? 0;

    const byCode = db.prepare<{ code: number; cnt: number }, []>(
      "SELECT code, COUNT(*) as cnt FROM processing_logs GROUP BY code ORDER BY cnt DESC"
    ).all();

    const missingFontLogs = db.prepare<{ cnt: number }, []>(
      "SELECT COUNT(*) as cnt FROM processing_logs WHERE missing_fonts IS NOT NULL AND missing_fonts != '[]' AND missing_fonts != ''"
    ).get()?.cnt ?? 0;

    const successCount = byCode.find(r => r.code === 200)?.cnt ?? 0;
    const warningCount = byCode.find(r => r.code === 201)?.cnt ?? 0;
    const errorCount = total - successCount - warningCount;

    return c.json({
      total,
      today: todayCount,
      success: successCount,
      warnings: warningCount,
      errors: errorCount,
      totalMissingFonts: missingFontLogs,
    });
  } catch (e) {
    log("error", "[logs/stats] error:", e);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ─── Helper: Record a processing result ───────────────────────────────────────

export function recordProcessingLog(entry: {
  filename: string;
  clientIp?: string;
  code: number;
  messages: string[] | null;
  missingFonts: string[];
  fontCount: number;
  fileSize: number;
  elapsedMs: number;
}): void {
  try {
    const db = getDb();
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO processing_logs (id, filename, client_ip, code, messages, missing_fonts, font_count, file_size, elapsed_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      entry.filename,
      entry.clientIp ?? null,
      entry.code,
      entry.messages ? JSON.stringify(entry.messages) : null,
      entry.missingFonts.length > 0 ? JSON.stringify(entry.missingFonts) : null,
      entry.fontCount,
      entry.fileSize,
      entry.elapsedMs,
    );
  } catch (e) {
    log("error", "[logs] failed to record processing log:", e);
  }
}

export default logs;
