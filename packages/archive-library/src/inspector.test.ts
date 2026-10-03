import { describe, expect, test } from "bun:test";
import { SystemArchiveInspector } from "./inspector.js";

async function zip(entries: Record<string, string>): Promise<Uint8Array> {
  const process = Bun.spawn(["python3", "-c", "import io,json,sys,zipfile; b=io.BytesIO(); z=zipfile.ZipFile(b,'w'); [z.writestr(k,v) for k,v in json.load(sys.stdin).items()]; z.close(); sys.stdout.buffer.write(b.getvalue())"], { stdin: new Blob([JSON.stringify(entries)]), stdout: "pipe", stderr: "pipe" });
  const bytes = new Uint8Array(await new Response(process.stdout).arrayBuffer());
  expect(await process.exited).toBe(0);
  return bytes;
}

describe("archive inspection", () => {
  test("lists valid subtitles once and preserves harmless dots in names", async () => {
    const result = await new SystemArchiveInspector().inspect("a.zip", await zip({ "episode..01.ass": "subtitle", "readme.txt": "note" }));
    expect(result.valid).toBe(true);
    expect(result.subtitleCount).toBe(1);
    expect(result.filenames.length).toBe(2);
  });
  for (const name of ["../bad.ass", "/tmp/bad.ass", "C:\\bad.ass", "dir/../../bad.ass", "bad.exe"]) {
    test(`rejects unsafe entry ${name}`, async () => {
      const result = await new SystemArchiveInspector().inspect("a.zip", await zip({ "good.ass": "good", [name]: "bad" }));
      expect(result.valid).toBe(false);
    });
  }
  test("rejects oversized uncompressed data and truncated archives", async () => {
    const bytes = await zip({ "good.ass": "1234567890" });
    expect((await new SystemArchiveInspector(5).inspect("a.zip", bytes)).valid).toBe(false);
    expect((await new SystemArchiveInspector().inspect("a.zip", bytes.slice(0, 20))).valid).toBe(false);
  });
});
