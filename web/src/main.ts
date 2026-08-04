import { createApp } from "vue";
import { createI18n } from "vue-i18n";
import { createRouter, createWebHistory } from "vue-router";
import "@fontsource-variable/outfit";
import "@fontsource-variable/plus-jakarta-sans";
import "./style.css";
import App from "./App.vue";
import zhCN from "./locales/zh-CN";
import enUS from "./locales/en-US";
import { useWorkspaceSession } from "./composables/useWorkspaceSession";

const savedLocale = localStorage.getItem("locale") ?? "zh-CN";

const i18n = createI18n({
  legacy: false,
  locale: savedLocale,
  fallbackLocale: "zh-CN",
  messages: { "zh-CN": zhCN, "en-US": enUS },
});

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: () => import("./views/HomeView.vue") },
    { path: "/subset", component: () => import("./views/SubsetView.vue") },
    { path: "/upload", component: () => import("./views/UploadView.vue") },
    { path: "/workspace", component: () => import("./views/WorkspaceView.vue") },
    { path: "/fonts", component: () => import("./views/FontsView.vue"), meta: { admin: true } },
    { path: "/sharing", component: () => import("./views/SharingView.vue") },
    { path: "/cli", component: () => import("./views/CliView.vue") },
    { path: "/about", component: () => import("./views/AboutView.vue") },
    { path: "/comments", component: () => import("./views/CommentsView.vue") },
    { path: "/logs", component: () => import("./views/LogsView.vue"), meta: { admin: true } },
  ],
});

router.beforeEach(async (to) => {
  if (!to.meta.admin) return true;
  const workspace = useWorkspaceSession();
  await workspace.refresh();
  return workspace.canManage.value
    ? true
    : { path: "/workspace", query: { tab: "admin" } };
});

createApp(App).use(i18n).use(router).mount("#app");
