import { createApp } from "vue";
import { createI18n } from "vue-i18n";
import { createRouter, createWebHistory } from "vue-router";
import "@fontsource-variable/outfit";
import "@fontsource-variable/plus-jakarta-sans";
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
  routes: [
    { path: "/", component: () => import("./views/HomeView.vue") },
    { path: "/subset", component: () => import("./views/SubsetView.vue") },
    { path: "/upload", component: () => import("./views/UploadView.vue") },
    { path: "/fonts", component: () => import("./views/FontsView.vue") },
    { path: "/sharing", component: () => import("./views/SharingView.vue") },
    { path: "/cli", component: () => import("./views/CliView.vue") },
    { path: "/about", component: () => import("./views/AboutView.vue") },
    { path: "/comments", component: () => import("./views/CommentsView.vue") },
    { path: "/logs", component: () => import("./views/LogsView.vue") },
  ],
});

createApp(App).use(i18n).use(router).mount("#app");

