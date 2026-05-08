<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  ArrowLeft, CheckCircle2, AlertCircle, CloudUpload,
  Tv, Upload, FileArchive, FolderTree,
} from "lucide-vue-next";
import KButton from "./KButton.vue";
import KBadge from "./KBadge.vue";
import type { SharedArchive } from "../api/client";
import { contributeArchive } from "../api/client";
import { formatBytes } from "../lib/format";

const { t } = useI18n();

const props = defineProps<{
  archives: SharedArchive[];
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "submitted"): void;
}>();

// ─── Form state ───────────────────────────────────────────────────────────────

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
const LETTER_OPTIONS = ["A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z","#"];
const SEASON_OPTIONS = ["S1","S2","S3","S4","Movie","SPs","OVA","合集"];

const canSubmit = computed(() =>
  uploadForm.value.name_cn.trim() &&
  uploadForm.value.sub_group.trim() &&
  uploadForm.value.languages.length > 0 &&
  uploadFile.value !== null &&
  !uploadSubmitting.value
);

const targetPath = computed(() => {
  const name = uploadForm.value.name_cn.trim();
  let letter = uploadForm.value.letter.trim().toUpperCase();
  if (!letter && name) {
    const first = name.charAt(0).toUpperCase();
    letter = /[A-Z]/.test(first) ? first : "#";
  }
  return {
    letter: letter || "?",
    name: name || "—",
    season: uploadForm.value.season || "S1",
    file: uploadFile.value?.name || "—",
  };
});

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
    uploadDetected.value = `${formatBytes(file.size)}`;
    uploadError.value = "";
  }
}

