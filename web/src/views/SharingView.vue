<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { debounce } from "lodash-es";
import {
  Share2, Search, X, Tv, Download, Upload, Heart,
  Paperclip, FileArchive, FolderOpen, ChevronRight, Home,
  ArrowLeft, CheckCircle2, AlertCircle, CloudUpload,
  Eye, Pencil, Trash2, KeyRound,
} from "lucide-vue-next";
import KButton from "../components/KButton.vue";
import KBadge from "../components/KBadge.vue";
import KEmpty from "../components/KEmpty.vue";
import KSpinner from "../components/KSpinner.vue";
import type { SharedArchive } from "../api/client";
import {
  listSharedArchives,
  contributeArchive,
  editArchive,
  deleteArchive,
  previewArchive,
  downloadArchiveFile,
  getApiKey,
} from "../api/client";
import { buildSearchIndex, searchArchives } from "../lib/search";

const { t } = useI18n();

// ─── State ────────────────────────────────────────────────────────────────────

const loading = ref(true);
const archives = ref<SharedArchive[]>([]);

// Search & filter
const searchQuery = ref("");
const isSearching = computed(() => searchQuery.value.trim().length > 0);
const searchResultIds = ref<Set<string>>(new Set());

// Folder navigation: currentPath = [] → root, ['B'] → letter, ['B','BanG Dream!'] → anime, ['B','BanG Dream!','S1'] → season
const currentPath = ref<string[]>([]);
const navDepth = computed(() => currentPath.value.length);

// Stats
const stats = computed(() => {
  const animeNames = new Set(archives.value.map((a) => a.name_cn));
  const subGroups = new Set(archives.value.map((a) => a.sub_group));
  return {
    animeCount: animeNames.size,
    archiveCount: archives.value.length,
    subGroupCount: subGroups.size,
  };
});

// ─── Grouped data structures ──────────────────────────────────────────────────

interface AnimeGroup {
  name_cn: string;
  seasons: { name: string; archives: SharedArchive[] }[];
  totalSeasons: number;
  totalArchives: number;
  sub_entries: string[] | null;
}

const filteredArchives = computed(() => {
  let list = archives.value;
  if (isSearching.value) {
    list = list.filter((a) => searchResultIds.value.has(a.id));
  }
  return list;
});

// Level 0: letter folders with anime counts
const letterFolders = computed(() => {
  const map = new Map<string, Set<string>>();
  for (const a of filteredArchives.value) {
    if (!map.has(a.letter)) map.set(a.letter, new Set());
    map.get(a.letter)!.add(a.name_cn);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([letter, animeSet]) => ({ letter, count: animeSet.size }));
});

// Level 1: anime list for a given letter
const animeFolders = computed(() => {
  if (navDepth.value < 1) return [];
  const letter = currentPath.value[0];
  const animeMap = new Map<string, SharedArchive[]>();
  for (const a of filteredArchives.value) {
    if (a.letter !== letter) continue;
    if (!animeMap.has(a.name_cn)) animeMap.set(a.name_cn, []);
    animeMap.get(a.name_cn)!.push(a);
  }
  return [...animeMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, list]) => {
      const seasons = new Set(list.map(a => a.season));
      return { name, seasonCount: seasons.size, archiveCount: list.length };
    });
});

// Level 2: seasons for a given anime
const seasonFolders = computed(() => {
  if (navDepth.value < 2) return [];
  const [letter, animeName] = currentPath.value;
  const seasonMap = new Map<string, SharedArchive[]>();
  let subEntries: string[] | null = null;
  for (const a of filteredArchives.value) {
    if (a.letter !== letter || a.name_cn !== animeName) continue;
    if (!seasonMap.has(a.season)) seasonMap.set(a.season, []);
    seasonMap.get(a.season)!.push(a);
    if (!subEntries && a.sub_entries) {
      try { subEntries = JSON.parse(a.sub_entries); } catch {}
    }
  }
  return {
    seasons: [...seasonMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, archives]) => ({ name, archiveCount: archives.length })),
    subEntries,
  };
});

// Level 3: archives for a given season
const seasonArchives = computed(() => {
  if (navDepth.value < 3) return [];
  const [letter, animeName, season] = currentPath.value;
  return filteredArchives.value.filter(
    a => a.letter === letter && a.name_cn === animeName && a.season === season
  );
});

// ─── Navigation ───────────────────────────────────────────────────────────────

function navigateTo(depth: number, segment?: string) {
  if (segment !== undefined) {
    currentPath.value = [...currentPath.value.slice(0, depth), segment];
  } else {
    currentPath.value = currentPath.value.slice(0, depth);
  }
}

function goRoot() {
  currentPath.value = [];
}

// ─── Search ───────────────────────────────────────────────────────────────────

const onSearchDebounced = debounce(() => {
  if (!searchQuery.value.trim()) {
    searchResultIds.value = new Set();
    return;
  }
  const ids = searchArchives(searchQuery.value.trim());
  searchResultIds.value = new Set(ids);
}, 200);

function clearSearch() {
  searchQuery.value = "";
  searchResultIds.value = new Set();
}

// ─── Contribute View (inline full-page) ───────────────────────────────────────

const showContributeView = ref(false);
const uploadForm = ref({
  name_cn: "",
  letter: "",
  season: "S1",
  sub_group: "",
  languages: [] as string[],
  has_fonts: false,
  contributor: "",
});
const uploadFile = ref<File | null>(null);
const uploadSubmitting = ref(false);
const uploadDetected = ref("");
const dropHover = ref(false);
const uploadSuccess = ref(false);
const uploadError = ref("");
const uploadProgress = ref(0);

const LANG_OPTIONS = ["chs", "cht", "jpn", "chs_jpn", "cht_jpn", "sc", "tc", "eng"];

const canSubmit = computed(() =>
  uploadForm.value.name_cn.trim() &&
  uploadForm.value.sub_group.trim() &&
  uploadForm.value.languages.length > 0 &&
  uploadFile.value !== null &&
  !uploadSubmitting.value
);

