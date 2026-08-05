<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import {
  BadgeCheck, Clock3, Copy, KeyRound, RefreshCcw, Send, ShieldCheck, XCircle,
} from "lucide-vue-next";
import {
  applyForUploadAccess,
  claimUploadAccessApplication,
  getUploadAccessApplication,
  setApiKey,
  verifyFontAccess,
  type ApiTokenApplication,
} from "../api/client";
import KButton from "../components/KButton.vue";
import KInput from "../components/KInput.vue";

const { t } = useI18n();
const router = useRouter();
const APPLICATION_KEY = "fontinass_upload_application";

type PortalMode = "credential" | "apply";
interface StoredApplication { id: string; secret: string }

const portalMode = ref<PortalMode>("credential");
const credentialInput = ref("");
const credentialLoading = ref(false);
const credentialError = ref("");

const applicationName = ref("");
const applicationContact = ref("");
const applicationPurpose = ref("");
const applicationVolume = ref("");
const applicationSubmitting = ref(false);
const applicationError = ref("");
const storedApplication = ref<StoredApplication | null>(loadStoredApplication());
const application = ref<ApiTokenApplication | null>(null);
const applicationLoading = ref(false);
const copied = ref(false);

const canApply = computed(() => applicationName.value.trim()
  && applicationContact.value.trim()
  && applicationPurpose.value.trim().length >= 10);
const applicationTone = computed(() => ({
  pending: "bg-amber-50 text-amber-600 border-amber-200",
  approved: "bg-sky-50 text-sky-500 border-sky-200",
  rejected: "bg-rose-50 text-rose-600 border-rose-200",
  claimed: "bg-mint-50 text-mint-600 border-mint-200",
}[application.value?.status ?? "pending"]));

