<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import {
  Clock, RefreshCcw, FileArchive, Check, XCircle,
  Upload, X, DatabaseZap, Loader2,
} from "lucide-vue-next";
import {
  listPendingArchives, uploadSharedArchive,
  approveArchive, rejectArchive, importIndexSSE,
} from "../api/client";
import type { SharedArchive } from "../api/client";
import KButton from "./KButton.vue";
import KSpinner from "./KSpinner.vue";
import { formatBytes } from "../lib/format";

const { t } = useI18n();

// ── Pending Archives ──────────────────────────────────────────────────────────
const pendingArchives = ref<SharedArchive[]>([]);
const pendingLoading = ref(false);

const loadPending = async () => {
  pendingLoading.value = true;
  try {
    pendingArchives.value = await listPendingArchives();
  } catch {
    // Silently handle load failure
  } finally {
    pendingLoading.value = false;
  }
};

const handleApprove = async (id: string) => {
  try {
    await approveArchive(id);
    await loadPending();
  } catch (e) {
    toast.error(String(e instanceof Error ? e.message : e));
  }
};

const handleReject = async (id: string) => {
  try {
    await rejectArchive(id);
    await loadPending();
  } catch (e) {
    toast.error(String(e instanceof Error ? e.message : e));
  }
};

// ── Admin Upload Form ─────────────────────────────────────────────────────────
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
  if (file && file.name.endsWith(".zip")) {
    sharingUploadFile.value = file;
    sharingUploadDetected.value = formatBytes(file.size);
  }
}

function sharingResetForm() {
  sharingUploadForm.value = { name_cn: "", letter: "", season: "S1", sub_group: "", languages: [], has_fonts: false };
  sharingUploadFile.value = null;
  sharingUploadDetected.value = "";
}

async function sharingSubmitUpload() {
  if (!sharingUploadFile.value || sharingUploadSubmitting.value) return;
  const meta = {
    name_cn: sharingUploadForm.value.name_cn,
    letter: sharingUploadForm.value.letter.toUpperCase(),
    season: sharingUploadForm.value.season,
    sub_group: sharingUploadForm.value.sub_group,
    languages: sharingUploadForm.value.languages,
    has_fonts: sharingUploadForm.value.has_fonts,
  };
  sharingUploadSubmitting.value = true;
  try {
    await uploadSharedArchive(sharingUploadFile.value, meta);
    toast.success(t("sharingPublished"));
    sharingResetForm();
  } catch (e) {
    toast.error(String(e instanceof Error ? e.message : e));
  } finally {
    sharingUploadSubmitting.value = false;
  }
}

// ── Import Index ──────────────────────────────────────────────────────────────
const sharingImportProgress = ref<{ phase: string; message?: string; current?: number; total?: number; name?: string; imported?: number; skipped?: number; errors?: number; elapsed?: string }>({ phase: "idle" });
const sharingIsImporting = ref(false);

function sharingStartImport() {
  sharingIsImporting.value = true;
  sharingImportProgress.value = { phase: "index", message: "Starting import..." };
  importIndexSSE(
    (data) => { sharingImportProgress.value = data; },
    () => { sharingIsImporting.value = false; loadPending(); },
    (err) => { sharingIsImporting.value = false; sharingImportProgress.value = { phase: "error", message: err }; },
  );
}

// Auto-generate letter from anime name
watch(() => sharingUploadForm.value.name_cn, (name) => {
  if (name && !sharingUploadForm.value.letter) {
    const first = name.charAt(0).toUpperCase();
    if (/[A-Z]/.test(first)) sharingUploadForm.value.letter = first;
  }
});

onMounted(() => {
  loadPending();
});
</script>

