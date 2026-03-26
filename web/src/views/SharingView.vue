<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { debounce } from "lodash-es";
import {
  Share2, Search, X, Tv, Download, Clock, Upload, Heart,
  Paperclip, DatabaseZap, Check, XCircle, FileArchive,
} from "lucide-vue-next";
import KButton from "../components/KButton.vue";
import KBadge from "../components/KBadge.vue";
import KEmpty from "../components/KEmpty.vue";
import KSpinner from "../components/KSpinner.vue";
import { getApiKey } from "../api/client";
import type { SharedArchive } from "../api/client";
import {
  listSharedArchives,
  listPendingArchives,
  uploadSharedArchive,
  contributeArchive,
  approveArchive,
  rejectArchive,
  importIndexSSE,
} from "../api/client";
import { buildSearchIndex, searchArchives, clearSearchIndex } from "../lib/search";

const { t } = useI18n();

// ─── State ────────────────────────────────────────────────────────────────────

const loading = ref(true);
const archives = ref<SharedArchive[]>([]);
const pendingArchives = ref<SharedArchive[]>([]);
const hasApiKey = computed(() => !!getApiKey());

// Search & filter
const searchQuery = ref("");
const filterLang = ref("");
const filterGroup = ref("");
const isSearching = computed(() => searchQuery.value.trim().length > 0);
const searchResultIds = ref<Set<string>>(new Set());

// Letter navigation
const activeLetter = ref("");
const availableLetters = computed(() => {
  const letters = new Set(archives.value.map((a) => a.letter));
  return [...letters].sort();
});

// Unique languages and sub groups for filter dropdowns
const allLanguages = computed(() => {
  const langs = new Set<string>();
  for (const a of archives.value) {
    try { for (const l of JSON.parse(a.languages)) langs.add(l); } catch {}
  }
  return [...langs].sort();
});

const allSubGroups = computed(() => {
  const groups = new Set<string>();
  for (const a of archives.value) groups.add(a.sub_group);
  return [...groups].sort();
});

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

// ─── Grouped data for browse mode ─────────────────────────────────────────────

interface AnimeGroup {
  name_cn: string;
  seasons: { name: string; archives: SharedArchive[] }[];
  totalSeasons: number;
  totalArchives: number;
  sub_entries: string[] | null;
}

const filteredArchives = computed(() => {
  let list = archives.value;
  if (filterLang.value) {
    list = list.filter((a) => {
      try { return JSON.parse(a.languages).includes(filterLang.value); } catch { return false; }
    });
  }
  if (filterGroup.value) {
    list = list.filter((a) => a.sub_group === filterGroup.value);
  }
  if (isSearching.value) {
    list = list.filter((a) => searchResultIds.value.has(a.id));
  }
  return list;
});

const groupedData = computed(() => {
  const byLetter = new Map<string, Map<string, SharedArchive[]>>();

  for (const a of filteredArchives.value) {
    if (!byLetter.has(a.letter)) byLetter.set(a.letter, new Map());
    const letterMap = byLetter.get(a.letter)!;
    if (!letterMap.has(a.name_cn)) letterMap.set(a.name_cn, []);
    letterMap.get(a.name_cn)!.push(a);
  }

  const result: [string, AnimeGroup[]][] = [];
  for (const [letter, animeMap] of [...byLetter].sort(([a], [b]) => a.localeCompare(b))) {
    const animes: AnimeGroup[] = [];
    for (const [name_cn, archiveList] of [...animeMap].sort(([a], [b]) => a.localeCompare(b))) {
      const seasonMap = new Map<string, SharedArchive[]>();
      for (const a of archiveList) {
        if (!seasonMap.has(a.season)) seasonMap.set(a.season, []);
        seasonMap.get(a.season)!.push(a);
      }

      let subEntries: string[] | null = null;
      for (const a of archiveList) {
        if (a.sub_entries) {
          try { subEntries = JSON.parse(a.sub_entries); } catch {}
          break;
        }
      }

      animes.push({
        name_cn,
        seasons: [...seasonMap]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, archives]) => ({ name, archives })),
        totalSeasons: seasonMap.size,
        totalArchives: archiveList.length,
        sub_entries: subEntries,
      });
    }
    result.push([letter, animes]);
  }
  return result;
});

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

