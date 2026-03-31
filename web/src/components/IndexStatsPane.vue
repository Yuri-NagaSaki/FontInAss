<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import {
  CheckCircle2, Database, FolderOpen, Loader2,
  RefreshCcw, Search,
} from "lucide-vue-next";
import { getFontStats, scanLocalFonts, repairFontKeys } from "../api/client";
import type { FontStats, ScanLocalResult, RepairKeysResult } from "../api/client";
import KButton from "./KButton.vue";
import KSpinner from "./KSpinner.vue";
import KEmpty from "./KEmpty.vue";

const { t } = useI18n();
defineProps<{ indexProgress: Record<string, any> }>();
const emit = defineEmits<{ changed: [] }>();

// ── Index Stats ───────────────────────────────────────────────────────────────
const fontStats = ref<FontStats | null>(null);
const statsLoading = ref(false);

const loadStats = async () => {
  statsLoading.value = true;
  try {
    fontStats.value = await getFontStats();
  } catch {
    // silent
  } finally {
    statsLoading.value = false;
  }
};

// ── Scan Local ────────────────────────────────────────────────────────────────
const scanLocalState = ref<"idle" | "running" | "done">("idle");
const scanLocalResult = ref<ScanLocalResult | null>(null);
const scanLocalError = ref<string | null>(null);

const doScanLocal = async () => {
  if (scanLocalState.value === "running") return;
  scanLocalState.value = "running";
  scanLocalResult.value = null;
  scanLocalError.value = null;
  try {
    const result = await scanLocalFonts();
    scanLocalResult.value = result;
    scanLocalState.value = "done";
    emit("changed");
    loadStats();
    setTimeout(() => { scanLocalState.value = "idle"; }, 5000);
  } catch (e) {
    scanLocalError.value = e instanceof Error ? e.message : String(e);
    scanLocalState.value = "idle";
  }
};

// ── Repair Keys ───────────────────────────────────────────────────────────────
const repairState = ref<"idle" | "running" | "done">("idle");
const repairResult = ref<RepairKeysResult | null>(null);
const repairError = ref<string | null>(null);

const doRepairKeys = async () => {
  if (repairState.value === "running") return;
  repairState.value = "running";
  repairResult.value = null;
  repairError.value = null;
  try {
    const result = await repairFontKeys();
    repairResult.value = result;
    repairState.value = "done";
    emit("changed");
    loadStats();
    setTimeout(() => { repairState.value = "idle"; }, 8000);
  } catch (e) {
    repairError.value = e instanceof Error ? e.message : String(e);
    repairState.value = "idle";
  }
};

