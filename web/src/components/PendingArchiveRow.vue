<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import {
  FileArchive, Check, X, Eye, Pencil,
  Loader2, Clock, User, Folder, AlertTriangle, Save,
} from "lucide-vue-next";
import KBadge from "./KBadge.vue";
import { previewArchive, editArchive } from "../api/client";
import type { SharedArchive } from "../api/client";
import { formatBytes } from "../lib/format";

const { t } = useI18n();

const props = defineProps<{
  archive: SharedArchive;
  selected?: boolean;
  busy?: boolean;
}>();

const emit = defineEmits<{
  approve: [];
  reject: [];
  toggleSelect: [];
  updated: [];
}>();

const LANG_OPTIONS = ["chs", "cht", "jpn", "chs_jpn", "cht_jpn", "sc", "tc", "eng"];
const SEASON_OPTIONS = ["S1", "S2", "S3", "S4", "Movie", "SPs", "OVA", "合集"];

// ── Parsed fields ─────────────────────────────────────────────────────────────
const langs = computed<string[]>(() => {
  try { return JSON.parse(props.archive.languages); } catch { return []; }
});

const fmts = computed<string[]>(() => {
  try { return JSON.parse(props.archive.subtitle_format); } catch { return []; }
});

const relativeTime = computed(() => {
  if (!props.archive.created_at) return "";
  const ts = Date.parse(props.archive.created_at.endsWith("Z") ? props.archive.created_at : props.archive.created_at + "Z");
  if (Number.isNaN(ts)) return props.archive.created_at;
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return t("justNow");
  if (min < 60) return t("minutesAgo", { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("hoursAgo", { n: hr });
  const d = Math.floor(hr / 24);
  return t("daysAgo", { n: d });
});

// ── Reject confirm (two-step, inline) ─────────────────────────────────────────
const rejectArmed = ref(false);
let rejectArmTimer: number | undefined;

function armReject() {
  if (props.busy) return;
  rejectArmed.value = true;
  window.clearTimeout(rejectArmTimer);
  rejectArmTimer = window.setTimeout(() => { rejectArmed.value = false; }, 3000);
}

function confirmReject() {
  window.clearTimeout(rejectArmTimer);
  rejectArmed.value = false;
  emit("reject");
}

// ── Inline preview ────────────────────────────────────────────────────────────
const previewExpanded = ref(false);
const previewLoading = ref(false);
const previewError = ref("");
const previewData = ref<{
  filename: string;
  totalFiles: number;
  subtitleFiles: number;
  files: { name: string; ext: string; isSubtitle: boolean }[];
} | null>(null);

async function togglePreview() {
  if (previewExpanded.value) {
    previewExpanded.value = false;
    return;
  }
  previewExpanded.value = true;
  if (previewData.value) return;
  previewLoading.value = true;
  previewError.value = "";
  try {
    previewData.value = await previewArchive(props.archive.id);
  } catch (e: any) {
    previewError.value = e?.message || String(e);
  } finally {
    previewLoading.value = false;
  }
}

// ── Inline edit ───────────────────────────────────────────────────────────────
const editExpanded = ref(false);
const editSaving = ref(false);
const editForm = ref({
  name_cn: props.archive.name_cn,
  letter: props.archive.letter,
  season: props.archive.season,
  sub_group: props.archive.sub_group,
  languages: [...langs.value],
  has_fonts: !!props.archive.has_fonts,
});

watch(() => props.archive, (a) => {
  editForm.value = {
    name_cn: a.name_cn,
    letter: a.letter,
    season: a.season,
    sub_group: a.sub_group,
    languages: (() => { try { return JSON.parse(a.languages); } catch { return []; } })(),
    has_fonts: !!a.has_fonts,
  };
});

function toggleEdit() {
  editExpanded.value = !editExpanded.value;
}

function toggleEditLang(lang: string) {
  const i = editForm.value.languages.indexOf(lang);
  if (i >= 0) editForm.value.languages.splice(i, 1);
  else editForm.value.languages.push(lang);
}

async function saveEdit() {
  if (editSaving.value) return;
  editSaving.value = true;
  try {
    await editArchive(props.archive.id, {
      name_cn: editForm.value.name_cn.trim(),
      letter: editForm.value.letter.trim().toUpperCase(),
      season: editForm.value.season,
      sub_group: editForm.value.sub_group.trim(),
      languages: editForm.value.languages,
      has_fonts: editForm.value.has_fonts,
    });
    toast.success(t("sharingEditSuccess"));
    editExpanded.value = false;
    emit("updated");
  } catch (e: any) {
    toast.error(e?.message || String(e));
  } finally {
    editSaving.value = false;
  }
}
</script>

<template>
  <div
    class="card overflow-hidden transition-shadow duration-150"
    :class="[
      busy ? 'opacity-60' : '',
      selected ? 'ring-2 ring-sakura-300/70 border-sakura-300' : '',
    ]"
  >
    <!-- Main row -->
    <div class="flex items-start gap-3 px-4 py-3.5">
      <!-- Checkbox -->
      <label class="flex items-center pt-1 cursor-pointer select-none">
        <input
          type="checkbox"
          :checked="selected"
          :disabled="busy"
          @change="emit('toggleSelect')"
          class="rounded border-ink-300 text-sakura-500 focus:ring-sakura-300 w-4 h-4"
        />
      </label>

      <!-- Icon -->
      <div class="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
        <FileArchive class="w-5 h-5 text-amber-500" />
      </div>

      <!-- Title + meta -->
      <div class="flex-1 min-w-0">
        <div class="flex items-baseline gap-2 flex-wrap">
          <p class="font-display font-semibold text-ink-900 text-sm truncate max-w-full">
            {{ archive.name_cn }}
          </p>
          <KBadge variant="default" class="text-[10px]">{{ archive.letter }}</KBadge>
          <KBadge variant="sky" class="text-[10px]">{{ archive.season }}</KBadge>
          <span class="text-xs text-ink-500 truncate">· {{ archive.sub_group }}</span>
        </div>

        <div class="flex items-center gap-1.5 mt-1.5 flex-wrap">
          <KBadge v-for="l in langs" :key="l" variant="sakura" class="text-[10px]">{{ l }}</KBadge>
          <KBadge v-for="f in fmts" :key="f" variant="default" class="text-[10px]">{{ f }}</KBadge>
          <KBadge v-if="archive.has_fonts" variant="success" class="text-[10px]">
            {{ t('sharingFont') }}
          </KBadge>
          <KBadge v-if="archive.episode_count" variant="default" class="text-[10px]">
            {{ archive.episode_count }} {{ t('sharingEpisodes') }}
          </KBadge>
        </div>

        <div class="flex items-center gap-3 mt-2 text-[11px] text-ink-400 flex-wrap">
          <span class="inline-flex items-center gap-1">
            <User class="w-3 h-3" />
            {{ archive.contributor || t('anonymous') }}
          </span>
          <span class="inline-flex items-center gap-1">
            <Clock class="w-3 h-3" />
            {{ relativeTime }}
          </span>
          <span class="inline-flex items-center gap-1 tabular-nums">
            <Folder class="w-3 h-3" />
            {{ archive.file_count }} · {{ formatBytes(archive.file_size) }}
          </span>
          <span class="inline-flex items-center gap-1 truncate max-w-[260px]" :title="archive.filename">
            {{ archive.filename }}
          </span>
        </div>
      </div>

      <!-- Action buttons -->
      <div class="flex items-center gap-1 shrink-0 self-center">
        <button
          @click="togglePreview"
          :disabled="busy"
          :title="t('sharingPreview')"
          class="w-9 h-9 rounded-xl flex items-center justify-center text-sky-500 bg-sky-50 hover:bg-sky-100 hover:text-sky-600 transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
          :class="previewExpanded && 'bg-sky-100 ring-2 ring-sky-200'"
        >
          <Eye class="w-4 h-4" />
        </button>
        <button
          @click="toggleEdit"
          :disabled="busy"
          :title="t('sharingEdit')"
          class="w-9 h-9 rounded-xl flex items-center justify-center text-amber-500 bg-amber-50 hover:bg-amber-100 hover:text-amber-600 transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
          :class="editExpanded && 'bg-amber-100 ring-2 ring-amber-200'"
        >
          <Pencil class="w-4 h-4" />
        </button>
        <button
          @click="emit('approve')"
          :disabled="busy"
          :title="t('sharingApprove')"
          class="h-9 px-3 rounded-xl flex items-center gap-1.5 bg-mint-50 text-mint-600 hover:bg-mint-100 transition-colors duration-150 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Loader2 v-if="busy" class="w-4 h-4 animate-spin" />
          <Check v-else class="w-4 h-4" />
          <span class="hidden sm:inline">{{ t('sharingApprove') }}</span>
        </button>
        <button
          v-if="!rejectArmed"
          @click="armReject"
          :disabled="busy"
          :title="t('sharingReject')"
          class="h-9 px-3 rounded-xl flex items-center gap-1.5 bg-ink-50 text-ink-500 hover:bg-rose-50 hover:text-rose-500 transition-colors duration-150 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <X class="w-4 h-4" />
          <span class="hidden sm:inline">{{ t('sharingReject') }}</span>
        </button>
        <button
          v-else
          @click="confirmReject"
          @blur="rejectArmed = false"
          :disabled="busy"
          class="h-9 px-3 rounded-xl flex items-center gap-1.5 bg-rose-500 text-white hover:bg-rose-600 transition-colors duration-150 text-sm font-medium animate-fade-in"
          autofocus
        >
          <AlertTriangle class="w-4 h-4" />
          {{ t('sharingConfirmReject') }}
        </button>
      </div>
    </div>

    <!-- Inline preview panel -->
    <Transition name="expand">
      <div v-if="previewExpanded" class="border-t border-ink-100 bg-sky-50/30 px-4 py-3">
        <div v-if="previewLoading" class="flex items-center gap-2 text-xs text-ink-500 py-2">
          <Loader2 class="w-3.5 h-3.5 animate-spin text-sky-500" />
          {{ t('loading') }}
        </div>
        <div v-else-if="previewError" class="text-xs text-rose-600 bg-rose-50 px-3 py-2 rounded-lg">
          {{ previewError }}
        </div>
        <template v-else-if="previewData">
          <div class="flex items-center gap-3 mb-2 text-xs text-ink-500">
            <span class="inline-flex items-center gap-1">
              <FileArchive class="w-3.5 h-3.5" />
              {{ previewData.totalFiles }} {{ t('sharingTotalFiles') }}
            </span>
            <span class="text-sky-600 font-medium">
              {{ previewData.subtitleFiles }} {{ t('sharingSubtitleFiles') }}
            </span>
          </div>
          <div class="max-h-48 overflow-y-auto rounded-lg bg-surface border border-ink-100 divide-y divide-ink-50">
            <div
              v-for="f in previewData.files"
              :key="f.name"
              class="flex items-center gap-2 px-3 py-1.5 text-xs"
            >
              <FileArchive class="w-3 h-3 shrink-0" :class="f.isSubtitle ? 'text-sky-500' : 'text-ink-300'" />
              <span class="flex-1 truncate font-mono" :class="f.isSubtitle ? 'text-ink-700' : 'text-ink-400'">
                {{ f.name }}
              </span>
              <span class="text-[10px] text-ink-400 uppercase tabular-nums">{{ f.ext.replace('.', '') }}</span>
            </div>
          </div>
        </template>
      </div>
    </Transition>

    <!-- Inline edit panel -->
    <Transition name="expand">
      <div v-if="editExpanded" class="border-t border-ink-100 bg-amber-50/30 px-4 py-3.5">
        <div class="grid grid-cols-12 gap-2.5">
          <div class="col-span-7">
            <label class="text-[10px] font-bold uppercase tracking-wider text-ink-400 mb-1 block">{{ t('sharingAnimeName') }}</label>
            <input
              v-model="editForm.name_cn"
              class="w-full px-2.5 py-1.5 rounded-lg border border-ink-200 text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-sakura-300/50"
            />
          </div>
          <div class="col-span-2">
            <label class="text-[10px] font-bold uppercase tracking-wider text-ink-400 mb-1 block">{{ t('sharingLetter') }}</label>
            <input
              v-model="editForm.letter"
              maxlength="1"
              class="w-full px-2 py-1.5 rounded-lg border border-ink-200 text-sm uppercase text-center bg-surface focus:outline-none focus:ring-2 focus:ring-sakura-300/50"
            />
          </div>
          <div class="col-span-3">
            <label class="text-[10px] font-bold uppercase tracking-wider text-ink-400 mb-1 block">{{ t('sharingSeason') }}</label>
            <select
              v-model="editForm.season"
              class="w-full px-2 py-1.5 rounded-lg border border-ink-200 text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-sakura-300/50"
            >
              <option v-for="s in SEASON_OPTIONS" :key="s" :value="s">{{ s }}</option>
            </select>
          </div>
          <div class="col-span-12">
            <label class="text-[10px] font-bold uppercase tracking-wider text-ink-400 mb-1 block">{{ t('sharingSubGroup') }}</label>
            <input
              v-model="editForm.sub_group"
              class="w-full px-2.5 py-1.5 rounded-lg border border-ink-200 text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-sakura-300/50"
            />
          </div>
          <div class="col-span-12">
            <label class="text-[10px] font-bold uppercase tracking-wider text-ink-400 mb-1 block">{{ t('sharingLanguages') }}</label>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="lang in LANG_OPTIONS"
                :key="lang"
                @click="toggleEditLang(lang)"
                class="px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors duration-100"
                :class="editForm.languages.includes(lang)
                  ? 'bg-sakura-100 border-sakura-300 text-sakura-700'
                  : 'bg-surface border-ink-200 text-ink-400 hover:border-sakura-200'"
              >
                {{ lang }}
              </button>
            </div>
          </div>
          <div class="col-span-12 flex items-center justify-between mt-1">
            <label class="flex items-center gap-2 text-xs text-ink-600 cursor-pointer">
              <input type="checkbox" v-model="editForm.has_fonts" class="rounded border-ink-300 text-sakura-500" />
              {{ t('sharingHasFonts') }}
            </label>
            <div class="flex items-center gap-2">
              <button
                @click="editExpanded = false"
                :disabled="editSaving"
                class="h-8 px-3 rounded-lg text-xs text-ink-500 hover:bg-ink-100 transition-colors duration-150"
              >
                {{ t('cancel') }}
              </button>
              <button
                @click="saveEdit"
                :disabled="editSaving"
                class="h-8 px-3 rounded-lg flex items-center gap-1.5 bg-amber-500 text-white hover:bg-amber-600 transition-colors duration-150 text-xs font-medium disabled:opacity-50"
              >
                <Loader2 v-if="editSaving" class="w-3.5 h-3.5 animate-spin" />
                <Save v-else class="w-3.5 h-3.5" />
                {{ t('save') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.expand-enter-active,
.expand-leave-active {
  transition: opacity 0.2s ease, max-height 0.25s ease;
  overflow: hidden;
}
.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  max-height: 0;
}
.expand-enter-to,
.expand-leave-from {
  opacity: 1;
  max-height: 500px;
}
</style>
