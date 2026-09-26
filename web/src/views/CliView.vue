<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { ref, onUnmounted } from "vue";
import { Copy, Check, ArrowUpRight, Download } from "lucide-vue-next";
import { copyToClipboard } from "../lib/clipboard";
import { communityLinks } from "../lib/community";
const { t } = useI18n();
const platforms = [
  { label: "Linux x64", filename: "fontinass-linux-x64" },
  { label: "macOS Intel", filename: "fontinass-macos-x64" },
  { label: "macOS Apple Silicon", filename: "fontinass-macos-arm64" },
  { label: "Windows x64", filename: "fontinass-windows-x64.exe" },
];
const sections = [
  { id: "download", key: "cliDownloadTitle" },
  { id: "install", key: "community.cliInstall" },
  { id: "examples", key: "community.cliExamples" },
  { id: "options", key: "community.cliOptions" },
  { id: "config", key: "community.cliConfig" },
];
const commands = [
  {
    id: "single",
    title: "cliExampleSingle",
    code: "fontinass subset file.ass",
  },
  { id: "batch", title: "cliExampleBatch", code: "fontinass subset *.ass" },
  {
    id: "recursive",
    title: "cliExampleRecursive",
    code: "fontinass subset -r ./subs/",
  },
  {
    id: "output",
    title: "cliExampleOutput",
    code: "fontinass subset -o ./output/ *.ass",
  },
];
const config = "fontinass config set server https://font.anibt.net";
const options =
  "fontinass subset --strict --clean file.ass\nfontinass subset --alias-salt SC simple-jp.ass\nfontinass subset --alias-salt TC traditional-jp.ass";
const copied = ref("");
const copyError = ref(false);
let resetTimer: ReturnType<typeof setTimeout> | undefined;
async function copy(code: string, id: string) {
  copyError.value = false;
  try {
    if (navigator.clipboard) await navigator.clipboard.writeText(code);
    else if (!copyToClipboard(code)) throw new Error("Copy failed");
    copied.value = id;
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      copied.value = "";
    }, 1800);
  } catch {
    copyError.value = true;
  }
}
onUnmounted(() => clearTimeout(resetTimer));
</script>

<template>
  <div class="guide-layout">
    <nav class="guide-toc" :aria-label="t('community.guideOnPage')">
      <strong>{{ t("community.guideOnPage") }}</strong
      ><a
        v-for="section in sections"
        :key="section.id"
        :href="'#' + section.id"
        >{{ t(section.key) }}</a
      >
    </nav>
    <article class="guide-content">
      <header class="page-heading">
        <p class="eyebrow">{{ t("community.brand") }}</p>
        <h1>{{ t("cliTitle") }}</h1>
        <p>{{ t("community.cliIntro") }}</p>
      </header>
      <p v-if="copyError" role="alert" class="page-note">{{ t("copyFail") }}</p>
      <span class="sr-only" role="status">{{ copied ? t("copied") : "" }}</span>
      <section id="download">
        <h2>{{ t("cliDownloadTitle") }}</h2>
        <p>{{ t("community.cliDownloadIntro") }}</p>
        <div class="cli-platforms">
          <a
            v-for="platform in platforms"
            :key="platform.filename"
            :href="communityLinks.releases + '/download/' + platform.filename"
            class="button"
            ><Download :size="15" />{{ platform.label }}</a
          >
        </div>
        <div class="action-row">
          <a
            :href="communityLinks.releases"
            target="_blank"
            rel="noopener noreferrer"
            class="text-link"
            >{{ t("community.cliReleases") }}<ArrowUpRight :size="15"
          /></a>
        </div>
      </section>
      <section id="install">
        <h2>{{ t("community.cliInstall") }}</h2>
        <p>{{ t("community.cliInstallHint") }}</p>
        <div class="code-example">
          <p>Linux / macOS</p>
          <div class="code-block"><code>chmod +x ./fontinass</code></div>
        </div>
        <div class="code-example">
          <p>{{ t("cliConfigSetServer") }}</p>
          <div class="code-block">
            <code>{{ config }}</code
            ><button
              class="icon-button"
              :aria-label="t('community.copy')"
              @click="copy(config, 'server')"
            >
              <Check v-if="copied === 'server'" :size="16" /><Copy
                v-else
                :size="16"
              />
            </button>
          </div>
        </div>
      </section>
      <section id="examples">
        <h2>{{ t("community.cliExamples") }}</h2>
        <div v-for="command in commands" :key="command.id" class="code-example">
          <p>{{ t(command.title) }}</p>
          <div class="code-block">
            <code>{{ command.code }}</code
            ><button
              class="icon-button"
              :aria-label="t('community.copy') + ': ' + t(command.title)"
              @click="copy(command.code, command.id)"
            >
              <Check v-if="copied === command.id" :size="16" /><Copy
                v-else
                :size="16"
              />
            </button>
          </div>
        </div>
      </section>
      <section id="options">
        <h2>{{ t("community.cliOptions") }}</h2>
        <p>{{ t("community.cliOptionsBody") }}</p>
        <div class="code-block">
          <code>{{ options }}</code
          ><button
            class="icon-button"
            :aria-label="t('community.copy')"
            @click="copy(options, 'options')"
          >
            <Check v-if="copied === 'options'" :size="16" /><Copy
              v-else
              :size="16"
            />
          </button>
        </div>
      </section>
      <section id="config">
        <h2>{{ t("community.cliConfig") }}</h2>
        <p>{{ t("cliConfigDesc") }}</p>
        <div class="code-block">
          <code>fontinass config show</code
          ><button
            class="icon-button"
            :aria-label="t('community.copy')"
            @click="copy('fontinass config show', 'show')"
          >
            <Check v-if="copied === 'show'" :size="16" /><Copy
              v-else
              :size="16"
            />
          </button>
        </div>
        <div class="action-row">
          <a
            :href="communityLinks.source + '/blob/main/cli/README.md'"
            target="_blank"
            rel="noopener noreferrer"
            class="text-link"
            >{{ t("community.cliSource") }}<ArrowUpRight :size="15"
          /></a>
        </div>
      </section>
    </article>
  </div>
</template>
