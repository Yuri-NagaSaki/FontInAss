<script setup lang="ts">
import {
  ref,
  computed,
  watch,
  watchEffect,
  nextTick,
  onMounted,
  onUnmounted,
} from "vue";
import { useI18n } from "vue-i18n";
import { useRouter, useRoute } from "vue-router";
import {
  KeyRound,
  Globe,
  Settings2,
  ChevronDown,
  ArrowUpRight,
  MoreHorizontal,
  X,
  Moon,
  Sun,
  Monitor,
  House,
  Captions,
  Library,
  MessageCircle,
} from "lucide-vue-next";
import SettingsPanel from "./components/SettingsPanel.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import AuthKeyModal from "./components/AuthKeyModal.vue";
import { API_KEY_CHANGED_EVENT, getApiKey } from "./api/client";
import { communityServices, communityLinks } from "./lib/community";
import { useSettings } from "./composables/useSettings";
import { preloadWalineAssets } from "./lib/waline-loader";

const { t, locale } = useI18n();
const router = useRouter();
const route = useRoute();
const navItems = [
  { path: "/", label: "navHome", icon: House },
  { path: "/subset", label: "navSubset", icon: Captions },
  { path: "/sharing", label: "navSharing", icon: Library },
  { path: "/upload", label: "navUpload" },
  { path: "/comments", label: "navComments", icon: MessageCircle },
  { path: "/logs", label: "navLogs" },
  { path: "/cli", label: "navCli" },
  { path: "/about", label: "navAbout" },
];
const mobileItems = navItems.filter((item) => item.icon);
const isActive = (path: string) => route.path === path;
const prefetchRoute = (path: string) => {
  router.resolve(path).matched.forEach((m) => {
    const component = m.components?.default;
    if (typeof component === "function")
      void (component as () => Promise<unknown>)().catch(() => undefined);
  });
  if (path === "/comments") void preloadWalineAssets().catch(() => undefined);
};

const mobileMenuOpen = ref(false);
const serviceMenu = ref<HTMLDetailsElement>();
const moreButton = ref<HTMLButtonElement>();
const settingsOpen = ref(false);
const settingsDialog = ref<HTMLDialogElement>();
const keyModalOpen = ref(false);
const hasKey = ref(!!getApiKey());
const syncHasKey = () => {
  hasKey.value = !!getApiKey();
};
const handleKeySaved = () => {
  syncHasKey();
  void router.push("/fonts");
};
const openKeyModal = async () => {
  settingsOpen.value = false;
  await nextTick();
  keyModalOpen.value = true;
};
const openWorkspace = () => {
  mobileMenuOpen.value = false;
  if (hasKey.value) void router.push("/fonts");
  else void router.push("/access");
};

const themeModes = ["system", "light", "dark"] as const;
type ThemeMode = (typeof themeModes)[number];
const savedTheme = localStorage.getItem("theme");
const themeMode = ref<ThemeMode>(
  themeModes.includes(savedTheme as ThemeMode)
    ? (savedTheme as ThemeMode)
    : "system",
);
const themeLabel = computed(() =>
  t(
    themeMode.value === "system"
      ? "themeSystem"
      : themeMode.value === "dark"
        ? "themeDark"
        : "themeLight",
  ),
);
const themeIcon = computed(() =>
  themeMode.value === "system"
    ? Monitor
    : themeMode.value === "dark"
      ? Moon
      : Sun,
);
const darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");
function applyTheme() {
  const dark =
    themeMode.value === "dark" ||
    (themeMode.value === "system" && darkModeQuery.matches);
  document.documentElement.classList.toggle("dark", dark);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#17101a" : "#fffbfc");
}
function cycleTheme() {
  themeMode.value =
    themeModes[(themeModes.indexOf(themeMode.value) + 1) % themeModes.length]!;
  localStorage.setItem("theme", themeMode.value);
  applyTheme();
}
function toggleLang() {
  locale.value = locale.value === "zh-CN" ? "en-US" : "zh-CN";
  localStorage.setItem("locale", locale.value);
}
function onEscape(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  if (mobileMenuOpen.value) {
    mobileMenuOpen.value = false;
    moreButton.value?.focus();
  }
  if (serviceMenu.value?.open) {
    serviceMenu.value.open = false;
    serviceMenu.value.querySelector("summary")?.focus();
  }
}
function onOutsideClick(event: MouseEvent) {
  if (
    serviceMenu.value?.open &&
    !serviceMenu.value.contains(event.target as Node)
  )
    serviceMenu.value.open = false;
}
watch(settingsOpen, async (open) => {
  await nextTick();
  if (open) settingsDialog.value?.showModal();
  else settingsDialog.value?.close();
});
watch(
  () => route.fullPath,
  () => {
    mobileMenuOpen.value = false;
    settingsOpen.value = false;
    if (serviceMenu.value) serviceMenu.value.open = false;
  },
);
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
  document.title = titleKeys[route.path]
    ? t(titleKeys[route.path]!)
    : t("community.notFound") + " · AniBT";
  document.documentElement.lang = locale.value;
});
useSettings();
onMounted(() => {
  applyTheme();
  darkModeQuery.addEventListener("change", applyTheme);
  window.addEventListener("keydown", onEscape);
  window.addEventListener("click", onOutsideClick);
  window.addEventListener(API_KEY_CHANGED_EVENT, syncHasKey);
});
onUnmounted(() => {
  darkModeQuery.removeEventListener("change", applyTheme);
  window.removeEventListener("keydown", onEscape);
  window.removeEventListener("click", onOutsideClick);
  window.removeEventListener(API_KEY_CHANGED_EVENT, syncHasKey);
});
</script>

