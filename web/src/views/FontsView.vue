<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import {
  FolderOpen, Trash2,
  RefreshCcw, Search, CheckCircle2, Loader2,
  KeyRound, Database, CloudUpload, AlertTriangle,
  Share2,
} from "lucide-vue-next";
import {
  listFonts, deleteFont, deleteFontsBatch,
  browseR2, indexR2Keys, listR2Keys,
  getApiKey, setApiKey,
} from "../api/client";
import type { FontItem, BrowseFile } from "../api/client";
import KButton from "../components/KButton.vue";
import KBadge from "../components/KBadge.vue";
import KSpinner from "../components/KSpinner.vue";
import KEmpty from "../components/KEmpty.vue";
import R2NodeRow from "../components/R2NodeRow.vue";
import SharingAdminPane from "../components/SharingAdminPane.vue";
import FontUploadPane from "../components/FontUploadPane.vue";
import IndexStatsPane from "../components/IndexStatsPane.vue";
import { useIndexState } from "../composables/useIndexState";
import { formatBytes } from "../lib/format";
import type { R2Node } from "../types";

const { t } = useI18n();

// ── API Key lock ──────────────────────────────────────────────────────────────
const apiKey = ref(getApiKey());
const hasKey = computed(() => !!apiKey.value.trim());
const lockKeyInput = ref("");
const unlockWithKey = () => {
  const k = lockKeyInput.value.trim();
  if (!k) return;
  setApiKey(k);
  apiKey.value = k;
  loadRoot();
  loadFontList();
};

// ── R2 Browser ────────────────────────────────────────────────────────────────
const r2Tree = ref<R2Node[]>([]);
const browserLoading = ref(false);
const browserError = ref<string | null>(null);
const isAuthError = computed(() => /unauthorized|401|403|forbidden/i.test(browserError.value ?? ""));

// Per-prefix indexing progress — module singleton (survives navigation)
const { indexProgress, ensureProgress } = useIndexState();

// Browse a prefix level and build nodes
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
    loadFontList();
  } catch (e) {
    toast.error(t("indexFailed"));
  }
};

// Index all fonts under a folder prefix using list-keys + batched index-folder
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
    // Phase 1: enumerate all keys under prefix
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

    // Phase 2: send in batches of 50 to index-folder
    const BATCH = 50;
    for (let i = 0; i < allKeys.length; i += BATCH) {
      const batch = allKeys.slice(i, i + BATCH);
      try {
        const res = await indexR2Keys(batch);
        prog.indexed += res.indexed;
        prog.skipped += res.skipped;
        prog.errors += (res.errors ?? []).length;
      } catch (e) {
        prog.errors += batch.length;
      }
    }

    prog.phase = "done";
    loadFontList();
    // Refresh tree to show indexed status
    loadRoot();
  } catch (e) {
    toast.error(t("indexFailed"));
    prog.phase = "done";
  } finally {
    prog.active = false;
  }
};

// ── Indexed Font List ─────────────────────────────────────────────────────────
const fonts = ref<FontItem[]>([]);
const fontTotal = ref(0);
const fontPage  = ref(1);
const fontLimit = 100;
const fontSearch = ref("");
const fontLoading = ref(false);
const fontAllLoaded = ref(false);
const selectedIds = reactive(new Set<string>());
const deleteNotice = ref("");
let deleteNoticeTimer = 0;
const showDeleteNotice = (msg: string) => {
  clearTimeout(deleteNoticeTimer);
  deleteNotice.value = msg;
  deleteNoticeTimer = window.setTimeout(() => { deleteNotice.value = ""; }, 2000);
};

// Sentinel for infinite scroll
const sentinel = ref<HTMLElement | null>(null);
let io: IntersectionObserver | null = null;

