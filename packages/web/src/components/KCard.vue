<script setup lang="ts">
import { cn } from "@/lib/cn";

const props = defineProps<{
  class?: string;
  noPadding?: boolean;
}>();
</script>

<template>
  <div :class="cn('card', !noPadding && 'p-5', props.class)">
    <slot />
  </div>
</template>
