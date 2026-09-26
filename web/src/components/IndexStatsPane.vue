<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  FolderOpen,
  HardDrive,
  Layers,
  Loader2,
  RefreshCcw,
  ScanSearch,
  Sparkles,
  Timer,
  Trash2,
} from "lucide-vue-next";
import { dedupFonts, findDuplicateFonts, getFontStats, scanLocalFonts } from "../api/client";
import type { DedupResponse, FontStats, ScanLocalResult } from "../api/client";
import { formatBytes } from "../lib/format";
import KButton from "./KButton.vue";
import KSpinner from "./KSpinner.vue";
import KEmpty from "./KEmpty.vue";

const { t, locale } = useI18n();
defineProps<{ indexProgress: Record<string, any> }>();
const emit = defineEmits<{ changed: [] }>();

const fontStats = ref<FontStats | null>(null);
const statsLoading = ref(false);
const statsError = ref<string | null>(null);

const coverage = computed(() => {
  if (!fontStats.value || fontStats.value.onDisk <= 0) return 100;
  return Math.min(100, Math.round((fontStats.value.total / fontStats.value.onDisk) * 1000) / 10);
});

const loadStats = async () => {
  statsLoading.value = true;
  statsError.value = null;
  try {
    fontStats.value = await getFontStats();
  } catch (e) {
    statsError.value = e instanceof Error ? e.message : String(e);
  } finally {
    statsLoading.value = false;
  }
};

// ── Scan ──────────────────────────────────────────────────────────────────────
const scanState = ref<"idle" | "running" | "done">("idle");
const scanResult = ref<ScanLocalResult | null>(null);
const scanError = ref<string | null>(null);

const doScan = async () => {
  if (scanState.value === "running") return;
  scanState.value = "running";
  scanResult.value = null;
  scanError.value = null;
  try {
    const result = await scanLocalFonts();
    scanResult.value = result;
    scanState.value = "done";
    emit("changed");
    await loadStats();
  } catch (e) {
    scanError.value = e instanceof Error ? e.message : String(e);
    scanState.value = "idle";
  }
};

// ── Dedup ─────────────────────────────────────────────────────────────────────
const dedupState = ref<"idle" | "checking" | "running" | "done">("idle");
const dedupPreview = ref<{ groups: number; wastedBytes: number } | null>(null);
const dedupResult = ref<DedupResponse | null>(null);
const dedupError = ref<string | null>(null);

const checkDuplicates = async () => {
  if (dedupState.value === "checking" || dedupState.value === "running") return;
  dedupState.value = "checking";
  dedupError.value = null;
  dedupResult.value = null;
  try {
    const result = await findDuplicateFonts();
    const wastedBytes = result.groups.reduce((sum, group) => sum + group.wastedBytes, 0);
    dedupPreview.value = { groups: result.total, wastedBytes };
    dedupState.value = "idle";
  } catch (e) {
    dedupError.value = e instanceof Error ? e.message : String(e);
    dedupState.value = "idle";
  }
};

const doDedup = async () => {
  if (dedupState.value === "running") return;
  dedupState.value = "running";
  dedupError.value = null;
  try {
    const result = await dedupFonts();
    dedupResult.value = result;
    dedupPreview.value = null;
    dedupState.value = "done";
    emit("changed");
    await loadStats();
  } catch (e) {
    dedupError.value = e instanceof Error ? e.message : String(e);
    dedupState.value = "idle";
  }
};

const statusMeta = (status: string) => {
  switch (status) {
    case "synced":
      return { label: t("statsStatusSynced"), class: "bg-mint-100 text-mint-600", bar: "bg-mint-400" };
    case "pending":
      return { label: t("statsStatusPending"), class: "bg-amber-100 text-amber-600", bar: "bg-amber-400" };
    case "stale":
      return { label: t("statsStatusStale"), class: "bg-rose-100 text-rose-600", bar: "bg-rose-400" };
    default:
      return { label: t("statsStatusEmpty"), class: "bg-ink-100 text-ink-500", bar: "bg-ink-200" };
  }
};

