<script setup lang="ts">
import { ref, onMounted, onActivated, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { init } from "@waline/client";
import "@waline/client/waline.css";

const { t, locale } = useI18n();

const walineEl = ref<HTMLDivElement>();
const isLoaded = ref(false);
let walineController: ReturnType<typeof init> | null = null;
let observer: MutationObserver | null = null;
let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

const WALINE_SERVER = import.meta.env.VITE_WALINE_SERVER ?? "https://waline.anibt.net/";

function markLoaded() {
  if (isLoaded.value) return;
  isLoaded.value = true;
  observer?.disconnect();
  observer = null;
  if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
}

onMounted(() => {
  if (!walineEl.value) return;

  // Pre-warm: fire API request before Waline initializes so data is in browser cache
  fetch(`${WALINE_SERVER}api/comment?path=${encodeURIComponent(location.pathname)}&pageSize=10&page=1&sortBy=insertedAt_desc`, {
    mode: "cors",
    credentials: "omit",
  }).catch(() => {});

  walineController = init({
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
    avatarCDN: "https://cravatar.cn/avatar/",
    avatar: "retro",
    imageUploader: false,
    search: false,
  });

  observer = new MutationObserver(() => {
    if (walineEl.value?.querySelector(".wl-editor-wrap, .wl-cards")) markLoaded();
  });
  observer.observe(walineEl.value, { childList: true, subtree: true });

  fallbackTimer = setTimeout(markLoaded, 3000);
});

onActivated(() => {
  walineController?.update?.({});
});

onUnmounted(() => {
  observer?.disconnect();
  if (fallbackTimer) clearTimeout(fallbackTimer);
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

    <div class="relative min-h-[420px]">
      <div
        ref="walineEl"
        class="waline-wrap rounded-2xl border border-ink-100 bg-surface shadow-[var(--shadow-sm)] overflow-hidden p-5 sm:p-6 transition-opacity duration-400"
        :class="isLoaded ? 'opacity-100' : 'opacity-0'"
      />

      <Transition
        leave-active-class="transition-opacity duration-400"
        leave-to-class="opacity-0"
      >
        <div
          v-if="!isLoaded"
          class="absolute inset-0 pointer-events-none space-y-4"
        >
          <div class="rounded-2xl border border-ink-100 bg-surface p-5 sm:p-6 space-y-3">
            <div class="grid grid-cols-2 gap-2">
              <div v-for="i in 2" :key="i" class="h-10 rounded-xl bg-sakura-50 animate-pulse" />
            </div>
            <div class="h-28 rounded-xl bg-sakura-50 animate-pulse" />
            <div class="flex justify-end">
              <div class="h-9 w-20 rounded-xl bg-sakura-100 animate-pulse" />
            </div>
          </div>
          <div v-for="i in 3" :key="i" class="flex gap-3 px-3 py-3">
            <div
              class="w-9 h-9 rounded-full bg-sakura-50 animate-pulse shrink-0"
              :style="{ animationDelay: `${i * 100}ms` }"
            />
            <div class="flex-1 space-y-2 pt-0.5">
              <div
                class="h-3 rounded-full bg-sakura-50 animate-pulse"
                :style="{ width: `${50 + i * 20}px`, animationDelay: `${i * 100}ms` }"
              />
              <div
                class="h-3 w-full rounded-full bg-sakura-50/60 animate-pulse"
                :style="{ animationDelay: `${i * 120}ms` }"
              />
              <div
                class="h-3 rounded-full bg-sakura-50/40 animate-pulse"
                :style="{ width: `${40 + i * 12}%`, animationDelay: `${i * 140}ms` }"
              />
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style>
/* ══════════════════════════════════════════════════════════════════════
   Waline Theme — Deep UI Overhaul
   Transforms Waline's default look into something that matches our
   Sakura × Digital design system with proper dark mode support.
   ══════════════════════════════════════════════════════════════════════ */

/* ── Theme Variables ─────────────────────────────────────────────── */
:root {
  --waline-font-size: 0.875rem;
  --waline-white: #fff;
  --waline-theme-color: oklch(68% 0.22 350);
  --waline-active-color: oklch(60% 0.24 350);
  --waline-color: oklch(25% 0.015 355);
  --waline-bg-color: var(--color-surface);
  --waline-bg-color-light: oklch(98% 0.008 355);
  --waline-bg-color-hover: oklch(97% 0.012 355);
  --waline-border-color: oklch(92% 0.015 355);
  --waline-disable-bg-color: oklch(96% 0.005 355);
  --waline-disable-color: oklch(60% 0.01 355);
  --waline-code-bg-color: oklch(22% 0.02 260);
  --waline-bq-color: oklch(92% 0.02 350);
  --waline-color-light: oklch(55% 0.01 355);
  --waline-info-bg-color: oklch(97% 0.008 355);
  --waline-info-color: oklch(55% 0.01 355);
  --waline-info-font-size: 0.625em;
  --waline-badge-color: oklch(68% 0.18 350);
  --waline-badge-font-size: 0.65em;
  --waline-avatar-size: 2.25rem;
  --waline-m-avatar-size: 1.75rem;
  --waline-avatar-radius: 50%;
  --waline-border: 1px solid var(--waline-border-color);
  --waline-border-radius: 0.75rem;
  --waline-box-shadow: none;
  --waline-dark-grey: oklch(45% 0.01 355);
  --waline-light-grey: oklch(60% 0.01 355);
  --waline-warning-color: oklch(55% 0.12 60);
  --waline-warning-bg-color: oklch(95% 0.04 75 / 0.5);
}

/* ── Dark mode variable overrides ───────────────────────────────── */
.dark {
  --waline-white: oklch(18% 0.008 355);
  --waline-color: oklch(88% 0.008 355);
  --waline-bg-color: var(--color-surface);
  --waline-bg-color-light: oklch(22% 0.01 355);
  --waline-bg-color-hover: oklch(25% 0.012 355);
  --waline-border-color: oklch(28% 0.01 355);
  --waline-disable-bg-color: oklch(22% 0.005 355);
  --waline-disable-color: oklch(45% 0.01 355);
  --waline-code-bg-color: oklch(16% 0.015 260);
  --waline-bq-color: oklch(25% 0.01 355);
  --waline-color-light: oklch(55% 0.01 355);
  --waline-info-bg-color: oklch(22% 0.008 355);
  --waline-info-color: oklch(50% 0.01 355);
  --waline-badge-color: oklch(72% 0.16 350);
  --waline-dark-grey: oklch(60% 0.01 355);
  --waline-light-grey: oklch(48% 0.01 355);
  --waline-warning-color: oklch(70% 0.10 60);
  --waline-warning-bg-color: oklch(25% 0.04 75 / 0.5);
}

/* ── Global Waline overrides ─────────────────────────────────────── */
[data-waline] {
  font-family: var(--font-body) !important;
}

[data-waline] * {
  box-sizing: border-box !important;
}

/* ── Panel (comment form) ─────────────────────────────────────────── */
.waline-wrap .wl-panel {
  box-shadow: none !important;
  border: none !important;
  border-radius: 0 !important;
  padding: 0 !important;
  margin: 0 !important;
  background: transparent !important;
}

/* Meta input header — remove dashed border, clean grid layout */
.waline-wrap .wl-header {
  display: grid !important;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)) !important;
  gap: 0.5rem !important;
  padding: 0 !important;
  border: none !important;
  border-radius: 0 !important;
  margin-bottom: 0.75rem !important;
}

.waline-wrap .wl-header-item {
  display: flex !important;
  align-items: center !important;
  padding: 0 !important;
  border: none !important;
  border-radius: 0.75rem !important;
  background: var(--waline-bg-color-light) !important;
  transition: background 0.15s ease, box-shadow 0.15s ease !important;
}

.waline-wrap .wl-header-item:focus-within {
  background: var(--waline-bg-color) !important;
  box-shadow: 0 0 0 2px oklch(68% 0.22 350 / 0.2) !important;
}

.waline-wrap .wl-header label {
  padding: 0.5rem 0 0.5rem 0.75rem !important;
  font-size: 0.75rem !important;
  font-weight: 500 !important;
  color: var(--waline-color-light) !important;
  min-width: auto !important;
  white-space: nowrap !important;
}

.waline-wrap .wl-header input {
  flex: 1 !important;
  padding: 0.5rem 0.75rem 0.5rem 0.35rem !important;
  font-size: 0.8125rem !important;
  border: none !important;
  background: transparent !important;
  color: var(--waline-color) !important;
  outline: none !important;
}

/* ── Editor textarea ──────────────────────────────────────────────── */
.waline-wrap .wl-editor {
  min-height: 7rem !important;
  margin: 0 !important;
  padding: 0.75rem 1rem !important;
  border-radius: 0.75rem !important;
  background: var(--waline-bg-color-light) !important;
  font-size: 0.8125rem !important;
  line-height: 1.65 !important;
  transition: background 0.15s ease, box-shadow 0.15s ease !important;
  width: 100% !important;
  box-sizing: border-box !important;
}

.waline-wrap .wl-editor:focus,
.waline-wrap .wl-editor:focus-within {
  background: var(--waline-bg-color) !important;
  box-shadow: 0 0 0 2px oklch(68% 0.22 350 / 0.2) !important;
}

/* ── Footer (toolbar + submit) ────────────────────────────────────── */
.waline-wrap .wl-footer {
  margin: 0.75rem 0 0 !important;
  padding: 0 !important;
  gap: 0.5rem !important;
}

/* Toolbar action icons */
.waline-wrap .wl-action {
  width: 1.75rem !important;
  height: 1.75rem !important;
  border-radius: 0.5rem !important;
  font-size: 0.875rem !important;
  color: var(--waline-color-light) !important;
  transition: all 0.15s ease !important;
}
.waline-wrap .wl-action:hover {
  color: var(--waline-theme-color) !important;
  background: oklch(68% 0.22 350 / 0.08) !important;
}

/* ── Buttons ──────────────────────────────────────────────────────── */
.waline-wrap .wl-btn {
  border-radius: 0.625rem !important;
  font-size: 0.75rem !important;
  font-weight: 500 !important;
  padding: 0.45rem 1rem !important;
  transition: all 0.2s var(--ease-out-quart) !important;
  letter-spacing: 0.01em !important;
}

.waline-wrap .wl-btn.primary {
  border-color: oklch(65% 0.20 347) !important;
  background: linear-gradient(135deg, oklch(72% 0.175 347), oklch(63% 0.210 345)) !important;
  color: white !important;
  box-shadow: 0 1px 3px oklch(63% 0.21 345 / 0.25) !important;
}
.waline-wrap .wl-btn.primary:hover {
  border-color: oklch(60% 0.22 345) !important;
  background: linear-gradient(135deg, oklch(68% 0.19 347), oklch(58% 0.22 345)) !important;
  box-shadow: 0 2px 8px oklch(63% 0.21 345 / 0.35) !important;
  transform: translateY(-1px) !important;
}
.waline-wrap .wl-btn.primary:active {
  transform: translateY(0) !important;
  box-shadow: 0 1px 2px oklch(63% 0.21 345 / 0.2) !important;
}

/* ── Comment count & sort tabs ────────────────────────────────────── */
.waline-wrap .wl-count {
  font-size: 0.8125rem !important;
  font-weight: 600 !important;
  color: var(--waline-color) !important;
}

.waline-wrap .wl-sort li {
  border-radius: 0.5rem !important;
  padding: 0.25rem 0.625rem !important;
  font-size: 0.75rem !important;
  transition: all 0.15s ease !important;
}
.waline-wrap .wl-sort .active {
  background: oklch(68% 0.22 350 / 0.1) !important;
  color: var(--waline-theme-color) !important;
}

/* ── Comment cards ────────────────────────────────────────────────── */
.waline-wrap .wl-cards {
  padding-top: 0.25rem !important;
}

.waline-wrap .wl-cards > .wl-item {
  padding: 1rem 0.75rem !important;
  border-radius: 0.75rem !important;
  transition: background 0.15s ease !important;
  margin: 0 !important;
}
.waline-wrap .wl-cards > .wl-item:hover {
  background: var(--waline-bg-color-hover) !important;
}

/* Separator between top-level comments */
.waline-wrap .wl-cards > .wl-item + .wl-item {
  border-top: 1px solid var(--waline-border-color) !important;
  border-radius: 0 !important;
}
.waline-wrap .wl-cards > .wl-item:last-child {
  border-bottom-left-radius: 0.75rem !important;
  border-bottom-right-radius: 0.75rem !important;
}
.waline-wrap .wl-cards > .wl-item:first-child {
  border-top-left-radius: 0.75rem !important;
  border-top-right-radius: 0.75rem !important;
}

/* ── Avatars ──────────────────────────────────────────────────────── */
.waline-wrap .wl-avatar,
.waline-wrap .wl-user .wl-avatar {
  border: none !important;
  box-shadow: 0 0 0 2px oklch(92% 0.015 355), 0 1px 3px oklch(0% 0 0 / 0.06) !important;
}
.dark .waline-wrap .wl-avatar,
.dark .waline-wrap .wl-user .wl-avatar {
  box-shadow: 0 0 0 2px oklch(28% 0.01 355), 0 1px 3px oklch(0% 0 0 / 0.2) !important;
}

.waline-wrap .wl-user img {
  transition: transform 0.2s var(--ease-out-quart) !important;
}
.waline-wrap .wl-user img:hover {
  transform: scale(1.1) !important;
}

/* ── Comment head (nick, badge, time) ─────────────────────────────── */
.waline-wrap .wl-nick {
  font-weight: 600 !important;
  font-size: 0.8125rem !important;
  color: var(--waline-color) !important;
}

.waline-wrap .wl-badge {
  border-radius: 0.375rem !important;
  padding: 0.1em 0.4em !important;
  font-size: 0.625rem !important;
  font-weight: 600 !important;
  letter-spacing: 0.02em !important;
}

.waline-wrap .wl-time {
  font-size: 0.6875rem !important;
  color: var(--waline-color-light) !important;
}

/* ── Comment content ──────────────────────────────────────────────── */
.waline-wrap .wl-content {
  font-size: 0.8125rem !important;
  line-height: 1.7 !important;
  color: var(--waline-color) !important;
}

.waline-wrap .wl-content p {
  margin: 0.35em 0 !important;
}

/* ── Reply @mention alignment ─────────────────────────────────────── */
.waline-wrap .wl-card .wl-content .wl-reply-to {
  float: left !important;
  margin: 0 0.4em 0 0 !important;
  line-height: 2 !important;
}
.waline-wrap .wl-card .wl-content .wl-reply-to + div > p:first-child,
.waline-wrap .wl-card .wl-content .wl-reply-to + p:first-of-type {
  margin-top: 0 !important;
}

/* Reply @tag pill style */
.waline-wrap .wl-reply-to a {
  background: oklch(68% 0.22 350 / 0.08) !important;
  padding: 0.1em 0.45em !important;
  border-radius: 0.375rem !important;
  font-size: 0.75rem !important;
  font-weight: 500 !important;
}
.dark .waline-wrap .wl-reply-to a {
  background: oklch(68% 0.22 350 / 0.15) !important;
}

/* ── Comment action buttons (reply, like) ─────────────────────────── */
.waline-wrap .wl-comment-actions button {
  font-size: 0.6875rem !important;
  padding: 0.15rem 0.4rem !important;
  border-radius: 0.375rem !important;
  transition: all 0.15s ease !important;
  color: var(--waline-color-light) !important;
}
.waline-wrap .wl-comment-actions button:hover {
  color: var(--waline-theme-color) !important;
  background: oklch(68% 0.22 350 / 0.06) !important;
}

/* Like button active state */
.waline-wrap .wl-like.active {
  color: oklch(60% 0.20 15) !important;
}

/* ── Nested replies ───────────────────────────────────────────────── */
.waline-wrap .wl-quote {
  border-inline-start: 2px solid var(--waline-border-color) !important;
  padding-inline-start: 0.75rem !important;
  margin: 0.5rem 0 0 !important;
}

.waline-wrap .wl-quote .wl-item {
  padding: 0.5rem 0 !important;
}

/* ── Inline reply editor ──────────────────────────────────────────── */
.waline-wrap .wl-comment .wl-panel {
  border-radius: 0.75rem !important;
  border: 1px solid var(--waline-border-color) !important;
  background: var(--waline-bg-color-light) !important;
  padding: 0.75rem !important;
  margin: 0.75rem 0 0 !important;
}

/* ── Empty state ──────────────────────────────────────────────────── */
.waline-wrap .wl-empty {
  padding: 2.5rem 1rem !important;
  font-size: 0.8125rem !important;
  color: var(--waline-color-light) !important;
  text-align: center !important;
}

/* ── Loading spinner ──────────────────────────────────────────────── */
.waline-wrap .wl-loading {
  padding: 2rem 0 !important;
}
.waline-wrap .wl-loading svg circle {
  stroke: var(--waline-theme-color) !important;
}

/* ── "Powered by Waline" ──────────────────────────────────────────── */
.waline-wrap .wl-power {
  font-size: 0.625rem !important;
  opacity: 0.35 !important;
  margin-top: 1.5rem !important;
  transition: opacity 0.2s !important;
}
.waline-wrap .wl-power:hover {
  opacity: 0.65 !important;
}

/* ── Preview area ─────────────────────────────────────────────────── */
.waline-wrap .wl-preview {
  border-top: 1px dashed var(--waline-border-color) !important;
  margin: 0.5rem 0 0 !important;
  padding: 0.75rem 0 0 !important;
}
.waline-wrap .wl-preview h4 {
  font-size: 0.75rem !important;
  font-weight: 600 !important;
  color: var(--waline-color-light) !important;
  text-transform: uppercase !important;
  letter-spacing: 0.05em !important;
}

/* ── Pagination ───────────────────────────────────────────────────── */
.waline-wrap .wl-operation {
  padding: 1rem 0 0.5rem !important;
}
.waline-wrap .wl-operation button {
  border-radius: 0.625rem !important;
  font-size: 0.75rem !important;
  font-weight: 500 !important;
  transition: all 0.2s var(--ease-out-quart) !important;
}

/* ── Blockquote ───────────────────────────────────────────────────── */
[data-waline] blockquote {
  border-inline-start: 3px solid oklch(68% 0.22 350 / 0.3) !important;
  background: oklch(68% 0.22 350 / 0.03) !important;
  border-radius: 0 0.5rem 0.5rem 0 !important;
  padding: 0.5rem 0.75rem !important;
}

/* ── Code blocks ──────────────────────────────────────────────────── */
[data-waline] code {
  border-radius: 0.375rem !important;
  font-size: 0.8em !important;
  padding: 0.15em 0.35em !important;
}

/* ── Smooth transitions for Waline status changes ─────────────────── */
.waline-wrap .wl-comment-status {
  transition: opacity 0.2s ease !important;
}
</style>
