<script setup lang="ts">
import { ref, computed, watchEffect, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter, useRoute } from "vue-router";
import { KeyRound, Globe, Settings2, ChevronDown, Menu, X, Moon, Sun } from "lucide-vue-next";
import SettingsPanel from "./components/SettingsPanel.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import AuthKeyModal from "./components/AuthKeyModal.vue";
import { API_KEY_CHANGED_EVENT, getApiKey } from "./api/client";
import { useSettings } from "./composables/useSettings";
import { preconnectWaline, preloadWalineAssets } from "./lib/waline-loader";

const { t, locale } = useI18n();
const router = useRouter();
const route = useRoute();

const currentPath = computed(() => route.path);

// Prefetch a route's JS chunk when the user hovers its nav button.
// Calls the lazy-import function early so the browser fetches the chunk
// in the background — by the time they click, it's already in cache.
const prefetchRoute = (path: string) => {
  const resolved = router.resolve(path);
  resolved.matched.forEach(m => {
    const comp = m.components?.default;
    if (typeof comp === "function") (comp as () => Promise<unknown>)();
  });
  if (path === "/comments") warmComments();
};
const navItems = [
  { path: "/",         labelKey: "navHome"     },
  { path: "/subset",   labelKey: "navSubset"   },
  { path: "/upload",   labelKey: "navUpload"   },
  { path: "/sharing",  labelKey: "navSharing"  },
  { path: "/logs",     labelKey: "navLogs"     },
  { path: "/cli",      labelKey: "navCli"      },
  { path: "/comments", labelKey: "navComments" },
  { path: "/about",    labelKey: "navAbout"    },
];

const isNavActive = (path: string) => {
  if (path === "/") return currentPath.value === "/";
  return currentPath.value.startsWith(path);
};

const toggleLang = () => {
  locale.value = locale.value === "zh-CN" ? "en-US" : "zh-CN";
  localStorage.setItem("locale", locale.value);
};

// ─── Dark mode ────────────────────────────────────────────────────────────────
type ThemeMode = "system" | "light" | "dark";
const themeMode = ref<ThemeMode>((localStorage.getItem("theme") as ThemeMode) ?? "system");

const applyTheme = () => {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = themeMode.value === "dark" || (themeMode.value === "system" && prefersDark);
  document.documentElement.classList.toggle("dark", isDark);
};

const cycleTheme = () => {
  const order: ThemeMode[] = ["system", "light", "dark"];
  themeMode.value = order[(order.indexOf(themeMode.value) + 1) % order.length];
  localStorage.setItem("theme", themeMode.value);
  applyTheme();
};

const darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");
let commentsIdleHandle: number | null = null;

const warmComments = () => {
  void preloadWalineAssets().catch(() => undefined);
};

// ─── Keyboard shortcuts ──────────────────────────────────────────────────────
const onEscape = (e: KeyboardEvent) => {
  if (e.key === "Escape") {
    if (keyModalOpen.value) { closeKeyModal(); return; }
    if (settingsOpen.value) { settingsOpen.value = false; return; }
    if (mobileMenuOpen.value) { mobileMenuOpen.value = false; return; }
  }
};

// ─── API Key modal ────────────────────────────────────────────────────────────
const keyModalOpen = ref(false);
const hasKey = ref(!!getApiKey());
const syncHasKey = () => { hasKey.value = !!getApiKey(); };
const handleKeySaved = () => { syncHasKey(); void router.push("/fonts"); };
const openKeyModal = () => { keyModalOpen.value = true; };
const closeKeyModal = () => { keyModalOpen.value = false; };

onMounted(() => {
  applyTheme();
  preconnectWaline();
  darkModeQuery.addEventListener("change", applyTheme);
  window.addEventListener("keydown", onEscape);
  window.addEventListener(API_KEY_CHANGED_EVENT, syncHasKey);
  const win = window as typeof window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (win.requestIdleCallback) {
    commentsIdleHandle = win.requestIdleCallback(warmComments, { timeout: 2500 });
  } else {
    commentsIdleHandle = window.setTimeout(warmComments, 1200);
  }
});

onUnmounted(() => {
  const win = window as typeof window & { cancelIdleCallback?: (handle: number) => void };
  if (commentsIdleHandle !== null) {
    if (win.cancelIdleCallback) win.cancelIdleCallback(commentsIdleHandle);
    else window.clearTimeout(commentsIdleHandle);
    commentsIdleHandle = null;
  }
  darkModeQuery.removeEventListener("change", applyTheme);
  window.removeEventListener("keydown", onEscape);
  window.removeEventListener(API_KEY_CHANGED_EVENT, syncHasKey);
});

