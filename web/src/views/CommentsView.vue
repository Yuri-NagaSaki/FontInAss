<script setup lang="ts">
import { ref, onMounted, onActivated, onUnmounted, watch, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { Loader2, MessageCircleHeart, RefreshCw } from "lucide-vue-next";
import { preloadWalineAssets, WALINE_SERVER } from "../lib/waline-loader";

const { t, locale } = useI18n();

const walineEl = ref<HTMLDivElement>();
const isLoaded = ref(false);
const loadError = ref(false);
let walineController: { update?: (opts: Record<string, unknown>) => void; destroy?: () => void } | null = null;
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
  <div class="comments-page mx-auto max-w-3xl animate-fade-in">
    <header class="mb-6">
      <h1 class="font-display text-2xl font-bold tracking-tight text-ink-900 sm:text-[1.75rem]">
        {{ t("comments") }}
      </h1>
      <p class="mt-1.5 text-[0.95rem] leading-relaxed text-ink-500">
        {{ t("commentsDesc") }}
      </p>
    </header>

    <div class="card relative overflow-hidden">
      <!-- Loading: sakura skeleton of the composer -->
      <div
        v-if="!isLoaded"
        class="comments-loading absolute inset-0 z-10 px-4 py-4 sm:px-5 sm:py-5"
        aria-busy="true"
        aria-live="polite"
      >
        <div class="comments-skeleton-panel">
          <div class="flex gap-3 border-b border-sakura-100/80 px-3.5 py-3">
            <div class="comments-skeleton-bar h-3.5 w-16" />
            <div class="comments-skeleton-bar h-3.5 flex-1" />
            <div class="comments-skeleton-bar h-3.5 w-14" />
            <div class="comments-skeleton-bar h-3.5 flex-1" />
          </div>
          <div class="space-y-2.5 px-3.5 py-4">
            <div class="comments-skeleton-bar h-3 w-[88%]" />
            <div class="comments-skeleton-bar h-3 w-[72%]" />
            <div class="comments-skeleton-bar h-3 w-[48%]" />
          </div>
          <div class="flex items-center justify-between border-t border-sakura-100/80 px-3.5 py-2.5">
            <div class="flex gap-2">
              <div class="comments-skeleton-bar comments-skeleton-icon" />
              <div class="comments-skeleton-bar comments-skeleton-icon" />
            </div>
            <div class="comments-skeleton-bar comments-skeleton-btn" />
          </div>
        </div>

        <div class="mt-6 flex flex-col items-center gap-2.5 py-4">
          <div class="flex h-10 w-10 items-center justify-center rounded-2xl bg-sakura-100 text-sakura-500">
            <MessageCircleHeart class="h-5 w-5" />
          </div>
          <div class="flex items-center gap-2 text-sm font-medium text-sakura-600">
            <Loader2 class="h-3.5 w-3.5 animate-spin-slow" />
            <span>{{ t("commentsLoading") }}</span>
          </div>
        </div>
      </div>

      <!-- Error overlay -->
      <div
        v-else-if="loadError"
        class="absolute inset-0 z-10 flex min-h-[280px] flex-col items-center justify-center gap-3 bg-surface px-6 py-16 text-center"
      >
        <div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-50 text-rose-500">
          <MessageCircleHeart class="h-5 w-5" />
        </div>
        <p class="text-sm text-ink-500">{{ t("commentsLoadError") }}</p>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-lg border border-sakura-200 bg-sakura-50 px-3 py-1.5 text-sm font-medium text-sakura-600 transition-colors hover:bg-sakura-100"
          @click="initWaline"
        >
          <RefreshCw class="h-3.5 w-3.5" />
          {{ t("retry") }}
        </button>
      </div>

      <!-- Waline mount (always in DOM for init / retry) -->
      <div
        ref="walineEl"
        class="comments-waline min-h-[280px] px-4 py-4 sm:px-5 sm:py-5 transition-opacity duration-300"
        :class="!isLoaded || loadError ? 'opacity-0 pointer-events-none' : 'opacity-100 animate-fade-in-fast'"
      />
    </div>
  </div>
</template>

<style>
/* ─── Loading skeleton ──────────────────────────────────────────────────── */

.comments-loading {
  background:
    radial-gradient(ellipse 80% 50% at 50% 0%, color-mix(in oklch, var(--color-sakura-100) 55%, transparent), transparent 70%),
    var(--color-surface);
}

.comments-skeleton-panel {
  border: 1px solid color-mix(in oklch, var(--color-sakura-200) 80%, transparent);
  border-radius: 0.95rem;
  background:
    linear-gradient(
      165deg,
      color-mix(in oklch, var(--color-sakura-50) 90%, white),
      var(--color-surface) 55%
    );
  box-shadow: 0 1px 0 color-mix(in oklch, var(--color-sakura-100) 70%, transparent);
  overflow: hidden;
  min-height: 11.5rem;
}

.comments-skeleton-bar {
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    color-mix(in oklch, var(--color-sakura-100) 80%, transparent) 0%,
    color-mix(in oklch, var(--color-sakura-200) 55%, transparent) 45%,
    color-mix(in oklch, var(--color-sakura-100) 80%, transparent) 100%
  );
  background-size: 200% 100%;
  animation: comments-shimmer 1.35s ease-in-out infinite;
}

