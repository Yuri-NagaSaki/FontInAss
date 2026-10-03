// Synthetic subtitles only. Runs against a live API; creates normal activity entries.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
const base = process.argv[2] ?? "http://127.0.0.1:3300";
const destination = process.argv[3] ?? "/tmp/fontinass-benchmark";
await mkdir(destination, { recursive: true });
const corpus = [
  { name: "latin", font: "Arial", text: "AV office café — € fi ffi" },
  { name: "cjk", font: "Microsoft YaHei", text: "字幕字体子集化测试：你好，世界！日本語。한국어。" },
  { name: "vertical", font: "@思源黑体", text: "「竖排」：中文、日本語。（测试）" },
  { name: "arabic", font: "DejaVu Sans", text: "العربية السَّلَامُ عَلَيْكُمْ" },
];
const rows = [];
const health: number[] = [];
let probeRunning = false;
const timer = setInterval(async () => {
  if (probeRunning) return;
  probeRunning = true;
  const start = performance.now();
  try { await (await fetch(`${base}/api/health`)).arrayBuffer(); health.push(performance.now() - start); }
  finally { probeRunning = false; }
}, 25);
try {
  for (const sample of corpus) {
    const subtitle = `[Script Info]\nTitle: audit-${crypto.randomUUID()}\nScriptType: v4.00+\nPlayResX: 1280\nPlayResY: 720\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${sample.font},40,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,20,20,20,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,${sample.text}\n`;
    const runs = [];
    for (let iteration = 0; iteration < 2; iteration++) {
      const started = performance.now();
      const response = await fetch(`${base}/api/subset`, { method: "POST", body: subtitle, headers: { "Content-Type": "application/octet-stream", "X-Filename": Buffer.from(`audit-${sample.name}.ass`).toString("base64") } });
      const bytes = new Uint8Array(await response.arrayBuffer());
      const messages = JSON.parse(Buffer.from(response.headers.get("x-message") ?? "W10=", "base64").toString());
      runs.push({ ms: Math.round((performance.now() - started) * 100) / 100, status: response.status, code: response.headers.get("x-code"), bytes: bytes.length, messages });
      if (iteration === 0) { await Bun.write(join(destination, `${sample.name}.input.ass`), subtitle); await Bun.write(join(destination, `${sample.name}.ass`), bytes); }
    }
    rows.push({ ...sample, runs });
  }
} finally { clearInterval(timer); }
while (probeRunning) await Bun.sleep(10);
const report = { timestamp: new Date().toISOString(), base, cases: rows, health: { count: health.length, maxMs: Math.round(Math.max(0, ...health) * 100) / 100 } };
await Bun.write(join(destination, "results.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