onMounted(() => {
  loadStats();
});
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="card p-4 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <CheckCircle2 class="w-4 h-4 text-mint-400" />
        <span class="font-display font-semibold text-ink-900">{{ t('indexStats') }}</span>
      </div>
      <KButton variant="ghost" size="sm" :disabled="statsLoading" @click="loadStats">
        <RefreshCcw class="w-3.5 h-3.5" :class="statsLoading && 'animate-spin-slow'" />
        {{ t('refresh') }}
      </KButton>
    </div>

    <div v-if="statsLoading && !fontStats" class="flex justify-center py-8">
      <KSpinner />
    </div>

    <template v-else-if="fontStats">
      <!-- Total -->
      <div class="card p-5 flex items-center gap-4">
        <div class="w-12 h-12 rounded-2xl bg-sakura-100 flex items-center justify-center shrink-0">
          <Database class="w-6 h-6 text-sakura-500" />
        </div>
        <div>
          <p class="text-sm text-ink-500">{{ t('totalIndexed') }}</p>
          <p class="text-3xl font-display font-bold text-ink-900">{{ fontStats.total.toLocaleString() }}</p>
        </div>
      </div>

      <!-- Per-folder breakdown -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div
          v-for="folder in fontStats.folders"
          :key="folder.prefix"
          class="card p-4 flex items-center gap-3"
        >
          <FolderOpen class="w-5 h-5 text-amber-400 shrink-0" />
          <div class="flex-1 min-w-0">
            <p class="text-xs font-mono text-ink-500 truncate">{{ folder.prefix }}</p>
            <p class="text-lg font-semibold text-ink-900">{{ folder.count.toLocaleString() }}</p>
          </div>
          <!-- progress bar relative to total -->
          <div class="w-16 bg-ink-100 rounded-full h-1.5 shrink-0">
            <div
              class="bg-sakura-400 h-1.5 rounded-full transition-all duration-500"
              :style="{ width: fontStats!.total > 0 ? `${(folder.count / fontStats!.total * 100).toFixed(1)}%` : '0%' }"
            />
          </div>
        </div>
      </div>

      <!-- Active index operations -->
      <template v-if="Object.keys(indexProgress).some(k => indexProgress[k]?.active)">
        <div class="card p-4">
          <p class="text-sm font-medium text-ink-700 mb-3 flex items-center gap-2">
            <Loader2 class="w-3.5 h-3.5 animate-spin text-sakura-400" />
            {{ t('indexRunning') }}
          </p>
          <div v-for="(prog, prefix) in indexProgress" :key="prefix" class="flex items-center gap-3 text-sm py-1">
            <span class="font-mono text-ink-500 flex-1 truncate">{{ prefix || '(all)' }}</span>
            <span v-if="prog.phase === 'listing'" class="text-xs text-amber-500">{{ t('phaseListing') }}</span>
            <span v-else-if="prog.phase === 'indexing'" class="text-xs text-sky-500">{{ prog.indexed }}/{{ prog.total }}</span>
            <span v-else class="text-xs text-mint-500">{{ t('phaseDone') }}</span>
          </div>
        </div>
      </template>
    </template>

    <KEmpty v-else :title="t('statsEmpty')" />

    <!-- Scan Local — discover and index all fonts in FONT_DIR -->
    <div class="card p-5 flex flex-col gap-3 border-dashed">
      <div class="flex items-center gap-2.5">
        <Search class="w-4 h-4 text-sky-400" />
        <h3 class="font-display font-semibold text-ink-800 text-sm">扫描本地字体目录</h3>
      </div>
      <p class="text-sm text-ink-500">扫描 <code class="text-xs bg-ink-100 px-1.5 py-0.5 rounded font-mono">FONT_DIR</code> 下所有字体文件，批量建立索引。已索引的文件会自动跳过。</p>

      <!-- Result inline -->
      <Transition name="chip-text" mode="out-in">
        <div
          v-if="scanLocalState === 'done' && scanLocalResult"
          key="done"
          class="flex items-center gap-2 text-sm text-mint-600"
        >
          <CheckCircle2 class="w-4 h-4 shrink-0" />
          <span>新增 {{ scanLocalResult.indexed }} 个，跳过 {{ scanLocalResult.skipped }} 个<template v-if="scanLocalResult.purged">，清理失效 {{ scanLocalResult.purged }} 个</template>，共 {{ scanLocalResult.total }} 个字体文件</span>
        </div>
        <div v-else-if="scanLocalError" key="err" class="text-sm text-rose-500 flex items-center gap-1.5">
          <span>扫描失败: {{ scanLocalError }}</span>
        </div>
        <span v-else key="spacer" />
      </Transition>

      <KButton
        variant="secondary"
        size="sm"
        :disabled="scanLocalState === 'running'"
        class="w-fit"
        @click="doScanLocal"
      >
        <Loader2 v-if="scanLocalState === 'running'" class="w-3.5 h-3.5 animate-spin" />
        <Search v-else class="w-3.5 h-3.5" />
        {{ scanLocalState === 'running' ? '扫描中…' : '扫描并索引' }}
      </KButton>
    </div>

    <!-- Repair Keys — fix stale paths after migrating from R2 -->
    <div class="card p-5 flex flex-col gap-3 border-dashed">
      <div class="flex items-center gap-2.5">
        <RefreshCcw class="w-4 h-4 text-amber-400" />
        <h3 class="font-display font-semibold text-ink-800 text-sm">修复索引路径</h3>
      </div>
      <p class="text-sm text-ink-500">检测并修复数据库中的失效路径（如从 Cloudflare R2 迁移后残留的 <code class="text-xs bg-ink-100 px-1.5 py-0.5 rounded font-mono">r2/</code> 前缀）。会自动尝试重新定位文件，无法找到的条目将被删除。</p>

      <Transition name="chip-text" mode="out-in">
        <div
          v-if="repairState === 'done' && repairResult"
          key="done"
          class="flex items-center gap-2 text-sm text-mint-600"
        >
          <CheckCircle2 class="w-4 h-4 shrink-0" />
          <span>修复 {{ repairResult.updated }} 个，删除失效 {{ repairResult.deleted }} 个，正常 {{ repairResult.ok }} 个，共 {{ repairResult.total }} 个</span>
        </div>
        <div v-else-if="repairError" key="err" class="text-sm text-rose-500 flex items-center gap-1.5">
          <span>修复失败: {{ repairError }}</span>
        </div>
        <span v-else key="spacer" />
      </Transition>

      <KButton
        variant="secondary"
        size="sm"
        :disabled="repairState === 'running'"
        class="w-fit"
        @click="doRepairKeys"
      >
        <Loader2 v-if="repairState === 'running'" class="w-3.5 h-3.5 animate-spin" />
        <RefreshCcw v-else class="w-3.5 h-3.5" />
        {{ repairState === 'running' ? '修复中…' : '修复索引路径' }}
      </KButton>
    </div>
  </div>
</template>
