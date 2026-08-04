import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  ArchiveMetadataSchema,
  ArchivePatchSchema,
  CODE,
  CreateProgrammaticCredentialSchema,
  DeleteFontsRequestSchema,
  FontListQuerySchema,
  FontKeysQuerySchema,
  IdParamSchema,
  IndexFontsRequestSchema,
  MissingFontMutationSchema,
  ProcessingLogQuerySchema,
  SubsetOptionsSchema,
  WorkspaceArchiveMetadataSchema,
  type ArchiveMetadata,
  type SubsetOptions,
  type WorkspacePrincipal,
} from "@fontinass/contracts";
import {
  EntitlementProviderError,
  WorkspaceAccessError,
  extractBearerCredential,
} from "@fontinass/access-control";
import { ArchiveLibraryError } from "@fontinass/archive-library";
import { fontMimeType } from "@fontinass/font-catalog";
import { FontSubmissionError } from "@fontinass/font-submission";
import type { AppContainer } from "./container.js";
import { OidcBff, OidcBffError } from "./oidc.js";
import { operatorCredentialMatches } from "./runtime.js";
import {
  PRIVATE_NO_STORE_HEADERS,
  clearSessionCookie,
  originMatches,
  readSessionCookie,
  setSessionCookie,
} from "./session-cookie.js";

type AppEnv = { Variables: { principal: WorkspacePrincipal } };

export interface OidcBffPort {
  authorizationUrl(returnTo: string): Promise<URL>;
  callback(currentUrl: URL): Promise<{
    token: string;
    principal: WorkspacePrincipal;
    returnTo: string;
  }>;
  endSessionUrl(principal: WorkspacePrincipal): Promise<URL | null>;
}

const OrganizationQuerySchema = z.object({
  organizationId: z.string().min(1).max(128),
});
const WorkspaceFontListQuerySchema = FontListQuerySchema.extend({
  organizationId: z.string().min(1).max(128),
});
const LoginQuerySchema = z.object({
  returnTo: z.string().max(500).default("/workspace"),
});
const LogoutSchema = z.object({ global: z.boolean().default(false) });

