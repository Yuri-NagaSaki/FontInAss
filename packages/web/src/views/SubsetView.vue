<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import { message } from "ant-design-vue";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import copy from "copy-to-clipboard";
import { subsetFile } from "../api/client";

const { t, locale } = useI18n();

// ─── Settings ─────────────────────────────────────────────────────────────────
const settingsVisible = ref(false);
const settings = reactive({
  SRT_FORMAT: "",
  SRT_STYLE: "",
  CLEAR_FONTS: false,
  STRICT_MODE: true,
  EXTRACT_FONTS: false,
  CLEAR_AFTER_DOWNLOAD: true,
});

const FORMAT_PRESET = "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding";
const STYLE_PRESET = "Style: Default,楷体,20,&H03FFFFFF,&H00FFFFFF,&H00000000,&H02000000,-1,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1";

const loadSettings = () => {
  const saved = localStorage.getItem("fontinass_settings");
  if (saved) {
    try { Object.assign(settings, JSON.parse(saved)); } catch {}
  }
  const savedLocale = localStorage.getItem("locale");
  if (savedLocale) locale.value = savedLocale;
  else locale.value = navigator.language.startsWith("en") ? "en-US" : "zh-CN";
};

watch(settings, () => {
  localStorage.setItem("fontinass_settings", JSON.stringify(settings));
}, { deep: true });

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
  const supported = Array.from(fileList).filter(f =>
    /\.(ass|ssa|srt)$/i.test(f.name)
  );
  if (supported.length === 0) return;

  const entries: FileEntry[] = supported.map(f => reactive({
    key: `${Date.now()}_${f.name}`,
    file: f,
    name: f.name,
    status: t("statusUploading"),
    messages: [],
    resultBytes: null,
    code: null,
  }));

  files.value.push(...entries);
  await Promise.all(entries.map(processFile));
};

const retryFailed = async () => {
  const failed = files.value.filter(f => f.code === null || f.code >= 400);
  if (failed.length === 0) { message.info(t("noFailed")); return; }
  failed.forEach(f => { f.status = t("statusRetrying"); });
  await Promise.all(failed.map(processFile));
  message.success(t("retryDone"));
};

const removeFile = (key: string) => { files.value = files.value.filter(f => f.key !== key); };
const removeAll = () => { files.value = []; };

// ─── Download ─────────────────────────────────────────────────────────────────
const canDownload = computed(() => files.value.some(f => f.resultBytes));
const hasFailed = computed(() => files.value.some(f => f.code === null || f.code >= 400));

const downloadAll = async () => {
  const ready = files.value.filter(f => f.resultBytes);
  if (ready.length === 0) { message.warning(t("noDownloadable")); return; }

  if (ready.length === 1 && !settings.EXTRACT_FONTS) {
    const f = ready[0];
    const name = f.name.replace(/\.(ass|ssa|srt)$/i, ".subset.ass");
    saveAs(new Blob([f.resultBytes!.buffer as ArrayBuffer]), name);
  } else {
    const zip = new JSZip();
    for (const f of ready) {
      const name = f.name.replace(/\.(ass|ssa|srt)$/i, ".subset.ass");
      zip.file(name, f.resultBytes!);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    saveAs(blob, "subset.zip");
  }

  if (settings.CLEAR_AFTER_DOWNLOAD) {
    files.value = files.value.filter(f => !f.resultBytes);
  }
};

// ─── Drag & drop ─────────────────────────────────────────────────────────────
const onDragEnter = (e: DragEvent) => { e.preventDefault(); dragCounter++; dragActive.value = true; };
const onDragOver = (e: DragEvent) => { e.preventDefault(); };
const onDragLeave = (e: DragEvent) => { e.preventDefault(); if (--dragCounter <= 0) { dragActive.value = false; dragCounter = 0; } };
const onDrop = (e: DragEvent) => {
  e.preventDefault(); dragActive.value = false; dragCounter = 0;
  if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
};

const onClickUpload = () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".ass,.ssa,.srt";
  input.multiple = true;
  input.onchange = (e) => {
    const fs = (e.target as HTMLInputElement).files;
    if (fs) addFiles(fs);
  };
  input.click();
};

// Global drag listener
onMounted(() => {
  loadSettings();
  window.addEventListener("dragenter", onDragEnter as EventListener);
  window.addEventListener("dragover", onDragOver as EventListener);
  window.addEventListener("dragleave", onDragLeave as EventListener);
  window.addEventListener("drop", onDrop as EventListener);
});
onBeforeUnmount(() => {
  window.removeEventListener("dragenter", onDragEnter as EventListener);
  window.removeEventListener("dragover", onDragOver as EventListener);
  window.removeEventListener("dragleave", onDragLeave as EventListener);
  window.removeEventListener("drop", onDrop as EventListener);
});

// ─── Table ────────────────────────────────────────────────────────────────────
const columns = computed(() => [
  { title: t("filename"), dataIndex: "name", key: "name" },
  { title: t("status"), dataIndex: "status", key: "status", width: 130 },
  { title: t("message"), key: "messages" },
  { title: t("action"), key: "action", width: 80 },
]);

const copyCell = (text: string) => {
  if (copy(text)) message.success(t("copied"));
  else message.error(t("copyFail"));
};

