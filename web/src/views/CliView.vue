<script setup lang="ts">
import { useI18n } from "vue-i18n";
import {
  Terminal,
  Download,
  Monitor,
  Apple,
  Settings,
  FileText,
  Folder,
  Zap,
  ArrowUpRight,
  Copy,
  CheckCircle2,
} from "lucide-vue-next";
import { ref, computed } from "vue";
import KButton from "../components/KButton.vue";

const { t } = useI18n();

const REPO = "Yuri-NagaSaki/FontInAss";
const RELEASE_URL = `https://github.com/${REPO}/releases/latest`;

interface Platform {
  key: string;
  label: string;
  icon: typeof Monitor;
  filename: string;
  installCmd: string;
}

const platforms: Platform[] = [
  {
    key: "linux",
    label: "Linux x64",
    icon: Monitor,
    filename: "fontinass-linux-x64",
    installCmd:
      "chmod +x fontinass-linux-x64 && sudo mv fontinass-linux-x64 /usr/local/bin/fontinass",
  },
  {
    key: "macos-x64",
    label: "macOS x64",
    icon: Apple,
    filename: "fontinass-macos-x64",
    installCmd:
      "chmod +x fontinass-macos-x64 && sudo mv fontinass-macos-x64 /usr/local/bin/fontinass",
  },
  {
    key: "macos-arm64",
    label: "macOS ARM",
    icon: Apple,
    filename: "fontinass-macos-arm64",
    installCmd:
      "chmod +x fontinass-macos-arm64 && sudo mv fontinass-macos-arm64 /usr/local/bin/fontinass",
  },
  {
    key: "windows",
    label: "Windows x64",
    icon: Monitor,
    filename: "fontinass-windows-x64.exe",
    installCmd: "",
  },
];

const selectedPlatform = ref("linux");
const currentPlatform = computed(
  () => platforms.find((p) => p.key === selectedPlatform.value)!
);

const copiedCmd = ref("");
const copyCommand = async (cmd: string, id: string) => {
  try {
    await navigator.clipboard.writeText(cmd);
    copiedCmd.value = id;
    setTimeout(() => {
      copiedCmd.value = "";
    }, 2000);
  } catch {
    // Clipboard API not available
  }
};

const downloadUrl = (filename: string) =>
  `${RELEASE_URL}/download/${filename}`;

const codeExamples = [
  {
    id: "config",
    title: "cliExampleConfig",
    code: "fontinass config set server https://font.anibt.net",
  },
  { id: "single", title: "cliExampleSingle", code: "fontinass subset file.ass" },
  { id: "batch", title: "cliExampleBatch", code: "fontinass subset *.ass" },
  {
    id: "output",
    title: "cliExampleOutput",
    code: "fontinass subset -o ./output/ *.ass",
  },
  {
    id: "recursive",
    title: "cliExampleRecursive",
    code: "fontinass subset -r ./subs/",
  },
  {
    id: "strict",
    title: "cliExampleStrict",
    code: "fontinass subset --strict --clean file.ass",
  },
];
</script>