const loadFontList = async (reset = true) => {
  if (fontLoading.value) return;
  if (reset) { fontPage.value = 1; fontAllLoaded.value = false; fonts.value = []; selectedIds.clear(); }
  fontLoading.value = true;
  try {
    const res = await listFonts(fontPage.value, fontLimit, fontSearch.value);
    if (reset) {
      fonts.value = res.data;
    } else {
      fonts.value.push(...res.data);
    }
    fontTotal.value = res.total;
    fontAllLoaded.value = fonts.value.length >= res.total;
    fontPage.value++;
  } catch (e) {
    toast.error(String(e instanceof Error ? e.message : e));
  } finally {
    fontLoading.value = false;
  }
};

const loadNextPage = () => {
  if (!fontAllLoaded.value && !fontLoading.value) loadFontList(false);
};

// Set up IntersectionObserver for infinite scroll
const setupInfiniteScroll = () => {
  if (io) { io.disconnect(); io = null; }
  io = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) loadNextPage();
  }, { rootMargin: "200px" });
  if (sentinel.value) io.observe(sentinel.value);
};

watch(sentinel, (el) => {
  if (el) setupInfiniteScroll();
});

let searchTimer: ReturnType<typeof setTimeout>;
watch(fontSearch, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadFontList(true), 300);
});

const toggleSelect = (id: string) => {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
};

const deleteSelected = async () => {
  if (selectedIds.size === 0) return;
  const ids = [...selectedIds];
  try {
    await deleteFontsBatch(ids);
    showDeleteNotice(`×${ids.length} ${t("deleted")}`);
    loadFontList(true);
  } catch (e) {
    toast.error(String(e instanceof Error ? e.message : e));
  }
};

const deleteSingle = async (id: string) => {
  try {
    await deleteFont(id);
    showDeleteNotice(t("deleted"));
    loadFontList(true);
  } catch (e) {
    toast.error(String(e instanceof Error ? e.message : e));
  }
};

const styleLabel = (f: FontItem) => {
  if (f.bold && f.italic) return t("boldItalic");
  if (f.bold) return t("bold");
  if (f.italic) return t("italic");
  return t("regular");
};

// ── Tabs ──────────────────────────────────────────────────────────────────────
type Tab = "list" | "browser" | "upload" | "stats" | "sharing";
const activeTab = ref<Tab>("list");

onMounted(() => {
  if (hasKey.value) {
    loadRoot();
    loadFontList(true);
  }
});

onBeforeUnmount(() => {
  io?.disconnect();
  clearTimeout(searchTimer);
  clearTimeout(deleteNoticeTimer);
});
</script>

