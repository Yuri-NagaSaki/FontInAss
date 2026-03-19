import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import Components from "unplugin-vue-components/vite";
import AutoImport from "unplugin-auto-import/vite";
import { AntDesignVueResolver } from "unplugin-vue-components/resolvers";

export default defineConfig({
  plugins: [
    vue(),
    AutoImport({
      imports: ["vue", "vue-router", "vue-i18n", "@vueuse/core"],
      dts: true,
    }),
    Components({
      resolvers: [
        AntDesignVueResolver({ importStyle: false }),
      ],
      dts: true,
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-vue": ["vue", "vue-router", "vue-i18n"],
          "vendor-antd": ["ant-design-vue"],
          "vendor-zip": ["jszip", "file-saver"],
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": {
        target: process.env.VITE_API_BASE_URL ?? "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
