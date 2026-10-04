/** Repeatable HTTP workload. Use an isolated DB snapshot: requests write activity logs. */
import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

const base = process.argv[2] ?? "http://127.0.0.1:3310";
const directory = process.argv[3] ?? "/tmp/fontinass-performance";
const round = process.argv[4] ?? "1";
const adminKey = process.env.BENCHMARK_API_KEY ?? "benchmark-only";
await mkdir(directory, { recursive: true });

const samples = [
  { name: "latin", font: "Arial", text: "AV office café — € fi ffi", code: "200" },
  { name: "cjk", font: "Microsoft YaHei", text: "字幕字体子集化测试：你好，世界！日本語。", code: "200" },
  { name: "vertical", font: "@思源黑体", text: "「竖排」：中文、日本語。（测试）", code: "200" },
  { name: "arabic", font: "DejaVu Sans", text: "العربية السَّلَامُ عَلَيْكُمْ", code: "200" },
  { name: "missing-glyphs", font: "Microsoft YaHei", text: "字幕 한국어", code: "201" },
];
function subtitle(font: string, text: string, lines = 1): string {
  return `[Script Info]\nTitle: performance-v1\nScriptType: v4.00+\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, Bold, Italic\nStyle: Default,${font},20,0,0\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${Array.from({ length: lines }, () => `Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,${text}`).join("\n")}\n`;
}
const corpus = samples.map(sample => ({ ...sample, bytes: new TextEncoder().encode(subtitle(sample.font, sample.text)) }));
corpus.push({ name: "long-ass", font: "Arial", text: "1500 dialogue lines", code: "200", bytes: new TextEncoder().encode(subtitle("Arial", "AV office café — € fi ffi", 1500)) });
corpus.push({ name: "multi-font", font: "Arial", text: "3 fonts", code: "200", bytes: new TextEncoder().encode(subtitle("Arial", String.raw`Hello{\fnMicrosoft YaHei}你好世界{\fn思源黑体}日本語字幕`)) });

interface Observation { ms: number; status: number; code: string | null; bytes: number; name: string; sha256?: string }
function stats(values: number[]) {
  const sorted = [...values].sort((a,b) => a-b);
  const percentile = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0;
  return { count: values.length, median: percentile(0.5), p95: percentile(0.95), min: sorted[0] ?? 0, max: sorted.at(-1) ?? 0 };
}
const results: Array<Record<string, unknown>> = [];
async function measure(name: string, count: number, concurrency: number, task: (index: number) => Promise<Observation>, probe = false) {
  const rows: Observation[] = [];
  const healthMs: number[] = [];
  let next = 0, probing = false;
  const timer = probe ? setInterval(async () => {
    if (probing) return;
    probing = true;
    const start = performance.now();
    try { const response = await fetch(`${base}/api/health`); await response.arrayBuffer(); if (!response.ok) throw new Error("Health probe failed"); healthMs.push(performance.now() - start); }
    finally { probing = false; }
  }, 20) : null;
  const start = performance.now();
  try {
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (true) { const index = next++; if (index >= count) return; rows.push(await task(index)); }
    }));
  } finally { if (timer) clearInterval(timer); }
  const elapsedMs = performance.now() - start;
  while (probing) await Bun.sleep(1);
  const byCase = Object.fromEntries([...new Set(rows.map(r => r.name))].map(key => [key, stats(rows.filter(r => r.name === key).map(r => r.ms))]));
  const result = { name, concurrency, elapsedMs, requestsPerSecond: count / elapsedMs * 1000, latencyMs: stats(rows.map(r => r.ms)), healthMs: stats(healthMs), byCase, observations: rows };
  results.push(result);
  console.log(JSON.stringify({ name, rps: result.requestsPerSecond, latency: result.latencyMs, health: result.healthMs }));
}
async function subset(index: number, salt: string, sample = corpus[index % corpus.length]): Promise<Observation> {
  const start = performance.now();
  const response = await fetch(`${base}/api/subset`, { method: "POST", body: sample.bytes, headers: {
    "Content-Type": "application/octet-stream", "X-Filename": Buffer.from(`benchmark-${sample.name}.ass`).toString("base64"), "X-Font-Alias-Salt": Buffer.from(salt).toString("base64"),
  } });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const ms = performance.now() - start;
  const code = response.headers.get("x-code");
  if (!response.ok || code !== sample.code || bytes.length === 0) throw new Error(`${sample.name}: HTTP ${response.status}, code ${code}: ${Buffer.from(response.headers.get("x-message") ?? "", "base64")}`);
  return { ms, status: response.status, code, bytes: bytes.length, name: sample.name, sha256: createHash("sha256").update(bytes).digest("hex") };
}
async function get(path: string): Promise<Observation> {
  const start = performance.now();
  const response = await fetch(`${base}${path}`, { headers: { "X-API-Key": adminKey } });
  const bytes = await response.arrayBuffer();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return { ms: performance.now() - start, status: response.status, code: null, bytes: bytes.byteLength, name: path };
}
// One warm-up per case: disk page cache is warm for every variant, result cache is bypassed.
const warmup = [];
for (let index = 0; index < corpus.length; index++) warmup.push(await subset(index, `warmup-${round}-${index}`));
await measure("subset-uncached", 35, 1, index => subset(index, `cold-${round}-${index}`), true);
await measure("subset-concurrent", 42, 2, index => subset(index, `parallel-${round}-${index}`), true);
await subset(0, `cached-${round}`);
await measure("subset-cached", 300, 2, index => subset(index, `cached-${round}`, corpus[0]));
await measure("health", 500, 4, () => get("/api/health"));
await measure("font-list", 80, 4, () => get("/api/fonts?page=1&limit=50&search="));
await measure("archives", 80, 4, () => get("/api/archives"));
await measure("activity-stats", 40, 2, () => get("/api/activity/stats"));
await measure("font-stats", 20, 1, () => get("/api/fonts/stats"));
const report = { schema: 1, round, date: new Date().toISOString(), clientBun: Bun.version, warmup, corpusSha256: createHash("sha256").update(Buffer.concat(corpus.map(c => c.bytes))).digest("hex"), corpus: corpus.map(({ bytes, ...sample }) => ({ ...sample, bytes: bytes.length })), results };
await Bun.write(join(directory, `round-${round}.json`), JSON.stringify(report, null, 2));
