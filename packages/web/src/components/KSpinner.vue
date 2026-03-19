<script setup lang="ts">
import { cn } from "@/lib/cn";

const props = defineProps<{
  size?: "sm" | "md" | "lg";
  class?: string;
}>();
</script>

<template>
  <svg
    :class="cn(
      'animate-spin-slow shrink-0',
      props.size === 'sm' ? 'h-4 w-4' : props.size === 'lg' ? 'h-8 w-8' : 'h-5 w-5',
      props.class
    )"
    viewBox="0 0 24 24"
    fill="none"
    aria-label="Loading"
  >
    <circle
      class="opacity-20"
      cx="12" cy="12" r="10"
      stroke="currentColor"
      stroke-width="3"
    />
    <path
      class="opacity-80"
      fill="currentColor"
      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
    />
  </svg>
</template>
