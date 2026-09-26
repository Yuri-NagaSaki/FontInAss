<script setup lang="ts">
import { ref, onMounted, onActivated, onUnmounted, watch, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { Loader2, MessageCircleHeart, RefreshCw } from "lucide-vue-next";
import { preloadWalineAssets, WALINE_SERVER } from "../lib/waline-loader";

const { t, locale } = useI18n();

const walineEl = ref<HTMLDivElement>();
const isLoaded = ref(false);
const loadError = ref(false);
let walineController: {
  update?: (opts: Record<string, unknown>) => void;
  destroy?: () => void;
} | null = null;
let renderObserver: MutationObserver | null = null;
let loadFallbackTimer: number | null = null;

function clearLoadTimers() {
  renderObserver?.disconnect();
  renderObserver = null;
  if (loadFallbackTimer !== null) {
    window.clearTimeout(loadFallbackTimer);
    loadFallbackTimer = null;
  }
}

function markLoaded() {
  if (isLoaded.value) return;
  isLoaded.value = true;
  clearLoadTimers();
}

function waitForWalineRender(root: HTMLElement) {
  clearLoadTimers();

  const ready = () =>
    Boolean(root.querySelector(".wl-editor, .wl-cards, .wl-empty, .wl-panel"));

  if (ready()) {
    markLoaded();
    return;
  }

  renderObserver = new MutationObserver(() => {
    if (ready()) markLoaded();
  });
  renderObserver.observe(root, { childList: true, subtree: true });
  loadFallbackTimer = window.setTimeout(markLoaded, 4500);
}

async function initWaline() {
  if (!walineEl.value) return;
  loadError.value = false;
  isLoaded.value = false;
  clearLoadTimers();

  try {
    const walineModule = await preloadWalineAssets();
    walineController?.destroy?.();
    await nextTick();

    if (!walineEl.value) return;

    walineController = walineModule.init({
      el: walineEl.value,
      serverURL: WALINE_SERVER,
      lang: locale.value === "zh-CN" ? "zh-CN" : "en",
      emoji: false,
      meta: ["nick", "mail"],
      requiredMeta: ["nick"],
      pageSize: 10,
      dark: "html.dark",
      comment: true,
      reaction: false,
      imageUploader: false,
      search: false,
    });

    waitForWalineRender(walineEl.value);
  } catch {
    loadError.value = true;
    markLoaded();
  }
}

onMounted(initWaline);

watch(locale, (lang) => {
  walineController?.update?.({ lang: lang === "zh-CN" ? "zh-CN" : "en" });
});

onActivated(() => {
  walineController?.update?.({});
});

onUnmounted(() => {
  clearLoadTimers();
  walineController?.destroy?.();
  walineController = null;
});
</script>

<template>
  <div class="comments-page mx-auto max-w-4xl">
    <header class="page-heading">
      <h1>{{ t("comments") }}</h1>
      <p>{{ t("commentsDesc") }}</p>
    </header>
    <div class="page-note mb-6">{{ t("community.discussionNote") }}</div>
    <div class="relative min-h-[320px]">
      <div v-if="!isLoaded" class="comments-loading" role="status">
        <Loader2 class="h-5 w-5 animate-spin-slow" /><span>{{
          t("commentsLoading")
        }}</span>
      </div>
      <div v-else-if="loadError" class="comments-loading" role="alert">
        <MessageCircleHeart class="h-6 w-6" />
        <p>{{ t("commentsLoadError") }}</p>
        <button type="button" class="button" @click="initWaline">
          <RefreshCw class="h-4 w-4" />{{ t("retry") }}
        </button>
      </div>
      <div
        ref="walineEl"
        class="comments-waline"
        :class="!isLoaded || loadError ? 'invisible' : ''"
      />
    </div>
  </div>
</template>

<style>
.comments-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  border-radius: 12px;
  background: var(--deep);
  color: var(--ink2);
}
.comments-waline {
  --waline-font-size: 15px;
  --waline-theme-color: var(--accent);
  --waline-active-color: var(--accent);
  --waline-color: var(--ink);
  --waline-bg-color: var(--paper);
  --waline-bg-color-light: var(--deep);
  --waline-bg-color-hover: var(--deep2);
  --waline-border-color: var(--line2);
  --waline-disable-bg-color: var(--deep);
  --waline-disable-color: var(--ink3);
  --waline-info-bg-color: var(--deep);
  --waline-info-color: var(--ink2);
  --waline-badge-color: var(--accent);
  --waline-border: 0;
  --waline-box-shadow: none;
  font-family: var(--font-body);
}
.comments-waline .wl-panel {
  border-radius: 12px;
  background: var(--deep);
  border: 0;
  padding: 12px;
}
.comments-waline .wl-header {
  gap: 8px;
  border: 0;
}
.comments-waline .wl-header-item {
  border-radius: 8px;
  background: var(--paper);
  margin-bottom: 8px;
}
.comments-waline .wl-input {
  color: var(--ink);
}
.comments-waline .wl-editor {
  padding: 16px;
  min-height: 140px;
}
.comments-waline .wl-btn {
  border: 0;
  border-radius: 999px;
  background: var(--deep2);
  color: var(--ink2);
  min-height: 34px;
}
.comments-waline .wl-btn.primary {
  background: var(--accent);
  color: var(--accent-ink);
}
.comments-waline .wl-card {
  border-bottom: 2px solid var(--line);
  padding-block: 20px;
}
.comments-waline .wl-card .wl-nick {
  font-weight: 700;
  color: var(--ink);
}
.comments-waline .wl-content {
  line-height: 1.8;
  color: var(--ink2);
  overflow-wrap: anywhere;
}
.comments-waline .wl-content pre {
  overflow-x: auto;
}
.comments-waline .wl-meta > span {
  border: 0;
  border-radius: 999px;
  padding: 3px 8px;
}
.comments-waline .wl-power {
  font-size: 12px;
  color: var(--ink3);
}
.comments-waline a {
  color: var(--accent);
}
.comments-waline .wl-sort,
.comments-waline .wl-count {
  font-family: var(--font-display);
}
.comments-waline .wl-quote {
  border: 0;
  padding-left: 16px;
}
@media (max-width: 600px) {
  .comments-waline .wl-header {
    flex-direction: column;
  }
  .comments-waline .wl-header-item {
    width: 100%;
  }
}
</style>