// ─── Settings popover ─────────────────────────────────────────────────────────
const settingsOpen     = ref(false);
const mobileMenuOpen   = ref(false);

// Close mobile menu on route change
router.afterEach(() => { mobileMenuOpen.value = false; settingsOpen.value = false; });

// Shared settings state (used by SubsetView too)
useSettings();

// Per-route document.title (i18n-aware)
const titleKeys: Record<string, string> = {
  "/": "pageTitle_home",
  "/subset": "pageTitle_subset",
  "/fonts": "pageTitle_fonts",
  "/sharing": "pageTitle_sharing",
  "/logs": "pageTitle_logs",
  "/cli": "pageTitle_cli",
  "/about": "pageTitle_about",
  "/comments": "pageTitle_comments",
  "/upload": "pageTitle_upload",
  "/access": "pageTitle_access",
};
watchEffect(() => {
  const key = titleKeys[route.path];
  document.title = key ? t(key) : "FontInAss";
});
</script>

<template>
  <!-- Global confirm / alert dialog -->
  <ConfirmDialog />

  <div class="min-h-screen bg-page flex flex-col">
    <!-- ─── Navigation ────────────────────────────────────────────────────── -->
    <header class="sticky top-0 z-40 bg-surface/90 backdrop-blur-md border-b border-sakura-100 shadow-[var(--shadow-sm)]">
      <nav class="max-w-6xl mx-auto px-4 sm:px-5 h-14 flex items-center gap-2 sm:gap-3 min-w-0">
        <!-- Wordmark -->
        <button class="flex items-center shrink-0 group" @click="router.push('/')">
          <span class="font-display font-black text-[1.25rem] sm:text-[1.35rem] tracking-[-0.02em] leading-none text-ink-900 group-hover:text-sakura-500 transition-colors duration-200">
            FontIn<span class="text-sakura-500 group-hover:text-ink-900 transition-colors duration-200">Ass</span>
          </span>
        </button>

        <!-- Desktop nav links (hidden on mobile) -->
        <div class="hidden md:flex items-center gap-0.5 min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <button
            v-for="item in navItems"
            :key="item.path"
            class="shrink-0 whitespace-nowrap px-2 lg:px-2.5 h-8 rounded-lg text-[13px] font-medium transition-colors duration-150"
            :class="isNavActive(item.path)
              ? 'bg-sakura-400 text-white shadow-[var(--shadow-sm)]'
              : 'text-ink-600 hover:bg-sakura-50 hover:text-sakura-600'"
            @mouseenter="prefetchRoute(item.path)"
            @click="router.push(item.path)"
          >
            {{ t(item.labelKey) }}
          </button>
        </div>

        <!-- Right utilities -->
        <div class="hidden md:flex items-center gap-1 shrink-0 ml-auto">
          <!-- Settings popover -->
          <div class="relative">
            <button
              class="flex items-center justify-center gap-1 h-8 w-8 lg:w-auto lg:px-2.5 rounded-lg text-xs font-medium text-ink-600 hover:bg-sakura-50 hover:text-sakura-600 transition-colors duration-150"
              :class="settingsOpen && 'bg-sakura-50 text-sakura-600'"
              :title="t('settings')"
              :aria-label="t('settings')"
              @click="settingsOpen = !settingsOpen; mobileMenuOpen = false"
            >
              <Settings2 class="w-3.5 h-3.5" />
              <span class="hidden lg:inline">{{ t('settings') }}</span>
              <ChevronDown class="hidden lg:block w-3 h-3 transition-transform duration-200" :class="settingsOpen ? 'rotate-180' : ''" />
            </button>

            <transition name="dropdown">
              <div
                v-if="settingsOpen"
                class="absolute right-0 top-full mt-2 w-80 z-50 overflow-hidden rounded-2xl border border-ink-100 bg-surface p-5 shadow-[var(--shadow-md)]"
                @click.stop
              >
                <SettingsPanel variant="dropdown" @close="settingsOpen = false" />
              </div>
            </transition>
          </div>

          <!-- API Key -->
          <button
            class="flex items-center justify-center gap-1 h-8 w-8 lg:w-auto lg:px-2.5 rounded-lg text-xs font-medium transition-colors duration-150"
            :class="hasKey
              ? 'text-mint-600 bg-mint-100 hover:bg-mint-100/80'
              : 'text-amber-400 bg-amber-100 hover:bg-amber-100/80'"
            :title="hasKey ? t('apiKeySet') : t('apiKeyNotSet')"
            :aria-label="hasKey ? t('apiKeySet') : t('apiKeyNotSet')"
            @click="openKeyModal"
          >
            <KeyRound class="w-3.5 h-3.5" :stroke-width="2.5" />
            <span class="hidden lg:inline">{{ hasKey ? t('apiKeySet') : t('apiKeyNotSet') }}</span>
          </button>

          <!-- Dark mode -->
          <button
            class="flex items-center justify-center h-8 w-8 rounded-lg text-xs font-medium text-ink-600 hover:bg-sakura-50 hover:text-sakura-600 transition-colors duration-150"
            @click="cycleTheme"
            :title="themeMode === 'system' ? t('themeSystem') : themeMode === 'dark' ? t('themeDark') : t('themeLight')"
            :aria-label="themeMode === 'system' ? t('themeSystem') : themeMode === 'dark' ? t('themeDark') : t('themeLight')"
          >
            <Moon v-if="themeMode === 'dark'" class="w-3.5 h-3.5" />
            <Sun v-else-if="themeMode === 'light'" class="w-3.5 h-3.5" />
            <template v-else>
              <Moon class="w-3.5 h-3.5 dark:hidden" />
              <Sun class="w-3.5 h-3.5 hidden dark:block" />
            </template>
          </button>

          <!-- Language -->
          <button
            class="flex items-center justify-center gap-1 h-8 min-w-8 px-2 rounded-lg text-xs font-medium text-ink-600 hover:bg-sakura-50 hover:text-sakura-600 transition-colors duration-150 whitespace-nowrap"
            @click="toggleLang"
            :title="locale === 'zh-CN' ? 'English' : '中文'"
            :aria-label="locale === 'zh-CN' ? 'Switch to English' : '切换到中文'"
          >
            <Globe class="w-3.5 h-3.5" />
            <span>{{ locale === "zh-CN" ? "EN" : "中文" }}</span>
          </button>
        </div>

        <!-- Hamburger (mobile only) -->
        <button
          class="md:hidden flex items-center justify-center w-9 h-9 rounded-xl text-ink-600 hover:bg-sakura-50 hover:text-sakura-600 transition-colors duration-150 ml-auto"
          @click="mobileMenuOpen = !mobileMenuOpen; settingsOpen = false"
          :aria-label="mobileMenuOpen ? 'Close menu' : 'Open menu'"
        >
          <X v-if="mobileMenuOpen" class="w-5 h-5" />
          <Menu v-else class="w-5 h-5" />
        </button>
      </nav>

      <!-- Mobile menu dropdown -->
      <transition name="mobile-menu">
        <div
          v-if="mobileMenuOpen"
          class="md:hidden border-t border-sakura-100 bg-surface/95 backdrop-blur-md px-5 py-3 flex flex-col gap-1"
        >
          <!-- Nav links -->
          <button
            v-for="item in navItems"
            :key="item.path"
            class="flex items-center w-full px-4 h-10 rounded-xl text-sm font-medium transition-colors duration-150 text-left"
            :class="isNavActive(item.path)
              ? 'bg-sakura-400 text-white shadow-[var(--shadow-sm)]'
              : 'text-ink-600 hover:bg-sakura-50 hover:text-sakura-600'"
            @mouseenter="prefetchRoute(item.path)"
            @click="router.push(item.path); mobileMenuOpen = false"
          >
            {{ t(item.labelKey) }}
          </button>

          <!-- Divider -->
          <div class="h-px bg-sakura-100 my-1" />

          <!-- API Key row -->
          <button
            class="flex items-center gap-2 w-full px-4 h-10 rounded-xl text-sm font-medium transition-colors duration-150"
            :class="hasKey
              ? 'text-mint-600 hover:bg-mint-50'
              : 'text-amber-500 hover:bg-amber-50'"
            @click="openKeyModal(); mobileMenuOpen = false"
          >
            <KeyRound class="w-4 h-4" :stroke-width="2.5" />
            {{ hasKey ? t('apiKeySet') : t('apiKeyNotSet') }}
          </button>

          <!-- Lang + Settings + Theme row -->
          <div class="flex items-center gap-2 px-1 pb-1">
            <button
              class="flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-medium text-ink-600 hover:bg-sakura-50 hover:text-sakura-600 transition-colors duration-150"
              @click="cycleTheme"
            >
              <Moon v-if="themeMode === 'dark'" class="w-3.5 h-3.5" />
              <Sun v-else-if="themeMode === 'light'" class="w-3.5 h-3.5" />
              <template v-else><Moon class="w-3.5 h-3.5 dark:hidden" /><Sun class="w-3.5 h-3.5 hidden dark:block" /></template>
            </button>
            <button
              class="flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-medium text-ink-600 hover:bg-sakura-50 hover:text-sakura-600 transition-colors duration-150"
              @click="toggleLang"
            >
              <Globe class="w-3.5 h-3.5" />
              {{ locale === "zh-CN" ? "EN" : "中文" }}
            </button>
            <button
              class="flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-medium text-ink-600 hover:bg-sakura-50 hover:text-sakura-600 transition-colors duration-150"
              @click="settingsOpen = true; mobileMenuOpen = false"
            >
              <Settings2 class="w-3.5 h-3.5" />
              {{ t('settings') }}
            </button>
          </div>
        </div>
      </transition>
    </header>

    <!-- ─── Settings backdrop ─────────────────────────────────────────────── -->
    <div
      v-if="settingsOpen || mobileMenuOpen"
      class="fixed inset-0 z-30"
      @click="settingsOpen = false; mobileMenuOpen = false"
    />

    <!-- ─── Page content ──────────────────────────────────────────────────── -->
    <main class="flex-1 max-w-6xl mx-auto w-full px-5 py-7">
      <router-view v-slot="{ Component, route: r }">
        <transition name="page" mode="out-in">
          <keep-alive :max="5">
            <component :is="Component" :key="r.path" />
          </keep-alive>
        </transition>
      </router-view>
    </main>

    <!-- ─── Global Footer ──────────────────────────────────────────────────── -->
    <footer class="text-center text-xs text-ink-300 py-6">
      FontInAss · Built with 🌸 by
      <a href="https://catcat.blog" target="_blank" rel="noopener" class="hover:text-sakura-400 transition-colors">catcat.blog</a>
      ·
      <a href="https://github.com/Yuri-NagaSaki/FontInAss" target="_blank" rel="noopener" class="hover:text-sakura-400 transition-colors">AGPL-3.0</a>
    </footer>
  </div>

  <AuthKeyModal v-model:open="keyModalOpen" @saved="handleKeySaved" @cleared="syncHasKey" />

  <!-- ─── Mobile Settings panel (bottom sheet) ── -->
  <transition name="modal">
    <div
      v-if="settingsOpen"
      class="md:hidden fixed inset-0 z-50 flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      @click.self="settingsOpen = false"
    >
      <div class="absolute inset-0 bg-ink-950/40" @click="settingsOpen = false" />
      <div
        class="relative w-full max-h-[85vh] overflow-y-auto rounded-t-2xl border border-ink-100 bg-surface p-5 pb-8 shadow-[var(--shadow-lg)]"
        @click.stop
      >
        <div class="mx-auto mb-4 h-1 w-10 rounded-full bg-ink-200" />
        <SettingsPanel variant="sheet" @close="settingsOpen = false" />
      </div>
    </div>
  </transition>