.comments-skeleton-icon {
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 0.4rem;
}

.comments-skeleton-btn {
  width: 4rem;
  height: 1.75rem;
  border-radius: 0.55rem;
}

@keyframes comments-shimmer {
  0% { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}

.dark .comments-skeleton-panel {
  background:
    linear-gradient(
      165deg,
      color-mix(in oklch, var(--color-sakura-100) 70%, var(--color-surface)),
      var(--color-surface) 60%
    );
  border-color: var(--color-sakura-200);
}

/* ─── Waline theme tokens — warm sakura, not gray ───────────────────────── */

:root {
  --waline-font-size: 0.9rem;
  --waline-white: oklch(99% 0.004 355);
  --waline-theme-color: var(--color-sakura-500);
  --waline-active-color: var(--color-sakura-600);
  --waline-color: var(--color-ink-800);
  --waline-bg-color: color-mix(in oklch, var(--color-sakura-50) 65%, white);
  --waline-bg-color-light: var(--color-sakura-50);
  --waline-bg-color-hover: var(--color-sakura-100);
  --waline-border-color: color-mix(in oklch, var(--color-sakura-200) 85%, var(--color-sakura-100));
  --waline-disable-bg-color: var(--color-sakura-50);
  --waline-disable-color: var(--color-ink-400);
  --waline-code-bg-color: oklch(24% 0.02 260);
  --waline-bq-color: var(--color-sakura-200);
  --waline-info-bg-color: color-mix(in oklch, var(--color-sakura-50) 80%, white);
  --waline-info-color: var(--color-ink-500);
  --waline-badge-color: var(--color-sakura-500);
  --waline-avatar-size: 2.5rem;
  --waline-m-avatar-size: 2rem;
  --waline-avatar-radius: 999px;
  --waline-border: 1px solid var(--waline-border-color);
  --waline-border-radius: 0.95rem;
  --waline-box-shadow: 0 1px 0 color-mix(in oklch, var(--color-sakura-200) 35%, transparent);
  --waline-dark-grey: var(--color-ink-600);
  --waline-light-grey: var(--color-ink-500);
}

.dark {
  --waline-white: oklch(96% 0.01 355);
  --waline-color: var(--color-ink-800);
  --waline-bg-color: color-mix(in oklch, var(--color-sakura-50) 55%, var(--color-surface));
  --waline-bg-color-light: color-mix(in oklch, var(--color-sakura-100) 65%, var(--color-surface));
  --waline-bg-color-hover: var(--color-sakura-100);
  --waline-border-color: color-mix(in oklch, var(--color-sakura-200) 75%, transparent);
  --waline-disable-bg-color: var(--color-sakura-50);
  --waline-disable-color: var(--color-ink-400);
  --waline-code-bg-color: oklch(16% 0.015 260);
  --waline-bq-color: var(--color-sakura-200);
  --waline-info-bg-color: var(--color-sakura-50);
  --waline-info-color: var(--color-ink-400);
  --waline-badge-color: var(--color-sakura-400);
  --waline-dark-grey: var(--color-ink-600);
  --waline-light-grey: var(--color-ink-400);
  --waline-box-shadow: none;
}

/* ─── Layout ────────────────────────────────────────────────────────────── */

.comments-waline [data-waline] {
  font-family: var(--font-body);
}

/* Composer — soft sakura stationery panel */
.comments-waline .wl-panel {
  margin: 0 0 0.25rem;
  border: 1px solid var(--waline-border-color);
  border-radius: var(--waline-border-radius);
  background:
    linear-gradient(
      165deg,
      color-mix(in oklch, var(--color-sakura-50) 92%, white) 0%,
      var(--color-surface) 58%
    );
  box-shadow:
    0 1px 0 color-mix(in oklch, var(--color-sakura-100) 80%, transparent),
    var(--shadow-sm);
  overflow: hidden;
}

.dark .comments-waline .wl-panel {
  background:
    linear-gradient(
      165deg,
      color-mix(in oklch, var(--color-sakura-100) 55%, var(--color-surface)) 0%,
      var(--color-surface) 62%
    );
  box-shadow: none;
}

.comments-waline .wl-header {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  padding: 0;
  border-bottom: 1px solid var(--waline-border-color);
  border-top-left-radius: var(--waline-border-radius);
  border-top-right-radius: var(--waline-border-radius);
  background: color-mix(in oklch, var(--color-sakura-50) 70%, transparent);
  overflow: hidden;
}

.dark .comments-waline .wl-header {
  background: color-mix(in oklch, var(--color-sakura-100) 40%, transparent);
}

.comments-waline .wl-header-item {
  flex: 1;
  min-width: 0;
  border-right: 1px solid var(--waline-border-color);
}

.comments-waline .wl-header-item:last-child {
  border-right: none;
}

.comments-waline .wl-header label {
  min-width: auto;
  padding: 0.7rem 0.2rem 0.7rem 0.85rem;
  color: var(--color-sakura-600);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  white-space: nowrap;
}

.dark .comments-waline .wl-header label {
  color: var(--color-sakura-400);
}

.comments-waline .wl-header input {
  flex: 1;
  min-width: 0;
  width: auto;
  padding: 0.65rem 0.85rem 0.65rem 0.35rem;
  font-size: 0.85rem;
  color: var(--waline-color);
  background: transparent;
}

.comments-waline .wl-header input::placeholder {
  color: color-mix(in oklch, var(--color-sakura-400) 55%, var(--color-ink-400));
}

.comments-waline .wl-editor {
  width: 100%;
  min-height: 7.5rem;
  margin: 0;
  padding: 0.9rem 1rem;
  border-radius: 0;
  font-size: 0.9rem;
  line-height: 1.7;
  color: var(--waline-color);
  background: color-mix(in oklch, var(--color-surface) 88%, var(--color-sakura-50));
  box-sizing: border-box;
  transition: background 0.18s ease, box-shadow 0.18s ease;
}

.comments-waline .wl-editor::placeholder {
  color: color-mix(in oklch, var(--color-sakura-400) 45%, var(--color-ink-400));
}

.comments-waline .wl-editor:focus {
  background: color-mix(in oklch, var(--color-sakura-50) 55%, var(--color-surface));
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-sakura-300) 45%, transparent);
}

