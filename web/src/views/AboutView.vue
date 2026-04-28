<script setup lang="ts">
import { useI18n } from "vue-i18n";
import {
  Mail, ArrowUpRight, Github, Rss, Heart,
} from "lucide-vue-next";

const { t } = useI18n();

const stack = [
  "Bun", "Hono", "SQLite", "opentype.js",
  "Vue 3", "Tailwind v4", "TypeScript", "Docker",
];
</script>

<template>
  <div class="max-w-3xl mx-auto flex flex-col gap-7 animate-fade-in pb-6">

    <!-- ═══ Header ═════════════════════════════════════════════════════════════ -->
    <header class="pt-2 pb-1">
      <div class="flex items-baseline gap-2.5 mb-2 flex-wrap">
        <h1 class="font-display font-bold text-2xl md:text-[26px] text-ink-900 leading-tight tracking-tight">
          {{ t('aboutTitle') }}
        </h1>
        <span class="text-[11px] font-mono text-ink-400">Local · v1</span>
      </div>
      <p class="text-[15px] text-ink-500 leading-relaxed max-w-2xl">
        {{ t('aboutDesc') }}
      </p>
    </header>

    <!-- ═══ Links (community + repo + projects) ════════════════════════════════ -->
    <section class="flex flex-col">
      <h2 class="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-2 px-1">
        {{ t('communityTitle') }}
      </h2>
      <div class="card p-2 flex flex-col gap-0.5">
        <a
          href="https://t.me/anibtass"
          target="_blank"
          rel="noopener"
          class="group flex items-center gap-3 p-2.5 rounded-lg hover:bg-sky-50/70 transition-colors duration-150"
        >
          <div class="w-8 h-8 rounded-lg bg-sky-50 flex items-center justify-center shrink-0">
            <svg class="w-4 h-4 text-sky-500" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-ink-800 truncate">{{ t('tgGroup') }}</p>
            <p class="text-xs text-ink-400 truncate">{{ t('about.tgGroupDesc') }}</p>
          </div>
          <ArrowUpRight class="w-4 h-4 text-ink-300 group-hover:text-sky-500 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-all duration-150 shrink-0" />
        </a>

        <a
          href="mailto:sa@catcat.blog"
          class="group flex items-center gap-3 p-2.5 rounded-lg hover:bg-mint-50/70 transition-colors duration-150"
        >
          <div class="w-8 h-8 rounded-lg bg-mint-50 flex items-center justify-center shrink-0">
            <Mail class="w-4 h-4 text-mint-500" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-ink-800 truncate">{{ t('emailContact') }}</p>
            <p class="text-xs text-ink-400 truncate">{{ t('about.emailDesc') }}</p>
          </div>
          <ArrowUpRight class="w-4 h-4 text-ink-300 group-hover:text-mint-500 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-all duration-150 shrink-0" />
        </a>

        <a
          href="https://github.com/Yuri-NagaSaki/FontInAss"
          target="_blank"
          rel="noopener"
          class="group flex items-center gap-3 p-2.5 rounded-lg hover:bg-ink-50 transition-colors duration-150"
        >
          <div class="w-8 h-8 rounded-lg bg-ink-900 flex items-center justify-center shrink-0">
            <Github class="w-4 h-4 text-white" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <p class="text-sm font-medium text-ink-800 truncate">{{ t('openSourceRepoTitle') }}</p>
              <span class="font-mono text-[10px] text-ink-400">AGPL-3.0</span>
            </div>
            <p class="text-xs text-ink-400 truncate">{{ t('openSourceRepoDesc') }}</p>
          </div>
          <ArrowUpRight class="w-4 h-4 text-ink-300 group-hover:text-ink-700 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-all duration-150 shrink-0" />
        </a>

        <a
          href="https://anibt.net/"
          target="_blank"
          rel="noopener"
          class="group flex items-center gap-3 p-2.5 rounded-lg hover:bg-mint-50/70 transition-colors duration-150"
        >
          <img
            src="https://anibt.net/favicon-32x32.png"
            alt="AniBT"
            class="w-8 h-8 rounded-lg shrink-0 object-contain bg-ink-50"
            loading="lazy"
            referrerpolicy="no-referrer"
          />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-ink-800 truncate">AniBT</p>
            <p class="text-xs text-ink-400 truncate">{{ t('about.anibtDesc') }}</p>
          </div>
          <ArrowUpRight class="w-4 h-4 text-ink-300 group-hover:text-mint-500 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-all duration-150 shrink-0" />
        </a>

        <a
          href="https://catcat.blog"
          target="_blank"
          rel="noopener"
          class="group flex items-center gap-3 p-2.5 rounded-lg hover:bg-amber-50/70 transition-colors duration-150"
        >
          <div class="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
            <Rss class="w-4 h-4 text-amber-500" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-ink-800 truncate">{{ t('about.blogTitle') }}</p>
            <p class="text-xs text-ink-400 truncate">{{ t('about.blogDesc') }}</p>
          </div>
          <ArrowUpRight class="w-4 h-4 text-ink-300 group-hover:text-amber-500 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-all duration-150 shrink-0" />
        </a>
      </div>
    </section>

    <!-- ═══ Online font library ════════════════════════════════════════════════ -->
    <section class="flex flex-col gap-2">
      <h2 class="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1 px-1">
        {{ t('openSourceTitle') }}
      </h2>
      <div class="card p-5 flex flex-col gap-3">
        <p class="text-sm text-ink-500 leading-relaxed">{{ t('openSourceDesc') }}</p>
        <div class="flex flex-wrap gap-x-6 gap-y-2 pt-1 text-sm">
          <div class="flex items-baseline gap-1.5">
            <span class="font-display font-bold text-ink-900 tabular-nums">~100<span class="text-xs text-ink-400 ml-0.5">GB</span></span>
            <span class="text-xs text-ink-400">{{ t('fontLibSize') }}</span>
          </div>
          <div class="flex items-baseline gap-1.5">
            <span class="font-display font-bold text-ink-900 tabular-nums">4</span>
            <span class="text-xs text-ink-400">{{ t('fontLibSets') }}</span>
          </div>
          <div class="flex items-baseline gap-1.5">
            <span class="font-display font-bold text-ink-900">∞</span>
            <span class="text-xs text-ink-400">{{ t('fontLibGrowing') }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══ Tech stack ═════════════════════════════════════════════════════════ -->
    <section class="flex flex-col gap-2">
      <h2 class="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1 px-1">
        {{ t('techStackTitle') }}
      </h2>
      <div class="card p-5 flex flex-col gap-3">
        <p class="text-sm text-ink-500 leading-relaxed">{{ t('techStackDesc') }}</p>
        <div class="flex flex-wrap gap-1.5">
          <span
            v-for="s in stack"
            :key="s"
            class="inline-flex items-center px-2.5 py-1 rounded-md bg-ink-50 text-ink-600 text-xs font-mono border border-ink-200/60"
          >
            {{ s }}
          </span>
        </div>
      </div>
    </section>

    <!-- ═══ Footer credit ══════════════════════════════════════════════════════ -->
    <footer class="flex items-center justify-center gap-1.5 text-xs text-ink-400 pt-1">
      <span>{{ t('aboutFooterMadeWith') }}</span>
      <Heart class="w-3 h-3 text-sakura-400 fill-sakura-200" />
      <span>·</span>
      <span class="font-mono">FontInAss · Local</span>
    </footer>

  </div>
</template>