</template>

<style>
/* ─── Page transitions ───────────────────────────────────────────────────── */
.page-enter-active {
  transition: opacity 0.16s cubic-bezier(0.25, 1, 0.5, 1),
              transform 0.16s cubic-bezier(0.25, 1, 0.5, 1);
}
.page-leave-active {
  /* 1ms = instant snap-away; fires transitionend so Vue out-in proceeds */
  transition: opacity 0.001s linear;
}
.page-enter-from { opacity: 0; transform: translateY(5px); }
.page-leave-to   { opacity: 0; }

/* Modal transitions */
.modal-enter-active { transition: opacity 0.2s; }
.modal-leave-active { transition: opacity 0.15s; }
.modal-enter-from, .modal-leave-to { opacity: 0; }

/* Settings dropdown */
.dropdown-enter-active {
  transition: opacity 0.15s cubic-bezier(0.25, 1, 0.5, 1),
              transform 0.15s cubic-bezier(0.25, 1, 0.5, 1);
}
.dropdown-leave-active {
  transition: opacity 0.1s ease-in, transform 0.1s ease-in;
}
.dropdown-enter-from, .dropdown-leave-to { opacity: 0; transform: translateY(-6px) scale(0.97); }

/* Mobile menu slide-down */
.mobile-menu-enter-active {
  transition: opacity 0.18s ease, transform 0.18s cubic-bezier(0.25, 1, 0.5, 1);
}
.mobile-menu-leave-active {
  transition: opacity 0.12s ease-in, transform 0.12s ease-in;
}
.mobile-menu-enter-from, .mobile-menu-leave-to { opacity: 0; transform: translateY(-8px); }
</style>
