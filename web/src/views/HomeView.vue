<script setup lang="ts">
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { Wand2, Database, Zap } from "lucide-vue-next";
import KButton from "../components/KButton.vue";

const { t } = useI18n();
const router = useRouter();
</script>

<template>
  <div class="flex flex-col gap-12 animate-fade-in">

    <!-- ─── Hero ──────────────────────────────────────────────────────────── -->
    <section class="relative text-center py-16 overflow-hidden">

      <!-- Wordmark -->
      <div class="relative inline-block mb-8">
        <h1 class="font-display font-black text-6xl sm:text-7xl tracking-[-0.035em] leading-[0.9] text-ink-900">
          FontIn<span class="text-sakura-500">Ass</span>
        </h1>
        <span class="absolute -bottom-2 left-1/2 -translate-x-1/2 h-[3px] w-24 rounded-full bg-gradient-to-r from-transparent via-sakura-400 to-transparent" />
      </div>

      <h2 class="font-display font-bold text-3xl sm:text-4xl text-ink-950 mb-4 leading-tight">
        {{ t('heroTitle') }}
      </h2>
      <p class="text-lg text-ink-500 max-w-lg mx-auto leading-relaxed mb-8">
        {{ t('heroDesc') }}
      </p>
      <div class="flex items-center justify-center gap-3">
        <KButton variant="primary" size="lg" @click="router.push('/subset')">
          <span class="text-lg leading-none">🌸</span>
          {{ t('heroAction') }}
        </KButton>
      </div>
    </section>

    <!-- ─── Features ─────────────────────────────────────────────────────── -->
    <section>
      <h2 class="font-display font-semibold text-xl text-center text-ink-800 mb-8">
        {{ t('featuresTitle') }}
      </h2>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <div
          v-for="(f, i) in [
            { icon: Wand2,    key: 'featureSubset',  color: 'sakura' },
            { icon: Database, key: 'featureFonts',   color: 'sky'    },
            { icon: Zap,      key: 'featureSpeed',   color: 'mint'   },
          ]"
          :key="i"
          class="card p-6 flex flex-col gap-3"
        >
          <div
            class="w-11 h-11 rounded-xl flex items-center justify-center"
            :class="{
              'bg-sakura-100': f.color === 'sakura',
              'bg-sky-100':    f.color === 'sky',
              'bg-mint-100':   f.color === 'mint',
            }"
          >
            <component
              :is="f.icon"
              class="w-5 h-5"
              :class="{
                'text-sakura-500': f.color === 'sakura',
                'text-sky-500':    f.color === 'sky',
                'text-mint-600':   f.color === 'mint',
              }"
            />
          </div>
          <h3 class="font-display font-semibold text-ink-900 text-base leading-snug">
            {{ t(f.key + 'Title') }}
          </h3>
          <p class="text-sm text-ink-400 leading-relaxed">
            {{ t(f.key + 'Desc') }}
          </p>
        </div>
      </div>
    </section>

    <!-- ─── How it works ──────────────────────────────────────────────────── -->
    <section class="card p-8 bg-gradient-to-br from-white to-sakura-50/40">
      <h2 class="font-display font-semibold text-xl text-ink-800 mb-7 text-center">{{ t('howTitle') }}</h2>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-6 relative">
        <!-- connector line -->
        <div class="hidden sm:block absolute top-8 left-[calc(16.6%+1rem)] right-[calc(16.6%+1rem)] h-px bg-sakura-200" />
        <div
          v-for="(step, i) in [
            { num: '01', key: 'step1' },
            { num: '02', key: 'step2' },
            { num: '03', key: 'step3' },
          ]"
          :key="i"
          class="relative flex flex-col items-center text-center gap-3"
        >
          <div class="relative w-16 h-16 rounded-2xl bg-surface border-2 border-sakura-200 flex items-center justify-center shadow-[var(--shadow-sm)] z-10">
            <span class="font-display font-bold text-xl text-sakura-400">{{ step.num }}</span>
          </div>
          <p class="text-sm font-medium text-ink-700 leading-snug">{{ t(step.key + 'Title') }}</p>
          <p class="text-xs text-ink-400 leading-relaxed">{{ t(step.key + 'Desc') }}</p>
        </div>
      </div>
    </section>

  </div>
</template>
