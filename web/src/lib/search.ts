/**
 * FlexSearch-based client-side search engine for subtitle archives.
 * FlexSearch is dynamically imported on first use to avoid loading ~60KB
 * for users who never search.
 */

import type { Document as FlexDocument, EnrichedDocumentSearchResults } from "flexsearch";

export interface SearchableArchive extends Record<string, string> {
  id: string;
  name_cn: string;
  sub_group: string;
  languages: string;
  season: string;
  letter: string;
}

let index: FlexDocument<SearchableArchive> | null = null;
let pendingDocs: SearchableArchive[] | null = null;
let buildPromise: Promise<void> | null = null;

async function ensureIndex(): Promise<void> {
  if (index || !pendingDocs) return;
  if (buildPromise) return buildPromise;

  buildPromise = (async () => {
    const FlexSearch = (await import("flexsearch")).default;
    const docs = pendingDocs!;
    pendingDocs = null;
    const idx = new FlexSearch.Document<SearchableArchive>({
      document: {
        id: "id",
        index: [
          { field: "name_cn", tokenize: "forward", resolution: 9 },
          { field: "sub_group", tokenize: "full" },
          { field: "languages", tokenize: "strict" },
        ],
        store: true,
      },
      encoder: FlexSearch.Charset.CJK,
    });
    for (const a of docs) idx.add(a);
    index = idx;
  })();

  return buildPromise;
}

/** Queue archives to be indexed lazily on first search. */
export function buildSearchIndex(archives: SearchableArchive[]): void {
  index = null;
  buildPromise = null;
  pendingDocs = archives;

  // Warm the index during browser idle time so the first search feels instant.
  const warm = () => { void ensureIndex(); };
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(warm, { timeout: 2000 });
  } else {
    setTimeout(warm, 800);
  }
}

/** Search archives by query string. Returns matched archive IDs. */
export async function searchArchives(query: string, limit = 50): Promise<string[]> {
  if (!query.trim()) return [];
  await ensureIndex();
  if (!index) return [];

  const results = index.search(query, { limit, enrich: true }) as EnrichedDocumentSearchResults<SearchableArchive>;
  const seen = new Set<string>();
  const ids: string[] = [];

  for (const field of results) {
    for (const item of field.result) {
      const id = String(item.id);
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }

  return ids;
}

/** Clear the search index. */
export function clearSearchIndex(): void {
  index = null;
  pendingDocs = null;
  buildPromise = null;
}
