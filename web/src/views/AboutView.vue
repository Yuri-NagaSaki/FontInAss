<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Cherry, MessageCircle, Mail, Layers, BookOpen, ArrowUpRight, Send, Github, AlertTriangle, Rss } from "lucide-vue-next";

const { t } = useI18n();
</script>

<template>
  <div class="flex flex-col gap-10 animate-fade-in">

    <!-- ─── Header ─────────────────────────────────────────────────────────── -->
    <section class="relative flex items-start gap-5 py-2">
      <div class="relative shrink-0 w-16 h-16 rounded-2xl bg-gradient-to-br from-sakura-300 to-sakura-500 shadow-[var(--shadow-md)] flex items-center justify-center">
        <Cherry class="w-8 h-8 text-white" :stroke-width="1.8" />
      </div>
      <div class="min-w-0">
        <h1 class="font-display font-bold text-2xl text-ink-900 mb-1.5 leading-snug">
          {{ t('aboutTitle') }}
        </h1>
        <p class="text-ink-500 leading-relaxed max-w-2xl text-[15px]">
          {{ t('aboutDesc') }}
        </p>
      </div>
    </section>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-5">

      <!-- ─── Font Request ────────────────────────────────────────────────── -->
      <div class="card p-6 flex flex-col gap-4 bg-gradient-to-br from-sakura-50/60 to-white border-sakura-200/60">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-xl bg-sakura-100 flex items-center justify-center">
            <Send class="w-4 h-4 text-sakura-500" />
          </div>
          <h2 class="font-display font-semibold text-ink-900">{{ t('fontRequestTitle') }}</h2>
        </div>
        <p class="text-sm text-ink-500 leading-relaxed">{{ t('fontRequestDesc') }}</p>
        <div class="flex items-start gap-2.5 p-3 rounded-xl bg-red-50 border border-red-200/60">
          <AlertTriangle class="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <p class="text-sm text-red-600 leading-relaxed font-medium">{{ t('fontRequestWarning') }}</p>
        </div>
        <a
          href="https://t.me/catcat_chat_bot"
          target="_blank"
          rel="noopener"
          class="group mt-auto inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sakura-400 hover:bg-sakura-500 text-white text-sm font-medium transition-colors duration-150 w-fit"
        >
          <MessageCircle class="w-4 h-4" />
          {{ t('fontRequestBot') }}
          <ArrowUpRight class="w-3.5 h-3.5 opacity-70 group-hover:opacity-100 transition-opacity" />
        </a>
      </div>

      <!-- ─── Contact ────────────────────────────────────────────────────── -->
      <div class="card p-6 flex flex-col gap-4">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-xl bg-sky-100 flex items-center justify-center">
            <MessageCircle class="w-4 h-4 text-sky-500" />
          </div>
          <h2 class="font-display font-semibold text-ink-900">{{ t('communityTitle') }}</h2>
        </div>
        <div class="flex flex-col gap-1.5">
          <a
            href="https://t.me/anibtass"
            target="_blank"
            rel="noopener"
            class="group flex items-center gap-3 p-3 rounded-xl hover:bg-ink-50 transition-colors duration-150"
          >
            <div class="w-8 h-8 rounded-lg bg-sky-50 flex items-center justify-center shrink-0">
              <svg class="w-4 h-4 text-sky-400" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-ink-800">{{ t('tgGroup') }}</p>
              <p class="text-xs text-ink-400">{{ t('about.tgGroupDesc') }}</p>
            </div>
            <ArrowUpRight class="w-3.5 h-3.5 text-ink-300 group-hover:text-ink-500 transition-colors shrink-0" />
          </a>
          <a
            href="mailto:sa@catcat.blog"
            class="group flex items-center gap-3 p-3 rounded-xl hover:bg-ink-50 transition-colors duration-150"
          >
            <div class="w-8 h-8 rounded-lg bg-mint-50 flex items-center justify-center shrink-0">
              <Mail class="w-4 h-4 text-mint-500" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-ink-800">{{ t('emailContact') }}</p>
              <p class="text-xs text-ink-400">{{ t('about.emailDesc') }}</p>
            </div>
            <ArrowUpRight class="w-3.5 h-3.5 text-ink-300 group-hover:text-ink-500 transition-colors shrink-0" />
          </a>
        </div>
      </div>

      <!-- ─── Open Source ────────────────────────────────────────────────── -->
      <div class="card p-6 flex flex-col gap-4">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-xl bg-ink-100 flex items-center justify-center">
            <Github class="w-4 h-4 text-ink-700" />
          </div>
          <h2 class="font-display font-semibold text-ink-900">{{ t('openSourceRepoTitle') }}</h2>
        </div>
        <p class="text-sm text-ink-500 leading-relaxed">{{ t('openSourceRepoDesc') }}</p>
        <a
          href="https://github.com/Yuri-NagaSaki/FontInAss"
          target="_blank"
          rel="noopener"
          class="group inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-ink-800 hover:bg-ink-900 text-white text-sm font-medium transition-colors duration-150 w-fit"
        >
          <Github class="w-4 h-4" />
          {{ t('about.viewOnGitHub') }}
          <ArrowUpRight class="w-3.5 h-3.5 opacity-70 group-hover:opacity-100 transition-opacity" />
        </a>
      </div>

      <!-- ─── My Projects ───────────────────────────────────────────────── -->
      <div class="card p-6 flex flex-col gap-4">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-xl bg-mint-100 flex items-center justify-center">
            <Layers class="w-4 h-4 text-mint-600" />
          </div>
          <h2 class="font-display font-semibold text-ink-900">{{ t('myProjectsTitle') }}</h2>
        </div>
        <div class="flex flex-col gap-1.5">
          <a
            href="https://anibt.net/"
            target="_blank"
            rel="noopener"
            class="group flex items-center gap-3 p-3 rounded-xl hover:bg-ink-50 transition-colors duration-150"
          >
            <img src="https://anibt.net/favicon-32x32.png" alt="AniBT" class="w-8 h-8 rounded-lg shrink-0 object-contain" />
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-ink-800">AniBT</p>
              <p class="text-xs text-ink-400">{{ t('about.anibtDesc') }}</p>
            </div>
            <ArrowUpRight class="w-3.5 h-3.5 text-ink-300 group-hover:text-ink-500 transition-colors shrink-0" />
          </a>
          <a
            href="https://catcat.blog"
            target="_blank"
            rel="noopener"
            class="group flex items-center gap-3 p-3 rounded-xl hover:bg-ink-50 transition-colors duration-150"
          >
            <div class="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
              <Rss class="w-4 h-4 text-amber-500" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-ink-800">{{ t('about.blogTitle') }}</p>
              <p class="text-xs text-ink-400">{{ t('about.blogDesc') }}</p>
            </div>
            <ArrowUpRight class="w-3.5 h-3.5 text-ink-300 group-hover:text-ink-500 transition-colors shrink-0" />
          </a>
        </div>
      </div>

      <!-- ─── Font Library ───────────────────────────────────────────────── -->
      <div class="card p-6 flex flex-col gap-4">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center">
            <BookOpen class="w-4 h-4 text-amber-500" />
          </div>
          <h2 class="font-display font-semibold text-ink-900">{{ t('openSourceTitle') }}</h2>
        </div>
        <p class="text-sm text-ink-500 leading-relaxed">{{ t('openSourceDesc') }}</p>
        <div class="flex items-center gap-4 pt-1">
          <div class="text-center">
            <p class="font-display font-bold text-2xl text-ink-900">~100 GB</p>
            <p class="text-xs text-ink-400 mt-0.5">{{ t('fontLibSize') }}</p>
          </div>
          <div class="w-px h-8 bg-ink-200" />
          <div class="text-center">
            <p class="font-display font-bold text-2xl text-ink-900">4</p>
            <p class="text-xs text-ink-400 mt-0.5">{{ t('fontLibSets') }}</p>
          </div>
          <div class="w-px h-8 bg-ink-200" />
          <div class="text-center">
            <p class="font-display font-bold text-2xl text-ink-900">∞</p>
            <p class="text-xs text-ink-400 mt-0.5">{{ t('fontLibGrowing') }}</p>
          </div>
        </div>
      </div>

      <!-- ─── Tech Stack ─────────────────────────────────────────────────── -->
      <div class="card p-6 flex flex-col gap-4">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-xl bg-rose-100 flex items-center justify-center">
            <Layers class="w-4 h-4 text-rose-500" />
          </div>
          <h2 class="font-display font-semibold text-ink-900">{{ t('techStackTitle') }}</h2>
        </div>
        <p class="text-sm text-ink-500 leading-relaxed">{{ t('techStackDesc') }}</p>
        <div class="flex flex-wrap gap-2 pt-1">
          <span
            v-for="tech in ['Bun','Hono','SQLite','opentype.js','Vue 3','Tailwind v4','TypeScript','Docker']"
            :key="tech"
            class="inline-flex items-center h-6 px-2.5 rounded-lg bg-ink-100 text-xs font-mono text-ink-600"
          >{{ tech }}</span>
        </div>
      </div>

    </div>

  </div>
</template>
