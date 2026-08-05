<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  FolderOpen,
  KeyRound as KeyRound2, Database, CloudUpload, Layers,
  Share2,
} from "lucide-vue-next";
import { API_KEY_CHANGED_EVENT, getApiKey, verifyFontAccess, type FontAccessSession } from "../api/client";
import SharingAdminPane from "../components/SharingAdminPane.vue";
import FontUploadPane from "../components/FontUploadPane.vue";
import IndexStatsPane from "../components/IndexStatsPane.vue";
import FontListPane from "../components/FontListPane.vue";
import R2BrowserPane from "../components/R2BrowserPane.vue";
import ApiTokensPane from "../components/ApiTokensPane.vue";
import AuthLockScreen from "../components/AuthLockScreen.vue";
import { useIndexState } from "../composables/useIndexState";

const { t } = useI18n();

// ── Access session ────────────────────────────────────────────────────────────
const apiKey = ref(getApiKey());
const session = ref<FontAccessSession | null>(null);
const accessLoading = ref(true);
const isAdmin = computed(() => session.value?.role === "admin");

const loadAccess = async () => {
  apiKey.value = getApiKey();
  if (!apiKey.value.trim()) {
    session.value = null;
    accessLoading.value = false;
    return;
  }
  accessLoading.value = true;
  try { session.value = await verifyFontAccess(apiKey.value); }
  catch { session.value = null; }
  finally { accessLoading.value = false; }
};
const syncKey = () => { void loadAccess(); };
const onUnlocked = (value: FontAccessSession) => { session.value = value; accessLoading.value = false; };

onMounted(() => {
  void loadAccess();
  window.addEventListener(API_KEY_CHANGED_EVENT, syncKey);
  window.addEventListener("focus", syncKey);
});
onUnmounted(() => {
  window.removeEventListener(API_KEY_CHANGED_EVENT, syncKey);
  window.removeEventListener("focus", syncKey);
});

// ── Tabs ──────────────────────────────────────────────────────────────────────
type Tab = "list" | "browser" | "upload" | "stats" | "sharing" | "apiTokens";
const activeTab = ref<Tab>("list");
const tabs = computed(() => isAdmin.value
  ? [
      { id: "list" as const, icon: Database, label: t("indexedFonts") },
      { id: "browser" as const, icon: FolderOpen, label: t("r2Browser") },
      { id: "upload" as const, icon: CloudUpload, label: t("uploadFonts") },
      { id: "stats" as const, icon: Layers, label: t("indexStats") },
      { id: "sharing" as const, icon: Share2, label: t("sharingFontsTab") },
      { id: "apiTokens" as const, icon: KeyRound2, label: t("navApiTokens") },
    ]
  : [
      { id: "list" as const, icon: Database, label: t("indexedFonts") },
      { id: "upload" as const, icon: CloudUpload, label: t("uploadFonts") },
    ]);

watch(tabs, (available) => {
  if (!available.some((tab) => tab.id === activeTab.value)) activeTab.value = "list";
});

const fontListRef = ref<InstanceType<typeof FontListPane> | null>(null);
const r2BrowserRef = ref<InstanceType<typeof R2BrowserPane> | null>(null);
const { indexProgress } = useIndexState();

const handleFontChanged = () => {
  fontListRef.value?.reload();
};
</script>

<template>
  <div>
    <div v-if="accessLoading" class="flex min-h-[55vh] items-center justify-center text-sakura-400">
      <span class="h-5 w-5 animate-spin rounded-full border-2 border-sakura-100 border-t-sakura-400" />
    </div>

    <AuthLockScreen v-else-if="!session" @unlocked="onUnlocked" />

    <div v-else class="flex flex-col gap-5">
      <div v-if="session.role === 'member'" class="flex flex-wrap items-center gap-2 text-xs text-ink-400">
        <span class="rounded-full border border-mint-200 bg-mint-50 px-2.5 py-1 font-semibold text-mint-600">{{ t('memberAccessBadge') }}</span>
        <span>{{ t('memberAccessSignedInAs', { name: session.name }) }}</span>
      </div>

      <div class="flex items-center gap-1 p-1 bg-ink-100/60 rounded-2xl w-fit max-w-full overflow-x-auto">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="flex items-center gap-1.5 h-8 px-4 rounded-xl text-sm font-medium transition-colors duration-150 shrink-0"
          :class="activeTab === tab.id ? 'bg-surface shadow-sm text-ink-900' : 'text-ink-500 hover:text-ink-700'"
          @click="activeTab = tab.id as Tab"
        >
          <component :is="tab.icon" class="w-3.5 h-3.5" />
          {{ tab.label }}
        </button>
      </div>

      <FontListPane v-if="activeTab === 'list'" ref="fontListRef" :can-delete="isAdmin" />
      <R2BrowserPane v-if="activeTab === 'browser'" ref="r2BrowserRef" @changed="handleFontChanged" />
      <FontUploadPane v-if="activeTab === 'upload'" @uploaded="handleFontChanged" />
      <IndexStatsPane v-if="activeTab === 'stats'" :index-progress="indexProgress" @changed="handleFontChanged" />
      <SharingAdminPane v-if="activeTab === 'sharing'" />
      <ApiTokensPane v-if="activeTab === 'apiTokens'" />
    </div>
  </div>
</template>
