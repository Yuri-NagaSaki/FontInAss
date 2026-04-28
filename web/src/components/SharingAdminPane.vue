<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import {
  Clock, RefreshCcw, FileArchive, Upload, X,
  DatabaseZap, Loader2, ChevronDown, CheckCheck, XOctagon,
  Inbox, CloudUpload,
} from "lucide-vue-next";
import {
  listPendingArchives, uploadSharedArchive,
  approveArchive, rejectArchive, importIndexSSE,
} from "../api/client";
import type { SharedArchive } from "../api/client";
import { useConfirm } from "../composables/useConfirm";
import KButton from "./KButton.vue";
import KSpinner from "./KSpinner.vue";
import KBadge from "./KBadge.vue";
import PendingArchiveRow from "./PendingArchiveRow.vue";
import { formatBytes } from "../lib/format";

const { t } = useI18n();

// ─── Pending Archives ─────────────────────────────────────────────────────────

const pendingArchives = ref<SharedArchive[]>([]);
const pendingLoading = ref(false);
const lastLoadedAt = ref<number | null>(null);
const busyIds = ref<Set<string>>(new Set());
const selectedIds = ref<Set<string>>(new Set());

const selectionCount = computed(() => selectedIds.value.size);
const allSelected = computed(() =>
  pendingArchives.value.length > 0 &&
  pendingArchives.value.every((a) => selectedIds.value.has(a.id)),
);

async function loadPending(showSpinner = true) {
  if (showSpinner) pendingLoading.value = true;
  try {
    const data = await listPendingArchives();
    pendingArchives.value = data;
    lastLoadedAt.value = Date.now();
    // Drop selections for items no longer present
    const present = new Set(data.map((a) => a.id));
    for (const id of [...selectedIds.value]) {
      if (!present.has(id)) selectedIds.value.delete(id);
    }
  } catch (e) {
    toast.error(String(e instanceof Error ? e.message : e));
  } finally {
    pendingLoading.value = false;
  }
}

function toggleSelect(id: string) {
  if (selectedIds.value.has(id)) selectedIds.value.delete(id);
  else selectedIds.value.add(id);
  // trigger reactivity
  selectedIds.value = new Set(selectedIds.value);
}

function toggleSelectAll() {
  if (allSelected.value) {
    selectedIds.value = new Set();
  } else {
    selectedIds.value = new Set(pendingArchives.value.map((a) => a.id));
  }
}

function clearSelection() {
  selectedIds.value = new Set();
}

function removeFromList(id: string) {
  pendingArchives.value = pendingArchives.value.filter((a) => a.id !== id);
  selectedIds.value.delete(id);
  selectedIds.value = new Set(selectedIds.value);
}

function setBusy(id: string, busy: boolean) {
  if (busy) busyIds.value.add(id);
  else busyIds.value.delete(id);
  busyIds.value = new Set(busyIds.value);
}

async function handleApprove(id: string) {
  setBusy(id, true);
  try {
    await approveArchive(id);
    toast.success(t("sharingApproveSuccess"));
    removeFromList(id);
  } catch (e) {
    toast.error(String(e instanceof Error ? e.message : e));
  } finally {
    setBusy(id, false);
  }
}

async function handleReject(id: string) {
  setBusy(id, true);
  try {
    await rejectArchive(id);
    toast.success(t("sharingRejectSuccess"));
    removeFromList(id);
  } catch (e) {
    toast.error(String(e instanceof Error ? e.message : e));
  } finally {
    setBusy(id, false);
  }
}

// ── Bulk actions ─────────────────────────────────────────────────────────────
const bulkRunning = ref(false);

