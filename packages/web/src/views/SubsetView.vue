<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import copy from "copy-to-clipboard";
import {
  Cherry, Download, Trash2, RotateCcw,
  CheckCircle2, XCircle, Loader2, FileText, Copy, X, AlertTriangle, Info,
} from "lucide-vue-next";
import { subsetFile } from "../api/client";
import KButton from "../components/KButton.vue";
import KBadge from "../components/KBadge.vue";
import KEmpty from "../components/KEmpty.vue";

const { t, locale } = useI18n();

// ─── Load settings from localStorage (managed by the navbar Settings panel) ──
interface Settings {
  SRT_FORMAT: string;
  SRT_STYLE: string;
  CLEAR_FONTS: boolean;
  STRICT_MODE: boolean;
  EXTRACT_FONTS: boolean;
  CLEAR_AFTER_DOWNLOAD: boolean;
}

const settings = reactive<Settings>({
  SRT_FORMAT: "",
  SRT_STYLE: "",
  CLEAR_FONTS: false,
  STRICT_MODE: true,
  EXTRACT_FONTS: false,
  CLEAR_AFTER_DOWNLOAD: true,
});

const loadSettings = () => {
  const saved = localStorage.getItem("fontinass_settings");
  if (saved) { try { Object.assign(settings, JSON.parse(saved)); } catch {} }
  const savedLocale = localStorage.getItem("locale");
  if (savedLocale) locale.value = savedLocale;
  else locale.value = navigator.language.startsWith("en") ? "en-US" : "zh-CN";
};

watch(locale, (v) => localStorage.setItem("locale", v));

// ─── File list ────────────────────────────────────────────────────────────────
interface FileEntry {
  key: string;
  file: File;
  name: string;
  status: string;
  messages: string[];
  resultBytes: Uint8Array | null;
  code: number | null;
}

const files = ref<FileEntry[]>([]);
const dragActive = ref(false);
let dragCounter = 0;

// ─── Concurrency pool ─────────────────────────────────────────────────────────
// Workers have a 128 MB memory limit. CJK fonts are large; cap concurrent
// subsetting requests so Worker isolates don't race to exhaustion.
const MAX_CONCURRENT = 3;

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit = MAX_CONCURRENT,
): Promise<void> {
  const queue = [...tasks];
  const workers: Promise<void>[] = [];
  const runNext = async () => {
    while (queue.length) {
      const task = queue.shift()!;
      await task();
    }
  };
  for (let i = 0; i < Math.min(limit, tasks.length); i++) {
    workers.push(runNext());
  }
  await Promise.all(workers);
}

// ─── Processing ───────────────────────────────────────────────────────────────
const processFile = async (entry: FileEntry) => {
  entry.status = t("statusUploading");
  entry.messages = [];
  entry.resultBytes = null;
  entry.code = null;
  try {
    const res = await subsetFile(entry.file, {
      fontsCheck: settings.STRICT_MODE,
      clearFonts: settings.CLEAR_FONTS,
      srtFormat: settings.SRT_FORMAT,
      srtStyle: settings.SRT_STYLE,
    });
    entry.code = res.code;
    entry.messages = res.messages ?? [];
    entry.resultBytes = res.data;
    const codeKey = String(res.code);
    entry.status = t(codeKey) !== codeKey ? t(codeKey) : t("statusError");
  } catch (e) {
    entry.status = t("statusError");
    entry.messages = [String(e instanceof Error ? e.message : e)];
  }
};

const addFiles = async (fileList: FileList | File[]) => {
  const supported = Array.from(fileList).filter(f => /\.(ass|ssa|srt)$/i.test(f.name));
  if (supported.length === 0) return;
  const entries: FileEntry[] = supported.map(f => reactive({
    key: `${Date.now()}_${f.name}`,
    file: f, name: f.name,
    status: t("statusUploading"),
    messages: [], resultBytes: null, code: null,
  }));
  files.value.push(...entries);
  await runWithConcurrency(entries.map(e => () => processFile(e)));
};

