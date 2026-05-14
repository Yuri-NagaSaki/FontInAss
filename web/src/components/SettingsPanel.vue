<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { CheckCircle2, X } from "lucide-vue-next";
import KButton from "./KButton.vue";
import { useSettings, type FontNameMode } from "../composables/useSettings";

defineProps<{
  variant: "dropdown" | "sheet";
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t } = useI18n();
const { settings, save, toggle, get, setFontNameMode } = useSettings();

const savedAck = ref(false);

const saveSettings = () => {
  save();
  savedAck.value = true;
  setTimeout(() => { savedAck.value = false; emit("close"); }, 900);
};

const toggleItems = [
  { key: "STRICT_MODE",          label: () => t("strictMode"),         desc: () => t("strictModeDesc")         },
  { key: "CLEAR_FONTS",          label: () => t("clearFonts"),         desc: () => t("clearFontsDesc")         },
  { key: "EXTRACT_FONTS",        label: () => t("extractFonts"),       desc: () => t("extractFontsDesc")       },
  { key: "CLEAR_AFTER_DOWNLOAD", label: () => t("clearAfterDownload"), desc: () => t("clearAfterDownloadDesc") },
] as const;

const fontNameModeItems: Array<{ value: FontNameMode; label: string; desc: string }> = [
  { value: "preserve", label: "fontNameModePreserve", desc: "fontNameModePreserveDesc" },
  { value: "alias", label: "fontNameModeAlias", desc: "fontNameModeAliasDesc" },
];
</script>

<template>
  <div>
    <!-- Header (sheet variant only) -->
    <div v-if="variant === 'sheet'" class="flex items-center justify-between mb-4">
      <h3 class="font-display font-semibold text-ink-900 text-sm">{{ t('settingsTitle') }}</h3>
      <button class="w-7 h-7 rounded-lg flex items-center justify-center text-ink-400 hover:bg-sakura-50 hover:text-sakura-600" @click="emit('close')">
        <X class="w-4 h-4" />
      </button>
    </div>
    <h3 v-else class="font-display font-semibold text-ink-900 text-sm mb-4">{{ t('settingsTitle') }}</h3>

    <!-- Font naming strategy -->
    <div class="mb-5">
      <div class="mb-2">
        <p class="text-xs font-semibold text-ink-800 leading-snug">{{ t('fontNameModeTitle') }}</p>
        <p class="text-[11px] text-ink-400 leading-snug mt-0.5">{{ t('fontNameModeDesc') }}</p>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <button
          v-for="item in fontNameModeItems"
          :key="item.value"
          type="button"
          class="text-left rounded-lg border px-3 py-2 transition-colors"
          :class="settings.FONT_NAME_MODE === item.value
            ? 'border-sakura-300 bg-sakura-50 text-ink-900'
            : 'border-ink-200 bg-white text-ink-600 hover:border-sakura-200 hover:bg-sakura-50/50'"
          @click="setFontNameMode(item.value)"
        >
          <span class="block text-xs font-semibold leading-snug">{{ t(item.label) }}</span>
          <span class="block text-[11px] leading-snug mt-0.5 text-ink-400">{{ t(item.desc) }}</span>
        </button>
      </div>
    </div>

    <!-- Toggles -->
    <div class="space-y-3 mb-5">
      <label
        v-for="item in toggleItems"
        :key="item.key"
        class="flex items-start gap-3 cursor-pointer group"
        role="switch"
        :aria-checked="get(item.key)"
        tabindex="0"
        @click="toggle(item.key)"
        @keydown.enter.prevent="toggle(item.key)"
        @keydown.space.prevent="toggle(item.key)"
      >
        <div
          class="relative w-9 h-5 rounded-full transition-colors duration-200 flex-shrink-0 mt-0.5"
          :class="get(item.key) ? 'bg-sakura-400' : 'bg-ink-200'"
        >
          <div
            class="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200"
            :class="get(item.key) ? 'translate-x-4' : 'translate-x-0.5'"
          />
        </div>
        <div class="flex-1">
          <p class="text-xs font-medium text-ink-700 select-none leading-snug">{{ item.label() }}</p>
          <p class="text-[11px] text-ink-400 select-none leading-snug mt-0.5">{{ item.desc() }}</p>
        </div>
      </label>
    </div>

    <div class="flex gap-2">
      <KButton variant="primary" size="sm" class="flex-1" @click="saveSettings">
        <Transition name="chip-icon" mode="out-in">
          <CheckCircle2 v-if="savedAck" key="ok" class="w-3.5 h-3.5 text-white" />
          <span v-else key="icon" />
        </Transition>
        {{ savedAck ? t('saved') : t('save') }}
      </KButton>
      <KButton variant="ghost" size="sm" @click="emit('close')">{{ t('cancel') }}</KButton>
    </div>
  </div>
</template>