export function createApp(
  container: AppContainer,
  oidcBff: OidcBffPort = new OidcBff(
    container.config.oidc,
    container.workspaceAccess,
  ),
) {
  const noStore: MiddlewareHandler<AppEnv> = async (c, next) => {
    await next();
    for (const [name, value] of Object.entries(PRIVATE_NO_STORE_HEADERS)) {
      c.header(name, value);
    }
  };
  const session = sessionMiddleware(container);
  const administrator = administratorMiddleware(container);
  const credential = credentialMiddleware(container);
  const operator = operatorMiddleware(container);

  const authRoutes = new Hono<AppEnv>()
    .use("*", noStore)
    .use("*", browserCredentialBoundary)
    .get("/login", zValidator("query", LoginQuerySchema), async (c) => {
      try {
        return c.redirect(
          (await oidcBff.authorizationUrl(c.req.valid("query").returnTo)).href,
          302,
        );
      } catch (error) {
        return safeAccessError(c, error);
      }
    })
    .get("/callback", async (c) => {
      try {
        const result = await oidcBff.callback(new URL(c.req.url));
        c.header("Set-Cookie", setSessionCookie(result.token, container.config));
        return c.redirect(result.returnTo, 303);
      } catch (error) {
        container.logger.warn("[oidc] callback rejected", safeErrorClass(error));
        return c.redirect("/workspace?auth=denied", 303);
      }
    })
    .get("/session", async (c) => {
      try {
        const principal = await container.workspaceAccess.resolveSession(
          readSessionCookie(c.req.header("cookie"), container.config.environment),
        );
        return c.json(container.workspaceAccess.sessionView(principal));
      } catch (error) {
        if (
          error instanceof WorkspaceAccessError &&
          (error.code === "unauthenticated" ||
            error.code === "access_denied" ||
            error.code === "account_inactive")
        ) {
          c.header("Set-Cookie", clearSessionCookie(container.config));
          return c.json({ authenticated: false as const });
        }
        return safeAccessError(c, error);
      }
    })
    .post("/logout", session, zValidator("json", LogoutSchema), async (c) => {
      try {
        assertSessionMutation(c, container);
        const principal = c.get("principal");
        const endSession = c.req.valid("json").global
          ? await oidcBff.endSessionUrl(principal)
          : null;
        container.workspaceAccess.revokeSession(principal);
        c.header("Set-Cookie", clearSessionCookie(container.config));
        return c.json({
          ok: true as const,
          logoutUrl: endSession?.href ?? null,
        });
      } catch (error) {
        return safeAccessError(c, error);
      }
    });

  const workspaceFontRoutes = new Hono<AppEnv>()
    .use("*", noStore)
    .use("*", session)
    .get("/", zValidator("query", WorkspaceFontListQuerySchema), (c) => {
      const query = c.req.valid("query");
      const principal = c.get("principal");
      container.workspaceAccess.authorize(
        principal,
        "fonts.read",
        query.organizationId,
      );
      return c.json(container.fonts.list(query));
    })
    .post("/", async (c) => {
      try {
        assertSessionMutation(c, container);
        const organizationId = requiredOrganizationHeader(c);
        const form = await c.req.formData();
        const files = form
          .getAll("file")
          .filter((entry): entry is File => entry instanceof File);
        const result = await container.submissions.submitAuthorized({
          principal: c.get("principal"),
          organizationId,
          files: await uploadedFiles(files),
        });
        return c.json(result, uploadStatus(result));
      } catch (error) {
        return submissionOrAccessError(c, error);
      }
    })
    .get("/:id/download", zValidator("param", IdParamSchema), async (c) => {
      try {
        const organizationId = requiredOrganizationHeader(c);
        const principal = c.get("principal");
        container.workspaceAccess.authorize(
          principal,
          "fonts.read",
          organizationId,
        );
        const file = await container.fonts.download(c.req.valid("param").id);
        if (!file) return c.json({ error: "not_found" }, 404);
        container.workspaceAccess.recordAccess({
          principal,
          capability: "fonts.read",
          organizationId,
          resourceType: "font",
          resourceId: c.req.valid("param").id,
          outcome: "completed",
        });
        return fileResponse(file.filename, file.bytes, fontMimeType(file.filename));
      } catch (error) {
        return safeAccessError(c, error);
      }
    });

  const workspaceArchiveRoutes = new Hono<AppEnv>()
    .use("*", noStore)
    .use("*", session)
    .get("/", zValidator("query", OrganizationQuerySchema), (c) => {
      const { organizationId } = c.req.valid("query");
      container.workspaceAccess.authorize(
        c.get("principal"),
        "subtitles.read",
        organizationId,
      );
      return c.json(container.archives.listOrganization(organizationId));
    })
    .post("/", async (c) => {
      try {
        assertSessionMutation(c, container);
        const principal = c.get("principal");
        const form = await c.req.formData();
        const organizationId = formString(form, "organizationId", 128);
        const metadata = parseWorkspaceArchiveMetadata(form);
        const attribution = container.workspaceAccess.archiveAttribution(
          principal,
          organizationId,
        );
        const file = form.get("file");
        if (!(file instanceof File)) {
          throw new ArchiveLibraryError("Missing archive file", "invalid");
        }
        const archive = await container.archives.publishOwned(
          {
            filename: file.name,
            bytes: new Uint8Array(await file.arrayBuffer()),
            metadata: { ...metadata, sub_group: attribution.organizationName },
          },
          attribution,
        );
        container.workspaceAccess.recordAccess({
          principal,
          capability: "subtitles.write",
          organizationId,
          resourceType: "archive",
          resourceId: archive.id,
          outcome: "completed",
        });
        return c.json(archive, 201);
      } catch (error) {
        return archiveOrAccessError(c, error);
      }
    })
    .get("/:id/source", zValidator("param", IdParamSchema), async (c) => {
      try {
        const organizationId = requiredOrganizationHeader(c);
        const principal = c.get("principal");
        container.workspaceAccess.authorize(
          principal,
          "subtitles.read",
          organizationId,
        );
        const file = await container.archives.downloadOwned(
          c.req.valid("param").id,
          organizationId,
        );
        container.workspaceAccess.recordAccess({
          principal,
          capability: "subtitles.read",
          organizationId,
          resourceType: "archive",
          resourceId: c.req.valid("param").id,
          outcome: "completed",
        });
        return fileResponse(file.filename, file.bytes);
      } catch (error) {
        return archiveOrAccessError(c, error);
      }
    });

  const credentialRoutes = new Hono<AppEnv>()
    .use("*", noStore)
    .use("*", session)
    .get("/", (c) =>
      c.json({ data: container.workspaceAccess.listCredentials(c.get("principal")) }),
    )
    .get(
      "/activity",
      zValidator(
        "query",
        z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }),
      ),
      (c) =>
        c.json({
          data: container.workspaceAccess.credentialActivity(
            c.get("principal"),
            c.req.valid("query").limit,
          ),
        }),
    )
    .post(
      "/",
      zValidator("json", CreateProgrammaticCredentialSchema),
      (c) => {
        try {
          assertSessionMutation(c, container);
          return c.json(
            container.workspaceAccess.createCredential(
              c.get("principal"),
              c.req.valid("json"),
            ),
            201,
          );
        } catch (error) {
          return safeAccessError(c, error);
        }
      },
    )
    .delete("/:id", zValidator("param", IdParamSchema), (c) => {
      try {
        assertSessionMutation(c, container);
        return c.json({
          credential: container.workspaceAccess.revokeCredential(
            c.get("principal"),
            c.req.valid("param").id,
          ),
        });
      } catch (error) {
        return safeAccessError(c, error);
      }
    });

  const programmaticRoutes = new Hono<AppEnv>()
    .use("*", noStore)
    .use("*", credential)
    .get("/whoami", (c) => {
      const principal = c.get("principal");
      if (principal.kind !== "credential") {
        return c.json({ error: "invalid_credential" }, 401);
      }
      return c.json({
        role: "member" as const,
        organizationId: principal.organizationId,
        organizationName: principal.organizationName,
        scopes: principal.scopes,
      });
    })
    .get("/fonts", zValidator("query", FontListQuerySchema), (c) => {
      const principal = c.get("principal");
      container.workspaceAccess.authorize(
        principal,
        "fonts.read",
        credentialOrganization(principal),
      );
      return c.json(container.fonts.list(c.req.valid("query")));
    })
    .get("/fonts/:id/download", zValidator("param", IdParamSchema), async (c) => {
      try {
        const principal = c.get("principal");
        const organizationId = credentialOrganization(principal);
        container.workspaceAccess.authorize(principal, "fonts.read", organizationId);
        const file = await container.fonts.download(c.req.valid("param").id);
        if (!file) return c.json({ error: "not_found" }, 404);
        container.workspaceAccess.recordAccess({
          principal,
          capability: "fonts.read",
          organizationId,
          resourceType: "font",
          resourceId: c.req.valid("param").id,
          outcome: "completed",
        });
        return fileResponse(file.filename, file.bytes, fontMimeType(file.filename));
      } catch (error) {
        return safeAccessError(c, error);
      }
    })
    .post("/upload", async (c) => {
      try {
        const principal = c.get("principal");
        const form = await c.req.formData();
        const result = await container.submissions.submitAuthorized({
          principal,
          organizationId: credentialOrganization(principal),
          files: await uploadedFiles(
            form
              .getAll("file")
              .filter((entry): entry is File => entry instanceof File),
          ),
        });
        return c.json(result, uploadStatus(result));
      } catch (error) {
        return submissionOrAccessError(c, error);
      }
    })
    .get("/archives", (c) => {
      const principal = c.get("principal");
      const organizationId = credentialOrganization(principal);
      container.workspaceAccess.authorize(
        principal,
        "subtitles.read",
        organizationId,
      );
      return c.json(container.archives.listOrganization(organizationId));
    })
    .post("/archives", async (c) => {
      try {
        const principal = c.get("principal");
        const organizationId = credentialOrganization(principal);
        const form = await c.req.formData();
        const metadata = parseWorkspaceArchiveMetadata(form);
        const attribution = container.workspaceAccess.archiveAttribution(
          principal,
          organizationId,
        );
        const file = form.get("file");
        if (!(file instanceof File)) {
          throw new ArchiveLibraryError("Missing archive file", "invalid");
        }
        const archive = await container.archives.publishOwned(
          {
            filename: file.name,
            bytes: new Uint8Array(await file.arrayBuffer()),
            metadata: { ...metadata, sub_group: attribution.organizationName },
          },
          attribution,
        );
        container.workspaceAccess.recordAccess({
          principal,
          capability: "subtitles.write",
          organizationId,
          resourceType: "archive",
          resourceId: archive.id,
          outcome: "completed",
        });
        return c.json(archive, 201);
      } catch (error) {
        return archiveOrAccessError(c, error);
      }
    })
    .get("/archives/:id/source", zValidator("param", IdParamSchema), async (c) => {
      try {
        const principal = c.get("principal");
        const organizationId = credentialOrganization(principal);
        container.workspaceAccess.authorize(
          principal,
          "subtitles.read",
          organizationId,
        );
        const file = await container.archives.downloadOwned(
          c.req.valid("param").id,
          organizationId,
        );
        container.workspaceAccess.recordAccess({
          principal,
          capability: "subtitles.read",
          organizationId,
          resourceType: "archive",
          resourceId: c.req.valid("param").id,
          outcome: "completed",
        });
        return fileResponse(file.filename, file.bytes);
      } catch (error) {
        return archiveOrAccessError(c, error);
      }
    });

  const adminFontRoutes = new Hono<AppEnv>()
    .use("*", noStore)
    .use("*", administrator)
    .get("/", zValidator("query", FontListQuerySchema), (c) =>
      c.json(container.fonts.list(c.req.valid("query"))),
    )
    .post("/", async (c) => {
      try {
        assertSessionMutation(c, container);
        const form = await c.req.formData();
        const files = form
          .getAll("file")
          .filter((entry): entry is File => entry instanceof File);
        const targetDirectory =
          c.req.header("x-target-dir")?.trim() ||
          container.config.uploadTargetDirectory;
        const results = [];
        for (const file of files) {
          const uploaded = await container.fonts.upload(
            file.name,
            new Uint8Array(await file.arrayBuffer()),
            targetDirectory,
          );
          results.push({
            filename: file.name,
            id: uploaded.id ?? "",
            faces: uploaded.faces,
            error: uploaded.error ?? undefined,
          });
        }
        return c.json({ results });
      } catch (error) {
        return safeAccessError(c, error);
      }
    })
    .get("/stats", (c) =>
      c.json({ ...container.fonts.stats(), scheduler: container.getSchedulerStatus() }),
    )
    .get("/browse", zValidator("query", z.object({ prefix: z.string().default("") })), (c) =>
      c.json(container.fonts.browse(c.req.valid("query").prefix)),
    )
    .get("/keys", zValidator("query", FontKeysQuerySchema), (c) => {
      const query = c.req.valid("query");
      const all = container.fonts.listKeys(query.prefix);
      return c.json({
        keys: all.slice(query.cursor, query.cursor + query.limit),
        done: query.cursor + query.limit >= all.length,
      });
    })
    .post("/index", zValidator("json", IndexFontsRequestSchema), async (c) => {
      assertSessionMutation(c, container);
      const input = c.req.valid("json");
      return c.json(
        await container.fonts.indexKeys({
          prefix: input.prefix,
          keys: input.keys,
          batchSize: input.batch_size,
        }),
      );
    })
    .post("/scan", async (c) => {
      assertSessionMutation(c, container);
      return c.json(await container.fonts.scan());
    })
    .get("/duplicates", async (c) => {
      const groups = await container.fonts.findDuplicates();
      return c.json({ groups, total: groups.length });
    })
    .post("/deduplicate", async (c) => {
      assertSessionMutation(c, container);
      return c.json(await container.fonts.deduplicate());
    })
    .delete("/", zValidator("json", DeleteFontsRequestSchema), async (c) => {
      assertSessionMutation(c, container);
      return c.json({ deleted: await container.fonts.delete(c.req.valid("json").ids) });
    })
    .delete("/:id", zValidator("param", IdParamSchema), async (c) => {
      assertSessionMutation(c, container);
      const deleted = await container.fonts.delete([c.req.valid("param").id]);
      return deleted
        ? c.json({ deleted })
        : c.json({ error: "not_found" }, 404);
    })
    .get("/:id/download", zValidator("param", IdParamSchema), async (c) => {
      const file = await container.fonts.download(c.req.valid("param").id);
      return file
        ? fileResponse(file.filename, file.bytes, fontMimeType(file.filename))
        : c.json({ error: "not_found" }, 404);
    });

  const adminArchiveRoutes = new Hono<AppEnv>()
    .use("*", noStore)
    .use("*", administrator)
    .get("/pending", (c) => c.json(container.archives.listPending()))
    .post("/upload", async (c) => {
      try {
        assertSessionMutation(c, container);
        const { file, metadata } = await archiveForm(c, ArchiveMetadataSchema);
        return c.json(
          await container.archives.publish({
            filename: file.name,
            bytes: new Uint8Array(await file.arrayBuffer()),
            metadata,
          }),
          201,
        );
      } catch (error) {
        return archiveOrAccessError(c, error);
      }
    })
    .post("/:id/approve", zValidator("param", IdParamSchema), async (c) => {
      try {
        assertSessionMutation(c, container);
        return c.json(await container.archives.approve(c.req.valid("param").id));
      } catch (error) {
        return archiveOrAccessError(c, error);
      }
    })
    .post("/:id/reject", zValidator("param", IdParamSchema), async (c) => {
      try {
        assertSessionMutation(c, container);
        return c.json(await container.archives.reject(c.req.valid("param").id));
      } catch (error) {
        return archiveOrAccessError(c, error);
      }
    })
    .put(
      "/:id",
      zValidator("param", IdParamSchema),
      zValidator("json", ArchivePatchSchema),
      async (c) => {
        try {
          assertSessionMutation(c, container);
          return c.json(
            await container.archives.edit(
              c.req.valid("param").id,
              c.req.valid("json"),
            ),
          );
        } catch (error) {
          return archiveOrAccessError(c, error);
        }
      },
    )
    .delete("/:id", zValidator("param", IdParamSchema), async (c) => {
      try {
        assertSessionMutation(c, container);
        await container.archives.remove(c.req.valid("param").id);
        return c.json({ ok: true as const });
      } catch (error) {
        return archiveOrAccessError(c, error);
      }
    })
    .get("/:id/preview", zValidator("param", IdParamSchema), async (c) => {
      try {
        return c.json(await container.archives.preview(c.req.valid("param").id));
      } catch (error) {
        return archiveOrAccessError(c, error);
      }
    })
    .get("/:id/source", zValidator("param", IdParamSchema), async (c) => {
      try {
        const file = await container.archives.download(c.req.valid("param").id);
        return fileResponse(file.filename, file.bytes);
      } catch (error) {
        return archiveOrAccessError(c, error);
      }
    });

  const adminActivityRoutes = new Hono<AppEnv>()
    .use("*", noStore)
    .use("*", administrator)
    .get("/", zValidator("query", ProcessingLogQuerySchema), (c) =>
      c.json(container.activity.list(c.req.valid("query"))),
    )
    .get(
      "/missing-fonts",
      zValidator(
        "query",
        z.object({
          limit: z.coerce.number().int().min(1).max(100).default(50),
          show_resolved: z.enum(["true", "false"]).default("false"),
        }),
      ),
      (c) => {
        const query = c.req.valid("query");
        return c.json(
          container.activity.missingFonts(
            query.limit,
            query.show_resolved === "true",
          ),
        );
      },
    )
    .get("/stats", (c) => c.json(container.activity.stats()))
    .post(
      "/missing-fonts/resolve",
      zValidator("json", MissingFontMutationSchema),
      (c) => {
        assertSessionMutation(c, container);
        container.activity.resolve(c.req.valid("json").font_name);
        return c.json({ ok: true as const });
      },
    )
    .post(
      "/missing-fonts/unresolve",
      zValidator("json", MissingFontMutationSchema),
      (c) => {
        assertSessionMutation(c, container);
        container.activity.unresolve(c.req.valid("json").font_name);
        return c.json({ ok: true as const });
      },
    );

  const adminRoutes = new Hono<AppEnv>()
    .use("*", noStore)
    .use("*", administrator)
    .get("/credentials", (c) =>
      c.json({ data: container.workspaceAccess.listAllCredentials(c.get("principal")) }),
    )
    .delete("/credentials/:id", zValidator("param", IdParamSchema), (c) => {
      try {
        assertSessionMutation(c, container);
        return c.json({
          credential: container.workspaceAccess.revokeCredential(
            c.get("principal"),
            c.req.valid("param").id,
          ),
        });
      } catch (error) {
        return safeAccessError(c, error);
      }
    })
    .get("/receipts", zValidator("query", z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) })), (c) =>
      c.json({
        data: container.workspaceAccess.receipts(
          c.get("principal"),
          c.req.valid("query").limit,
        ),
      }),
    )
    .route("/fonts", adminFontRoutes)
    .route("/archives", adminArchiveRoutes)
    .route("/activity", adminActivityRoutes);

  const subsetRoutes = new Hono<AppEnv>().post("/", async (c) => {
    const startedAt = Date.now();
    const options = subsetOptionsFromHeaders(c);
    const contentType = c.req.header("content-type") ?? "";
    const files: Array<{ name: string; bytes: Uint8Array }> = [];
    if (contentType.includes("multipart/form-data")) {
      const form = await c.req.formData();
      for (const entry of form.getAll("file")) {
        if (entry instanceof File) {
          files.push({
            name: entry.name,
            bytes: new Uint8Array(await entry.arrayBuffer()),
          });
        }
      }
    } else {
      files.push({
        name: decodeHeader(c.req.header("x-filename")) || "subtitle.ass",
        bytes: new Uint8Array(await c.req.arrayBuffer()),
      });
    }
    if (!files.length) {
      return binarySubsetResponse(CODE.CLIENT_ERROR, ["No file provided"], null);
    }
    const clientIp = hashClientIp(c);
    const processOne = async (file: { name: string; bytes: Uint8Array }) => {
      const started = Date.now();
      const result = await container.subtitles.process({
        filename: file.name,
        bytes: file.bytes,
        options,
      });
      container.activity.record({
        filename: file.name,
        clientIp,
        code: result.code,
        messages: result.messages,
        missingFonts: missingFonts(result.messages),
        fontCount: 0,
        fileSize: file.bytes.byteLength,
        elapsedMs: Date.now() - started,
      });
      return result;
    };
    if (files.length === 1) {
      try {
        const result = await processOne(files[0]);
        return binarySubsetResponse(result.code, result.messages, result.data);
      } catch (error) {
        container.logger.error("[subset] processing failed", safeErrorClass(error));
        return binarySubsetResponse(CODE.SERVER_ERROR, ["Internal server error"], null);
      }
    }
    const results: Array<{
      filename: string;
      code: number;
      messages: string[];
      data: string | null;
    }> = [];
    for (let offset = 0; offset < files.length; offset += container.config.subsetConcurrency) {
      const chunk = files.slice(offset, offset + container.config.subsetConcurrency);
      const settled = await Promise.allSettled(chunk.map(processOne));
      settled.forEach((item, index) => {
        results.push(
          item.status === "fulfilled"
            ? {
                filename: chunk[index].name,
                code: item.value.code,
                messages: item.value.messages,
                data: item.value.data
                  ? Buffer.from(item.value.data).toString("base64")
                  : null,
              }
            : {
                filename: chunk[index].name,
                code: CODE.SERVER_ERROR,
                messages: ["Internal server error"],
                data: null,
              },
        );
      });
    }
    container.logger.info("[subset] batch completed", {
      count: files.length,
      durationMs: Date.now() - startedAt,
    });
    return c.json(
      { results },
      results.some((result) => result.code >= 400) ? 207 : 200,
    );
  });

  const publicArchiveRoutes = new Hono<AppEnv>()
    .get("/", (c) =>
      c.json(container.archives.listPublished(), 200, {
        "Cache-Control": "public, max-age=60",
      }),
    )
    .get("/:id/download", zValidator("param", IdParamSchema), (c) => {
      const archive = container.archives
        .listPublished()
        .find((item) => item.id === c.req.valid("param").id);
      return archive?.download_url
        ? c.redirect(archive.download_url, 302)
        : c.json({ error: "not_found" }, 404);
    })
    .post("/contribute", async (c) => {
      try {
        const { file, metadata } = await archiveForm(c, ArchiveMetadataSchema);
        const archive = await container.archives.contribute(
          {
            filename: file.name,
            bytes: new Uint8Array(await file.arrayBuffer()),
            metadata,
          },
          hashClientIp(c),
        );
        return c.json({
          id: archive.id,
          status: archive.status,
          message: "Submitted for review",
        }, 201);
      } catch (error) {
        return archiveOrAccessError(c, error);
      }
    });

  const publicUpload = new Hono<AppEnv>()
    .use("*", noStore)
    .get("/policy", (c) =>
      c.json({
        max_files: container.config.publicUploadMaxFiles,
        max_file_bytes: container.config.publicUploadMaxFileSize,
        max_batch_bytes: container.config.publicUploadMaxBatchSize,
        requests_per_minute: container.config.publicUploadRequestsPerMinute,
      }),
    )
    .post("/", async (c) => {
      const contentLength = Number(c.req.header("content-length") ?? 0);
      if (
        Number.isFinite(contentLength) &&
        contentLength > container.config.publicUploadMaxBatchSize + 1024 * 1024
      ) {
        return c.json({ error: "batch_too_large" }, 413);
      }
      const form = await c.req.formData();
      const files = form
        .getAll("file")
        .filter((entry): entry is File => entry instanceof File);
      if (files.length > container.config.publicUploadMaxFiles) {
        return c.json({ error: "too_many_files" }, 400);
      }
      try {
        const result = await container.submissions.submitPublic({
          files: await uploadedFiles(files),
          context: {
            clientIp: requestIp(c),
            userAgent: c.req.header("user-agent") ?? null,
          },
          rateLimitKey: hashClientIp(c),
        });
        return c.json(result, uploadStatus(result));
      } catch (error) {
        return submissionOrAccessError(c, error);
      }
    });

  const operatorRoutes = new Hono<AppEnv>()
    .use("*", noStore)
    .use("*", operator)
    .get("/health", (c) => {
      try {
        container.database.ping();
        return c.json({ status: "ok" as const, version: 3 as const });
      } catch {
        return c.json({ status: "error" as const, version: 3 as const }, 500);
      }
    });

  const api = new Hono<AppEnv>()
    .get("/health", (c) => {
      try {
        container.database.ping();
        return c.json({ status: "ok" as const, version: 3 as const }, 200, {
          "Cache-Control": "no-store",
        });
      } catch {
        return c.json({ status: "error" as const, version: 3 as const }, 500, {
          "Cache-Control": "no-store",
        });
      }
    })
    .route("/auth", authRoutes)
    .route("/workspace/fonts", workspaceFontRoutes)
    .route("/workspace/archives", workspaceArchiveRoutes)
    .route("/workspace/credentials", credentialRoutes)
    .route("/v1", programmaticRoutes)
    .route("/admin", adminRoutes)
    .route("/operator", operatorRoutes)
    .route("/subset", subsetRoutes)
    .route("/archives", publicArchiveRoutes)
    .route("/upload", publicUpload);

  const app = new Hono<AppEnv>()
    .use("*", async (c, next) => {
      const start = Date.now();
      await next();
      container.logger.debug("[http] request", {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Date.now() - start,
      });
    })
    .use(
      "*",
      cors({
        origin: container.config.corsOrigin,
        credentials: true,
        allowHeaders: [
          "Authorization",
          "Content-Type",
          "X-CSRF-Token",
          "X-Organization-ID",
          "X-Filename",
          "X-Fonts-Check",
          "X-Clear-Fonts",
          "X-Font-Name-Mode",
          "X-Font-Alias-Salt",
          "X-Srt-Format",
          "X-Srt-Style",
        ],
        allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        exposeHeaders: ["X-Code", "X-Message", "Content-Disposition"],
      }),
    )
    .use("*", compress())
    .route("/api", api);

  app.use("/assets/*", serveStatic({ root: "../web/dist" }));
  app.use("/*", serveStatic({ root: "../web/dist" }));
  app.get("*", async (c) => {
    if (c.req.path.startsWith("/api/")) {
      return c.json({ error: "not_found" }, 404);
    }
    const file = Bun.file(resolve(import.meta.dir, "../../web/dist/index.html"));
    return await file.exists()
      ? new Response(file, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, max-age=0, s-maxage=300",
          },
        })
      : c.text("Not found", 404);
  });
  app.onError((error, c) => {
    container.logger.error("[http] unhandled", {
      method: c.req.method,
      path: c.req.path,
      error: safeErrorClass(error),
    });
    return c.json({ error: "internal_error" }, 500);
  });
  return app;
}