// ─── Letter navigation ───────────────────────────────────────────────────────

function scrollToLetter(letter: string) {
  const el = document.getElementById(`letter-${letter}`);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ─── Modals ───────────────────────────────────────────────────────────────────

const showUploadModal = ref(false);
const showContributeModal = ref(false);
const showPendingPanel = ref(false);
const showImportModal = ref(false);

// Upload form state
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

// Import state
const importProgress = ref<{ phase: string; message?: string; current?: number; total?: number }>({ phase: "idle" });
const isImporting = ref(false);

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function loadArchives() {
  loading.value = true;
  try {
    archives.value = await listSharedArchives();
    // Build search index
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

async function loadPending() {
  if (!hasApiKey.value) return;
  try {
    pendingArchives.value = await listPendingArchives();
  } catch (e) {
    console.error("Failed to load pending:", e);
  }
}

function handleFileSelect(e: Event, isContribute = false) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    uploadFile.value = file;
    uploadDetected.value = `${formatSize(file.size)}`;
  }
}

function handleDrop(e: DragEvent) {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (file && file.name.endsWith(".zip")) {
    uploadFile.value = file;
    uploadDetected.value = `${formatSize(file.size)}`;
  }
}

async function submitUpload(isContribute: boolean) {
  if (!uploadFile.value || uploadSubmitting.value) return;

  const meta = {
    name_cn: uploadForm.value.name_cn,
    letter: uploadForm.value.letter.toUpperCase(),
    season: uploadForm.value.season,
    sub_group: uploadForm.value.sub_group,
    languages: uploadForm.value.languages,
    has_fonts: uploadForm.value.has_fonts,
    ...(isContribute ? { contributor: uploadForm.value.contributor || undefined } : {}),
  };

  uploadSubmitting.value = true;
  try {
    if (isContribute) {
      await contributeArchive(uploadFile.value, meta);
      showContributeModal.value = false;
    } else {
      await uploadSharedArchive(uploadFile.value, meta);
      showUploadModal.value = false;
    }
    resetForm();
    await loadArchives();
    if (hasApiKey.value) await loadPending();
  } catch (e) {
    console.error("Upload error:", e);
    alert(String(e));
  } finally {
    uploadSubmitting.value = false;
  }
}

function resetForm() {
  uploadForm.value = { name_cn: "", letter: "", season: "S1", sub_group: "", languages: [], has_fonts: false, contributor: "" };
  uploadFile.value = null;
  uploadDetected.value = "";
}

async function handleApprove(id: string) {
  try {
    await approveArchive(id);
    await loadPending();
    await loadArchives();
  } catch (e) {
    alert(String(e));
  }
}

async function handleReject(id: string) {
  try {
    await rejectArchive(id);
    await loadPending();
  } catch (e) {
    alert(String(e));
  }
}

function startImport() {
  isImporting.value = true;
  showImportModal.value = true;
  importProgress.value = { phase: "index", message: "Starting import..." };

  importIndexSSE(
    (data) => { importProgress.value = data; },
    () => { isImporting.value = false; loadArchives(); if (hasApiKey.value) loadPending(); },
    (err) => { isImporting.value = false; importProgress.value = { phase: "error", message: err }; },
  );
}

function downloadArchive(archive: SharedArchive) {
  if (archive.download_url) {
    window.open(archive.download_url, "_blank");
  }
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

const LANG_OPTIONS = ["chs", "cht", "jpn", "chs_jpn", "cht_jpn", "sc", "tc", "eng"];

function toggleLang(lang: string) {
  const idx = uploadForm.value.languages.indexOf(lang);
  if (idx >= 0) uploadForm.value.languages.splice(idx, 1);
  else uploadForm.value.languages.push(lang);
}

// Auto-generate letter from name
watch(() => uploadForm.value.name_cn, (name) => {
  if (name && !uploadForm.value.letter) {
    const first = name.charAt(0).toUpperCase();
    if (/[A-Z]/.test(first)) uploadForm.value.letter = first;
  }
});

onMounted(() => {
  loadArchives();
  if (hasApiKey.value) loadPending();
});
</script>

<template>
  <div class="flex flex-col gap-6 animate-fade-in">

    <!-- ═══ Header: Stats + Search + Admin ═══ -->
    <section class="card p-6 bg-gradient-to-br from-white to-sakura-50/40">
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

        <div v-if="hasApiKey" class="flex gap-2 shrink-0 flex-wrap">
          <KButton variant="ghost" size="sm" @click="showPendingPanel = !showPendingPanel">
            <Clock class="w-4 h-4" />
            {{ t('sharingPending') }}
            <KBadge v-if="pendingArchives.length > 0" variant="warning">{{ pendingArchives.length }}</KBadge>
          </KButton>
          <KButton variant="ghost" size="sm" @click="showUploadModal = true">
            <Upload class="w-4 h-4" />
            {{ t('sharingAdminUpload') }}
          </KButton>
          <KButton variant="ghost" size="sm" @click="startImport" :disabled="isImporting">
            <DatabaseZap class="w-4 h-4" />
            {{ t('sharingImportIndex') }}
          </KButton>
        </div>
      </div>

      <!-- Search + Filters -->
      <div class="flex flex-col sm:flex-row gap-3">
        <div class="relative flex-1">
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
        <div class="flex gap-2">
          <select
            v-model="filterLang"
            class="h-10 rounded-xl border border-sakura-200 bg-white px-3 text-sm text-ink-600"
          >
            <option value="">{{ t('sharingAllLanguages') }}</option>
            <option v-for="lang in allLanguages" :key="lang" :value="lang">{{ lang }}</option>
          </select>
          <select
            v-model="filterGroup"
            class="h-10 rounded-xl border border-sakura-200 bg-white px-3 text-sm text-ink-600"
          >
            <option value="">{{ t('sharingAllGroups') }}</option>
            <option v-for="group in allSubGroups" :key="group" :value="group">{{ group }}</option>
          </select>
        </div>
      </div>
    </section>

    <!-- ═══ Pending Review Panel (Admin) ═══ -->
    <section v-if="showPendingPanel && hasApiKey && pendingArchives.length > 0" class="card p-4">
      <h3 class="font-display font-semibold text-ink-800 text-sm mb-3 flex items-center gap-2">
        <Clock class="w-4 h-4 text-amber-500" />
        {{ t('sharingPending') }} ({{ pendingArchives.length }})
      </h3>
      <div class="flex flex-col gap-2">
        <div
          v-for="pa in pendingArchives"
          :key="pa.id"
          class="flex items-center gap-3 p-3 rounded-xl bg-amber-50/50 border border-amber-200/50"
        >
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-ink-800 truncate">
              {{ pa.name_cn }} {{ pa.season }} · {{ pa.sub_group }}
            </p>
            <p class="text-xs text-ink-400">
              {{ pa.contributor || 'anonymous' }} · {{ formatSize(pa.file_size) }} · {{ pa.filename }}
            </p>
          </div>
          <KButton variant="ghost" size="sm" @click="handleApprove(pa.id)">
            <Check class="w-4 h-4 text-mint-500" />
            {{ t('sharingApprove') }}
          </KButton>
          <KButton variant="ghost" size="sm" @click="handleReject(pa.id)">
            <XCircle class="w-4 h-4 text-rose-400" />
            {{ t('sharingReject') }}
          </KButton>
        </div>
      </div>
    </section>

    <!-- ═══ Import Progress ═══ -->
    <section v-if="showImportModal" class="card p-4">
      <h3 class="font-display font-semibold text-ink-800 text-sm mb-2 flex items-center gap-2">
        <DatabaseZap class="w-4 h-4 text-sakura-500" />
        {{ isImporting ? t('sharingImporting') : t('sharingImportDone') }}
      </h3>
      <div class="text-sm text-ink-500">
        <p v-if="importProgress.message">{{ importProgress.message }}</p>
        <p v-if="importProgress.current != null">
          {{ importProgress.current }} / {{ importProgress.total }}
          <span v-if="importProgress.name" class="text-ink-400">— {{ importProgress.name }}</span>
        </p>
        <p v-if="importProgress.phase === 'done'" class="text-mint-600 font-medium mt-1">
          ✓ {{ t('sharingImportDone') }}:
          {{ (importProgress as any).imported }} imported,
          {{ (importProgress as any).skipped }} skipped,
          {{ (importProgress as any).errors }} errors
          ({{ (importProgress as any).elapsed }})
        </p>
        <p v-if="importProgress.phase === 'error'" class="text-rose-500 font-medium mt-1">
          ✗ {{ importProgress.message }}
        </p>
      </div>
      <KButton v-if="!isImporting" variant="ghost" size="sm" class="mt-2" @click="showImportModal = false">
        {{ t('cancel') }}
      </KButton>
    </section>

    <!-- ═══ Loading ═══ -->
    <div v-if="loading" class="flex justify-center py-16">
      <KSpinner />
    </div>

    <!-- ═══ Empty State ═══ -->
    <KEmpty
      v-else-if="archives.length === 0"
      :title="t('sharingNoArchives')"
      :description="t('sharingNoArchivesDesc')"
    />

    <!-- ═══ Letter Navigation (Sticky) ═══ -->
    <nav
      v-if="!loading && archives.length > 0 && !isSearching"
      class="sticky top-14 z-20 bg-bg/80 backdrop-blur-sm border-b border-sakura-100/40 py-2 -mx-4 px-4"
    >
      <div class="flex flex-wrap gap-1.5 justify-center max-w-4xl mx-auto">
        <button
          v-for="letter in availableLetters"
          :key="letter"
          @click="scrollToLetter(letter)"
          class="w-8 h-8 rounded-lg text-xs font-semibold transition-all duration-200"
          :class="activeLetter === letter
            ? 'bg-sakura-400 text-white shadow-sm'
            : 'bg-white text-ink-500 border border-sakura-100 hover:bg-sakura-50 hover:text-sakura-600'"
        >
          {{ letter }}
        </button>
      </div>
    </nav>

    <!-- ═══ Browse Mode: Grouped by letter → anime → season ═══ -->
    <div v-if="!loading && archives.length > 0 && !isSearching">
      <template v-for="[letter, animes] in groupedData" :key="letter">
        <!-- Letter divider -->
        <div :id="`letter-${letter}`" class="flex items-center gap-3 mt-8 mb-4 scroll-mt-28">
          <span class="font-display font-bold text-xl text-sakura-400">{{ letter }}</span>
          <div class="flex-1 h-px bg-sakura-200/60"></div>
          <span class="text-xs text-ink-300">{{ animes.length }}</span>
        </div>

        <!-- Anime cards -->
        <div class="flex flex-col gap-4">
          <div v-for="anime in animes" :key="anime.name_cn" class="card overflow-hidden">
            <!-- Anime header -->
            <div class="flex items-center gap-3 px-5 py-4 border-b border-sakura-100/60">
              <div class="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center shrink-0">
                <Tv class="w-4 h-4 text-sky-500" />
              </div>
              <h3 class="font-display font-semibold text-ink-900 text-base flex-1 min-w-0 truncate">
                {{ anime.name_cn }}
              </h3>
              <span class="text-xs text-ink-300 shrink-0">
                {{ anime.totalSeasons }} {{ t('sharingSeasons') }} · {{ anime.totalArchives }} {{ t('sharingArchives') }}
              </span>
            </div>

            <!-- Seasons and archives -->
            <div class="divide-y divide-sakura-50">
              <div v-for="season in anime.seasons" :key="season.name">
                <div class="px-5 pt-3 pb-1">
                  <span class="text-xs font-semibold text-ink-400 uppercase tracking-wider">{{ season.name }}</span>
                </div>

                <div
                  v-for="archive in season.archives"
                  :key="archive.id"
                  class="flex items-center gap-3 px-5 py-3 hover:bg-sakura-50/40 transition-colors duration-150 group"
                >
                  <KBadge variant="sakura" class="shrink-0 max-w-[120px] truncate">
                    {{ archive.sub_group }}
                  </KBadge>

                  <div class="flex items-center gap-1.5 flex-1 min-w-0 flex-wrap">
                    <span v-if="archive.episode_count" class="text-xs text-ink-400">
                      {{ archive.episode_count }} {{ t('sharingEpisodes') }}
                    </span>
                    <KBadge v-for="fmt in parseFmts(archive.subtitle_format)" :key="fmt" variant="default" class="text-[10px] px-1.5 py-0.5">
                      {{ fmt }}
                    </KBadge>
                    <KBadge v-for="lang in parseLangs(archive.languages)" :key="lang" variant="sky" class="text-[10px] px-1.5 py-0.5">
                      {{ lang }}
                    </KBadge>
                    <KBadge v-if="archive.has_fonts" variant="success" class="text-[10px] px-1.5 py-0.5">
                      {{ t('sharingFont') }}
                    </KBadge>
                  </div>

                  <span class="text-xs text-ink-300 shrink-0 tabular-nums">
                    {{ formatSize(archive.file_size) }}
                  </span>

                  <button
                    @click="downloadArchive(archive)"
                    class="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-ink-300 hover:text-sakura-500 hover:bg-sakura-100 opacity-0 group-hover:opacity-100 transition-all duration-200 active:scale-95"
                    :title="t('download')"
                  >
                    <Download class="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            <!-- Sub-entries -->
            <div v-if="anime.sub_entries?.length" class="px-5 py-2.5 bg-sakura-50/30 border-t border-sakura-100/60">
              <p class="text-[11px] text-ink-400 flex items-center gap-1.5">
                <Paperclip class="w-3 h-3 shrink-0" />
                {{ t('sharingIncludes') }}: {{ anime.sub_entries.join(' · ') }}
              </p>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- ═══ Search Mode: Flat results ═══ -->
    <div v-if="!loading && isSearching" class="mt-2">
      <p class="text-sm text-ink-400 mb-4">
        "<strong class="text-ink-600">{{ searchQuery }}</strong>"
        — {{ filteredArchives.length }}
      </p>

      <div class="flex flex-col gap-3">
        <div
          v-for="result in filteredArchives"
          :key="result.id"
          class="card p-4 flex items-center gap-4 hover:shadow-md transition-shadow duration-200"
        >
          <div class="flex-1 min-w-0">
            <p class="font-display font-medium text-sm text-ink-900 truncate">{{ result.name_cn }}</p>
            <p class="text-xs text-ink-400 mt-0.5">
              {{ result.season }} ·
              <span class="text-sakura-400">{{ result.sub_group }}</span> ·
              {{ result.episode_count }} {{ t('sharingEpisodes') }}
            </p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <KBadge v-for="lang in parseLangs(result.languages)" :key="lang" variant="sky" class="text-[10px]">{{ lang }}</KBadge>
            <span class="text-xs text-ink-300 tabular-nums">{{ formatSize(result.file_size) }}</span>
            <button
              @click="downloadArchive(result)"
              class="w-8 h-8 rounded-lg flex items-center justify-center text-sakura-400 hover:text-sakura-600 hover:bg-sakura-100 transition-colors duration-150 active:scale-95"
            >
              <Download class="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <KEmpty v-if="filteredArchives.length === 0" :title="t('sharingNoResults')" :description="t('sharingNoResultsDesc')" />
    </div>

    <!-- ═══ Contribute Footer ═══ -->
    <section v-if="!loading && archives.length > 0" class="card p-6 text-center mt-4">
      <div class="w-11 h-11 rounded-xl bg-mint-100 flex items-center justify-center mx-auto mb-3">
        <Heart class="w-5 h-5 text-mint-500" />
      </div>
      <h3 class="font-display font-semibold text-ink-800 text-base mb-1">
        {{ t('sharingContributeTitle') }}
      </h3>
      <p class="text-sm text-ink-400 mb-4 max-w-md mx-auto leading-relaxed">
        {{ t('sharingContributeDesc') }}
      </p>
      <KButton variant="secondary" @click="showContributeModal = true">
        <Upload class="w-4 h-4" />
        {{ t('sharingContributeButton') }}
      </KButton>
    </section>

    <!-- ═══ Upload Modal (Admin) ═══ -->
    <Transition name="modal">
      <div v-if="showUploadModal" class="fixed inset-0 z-50 flex items-center justify-center p-4" @click.self="showUploadModal = false">
        <div class="absolute inset-0 bg-ink-950/30 backdrop-blur-sm"></div>
        <div class="card p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto relative z-10 animate-scale-in">
          <h2 class="font-display font-bold text-lg text-ink-900 mb-4">{{ t('sharingUploadTitle') }}</h2>

          <!-- Form fields -->
          <div class="flex flex-col gap-3">
            <div>
              <label class="text-xs font-medium text-ink-500 mb-1 block">{{ t('sharingAnimeName') }} *</label>
              <input v-model="uploadForm.name_cn" class="w-full px-3 py-2 rounded-lg border border-sakura-200 text-sm" />
            </div>
            <div class="flex gap-3">
              <div class="w-20">
                <label class="text-xs font-medium text-ink-500 mb-1 block">{{ t('sharingLetter') }}</label>
                <input v-model="uploadForm.letter" maxlength="1" class="w-full px-3 py-2 rounded-lg border border-sakura-200 text-sm uppercase" />
              </div>
              <div class="flex-1">
                <label class="text-xs font-medium text-ink-500 mb-1 block">{{ t('sharingSeason') }} *</label>
                <select v-model="uploadForm.season" class="w-full px-3 py-2 rounded-lg border border-sakura-200 text-sm">
                  <option v-for="s in ['S1','S2','S3','S4','Movie','SPs','OVA']" :key="s" :value="s">{{ s }}</option>
                </select>
              </div>
            </div>
            <div>
              <label class="text-xs font-medium text-ink-500 mb-1 block">{{ t('sharingSubGroup') }} *</label>
              <input v-model="uploadForm.sub_group" class="w-full px-3 py-2 rounded-lg border border-sakura-200 text-sm" />
            </div>
            <div>
              <label class="text-xs font-medium text-ink-500 mb-1 block">{{ t('sharingLanguages') }} *</label>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="lang in LANG_OPTIONS"
                  :key="lang"
                  @click="toggleLang(lang)"
                  class="px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors"
                  :class="uploadForm.languages.includes(lang)
                    ? 'bg-sakura-100 border-sakura-300 text-sakura-700'
                    : 'bg-white border-ink-200 text-ink-400 hover:border-sakura-200'"
                >
                  {{ lang }}
                </button>
              </div>
            </div>
            <label class="flex items-center gap-2 text-sm text-ink-600">
              <input type="checkbox" v-model="uploadForm.has_fonts" class="rounded" />
              {{ t('sharingHasFonts') }}
            </label>

            <!-- File drop zone -->
            <div
              @drop.prevent="handleDrop"
              @dragover.prevent
              class="border-2 border-dashed border-sakura-200 rounded-xl p-6 text-center cursor-pointer hover:border-sakura-300 transition-colors"
              @click="($refs.fileInput as HTMLInputElement)?.click()"
            >
              <FileArchive class="w-8 h-8 text-ink-300 mx-auto mb-2" />
              <p class="text-sm text-ink-500">{{ t('sharingDropZone') }}</p>
              <p class="text-xs text-ink-300 mt-1">{{ t('sharingMaxSize') }}</p>
              <p v-if="uploadFile" class="text-xs text-sakura-500 mt-2 font-medium">
                {{ uploadFile.name }} ({{ uploadDetected }})
              </p>
              <input ref="fileInput" type="file" accept=".zip" class="hidden" @change="handleFileSelect($event)" />
            </div>
          </div>

          <div class="flex justify-end gap-2 mt-4">
            <KButton variant="ghost" @click="showUploadModal = false; resetForm()">{{ t('cancel') }}</KButton>
            <KButton
              variant="primary"
              :disabled="!uploadForm.name_cn || !uploadForm.sub_group || !uploadForm.languages.length || !uploadFile || uploadSubmitting"
              @click="submitUpload(false)"
            >
              <Upload class="w-4 h-4" />
              {{ t('sharingPublish') }}
            </KButton>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ═══ Contribute Modal (Public) ═══ -->
    <Transition name="modal">
      <div v-if="showContributeModal" class="fixed inset-0 z-50 flex items-center justify-center p-4" @click.self="showContributeModal = false">
        <div class="absolute inset-0 bg-ink-950/30 backdrop-blur-sm"></div>
        <div class="card p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto relative z-10 animate-scale-in">
          <h2 class="font-display font-bold text-lg text-ink-900 mb-4">{{ t('sharingContributeFormTitle') }}</h2>

          <div class="flex flex-col gap-3">
            <div>
              <label class="text-xs font-medium text-ink-500 mb-1 block">{{ t('sharingAnimeName') }} *</label>
              <input v-model="uploadForm.name_cn" class="w-full px-3 py-2 rounded-lg border border-sakura-200 text-sm" />
            </div>
            <div class="flex gap-3">
              <div class="w-20">
                <label class="text-xs font-medium text-ink-500 mb-1 block">{{ t('sharingLetter') }}</label>
                <input v-model="uploadForm.letter" maxlength="1" class="w-full px-3 py-2 rounded-lg border border-sakura-200 text-sm uppercase" />
              </div>
              <div class="flex-1">
                <label class="text-xs font-medium text-ink-500 mb-1 block">{{ t('sharingSeason') }} *</label>
                <select v-model="uploadForm.season" class="w-full px-3 py-2 rounded-lg border border-sakura-200 text-sm">
                  <option v-for="s in ['S1','S2','S3','S4','Movie','SPs','OVA']" :key="s" :value="s">{{ s }}</option>
                </select>
              </div>
            </div>
            <div>
              <label class="text-xs font-medium text-ink-500 mb-1 block">{{ t('sharingSubGroup') }} *</label>
              <input v-model="uploadForm.sub_group" class="w-full px-3 py-2 rounded-lg border border-sakura-200 text-sm" />
            </div>
            <div>
              <label class="text-xs font-medium text-ink-500 mb-1 block">{{ t('sharingLanguages') }} *</label>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="lang in LANG_OPTIONS"
                  :key="lang"
                  @click="toggleLang(lang)"
                  class="px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors"
                  :class="uploadForm.languages.includes(lang)
                    ? 'bg-sakura-100 border-sakura-300 text-sakura-700'
                    : 'bg-white border-ink-200 text-ink-400 hover:border-sakura-200'"
                >
                  {{ lang }}
                </button>
              </div>
            </div>
            <label class="flex items-center gap-2 text-sm text-ink-600">
              <input type="checkbox" v-model="uploadForm.has_fonts" class="rounded" />
              {{ t('sharingHasFonts') }}
            </label>
            <div>
              <label class="text-xs font-medium text-ink-500 mb-1 block">{{ t('sharingContributor') }}</label>
              <input v-model="uploadForm.contributor" class="w-full px-3 py-2 rounded-lg border border-sakura-200 text-sm" :placeholder="t('sharingContributorPlaceholder')" />
            </div>

            <div
              @drop.prevent="handleDrop"
              @dragover.prevent
              class="border-2 border-dashed border-sakura-200 rounded-xl p-6 text-center cursor-pointer hover:border-sakura-300 transition-colors"
              @click="($refs.contribFileInput as HTMLInputElement)?.click()"
            >
              <FileArchive class="w-8 h-8 text-ink-300 mx-auto mb-2" />
              <p class="text-sm text-ink-500">{{ t('sharingDropZone') }}</p>
              <p class="text-xs text-ink-300 mt-1">{{ t('sharingMaxSize') }}</p>
              <p v-if="uploadFile" class="text-xs text-sakura-500 mt-2 font-medium">
                {{ uploadFile.name }} ({{ uploadDetected }})
              </p>
              <input ref="contribFileInput" type="file" accept=".zip" class="hidden" @change="handleFileSelect($event, true)" />
            </div>
          </div>

          <div class="flex justify-end gap-2 mt-4">
            <KButton variant="ghost" @click="showContributeModal = false; resetForm()">{{ t('cancel') }}</KButton>
            <KButton
              variant="primary"
              :disabled="!uploadForm.name_cn || !uploadForm.sub_group || !uploadForm.languages.length || !uploadFile || uploadSubmitting"
              @click="submitUpload(true)"
            >
              <Upload class="w-4 h-4" />
              {{ t('sharingSubmit') }}
            </KButton>
          </div>
        </div>
      </div>
    </Transition>

  </div>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
