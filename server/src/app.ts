import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  ApiHistoryQuerySchema,
  ApiTokenApplicationListQuerySchema,
  ApiTokenApplicationSecretSchema,
  ArchiveMetadataSchema,
  ArchivePatchSchema,
  BrowseQuerySchema,
  CODE,
  CreateApiTokenSchema,
  CreateApiTokenApplicationSchema,
  DeleteFontsRequestSchema,
  FontKeysQuerySchema,
  FontListQuerySchema,
  IdParamSchema,
  IndexFontsRequestSchema,
  MissingFontMutationSchema,
  ProcessingLogQuerySchema,
  ReviewApiTokenApplicationSchema,
  SubsetOptionsSchema,
  UpdateApiTokenSchema,
  type SubsetOptions,
} from "@fontinass/contracts";
import { ArchiveLibraryError } from "@fontinass/archive-library";
import { extractUploadToken, UploadAccessError, type ApiTokenRecord } from "@fontinass/access-control";
import { fontMimeType } from "@fontinass/font-catalog";
import { FontSubmissionError } from "@fontinass/font-submission";
import type { AppContainer } from "./container.js";
import { masterKeyMatches } from "./runtime.js";

type FontAccessPrincipal =
  | { role: "admin" }
  | { role: "member"; token: ApiTokenRecord };

declare module "hono" {
  interface ContextVariableMap {
    fontAccessPrincipal: FontAccessPrincipal;
  }
}