<template>
  <div>
  <!-- Lock screen — full-height centered with ambient sakura background -->
  <div v-if="!hasKey" class="relative flex min-h-[74vh] items-center justify-center overflow-hidden py-12">

    <!-- Ambient background blobs -->
    <div class="pointer-events-none absolute inset-0" aria-hidden="true">
      <div class="absolute -top-20 right-0 h-80 w-80 rounded-full bg-sakura-200/50 blur-3xl" />
      <div class="absolute -bottom-20 -left-10 h-72 w-72 rounded-full bg-sky-100/60 blur-3xl" />
      <div class="absolute left-1/2 top-1/2 h-64 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sakura-100/70 blur-3xl" />
    </div>

    <div class="relative z-10 w-full max-w-sm px-5">

      <!-- Icon -->
      <div class="mb-8 flex justify-center animate-fade-in">
        <div class="relative">
          <div class="absolute inset-0 scale-150 rounded-full bg-sakura-400/20 blur-xl" />
          <div class="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-sakura-400 to-sakura-600 shadow-[var(--shadow-xl)]">
            <KeyRound class="h-9 w-9 text-white" :stroke-width="1.5" />
          </div>
        </div>
      </div>

      <!-- Heading -->
      <div class="mb-6 text-center animate-fade-in" style="animation-delay:60ms">
        <h1 class="font-display text-[1.85rem] font-bold leading-tight tracking-tight text-ink-900">
          {{ t('lockTitle') }}
        </h1>
        <p class="mt-2 text-sm leading-relaxed text-ink-400">
          {{ t('lockDesc') }}
        </p>
      </div>

      <!-- Auth card -->
      <div class="card-raised flex flex-col gap-3.5 p-6 animate-fade-in" style="animation-delay:120ms">

        <!-- API key input -->
        <div class="flex flex-col gap-1.5">
          <span class="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-400 select-none">API Key</span>
          <div class="relative">
            <input
              v-model="lockKeyInput"
              type="password"
              :placeholder="t('apiKeyPlaceholder')"
              class="w-full h-11 rounded-xl border border-ink-200 bg-surface px-4 pr-10 font-mono text-sm text-ink-900 placeholder:text-ink-300 focus:border-sakura-400 focus:ring-2 focus:ring-sakura-400/20 outline-none transition-all duration-150"
              @keyup.enter="unlockWithKey"
            />
            <KeyRound class="pointer-events-none absolute right-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-300" />
          </div>
        </div>

        <!-- Submit -->
        <KButton variant="primary" size="lg" class="w-full" @click="unlockWithKey">
          {{ t('unlock') }}
        </KButton>

        <!-- Hint -->
        <p class="text-center text-[11px] leading-relaxed text-ink-300">
          {{ t('lockHint', { apiKey: 'API_KEY', envFile: '.env' }) }}
        </p>
      </div>

    </div>
  </div>

  <div v-else class="flex flex-col gap-5">
    <!-- ─── Tabs ─────────────────────────────────────────────────────────────── -->
    <div class="flex items-center gap-1 p-1 bg-ink-100/60 rounded-2xl w-fit">
      <button
        v-for="tab in [
          { id: 'list',    icon: Database,     label: t('indexedFonts') },
          { id: 'browser', icon: FolderOpen,   label: t('r2Browser')    },
          { id: 'upload',  icon: CloudUpload,  label: t('uploadFonts')  },
          { id: 'stats',   icon: CheckCircle2, label: t('indexStats')   },
          { id: 'sharing', icon: Share2,        label: t('sharingFontsTab') },
        ]"
        :key="tab.id"
        class="flex items-center gap-1.5 h-8 px-4 rounded-xl text-sm font-medium transition-all duration-150"
        :class="activeTab === tab.id ? 'bg-surface shadow-sm text-ink-900' : 'text-ink-500 hover:text-ink-700'"
        @click="activeTab = tab.id as Tab"
      >
        <component :is="tab.icon" class="w-3.5 h-3.5" />
        {{ tab.label }}
      </button>
    </div>

    <!-- ─── Tab: Indexed Fonts ─────────────────────────────────────────────── -->
    <div v-if="activeTab === 'list'" class="flex flex-col gap-4">
      <!-- Toolbar -->
      <div class="flex items-center gap-3 flex-wrap">
        <div class="relative flex-1 min-w-48">
          <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
          <input
            v-model="fontSearch"
            class="w-full h-9 pl-9 pr-3 rounded-xl border border-ink-200 text-sm text-ink-700 placeholder:text-ink-400 focus:border-sakura-400 focus:ring-2 focus:ring-sakura-400/20 outline-none transition-all bg-surface"
            :placeholder="t('searchFonts')"
          />
        </div>
        <span class="text-sm text-ink-400">{{ t('fontTotal', { n: fontTotal }) }}</span>
        <div class="flex items-center gap-2">
          <Transition name="fade">
            <span v-if="deleteNotice" class="flex items-center gap-1 text-xs font-medium text-mint-600 select-none">
              <CheckCircle2 class="w-3 h-3" />{{ deleteNotice }}
            </span>
          </Transition>
          <KButton v-if="selectedIds.size > 0" variant="danger" size="sm" @click="deleteSelected">
            <Trash2 class="w-3.5 h-3.5" />{{ selectedIds.size }} {{ t('selected') }}
          </KButton>
          <KButton variant="ghost" size="sm" @click="loadFontList(true)">
            <RefreshCcw class="w-3.5 h-3.5" />
          </KButton>
        </div>
      </div>

      <!-- Font list with infinite scroll -->
      <div class="flex flex-col gap-1.5">
        <KEmpty v-if="!fontLoading && fonts.length === 0" :title="t('noFontsIndexed')" :description="t('noFonts')" />

        <TransitionGroup name="list">
          <div
            v-for="font in fonts"
            :key="font.id"
            class="card flex items-center gap-3 px-4 py-3 hover:shadow-md transition-shadow cursor-pointer"
            style="content-visibility: auto; contain-intrinsic-size: 0 56px;"
            @click="toggleSelect(font.id)"
          >
            <div
              class="w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all"
              :class="selectedIds.has(font.id)
                ? 'bg-sakura-400 border-sakura-400'
                : 'border-ink-200 hover:border-sakura-300'"
            >
              <CheckCircle2 v-if="selectedIds.has(font.id)" class="w-3.5 h-3.5 text-white" />
            </div>

            <div class="flex-1 min-w-0">
              <p class="font-medium text-sm text-ink-900 truncate">{{ font.filename }}</p>
              <p class="text-xs text-ink-400 truncate">{{ font.names }}</p>
            </div>

            <div class="hidden sm:flex items-center gap-2">
              <KBadge variant="default">{{ styleLabel(font) }}</KBadge>
              <KBadge variant="default">{{ font.weight }}</KBadge>
              <span class="text-xs text-ink-400">{{ formatBytes(font.size) }}</span>
            </div>

            <button
              class="w-7 h-7 rounded-lg flex items-center justify-center text-ink-400 hover:text-rose-500 hover:bg-rose-50 transition-colors shrink-0"
              :aria-label="t('delete')"
              @click.stop="deleteSingle(font.id)"
            ><Trash2 class="w-3.5 h-3.5" /></button>
          </div>
        </TransitionGroup>

        <!-- Infinite scroll sentinel -->
        <div ref="sentinel" class="h-4 flex items-center justify-center">
          <Loader2 v-if="fontLoading && fonts.length > 0" class="w-4 h-4 text-sakura-400 animate-spin-slow" />
          <span v-else-if="fontAllLoaded && fonts.length > 0" class="text-xs text-ink-300">
            — {{ t('fontTotal', { n: fontTotal }) }} —
          </span>
        </div>
      </div>
    </div>

    <!-- ─── Tab: R2 Browser ────────────────────────────────────────────────── -->
    <div v-if="activeTab === 'browser'" class="flex flex-col gap-4">
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

      <!-- Error state: auth failure or generic network error -->
      <div
        v-else-if="browserError"
        class="rounded-2xl border animate-fade-in overflow-hidden"
        :class="isAuthError ? 'border-amber-200 bg-amber-50/50' : 'border-rose-200 bg-rose-50/50'"
      >
        <div class="flex flex-col items-center gap-4 px-8 py-10 text-center">
          <!-- Icon -->
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

          <!-- Message -->
          <div>
            <p class="font-display font-semibold text-ink-900 text-base mb-1.5">
              {{ isAuthError ? t('errAuthTitle') : t('browseFailed') }}
            </p>
            <p class="mx-auto max-w-sm text-sm leading-relaxed text-ink-400">
              {{ isAuthError ? t('errAuthDesc') : browserError }}
            </p>
          </div>

          <!-- Actions -->
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

    <!-- ─── Tab: Upload ───────────────────────────────────────────────────── -->
    <FontUploadPane v-if="activeTab === 'upload'" @uploaded="loadFontList(true)" />

    <!-- ─── Tab: Index Stats ───────────────────────────────────────────────── -->
    <IndexStatsPane v-if="activeTab === 'stats'" :index-progress="indexProgress" @changed="loadFontList(true)" />

    <!-- ─── Tab: Sharing Admin ─────────────────────────────────────────────── -->
    <SharingAdminPane v-if="activeTab === 'sharing'" />
  </div>
  </div>
</template>


<style scoped>
.list-enter-active { transition: all 0.2s cubic-bezier(0.25, 1, 0.5, 1); }
.list-leave-active { transition: all 0.15s ease-in; position: absolute; width: 100%; }
.list-enter-from { opacity: 0; transform: translateY(-4px); }
.list-leave-to   { opacity: 0; }
.list-move       { transition: transform 0.2s cubic-bezier(0.25, 1, 0.5, 1); }
</style>
