<script setup lang="ts">
import { computed, onMounted, ref, watchEffect } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import {
  ChevronDown,
  Globe,
  LogIn,
  LogOut,
  Menu,
  Moon,
  Settings2,
  ShieldCheck,
  Sun,
  UserRound,
  X,
} from "lucide-vue-next";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import SettingsPanel from "./components/SettingsPanel.vue";
import { useWorkspaceSession } from "./composables/useWorkspaceSession";

const { t, locale } = useI18n();
const router = useRouter();
const route = useRoute();
const workspace = useWorkspaceSession();
const settingsOpen = ref(false);
const mobileOpen = ref(false);

const publicNav = [
  { path: "/", key: "navHome" },
  { path: "/subset", key: "navSubset" },
  { path: "/upload", key: "navUpload" },
  { path: "/sharing", key: "navSharing" },
  { path: "/cli", key: "navCli" },
];
const adminNav = [
  { path: "/fonts", key: "navAdminFonts" },
  { path: "/logs", key: "navAdminLogs" },
];
const navItems = computed(() => [
  ...publicNav,
  ...(workspace.canManage.value ? adminNav : []),
]);

const active = (path: string) =>
  path === "/" ? route.path === "/" : route.path.startsWith(path);

const toggleLang = () => {
  locale.value = locale.value === "zh-CN" ? "en-US" : "zh-CN";
  localStorage.setItem("locale", locale.value);
};

type ThemeMode = "system" | "light" | "dark";
const theme = ref<ThemeMode>(
  (localStorage.getItem("theme") as ThemeMode | null) ?? "system",
);
const applyTheme = () => {
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle(
    "dark",
    theme.value === "dark" || (theme.value === "system" && systemDark),
  );
};
const cycleTheme = () => {
  const order: ThemeMode[] = ["system", "light", "dark"];
  theme.value = order[(order.indexOf(theme.value) + 1) % order.length];
  localStorage.setItem("theme", theme.value);
  applyTheme();
};

const displayName = computed(() =>
  workspace.session.value?.authenticated
    ? workspace.session.value.displayName
    : "",
);
const avatarInitial = computed(() =>
  displayName.value.trim().slice(0, 1).toUpperCase() || "A",
);

const titles: Record<string, string> = {
  "/": "pageTitle_home",
  "/subset": "pageTitle_subset",
  "/upload": "pageTitle_upload",
  "/sharing": "pageTitle_sharing",
  "/workspace": "pageTitle_workspace",
  "/fonts": "pageTitle_fonts",
  "/logs": "pageTitle_logs",
  "/cli": "pageTitle_cli",
  "/about": "pageTitle_about",
  "/comments": "pageTitle_comments",
};
watchEffect(() => {
  document.title = titles[route.path] ? t(titles[route.path]) : "FontInAss";
});

router.afterEach(() => {
  mobileOpen.value = false;
  settingsOpen.value = false;
});

onMounted(() => {
  applyTheme();
  void workspace.refresh();
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
});
</script>

