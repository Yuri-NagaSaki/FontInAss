<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter, useRoute } from "vue-router";
import { computed } from "vue";
import { getApiKey, setApiKey, clearApiKey } from "./api/client";

const { t, locale } = useI18n();
const router = useRouter();
const route = useRoute();

const navItems = [
  { key: "/subset", label: computed(() => t("subset")) },
  { key: "/fonts", label: computed(() => t("fonts")) },
];

const selectedKeys = computed(() => [route.path]);
const onMenuClick = ({ key }: { key: string }) => router.push(key);

const toggleLang = () => {
  locale.value = locale.value === "zh-CN" ? "en-US" : "zh-CN";
  localStorage.setItem("locale", locale.value);
};

// ─── API Key modal ────────────────────────────────────────────────────────────
const keyModalVisible = ref(false);
const keyInputVal = ref(getApiKey());

const openKeyModal = () => {
  keyInputVal.value = getApiKey();
  keyModalVisible.value = true;
};

const saveKey = () => {
  setApiKey(keyInputVal.value.trim());
  keyModalVisible.value = false;
  // Reload font page if currently on it
  if (route.path === "/fonts") router.go(0);
};

const removeKey = () => {
  clearApiKey();
  keyInputVal.value = "";
  keyModalVisible.value = false;
  if (route.path === "/fonts") router.go(0);
};

const hasKey = computed(() => !!getApiKey());
</script>

<template>
  <a-layout style="min-height: 100vh">
    <a-layout-header style="display:flex;align-items:center;padding:0 24px;gap:24px">
      <span style="color:#fff;font-size:18px;font-weight:600;flex-shrink:0;">FontInAss</span>
      <a-menu
        theme="dark"
        mode="horizontal"
        :selected-keys="selectedKeys"
        style="flex:1;border-bottom:none;min-width:0;"
        @click="onMenuClick"
      >
        <a-menu-item v-for="item in navItems" :key="item.key">
          {{ item.label.value }}
        </a-menu-item>
      </a-menu>

      <!-- API key indicator + button -->
      <a-tooltip :title="t('apiKeyTitle')">
        <a-button
          type="text"
          :style="{ color: hasKey ? '#52c41a' : '#faad14', flexShrink: 0 }"
          @click="openKeyModal"
        >
          🔑 {{ hasKey ? t('apiKeySet') : t('apiKeyNotSet') }}
        </a-button>
      </a-tooltip>

      <a-button type="text" style="color:#fff;flex-shrink:0;" @click="toggleLang">
        {{ locale === "zh-CN" ? "EN" : "中文" }}
      </a-button>
    </a-layout-header>

    <a-layout-content style="padding:24px;max-width:1400px;margin:0 auto;width:100%;box-sizing:border-box">
      <router-view />
    </a-layout-content>
  </a-layout>

  <!-- API Key Modal -->
  <a-modal
    v-model:open="keyModalVisible"
    :title="t('apiKeyTitle')"
    :ok-text="t('apiKeySave')"
    :cancel-text="t('cancel')"
    @ok="saveKey"
  >
    <p style="color:#888;margin-bottom:12px;">{{ t('apiKeyDesc') }}</p>
    <a-input-password
      v-model:value="keyInputVal"
      :placeholder="t('apiKeyPlaceholder')"
      allow-clear
      @press-enter="saveKey"
    />
    <div style="margin-top:12px;text-align:right" v-if="hasKey">
      <a-button type="link" danger size="small" @click="removeKey">
        {{ t('apiKeyClear') }}
      </a-button>
    </div>
  </a-modal>
</template>

<style>
body { margin: 0; }
</style>