async function bulkAction(action: "approve" | "reject") {
  if (bulkRunning.value || selectedIds.value.size === 0) return;
  const ids = [...selectedIds.value];
  if (action === "reject") {
    const { confirm } = useConfirm();
    const ok = await confirm({
      title: t("sharingBulkRejectTitle"),
      message: t("sharingBulkRejectConfirm", { n: ids.length }),
      variant: "danger",
      confirmText: t("sharingReject"),
    });
    if (!ok) return;
  }
  bulkRunning.value = true;
  let ok = 0, fail = 0;
  // Run with limited concurrency to avoid hammering R2
  const CONCURRENCY = 3;
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, ids.length) }, async () => {
      while (cursor < ids.length) {
        const id = ids[cursor++];
        setBusy(id, true);
        try {
          if (action === "approve") await approveArchive(id);
          else await rejectArchive(id);
          removeFromList(id);
          ok++;
        } catch {
          fail++;
        } finally {
          setBusy(id, false);
        }
      }
    }),
  );
  bulkRunning.value = false;
  if (fail === 0) toast.success(t("sharingBulkSuccess", { n: ok }));
  else toast.error(t("sharingBulkPartial", { ok, fail }));
}

// ── Last refreshed display ────────────────────────────────────────────────────
const lastRefreshedText = computed(() => {
  if (!lastLoadedAt.value) return "";
  const diff = Math.floor((nowTick.value - lastLoadedAt.value) / 1000);
  if (diff < 5) return t("justNow");
  if (diff < 60) return t("secondsAgo", { n: diff });
  const min = Math.floor(diff / 60);
  return t("minutesAgo", { n: min });
});
const nowTick = ref(Date.now());
let tickTimer: number | undefined;
onMounted(() => {
  loadPending();
  tickTimer = window.setInterval(() => { nowTick.value = Date.now(); }, 15_000);
});
onBeforeUnmount(() => {
  if (tickTimer) window.clearInterval(tickTimer);
});

// ─── Admin Upload Form (collapsible) ──────────────────────────────────────────

const uploadOpen = ref(false);
const sharingUploadForm = ref({
  name_cn: "",
  letter: "",
  season: "S1",
  sub_group: "",
  languages: [] as string[],
  has_fonts: false,
});
const sharingUploadFile = ref<File | null>(null);
const sharingUploadSubmitting = ref(false);
const sharingUploadDetected = ref("");
const sharingDropHover = ref(false);
const SHARING_LANG_OPTIONS = ["chs", "cht", "jpn", "chs_jpn", "cht_jpn", "sc", "tc", "eng"];
const SEASON_OPTIONS = ["S1", "S2", "S3", "S4", "Movie", "SPs", "OVA", "合集"];

function sharingToggleLang(lang: string) {
  const idx = sharingUploadForm.value.languages.indexOf(lang);
  if (idx >= 0) sharingUploadForm.value.languages.splice(idx, 1);
  else sharingUploadForm.value.languages.push(lang);
}

function sharingHandleFileSelect(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    sharingUploadFile.value = file;
    sharingUploadDetected.value = formatBytes(file.size);
  }
}

function sharingHandleDrop(e: DragEvent) {
  e.preventDefault();
  sharingDropHover.value = false;
  const file = e.dataTransfer?.files[0];
  if (file && /\.(zip|7z)$/i.test(file.name)) {
    sharingUploadFile.value = file;
    sharingUploadDetected.value = formatBytes(file.size);
  }
}

function sharingResetForm() {
  sharingUploadForm.value = { name_cn: "", letter: "", season: "S1", sub_group: "", languages: [], has_fonts: false };
  sharingUploadFile.value = null;
  sharingUploadDetected.value = "";
}

const canUpload = computed(() =>
  !!sharingUploadForm.value.name_cn.trim() &&
  !!sharingUploadForm.value.sub_group.trim() &&
  sharingUploadForm.value.languages.length > 0 &&
  !!sharingUploadFile.value &&
  !sharingUploadSubmitting.value
);