export type AppType = ReturnType<typeof createApp>;

function sessionMiddleware(container: AppContainer): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (hasNonBrowserCredential(c)) {
      c.res = c.json({ error: "credential_surface_mismatch" }, 400);
      return;
    }
    try {
      const principal = await container.workspaceAccess.resolveSession(
        readSessionCookie(c.req.header("cookie"), container.config.environment),
      );
      c.set("principal", principal);
      await next();
    } catch (error) {
      c.res = safeAccessError(c, error);
    }
  };
}

const browserCredentialBoundary: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (hasNonBrowserCredential(c)) {
    c.res = c.json({ error: "credential_surface_mismatch" }, 400);
    return;
  }
  await next();
};

function hasNonBrowserCredential(c: Context<AppEnv>): boolean {
  return Boolean(
    c.req.header("authorization") ||
      c.req.header("x-api-key") ||
      c.req.header("x-upload-token") ||
      c.req.header("x-fontinass-operator-credential"),
  );
}

function administratorMiddleware(
  container: AppContainer,
): MiddlewareHandler<AppEnv> {
  const session = sessionMiddleware(container);
  return async (c, next) => {
    await session(c, async () => {
      try {
        container.workspaceAccess.authorize(c.get("principal"), "system.manage");
        await next();
      } catch (error) {
        c.res = safeAccessError(c, error);
      }
    });
  };
}

