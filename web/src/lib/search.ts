/**
 * FlexSearch-based client-side search engine for subtitle archives.
 * Uses CJK charset for proper Chinese/Japanese character segmentation.
 */

import FlexSearch from "flexsearch";

export interface SearchableArchive {
  id: string;
  name_cn: string;
  sub_group: string;
  languages: string;
  season: string;
  letter: string;
}

let index: FlexSearch.Document<SearchableArchive, true> | null = null;
let allDocs: Map<string, SearchableArchive> = new Map();

/** Build (or rebuild) the search index from archive data. */
export function buildSearchIndex(archives: SearchableArchive[]): void {
  index = new FlexSearch.Document<SearchableArchive, true>({
    document: {
      id: "id",
      index: [
        { field: "name_cn", tokenize: "forward", resolution: 9 },
        { field: "sub_group", tokenize: "full" },
        { field: "languages", tokenize: "strict" },
      ],
      store: true,
    },
    charset: "cjk" as any,
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

  const results = index.search(query, { limit, enrich: true });
  const seen = new Set<string>();
  const ids: string[] = [];

  for (const field of results) {
    for (const item of (field as any).result) {
      const id = typeof item === "object" ? item.id : String(item);
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
