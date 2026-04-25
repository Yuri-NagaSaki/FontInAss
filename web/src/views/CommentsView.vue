<script setup lang="ts">
import { ref, onMounted, onActivated, onUnmounted, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { Loader2, RefreshCw } from "lucide-vue-next";
import { preloadWalineAssets, WALINE_SERVER } from "../lib/waline-loader";

const { t, locale } = useI18n();

const walineEl = ref<HTMLDivElement>();
const isLoaded = ref(false);
const loadError = ref(false);
let walineController: { update?: (opts: Record<string, unknown>) => void; destroy?: () => void } | null = null;
const styleEl = shallowRef<HTMLStyleElement | null>(null);
let renderObserver: MutationObserver | null = null;
let loadFallbackTimer: number | null = null;

function markLoaded() {
  if (isLoaded.value) return;
  isLoaded.value = true;
  if (loadFallbackTimer !== null) {
    window.clearTimeout(loadFallbackTimer);
    loadFallbackTimer = null;
  }
}

onMounted(async () => {
  if (!walineEl.value) return;

  try {
    const walineModule = await preloadWalineAssets();

    if (!document.getElementById("waline-overrides")) {
      const style = document.createElement("style");
      style.id = "waline-overrides";
      style.textContent = WALINE_OVERRIDE_CSS;
      document.head.appendChild(style);
      styleEl.value = style;
    }

    walineController = walineModule.init({
      el: walineEl.value,
      serverURL: WALINE_SERVER,
      lang: locale.value === "zh-CN" ? "zh-CN" : "en",
      emoji: false,
      meta: ["nick", "mail"],
      requiredMeta: ["nick"],
      pageSize: 10,
      dark: "html.dark",
      comment: true,
      reaction: false,
      imageUploader: false,
      search: false,
    });

    renderObserver = new MutationObserver(() => {
      if (walineEl.value?.querySelector(".wl-editor-wrap, .wl-cards, .wl-empty")) {
        markLoaded();
        renderObserver?.disconnect();
        renderObserver = null;
      }
    });
    renderObserver.observe(walineEl.value, { childList: true, subtree: true });
    loadFallbackTimer = window.setTimeout(markLoaded, 4200);
  } catch {
    loadError.value = true;
    markLoaded();
  }
});

onActivated(() => { walineController?.update?.({}); });

onUnmounted(() => {
  renderObserver?.disconnect();
  renderObserver = null;
  if (loadFallbackTimer !== null) {
    window.clearTimeout(loadFallbackTimer);
    loadFallbackTimer = null;
  }
  walineController?.destroy?.();
  walineController = null;
  styleEl.value?.remove();
});

const WALINE_OVERRIDE_CSS = /* css */ `
:root{--waline-font-size:.875rem;--waline-white:oklch(99% .004 355);--waline-theme-color:oklch(63% .210 345);--waline-active-color:oklch(55% .195 343);--waline-color:oklch(25% .018 355);--waline-bg-color:transparent;--waline-bg-color-light:oklch(98.5% .010 355);--waline-bg-color-hover:oklch(97% .018 355);--waline-border-color:oklch(90% .030 350);--waline-disable-bg-color:oklch(96% .006 355);--waline-disable-color:oklch(62% .012 355);--waline-code-bg-color:oklch(23% .020 260);--waline-bq-color:oklch(94% .030 350);--waline-color-light:oklch(55% .012 355);--waline-info-bg-color:oklch(97% .010 355);--waline-info-color:oklch(56% .012 355);--waline-info-font-size:.68em;--waline-badge-color:oklch(63% .18 345);--waline-badge-font-size:.65em;--waline-avatar-size:2.45rem;--waline-m-avatar-size:2rem;--waline-avatar-radius:999px;--waline-border:1px solid var(--waline-border-color);--waline-border-radius:1rem;--waline-box-shadow:none;--waline-dark-grey:oklch(43% .012 355);--waline-light-grey:oklch(60% .010 355);--waline-warning-color:oklch(56% .12 60);--waline-warning-bg-color:oklch(95% .04 75/.48)}
.dark{--waline-white:oklch(18% .008 355);--waline-color:oklch(91% .006 355);--waline-bg-color:transparent;--waline-bg-color-light:oklch(21% .010 355);--waline-bg-color-hover:oklch(25% .014 355);--waline-border-color:oklch(31% .018 355);--waline-disable-bg-color:oklch(22% .006 355);--waline-disable-color:oklch(47% .010 355);--waline-code-bg-color:oklch(14% .014 260);--waline-bq-color:oklch(25% .018 355);--waline-color-light:oklch(62% .010 355);--waline-info-bg-color:oklch(23% .010 355);--waline-info-color:oklch(56% .010 355);--waline-badge-color:oklch(73% .16 350);--waline-dark-grey:oklch(64% .010 355);--waline-light-grey:oklch(50% .010 355);--waline-warning-color:oklch(72% .10 60);--waline-warning-bg-color:oklch(25% .04 75/.42)}
[data-waline]{font-family:var(--font-body)!important;color:var(--waline-color)!important}[data-waline] *{box-sizing:border-box!important}
.comments-waline .wl-panel{position:relative!important;margin:0!important;padding:0!important;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important}
.comments-waline .wl-panel::before{content:"";position:absolute;left:1.2rem;right:1.2rem;top:-.55rem;height:1px;background:linear-gradient(90deg,transparent,oklch(81% .110 348/.42),transparent);pointer-events:none}
.comments-waline .wl-header{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:.65rem!important;margin:0 0 .8rem!important;padding:0!important;border:0!important}
.comments-waline .wl-header-item{display:flex!important;align-items:center!important;min-width:0!important;border:1px solid var(--waline-border-color)!important;border-radius:1rem!important;background:linear-gradient(180deg,var(--waline-bg-color-light),oklch(99% .006 355/.72))!important;overflow:hidden!important;transition:border-color .18s var(--ease-out-quart),background .18s var(--ease-out-quart),box-shadow .18s var(--ease-out-quart),transform .18s var(--ease-out-quart)!important}
.dark .comments-waline .wl-header-item{background:linear-gradient(180deg,var(--waline-bg-color-light),oklch(19% .008 355/.86))!important}
.comments-waline .wl-header-item:focus-within{border-color:oklch(72% .175 347)!important;background:var(--waline-white)!important;box-shadow:0 0 0 4px oklch(72% .175 347/.13)!important;transform:translateY(-1px)!important}
.comments-waline .wl-header label{padding:.58rem .35rem .58rem .8rem!important;min-width:auto!important;font-size:.68rem!important;font-weight:800!important;letter-spacing:.08em!important;text-transform:uppercase!important;color:var(--waline-color-light)!important;white-space:nowrap!important}
.comments-waline .wl-header input{min-width:0!important;flex:1!important;padding:.62rem .85rem .62rem .25rem!important;border:0!important;background:transparent!important;color:var(--waline-color)!important;outline:0!important;font-size:.82rem!important}
.comments-waline .wl-editor{min-height:9.25rem!important;width:100%!important;margin:0!important;padding:1rem 1.08rem!important;border:1px solid var(--waline-border-color)!important;border-radius:1.25rem!important;background:linear-gradient(180deg,oklch(100% 0 0/.92),oklch(98.5% .010 355/.92))!important;color:var(--waline-color)!important;font-size:.9rem!important;line-height:1.75!important;box-shadow:inset 0 1px 0 oklch(100% 0 0/.7)!important;transition:border-color .18s var(--ease-out-quart),box-shadow .18s var(--ease-out-quart),background .18s var(--ease-out-quart)!important}
.dark .comments-waline .wl-editor{background:linear-gradient(180deg,oklch(22% .010 355/.94),oklch(18% .008 355/.94))!important;box-shadow:inset 0 1px 0 oklch(100% 0 0/.05)!important}
.comments-waline .wl-editor:focus,.comments-waline .wl-editor:focus-within{border-color:oklch(72% .175 347)!important;box-shadow:0 0 0 4px oklch(72% .175 347/.13),inset 0 1px 0 oklch(100% 0 0/.72)!important;background:var(--waline-white)!important}
.comments-waline .wl-footer{display:flex!important;align-items:center!important;margin:.82rem 0 0!important;padding:0!important;gap:.55rem!important}
.comments-waline .wl-action{width:1.95rem!important;height:1.95rem!important;border-radius:.75rem!important;color:var(--waline-color-light)!important;transition:color .16s var(--ease-out-quart),background .16s var(--ease-out-quart),transform .16s var(--ease-out-quart)!important}
.comments-waline .wl-action:hover{color:var(--waline-theme-color)!important;background:oklch(72% .175 347/.10)!important;transform:translateY(-1px)!important}
.comments-waline .wl-btn{border-radius:.82rem!important;font-size:.76rem!important;font-weight:800!important;letter-spacing:.02em!important;padding:.55rem 1.08rem!important;transition:transform .18s var(--ease-out-quart),box-shadow .18s var(--ease-out-quart),background .18s var(--ease-out-quart)!important}
.comments-waline .wl-btn.primary{border-color:oklch(63% .210 345)!important;background:linear-gradient(135deg,oklch(72% .175 347),oklch(63% .210 345))!important;color:oklch(99% .004 355)!important;box-shadow:0 10px 24px oklch(63% .21 345/.22)!important}
.comments-waline .wl-btn.primary:hover{transform:translateY(-2px)!important;box-shadow:0 14px 30px oklch(63% .21 345/.28)!important}
.comments-waline .wl-btn.primary:active{transform:translateY(0)!important;box-shadow:0 6px 14px oklch(63% .21 345/.20)!important}
.comments-waline .wl-count{font-family:var(--font-display)!important;font-size:1rem!important;font-weight:800!important;color:var(--waline-color)!important}
.comments-waline .wl-sort{gap:.35rem!important}.comments-waline .wl-sort li{border-radius:999px!important;padding:.25rem .72rem!important;font-size:.7rem!important;font-weight:700!important;color:var(--waline-color-light)!important;transition:background .16s var(--ease-out-quart),color .16s var(--ease-out-quart)!important}
.comments-waline .wl-sort .active{background:oklch(72% .175 347/.12)!important;color:var(--waline-theme-color)!important}
.comments-waline .wl-cards{position:relative!important;margin-top:1.15rem!important;padding:.3rem 0 0 1.15rem!important}
.comments-waline .wl-cards::before{content:"";position:absolute;left:.32rem;top:.6rem;bottom:.55rem;width:1px;background:linear-gradient(180deg,oklch(81% .110 348/.0),oklch(81% .110 348/.38),oklch(81% .110 348/.0));pointer-events:none}
.comments-waline .wl-cards>.wl-item{position:relative!important;margin:.65rem 0 0!important;padding:1rem 1.05rem!important;border:1px solid var(--waline-border-color)!important;border-radius:1.2rem!important;background:linear-gradient(180deg,var(--waline-white),var(--waline-bg-color-light))!important;box-shadow:0 10px 28px oklch(70% .20 350/.07)!important;transition:transform .18s var(--ease-out-quart),border-color .18s var(--ease-out-quart),box-shadow .18s var(--ease-out-quart)!important}
.dark .comments-waline .wl-cards>.wl-item{background:linear-gradient(180deg,oklch(21% .010 355),oklch(18% .008 355))!important;box-shadow:0 12px 30px oklch(0% 0 0/.18)!important}
.comments-waline .wl-cards>.wl-item::before{content:"";position:absolute;left:-1.08rem;top:1.25rem;width:.48rem;height:.48rem;border-radius:999px;background:oklch(72% .175 347);box-shadow:0 0 0 5px oklch(72% .175 347/.12)!important}
.comments-waline .wl-cards>.wl-item:hover{transform:translateY(-2px)!important;border-color:oklch(81% .110 348/.8)!important;box-shadow:0 16px 34px oklch(70% .20 350/.11)!important}
.comments-waline .wl-avatar,.comments-waline .wl-user .wl-avatar{border:2px solid var(--waline-white)!important;box-shadow:0 0 0 1px var(--waline-border-color),0 7px 18px oklch(70% .20 350/.12)!important}
.comments-waline .wl-user img{transition:transform .2s var(--ease-out-quart)!important}.comments-waline .wl-user img:hover{transform:scale(1.06) rotate(-2deg)!important}
.comments-waline .wl-nick{font-family:var(--font-display)!important;font-weight:800!important;font-size:.9rem!important;color:var(--waline-color)!important}.comments-waline .wl-badge{border-radius:999px!important;padding:.12em .5em!important;font-weight:800!important;letter-spacing:.04em!important}
.comments-waline .wl-time{font-size:.7rem!important;color:var(--waline-color-light)!important}.comments-waline .wl-content{font-size:.86rem!important;line-height:1.78!important;color:var(--waline-color)!important}
.comments-waline .wl-content p{margin:.45em 0!important}.comments-waline .wl-card .wl-content .wl-reply-to{float:left!important;margin:0 .45em 0 0!important;line-height:2!important}
.comments-waline .wl-reply-to a{background:oklch(72% .175 347/.10)!important;color:var(--waline-theme-color)!important;padding:.12em .5em!important;border-radius:999px!important;font-size:.75rem!important;font-weight:800!important}.dark .comments-waline .wl-reply-to a{background:oklch(72% .175 347/.16)!important}
.comments-waline .wl-comment-actions button{font-size:.7rem!important;font-weight:700!important;padding:.18rem .48rem!important;border-radius:999px!important;color:var(--waline-color-light)!important;transition:background .16s var(--ease-out-quart),color .16s var(--ease-out-quart)!important}
.comments-waline .wl-comment-actions button:hover{color:var(--waline-theme-color)!important;background:oklch(72% .175 347/.08)!important}.comments-waline .wl-like.active{color:oklch(60% .20 15)!important}
.comments-waline .wl-quote{border-inline-start:2px solid var(--waline-border-color)!important;padding-inline-start:.75rem!important;margin:.55rem 0 0!important}.comments-waline .wl-quote .wl-item{padding:.5rem 0!important}
.comments-waline .wl-comment .wl-panel{border-radius:1rem!important;border:1px solid var(--waline-border-color)!important;background:var(--waline-bg-color-light)!important;padding:.85rem!important;margin:.8rem 0 0!important}
.comments-waline .wl-empty{padding:2.5rem 1rem!important;font-size:.86rem!important;color:var(--waline-color-light)!important;text-align:center!important}.comments-waline .wl-loading{padding:2rem 0!important}.comments-waline .wl-loading svg circle{stroke:var(--waline-theme-color)!important}
.comments-waline .wl-power{font-size:.65rem!important;opacity:.34!important;margin-top:1.4rem!important;transition:opacity .2s var(--ease-out-quart)!important}.comments-waline .wl-power:hover{opacity:.62!important}
.comments-waline .wl-preview{border-top:1px dashed var(--waline-border-color)!important;margin:.6rem 0 0!important;padding:.8rem 0 0!important}.comments-waline .wl-preview h4{font-size:.7rem!important;font-weight:800!important;color:var(--waline-color-light)!important;text-transform:uppercase!important;letter-spacing:.08em!important}
.comments-waline .wl-operation{padding:1rem 0 .5rem!important}.comments-waline .wl-operation button{border-radius:.8rem!important;font-size:.75rem!important;font-weight:800!important;transition:all .18s var(--ease-out-quart)!important}
[data-waline] blockquote{border-inline-start:3px solid oklch(72% .175 347/.32)!important;background:oklch(72% .175 347/.045)!important;border-radius:0 .72rem .72rem 0!important;padding:.55rem .8rem!important}[data-waline] code{border-radius:.45rem!important;font-size:.82em!important;padding:.15em .38em!important}
@media (max-width:640px){.comments-waline .wl-header{grid-template-columns:1fr!important}.comments-waline .wl-cards{padding-left:.85rem!important}.comments-waline .wl-cards>.wl-item::before{left:-.83rem!important}}
`;
</script>

<template>
  <div class="comments-page mx-auto max-w-4xl px-4 py-7 sm:px-5 sm:py-10">
    <section class="comments-shell relative overflow-hidden rounded-[2rem] border border-sakura-100 bg-surface p-3 shadow-[var(--shadow-md)] sm:p-4">
      <div class="comments-shell-glow" aria-hidden="true" />

      <div class="comments-board relative min-h-[560px] rounded-[1.65rem] border border-sakura-100 bg-[color-mix(in_oklch,var(--color-surface)_88%,var(--color-sakura-50))] p-3 sm:p-4">
        <div class="comments-board-header flex items-center justify-between gap-3 px-2 pb-3 sm:px-3">
          <div>
            <p class="font-display text-xl font-black tracking-[-0.03em] text-ink-950">{{ t("comments") }}</p>
            <p class="text-xs text-ink-400">{{ t("commentsDesc") }}</p>
          </div>
          <div
            class="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold"
            :class="isLoaded ? 'border-mint-200 bg-mint-50 text-mint-600' : 'border-sakura-200 bg-sakura-50 text-sakura-600'"
          >
            <Loader2 v-if="!isLoaded" class="h-3.5 w-3.5 animate-spin-slow" />
            <span v-else class="h-2 w-2 rounded-full bg-mint-500" />
            {{ isLoaded ? t("commentsReady") : t("commentsLoading") }}
          </div>
        </div>

        <div v-if="loadError" class="comments-error flex min-h-[420px] flex-col items-center justify-center rounded-[1.35rem] border border-rose-200 bg-rose-50/70 p-8 text-center">
          <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface text-rose-500 shadow-[var(--shadow-sm)]">
            <RefreshCw class="h-5 w-5" />
          </div>
          <p class="font-display text-lg font-bold text-ink-900">{{ t("commentsLoadError") }}</p>
          <button
            class="mt-4 inline-flex items-center gap-2 rounded-xl bg-rose-500 px-4 py-2 text-sm font-bold text-white transition-transform duration-150 hover:-translate-y-0.5"
            @click="$router.go(0)"
          >
            <RefreshCw class="h-4 w-4" />
            {{ t("retry") }}
          </button>
        </div>

        <div
          v-else
          ref="walineEl"
          class="comments-waline rounded-[1.35rem] border border-sakura-100 bg-surface/85 p-4 shadow-[inset_0_1px_0_oklch(100%_0_0/.55)] transition-opacity duration-300 sm:p-5"
          :class="isLoaded ? 'opacity-100' : 'opacity-0'"
        />

        <Transition leave-active-class="transition-opacity duration-300" leave-to-class="opacity-0">
          <div v-if="!isLoaded" class="comments-loading absolute inset-x-3 top-[4.65rem] bottom-3 rounded-[1.35rem] border border-sakura-100 bg-surface/95 p-4 sm:inset-x-4 sm:bottom-4 sm:p-5">
            <div class="space-y-4">
              <div class="grid gap-3 sm:grid-cols-2">
                <div class="h-11 rounded-2xl bg-sakura-50 animate-pulse" />
                <div class="h-11 rounded-2xl bg-sakura-50 animate-pulse [animation-delay:80ms]" />
              </div>
              <div class="h-36 rounded-[1.25rem] bg-sakura-50 animate-pulse [animation-delay:140ms]" />
              <div class="flex justify-end">
                <div class="h-10 w-24 rounded-xl bg-sakura-100 animate-pulse [animation-delay:180ms]" />
              </div>
            </div>
            <div class="mt-7 space-y-4">
              <div v-for="i in 3" :key="i" class="flex gap-3">
                <div class="h-10 w-10 shrink-0 rounded-full bg-sakura-50 animate-pulse" :style="{ animationDelay: `${i * 90}ms` }" />
                <div class="flex-1 rounded-2xl border border-sakura-50 p-4">
                  <div class="h-3 rounded-full bg-sakura-100 animate-pulse" :style="{ width: `${72 + i * 12}px`, animationDelay: `${i * 90}ms` }" />
                  <div class="mt-3 h-3 rounded-full bg-sakura-50 animate-pulse" :style="{ animationDelay: `${i * 110}ms` }" />
                  <div class="mt-2 h-3 rounded-full bg-sakura-50/70 animate-pulse" :style="{ width: `${46 + i * 10}%`, animationDelay: `${i * 130}ms` }" />
                </div>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </section>
  </div>
</template>

<style scoped>
.comments-shell {
  background:
    radial-gradient(circle at 8% 8%, oklch(89% .055 350 / .32), transparent 22rem),
    radial-gradient(circle at 95% 10%, oklch(84% .085 222 / .18), transparent 20rem),
    linear-gradient(135deg, var(--color-surface), color-mix(in oklch, var(--color-surface) 82%, var(--color-sakura-50)));
}

.comments-shell-glow {
  position: absolute;
  inset: auto -12% -40% 20%;
  height: 18rem;
  border-radius: 999px;
  background: radial-gradient(circle, oklch(72% .175 347 / .16), transparent 68%);
  filter: blur(22px);
  pointer-events: none;
}

.comments-board {
  isolation: isolate;
}

.comments-board::before {
  content: "";
  position: absolute;
  inset: 0.55rem;
  z-index: -1;
  border-radius: 1.45rem;
  background:
    linear-gradient(90deg, oklch(92% .015 355 / .34) 1px, transparent 1px),
    linear-gradient(0deg, oklch(92% .015 355 / .30) 1px, transparent 1px);
  background-size: 22px 22px;
  mask-image: linear-gradient(180deg, black, transparent 86%);
  opacity: .42;
}

.comments-loading {
  box-shadow: inset 0 1px 0 oklch(100% 0 0 / .6);
}

@media (prefers-reduced-motion: reduce) {
  .comments-page *,
  .comments-page *::before,
  .comments-page *::after {
    animation-duration: 0.001ms !important;
    transition-duration: 0.001ms !important;
  }
}
</style>