export function createApp(container: AppContainer) {
  const admin = adminMiddleware(container);
  const fontMember = fontAccessMiddleware(container);
  const noStore: MiddlewareHandler = async (c, next) => { await next(); c.header("Cache-Control", "no-store"); };

  const fontRoutes = new Hono()
    .get("/stats", admin, (c) => c.json({ ...container.fonts.stats(), scheduler: container.getSchedulerStatus() }))
    .get("/browse", admin, zValidator("query", BrowseQuerySchema), (c) => c.json(container.fonts.browse(c.req.valid("query").prefix)))
    .get("/keys", admin, zValidator("query", FontKeysQuerySchema), (c) => {
      const query = c.req.valid("query");
      const all = container.fonts.listKeys(query.prefix);
      const page = all.slice(query.cursor, query.cursor + query.limit);
      const next = query.cursor + page.length;
      return c.json({ keys: page, nextCursor: next >= all.length ? null : String(next), done: next >= all.length });
    })
    .post("/index", admin, zValidator("json", IndexFontsRequestSchema), async (c) => {
      const input = c.req.valid("json");
      return c.json(await container.fonts.indexKeys({ prefix: input.prefix, keys: input.keys, batchSize: input.batch_size }));
    })
    .post("/scan", admin, async (c) => c.json(await container.fonts.scan()))
    .get("/duplicates", admin, async (c) => {
      const groups = await container.fonts.findDuplicates();
      return c.json({ groups, total: groups.length });
    })
    .post("/deduplicate", admin, async (c) => c.json(await container.fonts.deduplicate()))
    .get("/", fontMember, zValidator("query", FontListQuerySchema), (c) => c.json(container.fonts.list(c.req.valid("query"))))
    .post("/", fontMember, async (c) => {
      const form = await c.req.formData();
      const files = form.getAll("file").filter((entry): entry is File => entry instanceof File);
      if (!files.length) return c.json({ error: "No files provided. Use field name 'file'" }, 400);
      const targetDirectory = c.req.header("x-target-dir") ?? "";
      const results = [];
      const auditResults = [];
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const result = await container.fonts.upload(file.name, bytes, targetDirectory);
        results.push(result);
        auditResults.push({
          filename: file.name,
          status: result.error ? "rejected" as const : "success" as const,
          font_id: result.id || null,
          faces: result.faces,
          size: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          error: result.error ?? null,
        });
      }
      const principal = c.get("fontAccessPrincipal");
      if (principal.role === "member") {
        container.uploadAccess.recordSubmission(principal.token.id, auditResults, {
          clientIp: requestIp(c),
          userAgent: c.req.header("user-agent") ?? null,
        });
      }
      return c.json({ results }, results.some((result) => !result.error) ? 200 : 400);
    })
    .delete("/", admin, zValidator("json", DeleteFontsRequestSchema), async (c) => c.json({ deleted: await container.fonts.delete(c.req.valid("json").ids) }))
    .get("/:id/download", fontMember, zValidator("param", IdParamSchema), async (c) => {
      const file = await container.fonts.download(c.req.valid("param").id);
      if (!file) return c.json({ error: "Font not found" }, 404);
      return new Response(Buffer.from(file.bytes), { headers: {
        "Content-Type": fontMimeType(file.filename),
        "Content-Disposition": contentDisposition(file.filename),
        "Content-Length": String(file.bytes.byteLength),
        "Cache-Control": "private, max-age=3600",
      } });
    })
    .delete("/:id", admin, zValidator("param", IdParamSchema), async (c) => {
      const deleted = await container.fonts.delete([c.req.valid("param").id]);
      return deleted ? c.json({ ok: true as const }) : c.json({ error: "Font not found" }, 404);
    });

  const subsetRoutes = new Hono().post("/", async (c) => {
    const startedAt = Date.now();
    const options = subsetOptionsFromHeaders(c);
    const files: Array<{ name: string; bytes: Uint8Array }> = [];
    if ((c.req.header("content-type") ?? "").includes("multipart/form-data")) {
      const form = await c.req.formData();
      const entries = form.getAll("file").filter((entry): entry is File => entry instanceof File);
      if (entries.length > 100) return binarySubsetResponse(CODE.CLIENT_ERROR, ["Too many files (max 100)"], null);
      for (const file of entries) files.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    } else {
      files.push({ name: decodeHeader(c.req.header("x-filename")) || "subtitle.ass", bytes: new Uint8Array(await c.req.arrayBuffer()) });
    }
    if (!files.length) return binarySubsetResponse(CODE.CLIENT_ERROR, ["No file provided"], null);
    const clientIp = hashClientIp(c);
    const processOne = async (file: { name: string; bytes: Uint8Array }) => {
      const started = Date.now();
      const result = await container.subtitles.process({ filename: file.name, bytes: file.bytes, options });
      container.activity.record({
        filename: file.name, clientIp, code: result.code, messages: result.messages,
        missingFonts: missingFonts(result.messages), fontCount: 0, fileSize: file.bytes.byteLength, elapsedMs: Date.now() - started,
      });
      return result;
    };
    if (files.length === 1) {
      try {
        const result = await processOne(files[0]);
        return binarySubsetResponse(result.code, result.messages, result.data);
      } catch (error) {
        container.logger.error("[subset] unhandled processing error", error);
        return binarySubsetResponse(CODE.SERVER_ERROR, ["Internal server error"], null);
      }
    }
    const results: Array<{ filename: string; code: number; messages: string[]; data: string | null }> = [];
    for (let offset = 0; offset < files.length; offset += container.config.subsetConcurrency) {
      const chunk = files.slice(offset, offset + container.config.subsetConcurrency);
      const settled = await Promise.allSettled(chunk.map(processOne));
      settled.forEach((item, index) => {
        if (item.status === "fulfilled") results.push({ filename: chunk[index].name, code: item.value.code, messages: item.value.messages, data: item.value.data ? Buffer.from(item.value.data).toString("base64") : null });
        else results.push({ filename: chunk[index].name, code: CODE.SERVER_ERROR, messages: ["Internal server error"], data: null });
      });
    }
    container.logger.info(`[subset] batch=${files.length} elapsed=${Date.now() - startedAt}ms`);
    return c.json({ results }, results.some((result) => result.code >= 400) ? 207 : 200);
  });

  const archiveRoutes = new Hono()
    .get("/", (c) => c.json(container.archives.listPublished(), 200, { "Cache-Control": "public, max-age=60" }))
    .get("/:id/download", zValidator("param", IdParamSchema), (c) => {
      const archive = container.archives.listPublished().find((item) => item.id === c.req.valid("param").id);
      return archive?.download_url ? c.redirect(archive.download_url, 302) : c.json({ error: "Archive not found" }, 404);
    })
    .post("/contribute", async (c) => {
      try {
        const { file, metadata } = await archiveForm(c);
        const archive = await container.archives.contribute({ filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()), metadata }, hashClientIp(c));
        return c.json({ id: archive.id, status: archive.status, message: "Submitted for review" }, 201);
      } catch (error) { return archiveError(c, error); }
    })
    .use("/*", admin)
    .get("/pending", (c) => c.json(container.archives.listPending()))
    .post("/upload", async (c) => {
      try {
        const { file, metadata } = await archiveForm(c);
        const archive = await container.archives.publish({ filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()), metadata });
        return c.json({ id: archive.id, status: archive.status, filename: archive.filename, download_url: archive.download_url }, 201);
      } catch (error) { return archiveError(c, error); }
    })
    .post("/:id/approve", zValidator("param", IdParamSchema), async (c) => {
      try { const archive = await container.archives.approve(c.req.valid("param").id); return c.json({ id: archive.id, status: archive.status, download_url: archive.download_url }); }
      catch (error) { return archiveError(c, error); }
    })
    .post("/:id/reject", zValidator("param", IdParamSchema), async (c) => {
      try { const archive = await container.archives.reject(c.req.valid("param").id); return c.json({ id: archive.id, status: archive.status }); }
      catch (error) { return archiveError(c, error); }
    })
    .put("/:id", zValidator("param", IdParamSchema), zValidator("json", ArchivePatchSchema), async (c) => {
      try { return c.json(await container.archives.edit(c.req.valid("param").id, c.req.valid("json"))); }
      catch (error) { return archiveError(c, error); }
    })
    .delete("/:id", zValidator("param", IdParamSchema), async (c) => {
      try { await container.archives.remove(c.req.valid("param").id); return c.json({ ok: true as const }); }
      catch (error) { return archiveError(c, error); }
    })
    .get("/:id/preview", zValidator("param", IdParamSchema), async (c) => {
      try { return c.json(await container.archives.preview(c.req.valid("param").id)); }
      catch (error) { return archiveError(c, error); }
    })
    .get("/:id/file", zValidator("param", IdParamSchema), async (c) => {
      try {
        const file = await container.archives.download(c.req.valid("param").id);
        return new Response(Buffer.from(file.bytes), { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": contentDisposition(file.filename), "Content-Length": String(file.bytes.byteLength) } });
      } catch (error) { return archiveError(c, error); }
    });

  const activityRoutes = new Hono()
    .get("/", zValidator("query", ProcessingLogQuerySchema), (c) => c.json(container.activity.list(c.req.valid("query"))))
    .get("/missing-fonts", zValidator("query", z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), show_resolved: z.enum(["true", "false"]).default("false") })), (c) => {
      const query = c.req.valid("query");
      return c.json(container.activity.missingFonts(query.limit, query.show_resolved === "true"));
    })
    .get("/stats", (c) => c.json(container.activity.stats()))
    .post("/missing-fonts/resolve", admin, zValidator("json", MissingFontMutationSchema), (c) => {
      const font_name = c.req.valid("json").font_name; container.activity.resolve(font_name); return c.json({ ok: true as const, font_name });
    })
    .post("/missing-fonts/unresolve", admin, zValidator("json", MissingFontMutationSchema), (c) => {
      const font_name = c.req.valid("json").font_name; container.activity.unresolve(font_name); return c.json({ ok: true as const, font_name });
    });

  const tokenRoutes = new Hono()
    .use("*", admin)
    .use("*", noStore)
    .get("/applications", zValidator("query", ApiTokenApplicationListQuerySchema), (c) => c.json(container.uploadAccess.listApplications(c.req.valid("query"))))
    .post("/applications/:id/review", zValidator("param", IdParamSchema), zValidator("json", ReviewApiTokenApplicationSchema), (c) => {
      try { return c.json({ application: container.uploadAccess.review(c.req.valid("param").id, c.req.valid("json")) }); }
      catch (error) { return uploadAccessError(c, error); }
    })
    .get("/", (c) => c.json({ data: container.uploadAccess.listTokens() }))
    .get("/stats", (c) => c.json(container.uploadAccess.stats()))
    .get("/history", zValidator("query", ApiHistoryQuerySchema), (c) => c.json(container.uploadAccess.history(c.req.valid("query"))))
    .post("/", zValidator("json", CreateApiTokenSchema), (c) => c.json(container.uploadAccess.issue(c.req.valid("json")), 201))
    .patch("/:id", zValidator("param", IdParamSchema), zValidator("json", UpdateApiTokenSchema), (c) => {
      const token = container.uploadAccess.update(c.req.valid("param").id, c.req.valid("json"));
      return token ? c.json({ token }) : c.json({ error: "Token not found" }, 404);
    })
    .delete("/:id", zValidator("param", IdParamSchema), (c) => {
      const token = container.uploadAccess.revoke(c.req.valid("param").id);
      return token ? c.json({ token }) : c.json({ error: "Token not found" }, 404);
    })
    .get("/:id/history", zValidator("param", IdParamSchema), zValidator("query", ApiHistoryQuerySchema), (c) => {
      const token = container.uploadAccess.findToken(c.req.valid("param").id);
      if (!token) return c.json({ error: "Token not found" }, 404);
      return c.json({ token, ...container.uploadAccess.history({ ...c.req.valid("query"), tokenId: token.id }) });
    });

  const tokenApplicationRoutes = new Hono()
    .use("*", noStore)
    .post("/", zValidator("json", CreateApiTokenApplicationSchema), (c) => {
      try { return c.json(container.uploadAccess.apply(c.req.valid("json"), hashClientIp(c)), 201); }
      catch (error) { return uploadAccessError(c, error); }
    })
    .get("/:id", zValidator("param", IdParamSchema), (c) => {
      try { return c.json({ application: container.uploadAccess.applicationStatus(c.req.valid("param").id, c.req.header("x-application-secret") ?? "") }); }
      catch (error) { return uploadAccessError(c, error); }
    })
    .post("/:id/claim", zValidator("param", IdParamSchema), zValidator("json", ApiTokenApplicationSecretSchema), (c) => {
      try { return c.json(container.uploadAccess.claim(c.req.valid("param").id, c.req.valid("json").secret)); }
      catch (error) { return uploadAccessError(c, error); }
    });

  const accessRoutes = new Hono()
    .use("*", noStore)
    .get("/whoami", fontMember, (c) => {
      const principal = c.get("fontAccessPrincipal");
      return principal.role === "admin"
        ? c.json({ role: "admin" as const, name: "Administrator", prefix: null })
        : c.json({ role: "member" as const, name: principal.token.name, prefix: principal.token.prefix });
    });

  const publicUpload = new Hono()
    .use("*", noStore)
    .get("/policy", (c) => c.json({
      max_files: container.config.publicUploadMaxFiles,
      max_file_bytes: container.config.publicUploadMaxFileSize,
      max_batch_bytes: container.config.publicUploadMaxBatchSize,
      requests_per_minute: container.config.publicUploadRequestsPerMinute,
    }))
    .post("/", async (c) => {
      const contentLength = Number(c.req.header("content-length") ?? 0);
      if (Number.isFinite(contentLength) && contentLength > container.config.publicUploadMaxBatchSize + 1024 * 1024) {
        return c.json({ error: "Upload batch exceeds the public total size limit" }, 413);
      }
      const form = await c.req.formData();
      const files = form.getAll("file").filter((entry): entry is File => entry instanceof File);
      if (files.length > container.config.publicUploadMaxFiles) {
        return c.json({ error: `Too many files (max ${container.config.publicUploadMaxFiles})` }, 400);
      }
      try {
        const result = await container.submissions.submitPublic({
          files: await Promise.all(files.map(async (file) => ({ filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }))),
          context: { clientIp: requestIp(c), userAgent: c.req.header("user-agent") ?? null },
          rateLimitKey: hashClientIp(c),
        });
        const status = result.summary.accepted || result.summary.duplicate ? 200 : result.summary.rejected ? 400 : 500;
        return c.json(result, status);
      } catch (error) { return fontSubmissionError(c, error); }
    });

  const programUpload = new Hono()
    .use("*", noStore)
    .get("/whoami", (c) => {
      const plaintext = extractUploadToken(c.req.header("x-upload-token"), c.req.header("authorization"));
      const token = plaintext ? container.uploadAccess.authenticate(plaintext) : null;
      return token ? c.json({
        role: "member" as const,
        id: token.id, name: token.name, prefix: token.prefix, request_count: token.request_count,
        accepted_file_count: token.accepted_file_count, accepted_bytes: token.accepted_bytes,
        last_used_at: token.last_used_at, expires_at: token.expires_at,
      }) : c.json({ error: "Invalid or missing upload credential" }, 401);
    })
    .get("/history", zValidator("query", ApiHistoryQuerySchema), (c) => {
      const plaintext = extractUploadToken(c.req.header("x-upload-token"), c.req.header("authorization"));
      const token = plaintext ? container.uploadAccess.authenticate(plaintext) : null;
      if (!token) return c.json({ error: "Invalid or missing upload credential" }, 401);
      const query = c.req.valid("query");
      return c.json(container.uploadAccess.history({ tokenId: token.id, status: query.status, page: query.page, limit: query.limit }));
    })
    .post("/upload", async (c) => {
      const plaintext = extractUploadToken(c.req.header("x-upload-token"), c.req.header("authorization"));
      if (!plaintext) return c.json({ error: "Invalid or missing upload credential" }, 401);
      const form = await c.req.formData();
      const files = form.getAll("file").filter((entry): entry is File => entry instanceof File);
      try {
        const result = await container.submissions.submitCredentialed({
          credential: plaintext,
          files: await Promise.all(files.map(async (file) => ({ filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }))),
          context: { clientIp: requestIp(c), userAgent: c.req.header("user-agent") ?? null },
        });
        const status = result.summary.accepted || result.summary.duplicate ? 200 : result.summary.rejected ? 400 : 500;
        return c.json(result, status);
      } catch (error) { return fontSubmissionError(c, error); }
    });

  const api = new Hono()
    .get("/health", admin, (c) => {
      try { container.database.ping(); return c.json({ status: "ok" as const, version: 2 as const }, 200, { "Cache-Control": "no-store" }); }
      catch { return c.json({ status: "error" as const, version: 2 as const }, 500); }
    })
    .route("/fonts", fontRoutes)
    .route("/subset", subsetRoutes)
    .route("/archives", archiveRoutes)
    .route("/activity", activityRoutes)
    .route("/access", accessRoutes)
    .route("/tokens", tokenRoutes)
    .route("/token-applications", tokenApplicationRoutes)
    .route("/upload", publicUpload)
    .route("/v1", programUpload);

  const app = new Hono()
    .use("*", async (c, next) => { const start = Date.now(); await next(); container.logger.debug(`${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - start}ms`); })
    .use("*", cors({ origin: container.config.corsOrigin, allowHeaders: ["*"], allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], exposeHeaders: ["X-Code", "X-Message", "Content-Disposition"] }))
    .use("*", compress())
    .route("/api", api);

  app.use("/assets/*", serveStatic({ root: "../web/dist" }));
  app.use("/*", serveStatic({ root: "../web/dist" }));
  app.get("*", async (c) => {
    if (c.req.path.startsWith("/api/")) return c.json({ error: "Not found" }, 404);
    const file = Bun.file(resolve(import.meta.dir, "../../web/dist/index.html"));
    return await file.exists() ? new Response(file, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=0, s-maxage=300" } }) : c.text("Not found", 404);
  });
  app.onError((error, c) => { container.logger.error(`[http] ${c.req.method} ${c.req.path}`, error); return c.json({ error: "Internal server error" }, 500); });
  return app;
}

