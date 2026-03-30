<script setup lang="ts">
import { ref, computed, watchEffect } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter, useRoute } from "vue-router";
import { KeyRound, Globe, Cherry, Settings2, ChevronDown, Menu, X, CheckCircle2 } from "lucide-vue-next";
import { Toaster } from "vue-sonner";
import KButton from "./components/KButton.vue";
import KInput from "./components/KInput.vue";
import { getApiKey, setApiKey, clearApiKey } from "./api/client";

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
};
const navItems = [
  { path: "/",         labelKey: "home"     },
  { path: "/subset",   labelKey: "subset"   },
  { path: "/sharing",  labelKey: "sharing"  },
  { path: "/logs",     labelKey: "navLogs"  },
  { path: "/cli",      labelKey: "cli"      },
  { path: "/comments", labelKey: "comments" },
  { path: "/about",    labelKey: "about"    },
];

const isNavActive = (path: string) => {
  if (path === "/") return currentPath.value === "/";
  return currentPath.value.startsWith(path);
};

const toggleLang = () => {
  locale.value = locale.value === "zh-CN" ? "en-US" : "zh-CN";
  localStorage.setItem("locale", locale.value);
};

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
const settingsSavedAck = ref(false);

// Close mobile menu on route change
router.afterEach(() => { mobileMenuOpen.value = false; settingsOpen.value = false; });

// Load persisted settings so the navbar popover shows current values
const loadedSettings = (() => {
  try {
    const s = localStorage.getItem("fontinass_settings");
    return s ? JSON.parse(s) : {};
  } catch { return {}; }
})();

const settings = ref({
  SRT_FORMAT: loadedSettings.SRT_FORMAT ?? "",
  SRT_STYLE:  loadedSettings.SRT_STYLE  ?? "",
  CLEAR_FONTS:          loadedSettings.CLEAR_FONTS          ?? false,
  STRICT_MODE:          loadedSettings.STRICT_MODE          ?? true,
  EXTRACT_FONTS:        loadedSettings.EXTRACT_FONTS        ?? false,
  CLEAR_AFTER_DOWNLOAD: loadedSettings.CLEAR_AFTER_DOWNLOAD ?? true,
});

const saveSettings = () => {
  localStorage.setItem("fontinass_settings", JSON.stringify(settings.value));
  settingsSavedAck.value = true;
  setTimeout(() => { settingsSavedAck.value = false; settingsOpen.value = false; }, 900);
};

const toggleSetting = (key: keyof typeof settings.value) => {
  (settings.value as Record<string, unknown>)[key] = !settings.value[key as keyof typeof settings.value];
};

// Per-route document.title
const routeTitles: Record<string, string> = {
  "/": "FontInAss — 字幕字体子集化",
  "/subset": "字幕处理 · FontInAss",
  "/fonts": "字体管理 · FontInAss",
  "/sharing": "字幕分享 · FontInAss",
  "/logs": "处理记录 · FontInAss",
  "/cli": "CLI · FontInAss",
  "/about": "关于 · FontInAss",
  "/comments": "评论区 · FontInAss",
};
watchEffect(() => {
  document.title = routeTitles[route.path] ?? "FontInAss";
});
</script>