const statusColor = (code: number | null) => {
  if (code === null) return "processing";
  if (code === 200) return "success";
  if (code === 201) return "warning";
  return "error";
};
</script>

<template>
  <!-- Drag overlay -->
  <transition name="fade">
    <div v-if="dragActive" class="drop-overlay">{{ t("dropTip") }}</div>
  </transition>

  <!-- Toolbar -->
  <a-space style="margin-bottom:16px;flex-wrap:wrap;" :size="8">
    <a-button type="primary" @click="onClickUpload">{{ t("upload") }}</a-button>
    <a-button :disabled="!hasFailed" @click="retryFailed">{{ t("retry") }}</a-button>
    <a-button danger :disabled="files.length === 0" @click="removeAll">{{ t("removeAll") }}</a-button>
    <a-button type="primary" :disabled="!canDownload" @click="downloadAll">{{ t("download") }}</a-button>
    <a-button @click="settingsVisible = true">{{ t("settings") }}</a-button>
  </a-space>

  <!-- File table -->
  <a-table
    :columns="columns"
    :data-source="files"
    row-key="key"
    :pagination="false"
    size="small"
    bordered
  >
    <template #bodyCell="{ column, record }">
      <template v-if="column.key === 'status'">
        <a-badge :status="statusColor((record as FileEntry).code)" :text="(record as FileEntry).status" />
      </template>
      <template v-else-if="column.key === 'messages'">
        <div
          v-if="(record as FileEntry).messages.length"
          class="msg-cell"
          @click="copyCell((record as FileEntry).messages.join('\n'))"
        >
          <div v-for="(m, i) in (record as FileEntry).messages" :key="i">{{ m }}</div>
        </div>
      </template>
      <template v-else-if="column.key === 'action'">
        <a-button type="link" danger size="small" @click="removeFile((record as FileEntry).key)">
          {{ t("delete") }}
        </a-button>
      </template>
    </template>
  </a-table>

  <!-- Settings modal -->
  <a-modal v-model:open="settingsVisible" :title="t('modalTitle')" :footer="null" width="520">
    <a-form layout="vertical" size="small">
      <a-form-item>
        <template #label>
          <a-tooltip :title="t('srtFormatDesc')">{{ t("srtFormatLabel") }}</a-tooltip>
        </template>
        <a-textarea
          v-model:value="settings.SRT_FORMAT"
          :placeholder="t('srtFormatPlaceholder')"
          :rows="2"
          style="word-break:break-all"
        />
        <a-button
          v-if="!settings.SRT_FORMAT"
          type="link"
          size="small"
          style="padding:0"
          @click="settings.SRT_FORMAT = FORMAT_PRESET"
        >
          使用默认 Format
        </a-button>
      </a-form-item>

      <a-form-item>
        <template #label>
          <a-tooltip :title="t('srtStyleDesc')">{{ t("srtStyleLabel") }}</a-tooltip>
        </template>
        <a-textarea
          v-model:value="settings.SRT_STYLE"
          :placeholder="t('srtStylePlaceholder')"
          :rows="2"
          style="word-break:break-all"
        />
        <a-button
          v-if="!settings.SRT_STYLE"
          type="link"
          size="small"
          style="padding:0"
          @click="settings.SRT_STYLE = STYLE_PRESET"
        >
          使用默认 Style
        </a-button>
      </a-form-item>

      <a-row :gutter="16">
        <a-col :span="12" v-for="(cfg, key) in {
          STRICT_MODE: { label: t('strictMode'), desc: t('strictModeDesc') },
          CLEAR_FONTS: { label: t('clearEmbeddedFonts'), desc: t('clearEmbeddedFontsDesc') },
          EXTRACT_FONTS: { label: t('downloadFonts'), desc: t('downloadFontsDesc') },
          CLEAR_AFTER_DOWNLOAD: { label: t('clearAfterDownload'), desc: t('clearAfterDownloadDesc') },
        }" :key="key">
          <a-form-item>
            <template #label>
              <a-tooltip :title="cfg.desc">{{ cfg.label }}</a-tooltip>
            </template>
            <a-switch v-model:checked="(settings as any)[key]" />
          </a-form-item>
        </a-col>
      </a-row>

      <a-form-item>
        <template #label>
          <a-tooltip :title="t('languageDesc')">{{ t("languageLabel") }}</a-tooltip>
        </template>
        <a-select v-model:value="locale" style="width:140px">
          <a-select-option value="zh-CN">中文</a-select-option>
          <a-select-option value="en-US">English</a-select-option>
        </a-select>
      </a-form-item>
    </a-form>
  </a-modal>
</template>

<style scoped>
.drop-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(22,119,255,0.12);
  border: 3px dashed #1677ff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  color: #1677ff;
  pointer-events: none;
}
.fade-enter-active, .fade-leave-active { transition: opacity .25s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.msg-cell {
  cursor: pointer;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-all;
  font-size: 12px;
  color: #555;
  padding: 2px 4px;
  border-radius: 3px;
  transition: background .15s;
}
.msg-cell:hover { background: #f5f5f5; }
:deep(.ant-table td), :deep(.ant-table th) { vertical-align: top; }
</style>