const retryFailed = async () => {
  const failed = files.value.filter(f => f.code === null || f.code >= 300);
  if (failed.length === 0) { toast.info(t("noFailed")); return; }
  failed.forEach(f => { f.status = t("statusRetrying"); });
  await runWithConcurrency(failed.map(e => () => processFile(e)));
  toast.success(t("retryDone"));
};

const removeFile = (key: string) => { files.value = files.value.filter(f => f.key !== key); };
const removeAll = () => { files.value = []; };

// ─── Download ──────────────────────────────────────────────────────────────────
const canDownload = computed(() => files.value.some(f => f.resultBytes));
const hasFailed = computed(() => files.value.some(f => f.code === null || f.code >= 300));

const downloadAll = async () => {
  const ready = files.value.filter(f => f.resultBytes);
  if (ready.length === 0) { toast.warning(t("noDownloadable")); return; }
  if (ready.length === 1 && !settings.EXTRACT_FONTS) {
    const f = ready[0];
    saveAs(new Blob([f.resultBytes!.buffer as ArrayBuffer]), f.name.replace(/\.(ass|ssa|srt)$/i, ".subset.ass"));
  } else {
    const zip = new JSZip();
    for (const f of ready) zip.file(f.name.replace(/\.(ass|ssa|srt)$/i, ".subset.ass"), f.resultBytes!);
    const blob = await zip.generateAsync({ type: "blob" });
    saveAs(blob, "subset.zip");
  }
  if (settings.CLEAR_AFTER_DOWNLOAD) files.value = files.value.filter(f => !f.resultBytes);
};

const downloadEntry = (entry: FileEntry) => {
  if (!entry.resultBytes) return;
  saveAs(new Blob([entry.resultBytes.buffer as ArrayBuffer]), entry.name.replace(/\.(ass|ssa|srt)$/i, ".subset.ass"));
};

// ─── Drag & drop ─────────────────────────────────────────────────────────────
const onDragEnter = (e: DragEvent) => { e.preventDefault(); dragCounter++; dragActive.value = true; };
const onDragOver  = (e: DragEvent) => { e.preventDefault(); };
const onDragLeave = (e: DragEvent) => { e.preventDefault(); if (--dragCounter <= 0) { dragActive.value = false; dragCounter = 0; } };
const onDrop = (e: DragEvent) => {
  e.preventDefault(); dragActive.value = false; dragCounter = 0;
  if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
};

const onClickUpload = () => {
  const input = document.createElement("input");
  input.type = "file"; input.accept = ".ass,.ssa,.srt"; input.multiple = true;
  input.onchange = (e) => { const fs = (e.target as HTMLInputElement).files; if (fs) addFiles(fs); };
  input.click();
};