.comments-waline .wl-footer {
  margin: 0;
  padding: 0.55rem 0.75rem 0.65rem;
  border-top: 1px solid var(--waline-border-color);
  gap: 0.35rem;
  background: color-mix(in oklch, var(--color-sakura-50) 55%, transparent);
}

.dark .comments-waline .wl-footer {
  background: color-mix(in oklch, var(--color-sakura-100) 30%, transparent);
}

.comments-waline .wl-action {
  color: var(--color-sakura-400);
  border-radius: 0.5rem;
  transition: color 0.15s, background 0.15s;
}

.comments-waline .wl-action:hover {
  color: var(--color-sakura-600);
  background: color-mix(in oklch, var(--color-sakura-100) 80%, transparent);
}

.comments-waline .wl-btn {
  border-radius: 0.65rem;
  font-size: 0.78rem;
  font-weight: 600;
  padding: 0.45rem 0.95rem;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s;
}

.comments-waline .wl-btn.primary {
  border-color: var(--waline-theme-color);
  background: linear-gradient(
    145deg,
    var(--color-sakura-400),
    var(--color-sakura-500) 55%,
    var(--color-sakura-600)
  );
  color: oklch(99% 0.004 355);
  box-shadow: 0 1px 3px color-mix(in oklch, var(--color-sakura-500) 30%, transparent);
}

.comments-waline .wl-btn.primary:hover {
  border-color: var(--waline-active-color);
  background: linear-gradient(
    145deg,
    var(--color-sakura-500),
    var(--color-sakura-600)
  );
  box-shadow: 0 2px 8px color-mix(in oklch, var(--color-sakura-500) 35%, transparent);
}

/* Meta / sort bar */
.comments-waline .wl-meta-head {
  padding: 1rem 0 0.35rem;
  border-top: 1px solid color-mix(in oklch, var(--color-sakura-100) 90%, transparent);
  margin-top: 0.85rem;
}

.comments-waline .wl-count {
  font-family: var(--font-display);
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--waline-color);
}

.comments-waline .wl-sort li {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--color-ink-500);
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  transition: color 0.15s, background 0.15s;
}

.comments-waline .wl-sort li:hover {
  color: var(--color-sakura-600);
  background: color-mix(in oklch, var(--color-sakura-50) 80%, transparent);
}

.comments-waline .wl-sort li.active {
  color: var(--waline-theme-color);
  background: color-mix(in oklch, var(--waline-theme-color) 12%, transparent);
  font-weight: 600;
}

/* Comment cards */
.comments-waline .wl-cards {
  margin: 0;
  padding: 0;
}