function loadStoredApplication(): StoredApplication | null {
  try {
    const raw = localStorage.getItem(APPLICATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredApplication>;
    return parsed.id && parsed.secret ? { id: parsed.id, secret: parsed.secret } : null;
  } catch { return null; }
}

const saveStoredApplication = (value: StoredApplication | null) => {
  storedApplication.value = value;
  if (value) localStorage.setItem(APPLICATION_KEY, JSON.stringify(value));
  else localStorage.removeItem(APPLICATION_KEY);
};

const connectCredential = async (value = credentialInput.value) => {
  const credential = value.trim();
  if (!credential || credentialLoading.value) return;
  credentialLoading.value = true;
  credentialError.value = "";
  try {
    await verifyFontAccess(credential);
    setApiKey(credential);
    await router.push("/fonts");
  } catch (cause) {
    credentialError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    credentialLoading.value = false;
  }
};

const submitApplication = async () => {
  if (!canApply.value || applicationSubmitting.value) return;
  applicationSubmitting.value = true;
  applicationError.value = "";
  try {
    const receipt = await applyForUploadAccess({
      applicant_name: applicationName.value.trim(),
      contact: applicationContact.value.trim(),
      purpose: applicationPurpose.value.trim(),
      expected_volume: applicationVolume.value.trim() || undefined,
    });
    application.value = receipt.application;
    saveStoredApplication({ id: receipt.application.id, secret: receipt.recovery_secret });
  } catch (cause) {
    applicationError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    applicationSubmitting.value = false;
  }
};

const refreshApplication = async () => {
  if (!storedApplication.value || applicationLoading.value) return;
  applicationLoading.value = true;
  applicationError.value = "";
  try {
    application.value = await getUploadAccessApplication(storedApplication.value.id, storedApplication.value.secret);
  } catch (cause) {
    applicationError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    applicationLoading.value = false;
  }
};

const claimApplication = async () => {
  if (!storedApplication.value || applicationLoading.value) return;
  applicationLoading.value = true;
  applicationError.value = "";
  try {
    const claimed = await claimUploadAccessApplication(storedApplication.value.id, storedApplication.value.secret);
    application.value = claimed.application;
    setApiKey(claimed.plaintext);
    await router.push("/fonts");
  } catch (cause) {
    applicationError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    applicationLoading.value = false;
  }
};

const useClaimedCredential = async () => {
  if (storedApplication.value) await connectCredential(storedApplication.value.secret);
};
const clearApplicationReceipt = () => {
  application.value = null;
  saveStoredApplication(null);
};
const copySecret = async () => {
  if (!storedApplication.value) return;
  await navigator.clipboard.writeText(storedApplication.value.secret);
  copied.value = true;
  window.setTimeout(() => { copied.value = false; }, 1400);
};

onMounted(() => { if (storedApplication.value) void refreshApplication(); });
</script>

<template>
  <div class="flex flex-col gap-7">
    <header class="max-w-3xl">
      <div class="mb-2 flex items-center gap-2 text-xs font-semibold text-sakura-500">
        <ShieldCheck class="h-3.5 w-3.5" />{{ t('memberAccessEyebrow') }}
      </div>
      <h1 class="font-display text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">{{ t('memberAccessTitle') }}</h1>
      <p class="mt-2 max-w-2xl text-sm leading-relaxed text-ink-500">{{ t('memberAccessDesc') }}</p>
    </header>

    <div v-if="storedApplication" class="rounded-2xl border border-ink-100 bg-surface px-4 py-4 sm:px-5">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div class="flex min-w-0 flex-1 items-start gap-3">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-50 text-ink-500">
            <Clock3 v-if="application?.status === 'pending'" class="h-4 w-4" />
            <BadgeCheck v-else-if="application?.status === 'approved' || application?.status === 'claimed'" class="h-4 w-4" />
            <XCircle v-else class="h-4 w-4" />
          </div>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-display font-semibold text-ink-900">{{ t('uploadApplicationReceipt') }}</span>
              <span v-if="application" class="rounded-full border px-2 py-0.5 text-[11px] font-semibold" :class="applicationTone">
                {{ t(`uploadApplicationStatus_${application.status}`) }}
              </span>
            </div>
            <p class="mt-1 truncate font-mono text-xs text-ink-400">{{ storedApplication.id }}</p>
            <p v-if="application?.public_note" class="mt-1 text-xs text-ink-500">{{ application.public_note }}</p>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <KButton variant="ghost" size="sm" :loading="applicationLoading" @click="refreshApplication"><RefreshCcw class="h-3.5 w-3.5" />{{ t('refresh') }}</KButton>
          <KButton v-if="application?.status === 'approved'" size="sm" :loading="applicationLoading" @click="claimApplication"><KeyRound class="h-3.5 w-3.5" />{{ t('uploadApplicationClaim') }}</KButton>
          <KButton v-if="application?.status === 'claimed'" size="sm" @click="useClaimedCredential"><KeyRound class="h-3.5 w-3.5" />{{ t('memberAccessEnterBackend') }}</KButton>
          <KButton variant="ghost" size="sm" @click="clearApplicationReceipt">{{ t('uploadApplicationClearReceipt') }}</KButton>
        </div>
      </div>
      <div class="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
        <div class="min-w-0 rounded-xl bg-ink-50 px-3 py-2 font-mono text-xs text-ink-600 break-all">{{ storedApplication.secret }}</div>
        <KButton variant="outline" size="sm" @click="copySecret"><Copy class="h-3.5 w-3.5" />{{ copied ? t('copiedLabel') : t('copy') }}</KButton>
      </div>
      <p class="mt-2 text-[11px] leading-relaxed text-amber-600">{{ t('memberAccessSecretWarning') }}</p>
    </div>

    <div class="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
      <div class="pt-2 lg:pt-6">
        <ol class="flex flex-col gap-5">
          <li v-for="(step, index) in [t('memberAccessStepApply'), t('memberAccessStepReview'), t('memberAccessStepUse')]" :key="step" class="flex gap-3">
            <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-sakura-200 bg-sakura-50 font-display text-xs font-bold text-sakura-600">{{ index + 1 }}</span>
            <p class="pt-0.5 text-sm leading-relaxed text-ink-600">{{ step }}</p>
          </li>
        </ol>
        <div class="mt-7 flex items-start gap-2 text-xs leading-relaxed text-ink-400">
          <ShieldCheck class="mt-0.5 h-3.5 w-3.5 shrink-0" />{{ t('memberAccessScope') }}
        </div>
      </div>

      <section class="overflow-hidden rounded-2xl border border-ink-100 bg-surface shadow-[var(--shadow-sm)]">
        <div class="grid grid-cols-2 border-b border-ink-100 bg-ink-50/60 p-1.5">
          <button class="h-9 rounded-xl text-sm font-medium transition-colors" :class="portalMode === 'credential' ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'" @click="portalMode = 'credential'">{{ t('uploadPortalHaveCredential') }}</button>
          <button class="h-9 rounded-xl text-sm font-medium transition-colors" :class="portalMode === 'apply' ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'" @click="portalMode = 'apply'">{{ t('uploadPortalApply') }}</button>
        </div>

        <div v-if="portalMode === 'credential'" class="p-5 sm:p-6">
          <div class="mb-5 flex items-start gap-3">
            <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sakura-100 bg-sakura-50 text-sakura-500"><KeyRound class="h-4 w-4" /></div>
            <div><h2 class="font-display font-semibold text-ink-900">{{ t('memberAccessCredentialTitle') }}</h2><p class="mt-1 text-sm text-ink-400">{{ t('memberAccessCredentialDesc') }}</p></div>
          </div>
          <KInput v-model="credentialInput" type="password" :label="t('uploadCredentialLabel')" :placeholder="t('uploadCredentialPlaceholder')" @enter="connectCredential()" />
          <p v-if="credentialError" class="mt-2 text-xs text-rose-500">{{ credentialError }}</p>
          <KButton class="mt-4 w-full" size="lg" :loading="credentialLoading" :disabled="!credentialInput.trim()" @click="connectCredential()">{{ t('memberAccessEnterBackend') }}</KButton>
        </div>

        <form v-else class="p-5 sm:p-6" @submit.prevent="submitApplication">
          <div class="mb-5 flex items-start gap-3">
            <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sky-100 bg-sky-50 text-sky-500"><Send class="h-4 w-4" /></div>
            <div><h2 class="font-display font-semibold text-ink-900">{{ t('memberAccessApplicationTitle') }}</h2><p class="mt-1 text-sm text-ink-400">{{ t('memberAccessApplicationDesc') }}</p></div>
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <KInput v-model="applicationName" :label="t('uploadApplicationName')" :placeholder="t('uploadApplicationNamePlaceholder')" />
            <KInput v-model="applicationContact" :label="t('uploadApplicationContact')" :placeholder="t('uploadApplicationContactPlaceholder')" />
          </div>
          <label class="mt-4 flex flex-col gap-1.5 text-xs font-medium text-ink-600">
            {{ t('uploadApplicationPurpose') }}
            <textarea v-model="applicationPurpose" rows="4" maxlength="1000" :placeholder="t('uploadApplicationPurposePlaceholder')" class="resize-none rounded-xl border border-ink-200 bg-surface px-3.5 py-3 text-sm font-normal text-ink-900 outline-none transition focus:border-sakura-400 focus:ring-2 focus:ring-sakura-400/20" />
          </label>
          <KInput v-model="applicationVolume" class="mt-4" :label="t('uploadApplicationVolume')" :placeholder="t('uploadApplicationVolumePlaceholder')" />
          <p v-if="applicationError" class="mt-3 text-xs text-rose-500">{{ applicationError }}</p>
          <KButton class="mt-5 w-full" size="lg" :loading="applicationSubmitting" :disabled="!canApply" @click="submitApplication"><Send class="h-4 w-4" />{{ t('uploadApplicationSubmit') }}</KButton>
        </form>
      </section>
    </div>
  </div>
</template>
