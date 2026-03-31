<script setup lang="ts">
import { ref, onActivated, onDeactivated } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { Cherry, Wand2, Database, Zap } from "lucide-vue-next";
import KButton from "../components/KButton.vue";

const { t } = useI18n();
const router = useRouter();

// Pause petal animations when the view is cached but not visible (keep-alive)
const animationsActive = ref(true);
onActivated(() => { animationsActive.value = true; });
onDeactivated(() => { animationsActive.value = false; });
</script>

<template>
  <div class="flex flex-col gap-12 animate-fade-in">

    <!-- ─── Hero ──────────────────────────────────────────────────────────── -->
    <section class="relative text-center py-16 overflow-hidden">
      <!-- Background petals (decorative) -->
      <div class="absolute inset-0 pointer-events-none select-none overflow-hidden" aria-hidden="true">
        <span class="absolute top-4 left-[8%]  text-5xl opacity-10" :class="animationsActive && 'animate-petal-drift'" style="animation-delay:-1s">🌸</span>
        <span class="absolute top-12 right-[10%] text-4xl opacity-10" :class="animationsActive && 'animate-petal-drift'" style="animation-delay:-3.5s">🌸</span>
        <span class="absolute bottom-6 left-[22%] text-3xl opacity-10" :class="animationsActive && 'animate-petal-drift'" style="animation-delay:-2s">🌸</span>
        <span class="absolute bottom-4 right-[18%] text-5xl opacity-10" :class="animationsActive && 'animate-petal-drift'" style="animation-delay:-4.5s">🌸</span>
      </div>

      <!-- Logo mark -->
      <div class="relative inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-sakura-300 to-sakura-500 shadow-[var(--shadow-lg)] mb-6">
        <Cherry class="w-10 h-10 text-white" :stroke-width="1.8" />
        <!-- Shimmer ring -->
        <div class="absolute inset-0 rounded-3xl ring-2 ring-sakura-300/40 ring-offset-2 ring-offset-white/0" />
      </div>

      <h1 class="font-display font-bold text-4xl sm:text-5xl text-ink-950 mb-4 leading-tight">
        {{ t('heroTitle') }}
      </h1>
      <p class="text-lg text-ink-500 max-w-lg mx-auto leading-relaxed mb-8">
        {{ t('heroDesc') }}
      </p>
      <div class="flex items-center justify-center gap-3">
        <KButton variant="primary" size="lg" @click="router.push('/subset')">
          <Cherry class="w-5 h-5" />
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
