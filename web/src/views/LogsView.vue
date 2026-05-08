<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  ScrollText, Search, ChevronLeft, ChevronRight, ChevronDown,
  Activity, CalendarDays, CheckCircle2, AlertTriangle, XCircle, Ban, Check, Undo2,
} from "lucide-vue-next";
import {
  listProcessingLogs, getMissingFonts, getLogStats,
  resolveMissingFont, unresolveMissingFont, getApiKey,
} from "../api/client";
import type { ProcessingLog, MissingFontRanking, LogStats } from "../api/client";
import KButton from "../components/KButton.vue";
import KBadge from "../components/KBadge.vue";
import KEmpty from "../components/KEmpty.vue";
import KSpinner from "../components/KSpinner.vue";
import { useConfirm } from "../composables/useConfirm";

const { t } = useI18n();
const hasKey = computed(() => !!getApiKey());

// ── State ─────────────────────────────────────────────────────────────────────
const loading = ref(false);
const logs = ref<ProcessingLog[]>([]);
const total = ref(0);
const page = ref(1);
const limit = 20;
const search = ref("");
const codeFilter = ref<number | undefined>(undefined);
const expandedLogId = ref<string | null>(null);

const stats = ref<LogStats | null>(null);
const missingFonts = ref<MissingFontRanking[]>([]);
const showResolved = ref(false);
const resolvingFont = ref<string | null>(null);

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / limit)));

// ── Loaders ───────────────────────────────────────────────────────────────────
async function loadLogs() {
  loading.value = true;
  try {
    const res = await listProcessingLogs(page.value, limit, search.value, codeFilter.value);
    logs.value = res.data;
    total.value = res.total;
  } catch (e) {
    useConfirm().alert({ title: t('errorTitle'), message: String(e instanceof Error ? e.message : e), variant: 'danger' });
  } finally {
    loading.value = false;
  }
}

async function loadStats() {
  try { stats.value = await getLogStats(); } catch { /* silent */ }
}

async function loadMissing() {
  try { missingFonts.value = await getMissingFonts(50, showResolved.value); } catch { /* silent */ }
}

function loadAll() { loadStats(); loadMissing(); loadLogs(); }

watch([search, codeFilter], () => { page.value = 1; loadLogs(); });
watch(page, loadLogs);
watch(showResolved, loadMissing);

onMounted(() => { loadAll(); });