async function sharingSubmitUpload() {
  if (!sharingUploadFile.value || sharingUploadSubmitting.value) return;
  if (!sharingUploadForm.value.letter.trim() && sharingUploadForm.value.name_cn.trim()) {
    const first = sharingUploadForm.value.name_cn.trim().charAt(0).toUpperCase();
    if (/[A-Z]/.test(first)) sharingUploadForm.value.letter = first;
  }
  const meta = {
    name_cn: sharingUploadForm.value.name_cn.trim(),
    letter: sharingUploadForm.value.letter.toUpperCase().trim() || "?",
    season: sharingUploadForm.value.season,
    sub_group: sharingUploadForm.value.sub_group.trim(),
    languages: sharingUploadForm.value.languages,
    has_fonts: sharingUploadForm.value.has_fonts,
  };
  sharingUploadSubmitting.value = true;
  try {
    await uploadSharedArchive(sharingUploadFile.value, meta);
    toast.success(t("sharingPublished"));
    sharingResetForm();
    uploadOpen.value = false;
  } catch (e) {
    toast.error(String(e instanceof Error ? e.message : e));
  } finally {
    sharingUploadSubmitting.value = false;
  }
}

// ─── Import Index ─────────────────────────────────────────────────────────────

interface ImportProgress {
  phase: string;
  message?: string;
  current?: number;
  total?: number;
  name?: string;
  imported?: number;
  skipped?: number;
  errors?: number;
  elapsed?: string;
}
const importOpen = ref(false);
const sharingImportProgress = ref<ImportProgress>({ phase: "idle" });
const sharingIsImporting = ref(false);

const importPercent = computed(() => {
  const p = sharingImportProgress.value;
  if (!p.current || !p.total) return 0;
  return Math.round((p.current / p.total) * 100);
});

function sharingStartImport() {
  sharingIsImporting.value = true;
  sharingImportProgress.value = { phase: "index", message: "Starting import..." };
  importIndexSSE(
    (data) => { sharingImportProgress.value = data; },
    () => { sharingIsImporting.value = false; loadPending(false); },
    (err) => { sharingIsImporting.value = false; sharingImportProgress.value = { phase: "error", message: err }; toast.error(err); },
  );
}
</script>