<template>
  <div class="flex flex-col gap-10 animate-fade-in">
    <!-- ─── Header ─────────────────────────────────────────────── -->
    <section class="relative flex items-start gap-5 py-2">
      <div
        class="relative shrink-0 w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-[var(--shadow-md)] flex items-center justify-center"
      >
        <Terminal class="w-8 h-8 text-white" :stroke-width="1.8" />
      </div>
      <div class="min-w-0">
        <h1
          class="font-display font-bold text-2xl text-ink-900 mb-1.5 leading-snug"
        >
          {{ t("cliTitle") }}
        </h1>
        <p class="text-ink-500 leading-relaxed max-w-2xl text-[15px]">
          {{ t("cliDesc") }}
        </p>
      </div>
    </section>

    <!-- ─── Download Section ──────────────────────────────────── -->
    <section class="card p-6 flex flex-col gap-5">
      <div class="flex items-center gap-2.5">
        <div
          class="w-8 h-8 rounded-xl bg-emerald-100 flex items-center justify-center"
        >
          <Download class="w-4 h-4 text-emerald-600" />
        </div>
        <h2 class="font-display font-semibold text-ink-900">
          {{ t("cliDownloadTitle") }}
        </h2>
      </div>

      <!-- Platform selector -->
      <div class="flex flex-wrap gap-2">
        <button
          v-for="p in platforms"
          :key="p.key"
          @click="selectedPlatform = p.key"
          class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors duration-150"
          :class="
            selectedPlatform === p.key
              ? 'bg-emerald-500 text-white shadow-[var(--shadow-sm)]'
              : 'bg-ink-50 text-ink-600 hover:bg-ink-100'
          "
        >
          <component :is="p.icon" class="w-4 h-4" />
          {{ p.label }}
        </button>
      </div>

      <!-- Download card for selected platform -->
      <div
        class="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-4 rounded-xl bg-ink-50/60 border border-ink-100"
      >
        <div class="flex-1 min-w-0">
          <p class="font-mono text-sm text-ink-800 font-medium">
            {{ currentPlatform.filename }}
          </p>
          <p class="text-xs text-ink-400 mt-1">
            {{ t("cliDownloadFrom") }}
          </p>
        </div>
        <a
          :href="downloadUrl(currentPlatform.filename)"
          target="_blank"
          rel="noopener"
          class="shrink-0"
        >
          <KButton variant="primary" size="sm">
            <Download class="w-4 h-4" />
            {{ t("cliDownloadBtn") }}
          </KButton>
        </a>
      </div>

      <!-- Install command (non-Windows) -->
      <div v-if="currentPlatform.installCmd" class="flex flex-col gap-2">
        <p class="text-xs text-ink-400 font-medium uppercase tracking-wider">
          {{ t("cliInstallCmd") }}
        </p>
        <div
          class="group relative flex items-center gap-3 p-3 rounded-xl bg-ink-900 font-mono text-sm text-emerald-300 overflow-x-auto"
        >
          <span class="text-ink-500 select-none">$</span>
          <code class="flex-1 whitespace-nowrap">{{
            currentPlatform.installCmd
          }}</code>
          <button
            @click="copyCommand(currentPlatform.installCmd, 'install')"
            class="shrink-0 p-1.5 rounded-lg text-ink-400 hover:text-white hover:bg-ink-700 transition-colors"
          >
            <CheckCircle2
              v-if="copiedCmd === 'install'"
              class="w-4 h-4 text-emerald-400"
            />
            <Copy v-else class="w-4 h-4" />
          </button>
        </div>
      </div>

      <!-- All platforms link -->
      <a
        :href="RELEASE_URL"
        target="_blank"
        rel="noopener"
        class="inline-flex items-center gap-1.5 text-sm text-emerald-600 hover:text-emerald-700 transition-colors w-fit"
      >
        {{ t("cliAllReleases") }}
        <ArrowUpRight class="w-3.5 h-3.5" />
      </a>
    </section>

    <!-- ─── Usage Examples ────────────────────────────────────── -->
    <section class="card p-6 flex flex-col gap-5">
      <div class="flex items-center gap-2.5">
        <div
          class="w-8 h-8 rounded-xl bg-sky-100 flex items-center justify-center"
        >
          <FileText class="w-4 h-4 text-sky-500" />
        </div>
        <h2 class="font-display font-semibold text-ink-900">
          {{ t("cliUsageTitle") }}
        </h2>
      </div>

      <div class="flex flex-col gap-4">
        <div v-for="ex in codeExamples" :key="ex.id" class="flex flex-col gap-1.5">
          <p class="text-sm text-ink-500 font-medium">{{ t(ex.title) }}</p>
          <div
            class="group relative flex items-center gap-3 p-3 rounded-xl bg-ink-900 font-mono text-sm text-emerald-300 overflow-x-auto"
          >
            <span class="text-ink-500 select-none">$</span>
            <code class="flex-1 whitespace-nowrap">{{ ex.code }}</code>
            <button
              @click="copyCommand(ex.code, ex.id)"
              class="shrink-0 p-1.5 rounded-lg text-ink-400 hover:text-white hover:bg-ink-700 transition-colors"
            >
              <CheckCircle2
                v-if="copiedCmd === ex.id"
                class="w-4 h-4 text-emerald-400"
              />
              <Copy v-else class="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- ─── Features Grid ─────────────────────────────────────── -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div class="card p-5 flex flex-col gap-3">
        <div
          class="w-8 h-8 rounded-xl bg-sakura-100 flex items-center justify-center"
        >
          <Zap class="w-4 h-4 text-sakura-500" />
        </div>
        <h3 class="font-display font-semibold text-sm text-ink-900">
          {{ t("cliFeatBatch") }}
        </h3>
        <p class="text-xs text-ink-500 leading-relaxed">
          {{ t("cliFeatBatchDesc") }}
        </p>
      </div>
      <div class="card p-5 flex flex-col gap-3">
        <div
          class="w-8 h-8 rounded-xl bg-sky-100 flex items-center justify-center"
        >
          <Folder class="w-4 h-4 text-sky-500" />
        </div>
        <h3 class="font-display font-semibold text-sm text-ink-900">
          {{ t("cliFeatRecursive") }}
        </h3>
        <p class="text-xs text-ink-500 leading-relaxed">
          {{ t("cliFeatRecursiveDesc") }}
        </p>
      </div>
      <div class="card p-5 flex flex-col gap-3">
        <div
          class="w-8 h-8 rounded-xl bg-emerald-100 flex items-center justify-center"
        >
          <Settings class="w-4 h-4 text-emerald-500" />
        </div>
        <h3 class="font-display font-semibold text-sm text-ink-900">
          {{ t("cliFeatConfig") }}
        </h3>
        <p class="text-xs text-ink-500 leading-relaxed">
          {{ t("cliFeatConfigDesc") }}
        </p>
      </div>
    </div>

    <!-- ─── Config Reference ──────────────────────────────────── -->
    <section class="card p-6 flex flex-col gap-4">
      <div class="flex items-center gap-2.5">
        <div
          class="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center"
        >
          <Settings class="w-4 h-4 text-amber-500" />
        </div>
        <h2 class="font-display font-semibold text-ink-900">
          {{ t("cliConfigTitle") }}
        </h2>
      </div>
      <p class="text-sm text-ink-500 leading-relaxed">
        {{ t("cliConfigDesc") }}
      </p>
      <div
        class="p-3 rounded-xl bg-ink-900 font-mono text-sm text-ink-300 overflow-x-auto"
      >
        <pre class="whitespace-pre"><span class="text-ink-500"># ~/.config/fontinass/config.toml</span>
