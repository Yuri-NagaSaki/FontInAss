<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  AlertTriangle, CheckCircle2, CloudUpload, FileText, Gauge, Loader2,
  ShieldCheck, Users, X,
} from "lucide-vue-next";
import {
  getPublicFontUploadPolicy,
  uploadFontsPublic,
  type ApiUploadResult,
  type PublicFontUploadPolicy,
} from "../api/client";
import { formatBytes } from "../lib/format";
import { FONT_EXTS } from "../lib/constants";
import KButton from "../components/KButton.vue";

const { t } = useI18n();

type QueueStatus = "pending" | "uploading" | "success" | "duplicate" | "rejected" | "error";
interface QueueEntry { file: File; status: QueueStatus; result?: ApiUploadResult; message?: string }

const policy = ref<PublicFontUploadPolicy>({
  max_files: 20,
  max_file_bytes: 100 * 1024 * 1024,
  max_batch_bytes: 100 * 1024 * 1024,
  requests_per_minute: 30,
});
const queue = ref<QueueEntry[]>([]);
const dragActive = ref(false);
let dragCounter = 0;
const uploading = ref(false);
const uploadError = ref("");
const dropError = ref("");
let dropErrorTimer = 0;

const pendingEntries = computed(() => queue.value.filter((entry) => entry.status === "pending"));
const pendingBytes = computed(() => pendingEntries.value.reduce((total, entry) => total + entry.file.size, 0));
const batchSummary = computed(() => ({
  accepted: queue.value.filter((entry) => entry.status === "success").length,
  duplicate: queue.value.filter((entry) => entry.status === "duplicate").length,
  failed: queue.value.filter((entry) => entry.status === "rejected" || entry.status === "error").length,
}));

const showDropError = (message: string) => {
  clearTimeout(dropErrorTimer);
  dropError.value = message;
  dropErrorTimer = window.setTimeout(() => { dropError.value = ""; }, 3500);
};

const isFont = (file: File) => FONT_EXTS.has(file.name.split(".").pop()?.toLowerCase() ?? "");
const addToQueue = (files: FileList | File[]) => {
  const candidates = Array.from(files).filter(isFont);
  if (!candidates.length) {
    showDropError(t("publicUploadNoFont"));
    return;
  }

  const remaining = Math.max(0, policy.value.max_files - queue.value.length);
  const accepted = candidates.slice(0, remaining).filter((file) => file.size <= policy.value.max_file_bytes);
  if (candidates.some((file) => file.size > policy.value.max_file_bytes)) {
    showDropError(t("publicUploadFileTooLarge", { size: formatBytes(policy.value.max_file_bytes) }));
  } else if (candidates.length > remaining) {
    showDropError(t("publicUploadTooMany", { n: policy.value.max_files }));
  }
  queue.value.push(...accepted.map((file) => ({ file, status: "pending" as const })));
  uploadError.value = "";
};

const chooseFiles = () => {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.accept = ".ttf,.otf,.ttc,.otc";
  input.onchange = (event) => {
    const files = (event.target as HTMLInputElement).files;
    if (files) addToQueue(files);
  };
  input.click();
};

const removeEntry = (index: number) => {
  if (queue.value[index]?.status !== "uploading") queue.value.splice(index, 1);
};
const clearQueue = () => {
  if (!uploading.value) queue.value = [];
};

