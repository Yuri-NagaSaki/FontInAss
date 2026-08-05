<script setup lang="ts">
defineProps<{
  title?: string;
  description?: string;
  icon?: string;
}>();
</script>

<template>
  <div class="flex flex-col items-center justify-center py-16 gap-4 text-center">
    <!-- Sakura illustration (CSS-only) -->
    <div class="relative w-20 h-20 mb-2">
      <div class="absolute inset-0 rounded-full bg-sakura-50 flex items-center justify-center">
        <span class="text-4xl leading-none">{{ icon ?? '🌸' }}</span>
      </div>
      <!-- Decorative petals -->
      <div
        v-for="i in 5" :key="i"
        class="absolute w-3 h-3 rounded-full bg-sakura-200 opacity-60"
        :style="{
          top:  `${50 + 48 * Math.sin((i-1) * 72 * Math.PI / 180)}%`,
          left: `${50 + 48 * Math.cos((i-1) * 72 * Math.PI / 180)}%`,
          transform: 'translate(-50%, -50%)',
        }"
      />
    </div>
    <h3 class="font-display font-semibold text-ink-800 text-base">
      {{ title ?? '暂无内容' }}
    </h3>
    <p v-if="description" class="text-sm text-ink-400 max-w-xs leading-relaxed">
      {{ description }}
    </p>
    <slot />
  </div>
</template>
