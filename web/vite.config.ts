import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [
    tailwindcss(),
    vue(),
  ],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  build: {
    sourcemap: "hidden",
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](?:vue|vue-router|vue-i18n)[\\/]/.test(id)) return "vendor-vue";
          if (/[\\/]node_modules[\\/]lucide-vue-next[\\/]/.test(id)) return "vendor-icons";
          if (/[\\/]node_modules[\\/]@waline[\\/]client[\\/]/.test(id)) return "vendor-waline";
          if (/[\\/]node_modules[\\/]@vueuse[\\/]core[\\/]/.test(id)) return "vendor-utils";
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": {
        target: process.env.VITE_API_BASE_URL ?? "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});

