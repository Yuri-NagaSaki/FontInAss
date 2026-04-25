<script setup lang="ts">
import { ref, computed, watchEffect, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter, useRoute } from "vue-router";
import { KeyRound, Globe, Cherry, Settings2, ChevronDown, Menu, X, CheckCircle2, Moon, Sun } from "lucide-vue-next";
import { Toaster } from "vue-sonner";
import KButton from "./components/KButton.vue";
import KInput from "./components/KInput.vue";
import SettingsPanel from "./components/SettingsPanel.vue";
import { getApiKey, setApiKey, clearApiKey } from "./api/client";
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
  { path: "/",         labelKey: "home"         },
  { path: "/subset",   labelKey: "subset"       },
  { path: "/upload",   labelKey: "publicUpload" },
  { path: "/sharing",  labelKey: "sharing"      },
  { path: "/logs",     labelKey: "navLogs"      },
  { path: "/cli",      labelKey: "cli"          },
  { path: "/comments", labelKey: "comments"     },
  { path: "/about",    labelKey: "about"        },
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

onMounted(() => {
  applyTheme();
  preconnectWaline();
  darkModeQuery.addEventListener("change", applyTheme);
  window.addEventListener("keydown", onEscape);
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
});

// ─── API Key modal ────────────────────────────────────────────────────────────
const keyModalOpen = ref(false);
const keyInput     = ref(getApiKey());
const hasKey       = computed(() => !!getApiKey());
const keySaved     = ref(false);

const openKeyModal  = () => { keyInput.value = getApiKey(); keyModalOpen.value = true; keySaved.value = false; };
const closeKeyModal = () => { keyModalOpen.value = false; };

const saveKey = () => {
  const k = keyInput.value.trim();
  setApiKey(k);
  keySaved.value = true;
  setTimeout(() => { keySaved.value = false; closeKeyModal(); }, 900);
};

const removeKey = () => {
  clearApiKey();
  keyInput.value = "";
  closeKeyModal();
};

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
};
watchEffect(() => {
  const key = titleKeys[route.path];
  document.title = key ? t(key) : "FontInAss";
});
</script>

