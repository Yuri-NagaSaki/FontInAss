<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  Activity, AlertTriangle, Check, CheckCircle2, Copy, FileCheck2,
  History, KeyRound, Loader2, Plus, Power, RefreshCcw, ShieldCheck, X, XCircle,
} from "lucide-vue-next";
import {
  createApiToken, getApiTokenHistory, getApiTokenStats, listApiTokens,
  listUploadAccessApplications, reviewUploadAccessApplication, updateApiToken,
} from "../api/client";
import type {
  ApiToken, ApiTokenApplicationAdmin, ApiTokenApplicationStatus, ApiTokenStats,
  ApiUploadHistoryItem, ApiUploadStatus,
} from "../api/client";
import { formatBytes } from "../lib/format";
import KButton from "./KButton.vue";
import KInput from "./KInput.vue";

const { t } = useI18n();
const baseUrl = window.location.origin;
type View = "applications" | "tokens";
const activeView = ref<View>("applications");

const tokens = ref<ApiToken[]>([]);
const applications = ref<ApiTokenApplicationAdmin[]>([]);
const stats = ref<ApiTokenStats | null>(null);
const loading = ref(false);
const errorMsg = ref("");
const applicationStatus = ref<ApiTokenApplicationStatus | "">("");

const loadAll = async () => {
  loading.value = true;
  errorMsg.value = "";
  try {
    const [tokenList, tokenStats, applicationList] = await Promise.all([
      listApiTokens(), getApiTokenStats(), listUploadAccessApplications(1, 100, applicationStatus.value || undefined),
    ]);
    tokens.value = tokenList;
    stats.value = tokenStats;
    applications.value = applicationList.data;
  } catch (error) {
    errorMsg.value = error instanceof Error ? error.message : String(error);
  } finally { loading.value = false; }
};

const setApplicationStatus = (status: ApiTokenApplicationStatus | "") => {
  applicationStatus.value = status;
  void loadAll();
};

const reviewOpen = ref(false);
const reviewApplication = ref<ApiTokenApplicationAdmin | null>(null);
const reviewDecision = ref<"approve" | "reject">("approve");
const reviewPublicNote = ref("");
const reviewAdminNote = ref("");
const reviewing = ref(false);

const openReview = (application: ApiTokenApplicationAdmin, decision: "approve" | "reject") => {
  reviewApplication.value = application;
  reviewDecision.value = decision;
  reviewPublicNote.value = application.public_note ?? "";
  reviewAdminNote.value = application.admin_note ?? "";
  reviewOpen.value = true;
};

const closeReview = () => {
  if (reviewing.value) return;
  reviewOpen.value = false;
  reviewApplication.value = null;
};

const submitReview = async () => {
  if (!reviewApplication.value || reviewing.value) return;
  reviewing.value = true;
  try {
    await reviewUploadAccessApplication(reviewApplication.value.id, {
      decision: reviewDecision.value,
      public_note: reviewPublicNote.value.trim() || null,
      admin_note: reviewAdminNote.value.trim() || null,
    });
    closeReview();
    await loadAll();
  } catch (error) {
    errorMsg.value = error instanceof Error ? error.message : String(error);
  } finally { reviewing.value = false; }
};

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
const closeCreate = () => { createOpen.value = false; createdToken.value = null; };
const submitCreate = async () => {
  if (!createName.value.trim() || creating.value) return;
  creating.value = true;
  try {
    createdToken.value = await createApiToken({ name: createName.value.trim(), note: createNote.value.trim() || undefined });
    await loadAll();
  } catch (error) { errorMsg.value = error instanceof Error ? error.message : String(error); }
  finally { creating.value = false; }
};
const copyPlaintext = async () => {
  if (!createdToken.value) return;
  await navigator.clipboard.writeText(createdToken.value.plaintext);
  copyOk.value = true;
  window.setTimeout(() => { copyOk.value = false; }, 1400);
};

const togglingId = ref<string | null>(null);
const toggleEnabled = async (token: ApiToken) => {
  togglingId.value = token.id;
  try {
    const updated = await updateApiToken(token.id, { enabled: !token.enabled });
    const index = tokens.value.findIndex((item) => item.id === token.id);
    if (index >= 0) tokens.value[index] = updated;
    stats.value = await getApiTokenStats();
  } catch (error) { errorMsg.value = error instanceof Error ? error.message : String(error); }
  finally { togglingId.value = null; }
};

const historyToken = ref<ApiToken | null>(null);
const history = ref<ApiUploadHistoryItem[]>([]);
const historyTotal = ref(0);
const historyPage = ref(1);
const historyStatus = ref<ApiUploadStatus | "">("");
const historyLoading = ref(false);
const historyLimit = 50;
const totalPages = computed(() => Math.max(1, Math.ceil(historyTotal.value / historyLimit)));