<template>
  <div class="flex flex-col gap-5">

    <!-- ═══ Pending Review ═══ -->
    <section class="card overflow-hidden">
      <!-- Header -->
      <div class="flex items-center gap-3 px-5 py-3.5 border-b border-ink-100">
        <Clock class="w-4 h-4 text-amber-500 shrink-0" />
        <h3 class="font-display font-semibold text-ink-800 text-sm flex items-center gap-2 min-w-0 flex-1">
          <span class="truncate">{{ t('sharingPendingReview') }}</span>
          <KBadge v-if="pendingArchives.length" variant="default" class="text-[10px] shrink-0">{{ pendingArchives.length }}</KBadge>
        </h3>
        <span v-if="lastRefreshedText" class="text-[11px] text-ink-400 hidden sm:inline tabular-nums">
          {{ lastRefreshedText }}
        </span>
        <KButton
          variant="ghost"
          size="xs"
          :disabled="pendingLoading"
          @click="loadPending(true)"
          :title="t('refresh')"
        >
          <RefreshCcw class="w-3.5 h-3.5" :class="pendingLoading && 'animate-spin'" />
          <span class="hidden sm:inline">{{ t('refresh') }}</span>
        </KButton>
      </div>

      <!-- Bulk action toolbar -->
      <Transition name="slide-down">
        <div
          v-if="pendingArchives.length > 0"
          class="flex items-center gap-3 px-5 py-2.5 border-b border-ink-100 bg-ink-50/40"
        >
          <label class="flex items-center gap-2 text-xs text-ink-600 cursor-pointer select-none">
            <input
              type="checkbox"
              :checked="allSelected"
              :indeterminate.prop="selectionCount > 0 && !allSelected"
              @change="toggleSelectAll"
              class="rounded border-ink-300 text-sakura-500 focus:ring-sakura-300 w-4 h-4"
            />
            <span v-if="selectionCount === 0">{{ t('sharingSelectAll') }}</span>
            <span v-else class="font-medium text-sakura-600">
              {{ t('sharingSelectedN', { n: selectionCount }) }}
            </span>
          </label>

          <div v-if="selectionCount > 0" class="flex items-center gap-2 ml-auto">
            <KButton
              variant="ghost"
              size="xs"
              :disabled="bulkRunning"
              @click="clearSelection"
            >
              <X class="w-3 h-3" />
              {{ t('sharingClearSelection') }}
            </KButton>
            <KButton
              variant="secondary"
              size="xs"
              :loading="bulkRunning"
              :disabled="bulkRunning"
              @click="bulkAction('approve')"
            >
              <CheckCheck class="w-3.5 h-3.5" />
              {{ t('sharingApproveSelected') }}
            </KButton>
            <KButton
              variant="danger"
              size="xs"
              :disabled="bulkRunning"
              @click="bulkAction('reject')"
            >
              <XOctagon class="w-3.5 h-3.5" />
              {{ t('sharingRejectSelected') }}
            </KButton>
          </div>
        </div>
      </Transition>

      <!-- Body -->
      <div v-if="pendingLoading && pendingArchives.length === 0" class="flex justify-center py-12">
        <KSpinner />
      </div>

      <div v-else-if="pendingArchives.length === 0" class="px-5 py-10 text-center">
        <Inbox class="w-8 h-8 text-ink-300 mx-auto mb-2.5" :stroke-width="1.5" />
        <p class="text-sm font-medium text-ink-700">{{ t('sharingNoPending') }}</p>
        <p class="text-xs text-ink-400 mt-1">{{ t('sharingNoPendingHint') }}</p>
      </div>

      <TransitionGroup
        v-else
        name="fade-list"
        tag="div"
        class="p-3 flex flex-col gap-2.5"
      >
        <PendingArchiveRow
          v-for="pa in pendingArchives"
          :key="pa.id"
          :archive="pa"
          :selected="selectedIds.has(pa.id)"
          :busy="busyIds.has(pa.id)"
          @approve="handleApprove(pa.id)"
          @reject="handleReject(pa.id)"
          @toggle-select="toggleSelect(pa.id)"
          @updated="loadPending(false)"
        />
      </TransitionGroup>
    </section>

    <!-- ═══ Admin Upload (collapsible) ═══ -->
    <section class="card overflow-hidden">
      <button
        @click="uploadOpen = !uploadOpen"
        class="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-ink-50/60 transition-colors duration-150"
      >
        <CloudUpload class="w-4 h-4 text-sakura-500 shrink-0" />
        <div class="flex-1 text-left min-w-0">
          <h3 class="font-display font-semibold text-ink-800 text-sm">{{ t('sharingAdminUploadTitle') }}</h3>
          <p class="text-[11px] text-ink-400 mt-0.5 truncate">{{ t('sharingAdminUploadDesc') }}</p>
        </div>
        <ChevronDown
          class="w-4 h-4 text-ink-400 shrink-0 transition-transform duration-200"
          :class="uploadOpen && 'rotate-180'"
        />
      </button>

      <Transition name="slide-down">
        <div v-if="uploadOpen" class="px-5 pb-5 pt-4 border-t border-ink-100 flex flex-col gap-4">

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="sm:col-span-2">
              <label class="text-xs font-medium text-ink-500 mb-1 block">{{ t('sharingAnimeName') }} *</label>
              <input v-model="sharingUploadForm.name_cn" class="w-full px-3 py-2 rounded-xl border border-sakura-200 text-sm focus:outline-none focus:ring-2 focus:ring-sakura-300/50" />
            </div>
            <div>
              <label class="text-xs font-medium text-ink-500 mb-1 block">{{ t('sharingLetter') }}</label>
              <input v-model="sharingUploadForm.letter" maxlength="1" class="w-full px-3 py-2 rounded-xl border border-sakura-200 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-sakura-300/50" />
            </div>
            <div>
              <label class="text-xs font-medium text-ink-500 mb-1 block">{{ t('sharingSeason') }} *</label>
              <select v-model="sharingUploadForm.season" class="w-full px-3 py-2 rounded-xl border border-sakura-200 text-sm focus:outline-none focus:ring-2 focus:ring-sakura-300/50">
                <option v-for="s in SEASON_OPTIONS" :key="s" :value="s">{{ s }}</option>
              </select>
            </div>
            <div>
              <label class="text-xs font-medium text-ink-500 mb-1 block">{{ t('sharingSubGroup') }} *</label>
              <input v-model="sharingUploadForm.sub_group" class="w-full px-3 py-2 rounded-xl border border-sakura-200 text-sm focus:outline-none focus:ring-2 focus:ring-sakura-300/50" />
            </div>
            <div>
              <label class="text-xs font-medium text-ink-500 mb-1 block">{{ t('sharingLanguages') }} *</label>
              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="lang in SHARING_LANG_OPTIONS"
                  :key="lang"
                  @click="sharingToggleLang(lang)"
                  class="px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors duration-100"
                  :class="sharingUploadForm.languages.includes(lang)
                    ? 'bg-sakura-100 border-sakura-300 text-sakura-700 shadow-sm'
                    : 'bg-surface border-ink-200 text-ink-400 hover:border-sakura-200'"
                >
                  {{ lang }}
                </button>
              </div>
            </div>
            <div class="flex items-center">
              <label class="flex items-center gap-2 text-sm text-ink-600 cursor-pointer">
                <input type="checkbox" v-model="sharingUploadForm.has_fonts" class="rounded" />
                {{ t('sharingHasFonts') }}
              </label>
            </div>
          </div>

          <div
            @drop.prevent="sharingHandleDrop"
            @dragover.prevent="sharingDropHover = true"
            @dragleave.prevent="sharingDropHover = false"
            @click="($refs.sharingFileInput as HTMLInputElement)?.click()"
            class="border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-colors duration-150"
            :class="sharingDropHover
              ? 'border-sakura-400 bg-sakura-50/60'
              : sharingUploadFile
                ? 'border-mint-300 bg-mint-50/30'
                : 'border-sakura-200 hover:border-sakura-300 hover:bg-sakura-50/30'"
          >
            <div v-if="!sharingUploadFile" class="flex flex-col items-center gap-2">
              <FileArchive class="w-8 h-8 text-ink-300" />
              <p class="text-sm text-ink-500">{{ t('sharingDropZone') }}</p>
              <p class="text-xs text-ink-300">{{ t('sharingMaxSize') }}</p>
            </div>
            <div v-else class="flex items-center gap-3 justify-center">
              <FileArchive class="w-5 h-5 text-mint-500 shrink-0" />
              <span class="text-sm text-ink-700 font-medium truncate">{{ sharingUploadFile.name }}</span>
              <span class="text-xs text-ink-400">({{ sharingUploadDetected }})</span>
            </div>
            <input ref="sharingFileInput" type="file" accept=".zip,.7z" class="hidden" @change="sharingHandleFileSelect($event)" />
          </div>

          <div class="flex items-center gap-2">
            <KButton
              variant="primary"
              size="sm"
              :disabled="!canUpload"
              :loading="sharingUploadSubmitting"
              @click="sharingSubmitUpload"
            >
              <Upload class="w-3.5 h-3.5" />
              {{ t('sharingPublish') }}
            </KButton>
            <KButton variant="ghost" size="sm" :disabled="sharingUploadSubmitting" @click="sharingResetForm">
              <X class="w-3.5 h-3.5" />
              {{ t('cancel') }}
            </KButton>
          </div>
        </div>
      </Transition>
    </section>

    <!-- ═══ Import Index (collapsible) ═══ -->
    <section class="card overflow-hidden">
      <button
        @click="importOpen = !importOpen"
        class="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-ink-50/60 transition-colors duration-150"
      >
        <DatabaseZap class="w-4 h-4 text-sky-500 shrink-0" />
        <div class="flex-1 text-left min-w-0">
          <h3 class="font-display font-semibold text-ink-800 text-sm">{{ t('sharingImportIndex') }}</h3>
          <p class="text-[11px] text-ink-400 mt-0.5 truncate">{{ t('sharingImportIndexDesc') }}</p>
        </div>
        <ChevronDown
          class="w-4 h-4 text-ink-400 shrink-0 transition-transform duration-200"
          :class="importOpen && 'rotate-180'"
        />
      </button>

      <Transition name="slide-down">
        <div v-if="importOpen" class="px-5 pb-5 pt-4 border-t border-ink-100 flex flex-col gap-3">
          <KButton
            variant="secondary"
            size="sm"
            class="w-fit"
            :disabled="sharingIsImporting"
            @click="sharingStartImport"
          >
            <Loader2 v-if="sharingIsImporting" class="w-3.5 h-3.5 animate-spin" />
            <DatabaseZap v-else class="w-3.5 h-3.5" />
            {{ sharingIsImporting ? t('sharingImporting') : t('sharingImportIndex') }}
          </KButton>

          <div v-if="sharingImportProgress.phase !== 'idle'" class="rounded-xl bg-ink-50/80 px-4 py-3 text-sm text-ink-600 flex flex-col gap-2">
            <p v-if="sharingImportProgress.message" class="text-xs text-ink-500">{{ sharingImportProgress.message }}</p>

            <!-- Progress bar -->
            <div v-if="sharingImportProgress.current != null" class="flex flex-col gap-1.5">
              <div class="flex items-center justify-between text-xs">
                <span class="text-ink-400 truncate" :title="sharingImportProgress.name">
                  {{ sharingImportProgress.name || '' }}
                </span>
                <span class="font-mono text-ink-500 shrink-0 ml-2">
                  {{ sharingImportProgress.current }} / {{ sharingImportProgress.total }}
                </span>
              </div>
              <div class="h-1.5 rounded-full bg-ink-200/60 overflow-hidden">
                <div
                  class="h-full bg-gradient-to-r from-sky-400 to-sky-500 transition-[width] duration-300"
                  :style="{ width: `${importPercent}%` }"
                />
              </div>
            </div>

            <p v-if="sharingImportProgress.phase === 'done'" class="text-mint-600 font-medium text-xs">
              ✓ {{ t('sharingImportDone') }}:
              {{ sharingImportProgress.imported }} imported,
              {{ sharingImportProgress.skipped }} skipped,
              {{ sharingImportProgress.errors }} errors
              ({{ sharingImportProgress.elapsed }})
            </p>
            <p v-if="sharingImportProgress.phase === 'error'" class="text-rose-500 font-medium text-xs">
              ✗ {{ sharingImportProgress.message }}
            </p>
          </div>
        </div>
      </Transition>
    </section>
  </div>
</template>

<style scoped>
.fade-list-enter-active,
.fade-list-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.fade-list-enter-from {
  opacity: 0;
  transform: translateY(-6px);
}
.fade-list-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
.fade-list-leave-active {
  position: absolute;
  width: calc(100% - 1.5rem);
}

.slide-down-enter-active,
.slide-down-leave-active {
  transition: opacity 0.2s ease, max-height 0.25s ease;
  overflow: hidden;
}
.slide-down-enter-from,
.slide-down-leave-to {
  opacity: 0;
  max-height: 0;
}
.slide-down-enter-to,
.slide-down-leave-from {
  opacity: 1;
  max-height: 1200px;
}
</style>
