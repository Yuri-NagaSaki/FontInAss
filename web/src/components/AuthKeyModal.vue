<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { CheckCircle2, KeyRound, Shield, Trash2, X } from "lucide-vue-next";
import { clearApiKey, getApiKey, setApiKey, verifyFontAccess } from "../api/client";
import AuthKeyField from "./AuthKeyField.vue";
import KButton from "./KButton.vue";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  saved: [];
  cleared: [];
}>();

const { t } = useI18n();
const keyInput = ref("");
const fieldRef = ref<InstanceType<typeof AuthKeyField> | null>(null);
const saved = ref(false);
const saving = ref(false);
const error = ref("");

const hasStoredKey = computed(() => !!getApiKey());
const isDirty = computed(() => keyInput.value.trim() !== getApiKey());

const close = () => {
  emit("update:open", false);
  saved.value = false;
  error.value = "";
};

const save = async () => {
  const key = keyInput.value.trim();
  if (!key) {
    error.value = t("authKeyRequired");
    fieldRef.value?.focus();
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    await verifyFontAccess(key);
    setApiKey(key);
    saved.value = true;
    emit("saved");
    window.setTimeout(() => {
      saved.value = false;
      close();
    }, 700);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    saving.value = false;
  }
};

const clear = () => {
  clearApiKey();
  keyInput.value = "";
  error.value = "";
  emit("cleared");
  close();
};

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    keyInput.value = getApiKey();
    saved.value = false;
    error.value = "";
    await nextTick();
    fieldRef.value?.focus();
  },
);
</script>

<template>
  <Teleport to="body">
    <Transition name="auth-modal">
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-key-modal-title"
        @keydown.esc.prevent="close"
      >
        <div class="absolute inset-0 bg-ink-950/40" @click="close" />

        <div
          class="auth-modal-panel relative w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-ink-100 bg-surface shadow-[var(--shadow-lg)]"
          @click.stop
        >
          <div class="p-5 sm:p-6">
            <div class="mb-5 flex items-start justify-between gap-3">
              <div class="flex items-start gap-3 min-w-0">
                <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sakura-50 text-sakura-500 border border-sakura-100">
                  <KeyRound class="h-4 w-4" :stroke-width="1.8" />
                </div>
                <div class="min-w-0 pt-0.5">
                  <div class="mb-1 flex flex-wrap items-center gap-2">
                    <h2 id="auth-key-modal-title" class="font-display text-base font-semibold text-ink-900">
                      {{ t('apiKeyTitle') }}
                    </h2>
                    <span
                      class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                      :class="hasStoredKey
                        ? 'bg-mint-100 text-mint-600'
                        : 'bg-amber-100 text-amber-600'"
                    >
                      {{ hasStoredKey ? t('apiKeySet') : t('apiKeyNotSet') }}
                    </span>
                  </div>
                  <p class="text-sm leading-relaxed text-ink-400">
                    {{ t('apiKeyDesc') }}
                  </p>
                </div>
              </div>

              <button
                type="button"
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-300 hover:bg-ink-50 hover:text-ink-600 transition-colors"
                :aria-label="t('cancel')"
                @click="close"
              >
                <X class="h-4 w-4" />
              </button>
            </div>

            <AuthKeyField
              ref="fieldRef"
              v-model="keyInput"
              size="lg"
              :label="t('authKeyLabel')"
              :placeholder="t('apiKeyPlaceholder')"
              @enter="save"
            />
            <p v-if="error" class="mt-2 text-xs text-rose-500">{{ error }}</p>

            <div class="mt-3 flex items-start gap-2 rounded-xl bg-ink-50 px-3 py-2.5">
              <Shield class="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-300" />
              <p class="text-xs leading-relaxed text-ink-400">
                {{ t('authKeyModalHint') }}
              </p>
            </div>

            <div class="mt-5 flex flex-col-reverse sm:flex-row sm:items-center gap-2">
              <KButton
                v-if="hasStoredKey"
                variant="ghost"
                size="md"
                class="sm:mr-auto text-rose-500 hover:bg-rose-50 hover:text-rose-600"
                @click="clear"
              >
                <Trash2 class="h-3.5 w-3.5" />
                {{ t('apiKeyClear') }}
              </KButton>

              <div class="flex items-center gap-2 sm:ml-auto">
                <KButton variant="ghost" size="md" @click="close">
                  {{ t('cancel') }}
                </KButton>
                <KButton
                  variant="primary"
                  size="md"
                  class="min-w-[7rem]"
                  :loading="saving"
                  :disabled="saved || saving || !keyInput.trim() || (!isDirty && hasStoredKey)"
                  @click="save"
                >
                  <CheckCircle2 v-if="saved" class="h-4 w-4" />
                  {{ saved ? t('saved') : t('apiKeySave') }}
                </KButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.auth-modal-enter-active,
.auth-modal-leave-active {
  transition: opacity 0.15s ease;
}
.auth-modal-enter-active .auth-modal-panel,
.auth-modal-leave-active .auth-modal-panel {
  transition: transform 0.15s ease, opacity 0.15s ease;
}
.auth-modal-enter-from,
.auth-modal-leave-to {
  opacity: 0;
}
.auth-modal-enter-from .auth-modal-panel,
.auth-modal-leave-to .auth-modal-panel {
  opacity: 0;
  transform: translateY(8px);
}
</style>