const startUpload = async () => {
  const pending = pendingEntries.value;
  if (!pending.length || uploading.value) return;
  if (pendingBytes.value > policy.value.max_batch_bytes) {
    uploadError.value = t("publicUploadBatchTooLarge", { size: formatBytes(policy.value.max_batch_bytes) });
    return;
  }

  uploading.value = true;
  uploadError.value = "";
  pending.forEach((entry) => { entry.status = "uploading"; entry.message = undefined; });
  try {
    const response = await uploadFontsPublic(pending.map((entry) => entry.file));
    response.results.forEach((result, index) => {
      const entry = pending[index];
      if (!entry) return;
      entry.status = result.status;
      entry.result = result;
      entry.message = result.error ?? undefined;
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    pending.forEach((entry) => { entry.status = "error"; entry.message = message; });
    uploadError.value = message;
  } finally {
    uploading.value = false;
  }
};

const statusClass = (status: QueueStatus) => ({
  pending: "bg-surface text-ink-600 border-ink-100",
  uploading: "bg-sakura-50 text-sakura-600 border-sakura-100",
  success: "bg-mint-50 text-mint-600 border-mint-200",
  duplicate: "bg-sky-50 text-sky-600 border-sky-200",
  rejected: "bg-amber-50 text-amber-600 border-amber-200",
  error: "bg-rose-50 text-rose-600 border-rose-200",
}[status]);

const onDragEnter = (event: DragEvent) => { event.preventDefault(); dragCounter++; dragActive.value = true; };
const onDragOver = (event: DragEvent) => event.preventDefault();
const onDragLeave = (event: DragEvent) => {
  event.preventDefault();
  if (--dragCounter <= 0) { dragCounter = 0; dragActive.value = false; }
};
const onDrop = (event: DragEvent) => {
  event.preventDefault(); dragCounter = 0; dragActive.value = false;
  if (event.dataTransfer?.files) addToQueue(event.dataTransfer.files);
};

onMounted(async () => {
  try { policy.value = await getPublicFontUploadPolicy(); } catch { /* defaults match server defaults */ }
});
onBeforeUnmount(() => clearTimeout(dropErrorTimer));
</script>

<template>
  <div class="flex flex-col gap-7">
    <header class="max-w-3xl">
      <div class="mb-2 flex items-center gap-2 text-xs font-semibold text-sakura-500">
        <ShieldCheck class="h-3.5 w-3.5" />{{ t('publicUploadEyebrow') }}
      </div>
      <h1 class="font-display text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">{{ t('publicUploadTitle') }}</h1>
      <p class="mt-2 max-w-2xl text-sm leading-relaxed text-ink-500">{{ t('publicUploadDesc') }}</p>
    </header>

    <div class="flex flex-wrap gap-2 text-xs text-ink-500">
      <span class="rounded-full border border-ink-100 bg-surface px-3 py-1.5">{{ t('publicUploadLimitFiles', { n: policy.max_files }) }}</span>
      <span class="rounded-full border border-ink-100 bg-surface px-3 py-1.5">{{ t('publicUploadLimitFileSize', { size: formatBytes(policy.max_file_bytes) }) }}</span>
      <span class="rounded-full border border-ink-100 bg-surface px-3 py-1.5">{{ t('publicUploadLimitBatchSize', { size: formatBytes(policy.max_batch_bytes) }) }}</span>
      <span class="rounded-full border border-ink-100 bg-surface px-3 py-1.5">{{ t('publicUploadLimitRate', { n: policy.requests_per_minute }) }}</span>
    </div>

    <section class="min-w-0">
      <div
        class="drop-zone cursor-pointer px-5 py-12 text-center"
        :class="dragActive ? 'active bg-sakura-50' : ''"
        @dragenter="onDragEnter"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop="onDrop"
        @click="chooseFiles"
      >
        <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-sakura-50 text-sakura-500"><CloudUpload class="h-6 w-6" /></div>
        <h2 class="mt-4 font-display font-semibold text-ink-800">{{ t('publicUploadDropTitle') }}</h2>
        <p class="mt-1 text-xs text-ink-400">{{ t('publicUploadDropHint') }}</p>
      </div>

      <p v-if="dropError || uploadError" class="mt-3 flex items-center gap-2 text-xs text-rose-500">
        <AlertTriangle class="h-3.5 w-3.5" />{{ dropError || uploadError }}
      </p>

      <div v-if="queue.length" class="mt-5 flex flex-col gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm text-ink-500">
            {{ t('publicUploadQueue', { n: queue.length, size: formatBytes(pendingBytes) }) }}
          </span>
          <span v-if="batchSummary.accepted || batchSummary.duplicate || batchSummary.failed" class="text-xs text-ink-400">
            {{ t('publicUploadResultSummary', batchSummary) }}
          </span>
          <div class="flex-1" />
          <KButton variant="ghost" size="sm" :disabled="uploading" @click="clearQueue"><X class="h-3.5 w-3.5" />{{ t('clearLabel') }}</KButton>
          <KButton size="sm" :loading="uploading" :disabled="!pendingEntries.length" @click="startUpload"><CloudUpload class="h-3.5 w-3.5" />{{ t('publicUploadStart') }}</KButton>
        </div>

        <div class="flex max-h-96 flex-col gap-1.5 overflow-y-auto">
          <div v-for="(entry, index) in queue" :key="`${entry.file.name}-${index}`" class="flex items-center gap-3 rounded-xl border px-3 py-2.5" :class="statusClass(entry.status)">
            <Loader2 v-if="entry.status === 'uploading'" class="h-4 w-4 shrink-0 animate-spin-slow" />
            <CheckCircle2 v-else-if="entry.status === 'success' || entry.status === 'duplicate'" class="h-4 w-4 shrink-0" />
            <AlertTriangle v-else-if="entry.status === 'rejected' || entry.status === 'error'" class="h-4 w-4 shrink-0" />
            <FileText v-else class="h-4 w-4 shrink-0" />
            <span class="min-w-0 flex-1 truncate font-mono text-xs text-ink-700">{{ entry.file.name }}</span>
            <span v-if="entry.status !== 'pending' && entry.status !== 'uploading'" class="text-[11px] font-semibold">{{ t(`apiUploadStatus_${entry.status}`) }}</span>
            <span class="text-[11px] text-ink-400">{{ formatBytes(entry.file.size) }}</span>
            <button v-if="entry.status !== 'uploading'" class="flex h-6 w-6 items-center justify-center rounded-lg hover:bg-ink-100" @click.stop="removeEntry(index)"><X class="h-3 w-3" /></button>
          </div>
        </div>
      </div>
    </section>

    <div class="grid gap-4 border-t border-ink-100 pt-6 sm:grid-cols-[1fr_auto] sm:items-center">
      <div class="flex items-start gap-3">
        <Gauge class="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
        <p class="max-w-2xl text-xs leading-relaxed text-ink-400">{{ t('publicUploadSecurityNote') }}</p>
      </div>
      <RouterLink to="/access" class="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-sakura-200 bg-sakura-50 px-4 text-sm font-medium text-sakura-600 transition-colors hover:bg-sakura-100">
        <Users class="h-3.5 w-3.5" />{{ t('publicUploadMemberAccess') }}
      </RouterLink>
    </div>
  </div>
</template>
