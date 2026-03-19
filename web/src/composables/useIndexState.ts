/**
 * Module-level singleton for Index All progress state.
 * Lives outside any component lifecycle — survives page navigation.
 */
import { reactive, ref } from "vue";

export interface IndexProgress {
  active: boolean;
  indexed: number;
  skipped: number;
  errors: number;
  total: number;      // 0 = unknown until listing completes
  phase: "listing" | "indexing" | "done";
}

// ─── Singleton state (module-level) ──────────────────────────────────────────
const _indexProgress = reactive<Record<string, IndexProgress>>({});
const _globalIndexActive = ref(false);

export function useIndexState() {
  const ensureProgress = (prefix: string): IndexProgress => {
    if (!_indexProgress[prefix]) {
      _indexProgress[prefix] = { active: false, indexed: 0, skipped: 0, errors: 0, total: 0, phase: "done" };
    }
    return _indexProgress[prefix];
  };

  const resetProgress = (prefix: string) => {
    _indexProgress[prefix] = { active: false, indexed: 0, skipped: 0, errors: 0, total: 0, phase: "done" };
  };

  const setGlobalActive = (v: boolean) => { _globalIndexActive.value = v; };

  return {
    indexProgress: _indexProgress,
    globalIndexActive: _globalIndexActive,
    ensureProgress,
    resetProgress,
    setGlobalActive,
  };
}
