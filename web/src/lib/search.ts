/**
 * FlexSearch-based client-side search engine for subtitle archives.
 * Uses CJK charset for proper Chinese/Japanese character segmentation.
 */

import FlexSearch, { type Document as FlexDocument, type EnrichedDocumentSearchResults } from "flexsearch";

export interface SearchableArchive extends Record<string, string> {
  id: string;
  name_cn: string;
  sub_group: string;
  languages: string;
  season: string;
  letter: string;
}

let index: FlexDocument<SearchableArchive> | null = null;
let allDocs: Map<string, SearchableArchive> = new Map();

/** Build (or rebuild) the search index from archive data. */
export function buildSearchIndex(archives: SearchableArchive[]): void {
  index = new FlexSearch.Document<SearchableArchive>({
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

  allDocs.clear();
  for (const a of archives) {
    index.add(a);
    allDocs.set(a.id, a);
  }
}

/** Search archives by query string. Returns matched archive IDs. */
export function searchArchives(query: string, limit = 50): string[] {
  if (!index || !query.trim()) return [];

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
  allDocs.clear();
}