<template>
  <ConfirmDialog />
  <a class="skip-link" href="#main-content">{{ t("community.skipContent") }}</a>
  <div class="site-shell">
    <header class="site-header">
      <div class="site-container brand-bar">
        <a
          :href="communityLinks.home"
          class="brand-logo"
          :aria-label="t('community.backCommunity')"
        >
          <img
            src="/brand/anibt-logo.webp"
            srcset="/brand/anibt-logo.webp 1x, /brand/anibt-logo@2x.webp 2x"
            width="480"
            height="244"
            alt="AniBT"
          />
        </a>
        <span class="brand-divider" aria-hidden="true" />
        <RouterLink to="/" class="workshop-name">{{
          t("community.workshop")
        }}</RouterLink>
        <details ref="serviceMenu" class="service-switcher">
          <summary class="utility-button">
            <span>{{ t("community.services") }}</span
            ><ChevronDown :size="14" />
          </summary>
          <nav class="service-menu" :aria-label="t('community.services')">
            <template v-for="service in communityServices" :key="service.id">
              <RouterLink
                v-if="service.id === 'subtitles'"
                to="/"
                class="service-menu-item current"
                aria-current="true"
                @click="serviceMenu && (serviceMenu.open = false)"
              >
                <span
                  ><strong>{{ t(service.title) }}</strong
                  ><small>{{ t(service.description) }}</small></span
                ><span class="status-dot" />
              </RouterLink>
              <a v-else :href="service.href" class="service-menu-item"
                ><span
                  ><strong>{{ t(service.title) }}</strong
                  ><small>{{ t(service.description) }}</small></span
                ><ArrowUpRight :size="16"
              /></a>
            </template>
          </nav>
        </details>
        <div class="header-utilities">
          <button
            class="icon-button"
            :aria-label="t('settingsTitle')"
            :title="t('settingsTitle')"
            @click="settingsOpen = true"
          >
            <Settings2 :size="17" />
          </button>
          <button
            class="icon-button"
            :aria-label="themeLabel"
            :title="themeLabel"
            @click="cycleTheme"
          >
            <component :is="themeIcon" :size="17" />
          </button>
          <button
            class="icon-button language-button"
            :aria-label="
              locale === 'zh-CN' ? 'Switch to English' : '切换至中文'
            "
            @click="toggleLang"
          >
            <Globe :size="16" /><span>{{
              locale === "zh-CN" ? "EN" : "中"
            }}</span>
          </button>
          <button class="button workspace-button" @click="openWorkspace">
            <KeyRound :size="15" />{{
              t(hasKey ? "community.accessSaved" : "community.access")
            }}
          </button>
        </div>
      </div>
      <nav
        class="site-container desktop-nav"
        :aria-label="t('community.primaryNav')"
      >
        <RouterLink
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="nav-tab"
          :class="{ 'is-active': isActive(item.path) }"
          @mouseenter="prefetchRoute(item.path)"
          @focus="prefetchRoute(item.path)"
          >{{ t(item.label) }}</RouterLink
        >
      </nav>
    </header>

    <main id="main-content" class="site-container site-main" tabindex="-1">
      <router-view v-slot="{ Component, route: currentRoute }">
        <keep-alive :max="10"
          ><component :is="Component" :key="currentRoute.path"
        /></keep-alive>
      </router-view>
    </main>

    <footer class="site-footer">
      <div class="site-container footer-inner">
        <div>
          <RouterLink to="/" class="footer-brand">{{
            t("community.brand")
          }}</RouterLink>
          <p>{{ t("community.footer") }}</p>
        </div>
        <nav :aria-label="t('community.community')">
          <a :href="communityLinks.home">AniBT</a
          ><a href="https://wiki.anibt.net/">{{
            t("community.serviceWiki")
          }}</a>
          <a
            :href="communityLinks.telegram"
            target="_blank"
            rel="noopener noreferrer"
            >{{ t("community.contact") }}</a
          >
          <a
            :href="communityLinks.source"
            target="_blank"
            rel="noopener noreferrer"
            >{{ t("community.source") }}</a
          >
          <a
            :href="communityLinks.source + '/blob/main/LICENSE'"
            target="_blank"
            rel="noopener noreferrer"
            >AGPL-3.0</a
          >
        </nav>
      </div>
    </footer>

    <div
      v-if="mobileMenuOpen"
      class="mobile-menu-backdrop"
      @click="mobileMenuOpen = false"
    />
    <nav
      v-if="mobileMenuOpen"
      id="mobile-more"
      class="mobile-more"
      :aria-label="t('community.more')"
    >
      <div class="mobile-more-heading">
        <strong>{{ t("community.workshop") }}</strong
        ><button
          class="icon-button"
          :aria-label="t('community.close')"
          @click="
            mobileMenuOpen = false;
            moreButton?.focus();
          "
        >
          <X :size="18" />
        </button>
      </div>
      <div class="mobile-more-links">
        <RouterLink
          v-for="item in navItems.filter((item) => !item.icon)"
          :key="item.path"
          :to="item.path"
          :class="{ 'is-active': isActive(item.path) }"
          >{{ t(item.label) }}</RouterLink
        ><button @click="openWorkspace">
          {{ t(hasKey ? "community.accessSaved" : "community.access") }}</button
        ><a
          :href="communityLinks.telegram"
          target="_blank"
          rel="noopener noreferrer"
          >{{ t("community.contact") }}</a
        >
      </div>
    </nav>
    <nav class="mobile-nav" :aria-label="t('community.primaryNav')">
      <RouterLink
        v-for="item in mobileItems"
        :key="item.path"
        :to="item.path"
        :class="{ 'is-active': isActive(item.path) }"
        ><component :is="item.icon" :size="20" /><span>{{
          t(item.label)
        }}</span></RouterLink
      >
      <button
        ref="moreButton"
        :aria-expanded="mobileMenuOpen"
        aria-controls="mobile-more"
        :class="{
          'is-active':
            mobileMenuOpen || !mobileItems.some((item) => isActive(item.path)),
        }"
        @click="mobileMenuOpen = !mobileMenuOpen"
      >
        <MoreHorizontal :size="20" /><span>{{ t("community.more") }}</span>
      </button>
    </nav>
  </div>
  <AuthKeyModal
    v-model:open="keyModalOpen"
    @saved="handleKeySaved"
    @cleared="syncHasKey"
  />
  <dialog
    ref="settingsDialog"
    class="settings-dialog"
    :aria-label="t('settingsTitle')"
    @close="settingsOpen = false"
    @click="$event.target === settingsDialog && (settingsOpen = false)"
  >
    <div class="settings-dialog-body">
      <SettingsPanel variant="sheet" @close="settingsOpen = false" />
      <div class="mt-5 border-t-2 border-ink-100 pt-4">
        <button class="button w-full" @click="openKeyModal">
          <KeyRound :size="15" />{{ t("apiKeyTitle") }}
        </button>
      </div>
    </div>
  </dialog>
</template>