<span class="text-emerald-300">server</span> = <span class="text-amber-300">"https://font.anibt.net"</span>
<span class="text-emerald-300">api_key</span> = <span class="text-amber-300">""</span></pre>
      </div>
      <div class="flex flex-col gap-2">
        <div
          v-for="cmd in [
            { code: 'fontinass config set server https://font.anibt.net', desc: 'cliConfigSetServer' },
            { code: 'fontinass config set api-key YOUR_KEY', desc: 'cliConfigSetKey' },
            { code: 'fontinass config show', desc: 'cliConfigShow' },
          ]"
          :key="cmd.code"
          class="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3"
        >
          <code
            class="font-mono text-xs text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg shrink-0"
            >{{ cmd.code }}</code
          >
          <span class="text-xs text-ink-400">{{ t(cmd.desc) }}</span>
        </div>
      </div>
    </section>

    <!-- ─── Source Code Link ──────────────────────────────────── -->
    <p class="text-center text-xs text-ink-300 pb-4">
      <a
        :href="`https://github.com/${REPO}/tree/main/cli`"
        target="_blank"
        rel="noopener"
        class="hover:text-emerald-500 transition-colors inline-flex items-center gap-1"
      >
        {{ t("cliSourceCode") }}
        <ArrowUpRight class="w-3 h-3" />
      </a>
    </p>
  </div>
</template>