const openHistory = async (token: ApiToken) => {
  historyToken.value = token;
  historyPage.value = 1;
  historyStatus.value = "";
  await reloadHistory();
};
const closeHistory = () => { historyToken.value = null; history.value = []; historyTotal.value = 0; };
const reloadHistory = async () => {
  if (!historyToken.value) return;
  historyLoading.value = true;
  try {
    const response = await getApiTokenHistory(historyToken.value.id, historyPage.value, historyLimit, historyStatus.value || undefined);
    history.value = response.data;
    historyTotal.value = response.total;
  } catch (error) { errorMsg.value = error instanceof Error ? error.message : String(error); }
  finally { historyLoading.value = false; }
};
const setHistoryStatus = (status: ApiUploadStatus | "") => { historyStatus.value = status; historyPage.value = 1; void reloadHistory(); };
const goPage = (page: number) => { historyPage.value = Math.min(Math.max(1, page), totalPages.value); void reloadHistory(); };

const fmtTime = (value: string | null) => value ? new Date(value).toLocaleString() : "—";
const applicationStatusClass = (status: ApiTokenApplicationStatus) => ({
  pending: "bg-amber-50 text-amber-600 border-amber-200",
  approved: "bg-sky-50 text-sky-500 border-sky-200",
  rejected: "bg-rose-50 text-rose-600 border-rose-200",
  claimed: "bg-mint-50 text-mint-600 border-mint-200",
}[status]);
const uploadStatusClass = (status: ApiUploadStatus) => ({
  success: "bg-mint-50 text-mint-600 border-mint-200",
  duplicate: "bg-sky-50 text-sky-500 border-sky-200",
  rejected: "bg-amber-50 text-amber-600 border-amber-200",
  error: "bg-rose-50 text-rose-600 border-rose-200",
}[status]);

