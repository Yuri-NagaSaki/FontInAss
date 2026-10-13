import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { admission } from "./admission.js";

describe("request admission lifecycle", () => {
  test("cancels a stalled upload and releases its slot even if stream cancellation hangs", async () => {
    let cancelled = false;
    let handled = 0;
    const warnings: string[] = [];
    const app = new Hono().post("/", admission(1, () => 32, {
      bodyTimeoutMs: 20, logger: { warn: message => warnings.push(message) },
    }), async c => { handled++; return c.text(await c.req.text()); });
    const stalled = new ReadableStream<Uint8Array>({
      cancel() { cancelled = true; return new Promise(() => {}); },
    });
    const response = await app.request("/", { method: "POST", body: stalled });
    expect(response.status).toBe(408);
    expect(cancelled).toBe(true);
    expect(handled).toBe(0);
    expect(warnings.some(message => message.includes("status=408"))).toBe(true);
    expect(warnings[0]).toContain('"reason":"timeout"');
    expect(warnings[0]).toContain('"receivedBytes":0');
    expect(await (await app.request("/", { method: "POST", body: "recovered" })).text()).toBe("recovered");
  });

  test("an aborted upload never enters processing and the next request succeeds", async () => {
    let handled = 0;
    let started!: () => void;
    const reading = new Promise<void>(resolve => { started = resolve; });
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({ pull() { started(); } }, { highWaterMark: 0 });
    const app = new Hono().post("/", admission(1, () => 32), c => { handled++; return c.text("ok"); });
    const pending = app.request("/", { method: "POST", body, signal: controller.signal });
    await reading;
    expect((await app.request("/", { method: "POST", body: "busy" })).status).toBe(503);
    controller.abort();
    expect((await pending).status).toBe(400);
    expect(handled).toBe(0);
    expect((await app.request("/", { method: "POST", body: "ok" })).status).toBe(200);
  });

  test.each([undefined, "1"])("checks actual bytes when Content-Length is %s", async contentLength => {
    let handled = false;
    let cancelled = false;
    const app = new Hono().post("/", admission(1, () => 8), c => { handled = true; return c.text("ok"); });
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(9)); },
      cancel() { cancelled = true; },
    });
    const response = await app.request("/", {
      method: "POST", body, headers: contentLength ? { "Content-Length": contentLength } : {},
    });
    expect(response.status).toBe(413);
    expect(response.headers.get("X-Code")).toBe("400");
    expect(cancelled).toBe(true);
    expect(handled).toBe(false);
    expect((await app.request("/", { method: "POST", body: "ok" })).status).toBe(200);
  });

  test("rejects a declared oversized body before reading it", async () => {
    let read = false;
    const warnings: string[] = [];
    const body = new ReadableStream<Uint8Array>({ pull() { read = true; } }, { highWaterMark: 0 });
    const app = new Hono().post("/", admission(1, () => 8, { logger: { warn: message => warnings.push(message) } }), c => c.text("ok"));
    const response = await app.request("/", { method: "POST", body, headers: { "Content-Length": "9" } });
    expect(response.status).toBe(413);
    const message = "Request exceeds the size limit (size 9 bytes; limit 8 bytes)";
    expect(await response.json()).toEqual({ error: message });
    expect(JSON.parse(Buffer.from(response.headers.get("X-Message")!, "base64").toString())).toEqual([message]);
    expect(warnings[0]).toContain('"receivedBytes":0,"declaredBytes":9,"limitBytes":8');
    expect(read).toBe(false);
  });

  test("logs partial body progress when the input stream fails and releases its slot", async () => {
    let handled = 0;
    let sent = false;
    const warnings: string[] = [];
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) throw new Error("transport failure");
        sent = true;
        controller.enqueue(new Uint8Array(4));
      },
    }, { highWaterMark: 0 });
    const app = new Hono().post("/", admission(1, () => 32, {
      logger: { warn: message => warnings.push(message) },
    }), c => { handled++; return c.text("ok"); });
    const response = await app.request("/", { method: "POST", body, headers: { "Content-Length": "16" } });
    expect(response.status).toBe(400);
    expect(handled).toBe(0);
    expect(warnings[0]).toContain('"reason":"stream_error"');
    expect(warnings[0]).toContain('"receivedBytes":4,"declaredBytes":16,"limitBytes":32');
    expect((await app.request("/", { method: "POST", body: "ok" })).status).toBe(200);
  });

  test("keeps a processing slot after the body deadline and releases it on handler failure", async () => {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const processing = new Promise<void>(resolve => { release = resolve; });
    const warnings: string[] = [];
    const app = new Hono().post("/", admission(1, () => 32, {
      bodyTimeoutMs: 10, logger: { warn: message => warnings.push(message) },
    }), async c => {
      if (await c.req.text() === "first") { entered(); await processing; throw new Error("processing failed"); }
      return c.text("ok");
    }).onError((_error, c) => c.text("failed", 500));
    const first = app.request("/", { method: "POST", body: "first" });
    try {
      await started;
      await Bun.sleep(25);
      const busy = await app.request("/", { method: "POST", body: "second" });
      expect(busy.status).toBe(503);
      expect(busy.headers.get("Retry-After")).toBe("2");
      expect(warnings.some(message => message.includes("active=1/1") && message.includes("oldest_ms="))).toBe(true);
    } finally { release(); }
    expect((await first).status).toBe(500);
    expect((await app.request("/", { method: "POST", body: "third" })).status).toBe(200);
  });
});