.comments-waline .wl-card-item {
  padding: 0.85rem 0;
}

.comments-waline .wl-card {
  margin-inline-start: 0;
  padding-bottom: 0.85rem;
  border-bottom: 1px solid color-mix(in oklch, var(--color-sakura-100) 85%, transparent);
}

.comments-waline .wl-card-item:last-child > .wl-card {
  border-bottom: none;
  padding-bottom: 0;
}

.comments-waline .wl-cards .wl-user {
  margin-inline-end: 0.7rem;
}

.comments-waline .wl-cards .wl-user .wl-user-avatar,
.comments-waline .wl-avatar {
  border: 1.5px solid color-mix(in oklch, var(--color-sakura-200) 70%, transparent);
  box-shadow: 0 0 0 2px color-mix(in oklch, var(--color-sakura-50) 80%, transparent);
}

.comments-waline .wl-nick {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 0.88rem;
  color: var(--waline-color);
}

.comments-waline .wl-badge {
  border-radius: 999px;
  padding: 0.08em 0.45em;
  font-weight: 600;
  font-size: 0.65em;
}

.comments-waline .wl-time {
  font-size: 0.72rem;
  color: var(--color-ink-400);
}

.comments-waline .wl-content {
  font-size: 0.88rem;
  line-height: 1.7;
  color: var(--waline-color);
  padding-top: 0.4rem;
  margin-bottom: 0.4rem;
}

.comments-waline .wl-content p {
  margin: 0.35em 0;
}

.comments-waline .wl-reply-to a {
  background: color-mix(in oklch, var(--waline-theme-color) 12%, transparent);
  color: var(--waline-theme-color);
  padding: 0.1em 0.45em;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
}

.comments-waline .wl-comment-actions button {
  font-size: 0.72rem;
  color: var(--color-ink-400);
  padding: 0.15rem 0.3rem;
  border-radius: 0.4rem;
  transition: color 0.15s, background 0.15s;
}

.comments-waline .wl-comment-actions button:hover {
  color: var(--waline-theme-color);
  background: color-mix(in oklch, var(--color-sakura-50) 90%, transparent);
}

.comments-waline .wl-like.active {
  color: var(--color-rose-500);
}

/* Nested replies */
.comments-waline .wl-quote {
  margin-top: 0.5rem;
  border-inline-start: 2px solid color-mix(in oklch, var(--color-sakura-200) 80%, transparent);
  padding-inline-start: 0.65rem;
}

.comments-waline .wl-quote .wl-card {
  border-bottom-color: transparent;
}

/* Inline reply composer */
.comments-waline .wl-comment .wl-panel {
  margin: 0.65rem 0 0;
  background:
    linear-gradient(
      165deg,
      color-mix(in oklch, var(--color-sakura-50) 85%, transparent),
      var(--color-surface)
    );
}

/* Empty / loading / power */
.comments-waline .wl-empty {
  padding: 2rem 1rem;
  font-size: 0.88rem;
  color: var(--color-ink-400);
}

.comments-waline .wl-loading svg circle {
  stroke: var(--waline-theme-color);
}

.comments-waline .wl-power {
  font-size: 0.65rem;
  opacity: 0.4;
  margin-top: 0.75rem;
  padding-bottom: 0;
}

.comments-waline .wl-power:hover {
  opacity: 0.7;
}

.comments-waline .wl-operation {
  padding: 0.75rem 0 0.25rem;
}

.comments-waline .wl-operation button {
  border-radius: 0.65rem;
  font-size: 0.78rem;
  font-weight: 600;
  border-color: var(--waline-border-color);
  color: var(--color-sakura-600);
}

.comments-waline .wl-operation button:hover {
  border-color: var(--color-sakura-300);
  background: var(--color-sakura-50);
  color: var(--color-sakura-600);
}

/* Content extras */
.comments-waline blockquote {
  border-inline-start: 3px solid color-mix(in oklch, var(--waline-theme-color) 40%, transparent);
  background: color-mix(in oklch, var(--waline-theme-color) 6%, transparent);
  border-radius: 0 0.5rem 0.5rem 0;
  padding: 0.45rem 0.75rem;
  margin: 0.4rem 0;
}

.comments-waline code {
  border-radius: 0.35rem;
  font-size: 0.84em;
  padding: 0.12em 0.35em;
  background: color-mix(in oklch, var(--color-sakura-50) 80%, transparent);
}

@media (max-width: 580px) {
  .comments-waline .wl-header {
    grid-template-columns: 1fr;
  }

  .comments-waline .wl-header-item {
    border-right: none;
    border-bottom: 1px solid var(--waline-border-color);
  }

  .comments-waline .wl-header-item:last-child {
    border-bottom: none;
  }
}
</style>