export type AppType = ReturnType<typeof createApp>;

function adminMiddleware(container: AppContainer): MiddlewareHandler {
  return async (c, next) => {
    const bearer = c.req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!masterKeyMatches(container.config.apiKey, c.req.header("x-api-key") ?? bearer)) return c.json({ error: "Unauthorized" }, 401);
    await next();
  };
}

function fontAccessMiddleware(container: AppContainer): MiddlewareHandler {
  return async (c, next) => {
    const credential = accessCredential(c);
    if (masterKeyMatches(container.config.apiKey, credential)) {
      c.set("fontAccessPrincipal", { role: "admin" });
      await next();
      return;
    }
    const token = credential ? container.uploadAccess.authenticate(credential) : null;
    if (!token || !credential) return c.json({ error: "Unauthorized" }, 401);
    c.set("fontAccessPrincipal", { role: "member", token });
    await next();
  };
}

function accessCredential(c: Context): string | null {
  const apiKey = c.req.header("x-api-key")?.trim();
  if (apiKey) return apiKey;
  return extractUploadToken(c.req.header("x-upload-token"), c.req.header("authorization"));
}

function subsetOptionsFromHeaders(c: Context): SubsetOptions {
  return SubsetOptionsSchema.parse({
    fontsCheck: c.req.header("x-fonts-check") === "1",
    clearFonts: c.req.header("x-clear-fonts") === "1",
    fontNameMode: c.req.header("x-font-name-mode") === "preserve" ? "preserve" : "alias",
    fontAliasSalt: decodeHeader(c.req.header("x-font-alias-salt")),
    srtFormat: decodeHeader(c.req.header("x-srt-format")),
    srtStyle: decodeHeader(c.req.header("x-srt-style")),
  });
}