<template>
  <div class="flex flex-col gap-5">

    <!-- Pending Review -->
    <div class="card overflow-hidden">
      <div class="flex items-center gap-2.5 px-5 py-4 border-b border-sakura-100/60">
        <Clock class="w-4 h-4 text-amber-500" />
        <h3 class="font-display font-semibold text-ink-800 text-sm">{{ t('sharingPendingReview') }}</h3>
        <div class="flex-1" />
        <KButton variant="ghost" size="sm" :disabled="pendingLoading" @click="loadPending">
          <RefreshCcw class="w-3.5 h-3.5" :class="pendingLoading && 'animate-spin-slow'" />
        </KButton>
      </div>

      <div v-if="pendingLoading && pendingArchives.length === 0" class="flex justify-center py-8">
        <KSpinner />
      </div>

      <div v-else-if="pendingArchives.length === 0" class="px-5 py-8 text-center">
        <p class="text-sm text-ink-400">{{ t('sharingNoPending') }}</p>
      </div>

      <div v-else class="divide-y divide-sakura-50">
        <div
          v-for="pa in pendingArchives"
          :key="pa.id"
          class="flex items-center gap-3 px-5 py-3 hover:bg-sakura-50/30 transition-colors duration-150"
        >
          <FileArchive class="w-5 h-5 text-amber-400 shrink-0" />
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-ink-800 truncate">
              {{ pa.name_cn }} {{ pa.season }} · {{ pa.sub_group }}
            </p>
            <p class="text-xs text-ink-400">
              {{ pa.contributor || 'anonymous' }} · {{ formatBytes(pa.file_size) }} · {{ pa.filename }}
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
    </div>

    <!-- Admin Upload (inline form) -->
    <div class="card p-5 flex flex-col gap-4">
      <div class="flex items-center gap-2.5">
        <Upload class="w-4 h-4 text-sakura-500" />
        <h3 class="font-display font-semibold text-ink-800 text-sm">{{ t('sharingAdminUploadTitle') }}</h3>
      </div>

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
            <option v-for="s in ['S1','S2','S3','S4','Movie','SPs','OVA']" :key="s" :value="s">{{ s }}</option>
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
              class="px-2.5 py-1 rounded-lg text-xs font-medium border transition-all duration-150"
              :class="sharingUploadForm.languages.includes(lang)
                ? 'bg-sakura-100 border-sakura-300 text-sakura-700 shadow-sm'
                : 'bg-surface border-ink-200 text-ink-400 hover:border-sakura-200'"
            >
              {{ lang }}
            </button>
          </div>
        </div>
        <div class="flex items-center">
          <label class="flex items-center gap-2 text-sm text-ink-600">
            <input type="checkbox" v-model="sharingUploadForm.has_fonts" class="rounded" />
            {{ t('sharingHasFonts') }}
          </label>
        </div>
      </div>

      <!-- File drop zone -->
      <div
        @drop.prevent="sharingHandleDrop"
        @dragover.prevent="sharingDropHover = true"
        @dragleave.prevent="sharingDropHover = false"
        @click="($refs.sharingFileInput as HTMLInputElement)?.click()"
        class="border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all duration-200"
        :class="sharingDropHover
          ? 'border-sakura-400 bg-sakura-50/60 scale-[1.01]'
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
        <input ref="sharingFileInput" type="file" accept=".zip" class="hidden" @change="sharingHandleFileSelect($event)" />
      </div>

      <div class="flex items-center gap-2">
        <KButton
          variant="primary"
          size="sm"
          :disabled="!sharingUploadForm.name_cn || !sharingUploadForm.sub_group || !sharingUploadForm.languages.length || !sharingUploadFile || sharingUploadSubmitting"
          :loading="sharingUploadSubmitting"
          @click="sharingSubmitUpload"
        >
          <Upload class="w-3.5 h-3.5" />
          {{ t('sharingPublish') }}
        </KButton>
        <KButton variant="ghost" size="sm" @click="sharingResetForm">
          <X class="w-3.5 h-3.5" />
          {{ t('cancel') }}
        </KButton>
      </div>
    </div>

    <!-- Import Index -->
    <div class="card p-5 flex flex-col gap-3">
      <div class="flex items-center gap-2.5">
        <DatabaseZap class="w-4 h-4 text-sakura-500" />
        <h3 class="font-display font-semibold text-ink-800 text-sm">{{ t('sharingImportIndex') }}</h3>
      </div>

      <div v-if="sharingImportProgress.phase !== 'idle'" class="text-sm text-ink-500">
        <p v-if="sharingImportProgress.message">{{ sharingImportProgress.message }}</p>
        <p v-if="sharingImportProgress.current != null">
          {{ sharingImportProgress.current }} / {{ sharingImportProgress.total }}
          <span v-if="sharingImportProgress.name" class="text-ink-400">— {{ sharingImportProgress.name }}</span>
        </p>
        <p v-if="sharingImportProgress.phase === 'done'" class="text-mint-600 font-medium mt-1">
          ✓ {{ t('sharingImportDone') }}:
          {{ sharingImportProgress.imported }} imported,
          {{ sharingImportProgress.skipped }} skipped,
          {{ sharingImportProgress.errors }} errors
          ({{ sharingImportProgress.elapsed }})
        </p>
        <p v-if="sharingImportProgress.phase === 'error'" class="text-rose-500 font-medium mt-1">
          ✗ {{ sharingImportProgress.message }}
        </p>
      </div>

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
    </div>
  </div>
</template>
