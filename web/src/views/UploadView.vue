<script setup lang="ts">
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  CloudUpload, FileText, CheckCircle2, AlertTriangle,
  Loader2, X, ShieldCheck,
} from "lucide-vue-next";
import { uploadFontsPublic } from "../api/client";
import type { UploadResult } from "../api/client";
import KButton from "../components/KButton.vue";

const { t, locale } = useI18n();

// ── Queue ─────────────────────────────────────────────────────────────────────
interface QueueEntry {
  file: File;
  status: "pending" | "uploading" | "ok" | "error";
  msg?: string;
  result?: UploadResult;
}

const queue = ref<QueueEntry[]>([]);
const dragActive = ref(false);
let dragCounter = 0;
const uploading = ref(false);
const batchDone = ref(0);
const batchTotal = ref(0);
const summary = ref<{ ok: number; fail: number } | null>(null);
const dropError = ref("");
let dropErrorTimer = 0;

const FONT_EXTS = new Set(["ttf", "otf", "ttc", "otc"]);
const isFont = (f: File) => FONT_EXTS.has(f.name.split(".").pop()?.toLowerCase() ?? "");

const formatBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`;

const pendingCount = computed(() => queue.value.filter(e => e.status === "pending").length);

const addToQueue = (files: FileList | File[]) => {
  const valid = Array.from(files).filter(isFont);
  if (!valid.length) {
    clearTimeout(dropErrorTimer);
    dropError.value = t("publicUploadNoFont");
    dropErrorTimer = window.setTimeout(() => { dropError.value = ""; }, 2500);
    return;
  }
  summary.value = null;
  queue.value.push(...valid.map(f => ({ file: f, status: "pending" as const })));
};

const clearQueue = () => {
  queue.value = queue.value.filter(e => e.status === "uploading");
  summary.value = null;
};

const removeEntry = (index: number) => {
  if (queue.value[index]?.status !== "uploading") {
    queue.value.splice(index, 1);
  }
};

const startUpload = async () => {
  if (uploading.value) return;
  const pending = queue.value.filter(e => e.status === "pending");
  if (!pending.length) return;

  uploading.value = true;
  batchTotal.value = pending.length;
  batchDone.value = 0;

  let ok = 0;
  for (const entry of pending) {
    entry.status = "uploading";
    try {
      const results = await uploadFontsPublic([entry.file]);
      const res = results[0];
      if (res?.error) {
        entry.status = "error";
        entry.msg = res.error;
      } else {
        entry.status = "ok";
        entry.result = res;
        ok++;
      }
    } catch (e) {
      entry.status = "error";
      entry.msg = String(e instanceof Error ? e.message : e);
    }
    batchDone.value++;
  }

  uploading.value = false;
  summary.value = { ok, fail: pending.length - ok };
};

// ── Drag & Drop ───────────────────────────────────────────────────────────────
const onDragEnter = (e: DragEvent) => { e.preventDefault(); dragCounter++; dragActive.value = true; };
const onDragOver = (e: DragEvent) => e.preventDefault();
const onDragLeave = (e: DragEvent) => { e.preventDefault(); if (--dragCounter <= 0) { dragActive.value = false; dragCounter = 0; } };
const onDrop = (e: DragEvent) => { e.preventDefault(); dragActive.value = false; dragCounter = 0; if (e.dataTransfer?.files) addToQueue(e.dataTransfer.files); };
const onClick = () => {
  const i = document.createElement("input");
  i.type = "file";
  i.multiple = true;
  i.accept = ".ttf,.otf,.ttc,.otc";
  i.onchange = (e) => {
    const f = (e.target as HTMLInputElement).files;
    if (f) addToQueue(f);
  };
  i.click();
};
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- Header -->
    <div class="flex flex-col gap-1">
      <h1 class="font-display font-semibold text-xl text-ink-900">{{ t("publicUploadTitle") }}</h1>
      <p class="text-sm text-ink-500">{{ t("publicUploadDesc") }}</p>
    </div>

    <!-- Drop zone -->
    <div
      class="drop-zone cursor-pointer py-12 flex flex-col items-center gap-4 transition-all"
      :class="dragActive ? 'ring-2 ring-sakura-400 scale-[1.01]' : ''"
      @dragenter="onDragEnter"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
      @click="onClick"
    >
      <div class="w-14 h-14 rounded-2xl bg-sakura-50 flex items-center justify-center">
        <CloudUpload class="w-7 h-7 text-sakura-400" :stroke-width="1.5" />
      </div>
      <div class="text-center space-y-1">
        <p class="font-display font-semibold text-ink-800">{{ t("publicUploadDropTitle") }}</p>
        <p class="text-xs text-ink-400">{{ t("publicUploadDropHint") }}</p>
      </div>
    </div>

    <!-- Drop error -->
    <Transition name="fade">
      <div v-if="dropError" class="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-600">
        <AlertTriangle class="w-3.5 h-3.5 shrink-0" />
        {{ dropError }}
      </div>
    </Transition>

    <!-- Queue -->
    <div v-if="queue.length > 0" class="flex flex-col gap-3">
      <!-- Toolbar -->
      <div class="flex items-center gap-2 min-h-[36px]">
        <Transition name="chip-text" mode="out-in">
          <span v-if="summary" key="summary" class="flex items-center gap-1.5 text-sm font-medium"
            :class="summary.fail > 0 ? 'text-amber-600' : 'text-mint-600'">
            <CheckCircle2 class="w-3.5 h-3.5 shrink-0" />
            <template v-if="summary.fail === 0">
              {{ t("publicUploadSuccess", { n: summary.ok }) }}
            </template>
            <template v-else>
              {{ t("publicUploadPartial", { ok: summary.ok, fail: summary.fail }) }}
            </template>
          </span>
          <span v-else-if="uploading" key="progress" class="flex items-center gap-1.5 text-sm font-medium text-sakura-500">
            <Loader2 class="w-3.5 h-3.5 shrink-0 animate-spin-slow" />
            {{ batchDone }}/{{ batchTotal }}
          </span>
          <span v-else key="count" class="text-sm text-ink-500">
            {{ pendingCount }} {{ locale.startsWith('zh') ? '个待上传' : 'pending' }}
          </span>
        </Transition>
        <div class="flex-1" />
        <KButton variant="primary" size="sm" :disabled="uploading || pendingCount === 0" @click="startUpload">
          <CloudUpload class="w-3.5 h-3.5" />
          {{ uploading ? t("publicUploadUploading") : t("publicUploadStart") }}
        </KButton>
        <KButton variant="ghost" size="sm" :disabled="uploading" @click="clearQueue">
          <X class="w-3.5 h-3.5" />{{ locale.startsWith('zh') ? '清空' : 'Clear' }}
        </KButton>
      </div>

      <!-- File list -->
      <div class="flex flex-col gap-1.5 max-h-80 overflow-y-auto">
        <div
          v-for="(entry, i) in queue"
          :key="i"
          class="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm group"
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

          <span v-if="entry.result?.faces" class="text-xs text-mint-600 shrink-0">
            {{ entry.result.faces }} {{ locale.startsWith('zh') ? '个字面' : 'face(s)' }}
          </span>
          <span v-if="entry.msg" class="text-xs text-rose-500 truncate max-w-48">{{ entry.msg }}</span>
          <span class="text-xs text-ink-400 shrink-0">{{ formatBytes(entry.file.size) }}</span>

          <button
            v-if="entry.status !== 'uploading'"
            class="w-5 h-5 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-ink-200/60 transition-all"
            @click.stop="removeEntry(i)"
          >
            <X class="w-3 h-3 text-ink-400" />
          </button>
        </div>
      </div>
    </div>

    <!-- Security note -->
    <div class="flex items-start gap-3 px-4 py-3 rounded-xl bg-sky-50/60 border border-sky-100 text-xs text-sky-700 leading-relaxed">
      <ShieldCheck class="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
      {{ t("publicUploadSecurityNote") }}
    </div>
  </div>
</template>