function binarySubsetResponse(code: number, messages: string[], data: Uint8Array | null): Response {
  return new Response(data ? Buffer.from(data) : null, { status: code >= 500 ? 500 : 200, headers: {
    "Content-Type": "application/octet-stream", "X-Code": String(code), "X-Message": Buffer.from(JSON.stringify(messages)).toString("base64"),
  } });
}

async function archiveForm(c: Context) {
  const form = await c.req.formData();
  const file = form.get("file");
  const rawMetadata = form.get("metadata");
  if (!(file instanceof File) || typeof rawMetadata !== "string") throw new ArchiveLibraryError("Missing file or metadata", "invalid");
  if (rawMetadata.length > 8192) throw new ArchiveLibraryError("Metadata is too large", "invalid");
  return { file, metadata: ArchiveMetadataSchema.parse(JSON.parse(rawMetadata)) };
}

function archiveError(c: Context, error: unknown) {
  if (error instanceof z.ZodError) return c.json({ error: "Invalid metadata", issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) }, 400);
  if (error instanceof ArchiveLibraryError) {
    const status = error.code === "not_found" ? 404 : error.code === "rate_limited" ? 429 : error.code === "storage_unavailable" ? 503 : 400;
    return c.json({ error: error.message }, status);
  }
  throw error;
}

