<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { ExternalLink } from "lucide-vue-next";

const { t } = useI18n();

const FORUM_HOME = "https://forum.anibt.net/";
const BUG_BOARD = "https://forum.anibt.net/c/bug/3";
</script>

<template>
  <div class="comments-page mx-auto max-w-3xl animate-fade-in">
    <header class="mb-6">
      <h1 class="font-display text-2xl font-bold tracking-tight text-ink-900 sm:text-[1.75rem]">
        {{ t("comments") }}
      </h1>
      <p class="mt-1.5 max-w-2xl text-[0.95rem] leading-relaxed text-ink-500">
        {{ t("commentsDesc") }}
      </p>
    </header>

    <section class="card overflow-hidden">
      <div class="px-5 py-5 sm:px-6 sm:py-6">
        <h2 class="font-display text-base font-semibold text-ink-900">
          {{ t("commentsStepsTitle") }}
        </h2>
        <ol class="mt-4 flex flex-col gap-3">
          <li
            v-for="(step, index) in ['commentsStepForum', 'commentsStepBoard', 'commentsStepPost']"
            :key="step"
            class="flex gap-3"
          >
            <span class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sakura-100 font-display text-xs font-bold text-sakura-600">
              {{ index + 1 }}
            </span>
            <p class="text-sm leading-relaxed text-ink-700">{{ t(step) }}</p>
          </li>
        </ol>

        <div class="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <a
            :href="BUG_BOARD"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sakura-400 to-sakura-500 px-5 text-sm font-medium text-white shadow-[var(--shadow-sm)] transition-all hover:brightness-105 hover:shadow-[var(--shadow-md)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sakura-400 focus-visible:ring-offset-2"
          >
            {{ t("commentsCta") }}
            <ExternalLink class="h-4 w-4" aria-hidden="true" />
          </a>
          <a
            :href="FORUM_HOME"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-sakura-200 bg-sakura-50 px-5 text-sm font-medium text-sakura-600 transition-colors hover:border-sakura-300 hover:bg-sakura-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sakura-400 focus-visible:ring-offset-2"
          >
            {{ t("commentsForumHome") }}
            <ExternalLink class="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      </div>
    </section>
  </div>
</template>
