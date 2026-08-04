<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  CloudUpload,
  Database,
  FolderOpen,
  Layers,
  Share2,
} from "lucide-vue-next";
import SharingAdminPane from "../components/SharingAdminPane.vue";
import FontUploadPane from "../components/FontUploadPane.vue";
import IndexStatsPane from "../components/IndexStatsPane.vue";
import FontListPane from "../components/FontListPane.vue";
import R2BrowserPane from "../components/R2BrowserPane.vue";
import { useIndexState } from "../composables/useIndexState";

const { t } = useI18n();
type Tab = "list" | "browser" | "upload" | "stats" | "sharing";
const activeTab = ref<Tab>("list");
const tabs = [
  { id: "list" as const, icon: Database, key: "indexedFonts" },
  { id: "browser" as const, icon: FolderOpen, key: "r2Browser" },
  { id: "upload" as const, icon: CloudUpload, key: "uploadFonts" },
  { id: "stats" as const, icon: Layers, key: "indexStats" },
  { id: "sharing" as const, icon: Share2, key: "sharingFontsTab" },
];
const fontListRef = ref<InstanceType<typeof FontListPane> | null>(null);
const { indexProgress } = useIndexState();
const handleFontChanged = () => fontListRef.value?.reload();
</script>

<template>
  <div class="flex flex-col gap-5">
    <header>
      <h1 class="font-display text-2xl font-bold text-ink-900">{{ t('adminFontTitle') }}</h1>
      <p class="mt-1 text-sm text-ink-500">{{ t('adminFontDesc') }}</p>
    </header>
    <div class="flex items-center gap-1 overflow-x-auto border-b border-ink-100">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm font-semibold transition-colors"
        :class="activeTab === tab.id ? 'border-sakura-500 text-ink-900' : 'border-transparent text-ink-500 hover:text-sakura-600'"
        @click="activeTab = tab.id"
      >
        <component :is="tab.icon" class="h-3.5 w-3.5" />{{ t(tab.key) }}
      </button>
    </div>
    <FontListPane v-if="activeTab === 'list'" ref="fontListRef" :can-delete="true" />
    <R2BrowserPane v-if="activeTab === 'browser'" @changed="handleFontChanged" />
    <FontUploadPane v-if="activeTab === 'upload'" @uploaded="handleFontChanged" />
    <IndexStatsPane v-if="activeTab === 'stats'" :index-progress="indexProgress" @changed="handleFontChanged" />
    <SharingAdminPane v-if="activeTab === 'sharing'" />
  </div>
</template>