const folderProgress = (indexed: number, onDisk: number) => {
  if (onDisk <= 0) return indexed > 0 ? 100 : 0;
  return Math.min(100, Math.round((indexed / onDisk) * 1000) / 10);
};

const formatWhen = (iso: string | null | undefined) => {
  if (!iso) return t("statsNever");
  try {
    return new Date(iso).toLocaleString(locale.value === "zh-CN" ? "zh-CN" : "en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

onMounted(() => {
  loadStats();
  void checkDuplicates();
});
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Header -->
    <div class="card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
      <div class="flex items-start gap-3 min-w-0">
        <div class="w-10 h-10 rounded-2xl bg-gradient-to-br from-sakura-400 to-sakura-500 text-white flex items-center justify-center shrink-0 shadow-[var(--shadow-sm)]">
          <Layers class="w-5 h-5" />
        </div>
        <div class="min-w-0">
          <h2 class="font-display font-semibold text-ink-900 text-base">{{ t('indexStats') }}</h2>
          <p class="text-sm text-ink-400 mt-0.5 leading-relaxed">{{ t('statsPageDesc') }}</p>
        </div>
      </div>
      <KButton variant="ghost" size="sm" class="self-start sm:self-auto" :disabled="statsLoading" @click="loadStats">
        <RefreshCcw class="w-3.5 h-3.5" :class="statsLoading && 'animate-spin-slow'" />
        {{ t('refresh') }}
      </KButton>
    </div>

    <div v-if="statsLoading && !fontStats" class="flex justify-center py-12">
      <KSpinner />
    </div>

    <div v-else-if="statsError && !fontStats" class="card p-6 text-center">
      <p class="text-sm text-rose-500">{{ statsError }}</p>
      <KButton variant="secondary" size="sm" class="mt-3" @click="loadStats">{{ t('refresh') }}</KButton>
    </div>

    <template v-else-if="fontStats">
      <!-- KPI row -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div class="card p-4 flex flex-col gap-2">
          <div class="flex items-center gap-2 text-ink-400">
            <Database class="w-3.5 h-3.5 text-sakura-400" />
            <span class="text-[11px] font-semibold uppercase tracking-wider">{{ t('totalIndexed') }}</span>
          </div>
          <p class="text-2xl sm:text-3xl font-display font-bold text-ink-900 tabular-nums">
            {{ fontStats.total.toLocaleString() }}
          </p>
        </div>

        <div class="card p-4 flex flex-col gap-2">
          <div class="flex items-center gap-2 text-ink-400">
            <HardDrive class="w-3.5 h-3.5 text-sky-400" />
            <span class="text-[11px] font-semibold uppercase tracking-wider">{{ t('statsOnDisk') }}</span>
          </div>
          <p class="text-2xl sm:text-3xl font-display font-bold text-ink-900 tabular-nums">
            {{ fontStats.onDisk.toLocaleString() }}
          </p>
        </div>

        <div class="card p-4 flex flex-col gap-2">
          <div class="flex items-center gap-2 text-ink-400">
            <CheckCircle2 class="w-3.5 h-3.5 text-mint-400" />
            <span class="text-[11px] font-semibold uppercase tracking-wider">{{ t('statsCoverage') }}</span>
          </div>
          <p class="text-2xl sm:text-3xl font-display font-bold text-ink-900 tabular-nums">
            {{ coverage }}%
          </p>
          <div class="h-1.5 rounded-full bg-ink-100 overflow-hidden">
            <div
              class="h-full rounded-full bg-gradient-to-r from-mint-300 to-mint-500 transition-[width] duration-500"
              :style="{ width: `${coverage}%` }"
            />
          </div>
        </div>

        <div class="card p-4 flex flex-col gap-2">
          <div class="flex items-center gap-2 text-ink-400">
            <AlertTriangle class="w-3.5 h-3.5 text-amber-400" />
            <span class="text-[11px] font-semibold uppercase tracking-wider">{{ t('statsPending') }}</span>
          </div>
          <p
            class="text-2xl sm:text-3xl font-display font-bold tabular-nums"
            :class="fontStats.unindexed > 0 ? 'text-amber-500' : 'text-ink-900'"
          >
            {{ fontStats.unindexed.toLocaleString() }}
          </p>
        </div>
      </div>

      <!-- Folders -->
      <div class="card overflow-hidden">
        <div class="px-4 sm:px-5 py-4 border-b border-ink-100/80 flex items-center justify-between gap-3">
          <div class="flex items-center gap-2 min-w-0">
            <FolderOpen class="w-4 h-4 text-amber-400 shrink-0" />
            <h3 class="font-display font-semibold text-ink-800 text-sm">{{ t('statsFolders') }}</h3>
          </div>
          <span class="text-xs text-ink-400 shrink-0">{{ t('statsFoldersHint') }}</span>
        </div>

        <div class="divide-y divide-ink-50">
          <div
            v-for="folder in fontStats.folders"
            :key="folder.prefix"
            class="px-4 sm:px-5 py-4 flex flex-col gap-2.5 transition-colors"
            :class="folder.status === 'empty' ? 'bg-ink-50/40' : 'hover:bg-sakura-50/30'"
          >
            <div class="flex items-start sm:items-center gap-3">
              <div
                class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                :class="folder.status === 'empty' ? 'bg-ink-100 text-ink-400' : 'bg-amber-50 text-amber-500'"
              >
                <FolderOpen class="w-4 h-4" />
              </div>

              <div class="flex-1 min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="font-mono text-sm text-ink-800 truncate">{{ folder.prefix }}</p>
                  <span
                    class="inline-flex items-center h-5 px-2 rounded-full text-[10px] font-semibold tracking-wide"
                    :class="statusMeta(folder.status).class"
                  >
                    {{ statusMeta(folder.status).label }}
                  </span>
                </div>
                <p class="text-xs text-ink-400 mt-0.5">
                  <template v-if="folder.status === 'empty'">{{ t('statsEmptyFolderHint') }}</template>
                  <template v-else>
                    {{ t('statsFolderCounts', {
                      indexed: folder.indexed.toLocaleString(),
                      onDisk: folder.onDisk.toLocaleString(),
                    }) }}
                  </template>
                </p>
              </div>

              <div class="text-right shrink-0">
                <p class="text-lg font-display font-bold text-ink-900 tabular-nums leading-none">
                  {{ folder.indexed.toLocaleString() }}
                </p>
                <p class="text-[11px] text-ink-400 mt-1">
                  / {{ folder.onDisk.toLocaleString() }}
                </p>
              </div>
            </div>

            <div class="ml-12 h-1.5 rounded-full bg-ink-100 overflow-hidden">
              <div
                class="h-full rounded-full transition-[width] duration-500"
                :class="statusMeta(folder.status).bar"
                :style="{ width: `${folderProgress(folder.indexed, folder.onDisk)}%` }"
              />
            </div>
          </div>

          <div v-if="!fontStats.folders.length" class="py-10">
            <KEmpty :title="t('statsEmpty')" />
          </div>
        </div>
      </div>

      <!-- Active index ops from R2 browser -->
      <div
        v-if="Object.keys(indexProgress).some(k => indexProgress[k]?.active)"
        class="card p-4 sm:p-5 border border-sakura-200/60 bg-sakura-50/40"
      >
        <p class="text-sm font-medium text-ink-700 mb-3 flex items-center gap-2">
          <Loader2 class="w-3.5 h-3.5 animate-spin text-sakura-400" />
          {{ t('indexRunning') }}
        </p>
        <div
          v-for="(prog, prefix) in indexProgress"
          :key="prefix"
          class="flex items-center gap-3 text-sm py-1.5"
        >
          <span class="font-mono text-ink-500 flex-1 truncate">{{ prefix || '(all)' }}</span>
          <span v-if="prog.phase === 'listing'" class="text-xs text-amber-500">{{ t('phaseListing') }}</span>
          <span v-else-if="prog.phase === 'indexing'" class="text-xs text-sky-500 tabular-nums">{{ prog.indexed }}/{{ prog.total }}</span>
          <span v-else class="text-xs text-mint-500">{{ t('phaseDone') }}</span>
        </div>
      </div>

      <!-- Maintenance + Scheduler -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <!-- Maintenance actions -->
        <div class="card p-4 sm:p-5 flex flex-col gap-4">
          <div class="flex items-center gap-2">
            <Sparkles class="w-4 h-4 text-sky-400" />
            <h3 class="font-display font-semibold text-ink-800 text-sm">{{ t('statsMaintenance') }}</h3>
          </div>
          <p class="text-sm text-ink-500 leading-relaxed">{{ t('statsMaintenanceDesc') }}</p>

          <div class="flex flex-col gap-3">
            <!-- Scan -->
            <div class="rounded-2xl border border-ink-100 bg-surface-raised/60 p-3.5 flex flex-col gap-2.5">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="text-sm font-medium text-ink-800">{{ t('statsScanTitle') }}</p>
                  <p class="text-xs text-ink-400 mt-0.5 leading-relaxed">{{ t('statsScanDesc') }}</p>
                </div>
                <KButton
                  variant="sky"
                  size="sm"
                  class="shrink-0"
                  :disabled="scanState === 'running'"
                  @click="doScan"
                >
                  <Loader2 v-if="scanState === 'running'" class="w-3.5 h-3.5 animate-spin" />
                  <ScanSearch v-else class="w-3.5 h-3.5" />
                  {{ scanState === 'running' ? t('statsScanning') : t('statsScanAction') }}
                </KButton>
              </div>
              <p v-if="scanResult" class="text-xs text-mint-600 flex items-start gap-1.5">
                <CheckCircle2 class="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  {{ t('statsScanResult', {
                    indexed: scanResult.indexed,
                    skipped: scanResult.skipped,
                    purged: scanResult.purged,
                    total: scanResult.total,
                  }) }}
                </span>
              </p>
              <p v-if="scanError" class="text-xs text-rose-500">{{ scanError }}</p>
            </div>

            <!-- Dedup -->
            <div class="rounded-2xl border border-ink-100 bg-surface-raised/60 p-3.5 flex flex-col gap-2.5">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="text-sm font-medium text-ink-800">{{ t('statsDedupTitle') }}</p>
                  <p class="text-xs text-ink-400 mt-0.5 leading-relaxed">{{ t('statsDedupDesc') }}</p>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                  <KButton
                    variant="ghost"
                    size="sm"
                    :disabled="dedupState === 'checking' || dedupState === 'running'"
                    @click="checkDuplicates"
                  >
                    <Loader2 v-if="dedupState === 'checking'" class="w-3.5 h-3.5 animate-spin" />
                    <RefreshCcw v-else class="w-3.5 h-3.5" />
                  </KButton>
                  <KButton
                    variant="secondary"
                    size="sm"
                    :disabled="dedupState === 'running' || (dedupPreview !== null && dedupPreview.groups === 0)"
                    @click="doDedup"
                  >
                    <Loader2 v-if="dedupState === 'running'" class="w-3.5 h-3.5 animate-spin" />
                    <Trash2 v-else class="w-3.5 h-3.5" />
                    {{ t('fontsDedupButton') }}
                  </KButton>
                </div>
              </div>
              <p v-if="dedupPreview && dedupPreview.groups === 0" class="text-xs text-mint-600">
                {{ t('fontsDedupNone') }}
              </p>
              <p v-else-if="dedupPreview" class="text-xs text-amber-600">
                {{ t('statsDedupPreview', {
                  groups: dedupPreview.groups,
                  size: formatBytes(dedupPreview.wastedBytes),
                }) }}
              </p>
              <p v-if="dedupResult" class="text-xs text-mint-600 flex items-start gap-1.5">
                <CheckCircle2 class="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  {{ t('fontsDedupSuccess', { removed: dedupResult.removed }) }}
                  <template v-if="dedupResult.freedBytes">
                    · {{ formatBytes(dedupResult.freedBytes) }}
                  </template>
                </span>
              </p>
              <p v-if="dedupError" class="text-xs text-rose-500">{{ dedupError }}</p>
            </div>
          </div>
        </div>

        <!-- Scheduler -->
        <div class="card p-4 sm:p-5 flex flex-col gap-4">
          <div class="flex items-center gap-2">
            <Timer class="w-4 h-4 text-sakura-400" />
            <h3 class="font-display font-semibold text-ink-800 text-sm">{{ t('statsScheduler') }}</h3>
          </div>
          <p class="text-sm text-ink-500 leading-relaxed">{{ t('statsSchedulerDesc') }}</p>

          <template v-if="fontStats.scheduler">
            <div class="grid grid-cols-2 gap-3">
              <div class="rounded-2xl bg-ink-50/80 p-3.5">
                <p class="text-[11px] uppercase tracking-wider text-ink-400 font-semibold">{{ t('statsInterval') }}</p>
                <p class="mt-1 text-lg font-display font-bold text-ink-900">
                  {{ t('statsIntervalHours', { n: fontStats.scheduler.intervalHours }) }}
                </p>
              </div>
              <div class="rounded-2xl bg-ink-50/80 p-3.5">
                <p class="text-[11px] uppercase tracking-wider text-ink-400 font-semibold">{{ t('status') }}</p>
                <p class="mt-1 text-lg font-display font-bold flex items-center gap-1.5"
                  :class="fontStats.scheduler.running ? 'text-sky-500' : fontStats.scheduler.enabled ? 'text-mint-600' : 'text-ink-500'"
                >
                  <Loader2 v-if="fontStats.scheduler.running" class="w-4 h-4 animate-spin" />
                  {{
                    fontStats.scheduler.running
                      ? t('statsSchedulerRunning')
                      : fontStats.scheduler.enabled
                        ? t('statsSchedulerEnabled')
                        : t('statsSchedulerDisabled')
                  }}
                </p>
              </div>
            </div>

            <div class="rounded-2xl border border-ink-100 divide-y divide-ink-50">
              <div class="px-3.5 py-3 flex items-center gap-2.5">
                <Clock3 class="w-3.5 h-3.5 text-ink-300 shrink-0" />
                <span class="text-xs text-ink-400 flex-1">{{ t('statsLastRun') }}</span>
                <span class="text-xs font-medium text-ink-700 tabular-nums">{{ formatWhen(fontStats.scheduler.lastRunAt) }}</span>
              </div>
              <div class="px-3.5 py-3 flex items-center gap-2.5">
                <Timer class="w-3.5 h-3.5 text-ink-300 shrink-0" />
                <span class="text-xs text-ink-400 flex-1">{{ t('statsNextRun') }}</span>
                <span class="text-xs font-medium text-ink-700 tabular-nums">{{ formatWhen(fontStats.scheduler.nextRunAt) }}</span>
              </div>
            </div>

            <div
              v-if="fontStats.scheduler.lastResult"
              class="rounded-2xl p-3.5 text-xs leading-relaxed"
              :class="fontStats.scheduler.lastResult.error ? 'bg-rose-50 text-rose-600' : 'bg-mint-50 text-mint-700'"
            >
              <template v-if="fontStats.scheduler.lastResult.error">
                {{ t('statsSchedulerError', { error: fontStats.scheduler.lastResult.error }) }}
              </template>
              <template v-else>
                {{ t('statsSchedulerResult', {
                  indexed: fontStats.scheduler.lastResult.indexed,
                  purged: fontStats.scheduler.lastResult.purged,
                  deduplicated: fontStats.scheduler.lastResult.deduplicated,
                }) }}
              </template>
            </div>
            <p v-else class="text-xs text-ink-400">{{ t('statsSchedulerNoRun') }}</p>
          </template>
          <p v-else class="text-xs text-ink-400">{{ t('statsSchedulerUnavailable') }}</p>
        </div>
      </div>
    </template>

    <KEmpty v-else :title="t('statsEmpty')" />
  </div>
</template>
