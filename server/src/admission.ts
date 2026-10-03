import type { MiddlewareHandler } from "hono";

/** Acquire before reading bodies: simultaneous requests cannot multiply the budget. */
export function admission(limit: number, maxBodyBytes: (contentType: string) => number): MiddlewareHandler {
  let active = 0;
  return async (c, next) => {
    if (active >= limit) return c.json({ error: "Server is busy; retry shortly" }, 503, { "Retry-After": "2", "X-Code": "503" });
    const maximum = maxBodyBytes(c.req.header("content-type") ?? "");
    const length = Number(c.req.header("content-length"));
    if (Number.isFinite(length) && length > maximum) return c.json({ error: "Request exceeds the size limit" }, 413, { "X-Code": "400", "X-Message": Buffer.from(JSON.stringify(["Request exceeds the size limit"])).toString("base64") });
    active++;
    try { await next(); } finally { active--; }
  };
}