function credentialMiddleware(container: AppContainer): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (
      c.req.header("cookie") ||
      c.req.header("x-api-key") ||
      c.req.header("x-upload-token") ||
      c.req.header("x-fontinass-operator-credential")
    ) {
      c.res = c.json({ error: "credential_surface_mismatch" }, 400);
      return;
    }
    try {
      const plaintext = extractBearerCredential(c.req.header("authorization"));
      c.set("principal", await container.workspaceAccess.resolveCredential(plaintext));
      await next();
    } catch (error) {
      c.res = safeAccessError(c, error);
    }
  };
}

function operatorMiddleware(container: AppContainer): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (
      c.req.header("cookie") ||
      c.req.header("authorization") ||
      c.req.header("x-api-key") ||
      c.req.header("x-upload-token")
    ) {
      c.res = c.json({ error: "credential_surface_mismatch" }, 400);
      return;
    }
    if (
      !operatorCredentialMatches(
        container.config.operatorCredential,
        c.req.header("x-fontinass-operator-credential"),
      )
    ) {
      c.res = c.json({ error: "unauthorized" }, 401);
      return;
    }
    c.set("principal", container.workspaceAccess.operatorPrincipal());
    await next();
  };
}

function assertSessionMutation(c: Context<AppEnv>, container: AppContainer): void {
  if (!originMatches(c.req.header("origin"), container.config.publicOrigin)) {
    throw new WorkspaceAccessError("invalid_csrf");
  }
  container.workspaceAccess.assertCsrf(
    c.get("principal"),
    c.req.header("x-csrf-token") ?? null,
  );
}

