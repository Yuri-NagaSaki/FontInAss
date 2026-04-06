<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import {
  FolderOpen,
  KeyRound, Database, CloudUpload, CheckCircle2,
  Share2,
} from "lucide-vue-next";
import { getApiKey, setApiKey } from "../api/client";
import KButton from "../components/KButton.vue";
import SharingAdminPane from "../components/SharingAdminPane.vue";
import FontUploadPane from "../components/FontUploadPane.vue";
import IndexStatsPane from "../components/IndexStatsPane.vue";
import FontListPane from "../components/FontListPane.vue";
import R2BrowserPane from "../components/R2BrowserPane.vue";
import { useIndexState } from "../composables/useIndexState";

const { t } = useI18n();

// ── API Key lock ──────────────────────────────────────────────────────────────
const apiKey = ref(getApiKey());
const hasKey = computed(() => !!apiKey.value.trim());
const lockKeyInput = ref("");
const unlockWithKey = () => {
  const k = lockKeyInput.value.trim();
  if (!k) return;
  setApiKey(k);
  apiKey.value = k;
};

// ── Tabs ──────────────────────────────────────────────────────────────────────
type Tab = "list" | "browser" | "upload" | "stats" | "sharing";
const activeTab = ref<Tab>("list");

// Child refs
const fontListRef = ref<InstanceType<typeof FontListPane> | null>(null);
const r2BrowserRef = ref<InstanceType<typeof R2BrowserPane> | null>(null);

const { indexProgress } = useIndexState();

const handleFontChanged = () => {
  fontListRef.value?.reload();
};
</script>

<template>
  <div>
  <!-- Lock screen — full-height centered with ambient sakura background -->
  <div v-if="!hasKey" class="relative flex min-h-[74vh] items-center justify-center overflow-hidden py-12">

    <!-- Ambient background blobs -->
    <div class="pointer-events-none absolute inset-0" aria-hidden="true">
      <div class="absolute -top-20 right-0 h-80 w-80 rounded-full bg-sakura-200/50 blur-3xl" />
      <div class="absolute -bottom-20 -left-10 h-72 w-72 rounded-full bg-sky-100/60 blur-3xl" />
      <div class="absolute left-1/2 top-1/2 h-64 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sakura-100/70 blur-3xl" />
    </div>

    <div class="relative z-10 w-full max-w-sm px-5">

      <!-- Icon -->
      <div class="mb-8 flex justify-center animate-fade-in">
        <div class="relative">
          <div class="absolute inset-0 scale-150 rounded-full bg-sakura-400/20 blur-xl" />
          <div class="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-sakura-400 to-sakura-600 shadow-[var(--shadow-xl)]">
            <KeyRound class="h-9 w-9 text-white" :stroke-width="1.5" />
          </div>
        </div>
      </div>

      <!-- Heading -->
      <div class="mb-6 text-center animate-fade-in" style="animation-delay:60ms">
        <h1 class="font-display text-[1.85rem] font-bold leading-tight tracking-tight text-ink-900">
          {{ t('lockTitle') }}
        </h1>
        <p class="mt-2 text-sm leading-relaxed text-ink-400">
          {{ t('lockDesc') }}
        </p>
      </div>

      <!-- Auth card -->
      <div class="card-raised flex flex-col gap-3.5 p-6 animate-fade-in" style="animation-delay:120ms">

        <!-- API key input -->
        <div class="flex flex-col gap-1.5">
          <span class="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-400 select-none">API Key</span>
          <div class="relative">
            <input
              v-model="lockKeyInput"
              type="password"
              :placeholder="t('apiKeyPlaceholder')"
              class="w-full h-11 rounded-xl border border-ink-200 bg-surface px-4 pr-10 font-mono text-sm text-ink-900 placeholder:text-ink-300 focus:border-sakura-400 focus:ring-2 focus:ring-sakura-400/20 outline-none transition-all duration-150"
              @keyup.enter="unlockWithKey"
            />
            <KeyRound class="pointer-events-none absolute right-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-300" />
          </div>
        </div>

        <!-- Submit -->
        <KButton variant="primary" size="lg" class="w-full" @click="unlockWithKey">
          {{ t('unlock') }}
        </KButton>

        <!-- Hint -->
        <p class="text-center text-[11px] leading-relaxed text-ink-300">
          {{ t('lockHint', { apiKey: 'API_KEY', envFile: '.env' }) }}
        </p>
      </div>

    </div>
  </div>

  <div v-else class="flex flex-col gap-5">
    <!-- ─── Tabs ─────────────────────────────────────────────────────────────── -->
    <div class="flex items-center gap-1 p-1 bg-ink-100/60 rounded-2xl w-fit">
      <button
        v-for="tab in [
          { id: 'list',    icon: Database,     label: t('indexedFonts') },
          { id: 'browser', icon: FolderOpen,   label: t('r2Browser')    },
          { id: 'upload',  icon: CloudUpload,  label: t('uploadFonts')  },
          { id: 'stats',   icon: CheckCircle2, label: t('indexStats')   },
          { id: 'sharing', icon: Share2,        label: t('sharingFontsTab') },
        ]"
        :key="tab.id"
        class="flex items-center gap-1.5 h-8 px-4 rounded-xl text-sm font-medium transition-all duration-150"
        :class="activeTab === tab.id ? 'bg-surface shadow-sm text-ink-900' : 'text-ink-500 hover:text-ink-700'"
        @click="activeTab = tab.id as Tab"
      >
        <component :is="tab.icon" class="w-3.5 h-3.5" />
        {{ tab.label }}
      </button>
    </div>

    <!-- ─── Tab: Indexed Fonts ─────────────────────────────────────────────── -->
    <FontListPane v-if="activeTab === 'list'" ref="fontListRef" />

    <!-- ─── Tab: R2 Browser ────────────────────────────────────────────────── -->
    <R2BrowserPane v-if="activeTab === 'browser'" ref="r2BrowserRef" @changed="handleFontChanged" />

    <!-- ─── Tab: Upload ───────────────────────────────────────────────────── -->
    <FontUploadPane v-if="activeTab === 'upload'" @uploaded="handleFontChanged" />

    <!-- ─── Tab: Index Stats ───────────────────────────────────────────────── -->
    <IndexStatsPane v-if="activeTab === 'stats'" :index-progress="indexProgress" @changed="handleFontChanged" />

    <!-- ─── Tab: Sharing Admin ─────────────────────────────────────────────── -->
    <SharingAdminPane v-if="activeTab === 'sharing'" />
  </div>
  </div>
</template>
