<script setup lang="ts">
import { cn } from "@/lib/cn";

const props = defineProps<{
  modelValue?: string;
  placeholder?: string;
  label?: string;
  error?: string;
  type?: string;
  disabled?: boolean;
  class?: string;
  inputClass?: string;
}>();
const emit = defineEmits<{
  "update:modelValue": [v: string];
  enter: [];
}>();
</script>

<template>
  <div :class="cn('flex flex-col gap-1.5', props.class)">
    <label v-if="label" class="text-xs font-medium text-ink-600 leading-none">
      {{ label }}
    </label>
    <input
      :type="type ?? 'text'"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :class="cn(
        'w-full h-10 px-3.5 rounded-xl border text-sm bg-white text-ink-950 placeholder:text-ink-400',
        'border-ink-200 focus:border-sakura-400 focus:ring-2 focus:ring-sakura-400/20 outline-none',
        'transition-all duration-150',
        'disabled:bg-ink-50 disabled:text-ink-400 disabled:cursor-not-allowed',
        error && 'border-rose-400 focus:border-rose-400 focus:ring-rose-400/20',
        props.inputClass
      )"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      @keydown.enter="emit('enter')"
    />
    <p v-if="error" class="text-xs text-rose-500 leading-none">{{ error }}</p>
  </div>
</template>
