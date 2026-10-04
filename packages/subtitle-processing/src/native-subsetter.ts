/// <reference path="./assets.d.ts" />
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import workerSource from "./subset-worker.py" with { type: "text" };
import { NativeWorkerPool } from "./native-worker-pool.js";
import { uuencode } from "./uuencode.js";

export interface FontSubsetResult { encoded: string; missingGlyphs: string; error: string | null }
export interface FontSubsetVariant {
  faceIndex: number;
  fontName: string;
  outputName: string;
  postScriptName: string;
  attachmentName: string;
  unicodes: Set<number>;
}
interface WorkerResult { path?: string; extension?: string; missing?: number[]; error?: string }

export type FontInput = Uint8Array | { path: string };
export class NativeFontSubsetter {
  private readonly pool: NativeWorkerPool;
  constructor(concurrency = 2) {
    this.pool = new NativeWorkerPool(["python3", "-u", "-c", workerSource], { concurrency });
  }
  close(): void { this.pool.close(); }

  async subset(input: FontInput, variants: FontSubsetVariant[]): Promise<FontSubsetResult[]> {
    const directory = await mkdtemp(join(tmpdir(), "fontinass-subset-"));
    try {
      const font = input instanceof Uint8Array ? join(directory, "source.font") : input.path;
      if (input instanceof Uint8Array) await writeFile(font, input);
      const request = { font, directory, variants: variants.map(v => ({ ...v, alias: v.outputName !== v.fontName, unicodes: [...v.unicodes] })) };
      const results = await this.pool.run(request) as WorkerResult[];
      if (results.length !== variants.length) throw new Error("Font worker returned an incomplete result");
      let totalBytes = 0;
      for (const result of results) {
        if (result.path) totalBytes += (await stat(result.path)).size;
      }
      if (totalBytes > 32 * 1024 * 1024) throw new Error("Generated font subsets exceed the 32 MiB budget");
      return await Promise.all(results.map(async (result, index) => {
        if (result.error || !result.path) return failed(variants[index].fontName, result.error ?? "No output");
        const subset = await readFile(result.path);
        const safeName = variants[index].attachmentName.replace(/[\x00-\x1f\x7f:/\\]/g, "_");
        const missingGlyphs = (result.missing ?? []).filter(cp => cp > 0x20 && !(cp >= 0x7f && cp <= 0x9f))
          .map(cp => String.fromCodePoint(cp)).filter(char => !/\p{Default_Ignorable_Code_Point}/u.test(char)).join("");
        return { encoded: `fontname:${safeName}.${result.extension}\n${uuencode(subset)}\n`, missingGlyphs, error: null };
      }));
    } catch (error) {
      return variants.map(v => failed(v.fontName, error instanceof Error ? error.message : String(error)));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

// Standalone callers own no worker lifecycle; the server shares one explicit instance.
export async function subsetFontVariants(input: FontInput, variants: FontSubsetVariant[]): Promise<FontSubsetResult[]> {
  const subsetter = new NativeFontSubsetter(1);
  try { return await subsetter.subset(input, variants); } finally { subsetter.close(); }
}

function failed(name: string, message: string): FontSubsetResult {
  return { encoded: "", missingGlyphs: "", error: `Subsetting error [${name}]: ${message}` };
}
