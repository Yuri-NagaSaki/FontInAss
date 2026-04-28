<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { FileArchive, Download, Eye, Pencil, Trash2 } from "lucide-vue-next";
import KBadge from "./KBadge.vue";
import type { SharedArchive } from "../api/client";
import { formatBytes } from "../lib/format";

const { t } = useI18n();

const props = withDefaults(defineProps<{
  archive: SharedArchive;
  isAdmin: boolean;
  variant?: "default" | "search";
}>(), { variant: "default" });

defineEmits<{
  download: [];
  preview: [];
  "download-file": [];
  edit: [];
  delete: [];
}>();

function parseLangs(json: string): string[] {
  try { return JSON.parse(json); } catch { return []; }
}

function parseFmts(json: string): string[] {
  try { return JSON.parse(json); } catch { return []; }
}

const iconBgClass = props.variant === "search" ? "bg-sky-50" : "bg-sakura-50";
const iconTextClass = props.variant === "search" ? "text-sky-400" : "text-sakura-400";
</script>

<template>
  <div class="card p-4 hover:shadow-md transition-shadow duration-200 group">
    <div class="flex items-start gap-3">
      <div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5" :class="iconBgClass">
        <FileArchive class="w-5 h-5" :class="iconTextClass" />
      </div>
      <div class="flex-1 min-w-0">
        <p class="font-display font-semibold text-ink-900 text-sm leading-snug break-all">
          {{ archive.filename }}
        </p>
        <!-- Search variant: show context line -->
        <p v-if="variant === 'search'" class="text-xs text-ink-400 mt-1">
          {{ archive.name_cn }} · {{ archive.season }} ·
          <span class="text-sakura-400">{{ archive.sub_group }}</span>
        </p>
        <!-- Metadata row -->
        <div class="flex items-center gap-2 mt-2 flex-wrap" :class="{ 'mt-1.5': variant === 'search' }">
          <KBadge v-if="variant === 'default'" variant="sakura">{{ archive.sub_group }}</KBadge>
          <span v-if="variant === 'default' && archive.episode_count" class="text-xs text-ink-400">
            {{ archive.episode_count }} {{ t('sharingEpisodes') }}
          </span>
          <KBadge v-if="variant === 'default'" v-for="fmt in parseFmts(archive.subtitle_format)" :key="fmt" variant="default" class="text-[10px]">
            {{ fmt }}
          </KBadge>
          <KBadge v-for="lang in parseLangs(archive.languages)" :key="lang" variant="sky" class="text-[10px]">
            {{ lang }}
          </KBadge>
          <KBadge v-if="variant === 'default' && archive.has_fonts" variant="success" class="text-[10px]">
            {{ t('sharingFont') }}
          </KBadge>
          <span class="text-xs text-ink-300 tabular-nums" :class="{ 'ml-auto': variant === 'default' }">
            {{ formatBytes(archive.file_size) }}
          </span>
        </div>
      </div>
      <button
        @click="$emit('download')"
        class="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-sakura-400 hover:text-white hover:bg-sakura-500 transition-colors duration-150 active:scale-95 mt-0.5"
        :title="t('download')"
      >
        <Download class="w-4 h-4" />
      </button>
      <!-- Admin actions -->
      <template v-if="isAdmin">
        <button
          @click="$emit('preview')"
          class="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-sky-400 hover:text-white hover:bg-sky-500 transition-colors duration-150 active:scale-95 mt-0.5"
          :title="t('sharingPreview')"
        >
          <Eye class="w-4 h-4" />
        </button>
        <button
          v-if="variant === 'default'"
          @click="$emit('download-file')"
          class="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-mint-400 hover:text-white hover:bg-mint-500 transition-colors duration-150 active:scale-95 mt-0.5"
          :title="t('sharingDownload')"
        >
          <Download class="w-4 h-4" />
        </button>
        <button
          @click="$emit('edit')"
          class="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-amber-400 hover:text-white hover:bg-amber-500 transition-colors duration-150 active:scale-95 mt-0.5"
          :title="t('sharingEdit')"
        >
          <Pencil class="w-4 h-4" />
        </button>
        <button
          @click="$emit('delete')"
          class="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-red-400 hover:text-white hover:bg-red-500 transition-colors duration-150 active:scale-95 mt-0.5"
          :title="t('delete')"
        >
          <Trash2 class="w-4 h-4" />
        </button>
      </template>
    </div>
  </div>
</template>
