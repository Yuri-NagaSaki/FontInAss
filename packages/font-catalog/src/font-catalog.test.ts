import { describe, expect, test } from "bun:test";
import { FontCatalog, pickBest, type FontCatalogRepository, type FontFileStore, type FontInspector, type FontLookupRow } from "./index.js";

const rows: FontLookupRow[] = [
  { nameLower: "source han serif sc", fontIndex: 0, weight: 400, bold: false, italic: false, key: "regular.otf", size: 10_000_000 },
  { nameLower: "source han serif sc", fontIndex: 0, weight: 700, bold: true, italic: false, key: "bold.otf", size: 11_000_000 },
];
const repository = {
  lookupByNames: (names: string[]) => rows.filter((row) => names.includes(row.nameLower)),
  lookupByLooseNames: () => [], findExistingKeys: () => new Set<string>(), insertFile: () => {}, replaceFaces: () => {},
  listBrokenFiles: () => [], listFileEntries: () => [], countFiles: () => 0, listFiles: ({ page, limit }: { page: number; limit: number }) => ({ total: 0, page, limit, data: [] }),
  countByTopFolder: () => [], findById: () => null, findByKey: () => null, findBySha256: () => null, setSha256: () => {}, deleteByIds: () => [],
} satisfies FontCatalogRepository;
const files = { ensureReady: () => {}, get: async () => null, put: async () => {}, delete: async () => {}, exists: () => false, browse: () => ({ folders: [], files: [] }), list: () => [] } satisfies FontFileStore;
const inspector = { inspect: () => [], validate: () => ({ valid: true }) } satisfies FontInspector;
const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

describe("FontCatalog.match", () => {
  test("selects weight-aware exact matches", () => {
    const catalog = new FontCatalog(repository, files, inspector, logger);
    const result = catalog.match([{ key: "font", nameLower: "source han serif sc", targetWeight: 700, targetItalic: false }]);
    expect(result.get("font")?.key).toBe("bold.otf");
  });

  test("strips weight suffixes before matching", () => {
    const catalog = new FontCatalog(repository, files, inspector, logger);
    const result = catalog.match([{ key: "font", nameLower: "source han serif sc bold", targetWeight: 400, targetItalic: false }]);
    expect(result.get("font")?.key).toBe("bold.otf");
  });
});

describe("pickBest", () => {
  test("prefers larger file when weight and style match", () => {
    const variants: FontLookupRow[] = [
      { nameLower: "方正粗圆_gbk", fontIndex: 0, weight: 400, bold: false, italic: false, key: "stub.ttf", size: 3296 },
      { nameLower: "方正粗圆_gbk", fontIndex: 0, weight: 400, bold: false, italic: false, key: "full.ttf", size: 9_720_284 },
      { nameLower: "方正粗圆_gbk", fontIndex: 0, weight: 400, bold: false, italic: false, key: "also-full.ttf", size: 8_317_544 },
    ];
    expect(pickBest(variants, 400, false).key).toBe("full.ttf");
  });

  test("still prefers better weight fit over a larger wrong-weight file", () => {
    const variants: FontLookupRow[] = [
      { nameLower: "source han", fontIndex: 0, weight: 400, bold: false, italic: false, key: "regular.otf", size: 50_000_000 },
      { nameLower: "source han", fontIndex: 0, weight: 700, bold: true, italic: false, key: "bold.otf", size: 1_000_000 },
    ];
    expect(pickBest(variants, 700, false).key).toBe("bold.otf");
  });
});
