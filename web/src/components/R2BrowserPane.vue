<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { FolderOpen, RefreshCcw, KeyRound, AlertTriangle, Database } from "lucide-vue-next";
import { browseR2, indexR2Keys, listR2Keys } from "../api/client";
import type { BrowseFile } from "../api/client";
import KButton from "./KButton.vue";
import KSpinner from "./KSpinner.vue";
import KEmpty from "./KEmpty.vue";
import R2NodeRow from "./R2NodeRow.vue";
import { useIndexState } from "../composables/useIndexState";
import type { R2Node } from "../types";

const { t } = useI18n();

const emit = defineEmits<{
  (e: "changed"): void;
}>();

// ── State ─────────────────────────────────────────────────────────────────────
const r2Tree = ref<R2Node[]>([]);
const browserLoading = ref(false);
const browserError = ref<string | null>(null);
const isAuthError = computed(() => /unauthorized|401|403|forbidden/i.test(browserError.value ?? ""));

const { indexProgress, ensureProgress } = useIndexState();

// ── Browse helpers ────────────────────────────────────────────────────────────

const browsePrefix = async (prefix: string): Promise<{ folders: R2Node[]; files: R2Node[]; cursor: string | null; hasMore: boolean }> => {
  const data = await browseR2(prefix);
  const folders: R2Node[] = (data.folders ?? []).map((f: string) => ({
    prefix: f,
    name: f.replace(prefix, "").replace(/\/$/, "") || f,
    type: "folder" as const,
    loading: false,
    expanded: false,
    children: undefined,
  }));
  const files: R2Node[] = (data.files ?? []).map((f: BrowseFile) => ({
    prefix: f.key,
    name: f.name,
    type: "file" as const,
    size: f.size,
    indexed: f.indexed,
  }));
  return { folders, files, cursor: data.cursor, hasMore: !data.done };
};

const loadRoot = async () => {
  browserLoading.value = true;
  browserError.value = null;
  try {
    const { folders, files } = await browsePrefix("");
    r2Tree.value = [...folders, ...files];
  } catch (e) {
    browserError.value = String(e instanceof Error ? e.message : e);
  } finally {
    browserLoading.value = false;
  }
};

const toggleFolder = async (node: R2Node) => {
  if (node.type !== "folder") return;
  if (node.expanded && node.children !== undefined) {
    node.expanded = false;
    return;
  }
  node.loading = true;
  node.expanded = true;
  try {
    const { folders, files, cursor, hasMore } = await browsePrefix(node.prefix);
    node.children = [...folders, ...files];
    node.cursor = cursor;
    node.hasMore = hasMore;
    node.fileCount = files.length;
  } catch {
    toast.error(t("browseFailed"));
    node.expanded = false;
  } finally {
    node.loading = false;
  }
};

const loadMoreInFolder = async (node: R2Node) => {
  if (!node.cursor || node.loadingMore) return;
  node.loadingMore = true;
  try {
    const data = await browseR2(node.prefix, node.cursor);
    const moreFiles: R2Node[] = (data.files ?? []).map((f: BrowseFile) => ({
      prefix: f.key, name: f.name, type: "file" as const,
      size: f.size, indexed: f.indexed,
    }));
    const moreFolders: R2Node[] = (data.folders ?? []).map((f: string) => ({
      prefix: f,
      name: f.replace(node.prefix, "").replace(/\/$/, "") || f,
      type: "folder" as const,
      loading: false, expanded: false, children: undefined,
    }));
    node.children = [...(node.children ?? []), ...moreFolders, ...moreFiles];
    node.cursor = data.cursor;
    node.hasMore = !data.done;
  } finally {
    node.loadingMore = false;
  }
};

const indexSingleFile = async (node: R2Node) => {
  if (node.type !== "file" || node.indexed) return;
  try {
    await indexR2Keys([node.prefix]);
    node.indexed = true;
    emit("changed");
  } catch {
    toast.error(t("indexFailed"));
  }
};

