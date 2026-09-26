import { createApp } from "vue";
import { createI18n } from "vue-i18n";
import { createRouter, createWebHistory } from "vue-router";
import "@fontsource/zen-maru-gothic/latin-500.css";
import "@fontsource/zen-maru-gothic/latin-700.css";
import "@fontsource/m-plus-1-code/latin-500.css";
import "./style.css";
import App from "./App.vue";
import zhCN from "./locales/zh-CN";
import enUS from "./locales/en-US";

const savedLocale = localStorage.getItem("locale") ?? "zh-CN";

const i18n = createI18n({
  legacy: false,
  locale: savedLocale,
  fallbackLocale: "zh-CN",
  messages: { "zh-CN": zhCN, "en-US": enUS },
});

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior(to, _from, saved) {
    if (saved) return saved;
    if (to.hash) return { el: to.hash, top: 120 };
    return { top: 0 };
  },
  routes: [
    { path: "/", component: () => import("./views/HomeView.vue") },
    { path: "/subset", component: () => import("./views/SubsetView.vue") },
    { path: "/upload", component: () => import("./views/UploadView.vue") },
    { path: "/access", component: () => import("./views/AccessView.vue") },
    { path: "/fonts", component: () => import("./views/FontsView.vue") },
    { path: "/sharing", component: () => import("./views/SharingView.vue") },
    { path: "/cli", component: () => import("./views/CliView.vue") },
    { path: "/about", component: () => import("./views/AboutView.vue") },
    { path: "/comments", component: () => import("./views/CommentsView.vue") },
    { path: "/logs", component: () => import("./views/LogsView.vue") },
    { path: "/:pathMatch(.*)*", component: () => import("./views/NotFoundView.vue") },
  ],
});

createApp(App).use(i18n).use(router).mount("#app");