<template>
  <!-- Global toast provider -->
  <Toaster
    position="bottom-right"
    :theme="themeMode === 'system' ? 'system' : themeMode"
    :toastOptions="{
      style: {
        fontFamily: 'var(--font-body)',
        borderRadius: '14px',
        border: '1px solid var(--color-sakura-200)',
        boxShadow: 'var(--shadow-md)',
        background: 'var(--color-surface)',
        color: 'var(--color-ink-950)',
      },
    }"
  />

  <div class="min-h-screen bg-page flex flex-col">
    <!-- ─── Navigation ────────────────────────────────────────────────────── -->
    <header class="sticky top-0 z-40 bg-surface/90 backdrop-blur-md border-b border-sakura-100 shadow-[var(--shadow-sm)]">
      <nav class="max-w-6xl mx-auto px-5 h-14 flex items-center gap-4">
        <!-- Logo -->
        <button class="flex items-center gap-2 shrink-0 group" @click="router.push('/')">
          <div class="w-8 h-8 rounded-xl bg-gradient-to-br from-sakura-300 to-sakura-500 flex items-center justify-center shadow-[var(--shadow-sm)] group-hover:shadow-[var(--shadow-md)] transition-shadow">
            <Cherry class="w-4 h-4 text-white" :stroke-width="2.5" />
          </div>
          <span class="font-display font-semibold text-base text-ink-950 tracking-tight leading-none">
            FontInAss
          </span>
        </button>

        <!-- Desktop nav links (hidden on mobile) -->
        <div class="hidden md:flex items-center gap-1">
          <button
            v-for="item in navItems"
            :key="item.path"
            class="px-3 h-8 rounded-xl text-sm font-medium transition-all duration-150"
            :class="isNavActive(item.path)
              ? 'bg-sakura-400 text-white shadow-[var(--shadow-sm)]'
              : 'text-ink-600 hover:bg-sakura-50 hover:text-sakura-600'"
            @mouseenter="prefetchRoute(item.path)"
            @click="router.push(item.path)"
          >
            {{ t(item.labelKey) }}
          </button>
        </div>

        <!-- Spacer -->
        <div class="flex-1" />

        <!-- ─── Settings popover trigger (desktop) ────────────────────────── -->
        <div class="relative hidden md:block">
          <button
            class="flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-medium text-ink-600 hover:bg-sakura-50 hover:text-sakura-600 transition-all duration-150"
            :class="settingsOpen && 'bg-sakura-50 text-sakura-600'"
            @click="settingsOpen = !settingsOpen; mobileMenuOpen = false"
          >
            <Settings2 class="w-3.5 h-3.5" />
            {{ t('settings') }}
            <ChevronDown class="w-3 h-3 transition-transform duration-200" :class="settingsOpen ? 'rotate-180' : ''" />
          </button>

          <!-- Settings dropdown (desktop) -->
          <transition name="dropdown">
            <div
              v-if="settingsOpen"
              class="absolute right-0 top-full mt-2 w-80 card-raised p-5 z-50"
              @click.stop
            >
              <div class="absolute top-0 left-0 right-0 h-0.5 rounded-t-[18px] bg-gradient-to-r from-sakura-300 to-sky-300" />
              <SettingsPanel variant="dropdown" @close="settingsOpen = false" />
            </div>
          </transition>
        </div>

        <!-- API Key button (desktop) -->
        <button
          class="hidden md:flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-medium transition-all duration-150"
          :class="hasKey
            ? 'text-mint-600 bg-mint-100 hover:bg-mint-100/80'
            : 'text-amber-400 bg-amber-100 hover:bg-amber-100/80'"
          @click="openKeyModal"
        >
          <KeyRound class="w-3.5 h-3.5" :stroke-width="2.5" />
          {{ hasKey ? t('apiKeySet') : t('apiKeyNotSet') }}
        </button>

        <!-- Dark mode toggle (desktop) -->
        <button
          class="hidden md:flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-medium text-ink-600 hover:bg-sakura-50 hover:text-sakura-600 transition-all duration-150"
          @click="cycleTheme"
          :title="themeMode === 'system' ? t('themeSystem') : themeMode === 'dark' ? t('themeDark') : t('themeLight')"
        >
          <Moon v-if="themeMode === 'dark'" class="w-3.5 h-3.5" />
          <Sun v-else-if="themeMode === 'light'" class="w-3.5 h-3.5" />
          <template v-else>
            <Moon class="w-3.5 h-3.5 dark:hidden" />
            <Sun class="w-3.5 h-3.5 hidden dark:block" />
          </template>
        </button>

        <!-- Language toggle (desktop) -->
        <button
          class="hidden md:flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-medium text-ink-600 hover:bg-sakura-50 hover:text-sakura-600 transition-all duration-150"
          @click="toggleLang"
        >
          <Globe class="w-3.5 h-3.5" />
          {{ locale === "zh-CN" ? "EN" : "中文" }}
        </button>

        <!-- Hamburger (mobile only) -->
        <button
          class="md:hidden flex items-center justify-center w-9 h-9 rounded-xl text-ink-600 hover:bg-sakura-50 hover:text-sakura-600 transition-all duration-150"
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
            class="flex items-center w-full px-4 h-10 rounded-xl text-sm font-medium transition-all duration-150 text-left"
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
            class="flex items-center gap-2 w-full px-4 h-10 rounded-xl text-sm font-medium transition-all duration-150"
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
              class="flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-medium text-ink-600 hover:bg-sakura-50 hover:text-sakura-600 transition-all duration-150"
              @click="cycleTheme"
            >
              <Moon v-if="themeMode === 'dark'" class="w-3.5 h-3.5" />
              <Sun v-else-if="themeMode === 'light'" class="w-3.5 h-3.5" />
              <template v-else><Moon class="w-3.5 h-3.5 dark:hidden" /><Sun class="w-3.5 h-3.5 hidden dark:block" /></template>
            </button>
            <button
              class="flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-medium text-ink-600 hover:bg-sakura-50 hover:text-sakura-600 transition-all duration-150"
              @click="toggleLang"
            >
              <Globe class="w-3.5 h-3.5" />
              {{ locale === "zh-CN" ? "EN" : "中文" }}
            </button>
            <button
              class="flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-medium text-ink-600 hover:bg-sakura-50 hover:text-sakura-600 transition-all duration-150"
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

  <!-- ─── API Key modal ─────────────────────────────────────────────────── -->
  <transition name="modal">
    <div
      v-if="keyModalOpen"
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      @click.self="closeKeyModal"
    >
      <div class="absolute inset-0 bg-ink-950/20 backdrop-blur-sm" @click="closeKeyModal" />
      <div class="relative card-raised p-6 w-full max-w-sm animate-scale-in">
        <div class="absolute top-0 left-0 right-0 h-1 rounded-t-[18px] bg-gradient-to-r from-sakura-300 via-sakura-400 to-sky-300" />
        <h2 class="font-display font-semibold text-ink-950 text-lg mb-1">{{ t('apiKeyTitle') }}</h2>
        <p class="text-sm text-ink-400 mb-5 leading-relaxed">{{ t('apiKeyDesc') }}</p>
        <KInput v-model="keyInput" type="password" :placeholder="t('apiKeyPlaceholder')" class="mb-4" @enter="saveKey" />
        <div class="flex items-center gap-2">
          <KButton variant="primary" size="md" class="flex-1" @click="saveKey">
            <Transition name="chip-icon" mode="out-in">
              <CheckCircle2 v-if="keySaved" key="ok" class="w-4 h-4 text-white" />
              <span v-else key="icon" />
            </Transition>
            {{ keySaved ? t('saved') : t('apiKeySave') }}
          </KButton>
          <KButton variant="ghost" size="md" @click="closeKeyModal">{{ t('cancel') }}</KButton>
          <KButton v-if="hasKey" variant="danger" size="icon" @click="removeKey" title="Clear key">×</KButton>
        </div>
      </div>
    </div>
  </transition>

  <!-- ─── Mobile Settings panel (shown as bottom sheet on small screens) ── -->
  <transition name="modal">
    <div
      v-if="settingsOpen"
      class="md:hidden fixed inset-0 z-50 flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      @click.self="settingsOpen = false"
    >
      <div class="absolute inset-0 bg-ink-950/20 backdrop-blur-sm" @click="settingsOpen = false" />
      <div class="relative w-full card-raised rounded-b-none rounded-t-2xl p-5 pb-8 max-h-[85vh] overflow-y-auto" @click.stop>
        <div class="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl bg-gradient-to-r from-sakura-300 to-sky-300" />
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
