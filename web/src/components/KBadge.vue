<script setup lang="ts">
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium leading-none whitespace-nowrap",
  {
    variants: {
      variant: {
        default:   "bg-ink-100 text-ink-600",
        success:   "bg-mint-100 text-mint-600",
        error:     "bg-rose-100 text-rose-600",
        warning:   "bg-amber-100 text-amber-400",
        loading:   "bg-sky-100 text-sky-500",
        sakura:    "bg-sakura-100 text-sakura-600",
        sky:       "bg-sky-100 text-sky-500",
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
    <slot />
  </span>
</template>