function safeAccessError(c: Context<AppEnv>, error: unknown): Response {
  if (error instanceof WorkspaceAccessError) {
    const status =
      error.code === "unauthenticated" || error.code === "invalid_credential"
        ? 401
        : error.code === "not_found"
          ? 404
          : error.code === "quota_exceeded"
            ? 429
            : error.code === "recent_auth_required"
              ? 401
              : error.code === "access_denied" || error.code === "invalid_csrf"
                ? 403
                : 400;
    return c.json({ error: error.code }, status);
  }
  if (error instanceof EntitlementProviderError) {
    return c.json({ error: "entitlement_unavailable", retryable: true }, 503);
  }
  if (error instanceof OidcBffError) {
    return c.json({ error: error.code }, 400);
  }
  throw error;
}

function archiveOrAccessError(c: Context<AppEnv>, error: unknown): Response {
  if (error instanceof z.ZodError) {
    return c.json({ error: "invalid_metadata" }, 400);
  }
  if (error instanceof ArchiveLibraryError) {
    const status =
      error.code === "not_found"
        ? 404
        : error.code === "rate_limited"
          ? 429
          : error.code === "storage_unavailable"
            ? 503
            : 400;
    return c.json({ error: error.code }, status);
  }
  return safeAccessError(c, error);
}

