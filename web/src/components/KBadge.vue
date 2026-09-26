<script setup lang="ts">
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium leading-none whitespace-nowrap",
  {
    variants: {
      variant: {
        default:   "bg-ink-100 text-ink-600",
        success:   "bg-ink-50 text-ink-600",
        error:     "bg-ink-50 text-ink-600",
        warning:   "bg-ink-50 text-ink-600",
        loading:   "bg-ink-50 text-ink-600",
        sakura:    "bg-sakura-100 text-sakura-600",
        sky:       "bg-ink-50 text-ink-600",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

type BadgeVariants = VariantProps<typeof badgeVariants>;

const props = defineProps<{
  variant?: BadgeVariants["variant"];
  class?: string;
}>();
</script>

<template>
  <span :class="cn(badgeVariants({ variant }), props.class)">
    <span v-if="variant === 'success' || variant === 'warning' || variant === 'error'" class="h-[7px] w-[7px] shrink-0 rounded-full" :class="variant === 'success' ? 'bg-mint-500' : variant === 'warning' ? 'bg-amber-500' : 'bg-rose-500'" />
    <slot />
  </span>
</template>