// ── Missing font resolve ──────────────────────────────────────────────────────
async function toggleResolve(mf: MissingFontRanking) {
  resolvingFont.value = mf.font_name;
  try {
    if (mf.resolved) {
      await unresolveMissingFont(mf.font_name);
    } else {
      await resolveMissingFont(mf.font_name);
    }
    await loadMissing();
  } catch (e) {
    useConfirm().alert({ title: t('errorTitle'), message: String(e instanceof Error ? e.message : e), variant: 'danger' });
  } finally {
    resolvingFont.value = null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function codeLabel(code: number): string {
  if (code === 200) return "Success";
  if (code === 201) return "Warning";
  if (code === 300) return "Missing";
  if (code === 400) return "Bad Request";
  return "Error";
}

function codeBadgeVariant(code: number): "success" | "warning" | "error" {
  if (code === 200) return "success";
  if (code === 201) return "warning";
  return "error";
}

const codeFilters: { label: string; value: number | undefined }[] = [
  { label: "logsFilterAll", value: undefined },
  { label: "logsFilterSuccess", value: 200 },
  { label: "logsFilterWarning", value: 201 },
  { label: "logsFilterError", value: 300 },
];

const statCards = computed(() => {
  const s = stats.value;
  if (!s) return [];
  return [
    { key: "logsStatsTotal", value: s.total, icon: Activity, color: "text-ink-500" },
    { key: "logsStatsToday", value: s.today, icon: CalendarDays, color: "text-sky-500" },
    { key: "logsStatsSuccess", value: s.success, icon: CheckCircle2, color: "text-mint-500" },
    { key: "logsStatsWarnings", value: s.warnings, icon: AlertTriangle, color: "text-amber-500" },
    { key: "logsStatsErrors", value: s.errors, icon: XCircle, color: "text-rose-500" },
    { key: "logsTotalMissingFonts", value: s.totalMissingFonts, icon: Ban, color: "text-sakura-500" },
  ];
});

function toggleExpand(id: string) {
  expandedLogId.value = expandedLogId.value === id ? null : id;
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Header -->
    <div class="card bg-gradient-to-br from-white to-sakura-50/40 p-6">
      <div class="flex items-center gap-3">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-sakura-100 text-sakura-500">
          <ScrollText class="h-5 w-5" />
        </div>
        <div>
          <h1 class="font-display text-xl font-bold text-ink-900">{{ t('logsTitle') }}</h1>
          <p class="text-sm text-ink-400">{{ t('logsDescription') }}</p>
        </div>
      </div>
    </div>

    <!-- Stats cards -->
    <div v-if="stats" class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <div v-for="s in statCards" :key="s.key" class="card p-4 flex flex-col gap-1">
        <div class="flex items-center gap-1.5">
          <component :is="s.icon" class="h-3.5 w-3.5" :class="s.color" />
          <span class="text-xs text-ink-400">{{ t(s.key) }}</span>
        </div>
        <span class="font-display text-xl font-bold text-ink-900">{{ s.value.toLocaleString() }}</span>
      </div>
    </div>

    <!-- Logs section (full width): toolbar + card entries -->
    <div class="flex flex-col gap-4">
      <!-- Toolbar: search + filters -->
      <div class="flex flex-wrap items-center gap-2">
        <div class="relative flex-1 min-w-[180px]">
          <Search class="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-300" />
          <input v-model="search" :placeholder="t('logsSearch')"
            class="w-full h-9 rounded-xl border border-ink-200 bg-surface pl-9 pr-3 text-sm text-ink-700 placeholder:text-ink-300 focus:border-sakura-400 focus:ring-2 focus:ring-sakura-400/20 outline-none transition-colors" />
        </div>
        <div class="flex gap-1">
          <KButton v-for="cf in codeFilters" :key="cf.label" size="sm"
            :variant="codeFilter === cf.value ? 'primary' : 'ghost'" @click="codeFilter = cf.value">
            {{ t(cf.label) }}
          </KButton>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="flex justify-center py-12">
        <KSpinner size="lg" />
      </div>

      <!-- Empty -->
      <KEmpty v-else-if="!logs.length" :title="t('logsNoRecords')" />

      <!-- Card-based log entries -->
      <div v-else class="flex flex-col gap-2">
        <div
          v-for="log in logs" :key="log.id"
          class="card hover:border-ink-200 transition-colors cursor-pointer overflow-hidden"
          @click="toggleExpand(log.id)"
        >
          <!-- Main row -->
          <div class="flex items-center gap-3 px-4 py-3">
            <KBadge :variant="codeBadgeVariant(log.code)" class="shrink-0">{{ codeLabel(log.code) }}</KBadge>
            <span class="flex-1 min-w-0 text-sm text-ink-700 truncate" :title="log.filename">{{ log.filename }}</span>
            <span class="text-xs font-mono text-ink-400 shrink-0">{{ formatSize(log.file_size) }}</span>
            <span class="text-xs text-ink-300 shrink-0 hidden sm:inline">{{ log.elapsed_ms }}ms</span>
            <span class="text-xs text-ink-300 shrink-0 hidden md:inline whitespace-nowrap">{{ formatDate(log.processed_at) }}</span>
            <ChevronDown class="w-4 h-4 text-ink-300 shrink-0 transition-transform" :class="{ 'rotate-180': expandedLogId === log.id }" />
          </div>
          <!-- Expanded detail -->
          <div v-if="expandedLogId === log.id" class="px-4 pb-3 border-t border-ink-50 pt-3 text-xs text-ink-500 flex flex-col gap-1.5">
            <div class="flex flex-wrap gap-x-6 gap-y-1">
              <span><strong class="text-ink-600">{{ t('logsFilename') }}:</strong> {{ log.filename }}</span>
              <span><strong class="text-ink-600">{{ t('logsFileSize') }}:</strong> {{ formatSize(log.file_size) }}</span>
              <span><strong class="text-ink-600">{{ t('logsElapsed') }}:</strong> {{ log.elapsed_ms }}ms</span>
              <span><strong class="text-ink-600">{{ t('logsProcessedAt') }}:</strong> {{ formatDate(log.processed_at) }}</span>
              <span v-if="log.font_count"><strong class="text-ink-600">{{ t('logsFontCount') }}:</strong> {{ log.font_count }}</span>
            </div>
            <div v-if="log.missing_fonts">
              <strong class="text-ink-600">{{ t('logsMissingFonts') }}:</strong>
              <span class="text-rose-500"> {{ log.missing_fonts }}</span>
            </div>
            <div v-if="log.messages">
              <strong class="text-ink-600">{{ t('logsMessages') }}:</strong>
              <span class="text-amber-600"> {{ log.messages }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Pagination -->
      <div v-if="totalPages > 1" class="flex items-center justify-between pt-2 text-sm text-ink-400">
        <span>{{ total.toLocaleString() }} {{ t('logsStatsTotal').toLowerCase() }}</span>
        <div class="flex items-center gap-1">
          <KButton size="icon-sm" variant="ghost" :disabled="page <= 1" @click="page--">
            <ChevronLeft class="h-4 w-4" />
          </KButton>
          <span class="px-2 text-xs font-medium text-ink-600">{{ page }} / {{ totalPages }}</span>
          <KButton size="icon-sm" variant="ghost" :disabled="page >= totalPages" @click="page++">
            <ChevronRight class="h-4 w-4" />
          </KButton>
        </div>
      </div>
    </div>

    <!-- Missing font ranking (below logs, full width) -->
    <div class="card p-5 flex flex-col gap-3">
      <div class="flex items-center justify-between">
        <h2 class="font-display text-sm font-bold text-ink-700">{{ t('logsMissingFontRanking') }}</h2>
        <label class="flex items-center gap-1.5 text-xs text-ink-400 cursor-pointer select-none">
          <input type="checkbox" v-model="showResolved" class="rounded border-ink-300 text-sakura-500 focus:ring-sakura-400/30 h-3.5 w-3.5" />
          {{ t('logsShowResolved') }}
        </label>
      </div>
      <KEmpty v-if="!missingFonts.length" :title="t('logsNoMissingFonts')" />
      <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1">
        <div v-for="(mf, i) in missingFonts" :key="mf.font_name"
          class="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-ink-50 transition-colors group"
          :class="{ 'opacity-50': mf.resolved }">
          <span class="truncate text-ink-700 flex-1 min-w-0">
            <span class="mr-1.5 text-xs text-ink-300">{{ i + 1 }}.</span>
            <span :class="{ 'line-through': mf.resolved }">{{ mf.font_name }}</span>
          </span>
          <KBadge variant="sakura" class="shrink-0">{{ mf.count }}</KBadge>
          <button
            v-if="hasKey"
            @click="toggleResolve(mf)"
            :disabled="resolvingFont === mf.font_name"
            class="shrink-0 w-6 h-6 rounded-lg flex items-center justify-center transition-colors"
            :class="mf.resolved
              ? 'bg-mint-100 text-mint-600 hover:bg-amber-100 hover:text-amber-600'
              : 'opacity-0 group-hover:opacity-100 bg-ink-100 text-ink-400 hover:bg-mint-100 hover:text-mint-600'"
            :title="mf.resolved ? t('logsFontUnresolve') : t('logsFontResolve')"
          >
            <component :is="mf.resolved ? Undo2 : Check" class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