<template>
  <ConfirmDialog />
  <div class="min-h-screen bg-page flex flex-col">
    <header class="sticky top-0 z-40 border-b border-sakura-100 bg-surface/95 backdrop-blur-md">
      <nav class="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-5">
        <button class="shrink-0 text-left" @click="router.push('/')">
          <span class="font-display text-[1.3rem] font-black tracking-[-0.025em] text-ink-900">
            FontIn<span class="text-sakura-500">Ass</span>
          </span>
        </button>

        <div class="hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto md:flex">
          <button
            v-for="item in navItems"
            :key="item.path"
            class="h-8 shrink-0 rounded-lg px-2.5 text-[13px] font-medium transition-colors"
            :class="active(item.path) ? 'bg-sakura-400 text-white' : 'text-ink-600 hover:bg-sakura-50 hover:text-sakura-600'"
            @click="router.push(item.path)"
          >
            {{ t(item.key) }}
          </button>
        </div>

        <div class="ml-auto hidden items-center gap-1 md:flex">
          <button
            v-if="workspace.authenticated.value"
            class="flex h-8 items-center gap-2 rounded-lg px-2.5 text-xs font-medium text-ink-700 hover:bg-sakura-50"
            @click="router.push('/workspace')"
          >
            <span class="flex h-5 w-5 items-center justify-center rounded-full bg-sakura-100 text-[10px] font-bold text-sakura-600">
              {{ avatarInitial }}
            </span>
            <span class="max-w-28 truncate">{{ displayName }}</span>
            <ShieldCheck v-if="workspace.canManage.value" class="h-3.5 w-3.5 text-mint-600" />
          </button>
          <button
            v-else
            class="flex h-8 items-center gap-1.5 rounded-lg bg-sakura-500 px-3 text-xs font-semibold text-white hover:bg-sakura-600"
            @click="workspace.login('/workspace')"
          >
            <LogIn class="h-3.5 w-3.5" />{{ t('loginWithAniBT') }}
          </button>

          <div class="relative">
            <button
              class="flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-ink-600 hover:bg-sakura-50"
              @click="settingsOpen = !settingsOpen"
            >
              <Settings2 class="h-3.5 w-3.5" />
              <ChevronDown class="h-3 w-3" :class="settingsOpen && 'rotate-180'" />
            </button>
            <transition name="dropdown">
              <div
                v-if="settingsOpen"
                class="absolute right-0 top-full mt-2 w-80 rounded-2xl border border-ink-100 bg-surface p-5 shadow-[var(--shadow-md)]"
              >
                <SettingsPanel variant="dropdown" @close="settingsOpen = false" />
              </div>
            </transition>
          </div>
          <button class="utility-button" @click="cycleTheme" :aria-label="t('themeSystem')">
            <Moon v-if="theme === 'dark'" class="h-3.5 w-3.5" />
            <Sun v-else class="h-3.5 w-3.5" />
          </button>
          <button class="utility-button gap-1" @click="toggleLang">
            <Globe class="h-3.5 w-3.5" />{{ locale === 'zh-CN' ? 'EN' : '中' }}
          </button>
        </div>

        <button
          class="ml-auto flex h-9 w-9 items-center justify-center rounded-xl text-ink-600 hover:bg-sakura-50 md:hidden"
          :aria-label="mobileOpen ? 'Close menu' : 'Open menu'"
          @click="mobileOpen = !mobileOpen"
        >
          <X v-if="mobileOpen" class="h-5 w-5" />
          <Menu v-else class="h-5 w-5" />
        </button>
      </nav>

      <transition name="mobile-menu">
        <div v-if="mobileOpen" class="border-t border-sakura-100 bg-surface px-4 py-3 md:hidden">
          <div class="grid grid-cols-2 gap-1">
            <button
              v-for="item in navItems"
              :key="item.path"
              class="h-10 rounded-xl px-3 text-left text-sm font-medium"
              :class="active(item.path) ? 'bg-sakura-400 text-white' : 'text-ink-600 hover:bg-sakura-50'"
              @click="router.push(item.path)"
            >
              {{ t(item.key) }}
            </button>
          </div>
          <div class="mt-2 flex items-center gap-2 border-t border-ink-100 pt-3">
            <button
              v-if="workspace.authenticated.value"
              class="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-ink-50 px-3 py-2 text-sm text-ink-700"
              @click="router.push('/workspace')"
            >
              <UserRound class="h-4 w-4 shrink-0" /><span class="truncate">{{ displayName }}</span>
            </button>
            <button v-else class="flex-1 rounded-xl bg-sakura-500 px-3 py-2 text-sm font-semibold text-white" @click="workspace.login('/workspace')">
              {{ t('loginWithAniBT') }}
            </button>
            <button class="utility-button" @click="cycleTheme"><Moon class="h-4 w-4" /></button>
            <button class="utility-button" @click="toggleLang"><Globe class="h-4 w-4" /></button>
          </div>
        </div>
      </transition>
    </header>

    <main class="mx-auto w-full max-w-6xl flex-1 px-5 py-7">
      <router-view v-slot="{ Component, route: currentRoute }">
        <transition name="page" mode="out-in">
          <component :is="Component" :key="currentRoute.path" />
        </transition>
      </router-view>
    </main>

    <footer class="flex flex-wrap items-center justify-center gap-2 px-5 py-6 text-xs text-ink-300">
      <span>FontInAss · Built with 🌸</span>
      <a href="https://github.com/Yuri-NagaSaki/FontInAss" target="_blank" rel="noopener" class="hover:text-sakura-500">AGPL-3.0</a>
      <button
        v-if="workspace.authenticated.value"
        class="inline-flex items-center gap-1 hover:text-sakura-500"
        @click="workspace.logout(false)"
      >
        <LogOut class="h-3 w-3" />{{ t('logout') }}
      </button>
    </footer>
  </div>
</template>

<style>
.utility-button {
  display: inline-flex;
  height: 2rem;
  min-width: 2rem;
  align-items: center;
  justify-content: center;
  border-radius: 0.5rem;
  padding-inline: 0.5rem;
  color: var(--color-ink-600);
  font-size: 0.75rem;
}
.utility-button:hover { background: var(--color-sakura-50); color: var(--color-sakura-600); }
.page-enter-active { transition: opacity 0.16s, transform 0.16s var(--ease-out-quart); }
.page-leave-active { transition: opacity 0.08s; }
.page-enter-from { opacity: 0; transform: translateY(5px); }
.page-leave-to { opacity: 0; }
.dropdown-enter-active, .dropdown-leave-active { transition: opacity 0.14s, transform 0.14s var(--ease-out-quart); }
.dropdown-enter-from, .dropdown-leave-to { opacity: 0; transform: translateY(-5px); }
.mobile-menu-enter-active, .mobile-menu-leave-active { transition: opacity 0.16s, transform 0.16s var(--ease-out-quart); }
.mobile-menu-enter-from, .mobile-menu-leave-to { opacity: 0; transform: translateY(-6px); }
</style>
