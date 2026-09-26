<script setup lang="ts">
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 font-medium rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-sakura-400 disabled:pointer-events-none disabled:opacity-50 select-none whitespace-nowrap",
  {
    variants: {
      variant: {
        primary:
          "bg-sakura-500 text-[var(--accent-ink)] font-bold hover:brightness-95",
        secondary:
          "bg-ink-50 text-ink-800 hover:bg-ink-100 hover:text-sakura-600",
        sky:
          "bg-ink-50 text-ink-800 hover:bg-ink-100 hover:text-sakura-600",
        ghost:
          "text-ink-600 hover:bg-sakura-50 hover:text-sakura-600",
        danger:
          "text-rose-600 hover:bg-rose-100",
        outline:
          "bg-ink-50 text-ink-700 hover:bg-ink-100 hover:text-sakura-600",
      },
      size: {
        xs: "h-7 px-2.5 text-xs",
        sm: "h-8 px-3 text-sm",
        md: "h-[34px] px-4 text-[13px]",
        lg: "h-10 px-5 text-[13px]",
        icon: "h-9 w-9",
        "icon-sm": "h-7 w-7 rounded-lg",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
);

type ButtonVariants = VariantProps<typeof buttonVariants>;

const props = withDefaults(defineProps<{
  variant?: ButtonVariants["variant"];
  size?: ButtonVariants["size"];
  loading?: boolean;
  disabled?: boolean;
  class?: string;
}>(), {
  variant: "primary",
  size: "md",
});

const emit = defineEmits<{ click: [e: MouseEvent] }>();
</script>

<template>
  <button
    :class="cn(buttonVariants({ variant, size }), props.class)"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
    @click="emit('click', $event)"
  >
    <svg
      v-if="loading"
      class="animate-spin-slow h-4 w-4 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"/>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
    </svg>
    <slot />
  </button>
</template>
