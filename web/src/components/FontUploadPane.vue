<script setup lang="ts">
import { ref, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import {
  FolderOpen, CloudUpload, AlertTriangle, Loader2,
  CheckCircle2, FileText, Upload, X,
} from "lucide-vue-next";
import { uploadFonts } from "../api/client";
import KButton from "./KButton.vue";
import { formatBytes } from "../lib/format";

const { t, locale } = useI18n();
const emit = defineEmits<{ uploaded: [] }>();

// ── Upload State ──────────────────────────────────────────────────────────────
const DEFAULT_UPLOAD_DIR = "CatCat-Fonts/";
const uploadDir       = ref(DEFAULT_UPLOAD_DIR);
const uploadQueue     = ref<{ file: File; status: "pending" | "uploading" | "ok" | "error"; msg?: string }[]>([]);
const uploadDragActive = ref(false);
let   uploadDragCounter = 0;
const uploadRunning   = ref(false);
const uploadSummary   = ref<{ ok: number; fail: number } | null>(null);
const uploadBatchDone = ref(0);
const uploadBatchTotal = ref(0);
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
  uploadBatchTotal.value = pending.length;
  uploadBatchDone.value = 0;

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
    uploadBatchDone.value++;
  }
  uploadRunning.value = false;
  uploadSummary.value = { ok, fail: pending.length - ok };
  if (ok > 0) emit("uploaded");
};

const onUploadDragEnter = (e: DragEvent) => { e.preventDefault(); uploadDragCounter++; uploadDragActive.value = true; };
const onUploadDragOver  = (e: DragEvent) => e.preventDefault();
const onUploadDragLeave = (e: DragEvent) => { e.preventDefault(); if (--uploadDragCounter <= 0) { uploadDragActive.value = false; uploadDragCounter = 0; } };
const onUploadDrop      = (e: DragEvent) => { e.preventDefault(); uploadDragActive.value = false; uploadDragCounter = 0; if (e.dataTransfer?.files) addToQueue(e.dataTransfer.files); };
const onUploadClick     = () => { const i = document.createElement("input"); i.type = "file"; i.multiple = true; i.accept = ".ttf,.otf,.ttc,.otc"; i.onchange = (e) => { const f = (e.target as HTMLInputElement).files; if (f) addToQueue(f); }; i.click(); };

onBeforeUnmount(() => {
  clearTimeout(dropErrorTimer);
});
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Upload dir config -->
    <div class="card p-4 flex items-center gap-3">
      <FolderOpen class="w-4 h-4 text-sakura-400 shrink-0" />
      <span class="text-sm font-medium text-ink-700 shrink-0">{{ t('uploadDir') }}</span>
      <input
        v-model="uploadDir"
        class="flex-1 h-8 px-3 rounded-lg border border-ink-200 text-sm font-mono text-ink-700 focus:border-sakura-400 focus:ring-2 focus:ring-sakura-400/20 outline-none transition-colors"
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
        <!-- Summary / live progress / idle count -->
        <Transition name="chip-text" mode="out-in">
          <span v-if="uploadSummary" key="summary" class="flex items-center gap-1.5 text-sm font-medium"
            :class="uploadSummary.fail > 0 ? 'text-amber-600' : 'text-mint-600'">
            <CheckCircle2 class="w-3.5 h-3.5 shrink-0" />
            {{ uploadSummary.ok }} {{ locale.startsWith('zh') ? '个已上传' : 'uploaded' }}
            <template v-if="uploadSummary.fail > 0">
              · <span class="text-rose-500">{{ uploadSummary.fail }} {{ locale.startsWith('zh') ? '失败' : 'failed' }}</span>
            </template>
          </span>
          <span v-else-if="uploadRunning" key="progress" class="flex items-center gap-1.5 text-sm font-medium text-sakura-500">
            <Loader2 class="w-3.5 h-3.5 shrink-0 animate-spin-slow" />
            {{ uploadBatchDone }}/{{ uploadBatchTotal }}
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
            'bg-surface border border-ink-100': entry.status === 'pending',
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
</template>