function toggleLang(lang: string) {
  const idx = uploadForm.value.languages.indexOf(lang);
  if (idx >= 0) uploadForm.value.languages.splice(idx, 1);
  else uploadForm.value.languages.push(lang);
}

function handleFileSelect(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    uploadFile.value = file;
    uploadDetected.value = `${formatSize(file.size)}`;
    uploadError.value = "";
  }
}

function handleDrop(e: DragEvent) {
  e.preventDefault();
  dropHover.value = false;
  const file = e.dataTransfer?.files[0];
  if (file && file.name.endsWith(".zip")) {
    uploadFile.value = file;
    uploadDetected.value = `${formatSize(file.size)}`;
    uploadError.value = "";
  }
}

function resetForm() {
  uploadForm.value = { name_cn: "", letter: "", season: "S1", sub_group: "", languages: [], has_fonts: false, contributor: "" };
  uploadFile.value = null;
  uploadDetected.value = "";
  uploadSuccess.value = false;
  uploadError.value = "";
  uploadProgress.value = 0;
}

function openContributeView() {
  resetForm();
  showContributeView.value = true;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function closeContributeView() {
  showContributeView.value = false;
  resetForm();
}

async function submitContribute() {
  if (!uploadFile.value || uploadSubmitting.value) return;
  uploadError.value = "";
  uploadProgress.value = 0;
  const meta = {
    name_cn: uploadForm.value.name_cn,
    letter: uploadForm.value.letter.toUpperCase() || uploadForm.value.name_cn.charAt(0).toUpperCase(),
    season: uploadForm.value.season,
    sub_group: uploadForm.value.sub_group,
    languages: uploadForm.value.languages,
    has_fonts: uploadForm.value.has_fonts,
    contributor: uploadForm.value.contributor || undefined,
  };
  uploadSubmitting.value = true;
  try {
    await contributeArchive(uploadFile.value, meta, (pct) => { uploadProgress.value = pct; });
    uploadSuccess.value = true;
    loadArchives();
  } catch (e: any) {
    console.error("Upload error:", e);
    uploadError.value = e.message || String(e);
  } finally {
    uploadSubmitting.value = false;
  }
}

// Auto-generate letter from name
watch(() => uploadForm.value.name_cn, (name) => {
  if (name && !uploadForm.value.letter) {
    const first = name.charAt(0).toUpperCase();
    if (/[A-Z]/.test(first)) uploadForm.value.letter = first;
  }
});

// ─── Handlers ─────────────────────────────────────────────────────────────────

const isAdmin = computed(() => !!getApiKey());

async function loadArchives() {
  loading.value = true;
  try {
    archives.value = await listSharedArchives();
    buildSearchIndex(
      archives.value.map((a) => ({
        id: a.id,
        name_cn: a.name_cn,
        sub_group: a.sub_group,
        languages: (() => { try { return JSON.parse(a.languages).join(" "); } catch { return ""; } })(),
        season: a.season,
        letter: a.letter,
      }))
    );
  } catch (e) {
    console.error("Failed to load archives:", e);
  } finally {
    loading.value = false;
  }
}

function downloadArchiveByUrl(archive: SharedArchive) {
  if (archive.download_url) {
    window.open(archive.download_url, "_blank");
  }
}

// ─── Admin: Preview ───────────────────────────────────────────────────────────

const showPreviewModal = ref(false);
const previewLoading = ref(false);
const previewData = ref<{ filename: string; totalFiles: number; subtitleFiles: number; files: { name: string; ext: string; isSubtitle: boolean }[] } | null>(null);
const previewError = ref("");

async function openPreview(archive: SharedArchive) {
  showPreviewModal.value = true;
  previewLoading.value = true;
  previewError.value = "";
  previewData.value = null;
  try {
    previewData.value = await previewArchive(archive.id);
  } catch (e: any) {
    previewError.value = e.message || String(e);
  } finally {
    previewLoading.value = false;
  }
}

function closePreview() {
  showPreviewModal.value = false;
  previewData.value = null;
  previewError.value = "";
}

// ─── Admin: Download file ─────────────────────────────────────────────────────

const downloadingId = ref("");

async function downloadFile(archive: SharedArchive) {
  downloadingId.value = archive.id;
  try {
    const { blob, filename } = await downloadArchiveFile(archive.id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e: any) {
    toast.error(e.message || String(e));
  } finally {
    downloadingId.value = "";
  }
}

// ─── Admin: Edit ──────────────────────────────────────────────────────────────

const showEditModal = ref(false);
const editForm = ref({ name_cn: "", letter: "", season: "S1", sub_group: "", languages: [] as string[], has_fonts: false, episode_count: 0 });
const editingId = ref("");
const editSubmitting = ref(false);

function openEdit(archive: SharedArchive) {
  editingId.value = archive.id;
  editForm.value = {
    name_cn: archive.name_cn,
    letter: archive.letter,
    season: archive.season,
    sub_group: archive.sub_group,
    languages: (() => { try { return JSON.parse(archive.languages); } catch { return []; } })(),
    has_fonts: !!archive.has_fonts,
    episode_count: archive.episode_count,
  };
  showEditModal.value = true;
}

function closeEdit() {
  showEditModal.value = false;
  editingId.value = "";
}

function toggleEditLang(lang: string) {
  const idx = editForm.value.languages.indexOf(lang);
  if (idx >= 0) editForm.value.languages.splice(idx, 1);
  else editForm.value.languages.push(lang);
}

async function submitEdit() {
  if (editSubmitting.value) return;
  editSubmitting.value = true;
  try {
    await editArchive(editingId.value, editForm.value);
    toast.success(t("sharingEditSuccess"));
    closeEdit();
    await loadArchives();
  } catch (e: any) {
    toast.error(e.message || String(e));
  } finally {
    editSubmitting.value = false;
  }
}

// ─── Admin: Delete ────────────────────────────────────────────────────────────

async function confirmDelete(archive: SharedArchive) {
  if (!confirm(t("sharingDeleteConfirm"))) return;
  try {
    await deleteArchive(archive.id);
    toast.success(t("sharingDeleteSuccess"));
    await loadArchives();
  } catch (e: any) {
    toast.error(e.message || String(e));
  }
}

// ─── Autocomplete for anime name (fuzzy search from existing archives) ────────

const showAutoComplete = ref(false);
const autoCompleteResults = computed(() => {
  const q = uploadForm.value.name_cn.trim().toLowerCase();
  if (!q || q.length < 1) return [];
  const seen = new Map<string, { name_cn: string; letter: string; seasons: Set<string> }>();
  for (const a of archives.value) {
    if (!a.name_cn.toLowerCase().includes(q)) continue;
    const key = a.name_cn;
    if (!seen.has(key)) seen.set(key, { name_cn: a.name_cn, letter: a.letter, seasons: new Set() });
    seen.get(key)!.seasons.add(a.season);
  }
  return [...seen.values()].slice(0, 8);
});

function selectAutoComplete(item: { name_cn: string; letter: string }) {
  uploadForm.value.name_cn = item.name_cn;
  uploadForm.value.letter = item.letter;
  showAutoComplete.value = false;
}

// ─── Sub-group autocomplete ───────────────────────────────────────────────────

const showSubGroupAC = ref(false);
const subGroupACResults = computed(() => {
  const q = uploadForm.value.sub_group.trim().toLowerCase();
  if (!q || q.length < 1) return [];
  const seen = new Set<string>();
  for (const a of archives.value) {
    if (a.sub_group.toLowerCase().includes(q) && !seen.has(a.sub_group)) {
      seen.add(a.sub_group);
    }
  }
  return [...seen].slice(0, 8);
});

function selectSubGroup(name: string) {
  uploadForm.value.sub_group = name;
  showSubGroupAC.value = false;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function parseLangs(json: string): string[] {
  try { return JSON.parse(json); } catch { return []; }
}

function parseFmts(json: string): string[] {
  try { return JSON.parse(json); } catch { return []; }
}

onMounted(() => {
  loadArchives();
});
</script>

<template>
  <div class="flex flex-col gap-6 animate-fade-in">

    <!-- ═══ Header: Stats + Search (hidden during contribute) ═══ -->
    <section v-if="!showContributeView" class="card p-6 bg-gradient-to-br from-white to-sakura-50/40">
      <div class="flex items-start justify-between gap-4 mb-4 flex-wrap">
        <div class="flex items-center gap-3">
          <div class="w-11 h-11 rounded-xl bg-sakura-100 flex items-center justify-center shrink-0">
            <Share2 class="w-5 h-5 text-sakura-500" />
          </div>
          <div>
            <h1 class="font-display font-bold text-2xl text-ink-950">
              {{ t('sharingTitle') }}
            </h1>
            <p class="text-sm text-ink-400" v-if="!loading">
              {{ stats.animeCount }} {{ t('sharingAnimeCount') }} ·
              {{ stats.archiveCount }} {{ t('sharingArchiveCount') }} ·
              {{ stats.subGroupCount }} {{ t('sharingGroupCount') }}
            </p>
          </div>
        </div>
        <KButton variant="primary" @click="openContributeView" class="shrink-0">
          <CloudUpload class="w-4 h-4" />
          {{ t('sharingContributeButton') }}
        </KButton>
      </div>

      <!-- Search -->
      <div class="relative">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-300" />
        <input
          v-model="searchQuery"
          @input="onSearchDebounced"
          class="w-full pl-10 pr-10 py-2.5 rounded-xl border border-sakura-200 bg-white text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-sakura-300/50"
          :placeholder="t('sharingSearchPlaceholder')"
        />
        <button v-if="searchQuery" @click="clearSearch" class="absolute right-3 top-1/2 -translate-y-1/2">
          <X class="w-4 h-4 text-ink-300 hover:text-ink-500" />
        </button>
      </div>
    </section>

    <!-- ═══ Loading ═══ -->
    <div v-if="loading && !showContributeView" class="flex justify-center py-16">
      <KSpinner />
    </div>

    <!-- ═══ Empty State ═══ -->
    <KEmpty
      v-else-if="archives.length === 0 && !showContributeView"
      :title="t('sharingNoArchives')"
      :description="t('sharingNoArchivesDesc')"
    />

    <!-- ═══ Breadcrumb Navigation ═══ -->
    <nav
      v-if="!loading && archives.length > 0 && !isSearching && navDepth > 0 && !showContributeView"
      class="flex items-center gap-1.5 text-sm flex-wrap"
    >
      <button
        @click="goRoot"
        class="flex items-center gap-1 text-sakura-500 hover:text-sakura-600 transition-colors duration-150 font-medium"
      >
        <Home class="w-3.5 h-3.5" />
        {{ t('sharingBreadcrumbRoot') }}
      </button>
      <template v-for="(seg, idx) in currentPath" :key="idx">
        <ChevronRight class="w-3.5 h-3.5 text-ink-300 shrink-0" />
        <button
          v-if="idx < navDepth - 1"
          @click="navigateTo(idx + 1)"
          class="text-sakura-500 hover:text-sakura-600 transition-colors duration-150 font-medium truncate max-w-48"
        >
          {{ seg }}
        </button>
        <span v-else class="text-ink-700 font-semibold truncate max-w-48">{{ seg }}</span>
      </template>
    </nav>

    <!-- ═══ Level 0: Letter Folder Grid ═══ -->
    <div
      v-if="!loading && archives.length > 0 && !isSearching && navDepth === 0 && !showContributeView"
      class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4"
    >
      <button
        v-for="item in letterFolders"
        :key="item.letter"
        @click="navigateTo(0, item.letter)"
        class="card p-5 flex flex-col items-center gap-3 hover:shadow-md hover:border-sakura-200 transition-all duration-200 cursor-pointer group active:scale-[0.97]"
      >
        <div class="w-12 h-12 rounded-2xl bg-sakura-50 group-hover:bg-sakura-100 flex items-center justify-center transition-colors duration-200">
          <FolderOpen class="w-6 h-6 text-sakura-400 group-hover:text-sakura-500 transition-colors duration-200" />
        </div>
        <span class="font-display font-bold text-2xl text-ink-800">{{ item.letter }}</span>
        <KBadge variant="default">{{ t('sharingLetterFolder', { count: item.count }) }}</KBadge>
      </button>
    </div>

    <!-- ═══ Level 1: Anime List ═══ -->
    <div
      v-if="!loading && archives.length > 0 && !isSearching && navDepth === 1 && !showContributeView"
      class="flex flex-col gap-3"
    >
      <button
        v-for="item in animeFolders"
        :key="item.name"
        @click="navigateTo(1, item.name)"
        class="card px-5 py-4 flex items-center gap-4 hover:shadow-md hover:border-sakura-200 transition-all duration-200 cursor-pointer group active:scale-[0.99] text-left"
      >
        <div class="w-10 h-10 rounded-xl bg-sky-50 group-hover:bg-sky-100 flex items-center justify-center shrink-0 transition-colors duration-200">
          <Tv class="w-5 h-5 text-sky-400 group-hover:text-sky-500 transition-colors duration-200" />
        </div>
        <div class="flex-1 min-w-0">
          <p class="font-display font-semibold text-ink-900 text-base truncate">{{ item.name }}</p>
          <p class="text-xs text-ink-400 mt-0.5">
            {{ t('sharingAnimeFolder', { count: item.seasonCount }) }} · {{ item.archiveCount }} {{ t('sharingArchives') }}
          </p>
        </div>
        <ChevronRight class="w-4 h-4 text-ink-300 group-hover:text-sakura-400 shrink-0 transition-colors duration-200" />
      </button>
      <KEmpty v-if="animeFolders.length === 0" :title="t('sharingNoResults')" />
    </div>

    <!-- ═══ Level 2: Season List ═══ -->
    <div
      v-if="!loading && archives.length > 0 && !isSearching && navDepth === 2 && !showContributeView"
      class="flex flex-col gap-3"
    >
      <button
        v-for="item in seasonFolders.seasons"
        :key="item.name"
        @click="navigateTo(2, item.name)"
        class="card px-5 py-4 flex items-center gap-4 hover:shadow-md hover:border-sakura-200 transition-all duration-200 cursor-pointer group active:scale-[0.99] text-left"
      >
        <div class="w-10 h-10 rounded-xl bg-mint-50 group-hover:bg-mint-100 flex items-center justify-center shrink-0 transition-colors duration-200">
          <FolderOpen class="w-5 h-5 text-mint-400 group-hover:text-mint-500 transition-colors duration-200" />
        </div>
        <div class="flex-1 min-w-0">
          <p class="font-display font-semibold text-ink-900 text-base">{{ item.name }}</p>
          <p class="text-xs text-ink-400 mt-0.5">{{ t('sharingSeasonFolder', { count: item.archiveCount }) }}</p>
        </div>
        <ChevronRight class="w-4 h-4 text-ink-300 group-hover:text-sakura-400 shrink-0 transition-colors duration-200" />
      </button>

      <!-- Sub-entries info -->
      <div v-if="seasonFolders.subEntries?.length" class="card px-5 py-3 bg-sakura-50/30">
        <p class="text-[11px] text-ink-400 flex items-center gap-1.5">
          <Paperclip class="w-3 h-3 shrink-0" />
          {{ t('sharingIncludes') }}: {{ seasonFolders.subEntries.join(' · ') }}
        </p>
      </div>
      <KEmpty v-if="seasonFolders.seasons.length === 0" :title="t('sharingNoResults')" />
    </div>

    <!-- ═══ Level 3: Archive Files ═══ -->
    <div
      v-if="!loading && archives.length > 0 && !isSearching && navDepth === 3 && !showContributeView"
      class="flex flex-col gap-3"
    >
      <div
        v-for="archive in seasonArchives"
        :key="archive.id"
        class="card p-4 hover:shadow-md transition-all duration-200 group"
      >
        <div class="flex items-start gap-3">
          <div class="w-10 h-10 rounded-xl bg-sakura-50 flex items-center justify-center shrink-0 mt-0.5">
            <FileArchive class="w-5 h-5 text-sakura-400" />
          </div>
          <div class="flex-1 min-w-0">
            <!-- Filename (prominent) -->
            <p class="font-display font-semibold text-ink-900 text-sm leading-snug break-all">
              {{ archive.filename }}
            </p>
            <!-- Metadata row -->
            <div class="flex items-center gap-2 mt-2 flex-wrap">
              <KBadge variant="sakura">{{ archive.sub_group }}</KBadge>
              <span v-if="archive.episode_count" class="text-xs text-ink-400">
                {{ archive.episode_count }} {{ t('sharingEpisodes') }}
              </span>
              <KBadge v-for="fmt in parseFmts(archive.subtitle_format)" :key="fmt" variant="default" class="text-[10px]">
                {{ fmt }}
              </KBadge>
              <KBadge v-for="lang in parseLangs(archive.languages)" :key="lang" variant="sky" class="text-[10px]">
                {{ lang }}
              </KBadge>
              <KBadge v-if="archive.has_fonts" variant="success" class="text-[10px]">
                {{ t('sharingFont') }}
              </KBadge>
              <span class="text-xs text-ink-300 tabular-nums ml-auto">
                {{ formatSize(archive.file_size) }}
              </span>
            </div>
          </div>
          <button
            @click="downloadArchiveByUrl(archive)"
            class="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-sakura-400 hover:text-white hover:bg-sakura-500 transition-all duration-200 active:scale-95 mt-0.5"
            :title="t('download')"
          >
            <Download class="w-4 h-4" />
          </button>
          <!-- Admin actions -->
          <template v-if="isAdmin">
            <button
              @click="openPreview(archive)"
              class="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-sky-400 hover:text-white hover:bg-sky-500 transition-all duration-200 active:scale-95 mt-0.5"
              :title="t('sharingPreview')"
            >
              <Eye class="w-4 h-4" />
            </button>
            <button
              @click="downloadFile(archive)"
              :disabled="downloadingId === archive.id"
              class="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-mint-400 hover:text-white hover:bg-mint-500 transition-all duration-200 active:scale-95 mt-0.5"
              :title="t('sharingDownload')"
            >
              <Download class="w-4 h-4" />
            </button>
            <button
              @click="openEdit(archive)"
              class="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-amber-400 hover:text-white hover:bg-amber-500 transition-all duration-200 active:scale-95 mt-0.5"
              :title="t('sharingEdit')"
            >
              <Pencil class="w-4 h-4" />
            </button>
            <button
              @click="confirmDelete(archive)"
              class="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-red-400 hover:text-white hover:bg-red-500 transition-all duration-200 active:scale-95 mt-0.5"
              :title="t('delete')"
            >
              <Trash2 class="w-4 h-4" />
            </button>
          </template>
        </div>
      </div>
      <KEmpty v-if="seasonArchives.length === 0" :title="t('sharingNoResults')" />
    </div>

    <!-- ═══ Search Mode: Flat results ═══ -->
    <div v-if="!loading && isSearching && !showContributeView" class="mt-2">
      <p class="text-sm text-ink-400 mb-4">
        "<strong class="text-ink-600">{{ searchQuery }}</strong>"
        — {{ filteredArchives.length }}
      </p>

      <div class="flex flex-col gap-3">
        <div
          v-for="result in filteredArchives"
          :key="result.id"
          class="card p-4 hover:shadow-md transition-shadow duration-200"
        >
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-xl bg-sky-50 flex items-center justify-center shrink-0 mt-0.5">
              <FileArchive class="w-5 h-5 text-sky-400" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="font-display font-semibold text-sm text-ink-900 break-all leading-snug">{{ result.filename }}</p>
              <p class="text-xs text-ink-400 mt-1">
                {{ result.name_cn }} · {{ result.season }} ·
                <span class="text-sakura-400">{{ result.sub_group }}</span>
              </p>
              <div class="flex items-center gap-2 mt-1.5 flex-wrap">
                <KBadge v-for="lang in parseLangs(result.languages)" :key="lang" variant="sky" class="text-[10px]">{{ lang }}</KBadge>
                <span class="text-xs text-ink-300 tabular-nums">{{ formatSize(result.file_size) }}</span>
              </div>
            </div>
            <button
              @click="downloadArchiveByUrl(result)"
              class="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-sakura-400 hover:text-white hover:bg-sakura-500 transition-all duration-200 active:scale-95 mt-0.5"
            >
              <Download class="w-4 h-4" />
            </button>
            <template v-if="isAdmin">
              <button @click="openPreview(result)" class="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-sky-400 hover:text-white hover:bg-sky-500 transition-all duration-200 active:scale-95 mt-0.5">
                <Eye class="w-4 h-4" />
              </button>
              <button @click="openEdit(result)" class="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-amber-400 hover:text-white hover:bg-amber-500 transition-all duration-200 active:scale-95 mt-0.5">
                <Pencil class="w-4 h-4" />
              </button>
              <button @click="confirmDelete(result)" class="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-red-400 hover:text-white hover:bg-red-500 transition-all duration-200 active:scale-95 mt-0.5">
                <Trash2 class="w-4 h-4" />
              </button>
            </template>
          </div>
        </div>
      </div>

      <KEmpty v-if="filteredArchives.length === 0" :title="t('sharingNoResults')" :description="t('sharingNoResultsDesc')" />
    </div>

    <!-- ═══ Contribute Footer CTA ═══ -->
    <!-- Bottom contribute CTA removed — button now in header -->

    <!-- ═══ Contribute View (Inline Full-Page) ═══ -->
    <Transition name="slide">
      <div v-if="showContributeView" class="flex flex-col gap-6 animate-fade-in">

        <!-- Back button -->
        <button
          @click="closeContributeView"
          class="flex items-center gap-2 text-sm text-sakura-500 hover:text-sakura-600 transition-colors duration-150 font-medium self-start"
        >
          <ArrowLeft class="w-4 h-4" />
          {{ t('sharingBack') }}
        </button>

        <!-- Success state -->
        <div v-if="uploadSuccess" class="card p-10 text-center">
          <div class="w-16 h-16 rounded-full bg-mint-100 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 class="w-8 h-8 text-mint-500" />
          </div>
          <h2 class="font-display font-bold text-xl text-ink-900 mb-2">{{ t('sharingUploadSuccess') }}</h2>
          <p class="text-sm text-ink-400 mb-6">{{ t('sharingUploadSuccessDesc') }}</p>
          <KButton variant="primary" @click="resetForm">
            <CloudUpload class="w-4 h-4" />
            {{ t('sharingUploadAnother') }}
          </KButton>
        </div>

        <!-- Upload form -->
        <template v-else>
          <!-- Title card -->
          <div class="card p-6 bg-gradient-to-br from-white to-sakura-50/30">
            <div class="flex items-center gap-3 mb-1">
              <div class="w-10 h-10 rounded-xl bg-sakura-100 flex items-center justify-center shrink-0">
                <CloudUpload class="w-5 h-5 text-sakura-500" />
              </div>
              <div>
                <h2 class="font-display font-bold text-xl text-ink-900">{{ t('sharingContributeFormTitle') }}</h2>
                <p class="text-xs text-ink-400 mt-0.5">{{ t('sharingContributeFormDesc') }}</p>
              </div>
            </div>
          </div>

          <!-- Two-column layout: Form + File -->
          <div class="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <!-- Left: Metadata form (3/5 width) -->
            <div class="lg:col-span-3 card p-6">
              <h3 class="font-display font-semibold text-ink-800 text-sm mb-4 flex items-center gap-2">
                <Tv class="w-4 h-4 text-sky-400" />
                {{ t('sharingAnimeInfo') }}
              </h3>

              <div class="flex flex-col gap-4">
                <!-- Row 1: Anime name (with autocomplete) + Letter -->
                <div class="flex gap-3">
                  <div class="flex-1 relative">
                    <label class="text-xs font-medium text-ink-500 mb-1.5 block">{{ t('sharingAnimeName') }} *</label>
                    <input
                      v-model="uploadForm.name_cn"
                      @focus="showAutoComplete = true"
                      @blur="setTimeout(() => showAutoComplete = false, 200)"
                      autocomplete="off"
                      class="w-full px-3.5 py-2.5 rounded-xl border border-ink-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sakura-300/50 focus:border-sakura-300 transition-all duration-150"
                      :placeholder="t('sharingAnimeNamePlaceholder')"
                    />
                    <!-- Autocomplete dropdown -->
                    <div
                      v-if="showAutoComplete && autoCompleteResults.length > 0"
                      class="absolute z-20 left-0 right-0 top-full mt-1 bg-white rounded-xl border border-sakura-200 shadow-lg max-h-48 overflow-y-auto"
                    >
                      <button
                        v-for="item in autoCompleteResults"
                        :key="item.name_cn"
                        @mousedown.prevent="selectAutoComplete(item)"
                        class="w-full px-3.5 py-2.5 text-left hover:bg-sakura-50 transition-colors duration-100 flex items-center gap-2 border-b border-ink-50 last:border-b-0"
                      >
                        <Tv class="w-3.5 h-3.5 text-sky-400 shrink-0" />
                        <span class="text-sm text-ink-800 truncate flex-1">{{ item.name_cn }}</span>
                        <span class="text-[10px] text-ink-400">{{ item.letter }} · {{ [...item.seasons].join(', ') }}</span>
                      </button>
                    </div>
                  </div>
                  <div class="w-20">
                    <label class="text-xs font-medium text-ink-500 mb-1.5 block">{{ t('sharingLetter') }}</label>
                    <input
                      v-model="uploadForm.letter"
                      maxlength="1"
                      class="w-full px-3 py-2.5 rounded-xl border border-ink-200 text-sm text-center uppercase bg-white focus:outline-none focus:ring-2 focus:ring-sakura-300/50 focus:border-sakura-300 transition-all duration-150"
                      placeholder="A"
                    />
                  </div>
                </div>

                <!-- Row 2: Season + Sub group -->
                <div class="flex gap-3">
                  <div class="w-32">
                    <label class="text-xs font-medium text-ink-500 mb-1.5 block">{{ t('sharingSeason') }} *</label>
                    <select
                      v-model="uploadForm.season"
                      class="w-full px-3 py-2.5 rounded-xl border border-ink-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sakura-300/50 focus:border-sakura-300 transition-all duration-150"
                    >
                      <option v-for="s in ['S1','S2','S3','S4','Movie','SPs','OVA']" :key="s" :value="s">{{ s }}</option>
                    </select>
                  </div>
                  <div class="flex-1 relative">
                    <label class="text-xs font-medium text-ink-500 mb-1.5 block">{{ t('sharingSubGroup') }} *</label>
                    <input
                      v-model="uploadForm.sub_group"
                      @focus="showSubGroupAC = true"
                      @blur="setTimeout(() => showSubGroupAC = false, 200)"
                      autocomplete="off"
                      class="w-full px-3.5 py-2.5 rounded-xl border border-ink-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sakura-300/50 focus:border-sakura-300 transition-all duration-150"
                      :placeholder="t('sharingSubGroupPlaceholder')"
                    />
                    <!-- Sub-group autocomplete dropdown -->
                    <div
                      v-if="showSubGroupAC && subGroupACResults.length > 0"
                      class="absolute z-20 left-0 right-0 top-full mt-1 bg-white rounded-xl border border-sakura-200 shadow-lg max-h-48 overflow-y-auto"
                    >
                      <button
                        v-for="name in subGroupACResults"
                        :key="name"
                        @mousedown.prevent="selectSubGroup(name)"
                        class="w-full px-3.5 py-2.5 text-left hover:bg-sakura-50 transition-colors duration-100 border-b border-ink-50 last:border-b-0"
                      >
                        <span class="text-sm text-ink-800">{{ name }}</span>
                      </button>
                    </div>
                  </div>
                </div>

                <!-- Row 3: Languages -->
                <div>
                  <label class="text-xs font-medium text-ink-500 mb-2 block">{{ t('sharingLanguages') }} *</label>
                  <div class="flex flex-wrap gap-2">
                    <button
                      v-for="lang in LANG_OPTIONS"
                      :key="lang"
                      @click="toggleLang(lang)"
                      class="px-3.5 py-2 rounded-xl text-xs font-medium border-2 transition-all duration-150"
                      :class="uploadForm.languages.includes(lang)
                        ? 'bg-sakura-50 border-sakura-300 text-sakura-700 shadow-sm'
                        : 'bg-white border-ink-100 text-ink-400 hover:border-sakura-200 hover:text-ink-600'"
                    >
                      {{ lang }}
                    </button>
                  </div>
                </div>

                <!-- Row 4: Options -->
                <div class="flex items-center justify-between pt-1">
                  <label class="flex items-center gap-2.5 text-sm text-ink-600 cursor-pointer select-none">
                    <input type="checkbox" v-model="uploadForm.has_fonts" class="rounded border-ink-300 text-sakura-500 focus:ring-sakura-300" />
                    {{ t('sharingHasFonts') }}
                  </label>
                </div>

                <!-- Row 5: Contributor -->
                <div>
                  <label class="text-xs font-medium text-ink-500 mb-1.5 block">{{ t('sharingContributor') }}</label>
                  <input
                    v-model="uploadForm.contributor"
                    class="w-full px-3.5 py-2.5 rounded-xl border border-ink-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sakura-300/50 focus:border-sakura-300 transition-all duration-150"
                    :placeholder="t('sharingContributorPlaceholder')"
                  />
                </div>

                <!-- Contribution Guidelines -->
                <div class="mt-5 pt-5 border-t border-ink-100">
                  <h4 class="text-xs font-bold text-ink-600 mb-2.5 flex items-center gap-1.5">
                    <AlertCircle class="w-3.5 h-3.5 text-sakura-400" />
                    {{ t('sharingGuidelinesTitle') }}
                  </h4>
                  <ul class="text-xs text-ink-400 space-y-1.5 leading-relaxed">
                    <li class="flex items-start gap-1.5">
                      <span class="text-sakura-300 shrink-0 mt-0.5">•</span>
                      <span>{{ t('sharingGuidelineName') }}</span>
                    </li>
                    <li class="flex items-start gap-1.5">
                      <span class="text-sakura-300 shrink-0 mt-0.5">•</span>
                      <span>{{ t('sharingGuidelineLetter') }}</span>
                    </li>
                    <li class="flex items-start gap-1.5">
                      <span class="text-sakura-300 shrink-0 mt-0.5">•</span>
                      <span>{{ t('sharingGuidelineSeason') }}</span>
                    </li>
                    <li class="flex items-start gap-1.5">
                      <span class="text-sakura-300 shrink-0 mt-0.5">•</span>
                      <span>{{ t('sharingGuidelineSubGroup') }}</span>
                    </li>
                    <li class="flex items-start gap-1.5">
                      <span class="text-sakura-300 shrink-0 mt-0.5">•</span>
                      <span>{{ t('sharingGuidelineZip') }}</span>
                    </li>
                    <li class="flex items-start gap-1.5">
                      <span class="text-sakura-300 shrink-0 mt-0.5">•</span>
                      <span class="font-medium text-ink-500">{{ t('sharingGuidelineZipExample') }}</span>
                    </li>
                    <li class="flex items-start gap-1.5">
                      <span class="text-sakura-300 shrink-0 mt-0.5">•</span>
                      <span>{{ t('sharingGuidelineOrigin') }}</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            <!-- Right: File upload zone (2/5 width) -->
            <div class="lg:col-span-2 flex flex-col gap-4">
              <div class="card p-6 flex-1 flex flex-col">
                <h3 class="font-display font-semibold text-ink-800 text-sm mb-4 flex items-center gap-2">
                  <FileArchive class="w-4 h-4 text-mint-400" />
                  {{ t('sharingFileUpload') }}
                </h3>

                <!-- Drop zone -->
                <div
                  @drop.prevent="handleDrop"
                  @dragover.prevent="dropHover = true"
                  @dragleave.prevent="dropHover = false"
                  @click="($refs.contribFileInput as HTMLInputElement)?.click()"
                  class="flex-1 min-h-[200px] flex flex-col items-center justify-center border-2 border-dashed rounded-2xl p-6 cursor-pointer transition-all duration-200"
                  :class="dropHover
                    ? 'border-sakura-400 bg-sakura-50/60 scale-[1.01]'
                    : uploadFile
                      ? 'border-mint-300 bg-mint-50/20'
                      : 'border-ink-200 hover:border-sakura-300 hover:bg-sakura-50/20'"
                >
                  <!-- Empty state -->
                  <template v-if="!uploadFile">
                    <div class="w-16 h-16 rounded-2xl bg-ink-50 flex items-center justify-center mb-3">
                      <CloudUpload class="w-8 h-8 text-ink-300" />
                    </div>
                    <p class="text-sm text-ink-500 font-medium text-center">{{ t('sharingDropZone') }}</p>
                    <p class="text-xs text-ink-300 mt-1">{{ t('sharingMaxSize') }}</p>
                  </template>
                  <!-- File selected -->
                  <template v-else>
                    <div class="w-16 h-16 rounded-2xl bg-mint-100 flex items-center justify-center mb-3">
                      <FileArchive class="w-8 h-8 text-mint-500" />
                    </div>
                    <p class="text-sm text-ink-700 font-semibold truncate max-w-full text-center">{{ uploadFile.name }}</p>
                    <KBadge variant="success" class="mt-2">{{ uploadDetected }}</KBadge>
                    <button
                      @click.stop="uploadFile = null; uploadDetected = ''"
                      class="mt-2 text-xs text-ink-400 hover:text-ink-600 transition-colors duration-150"
                    >
                      {{ t('sharingChangeFile') }}
                    </button>
                  </template>
                  <input ref="contribFileInput" type="file" accept=".zip" class="hidden" @change="handleFileSelect($event)" />
                </div>
              </div>

              <!-- Error message -->
              <div v-if="uploadError" class="card p-4 border-red-200 bg-red-50/50">
                <div class="flex items-start gap-2">
                  <AlertCircle class="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <p class="text-sm text-red-600">{{ uploadError }}</p>
                </div>
              </div>

              <!-- Upload progress -->
              <div v-if="uploadSubmitting" class="w-full">
                <div class="flex items-center justify-between text-xs text-ink-400 mb-1.5">
                  <span>{{ t('sharingUploading') }}</span>
                  <span class="font-mono">{{ uploadProgress }}%</span>
                </div>
                <div class="w-full h-2 rounded-full bg-ink-100 overflow-hidden">
                  <div
                    class="h-full rounded-full bg-gradient-to-r from-sakura-400 to-sakura-500 transition-all duration-300 ease-out"
                    :style="{ width: `${uploadProgress}%` }"
                  />
                </div>
              </div>

              <!-- Submit button -->
              <KButton
                variant="primary"
                size="lg"
                :disabled="!canSubmit"
                :loading="uploadSubmitting"
                @click="submitContribute"
                class="w-full justify-center"
              >
                <Upload class="w-4 h-4" />
                {{ t('sharingSubmit') }}
              </KButton>
            </div>
          </div>
        </template>
      </div>
    </Transition>



    <!-- ═══ Preview Modal ═══ -->
    <Teleport to="body">
      <Transition name="slide">
        <div v-if="showPreviewModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" @click.self="closePreview">
          <div class="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden">
            <div class="flex items-center justify-between px-6 py-4 border-b border-ink-100">
              <h3 class="font-display font-bold text-lg text-ink-900">{{ t('sharingPreviewTitle') }}</h3>
              <button @click="closePreview" class="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-ink-100 transition-colors">
                <X class="w-4 h-4 text-ink-400" />
              </button>
            </div>
            <div class="flex-1 overflow-y-auto p-6">
              <div v-if="previewLoading" class="flex justify-center py-8"><KSpinner /></div>
              <div v-else-if="previewError" class="text-sm text-red-600 p-4 rounded-xl bg-red-50">{{ previewError }}</div>
              <template v-else-if="previewData">
                <div class="flex gap-4 mb-4">
                  <KBadge variant="default">{{ t('sharingTotalFiles') }}: {{ previewData.totalFiles }}</KBadge>
                  <KBadge variant="sky">{{ t('sharingSubtitleFiles') }}: {{ previewData.subtitleFiles }}</KBadge>
                </div>
                <div class="divide-y divide-ink-100">
                  <div
                    v-for="file in previewData.files"
                    :key="file.name"
                    class="flex items-center gap-3 py-2 text-sm"
                  >
                    <FileArchive class="w-4 h-4 shrink-0" :class="file.isSubtitle ? 'text-sky-400' : 'text-ink-300'" />
                    <span class="flex-1 truncate text-ink-700">{{ file.name }}</span>
                    <KBadge v-if="file.isSubtitle" variant="sky" class="text-[10px]">{{ file.ext }}</KBadge>
                    <KBadge v-else variant="default" class="text-[10px]">{{ file.ext }}</KBadge>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- ═══ Edit Modal ═══ -->
    <Teleport to="body">
      <Transition name="slide">
        <div v-if="showEditModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" @click.self="closeEdit">
          <div class="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[80vh] flex flex-col overflow-hidden">
            <div class="flex items-center justify-between px-6 py-4 border-b border-ink-100">
              <h3 class="font-display font-bold text-lg text-ink-900">{{ t('sharingEditTitle') }}</h3>
              <button @click="closeEdit" class="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-ink-100 transition-colors">
                <X class="w-4 h-4 text-ink-400" />
              </button>
            </div>
            <div class="flex-1 overflow-y-auto p-6">
              <div class="flex flex-col gap-4">
                <div class="flex gap-3">
                  <div class="flex-1">
                    <label class="text-xs font-medium text-ink-500 mb-1.5 block">{{ t('sharingAnimeName') }}</label>
                    <input v-model="editForm.name_cn" class="w-full px-3.5 py-2.5 rounded-xl border border-ink-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sakura-300/50" />
                  </div>
                  <div class="w-20">
                    <label class="text-xs font-medium text-ink-500 mb-1.5 block">{{ t('sharingLetter') }}</label>
                    <input v-model="editForm.letter" maxlength="1" class="w-full px-3 py-2.5 rounded-xl border border-ink-200 text-sm text-center uppercase bg-white focus:outline-none focus:ring-2 focus:ring-sakura-300/50" />
                  </div>
                </div>
                <div class="flex gap-3">
                  <div class="w-32">
                    <label class="text-xs font-medium text-ink-500 mb-1.5 block">{{ t('sharingSeason') }}</label>
                    <select v-model="editForm.season" class="w-full px-3 py-2.5 rounded-xl border border-ink-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sakura-300/50">
                      <option v-for="s in ['S1','S2','S3','S4','Movie','SPs','OVA']" :key="s" :value="s">{{ s }}</option>
                    </select>
                  </div>
                  <div class="flex-1">
                    <label class="text-xs font-medium text-ink-500 mb-1.5 block">{{ t('sharingSubGroup') }}</label>
                    <input v-model="editForm.sub_group" class="w-full px-3.5 py-2.5 rounded-xl border border-ink-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sakura-300/50" />
                  </div>
                </div>
                <div>
                  <label class="text-xs font-medium text-ink-500 mb-2 block">{{ t('sharingLanguages') }}</label>
                  <div class="flex flex-wrap gap-2">
                    <button
                      v-for="lang in LANG_OPTIONS"
                      :key="lang"
                      @click="toggleEditLang(lang)"
                      class="px-3.5 py-2 rounded-xl text-xs font-medium border-2 transition-all duration-150"
                      :class="editForm.languages.includes(lang)
                        ? 'bg-sakura-50 border-sakura-300 text-sakura-700 shadow-sm'
                        : 'bg-white border-ink-100 text-ink-400 hover:border-sakura-200 hover:text-ink-600'"
                    >
                      {{ lang }}
                    </button>
                  </div>
                </div>
                <div class="flex gap-3">
                  <div class="w-32">
                    <label class="text-xs font-medium text-ink-500 mb-1.5 block">{{ t('sharingEpisodeCount') }}</label>
                    <input v-model.number="editForm.episode_count" type="number" min="0" class="w-full px-3 py-2.5 rounded-xl border border-ink-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sakura-300/50" />
                  </div>
                  <label class="flex items-center gap-2.5 text-sm text-ink-600 cursor-pointer select-none mt-auto pb-2.5">
                    <input type="checkbox" v-model="editForm.has_fonts" class="rounded border-ink-300 text-sakura-500 focus:ring-sakura-300" />
                    {{ t('sharingHasFonts') }}
                  </label>
                </div>
              </div>
            </div>
            <div class="px-6 py-4 border-t border-ink-100 flex justify-end gap-3">
              <KButton variant="secondary" @click="closeEdit">{{ t('cancel') }}</KButton>
              <KButton variant="primary" :loading="editSubmitting" @click="submitEdit">{{ t('save') }}</KButton>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

  </div>
</template>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.slide-enter-from {
  opacity: 0;
  transform: translateY(12px);
}
.slide-leave-to {
  opacity: 0;
  transform: translateY(-12px);
}
</style>