function submissionOrAccessError(c: Context<AppEnv>, error: unknown): Response {
  if (error instanceof FontSubmissionError) {
    const status =
      error.code === "rate_limited"
        ? 429
        : error.code === "file_too_large" || error.code === "batch_too_large"
          ? 413
          : error.code === "invalid_token"
            ? 401
            : 400;
    return c.json({ error: error.code }, status);
  }
  return safeAccessError(c, error);
}

function credentialOrganization(principal: WorkspacePrincipal): string {
  if (principal.kind !== "credential") {
    throw new WorkspaceAccessError("invalid_credential");
  }
  return principal.organizationId;
}

function requiredOrganizationHeader(c: Context<AppEnv>): string {
  const value = c.req.header("x-organization-id")?.trim() ?? "";
  if (!value || value.length > 128) {
    throw new WorkspaceAccessError("organization_unavailable");
  }
  return value;
}

async function uploadedFiles(files: File[]) {
  return await Promise.all(
    files.map(async (file) => ({
      filename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    })),
  );
}

function uploadStatus(result: { summary: { accepted: number; duplicate: number; rejected: number } }): 200 | 400 | 500 {
  return result.summary.accepted || result.summary.duplicate
    ? 200
    : result.summary.rejected
      ? 400
      : 500;
}

