<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { KeyRound, ShieldCheck } from "lucide-vue-next";
import { setApiKey, verifyFontAccess, type FontAccessSession } from "../api/client";
import AuthKeyField from "./AuthKeyField.vue";
import KButton from "./KButton.vue";

withDefaults(defineProps<{
  title?: string;
  description?: string;
  hint?: string;
}>(), {});

const emit = defineEmits<{
  unlocked: [session: FontAccessSession];
}>();

const { t } = useI18n();
const keyInput = ref("");
const fieldRef = ref<InstanceType<typeof AuthKeyField> | null>(null);
const error = ref("");
const submitting = ref(false);

const unlock = async () => {
  const key = keyInput.value.trim();
  if (!key) {
    error.value = t("authKeyRequired");
    fieldRef.value?.focus();
    return;
  }
  submitting.value = true;
  error.value = "";
  try {
    const session = await verifyFontAccess(key);
    setApiKey(key);
    emit("unlocked", session);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    submitting.value = false;
  }
};

onMounted(async () => {
  await nextTick();
  fieldRef.value?.focus();
});
</script>

<template>
  <div class="flex min-h-[70vh] items-center justify-center py-10 sm:py-14">
    <div class="w-full max-w-md px-5">
      <div class="mb-6 text-center">
        <div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-sakura-50 text-sakura-500 border border-sakura-100">
          <KeyRound class="h-5 w-5" :stroke-width="1.8" />
        </div>
        <h1 class="font-display text-2xl font-bold tracking-tight text-ink-900">
          {{ title ?? t('lockTitle') }}
        </h1>
        <p class="mt-2 text-sm leading-relaxed text-ink-400">
          {{ description ?? t('lockDesc') }}
        </p>
      </div>

      <div class="rounded-2xl border border-ink-100 bg-surface p-5 sm:p-6 shadow-[var(--shadow-sm)]">
        <AuthKeyField
          ref="fieldRef"
          v-model="keyInput"
          size="lg"
          :label="t('authKeyLabel')"
          :placeholder="t('apiKeyPlaceholder')"
          @enter="unlock"
        />

        <p v-if="error" class="mt-2 text-xs text-rose-500">{{ error }}</p>

        <KButton
          variant="primary"
          size="lg"
          class="mt-4 w-full"
          :disabled="submitting"
          @click="unlock"
        >
          {{ t('unlock') }}
        </KButton>

        <div class="mt-4 flex items-start gap-2 rounded-xl bg-ink-50 px-3 py-2.5">
          <ShieldCheck class="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-300" />
          <p class="text-xs leading-relaxed text-ink-400">
            {{ hint ?? t('lockHint', { apiKey: 'API_KEY', envFile: '.env' }) }}
          </p>
        </div>

        <p class="mt-4 text-center text-xs text-ink-400">
          {{ t('memberAccessNeedCredential') }}
          <RouterLink to="/access" class="font-medium text-sakura-500 hover:text-sakura-600">
            {{ t('memberAccessApplyLink') }}
          </RouterLink>
        </p>
      </div>
    </div>
  </div>
</template>
