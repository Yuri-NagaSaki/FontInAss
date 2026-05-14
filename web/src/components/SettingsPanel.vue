<script setup lang="ts">
import { computed, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { CheckCircle2, X } from "lucide-vue-next";
import KButton from "./KButton.vue";
import { useSettings } from "../composables/useSettings";

defineProps<{
  variant: "dropdown" | "sheet";
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t } = useI18n();
const { settings, save, toggle, get, setFontNameMode } = useSettings();

const savedAck = shallowRef(false);

const saveSettings = () => {
  save();
  savedAck.value = true;
  setTimeout(() => { savedAck.value = false; emit("close"); }, 900);
};

const isAliasFontNameMode = computed(() => settings.FONT_NAME_MODE === "alias");
const toggleFontNameMode = () => {
  setFontNameMode(isAliasFontNameMode.value ? "preserve" : "alias");
};

const switchItems = [
  {
    id: "FONT_NAME_MODE",
    label: () => t("fontNameModeAlias"),
    desc: () => t("fontNameModeAliasDesc"),
    checked: () => isAliasFontNameMode.value,
    toggle: toggleFontNameMode,
  },
  {
    id: "STRICT_MODE",
    label: () => t("strictMode"),
    desc: () => t("strictModeDesc"),
    checked: () => get("STRICT_MODE"),
    toggle: () => toggle("STRICT_MODE"),
  },
  {
    id: "CLEAR_FONTS",
    label: () => t("clearFonts"),
    desc: () => t("clearFontsDesc"),
    checked: () => get("CLEAR_FONTS"),
    toggle: () => toggle("CLEAR_FONTS"),
  },
  {
    id: "EXTRACT_FONTS",
    label: () => t("extractFonts"),
    desc: () => t("extractFontsDesc"),
    checked: () => get("EXTRACT_FONTS"),
    toggle: () => toggle("EXTRACT_FONTS"),
  },
  {
    id: "CLEAR_AFTER_DOWNLOAD",
    label: () => t("clearAfterDownload"),
    desc: () => t("clearAfterDownloadDesc"),
    checked: () => get("CLEAR_AFTER_DOWNLOAD"),
    toggle: () => toggle("CLEAR_AFTER_DOWNLOAD"),
  },
] as const;
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

    <!-- Toggles -->
    <div class="space-y-3 mb-5">
      <label
        v-for="item in switchItems"
        :key="item.id"
        class="flex items-start gap-3 cursor-pointer group"
        role="switch"
        :aria-checked="item.checked()"
        tabindex="0"
        @click="item.toggle()"
        @keydown.enter.prevent="item.toggle()"
        @keydown.space.prevent="item.toggle()"
      >
        <div
          class="relative w-9 h-5 rounded-full transition-colors duration-200 flex-shrink-0 mt-0.5"
          :class="item.checked() ? 'bg-sakura-400' : 'bg-ink-200'"
        >
          <div
            class="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200"
            :class="item.checked() ? 'translate-x-4' : 'translate-x-0.5'"
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
