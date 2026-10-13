import type { MiddlewareHandler } from "hono";
import { readRequestBody, RequestBodyError } from "./request-body.js";

interface AdmissionOptions {
  bodyTimeoutMs?: number;
  logger?: { warn(message: string): void };
}

/** Acquire before reading bodies: simultaneous requests cannot multiply the budget. */
export function admission(limit: number, maxBodyBytes: (contentType: string) => number, options: AdmissionOptions = {}): MiddlewareHandler {
  const active = new Map<symbol, number>();
  return async (c, next) => {
    const startedAt = Date.now();
    if (active.size >= limit) {
      const oldestMs = startedAt - Math.min(...active.values());
      options.logger?.warn(`[admission] ${c.req.method} ${c.req.path} busy active=${active.size}/${limit} oldest_ms=${oldestMs}`);
      return c.json({ error: "Server is busy; retry shortly" }, 503, { "Retry-After": "2", "X-Code": "503" });
    }
    const id = Symbol();
    active.set(id, startedAt);
    try {
      try {
        c.req.raw = await readRequestBody(c.req.raw, maxBodyBytes(c.req.header("content-type") ?? ""), options.bodyTimeoutMs);
      } catch (error) {
        if (!(error instanceof RequestBodyError)) throw error;
        options.logger?.warn(`[admission] ${c.req.method} ${c.req.path} status=${error.status} elapsed_ms=${Date.now() - startedAt} ${error.message} body=${JSON.stringify(error.details)}`);
        return c.json({ error: error.message }, error.status, { "X-Code": "400", "X-Message": Buffer.from(JSON.stringify([error.message])).toString("base64") });
      }
      // Keep the slot until processing finishes; a timeout must never release a
      // running font write or subset job that continues in the background.
      await next();
    } finally {
      active.delete(id);
    }
  };
}
