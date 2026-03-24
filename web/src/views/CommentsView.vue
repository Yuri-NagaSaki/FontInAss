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

const WALINE_SERVER = "https://waline.anibt.net/";

function markLoaded() {
  if (isLoaded.value) return;
  isLoaded.value = true;
  observer?.disconnect();
  observer = null;
  if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
}

onMounted(() => {
  if (!walineEl.value) return;
  walineController = init({
    el: walineEl.value,
    serverURL: WALINE_SERVER,
    lang: locale.value === "zh-CN" ? "zh-CN" : "en",
    // Single emoji pack — bilibili pack removed to save one CDN round-trip
    emoji: ["https://unpkg.com/@waline/emojis@1.2.0/weibo"],
    meta: ["nick", "mail", "link"],
    requiredMeta: ["nick"],
    pageSize: 20,
    dark: "html.dark",
    comment: true,
    reaction: false,
    // Use Cravatar (fast Chinese Gravatar mirror) instead of seccdn.libravatar.org
    avatarCDN: "https://cravatar.cn/avatar/",
    // Retro pixel-art avatars for users without a Gravatar — far nicer than blank silhouettes
    avatar: "retro",
  });

  // Mark loaded as soon as Waline injects the editor or comment list into the DOM
  observer = new MutationObserver(() => {
    if (walineEl.value?.querySelector(".wl-editor-wrap, .wl-cards")) markLoaded();
  });
  observer.observe(walineEl.value, { childList: true, subtree: true });

  // Hard fallback: never block the user for more than 3 s
  fallbackTimer = setTimeout(markLoaded, 3000);
});

// With <keep-alive>, the component is cached between route visits.
// Refresh the comment count when the user returns to this tab so it stays current.
onActivated(() => {
  walineController?.update?.({});
});

// keep-alive uses onDeactivated (not onUnmounted) when navigating away.
// Clean up only when the component is truly unmounted (app closed).
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

    <!-- Skeleton + Waline share the same stacking container.
         Skeleton overlays the invisible Waline until content is ready,
         then fades out while Waline fades in — zero layout shift. -->
    <div class="relative min-h-[480px]">
      <!-- Waline (always in DOM so it can render; invisible until loaded) -->
      <div
        ref="walineEl"
        class="waline-wrap rounded-2xl border border-sakura-100 bg-white shadow-[var(--shadow-md)] overflow-hidden p-6 transition-opacity duration-500"
        :class="isLoaded ? 'opacity-100' : 'opacity-0'"
      />

      <!-- Skeleton loader — sits on top and fades away once Waline is ready -->
      <Transition
        leave-active-class="transition-opacity duration-500"
        leave-to-class="opacity-0"
      >
        <div
          v-if="!isLoaded"
          class="absolute inset-0 pointer-events-none space-y-4"
        >
          <!-- Comment form skeleton -->
          <div class="rounded-2xl border border-sakura-100 bg-white p-6 space-y-3">
            <div class="grid grid-cols-3 gap-2">
              <div v-for="i in 3" :key="i" class="h-9 rounded-xl bg-pink-50 animate-pulse" />
            </div>
            <div class="h-28 rounded-xl bg-pink-50 animate-pulse" />
            <div class="flex justify-between items-center">
              <div class="flex gap-2">
                <div class="h-7 w-7 rounded-lg bg-pink-50 animate-pulse" />
                <div class="h-7 w-7 rounded-lg bg-pink-50 animate-pulse" />
              </div>
              <div class="h-8 w-20 rounded-xl bg-pink-50 animate-pulse" />
            </div>
          </div>
          <!-- Comment item skeletons -->
          <div v-for="i in 4" :key="i" class="flex gap-3 px-2 py-3">
            <div
              class="w-10 h-10 rounded-full bg-pink-50 animate-pulse shrink-0"
              :style="{ animationDelay: `${i * 80}ms` }"
            />
            <div class="flex-1 space-y-2 pt-1">
              <div
                class="h-3.5 rounded-full bg-pink-50 animate-pulse"
                :style="{ width: `${60 + i * 18}px`, animationDelay: `${i * 80}ms` }"
              />
              <div
                class="h-3 w-full rounded-full bg-pink-50 animate-pulse"
                :style="{ animationDelay: `${i * 100}ms` }"
              />
              <div
                class="h-3 rounded-full bg-pink-50 animate-pulse"
                :style="{ width: `${45 + i * 11}%`, animationDelay: `${i * 120}ms` }"
              />
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style>
/* ── Waline theme variables ────────────────────────────────────────── */
:root {
  --waline-theme-color: oklch(68% 0.22 350);
  --waline-active-color: oklch(60% 0.24 350);
  --waline-border-color: oklch(91% 0.04 350);
  --waline-bgcolor: #ffffff;
  --waline-bgcolor-light: oklch(98.5% 0.015 350);
  --waline-bgcolor-hover: oklch(97.5% 0.025 350);
  --waline-color: oklch(20% 0.02 260);
  --waline-color-light: oklch(55% 0.025 260);
  --waline-font-size: 14px;
  --waline-border-radius: 10px;
  --waline-avatar-radius: 50%;
  --waline-avatar-size: 2.5rem;
  --waline-m-avatar-size: 2rem;
  --waline-box-shadow: none;
  --waline-badge-color: oklch(68% 0.22 350);
  --waline-badge-font-size: 0.68em;
  --waline-info-bg-color: oklch(97.5% 0.02 350);
  --waline-info-color: oklch(50% 0.03 260);
}

/* Remove default panel border/shadow — our wrapper provides the card chrome */
.waline-wrap .wl-panel {
  box-shadow: none !important;
  border: none !important;
  padding: 0 !important;
}

/* Hover highlight on individual comment rows */
.wl-cards .wl-item {
  padding: 12px 10px !important;
  border-radius: 12px;
  transition: background 0.15s ease;
}
.wl-cards .wl-item:hover {
  background: var(--waline-bgcolor-hover);
}
/* Hairline separator between comments */
.wl-cards .wl-item + .wl-item {
  border-top: 1px solid var(--waline-border-color) !important;
}

/* Avatar subtle scale on hover */
.wl-user img {
  transition: transform 0.2s ease;
}
.wl-user img:hover {
  transform: scale(1.08);
}

/* Focus ring on the editor textarea */
.wl-editor:focus-within {
  box-shadow: 0 0 0 3px oklch(68% 0.22 350 / 0.15) !important;
}

/* Smooth transitions on all Waline buttons */
.wl-btn {
  transition: background 0.15s ease, color 0.15s ease, opacity 0.15s ease !important;
  border-radius: 8px !important;
}

/* Lightly tint action buttons on hover */
.wl-actions .wl-action:hover {
  color: var(--waline-theme-color) !important;
}

/* ── Reply @mention alignment fix ──────────────────────────────────
   Waline renders reply comments as:
     <div class="wl-content">
       <div class="wl-reply-to"><a>@Name</a></div>
       <div innerHTML><p>reply text…</p></div>
     </div>
   Default has float:left + margin-top:1em on the @tag, while the <p>
   keeps browser-default margin-top, creating a visible height gap.
   Fix: zero out the float margin-top so the @tag sits at the content
   baseline, and collapse the first <p> margin so text starts inline. */
.wl-card .wl-content .wl-reply-to {
  float: left !important;
  margin: 0 .4em 0 0 !important;
  line-height: 2 !important;
}
/* Remove first-paragraph top margin so text aligns with the floated @tag */
.wl-card .wl-content .wl-reply-to + div > p:first-child,
.wl-card .wl-content .wl-reply-to + p:first-of-type {
  margin-top: 0 !important;
}
</style>