function parseWorkspaceArchiveMetadata(form: FormData) {
  const raw = form.get("metadata");
  if (typeof raw !== "string" || raw.length > 8192) {
    throw new ArchiveLibraryError("Invalid archive metadata", "invalid");
  }
  return WorkspaceArchiveMetadataSchema.parse(JSON.parse(raw));
}

function formString(form: FormData, name: string, maxLength: number): string {
  const value = form.get(name);
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new WorkspaceAccessError("organization_unavailable");
  }
  return value.trim();
}

async function archiveForm(
  c: Context<AppEnv>,
  schema: typeof ArchiveMetadataSchema,
): Promise<{ file: File; metadata: ArchiveMetadata }> {
  const form = await c.req.formData();
  const file = form.get("file");
  const rawMetadata = form.get("metadata");
  if (!(file instanceof File) || typeof rawMetadata !== "string") {
    throw new ArchiveLibraryError("Missing file or metadata", "invalid");
  }
  if (rawMetadata.length > 8192) {
    throw new ArchiveLibraryError("Metadata is too large", "invalid");
  }
  return { file, metadata: schema.parse(JSON.parse(rawMetadata)) };
}

function fileResponse(
  filename: string,
  bytes: Uint8Array,
  contentType = "application/octet-stream",
): Response {
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": contentDisposition(filename),
      "Content-Length": String(bytes.byteLength),
      ...PRIVATE_NO_STORE_HEADERS,
    },
  });
}

