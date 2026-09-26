<script setup lang="ts">
import { useI18n } from "vue-i18n";
const { t } = useI18n();
</script>
<template>
  <div class="page-heading">
    <p class="eyebrow">404</p>
    <h1>{{ t("community.notFound") }}</h1>
    <p>{{ t("community.notFoundDesc") }}</p>
    <RouterLink to="/" class="button button-primary mt-6">{{
      t("navHome")
    }}</RouterLink>
  </div>
</template>
