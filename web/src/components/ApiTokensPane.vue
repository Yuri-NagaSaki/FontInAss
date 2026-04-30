<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import {
  Plus, Trash2, RefreshCcw, Power, Copy, Check,
  History, Loader2, AlertTriangle, CheckCircle2, X, ShieldCheck,
  Activity, Hash,
} from "lucide-vue-next";
import {
  listApiTokens, createApiToken, updateApiToken, deleteApiToken,
  getApiTokenStats, getApiTokenHistory,
} from "../api/client";
import type {
  ApiToken, ApiTokenStats, ApiUploadHistoryItem, ApiUploadStatus,
} from "../api/client";
import { formatBytes } from "../lib/format";
import KButton from "./KButton.vue";
import KInput from "./KInput.vue";
import { useConfirm } from "../composables/useConfirm";

const { t } = useI18n();
const { confirm } = useConfirm();

// ── Data ──────────────────────────────────────────────────────────────────────
const tokens = ref<ApiToken[]>([]);
const stats = ref<ApiTokenStats | null>(null);
const loading = ref(false);
const errorMsg = ref("");

const loadAll = async () => {
  loading.value = true;
  errorMsg.value = "";
  try {
    const [list, st] = await Promise.all([listApiTokens(), getApiTokenStats()]);
    tokens.value = list;
    stats.value = st;
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
};

onMounted(() => { void loadAll(); });

// ── Create modal ──────────────────────────────────────────────────────────────
const createOpen = ref(false);
const createName = ref("");
const createNote = ref("");
const creating = ref(false);
const createdToken = ref<{ token: ApiToken; plaintext: string } | null>(null);
const copyOk = ref(false);

const openCreate = () => {
  createName.value = "";
  createNote.value = "";
  createdToken.value = null;
  createOpen.value = true;
};

const submitCreate = async () => {
  if (!createName.value.trim() || creating.value) return;
  creating.value = true;
  try {
    createdToken.value = await createApiToken({
      name: createName.value.trim(),
      note: createNote.value.trim() || undefined,
    });
    await loadAll();
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e);
  } finally {
    creating.value = false;
  }
};

const copyPlaintext = async () => {
  if (!createdToken.value) return;
  await navigator.clipboard.writeText(createdToken.value.plaintext);
  copyOk.value = true;
  setTimeout(() => { copyOk.value = false; }, 1500);
};

const closeCreate = () => {
  createOpen.value = false;
  createdToken.value = null;
};

// ── Toggle / delete ───────────────────────────────────────────────────────────
const togglingId = ref<string | null>(null);
const toggleEnabled = async (token: ApiToken) => {
  togglingId.value = token.id;
  try {
    const updated = await updateApiToken(token.id, { enabled: !token.enabled });
    const i = tokens.value.findIndex(t => t.id === token.id);
    if (i >= 0) tokens.value[i] = updated;
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e);
  } finally {
    togglingId.value = null;
  }
};

const removeToken = async (token: ApiToken) => {
  const ok = await confirm({
    title: t("apiTokenDeleteTitle"),
    message: t("apiTokenDeleteConfirm", { name: token.name }),
    detail: t("apiTokenDeleteDetail"),
    variant: "danger",
    confirmText: t("delete"),
  });
  if (!ok) return;
  try {
    await deleteApiToken(token.id);
    tokens.value = tokens.value.filter(t => t.id !== token.id);
    if (historyToken.value?.id === token.id) closeHistory();
    void loadAll();
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e);
  }
};

// ── History drawer ────────────────────────────────────────────────────────────
const historyToken = ref<ApiToken | null>(null);
const history = ref<ApiUploadHistoryItem[]>([]);
const historyTotal = ref(0);
const historyPage = ref(1);
const historyLimit = 50;
const historyStatus = ref<ApiUploadStatus | "">("");
const historyLoading = ref(false);

const totalPages = computed(() => Math.max(1, Math.ceil(historyTotal.value / historyLimit)));

const openHistory = async (token: ApiToken) => {
  historyToken.value = token;
  historyPage.value = 1;
  historyStatus.value = "";
  await reloadHistory();
};

const closeHistory = () => {
  historyToken.value = null;
  history.value = [];
  historyTotal.value = 0;
};

const reloadHistory = async () => {
  if (!historyToken.value) return;
  historyLoading.value = true;
  try {
    const res = await getApiTokenHistory(
      historyToken.value.id,
      historyPage.value,
      historyLimit,
      historyStatus.value || undefined,
    );
    history.value = res.data;
    historyTotal.value = res.total;
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e);
  } finally {
    historyLoading.value = false;
  }
};

