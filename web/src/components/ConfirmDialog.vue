<script setup lang="ts">
import { computed, watch, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import { AlertTriangle, HelpCircle, Info } from "lucide-vue-next";
import KButton from "./KButton.vue";
import { useConfirm } from "../composables/useConfirm";

const { t } = useI18n();
const { state, _resolve } = useConfirm();

const variant = computed(() => state.value.variant ?? "default");

const accent = computed(() => {
  switch (variant.value) {
    case "danger":  return { icon: AlertTriangle, ring: "bg-red-100 text-red-500", btn: "danger" as const };
    case "warning": return { icon: AlertTriangle, ring: "bg-amber-100 text-amber-500", btn: "primary" as const };
    default:        return { icon: HelpCircle,    ring: "bg-sakura-100 text-sakura-500", btn: "primary" as const };
  }
});

function onCancel() { _resolve(false); }
function onConfirm() { _resolve(true); }

function onKey(e: KeyboardEvent) {
  if (!state.value.open) return;
  if (e.key === "Escape") { e.preventDefault(); onCancel(); }
  if (e.key === "Enter")  { e.preventDefault(); onConfirm(); }
}

watch(() => state.value.open, (open) => {
  if (open) document.addEventListener("keydown", onKey);
  else      document.removeEventListener("keydown", onKey);
});

onBeforeUnmount(() => document.removeEventListener("keydown", onKey));
</script>

<template>
  <Teleport to="body">
    <Transition name="confirm-fade">
      <div
        v-if="state.open"
        class="fixed inset-0 z-[200] flex items-center justify-center p-4"
        @click.self="onCancel"
      >
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-ink-950/40 backdrop-blur-sm" />

        <!-- Dialog -->
        <Transition name="confirm-pop" appear>
          <div
            v-if="state.open"
            role="alertdialog"
            aria-modal="true"
            class="relative w-full max-w-sm bg-surface rounded-2xl shadow-2xl border border-ink-100 overflow-hidden"
          >
            <div class="p-6">
              <div class="flex items-start gap-4">
                <div
                  class="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                  :class="accent.ring"
                >
                  <component :is="accent.icon" class="w-5 h-5" />
                </div>
                <div class="flex-1 min-w-0">
                  <h3 v-if="state.title" class="font-display font-semibold text-base text-ink-900 mb-1.5">
                    {{ state.title }}
                  </h3>
                  <p class="text-sm text-ink-700 leading-relaxed whitespace-pre-line break-words">
                    {{ state.message }}
                  </p>
                  <div
                    v-if="state.detail"
                    class="mt-3 px-3 py-2 rounded-lg bg-ink-50 text-xs text-ink-500 font-mono break-all"
                  >
                    <Info class="w-3 h-3 inline-block mr-1 -mt-0.5 opacity-60" />
                    {{ state.detail }}
                  </div>
                </div>
              </div>
            </div>

            <div class="px-6 py-4 bg-ink-50/50 border-t border-ink-100 flex items-center justify-end gap-2">
              <KButton variant="ghost" size="sm" @click="onCancel">
                {{ state.cancelText || t('cancel') }}
              </KButton>
              <KButton :variant="accent.btn" size="sm" @click="onConfirm">
                {{ state.confirmText || t('confirm') }}
              </KButton>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.confirm-fade-enter-active,
.confirm-fade-leave-active { transition: opacity 0.18s ease; }
.confirm-fade-enter-from,
.confirm-fade-leave-to { opacity: 0; }

.confirm-pop-enter-active { transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.18s ease; }
.confirm-pop-leave-active { transition: transform 0.15s ease, opacity 0.12s ease; }
.confirm-pop-enter-from { transform: scale(0.92) translateY(8px); opacity: 0; }
.confirm-pop-leave-to   { transform: scale(0.96) translateY(4px); opacity: 0; }
</style>
