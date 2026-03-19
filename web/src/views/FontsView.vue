<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import {
  FolderOpen, FileText, Upload, Trash2,
  RefreshCcw, Search, CheckCircle2, Loader2,
  KeyRound, Database, CloudUpload, AlertTriangle, X,
} from "lucide-vue-next";
import {
  listFonts, uploadFonts, deleteFont, deleteFontsBatch,
  browseR2, indexR2Keys, listR2Keys, getFontStats, scanLocalFonts,
  getApiKey, setApiKey,
} from "../api/client";
import type { FontItem, BrowseFile, FontStats, ScanLocalResult } from "../api/client";
import KButton from "../components/KButton.vue";
import KInput from "../components/KInput.vue";
import KBadge from "../components/KBadge.vue";
import KSpinner from "../components/KSpinner.vue";
import KEmpty from "../components/KEmpty.vue";
import R2NodeRow from "../components/R2NodeRow.vue";
import { useIndexState } from "../composables/useIndexState";

const { t, locale } = useI18n();

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
  loadStats();
};

// ── R2 Browser ────────────────────────────────────────────────────────────────
interface R2Node {
  prefix: string;   // Full prefix path
  name: string;     // Display name (last segment)
  type: "folder" | "file";
  size?: number;
  indexed?: boolean;
  loading?: boolean;
  expanded?: boolean;
  children?: R2Node[];
  cursor?: string | null;     // For pagination inside this folder
  hasMore?: boolean;
  loadingMore?: boolean;
  fileCount?: number;         // Known file count from this level
}

const r2Tree = ref<R2Node[]>([]);
const browserLoading = ref(false);

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
  try {
    const { folders, files } = await browsePrefix("");
    r2Tree.value = [...folders, ...files];
  } catch (e) {
    toast.error(t("browseFailed"));
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
      const res = await listR2Keys(prefix, cursor, 500);
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
    loadStats();
    // Refresh tree to show indexed status
    loadRoot();
  } catch (e) {
    toast.error(t("indexFailed"));
    prog.phase = "done";
  } finally {
    prog.active = false;
  }
};

const formatBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n/1024).toFixed(1)} KB` : `${(n/1048576).toFixed(2)} MB`;

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

// ── Upload ─────────────────────────────────────────────────────────────────────
const DEFAULT_UPLOAD_DIR = "CatCat-Fonts/";
const uploadDir       = ref(DEFAULT_UPLOAD_DIR);
const uploadQueue     = ref<{ file: File; status: "pending" | "uploading" | "ok" | "error"; msg?: string }[]>([]);
const uploadDragActive = ref(false);
let   uploadDragCounter = 0;
const uploadRunning   = ref(false);
const uploadSummary   = ref<{ ok: number; fail: number } | null>(null);
const dropErrorMsg    = ref("");
let   dropErrorTimer  = 0;

const FONT_EXTS = new Set(["ttf", "otf", "ttc", "otc"]);
const isFont = (f: File) => FONT_EXTS.has(f.name.split(".").pop()?.toLowerCase() ?? "");

const addToQueue = (files: FileList | File[]) => {
  const valid = Array.from(files).filter(isFont);
  if (!valid.length) {
    clearTimeout(dropErrorTimer);
    dropErrorMsg.value = t("noFontFiles");
    dropErrorTimer = window.setTimeout(() => { dropErrorMsg.value = ""; }, 2500);
    return;
  }
  uploadSummary.value = null;
  uploadQueue.value.push(...valid.map(f => ({ file: f, status: "pending" as const })));
};

const clearQueue = () => {
  uploadQueue.value = uploadQueue.value.filter(e => e.status === "uploading");
  uploadSummary.value = null;
};

const startUpload = async () => {
  if (uploadRunning.value) return;
  const pending = uploadQueue.value.filter(e => e.status === "pending");
  if (!pending.length) return;
  uploadRunning.value = true;

  const dir = uploadDir.value.trim().replace(/\/?$/, "/");
  let ok = 0;
  for (const entry of pending) {
    entry.status = "uploading";
    try {
      const results = await uploadFonts([entry.file], dir);
      const res = results[0];
      if (res?.error) { entry.status = "error"; entry.msg = res.error; }
      else { entry.status = "ok"; ok++; }
    } catch (e) {
      entry.status = "error";
      entry.msg = String(e instanceof Error ? e.message : e);
    }
  }
  uploadRunning.value = false;
  uploadSummary.value = { ok, fail: pending.length - ok };
  if (ok > 0) loadFontList(true);
};

const onUploadDragEnter = (e: DragEvent) => { e.preventDefault(); uploadDragCounter++; uploadDragActive.value = true; };
const onUploadDragOver  = (e: DragEvent) => e.preventDefault();
const onUploadDragLeave = (e: DragEvent) => { e.preventDefault(); if (--uploadDragCounter <= 0) { uploadDragActive.value = false; uploadDragCounter = 0; } };
const onUploadDrop      = (e: DragEvent) => { e.preventDefault(); uploadDragActive.value = false; uploadDragCounter = 0; if (e.dataTransfer?.files) addToQueue(e.dataTransfer.files); };
const onUploadClick     = () => { const i = document.createElement("input"); i.type = "file"; i.multiple = true; i.accept = ".ttf,.otf,.ttc,.otc"; i.onchange = (e) => { const f = (e.target as HTMLInputElement).files; if (f) addToQueue(f); }; i.click(); };

// ── Tabs ──────────────────────────────────────────────────────────────────────
type Tab = "list" | "browser" | "upload" | "stats";
const activeTab = ref<Tab>("list");

// ── Index Stats ────────────────────────────────────────────────────────────────
const fontStats = ref<FontStats | null>(null);
const statsLoading = ref(false);

const loadStats = async () => {
  statsLoading.value = true;
  try {
    fontStats.value = await getFontStats();
  } catch {
    // silent
  } finally {
    statsLoading.value = false;
  }
};

// ── Scan Local (local-only feature) ───────────────────────────────────────────
const scanLocalState = ref<"idle" | "running" | "done">("idle");
const scanLocalResult = ref<ScanLocalResult | null>(null);
const scanLocalError = ref<string | null>(null);

const doScanLocal = async () => {
  if (scanLocalState.value === "running") return;
  scanLocalState.value = "running";
  scanLocalResult.value = null;
  scanLocalError.value = null;
  try {
    const result = await scanLocalFonts();
    scanLocalResult.value = result;
    scanLocalState.value = "done";
    loadFontList(true);
    loadStats();
    setTimeout(() => { scanLocalState.value = "idle"; }, 5000);
  } catch (e) {
    scanLocalError.value = e instanceof Error ? e.message : String(e);
    scanLocalState.value = "idle";
  }
};

onMounted(() => {
  if (hasKey.value) {
    loadRoot();
    loadFontList(true);
    loadStats();
  }
});

onBeforeUnmount(() => {
  io?.disconnect();
});
</script>

<template>
  <div>
  <!-- Lock screen -->
  <div v-if="!hasKey" class="card p-10 flex flex-col items-center text-center gap-5 max-w-md mx-auto mt-12">
    <div class="w-16 h-16 rounded-2xl bg-amber-100 flex items-center justify-center">
      <KeyRound class="w-8 h-8 text-amber-500" />
    </div>
    <div>
      <h2 class="font-display font-semibold text-xl text-ink-900 mb-2">{{ t('lockTitle') }}</h2>
      <p class="text-sm text-ink-400 leading-relaxed">{{ t('lockDesc') }}</p>
    </div>
    <div class="w-full flex gap-2">
      <KInput v-model="lockKeyInput" type="password" :placeholder="t('apiKeyPlaceholder')" class="flex-1" @keyup.enter="unlockWithKey" />
      <KButton variant="primary" @click="unlockWithKey">{{ t('unlock') }}</KButton>
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
        ]"
        :key="tab.id"
        class="flex items-center gap-1.5 h-8 px-4 rounded-xl text-sm font-medium transition-all duration-150"
        :class="activeTab === tab.id ? 'bg-white shadow-sm text-ink-900' : 'text-ink-500 hover:text-ink-700'"
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
            class="w-full h-9 pl-9 pr-3 rounded-xl border border-ink-200 text-sm text-ink-700 placeholder:text-ink-400 focus:border-sakura-400 focus:ring-2 focus:ring-sakura-400/20 outline-none transition-all bg-white"
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

      <div v-if="browserLoading" class="flex justify-center py-8">
        <KSpinner />
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
    <div v-if="activeTab === 'upload'" class="flex flex-col gap-4">
      <!-- Upload dir config -->
      <div class="card p-4 flex items-center gap-3">
        <FolderOpen class="w-4 h-4 text-sakura-400 shrink-0" />
        <span class="text-sm font-medium text-ink-700 shrink-0">{{ t('uploadDir') }}</span>
        <input
          v-model="uploadDir"
          class="flex-1 h-8 px-3 rounded-lg border border-ink-200 text-sm font-mono text-ink-700 focus:border-sakura-400 focus:ring-2 focus:ring-sakura-400/20 outline-none transition-all"
          placeholder="CatCat-Fonts/"
        />
      </div>

      <!-- Drop zone -->
      <div
        class="drop-zone cursor-pointer py-10 flex flex-col items-center gap-3 transition-all"
        :class="uploadDragActive ? 'ring-2 ring-sakura-400 scale-[1.01]' : ''"
        @dragenter="onUploadDragEnter"
        @dragover="onUploadDragOver"
        @dragleave="onUploadDragLeave"
        @drop="onUploadDrop"
        @click="onUploadClick"
      >
        <CloudUpload class="w-8 h-8 text-sakura-400" :stroke-width="1.5" />
        <p class="font-medium text-ink-700">{{ t('dropFontsHere') }}</p>
        <p class="text-xs text-ink-400">{{ t('fontsHint') }}</p>
      </div>

      <!-- Drop error inline -->
      <Transition name="fade">
        <div v-if="dropErrorMsg" class="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-600">
          <AlertTriangle class="w-3.5 h-3.5 shrink-0" />
          {{ dropErrorMsg }}
        </div>
      </Transition>

      <!-- Queue -->
      <div v-if="uploadQueue.length > 0" class="flex flex-col gap-2">
        <div class="flex items-center gap-2 min-h-[32px]">
          <!-- Summary (after upload completes) -->
          <Transition name="chip-text" mode="out-in">
            <span v-if="uploadSummary" key="summary" class="flex items-center gap-1.5 text-sm font-medium"
              :class="uploadSummary.fail > 0 ? 'text-amber-600' : 'text-mint-600'">
              <CheckCircle2 class="w-3.5 h-3.5 shrink-0" />
              {{ uploadSummary.ok }} {{ locale.startsWith('zh') ? '个已上传' : 'uploaded' }}
              <template v-if="uploadSummary.fail > 0">
                · <span class="text-rose-500">{{ uploadSummary.fail }} {{ locale.startsWith('zh') ? '失败' : 'failed' }}</span>
              </template>
            </span>
            <span v-else key="count" class="text-sm text-ink-500">{{ uploadQueue.length }} {{ t('files', uploadQueue.length) }}</span>
          </Transition>
          <div class="flex-1" />
          <KButton variant="primary" size="sm" :disabled="uploadRunning" @click="startUpload">
            <Upload class="w-3.5 h-3.5" />
            {{ uploadRunning ? t('fontUploading') : t('startUpload') }}
          </KButton>
          <KButton variant="ghost" size="sm" :disabled="uploadRunning" @click="clearQueue">
            <X class="w-3.5 h-3.5" />{{ t('clearQueue') }}
          </KButton>
        </div>

        <div class="flex flex-col gap-1 max-h-72 overflow-y-auto">
          <div
            v-for="(entry, i) in uploadQueue"
            :key="i"
            class="flex items-center gap-3 px-3 py-2 rounded-xl text-sm"
            :class="{
              'bg-white border border-ink-100': entry.status === 'pending',
              'bg-sakura-50 border border-sakura-100': entry.status === 'uploading',
              'bg-mint-50 border border-mint-200': entry.status === 'ok',
              'bg-rose-50 border border-rose-200': entry.status === 'error',
            }"
          >
            <Loader2 v-if="entry.status === 'uploading'" class="w-4 h-4 text-sakura-400 animate-spin-slow shrink-0" />
            <CheckCircle2 v-else-if="entry.status === 'ok'" class="w-4 h-4 text-mint-500 shrink-0" />
            <AlertTriangle v-else-if="entry.status === 'error'" class="w-4 h-4 text-rose-500 shrink-0" />
            <FileText v-else class="w-4 h-4 text-ink-400 shrink-0" />
            <span class="flex-1 truncate font-mono text-xs text-ink-700">{{ entry.file.name }}</span>
            <span v-if="entry.msg" class="text-xs text-rose-500 truncate max-w-32">{{ entry.msg }}</span>
            <span class="text-xs text-ink-400 shrink-0">{{ formatBytes(entry.file.size) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ─── Tab: Index Stats ───────────────────────────────────────────────── -->
    <div v-if="activeTab === 'stats'" class="flex flex-col gap-4">
      <div class="card p-4 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <CheckCircle2 class="w-4 h-4 text-mint-400" />
          <span class="font-display font-semibold text-ink-900">{{ t('indexStats') }}</span>
        </div>
        <KButton variant="ghost" size="sm" :disabled="statsLoading" @click="loadStats">
          <RefreshCcw class="w-3.5 h-3.5" :class="statsLoading && 'animate-spin-slow'" />
          {{ t('refresh') }}
        </KButton>
      </div>

      <div v-if="statsLoading && !fontStats" class="flex justify-center py-8">
        <KSpinner />
      </div>

      <template v-else-if="fontStats">
        <!-- Total -->
        <div class="card p-5 flex items-center gap-4">
          <div class="w-12 h-12 rounded-2xl bg-sakura-100 flex items-center justify-center shrink-0">
            <Database class="w-6 h-6 text-sakura-500" />
          </div>
          <div>
            <p class="text-sm text-ink-500">{{ t('totalIndexed') }}</p>
            <p class="text-3xl font-display font-bold text-ink-900">{{ fontStats.total.toLocaleString() }}</p>
          </div>
        </div>

        <!-- Per-folder breakdown -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div
            v-for="folder in fontStats.folders"
            :key="folder.prefix"
            class="card p-4 flex items-center gap-3"
          >
            <FolderOpen class="w-5 h-5 text-amber-400 shrink-0" />
            <div class="flex-1 min-w-0">
              <p class="text-xs font-mono text-ink-500 truncate">{{ folder.prefix }}</p>
              <p class="text-lg font-semibold text-ink-900">{{ folder.count.toLocaleString() }}</p>
            </div>
            <!-- progress bar relative to total -->
            <div class="w-16 bg-ink-100 rounded-full h-1.5 shrink-0">
              <div
                class="bg-sakura-400 h-1.5 rounded-full transition-all duration-500"
                :style="{ width: fontStats!.total > 0 ? `${(folder.count / fontStats!.total * 100).toFixed(1)}%` : '0%' }"
              />
            </div>
          </div>
        </div>

        <!-- Active index operations -->
        <template v-if="Object.keys(indexProgress).some(k => indexProgress[k]?.active)">
          <div class="card p-4">
            <p class="text-sm font-medium text-ink-700 mb-3 flex items-center gap-2">
              <Loader2 class="w-3.5 h-3.5 animate-spin text-sakura-400" />
              {{ t('indexRunning') }}
            </p>
            <div v-for="(prog, prefix) in indexProgress" :key="prefix" class="flex items-center gap-3 text-sm py-1">
              <span class="font-mono text-ink-500 flex-1 truncate">{{ prefix || '(all)' }}</span>
              <span v-if="prog.phase === 'listing'" class="text-xs text-amber-500">{{ t('phaseListing') }}</span>
              <span v-else-if="prog.phase === 'indexing'" class="text-xs text-sky-500">{{ prog.indexed }}/{{ prog.total }}</span>
              <span v-else class="text-xs text-mint-500">{{ t('phaseDone') }}</span>
            </div>
          </div>
        </template>
      </template>

      <KEmpty v-else :title="t('statsEmpty')" />

      <!-- Scan Local — discover and index all fonts in FONT_DIR -->
      <div class="card p-5 flex flex-col gap-3 border-dashed">
        <div class="flex items-center gap-2.5">
          <Search class="w-4 h-4 text-sky-400" />
          <h3 class="font-display font-semibold text-ink-800 text-sm">扫描本地字体目录</h3>
        </div>
        <p class="text-sm text-ink-500">扫描 <code class="text-xs bg-ink-100 px-1.5 py-0.5 rounded font-mono">FONT_DIR</code> 下所有字体文件，批量建立索引。已索引的文件会自动跳过。</p>

        <!-- Result inline -->
        <Transition name="chip-text" mode="out-in">
          <div
            v-if="scanLocalState === 'done' && scanLocalResult"
            key="done"
            class="flex items-center gap-2 text-sm text-mint-600"
          >
            <CheckCircle2 class="w-4 h-4 shrink-0" />
            <span>新增 {{ scanLocalResult.indexed }} 个，跳过 {{ scanLocalResult.skipped }} 个，共 {{ scanLocalResult.total }} 个字体文件</span>
          </div>
          <div v-else-if="scanLocalError" key="err" class="text-sm text-rose-500 flex items-center gap-1.5">
            <span>扫描失败: {{ scanLocalError }}</span>
          </div>
          <span v-else key="spacer" />
        </Transition>

        <KButton
          variant="secondary"
          size="sm"
          :disabled="scanLocalState === 'running'"
          class="w-fit"
          @click="doScanLocal"
        >
          <Loader2 v-if="scanLocalState === 'running'" class="w-3.5 h-3.5 animate-spin" />
          <Search v-else class="w-3.5 h-3.5" />
          {{ scanLocalState === 'running' ? '扫描中…' : '扫描并索引' }}
        </KButton>
      </div>
    </div>
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