const setStatusFilter = (s: ApiUploadStatus | "") => {
  historyStatus.value = s;
  historyPage.value = 1;
  void reloadHistory();
};

const goPage = (p: number) => {
  historyPage.value = Math.min(Math.max(1, p), totalPages.value);
  void reloadHistory();
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtTime = (s: string | null) => {
  if (!s) return "—";
  return new Date(s).toLocaleString();
};

const statusColor = (s: ApiUploadStatus) => ({
  success: "text-mint-600 bg-mint-50 border-mint-200",
  duplicate: "text-sky-600 bg-sky-50 border-sky-200",
  rejected: "text-amber-600 bg-amber-50 border-amber-200",
  error: "text-rose-600 bg-rose-50 border-rose-200",
}[s]);

const baseUrl = computed(() => window.location.origin);
</script>

<template>
  <div>
    <div class="flex flex-col gap-6">
      <!-- Header -->
      <div class="flex items-center gap-3">
        <div class="flex-1 min-w-0">
          <p class="text-sm text-ink-500">{{ t("apiTokensDesc") }}</p>
        </div>
        <KButton variant="ghost" size="sm" @click="loadAll" :disabled="loading">
          <RefreshCcw class="w-3.5 h-3.5" :class="loading && 'animate-spin'" />
          {{ t("refresh") }}
        </KButton>
        <KButton variant="primary" size="sm" @click="openCreate">
          <Plus class="w-3.5 h-3.5" />
          {{ t("apiTokenNew") }}
        </KButton>
      </div>

      <!-- Stats -->
      <div v-if="stats" class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div class="card-raised p-4">
          <div class="text-xs text-ink-400 mb-1">{{ t("apiTokenStatTokens") }}</div>
          <div class="font-display font-semibold text-2xl text-ink-900">{{ stats.totals.tokens }}</div>
        </div>
        <div class="card-raised p-4">
          <div class="text-xs text-ink-400 mb-1">{{ t("apiTokenStatUploads") }}</div>
          <div class="font-display font-semibold text-2xl text-ink-900">{{ stats.totals.uploads }}</div>
        </div>
        <div class="card-raised p-4">
          <div class="text-xs text-ink-400 mb-1">{{ t("apiTokenStatBytes") }}</div>
          <div class="font-display font-semibold text-2xl text-ink-900">{{ formatBytes(stats.totals.bytes) }}</div>
        </div>
        <div class="card-raised p-4">
          <div class="text-xs text-ink-400 mb-1">{{ t("apiTokenStatBreakdown") }}</div>
          <div class="flex flex-wrap gap-1.5 mt-1.5">
            <span class="text-xs px-2 py-0.5 rounded-md text-mint-600 bg-mint-50 border border-mint-200">
              ✓ {{ stats.byStatus.success }}
            </span>
            <span class="text-xs px-2 py-0.5 rounded-md text-sky-600 bg-sky-50 border border-sky-200">
              ⇋ {{ stats.byStatus.duplicate }}
            </span>
            <span class="text-xs px-2 py-0.5 rounded-md text-amber-600 bg-amber-50 border border-amber-200">
              ! {{ stats.byStatus.rejected }}
            </span>
            <span class="text-xs px-2 py-0.5 rounded-md text-rose-600 bg-rose-50 border border-rose-200">
              ✕ {{ stats.byStatus.error }}
            </span>
          </div>
        </div>
      </div>

      <!-- Endpoint hint -->
      <div class="flex items-start gap-3 px-4 py-3 rounded-xl bg-sky-50/60 border border-sky-100 text-xs text-sky-700">
        <ShieldCheck class="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
        <div class="leading-relaxed">
          {{ t("apiTokenEndpointHint") }}
          <code class="font-mono px-1.5 py-0.5 rounded bg-white/70 border border-sky-100 text-sky-700 ml-1">
            POST {{ baseUrl }}/api/v1/upload
          </code>
        </div>
      </div>

      <!-- Error -->
      <div v-if="errorMsg" class="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-600">
        <AlertTriangle class="w-3.5 h-3.5 shrink-0" />
        {{ errorMsg }}
      </div>

      <!-- Token list -->
      <div v-if="loading && tokens.length === 0" class="flex items-center justify-center py-12 text-ink-400">
        <Loader2 class="w-5 h-5 animate-spin" />
      </div>
      <div v-else-if="tokens.length === 0" class="card-raised p-8 text-center text-ink-400">
        {{ t("apiTokenEmpty") }}
      </div>
      <div v-else class="flex flex-col gap-2">
        <div
          v-for="token in tokens"
          :key="token.id"
          class="card-raised p-4 flex flex-col md:flex-row md:items-center gap-3"
        >
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-display font-semibold text-ink-900">{{ token.name }}</span>
              <code class="font-mono text-xs px-1.5 py-0.5 rounded bg-ink-50 border border-ink-100 text-ink-500">
                fia_{{ token.prefix }}_…
              </code>
              <span
                class="text-xs px-2 py-0.5 rounded-md border"
                :class="token.enabled
                  ? 'text-mint-600 bg-mint-50 border-mint-200'
                  : 'text-ink-400 bg-ink-50 border-ink-100'"
              >
                {{ token.enabled ? t("apiTokenEnabled") : t("apiTokenDisabled") }}
              </span>
            </div>
            <div v-if="token.note" class="text-xs text-ink-500 mt-1 truncate">{{ token.note }}</div>
            <div class="flex items-center gap-4 text-xs text-ink-400 mt-1.5 flex-wrap">
              <span class="flex items-center gap-1"><Activity class="w-3 h-3" /> {{ token.upload_count }} {{ t("apiTokenUploads") }}</span>
              <span class="flex items-center gap-1"><Hash class="w-3 h-3" /> {{ formatBytes(token.total_bytes) }}</span>
              <span>{{ t("apiTokenLastUsed") }}: {{ fmtTime(token.last_used_at) }}<span v-if="token.last_used_ip"> · {{ token.last_used_ip }}</span></span>
              <span>{{ t("apiTokenCreated") }}: {{ fmtTime(token.created_at) }}</span>
            </div>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <KButton variant="ghost" size="sm" @click="openHistory(token)">
              <History class="w-3.5 h-3.5" />
              {{ t("apiTokenHistory") }}
            </KButton>
            <KButton variant="ghost" size="sm" @click="toggleEnabled(token)" :disabled="togglingId === token.id">
              <Power class="w-3.5 h-3.5" />
              {{ token.enabled ? t("apiTokenDisable") : t("apiTokenEnable") }}
            </KButton>
            <KButton variant="danger" size="sm" @click="removeToken(token)">
              <Trash2 class="w-3.5 h-3.5" />
            </KButton>
          </div>
        </div>
      </div>
    </div>

    <!-- Create modal -->
    <transition name="modal">
      <div v-if="createOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4" @click.self="closeCreate">
        <div class="absolute inset-0 bg-ink-950/20 backdrop-blur-sm" @click="closeCreate" />
        <div class="relative card-raised p-6 w-full max-w-md animate-scale-in">
          <div class="absolute top-0 left-0 right-0 h-1 rounded-t-[18px] bg-gradient-to-r from-sakura-300 via-sakura-400 to-sky-300" />

          <!-- Form -->
          <template v-if="!createdToken">
            <h2 class="font-display font-semibold text-ink-950 text-lg mb-1">{{ t("apiTokenCreateTitle") }}</h2>
            <p class="text-sm text-ink-400 mb-4">{{ t("apiTokenCreateDesc") }}</p>
            <div class="space-y-3 mb-4">
              <div>
                <label class="text-xs text-ink-500 mb-1 block">{{ t("apiTokenName") }}</label>
                <KInput v-model="createName" :placeholder="t('apiTokenNamePlaceholder')" />
              </div>
              <div>
                <label class="text-xs text-ink-500 mb-1 block">{{ t("apiTokenNote") }}</label>
                <KInput v-model="createNote" :placeholder="t('apiTokenNotePlaceholder')" />
              </div>
            </div>
            <div class="flex gap-2">
              <KButton variant="primary" size="md" class="flex-1" :disabled="!createName.trim() || creating" @click="submitCreate">
                <Loader2 v-if="creating" class="w-4 h-4 animate-spin" />
                {{ t("apiTokenCreate") }}
              </KButton>
              <KButton variant="ghost" size="md" @click="closeCreate">{{ t("cancel") }}</KButton>
            </div>
          </template>

          <!-- Result -->
          <template v-else>
            <div class="flex items-center gap-2 mb-1">
              <CheckCircle2 class="w-5 h-5 text-mint-500" />
              <h2 class="font-display font-semibold text-ink-950 text-lg">{{ t("apiTokenCreatedTitle") }}</h2>
            </div>
            <p class="text-sm text-ink-400 mb-4">{{ t("apiTokenCreatedDesc") }}</p>
            <div class="bg-ink-50 border border-ink-100 rounded-xl p-3 font-mono text-xs break-all mb-3 select-all">
              {{ createdToken.plaintext }}
            </div>
            <div class="flex gap-2">
              <KButton variant="primary" size="md" class="flex-1" @click="copyPlaintext">
                <Check v-if="copyOk" class="w-4 h-4" />
                <Copy v-else class="w-4 h-4" />
                {{ copyOk ? t("copiedLabel") : t("copy") }}
              </KButton>
              <KButton variant="ghost" size="md" @click="closeCreate">{{ t("close") }}</KButton>
            </div>
          </template>
        </div>
      </div>
    </transition>

    <!-- History drawer -->
    <transition name="modal">
      <div v-if="historyToken" class="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4" @click.self="closeHistory">
        <div class="absolute inset-0 bg-ink-950/20 backdrop-blur-sm" @click="closeHistory" />
        <div class="relative card-raised w-full max-w-3xl max-h-[85vh] flex flex-col animate-scale-in">
          <div class="absolute top-0 left-0 right-0 h-1 rounded-t-[18px] bg-gradient-to-r from-sakura-300 via-sakura-400 to-sky-300" />

          <!-- Drawer header -->
          <div class="px-5 pt-5 pb-3 flex items-center gap-2 border-b border-ink-100">
            <History class="w-4 h-4 text-sakura-400" />
            <span class="font-display font-semibold text-ink-900">{{ historyToken.name }}</span>
            <code class="font-mono text-xs px-1.5 py-0.5 rounded bg-ink-50 border border-ink-100 text-ink-500">
              fia_{{ historyToken.prefix }}_…
            </code>
            <div class="flex-1" />
            <button class="w-7 h-7 rounded-md flex items-center justify-center hover:bg-ink-100" @click="closeHistory">
              <X class="w-4 h-4 text-ink-500" />
            </button>
          </div>

          <!-- Filters -->
          <div class="px-5 py-3 flex items-center gap-1.5 flex-wrap text-xs">
            <button
              v-for="opt in (['', 'success', 'duplicate', 'rejected', 'error'] as const)"
              :key="opt || 'all'"
              class="px-3 py-1 rounded-md border transition-colors"
              :class="historyStatus === opt
                ? 'bg-sakura-400 text-white border-sakura-400'
                : 'bg-white text-ink-600 border-ink-100 hover:border-sakura-300'"
              @click="setStatusFilter(opt)"
            >
              {{ opt ? t(`apiUploadStatus_${opt}`) : t("filterAll") }}
            </button>
            <div class="flex-1" />
            <span class="text-ink-400">{{ t("totalLabel") }}: {{ historyTotal }}</span>
          </div>

          <!-- Body -->
          <div class="flex-1 overflow-y-auto px-5 pb-5">
            <div v-if="historyLoading" class="flex items-center justify-center py-10 text-ink-400">
              <Loader2 class="w-5 h-5 animate-spin" />
            </div>
            <div v-else-if="history.length === 0" class="text-center text-ink-400 py-10 text-sm">
              {{ t("apiTokenHistoryEmpty") }}
            </div>
            <div v-else class="flex flex-col gap-1.5">
              <div
                v-for="item in history"
                :key="item.id"
                class="flex items-center gap-3 px-3 py-2 rounded-xl border bg-surface text-sm"
                :class="statusColor(item.status)"
              >
                <span class="text-xs font-mono shrink-0 px-1.5 py-0.5 rounded bg-white/60 border border-current/20">
                  {{ t(`apiUploadStatus_${item.status}`) }}
                </span>
                <span class="flex-1 truncate font-mono text-xs text-ink-700">{{ item.filename }}</span>
                <span class="text-xs text-ink-400 shrink-0">{{ formatBytes(item.size) }}</span>
                <span class="text-xs text-ink-400 shrink-0">{{ fmtTime(item.uploaded_at) }}</span>
                <span v-if="item.client_ip" class="text-xs text-ink-400 shrink-0 hidden md:inline">{{ item.client_ip }}</span>
                <span v-if="item.error" class="text-xs text-rose-500 truncate max-w-48">{{ item.error }}</span>
              </div>
            </div>
          </div>

          <!-- Pagination -->
          <div v-if="totalPages > 1" class="px-5 py-3 border-t border-ink-100 flex items-center gap-2 text-xs">
            <KButton variant="ghost" size="sm" :disabled="historyPage <= 1" @click="goPage(historyPage - 1)">
              {{ t("prev") }}
            </KButton>
            <span class="text-ink-500">{{ historyPage }} / {{ totalPages }}</span>
            <KButton variant="ghost" size="sm" :disabled="historyPage >= totalPages" @click="goPage(historyPage + 1)">
              {{ t("next") }}
            </KButton>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>