onMounted(() => { void loadAll(); });
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div class="min-w-0 flex-1">
        <p class="text-sm leading-relaxed text-ink-500">{{ t('apiTokensDesc') }}</p>
      </div>
      <div class="flex items-center gap-2">
        <KButton variant="ghost" size="sm" :loading="loading" @click="loadAll"><RefreshCcw class="h-3.5 w-3.5" />{{ t('refresh') }}</KButton>
        <KButton size="sm" @click="openCreate"><Plus class="h-3.5 w-3.5" />{{ t('apiTokenNew') }}</KButton>
      </div>
    </div>

    <div v-if="stats" class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div class="rounded-2xl border border-ink-100 bg-surface px-4 py-3"><p class="text-xs text-ink-400">{{ t('apiTokenStatPending') }}</p><p class="mt-1 font-display text-2xl font-semibold text-ink-900">{{ stats.totals.pendingApplications }}</p></div>
      <div class="rounded-2xl border border-ink-100 bg-surface px-4 py-3"><p class="text-xs text-ink-400">{{ t('apiTokenStatActive') }}</p><p class="mt-1 font-display text-2xl font-semibold text-ink-900">{{ stats.totals.active }}</p></div>
      <div class="rounded-2xl border border-ink-100 bg-surface px-4 py-3"><p class="text-xs text-ink-400">{{ t('apiTokenStatAccepted') }}</p><p class="mt-1 font-display text-2xl font-semibold text-ink-900">{{ stats.totals.acceptedFiles }}</p></div>
      <div class="rounded-2xl border border-ink-100 bg-surface px-4 py-3"><p class="text-xs text-ink-400">{{ t('apiTokenStatBytes') }}</p><p class="mt-1 font-display text-2xl font-semibold text-ink-900">{{ formatBytes(stats.totals.bytes) }}</p></div>
    </div>

    <div class="flex w-fit items-center gap-1 rounded-2xl bg-ink-100/60 p-1">
      <button class="h-8 rounded-xl px-4 text-sm font-medium transition" :class="activeView === 'applications' ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500'" @click="activeView = 'applications'">
        {{ t('apiTokenApplications') }}<span v-if="stats?.totals.pendingApplications" class="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-600">{{ stats.totals.pendingApplications }}</span>
      </button>
      <button class="h-8 rounded-xl px-4 text-sm font-medium transition" :class="activeView === 'tokens' ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500'" @click="activeView = 'tokens'">{{ t('apiTokenCredentials') }}</button>
    </div>

    <div v-if="errorMsg" class="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-600"><AlertTriangle class="h-3.5 w-3.5" />{{ errorMsg }}</div>

    <template v-if="activeView === 'applications'">
      <div class="flex flex-wrap items-center gap-1.5">
        <button v-for="status in (['', 'pending', 'approved', 'claimed', 'rejected'] as const)" :key="status || 'all'" class="rounded-lg border px-3 py-1 text-xs transition" :class="applicationStatus === status ? 'border-sakura-400 bg-sakura-400 text-white' : 'border-ink-100 bg-surface text-ink-500 hover:border-sakura-200'" @click="setApplicationStatus(status)">
          {{ status ? t(`uploadApplicationStatus_${status}`) : t('filterAll') }}
        </button>
      </div>

      <div v-if="loading && !applications.length" class="flex justify-center py-12 text-ink-300"><Loader2 class="h-5 w-5 animate-spin-slow" /></div>
      <div v-else-if="!applications.length" class="py-12 text-center text-sm text-ink-400">{{ t('apiTokenApplicationsEmpty') }}</div>
      <div v-else class="flex flex-col gap-3">
        <article v-for="application in applications" :key="application.id" class="rounded-2xl border border-ink-100 bg-surface p-4 sm:p-5">
          <div class="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <h3 class="font-display font-semibold text-ink-900">{{ application.applicant_name }}</h3>
                <span class="rounded-full border px-2 py-0.5 text-[10px] font-semibold" :class="applicationStatusClass(application.status)">{{ t(`uploadApplicationStatus_${application.status}`) }}</span>
                <code class="rounded-md bg-ink-50 px-1.5 py-0.5 font-mono text-[10px] text-ink-400">fia_{{ application.credential_prefix }}_…</code>
              </div>
              <p class="mt-1 text-xs text-ink-500">{{ application.contact }}</p>
              <p class="mt-3 max-w-3xl whitespace-pre-wrap text-sm leading-relaxed text-ink-700">{{ application.purpose }}</p>
              <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-400">
                <span v-if="application.expected_volume">{{ t('uploadApplicationVolume') }}: {{ application.expected_volume }}</span>
                <span>{{ t('apiTokenCreated') }}: {{ fmtTime(application.created_at) }}</span>
                <span v-if="application.request_ip_hash">IP# {{ application.request_ip_hash }}</span>
              </div>
              <p v-if="application.public_note" class="mt-2 text-xs text-sky-500">{{ t('apiTokenPublicNote') }}: {{ application.public_note }}</p>
              <p v-if="application.admin_note" class="mt-1 text-xs text-ink-400">{{ t('apiTokenAdminNote') }}: {{ application.admin_note }}</p>
            </div>
            <div v-if="application.status === 'pending'" class="flex shrink-0 items-center gap-2">
              <KButton variant="danger" size="sm" @click="openReview(application, 'reject')"><XCircle class="h-3.5 w-3.5" />{{ t('apiTokenReject') }}</KButton>
              <KButton size="sm" @click="openReview(application, 'approve')"><CheckCircle2 class="h-3.5 w-3.5" />{{ t('apiTokenApprove') }}</KButton>
            </div>
          </div>
        </article>
      </div>
    </template>

    <template v-else>
      <div class="flex items-start gap-3 rounded-xl border border-sky-100 bg-sky-50/60 px-4 py-3 text-xs leading-relaxed text-sky-500">
        <ShieldCheck class="mt-0.5 h-4 w-4 shrink-0" />
        <span>{{ t('apiTokenEndpointHint') }} <code class="rounded bg-surface px-1.5 py-0.5 font-mono">POST {{ baseUrl }}/api/v1/upload</code></span>
      </div>
      <div v-if="loading && !tokens.length" class="flex justify-center py-12 text-ink-300"><Loader2 class="h-5 w-5 animate-spin-slow" /></div>
      <div v-else-if="!tokens.length" class="py-12 text-center text-sm text-ink-400">{{ t('apiTokenEmpty') }}</div>
      <div v-else class="flex flex-col gap-2">
        <article v-for="token in tokens" :key="token.id" class="flex flex-col gap-3 rounded-2xl border border-ink-100 bg-surface p-4 md:flex-row md:items-center">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-display font-semibold text-ink-900">{{ token.name }}</span>
              <code class="rounded-md bg-ink-50 px-1.5 py-0.5 font-mono text-[11px] text-ink-400">fia_{{ token.prefix }}_…</code>
              <span class="rounded-full border px-2 py-0.5 text-[10px] font-semibold" :class="token.enabled ? 'border-mint-200 bg-mint-50 text-mint-600' : 'border-ink-100 bg-ink-50 text-ink-400'">{{ token.enabled ? t('apiTokenEnabled') : t('apiTokenDisabled') }}</span>
              <span v-if="token.application_id" class="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] text-sky-500">{{ t('apiTokenFromApplication') }}</span>
            </div>
            <p v-if="token.note" class="mt-1 truncate text-xs text-ink-500">{{ token.note }}</p>
            <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-400">
              <span class="flex items-center gap-1"><Activity class="h-3 w-3" />{{ token.request_count }} {{ t('apiTokenRequests') }}</span>
              <span class="flex items-center gap-1"><FileCheck2 class="h-3 w-3" />{{ token.accepted_file_count }} {{ t('apiTokenAcceptedFiles') }}</span>
              <span>{{ formatBytes(token.accepted_bytes) }}</span>
              <span>{{ t('apiTokenLastUsed') }}: {{ fmtTime(token.last_used_at) }}</span>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <KButton variant="ghost" size="sm" @click="openHistory(token)"><History class="h-3.5 w-3.5" />{{ t('apiTokenHistory') }}</KButton>
            <KButton :variant="token.enabled ? 'danger' : 'secondary'" size="sm" :loading="togglingId === token.id" @click="toggleEnabled(token)"><Power class="h-3.5 w-3.5" />{{ token.enabled ? t('apiTokenDisable') : t('apiTokenEnable') }}</KButton>
          </div>
        </article>
      </div>
    </template>

    <Teleport to="body">
      <div v-if="reviewOpen && reviewApplication" class="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
        <div class="absolute inset-0 bg-ink-950/40" @click="closeReview" />
        <div class="relative w-full rounded-t-2xl border border-ink-100 bg-surface p-5 shadow-[var(--shadow-lg)] sm:max-w-lg sm:rounded-2xl sm:p-6">
          <div class="mb-5 flex items-start gap-3">
            <div class="flex h-10 w-10 items-center justify-center rounded-xl" :class="reviewDecision === 'approve' ? 'bg-mint-50 text-mint-600' : 'bg-rose-50 text-rose-600'">
              <CheckCircle2 v-if="reviewDecision === 'approve'" class="h-4 w-4" /><XCircle v-else class="h-4 w-4" />
            </div>
            <div class="min-w-0 flex-1"><h2 class="font-display font-semibold text-ink-900">{{ reviewDecision === 'approve' ? t('apiTokenApproveTitle') : t('apiTokenRejectTitle') }}</h2><p class="mt-1 text-sm text-ink-400">{{ reviewApplication.applicant_name }}</p></div>
            <button class="flex h-8 w-8 items-center justify-center rounded-lg text-ink-300 hover:bg-ink-50" @click="closeReview"><X class="h-4 w-4" /></button>
          </div>
          <label class="flex flex-col gap-1.5 text-xs font-medium text-ink-600">{{ t('apiTokenPublicNote') }}<textarea v-model="reviewPublicNote" rows="3" class="resize-none rounded-xl border border-ink-200 bg-surface px-3 py-2.5 text-sm font-normal outline-none focus:border-sakura-400 focus:ring-2 focus:ring-sakura-400/20" /></label>
          <label class="mt-4 flex flex-col gap-1.5 text-xs font-medium text-ink-600">{{ t('apiTokenAdminNote') }}<textarea v-model="reviewAdminNote" rows="2" class="resize-none rounded-xl border border-ink-200 bg-surface px-3 py-2.5 text-sm font-normal outline-none focus:border-sakura-400 focus:ring-2 focus:ring-sakura-400/20" /></label>
          <div class="mt-5 flex justify-end gap-2"><KButton variant="ghost" @click="closeReview">{{ t('cancel') }}</KButton><KButton :variant="reviewDecision === 'approve' ? 'primary' : 'danger'" :loading="reviewing" @click="submitReview">{{ reviewDecision === 'approve' ? t('apiTokenApprove') : t('apiTokenReject') }}</KButton></div>
        </div>
      </div>

      <div v-if="createOpen" class="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
        <div class="absolute inset-0 bg-ink-950/40" @click="closeCreate" />
        <div class="relative w-full rounded-t-2xl border border-ink-100 bg-surface p-5 shadow-[var(--shadow-lg)] sm:max-w-md sm:rounded-2xl sm:p-6">
          <template v-if="!createdToken">
            <div class="mb-5 flex items-start gap-3"><div class="flex h-10 w-10 items-center justify-center rounded-xl bg-sakura-50 text-sakura-500"><KeyRound class="h-4 w-4" /></div><div><h2 class="font-display font-semibold text-ink-900">{{ t('apiTokenCreateTitle') }}</h2><p class="mt-1 text-sm text-ink-400">{{ t('apiTokenCreateDesc') }}</p></div></div>
            <div class="flex flex-col gap-4"><KInput v-model="createName" :label="t('apiTokenName')" :placeholder="t('apiTokenNamePlaceholder')" /><KInput v-model="createNote" :label="t('apiTokenNote')" :placeholder="t('apiTokenNotePlaceholder')" /></div>
            <div class="mt-5 flex justify-end gap-2"><KButton variant="ghost" @click="closeCreate">{{ t('cancel') }}</KButton><KButton :loading="creating" :disabled="!createName.trim()" @click="submitCreate">{{ t('apiTokenCreate') }}</KButton></div>
          </template>
          <template v-else>
            <div class="mb-4 flex items-start gap-3"><div class="flex h-10 w-10 items-center justify-center rounded-xl bg-mint-50 text-mint-600"><CheckCircle2 class="h-4 w-4" /></div><div><h2 class="font-display font-semibold text-ink-900">{{ t('apiTokenCreatedTitle') }}</h2><p class="mt-1 text-sm text-ink-400">{{ t('apiTokenCreatedDesc') }}</p></div></div>
            <div class="break-all rounded-xl bg-ink-50 p-3 font-mono text-xs text-ink-700">{{ createdToken.plaintext }}</div>
            <div class="mt-5 flex justify-end gap-2"><KButton variant="ghost" @click="closeCreate">{{ t('close') }}</KButton><KButton @click="copyPlaintext"><Check v-if="copyOk" class="h-4 w-4" /><Copy v-else class="h-4 w-4" />{{ copyOk ? t('copiedLabel') : t('copy') }}</KButton></div>
          </template>
        </div>
      </div>

      <div v-if="historyToken" class="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-4">
        <div class="absolute inset-0 bg-ink-950/40" @click="closeHistory" />
        <div class="relative flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-ink-100 bg-surface shadow-[var(--shadow-lg)] md:rounded-2xl">
          <div class="flex items-center gap-3 border-b border-ink-100 px-5 py-4"><History class="h-4 w-4 text-sakura-500" /><div class="min-w-0 flex-1"><h2 class="font-display font-semibold text-ink-900">{{ historyToken.name }}</h2><p class="text-[11px] text-ink-400">{{ historyTotal }} {{ t('apiTokenHistory') }}</p></div><button class="flex h-8 w-8 items-center justify-center rounded-lg text-ink-300 hover:bg-ink-50" @click="closeHistory"><X class="h-4 w-4" /></button></div>
          <div class="flex flex-wrap gap-1.5 px-5 py-3"><button v-for="status in (['', 'success', 'duplicate', 'rejected', 'error'] as const)" :key="status || 'all'" class="rounded-lg border px-3 py-1 text-xs" :class="historyStatus === status ? 'border-sakura-400 bg-sakura-400 text-white' : 'border-ink-100 text-ink-500'" @click="setHistoryStatus(status)">{{ status ? t(`apiUploadStatus_${status}`) : t('filterAll') }}</button></div>
          <div class="flex-1 overflow-y-auto px-5 pb-5"><div v-if="historyLoading" class="flex justify-center py-10"><Loader2 class="h-5 w-5 animate-spin-slow text-ink-300" /></div><p v-else-if="!history.length" class="py-10 text-center text-sm text-ink-400">{{ t('apiTokenHistoryEmpty') }}</p><div v-else class="flex flex-col gap-1.5"><div v-for="item in history" :key="item.id" class="flex items-center gap-3 rounded-xl border px-3 py-2.5" :class="uploadStatusClass(item.status)"><span class="rounded-md border border-current/20 px-1.5 py-0.5 text-[10px] font-semibold">{{ t(`apiUploadStatus_${item.status}`) }}</span><span class="min-w-0 flex-1 truncate font-mono text-xs text-ink-700">{{ item.filename }}</span><span class="text-[11px] text-ink-400">{{ formatBytes(item.size) }}</span><span class="hidden text-[11px] text-ink-400 sm:inline">{{ fmtTime(item.uploaded_at) }}</span></div></div></div>
          <div v-if="totalPages > 1" class="flex items-center gap-2 border-t border-ink-100 px-5 py-3"><KButton variant="ghost" size="sm" :disabled="historyPage <= 1" @click="goPage(historyPage - 1)">{{ t('prev') }}</KButton><span class="text-xs text-ink-400">{{ historyPage }} / {{ totalPages }}</span><KButton variant="ghost" size="sm" :disabled="historyPage >= totalPages" @click="goPage(historyPage + 1)">{{ t('next') }}</KButton></div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
