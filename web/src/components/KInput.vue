<script setup lang="ts">
import { useId } from "vue";
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
const inputId = useId();
const emit = defineEmits<{
  "update:modelValue": [v: string];
  enter: [];
}>();
</script>

<template>
  <div :class="cn('flex flex-col gap-1.5', props.class)">
    <label v-if="label" :for="inputId" class="text-xs font-medium text-ink-600 leading-none">
      {{ label }}
    </label>
    <input
      :id="inputId"
      :aria-label="label || placeholder"
      :aria-invalid="!!error || undefined"
      :aria-describedby="error ? inputId + '-error' : undefined"
      :type="type ?? 'text'"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :class="cn(
        'w-full h-10 px-3.5 rounded-[10px] border-2 border-transparent text-sm bg-ink-50 text-ink-950 placeholder:text-ink-400',
        'focus:border-sakura-400 outline-none',
        'transition-all duration-150',
        'disabled:bg-ink-50 disabled:text-ink-400 disabled:cursor-not-allowed',
        error && 'border-rose-400 focus:border-rose-400 focus:ring-rose-400/20',
        props.inputClass
      )"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      @keydown.enter="emit('enter')"
    />
    <p v-if="error" :id="inputId + '-error'" class="text-xs text-rose-500 leading-none">{{ error }}</p>
  </div>
</template>