onMounted(() => {
  loadSettings();
  window.addEventListener("dragenter", onDragEnter as EventListener);
  window.addEventListener("dragover",  onDragOver  as EventListener);
  window.addEventListener("dragleave", onDragLeave as EventListener);
  window.addEventListener("drop",      onDrop      as EventListener);
});
onBeforeUnmount(() => {
  window.removeEventListener("dragenter", onDragEnter as EventListener);
  window.removeEventListener("dragover",  onDragOver  as EventListener);
  window.removeEventListener("dragleave", onDragLeave as EventListener);
  window.removeEventListener("drop",      onDrop      as EventListener);
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
const copyMsg = (text: string) => {
  if (copy(text)) toast.success(t("copied"));
  else toast.error(t("copyFail"));
};

const statusBadge = (entry: FileEntry): "loading" | "success" | "warning" | "error" => {
  if (entry.code === null) return "loading";
  if (entry.code === 200) return "success";
  if (entry.code === 201) return "warning";
  return "error";
};

const formatBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n/1024).toFixed(1)} KB` : `${(n/1048576).toFixed(2)} MB`;

const processingCount = computed(() => files.value.filter(f => f.code === null).length);
const successCount    = computed(() => files.value.filter(f => f.code === 200).length);
const failedCount     = computed(() => files.value.filter(f => f.code !== null && f.code >= 300).length);
const warnCount       = computed(() => files.value.filter(f => f.code === 201).length);

// Message severity helper
const getMsgIcon = (code: number | null) => {
  if (code === null) return Loader2;
  if (code === 200) return CheckCircle2;
  if (code === 201) return AlertTriangle;
  return XCircle;
};

const expandedMessages = ref<Set<string>>(new Set());
const toggleMessages = (key: string) => {
  const s = new Set(expandedMessages.value);
  if (s.has(key)) s.delete(key); else s.add(key);
  expandedMessages.value = s;
};

interface ParsedMessage {
  type: 'missing-font' | 'missing-glyphs' | 'other';
  fontName?: string;
  raw: string;
}

const parseMessage = (msg: string): ParsedMessage => {
  const fontMatch = msg.match(/^Missing font:\s*\[(.+)\]$/);
  if (fontMatch) return { type: 'missing-font', fontName: fontMatch[1], raw: msg };
  const glyphMatch = msg.match(/^Missing glyphs:\s*(.+)$/);
  if (glyphMatch) return { type: 'missing-glyphs', raw: msg };
  return { type: 'other', raw: msg };
};

const parsedMessages = (entry: FileEntry) => entry.messages.map(parseMessage);

const missingFontCount = (entry: FileEntry) =>
  entry.messages.filter(m => m.startsWith('Missing font:')).length;

const summaryText = (entry: FileEntry) => {
  const mfc = missingFontCount(entry);
  if (mfc > 0 && mfc === entry.messages.length) {
    return locale.value.startsWith('zh') ? `${mfc} 个字体未找到` : `${mfc} missing font${mfc > 1 ? 's' : ''}`;
  }
  return entry.messages[0];
};
</script>

<template>
  <div>
  <!-- Drag overlay -->
  <transition name="fade">
    <div
      v-if="dragActive && files.length > 0"
      class="fixed inset-0 z-50 pointer-events-none flex items-center justify-center bg-white/60 backdrop-blur-sm"
    >
      <div class="drop-zone w-64 h-40 flex flex-col items-center justify-center gap-3 pointer-events-none">
        <Cherry class="w-10 h-10 text-sakura-400" />
        <p class="font-medium text-sakura-500">{{ t("dropHere") }}</p>
      </div>
    </div>
  </transition>

  <div class="flex flex-col gap-6">

    <!-- ─── Drop zone ──────────────────────────────────────────────────────── -->
    <div
      class="drop-zone relative w-full flex flex-col items-center justify-center gap-4 py-14 px-6 cursor-pointer transition-all duration-200"
      :class="dragActive ? 'ring-2 ring-sakura-400 scale-[1.01]' : ''"
      @click="onClickUpload"
    >
      <div class="absolute top-4 right-6 opacity-30 pointer-events-none select-none text-3xl">🌸</div>
      <div class="absolute bottom-4 left-8 opacity-20 pointer-events-none select-none text-xl">🌸</div>
      <div class="w-16 h-16 rounded-2xl bg-sakura-50 flex items-center justify-center">
        <Cherry class="w-8 h-8 text-sakura-400" :stroke-width="1.5" />
      </div>
      <div class="text-center space-y-1">
        <p class="font-display font-semibold text-ink-900 text-lg">{{ t("dropZoneTitle") }}</p>
        <p class="text-sm text-ink-400">{{ t("dropZoneHint") }}</p>
      </div>
      <div class="flex items-center gap-2 px-5 py-2 rounded-xl bg-sakura-400 text-white text-sm font-medium pointer-events-none">
        <FileText class="w-4 h-4" />
        {{ t("chooseFiles") }}
      </div>
    </div>

    <!-- ─── Stats + actions strip ─────────────────────────────────────────── -->
    <div v-if="files.length > 0" class="flex items-center gap-3 flex-wrap">
      <span class="text-sm text-ink-500 font-medium">{{ t("totalFiles", { n: files.length }) }}</span>
      <div class="flex items-center gap-2">
        <KBadge v-if="processingCount > 0" variant="loading">
          <Loader2 class="w-3 h-3 animate-spin-slow" />{{ processingCount }} {{ t("processing") }}
        </KBadge>
        <KBadge v-if="successCount > 0" variant="success">
          <CheckCircle2 class="w-3 h-3" />{{ successCount }} {{ t("done") }}
        </KBadge>
        <KBadge v-if="warnCount > 0" variant="warning">
          <AlertTriangle class="w-3 h-3" />{{ warnCount }} {{ t("warned") }}
        </KBadge>
        <KBadge v-if="failedCount > 0" variant="error">
          <XCircle class="w-3 h-3" />{{ failedCount }} {{ t("failed") }}
        </KBadge>
      </div>
      <div class="flex-1" />
      <div class="flex items-center gap-2">
        <KButton v-if="hasFailed" variant="secondary" size="sm" @click="retryFailed">
          <RotateCcw class="w-3.5 h-3.5" />{{ t("retryFailed") }}
        </KButton>
        <KButton v-if="canDownload" variant="primary" size="sm" @click="downloadAll">
          <Download class="w-3.5 h-3.5" />{{ t("downloadAll") }}
        </KButton>
        <KButton variant="ghost" size="sm" @click="removeAll">
          <Trash2 class="w-3.5 h-3.5" />{{ t("clearAll") }}
        </KButton>
      </div>
    </div>

    <!-- ─── File list ──────────────────────────────────────────────────────── -->
    <div v-if="files.length > 0" class="flex flex-col gap-2">
      <TransitionGroup name="list">
        <div
          v-for="entry in files"
          :key="entry.key"
          class="rounded-2xl border overflow-hidden transition-colors duration-300"
          :class="{
            'bg-white border-sakura-100':      entry.code === null,
            'bg-mint-50/60 border-mint-200':   entry.code === 200,
            'bg-amber-50/60 border-amber-200': entry.code === 201,
            'bg-rose-50/60 border-rose-200':   entry.code !== null && entry.code !== 200 && entry.code !== 201,
          }"
        >
          <!-- Main row -->
          <div class="flex items-center gap-3 px-4 py-3">
            <div
              class="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center"
              :class="{
                'bg-sakura-100 text-sakura-400': entry.code === null,
                'bg-mint-100 text-mint-600':     entry.code === 200,
                'bg-amber-100 text-amber-500':   entry.code === 201,
                'bg-rose-100 text-rose-500':     entry.code !== null && entry.code !== 200 && entry.code !== 201,
              }"
            >
              <Loader2 v-if="entry.code === null" class="w-4 h-4 animate-spin-slow" />
              <CheckCircle2 v-else-if="entry.code === 200" class="w-4 h-4" />
              <AlertTriangle v-else-if="entry.code === 201" class="w-4 h-4" />
              <XCircle v-else class="w-4 h-4" />
            </div>

            <div class="flex-1 min-w-0">
              <p class="font-medium text-sm text-ink-900 truncate">{{ entry.name }}</p>
              <p class="text-xs text-ink-400">{{ formatBytes(entry.file.size) }}</p>
            </div>

            <KBadge :variant="statusBadge(entry)" class="shrink-0 hidden sm:inline-flex">{{ entry.status }}</KBadge>

            <button
              v-if="entry.resultBytes"
              class="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-sky-500 hover:bg-sky-100 transition-colors"
              @click.stop="downloadEntry(entry)"
            ><Download class="w-4 h-4" /></button>

            <button
              class="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-ink-400 hover:text-rose-500 hover:bg-rose-50 transition-colors"
              @click.stop="removeFile(entry.key)"
            ><X class="w-4 h-4" /></button>
          </div>

          <!-- Messages panel — visible when there are messages -->
          <div v-if="entry.messages.length > 0" class="border-t" :class="{
            'border-mint-200/50':   entry.code === 200,
            'border-amber-200/60':  entry.code === 201,
            'border-rose-200/60':   entry.code !== null && entry.code !== 200 && entry.code !== 201,
            'border-sakura-100/50': entry.code === null,
          }">
            <!-- Summary bar (always visible) -->
            <button
              class="w-full flex items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-black/[0.02]"
              @click="toggleMessages(entry.key)"
            >
              <component :is="getMsgIcon(entry.code)" class="w-3.5 h-3.5 shrink-0" :class="{
                'text-mint-600':  entry.code === 200,
                'text-amber-500': entry.code === 201,
                'text-rose-500':  entry.code !== null && entry.code !== 200 && entry.code !== 201,
                'text-sakura-400 animate-spin-slow': entry.code === null,
              }" />
              <span class="flex-1 text-xs truncate" :class="{
                'text-mint-700':  entry.code === 200,
                'text-amber-700': entry.code === 201,
                'text-rose-700':  entry.code !== null && entry.code !== 200 && entry.code !== 201,
                'text-ink-500':   entry.code === null,
              }">{{ summaryText(entry) }}</span>
              <span v-if="entry.messages.length > 1" class="shrink-0 text-xs text-ink-400">
                {{ entry.messages.length }} {{ locale.startsWith('zh') ? '条消息' : 'messages' }}
              </span>
              <Info class="w-3.5 h-3.5 shrink-0 text-ink-300 transition-transform duration-200" :class="expandedMessages.has(entry.key) ? 'rotate-180' : ''" />
            </button>

            <!-- Expanded messages list -->
            <div v-if="expandedMessages.has(entry.key)" class="px-4 pb-3 animate-fade-in">
              <!-- Missing fonts grid -->
              <div v-if="missingFontCount(entry) > 0" class="mb-2">
                <p class="text-[11px] text-ink-400 mb-2 font-medium uppercase tracking-wider">
                  {{ locale.startsWith('zh') ? '缺少字体' : 'Missing Fonts' }}
                </p>
                <div class="flex flex-wrap gap-1.5">
                  <span
                    v-for="pm in parsedMessages(entry).filter(m => m.type === 'missing-font')"
                    :key="pm.fontName"
                    class="group inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-mono cursor-pointer transition-colors"
                    :class="entry.code === 300
                      ? 'bg-rose-100/80 text-rose-700 hover:bg-rose-200/80'
                      : 'bg-amber-100/80 text-amber-700 hover:bg-amber-200/80'"
                    @click="copyMsg(pm.fontName!)"
                  >
                    <XCircle class="w-3 h-3 shrink-0 opacity-50" />
                    {{ pm.fontName }}
                    <Copy class="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
                  </span>
                </div>
              </div>
              <!-- Other messages -->
              <div v-if="parsedMessages(entry).some(m => m.type !== 'missing-font')" class="space-y-1.5" :class="{ 'mt-2 pt-2 border-t border-ink-100': missingFontCount(entry) > 0 }">
                <div
                  v-for="(pm, i) in parsedMessages(entry).filter(m => m.type !== 'missing-font')"
                  :key="i"
                  class="group flex items-start gap-2 px-3 py-2 rounded-xl text-xs font-mono leading-relaxed"
                  :class="{
                    'bg-mint-50 text-mint-800':   entry.code === 200,
                    'bg-amber-50 text-amber-800': entry.code === 201,
                    'bg-rose-50 text-rose-800':   entry.code !== null && entry.code !== 200 && entry.code !== 201,
                    'bg-sakura-50 text-ink-600':  entry.code === null,
                  }"
                >
                  <span class="flex-1 break-all">{{ pm.raw }}</span>
                  <button class="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-ink-400 hover:text-ink-700" @click="copyMsg(pm.raw)">
                    <Copy class="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </TransitionGroup>
    </div>

    <KEmpty v-else :title="t('noFilesYet')" :description="t('noFilesHint')" />
  </div>
  </div>
</template>

<style scoped>
.list-enter-active { transition: all 0.25s cubic-bezier(0.25, 1, 0.5, 1); }
.list-leave-active { transition: all 0.15s ease-in; position: absolute; width: 100%; }
.list-enter-from   { opacity: 0; transform: translateY(-8px); }
.list-leave-to     { opacity: 0; transform: translateX(12px); }
.list-move         { transition: transform 0.25s cubic-bezier(0.25, 1, 0.5, 1); }
.fade-enter-active { transition: opacity 0.15s; }
.fade-leave-active { transition: opacity 0.1s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