<template>
  <!-- Global toast provider -->
  <Toaster
    position="bottom-right"
    :toastOptions="{
      style: {
        fontFamily: 'var(--font-body)',
        borderRadius: '14px',
        border: '1px solid oklch(89% 0.055 350)',
        boxShadow: 'var(--shadow-md)',
      },
    }"
  />

  <div class="min-h-screen bg-page flex flex-col">
    <!-- ─── Navigation ────────────────────────────────────────────────────── -->
    <header class="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-sakura-100 shadow-[0_1px_12px_oklch(70%_0.20_350/0.08)]">
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
              <h3 class="font-display font-semibold text-ink-900 text-sm mb-4">{{ t('settingsTitle') }}</h3>

              <!-- Toggles -->
              <div class="space-y-3 mb-5">
                <label
                  v-for="item in [
                    { key: 'STRICT_MODE',          label: t('strictMode'),         desc: t('strictModeDesc')         },
                    { key: 'CLEAR_FONTS',          label: t('clearFonts'),         desc: t('clearFontsDesc')         },
                    { key: 'EXTRACT_FONTS',        label: t('extractFonts'),       desc: t('extractFontsDesc')       },
                    { key: 'CLEAR_AFTER_DOWNLOAD', label: t('clearAfterDownload'), desc: t('clearAfterDownloadDesc') },
                  ]"
                  :key="item.key"
                  class="flex items-start gap-3 cursor-pointer group"
                  @click="toggleSetting(item.key as keyof typeof settings)"
                >
                  <div
                    class="relative w-9 h-5 rounded-full transition-colors duration-200 flex-shrink-0 mt-0.5"
                    :class="(settings as any)[item.key] ? 'bg-sakura-400' : 'bg-ink-200'"
                  >
                    <div
                      class="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200"
                      :class="(settings as any)[item.key] ? 'translate-x-4' : 'translate-x-0.5'"
                    />
                  </div>
                  <div class="flex-1">
                    <p class="text-xs font-medium text-ink-700 select-none leading-snug">{{ item.label }}</p>
                    <p class="text-[11px] text-ink-400 select-none leading-snug mt-0.5">{{ item.desc }}</p>
                  </div>
                </label>
              </div>

              <!-- SRT fields -->
              <div class="space-y-3 mb-4">
                <div class="space-y-1">
                  <label class="text-xs font-medium text-ink-500">SRT Format</label>
                  <p class="text-[11px] text-ink-400">{{ t('srtFormatDesc') }}</p>
                  <input
                    v-model="settings.SRT_FORMAT"
                    class="w-full h-8 px-3 rounded-lg border border-ink-200 text-xs font-mono text-ink-700 focus:border-sakura-400 focus:ring-2 focus:ring-sakura-400/20 outline-none transition-all"
                    :placeholder="t('srtFormatPlaceholder')"
                  />
                </div>
                <div class="space-y-1">
                  <label class="text-xs font-medium text-ink-500">SRT Style</label>
                  <p class="text-[11px] text-ink-400">{{ t('srtStyleDesc') }}</p>
                  <input
                    v-model="settings.SRT_STYLE"
                    class="w-full h-8 px-3 rounded-lg border border-ink-200 text-xs font-mono text-ink-700 focus:border-sakura-400 focus:ring-2 focus:ring-sakura-400/20 outline-none transition-all"
                    :placeholder="t('srtStylePlaceholder')"
                  />
                </div>
              </div>

              <div class="flex gap-2">
                <KButton variant="primary" size="sm" class="flex-1" @click="saveSettings">
                  <Transition name="chip-icon" mode="out-in">
                    <CheckCircle2 v-if="settingsSavedAck" key="ok" class="w-3.5 h-3.5 text-white" />
                    <span v-else key="icon" />
                  </Transition>
                  {{ settingsSavedAck ? (locale === 'zh-CN' ? '已保存' : 'Saved!') : t('save') }}
                </KButton>
                <KButton variant="ghost" size="sm" @click="settingsOpen = false">{{ t('cancel') }}</KButton>
              </div>
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
          class="md:hidden border-t border-sakura-100 bg-white/95 backdrop-blur-md px-5 py-3 flex flex-col gap-1"
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
            @click="openKeyModal; mobileMenuOpen = false"
          >
            <KeyRound class="w-4 h-4" :stroke-width="2.5" />
            {{ hasKey ? t('apiKeySet') : t('apiKeyNotSet') }}
          </button>

          <!-- Lang + Settings row -->
          <div class="flex items-center gap-2 px-1 pb-1">
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
            {{ keySaved ? (locale === 'zh-CN' ? '已保存' : 'Saved!') : t('apiKeySave') }}
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
      @click.self="settingsOpen = false"
    >
      <div class="absolute inset-0 bg-ink-950/20 backdrop-blur-sm" @click="settingsOpen = false" />
      <div class="relative w-full card-raised rounded-b-none rounded-t-2xl p-5 pb-8 max-h-[85vh] overflow-y-auto" @click.stop>
        <div class="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl bg-gradient-to-r from-sakura-300 to-sky-300" />
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-display font-semibold text-ink-900 text-sm">{{ t('settingsTitle') }}</h3>
          <button class="w-7 h-7 rounded-lg flex items-center justify-center text-ink-400 hover:bg-sakura-50 hover:text-sakura-600" @click="settingsOpen = false">
            <X class="w-4 h-4" />
          </button>
        </div>
        <!-- Toggles -->
        <div class="space-y-3 mb-5">
          <label
            v-for="item in [
              { key: 'STRICT_MODE',          label: t('strictMode'),         desc: t('strictModeDesc')         },
              { key: 'CLEAR_FONTS',          label: t('clearFonts'),         desc: t('clearFontsDesc')         },
              { key: 'EXTRACT_FONTS',        label: t('extractFonts'),       desc: t('extractFontsDesc')       },
              { key: 'CLEAR_AFTER_DOWNLOAD', label: t('clearAfterDownload'), desc: t('clearAfterDownloadDesc') },
            ]"
            :key="item.key"
            class="flex items-start gap-3 cursor-pointer group"
            @click="toggleSetting(item.key as keyof typeof settings)"
          >
            <div
              class="relative w-9 h-5 rounded-full transition-colors duration-200 flex-shrink-0 mt-0.5"
              :class="(settings as any)[item.key] ? 'bg-sakura-400' : 'bg-ink-200'"
            >
              <div
                class="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200"
                :class="(settings as any)[item.key] ? 'translate-x-4' : 'translate-x-0.5'"
              />
            </div>
            <div class="flex-1">
              <p class="text-xs font-medium text-ink-700 select-none leading-snug">{{ item.label }}</p>
              <p class="text-[11px] text-ink-400 select-none leading-snug mt-0.5">{{ item.desc }}</p>
            </div>
          </label>
        </div>
        <!-- SRT fields -->
        <div class="space-y-3 mb-4">
          <div class="space-y-1">
            <label class="text-xs font-medium text-ink-500">SRT Format</label>
            <p class="text-[11px] text-ink-400">{{ t('srtFormatDesc') }}</p>
            <input
              v-model="settings.SRT_FORMAT"
              class="w-full h-8 px-3 rounded-lg border border-ink-200 text-xs font-mono text-ink-700 focus:border-sakura-400 focus:ring-2 focus:ring-sakura-400/20 outline-none transition-all"
              :placeholder="t('srtFormatPlaceholder')"
            />
          </div>
          <div class="space-y-1">
            <label class="text-xs font-medium text-ink-500">SRT Style</label>
            <p class="text-[11px] text-ink-400">{{ t('srtStyleDesc') }}</p>
            <input
              v-model="settings.SRT_STYLE"
              class="w-full h-8 px-3 rounded-lg border border-ink-200 text-xs font-mono text-ink-700 focus:border-sakura-400 focus:ring-2 focus:ring-sakura-400/20 outline-none transition-all"
              :placeholder="t('srtStylePlaceholder')"
            />
          </div>
        </div>
        <div class="flex gap-2">
          <KButton variant="primary" size="sm" class="flex-1" @click="saveSettings">
            <Transition name="chip-icon" mode="out-in">
              <CheckCircle2 v-if="settingsSavedAck" key="ok" class="w-3.5 h-3.5 text-white" />
              <span v-else key="icon" />
            </Transition>
            {{ settingsSavedAck ? (locale === 'zh-CN' ? '已保存' : 'Saved!') : t('save') }}
          </KButton>
          <KButton variant="ghost" size="sm" @click="settingsOpen = false">{{ t('cancel') }}</KButton>
        </div>
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
