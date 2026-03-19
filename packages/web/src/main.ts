import { createApp } from "vue";
import { createI18n } from "vue-i18n";
import { createRouter, createWebHistory } from "vue-router";
import Antd from "ant-design-vue";
import "ant-design-vue/dist/reset.css";
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
    { path: "/", redirect: "/subset" },
    { path: "/subset", component: () => import("./views/SubsetView.vue") },
    { path: "/fonts", component: () => import("./views/FontsView.vue") },
  ],
});

createApp(App).use(i18n).use(router).use(Antd).mount("#app");
