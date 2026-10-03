import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsFontFileStore } from "./index.js";

test("font store atomically replaces files and rejects symlink escapes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fontinass-storage-"));
  const store = new FsFontFileStore(join(dir, "fonts"));
  try {
    store.ensureReady();
    await store.put("nested/font.ttf", new Uint8Array([1,2]));
    await store.put("nested/font.ttf", new Uint8Array([3]));
    expect([...(await store.get("nested/font.ttf"))!]).toEqual([3]);
    await writeFile(join(dir,"outside.ttf"), "outside");
    await symlink(dir, join(dir,"fonts","escape"));
    expect(await store.get("escape/outside.ttf")).toBeNull();
    await expect(store.put("escape/outside.ttf", new Uint8Array([0]))).rejects.toThrow();
    expect((await readFile(join(dir,"outside.ttf"))).toString()).toBe("outside");
    await expect(store.put("../outside.ttf", new Uint8Array([0]))).rejects.toThrow();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
