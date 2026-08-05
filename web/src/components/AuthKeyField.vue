<script setup lang="ts">
import { ref } from "vue";
import { Eye, EyeOff, KeyRound } from "lucide-vue-next";
import { cn } from "@/lib/cn";

const props = defineProps<{
  modelValue: string;
  placeholder?: string;
  label?: string;
  autofocus?: boolean;
  size?: "md" | "lg";
  class?: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  enter: [];
}>();

const visible = ref(false);
const inputRef = ref<HTMLInputElement | null>(null);

defineExpose({
  focus: () => inputRef.value?.focus(),
});
</script>

<template>
  <div :class="cn('flex flex-col gap-1.5', props.class)">
    <label v-if="label" class="text-xs font-medium text-ink-500">
      {{ label }}
    </label>
    <div class="relative">
      <KeyRound
        class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-300"
        :class="size === 'lg' ? 'w-4 h-4' : 'w-3.5 h-3.5'"
      />
      <input
        ref="inputRef"
        :type="visible ? 'text' : 'password'"
        :value="modelValue"
        :placeholder="placeholder"
        :autofocus="autofocus"
        autocomplete="current-password"
        spellcheck="false"
        :class="cn(
          'w-full rounded-xl border border-ink-200 bg-surface font-mono text-ink-900 placeholder:text-ink-300',
          'focus:border-sakura-400 focus:ring-2 focus:ring-sakura-400/20 outline-none',
          'transition-colors duration-150',
          size === 'lg' ? 'h-11 pl-10 pr-11 text-sm' : 'h-10 pl-9 pr-10 text-sm',
        )"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        @keydown.enter="emit('enter')"
      />
      <button
        type="button"
        class="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-lg text-ink-300 hover:bg-ink-50 hover:text-ink-600 transition-colors"
        :aria-label="visible ? 'Hide' : 'Show'"
        @click="visible = !visible"
      >
        <EyeOff v-if="visible" class="w-3.5 h-3.5" />
        <Eye v-else class="w-3.5 h-3.5" />
      </button>
    </div>
  </div>
</template>