function handleDrop(e: DragEvent) {
  e.preventDefault();
  dropHover.value = false;
  const file = e.dataTransfer?.files[0];
  if (file && /\.(zip|7z)$/i.test(file.name)) {
    uploadFile.value = file;
    uploadDetected.value = `${formatBytes(file.size)}`;
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

async function submitContribute() {
  if (!uploadFile.value || uploadSubmitting.value) return;
  uploadError.value = "";
  uploadProgress.value = 0;
  let letter = uploadForm.value.letter.toUpperCase();
  if (!letter) {
    const first = uploadForm.value.name_cn.charAt(0).toUpperCase();
    letter = /^[A-Z]$/.test(first) ? first : "#";
  }
  const meta = {
    name_cn: uploadForm.value.name_cn,
    letter,
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
    emit("submitted");
  } catch (e: any) {
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

// ─── Autocomplete for anime name ──────────────────────────────────────────────

const showAutoComplete = ref(false);
const autoCompleteResults = computed(() => {
  const q = uploadForm.value.name_cn.trim().toLowerCase();
  if (!q || q.length < 1) return [];
  const seen = new Map<string, { name_cn: string; letter: string; seasons: Set<string> }>();
  for (const a of props.archives) {
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

function closeAutoCompleteSoon() {
  window.setTimeout(() => { showAutoComplete.value = false; }, 200);
}

// ─── Sub-group autocomplete ───────────────────────────────────────────────────

const showSubGroupAC = ref(false);
const subGroupACResults = computed(() => {
  const q = uploadForm.value.sub_group.trim().toLowerCase();
  if (!q || q.length < 1) return [];
  const seen = new Set<string>();
  for (const a of props.archives) {
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

function closeSubGroupAutoCompleteSoon() {
  window.setTimeout(() => { showSubGroupAC.value = false; }, 200);
}

function handleClose() {
  resetForm();
  emit("close");
}
</script>

<template>
  <div class="flex flex-col gap-6 animate-fade-in">
    <!-- Back button -->
    <button
      @click="handleClose"
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
                  @blur="closeAutoCompleteSoon"
                  autocomplete="off"
                  class="w-full px-3.5 py-2.5 rounded-xl border border-ink-200 text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-sakura-300/50 focus:border-sakura-300 transition-colors duration-150"
                  :placeholder="t('sharingAnimeNamePlaceholder')"
                />
                <!-- Autocomplete dropdown -->
                <div
                  v-if="showAutoComplete && autoCompleteResults.length > 0"
                  class="absolute z-20 left-0 right-0 top-full mt-1 bg-surface rounded-xl border border-sakura-200 shadow-lg max-h-48 overflow-y-auto"
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
              <div class="w-24">
                <label class="text-xs font-medium text-ink-500 mb-1.5 block">{{ t('sharingLetter') }}</label>
                <select
                  v-model="uploadForm.letter"
                  class="w-full px-3 py-2.5 rounded-xl border border-ink-200 text-sm text-center uppercase bg-surface focus:outline-none focus:ring-2 focus:ring-sakura-300/50 focus:border-sakura-300 transition-colors duration-150"
                >
                  <option value="">{{ t('sharingLetterAuto') }}</option>
                  <option v-for="L in LETTER_OPTIONS" :key="L" :value="L">{{ L }}</option>
                </select>
              </div>
            </div>

            <!-- Row 2: Season + Sub group -->
            <div class="flex gap-3">
              <div class="w-32">
                <label class="text-xs font-medium text-ink-500 mb-1.5 block">{{ t('sharingSeason') }} *</label>
                <select
                  v-model="uploadForm.season"
                  class="w-full px-3 py-2.5 rounded-xl border border-ink-200 text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-sakura-300/50 focus:border-sakura-300 transition-colors duration-150"
                >
                  <option v-for="s in SEASON_OPTIONS" :key="s" :value="s">{{ s }}</option>
                </select>
              </div>
              <div class="flex-1 relative">
                <label class="text-xs font-medium text-ink-500 mb-1.5 block">{{ t('sharingSubGroup') }} *</label>
                <input
                  v-model="uploadForm.sub_group"
                  @focus="showSubGroupAC = true"
                  @blur="closeSubGroupAutoCompleteSoon"
                  autocomplete="off"
                  class="w-full px-3.5 py-2.5 rounded-xl border border-ink-200 text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-sakura-300/50 focus:border-sakura-300 transition-colors duration-150"
                  :placeholder="t('sharingSubGroupPlaceholder')"
                />
                <!-- Sub-group autocomplete dropdown -->
                <div
                  v-if="showSubGroupAC && subGroupACResults.length > 0"
                  class="absolute z-20 left-0 right-0 top-full mt-1 bg-surface rounded-xl border border-sakura-200 shadow-lg max-h-48 overflow-y-auto"
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
                  class="px-3.5 py-2 rounded-xl text-xs font-medium border-2 transition-colors duration-150"
                  :class="uploadForm.languages.includes(lang)
                    ? 'bg-sakura-50 border-sakura-300 text-sakura-700 shadow-sm'
                    : 'bg-surface border-ink-100 text-ink-400 hover:border-sakura-200 hover:text-ink-600'"
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
                class="w-full px-3.5 py-2.5 rounded-xl border border-ink-200 text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-sakura-300/50 focus:border-sakura-300 transition-colors duration-150"
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
              <input ref="contribFileInput" type="file" accept=".zip,.7z" class="hidden" @change="handleFileSelect($event)" />
            </div>
          </div>

          <!-- Target path preview -->
          <div class="card p-4 bg-sky-50/40 border-sky-100">
            <div class="flex items-start gap-2">
              <FolderTree class="w-4 h-4 mt-0.5 text-sky-500 shrink-0" />
              <div class="min-w-0 flex-1">
                <div class="text-[11px] font-semibold text-sky-700 mb-1">{{ t('sharingTargetPath') }}</div>
                <div class="font-mono text-xs text-ink-700 break-all leading-relaxed">
                  <span class="font-bold text-sky-600">{{ targetPath.letter }}</span>
                  <span class="text-ink-300"> / </span>
                  <span>{{ targetPath.name }}</span>
                  <span class="text-ink-300"> / </span>
                  <span>{{ targetPath.season }}</span>
                  <span class="text-ink-300"> / </span>
                  <span class="text-ink-500">{{ targetPath.file }}</span>
                </div>
                <p class="text-[10px] text-ink-400 mt-1.5 leading-relaxed">{{ t('sharingTargetPathHint') }}</p>
              </div>
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
                class="h-full rounded-full bg-gradient-to-r from-sakura-400 to-sakura-500 transition-[width] duration-300 ease-out"
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
</template>