function uploadAccessError(c: Context, error: unknown) {
  if (!(error instanceof UploadAccessError)) throw error;
  if (error.code === "not_found") return c.json({ error: error.message }, 404);
  if (error.code === "invalid_secret") return c.json({ error: error.message }, 401);
  if (error.code === "rate_limited") return c.json({ error: error.message }, 429);
  return c.json({ error: error.message }, 409);
}

function fontSubmissionError(c: Context, error: unknown) {
  if (!(error instanceof FontSubmissionError)) throw error;
  if (error.code === "invalid_token") return c.json({ error: error.message }, 401);
  if (error.code === "rate_limited") return c.json({ error: error.message }, 429);
  if (error.code === "file_too_large" || error.code === "batch_too_large") return c.json({ error: error.message }, 413);
  return c.json({ error: error.message }, 400);
}

function decodeHeader(value?: string): string {
  if (!value) return "";
  try { return Buffer.from(value, "base64").toString("utf8"); } catch { return value; }
}

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_").trim() || "file";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function requestIp(c: Context): string | null {
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? null;
}

function hashClientIp(c: Context): string {
  const ip = requestIp(c) ?? "unknown";
  return ip === "unknown" ? ip : createHash("sha256").update(ip).digest("hex").slice(0, 12);
}

function missingFonts(messages: string[]): string[] {
  return messages.filter((message) => message.startsWith("Missing font:")).map((message) => message.replace(/^Missing font:\s*\[?|\]?$/g, ""));
}
