<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { debounce } from "lodash-es";
import {
  Share2, Search, X, Tv,
  Paperclip, FolderOpen, ChevronRight, Home,
  CloudUpload,
} from "lucide-vue-next";
import KButton from "../components/KButton.vue";
import KBadge from "../components/KBadge.vue";
import KEmpty from "../components/KEmpty.vue";
import KSpinner from "../components/KSpinner.vue";
import ArchiveCard from "../components/ArchiveCard.vue";
import ArchivePreviewModal from "../components/ArchivePreviewModal.vue";
import ArchiveEditModal from "../components/ArchiveEditModal.vue";
import ContributeForm from "../components/ContributeForm.vue";
import type { SharedArchive } from "../api/client";
import {
  listSharedArchives,
  deleteArchive,
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

// Folder navigation
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

const filteredArchives = computed(() => {
  let list = archives.value;
  if (isSearching.value) {
    list = list.filter((a) => searchResultIds.value.has(a.id));
  }
  return list;
});

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

const seasonFolders = computed(() => {
  if (navDepth.value < 2) return { seasons: [], subEntries: null as string[] | null };
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

// ─── Contribute View ──────────────────────────────────────────────────────────

const showContributeView = ref(false);

function openContributeView() {
  showContributeView.value = true;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function closeContributeView() {
  showContributeView.value = false;
}

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
  } catch {
    // UI shows empty state
  } finally {
    loading.value = false;
  }
}

function downloadArchiveByUrl(archive: SharedArchive) {
  if (archive.download_url) {
    window.open(archive.download_url, "_blank");
  }
}

// ─── Admin: Preview / Edit ────────────────────────────────────────────────────

const previewArchiveId = ref<string | null>(null);
const editingArchive = ref<SharedArchive | null>(null);

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
          class="w-full pl-10 pr-10 py-2.5 rounded-xl border border-sakura-200 bg-surface text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-sakura-300/50"
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
      <ArchiveCard
        v-for="archive in seasonArchives"
        :key="archive.id"
        :archive="archive"
        :is-admin="isAdmin"
        @download="downloadArchiveByUrl(archive)"
        @preview="previewArchiveId = archive.id"
        @download-file="downloadFile(archive)"
        @edit="editingArchive = archive"
        @delete="confirmDelete(archive)"
      />
      <KEmpty v-if="seasonArchives.length === 0" :title="t('sharingNoResults')" />
    </div>

    <!-- ═══ Search Mode: Flat results ═══ -->
    <div v-if="!loading && isSearching && !showContributeView" class="mt-2">
      <p class="text-sm text-ink-400 mb-4">
        "<strong class="text-ink-600">{{ searchQuery }}</strong>"
        — {{ filteredArchives.length }}
      </p>

      <div class="flex flex-col gap-3">
        <ArchiveCard
          v-for="result in filteredArchives"
          :key="result.id"
          :archive="result"
          :is-admin="isAdmin"
          variant="search"
          @download="downloadArchiveByUrl(result)"
          @preview="previewArchiveId = result.id"
          @download-file="downloadFile(result)"
          @edit="editingArchive = result"
          @delete="confirmDelete(result)"
        />
      </div>

      <KEmpty v-if="filteredArchives.length === 0" :title="t('sharingNoResults')" :description="t('sharingNoResultsDesc')" />
    </div>

    <!-- ═══ Contribute Footer CTA ═══ -->
    <!-- Bottom contribute CTA removed — button now in header -->

    <!-- ═══ Contribute View (Inline Full-Page) ═══ -->
    <Transition name="slide">
      <ContributeForm
        v-if="showContributeView"
        :archives="archives"
        @close="closeContributeView"
        @submitted="loadArchives"
      />
    </Transition>



    <!-- ═══ Preview Modal ═══ -->
    <ArchivePreviewModal :archive-id="previewArchiveId" @close="previewArchiveId = null" />

    <!-- ═══ Edit Modal ═══ -->
    <ArchiveEditModal :archive="editingArchive" @close="editingArchive = null" @saved="loadArchives" />

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
