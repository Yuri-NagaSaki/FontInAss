<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { init } from "@waline/client";
import "@waline/client/waline.css";

const { t, locale } = useI18n();

const walineEl = ref<HTMLDivElement>();
let walineController: ReturnType<typeof init> | null = null;

const WALINE_SERVER = "https://waline.anibt.net/";

onMounted(() => {
  if (!walineEl.value) return;
  walineController = init({
    el: walineEl.value,
    serverURL: WALINE_SERVER,
    lang: locale.value === "zh-CN" ? "zh-CN" : "en",
    emoji: ["https://unpkg.com/@waline/emojis@1.2.0/weibo", "https://unpkg.com/@waline/emojis@1.2.0/bilibili"],
    meta: ["nick", "mail", "link"],
    requiredMeta: ["nick"],
    pageSize: 20,
    dark: "html.dark",
    comment: true,
    reaction: false,
  });
});

onUnmounted(() => {
  walineController?.destroy?.();
  walineController = null;
});
</script>

<template>
  <div class="max-w-3xl mx-auto px-5 py-10">
    <!-- Header -->
    <div class="mb-8">
      <h1 class="font-display font-bold text-2xl text-ink-900 tracking-tight mb-1">
        {{ t("comments") }}
      </h1>
      <p class="text-sm text-ink-400">{{ t("commentsDesc") }}</p>
    </div>

    <!-- Waline comment box -->
    <div
      ref="walineEl"
      class="waline-wrap rounded-2xl border border-sakura-100 bg-white shadow-[var(--shadow-md)] overflow-hidden p-6"
    />
  </div>
</template>

<style>
/* Override Waline variables to match the app's sakura theme */
:root {
  --waline-theme-color: oklch(68% 0.22 350);
  --waline-active-color: oklch(60% 0.24 350);
  --waline-border-color: oklch(88% 0.06 350);
  --waline-bgcolor: #fff;
  --waline-color: oklch(20% 0.02 260);
  --waline-font-size: 14px;
  --waline-border-radius: 12px;
  --waline-avatar-radius: 50%;
  --waline-box-shadow: none;
}
/* Remove the default waline card shadow since we wrap it ourselves */
.waline-wrap .wl-panel {
  box-shadow: none !important;
  border: none !important;
  padding: 0 !important;
}
</style>