const indexAllUnder = async (prefix: string) => {
  const prog = ensureProgress(prefix);
  if (prog.active) return;
  prog.active = true;
  prog.indexed = 0;
  prog.skipped = 0;
  prog.errors = 0;
  prog.total = 0;
  prog.phase = "listing";

  try {
    const allKeys: string[] = [];
    let cursor: string | undefined;
    do {
      const res = await listR2Keys(prefix, cursor, 5000);
      allKeys.push(...res.keys.map(k => k.key));
      prog.total = allKeys.length;
      cursor = res.nextCursor ?? undefined;
    } while (cursor);

    if (allKeys.length === 0) {
      prog.active = false;
      prog.phase = "done";
      prog.total = 0;
      return;
    }

    prog.phase = "indexing";
    prog.total = allKeys.length;

    const BATCH = 50;
    for (let i = 0; i < allKeys.length; i += BATCH) {
      const batch = allKeys.slice(i, i + BATCH);
      try {
        const res = await indexR2Keys(batch);
        prog.indexed += res.indexed;
        prog.skipped += res.skipped;
        prog.errors += (res.errors ?? []).length;
      } catch {
        prog.errors += batch.length;
      }
    }

    prog.phase = "done";
    emit("changed");
    loadRoot();
  } catch {
    toast.error(t("indexFailed"));
    prog.phase = "done";
  } finally {
    prog.active = false;
  }
};

// Expose for parent
defineExpose({ loadRoot });

onMounted(() => loadRoot());
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center gap-2">
      <span class="text-sm font-medium text-ink-700">{{ t('r2Browser') }}</span>
      <div class="flex-1" />
      <!-- Global progress indicator -->
      <span v-if="indexProgress['']?.active" class="text-xs text-ink-400 font-mono">
        {{ indexProgress[''].indexed }}/{{ indexProgress[''].total }}
      </span>
      <KButton
        variant="ghost"
        size="sm"
        :disabled="indexProgress['']?.active"
        @click="indexAllUnder('')"
      >
        <Database class="w-3.5 h-3.5" :class="indexProgress['']?.active && 'animate-pulse'" />
        {{ t('indexAll') }}
      </KButton>
      <KButton variant="ghost" size="sm" @click="loadRoot">
        <RefreshCcw class="w-3.5 h-3.5" :class="browserLoading && 'animate-spin-slow'" />
      </KButton>
    </div>

    <div v-if="browserLoading" class="flex justify-center py-12">
      <KSpinner />
    </div>

    <!-- Error state -->
    <div
      v-else-if="browserError"
      class="rounded-2xl border animate-fade-in overflow-hidden"
      :class="isAuthError ? 'border-amber-200 bg-amber-50/50' : 'border-rose-200 bg-rose-50/50'"
    >
      <div class="flex flex-col items-center gap-4 px-8 py-10 text-center">
        <div
          class="flex h-14 w-14 items-center justify-center rounded-2xl"
          :class="isAuthError ? 'bg-amber-100' : 'bg-rose-100'"
        >
          <component
            :is="isAuthError ? KeyRound : AlertTriangle"
            class="h-7 w-7"
            :class="isAuthError ? 'text-amber-500' : 'text-rose-400'"
          />
        </div>
        <div>
          <p class="font-display font-semibold text-ink-900 text-base mb-1.5">
            {{ isAuthError ? t('errAuthTitle') : t('browseFailed') }}
          </p>
          <p class="mx-auto max-w-sm text-sm leading-relaxed text-ink-400">
            {{ isAuthError ? t('errAuthDesc') : browserError }}
          </p>
        </div>
        <KButton variant="ghost" size="sm" @click="loadRoot">
          <RefreshCcw class="w-3.5 h-3.5" />
          {{ t('refresh') }}
        </KButton>
      </div>
    </div>

    <KEmpty v-else-if="r2Tree.length === 0" :title="t('r2Empty')" />
    <div v-else class="flex flex-col gap-1 font-mono text-sm">
      <R2NodeRow
        v-for="node in r2Tree"
        :key="node.prefix"
        :node="node"
        :depth="0"
        :index-progress="indexProgress"
        @toggle="toggleFolder"
        @load-more="loadMoreInFolder"
        @index-file="indexSingleFile"
        @index-all="indexAllUnder"
      />
    </div>
  </div>
</template>