function subsetOptionsFromHeaders(c: Context<AppEnv>): SubsetOptions {
  return SubsetOptionsSchema.parse({
    fontsCheck: c.req.header("x-fonts-check") === "1",
    clearFonts: c.req.header("x-clear-fonts") === "1",
    fontNameMode:
      c.req.header("x-font-name-mode") === "preserve" ? "preserve" : "alias",
    fontAliasSalt: decodeHeader(c.req.header("x-font-alias-salt")),
    srtFormat: decodeHeader(c.req.header("x-srt-format")),
    srtStyle: decodeHeader(c.req.header("x-srt-style")),
  });
}

function binarySubsetResponse(
  code: number,
  messages: string[],
  data: Uint8Array | null,
): Response {
  return new Response(data ? Buffer.from(data) : null, {
    status: code >= 500 ? 500 : 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Code": String(code),
      "X-Message": Buffer.from(JSON.stringify(messages)).toString("base64"),
    },
  });
}

function decodeHeader(value?: string): string {
  if (!value) return "";
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return value;
  }
}

function contentDisposition(filename: string): string {
  const ascii =
    filename
      .replace(/[^\x20-\x7E]/g, "_")
      .replace(/["\\]/g, "_")
      .trim() || "file";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function requestIp(c: Context<AppEnv>): string | null {
  return (
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    null
  );
}

function hashClientIp(c: Context<AppEnv>): string {
  const ip = requestIp(c) ?? "unknown";
  return ip === "unknown"
    ? ip
    : createHash("sha256").update(ip).digest("hex").slice(0, 12);
}

function missingFonts(messages: string[]): string[] {
  return messages
    .filter((message) => message.startsWith("Missing font:"))
    .map((message) =>
      message.replace(/^Missing font:\s*\[?|\]?$/g, ""),
    );
}

function safeErrorClass(error: unknown): { type: string } {
  return { type: error instanceof Error ? error.name : "UnknownError" };
}
