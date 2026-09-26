<script setup lang="ts">
import { Inbox } from "lucide-vue-next";
defineProps<{
  title?: string;
  description?: string;
  icon?: string;
}>();
</script>

<template>
  <div class="flex flex-col items-center justify-center py-16 gap-4 text-center">
    <span v-if="icon" class="text-3xl leading-none">{{ icon }}</span>
    <Inbox v-else class="h-8 w-8 text-ink-400" />
    <h3 class="font-display font-semibold text-ink-800 text-base">
      {{ title ?? '暂无内容' }}
    </h3>
    <p v-if="description" class="text-sm text-ink-400 max-w-xs leading-relaxed">
      {{ description }}
    </p>
    <slot />
  </div>
</template>
