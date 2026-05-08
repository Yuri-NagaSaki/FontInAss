<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { ref } from "vue";

const { t } = useI18n();

const REPO = "Yuri-NagaSaki/FontInAss";
const RELEASE_URL = `https://github.com/${REPO}/releases/latest`;

interface Platform { key: string; label: string; filename: string; installCmd: string; }

const platforms: Platform[] = [
  { key: "linux",       label: "Linux x64",   filename: "fontinass-linux-x64",       installCmd: "chmod +x fontinass-linux-x64 && sudo mv fontinass-linux-x64 /usr/local/bin/fontinass" },
  { key: "macos-x64",   label: "macOS x64",   filename: "fontinass-macos-x64",       installCmd: "chmod +x fontinass-macos-x64 && sudo mv fontinass-macos-x64 /usr/local/bin/fontinass" },
  { key: "macos-arm64", label: "macOS ARM",   filename: "fontinass-macos-arm64",     installCmd: "chmod +x fontinass-macos-arm64 && sudo mv fontinass-macos-arm64 /usr/local/bin/fontinass" },
  { key: "windows",     label: "Windows x64", filename: "fontinass-windows-x64.exe", installCmd: "" },
];

const copiedCmd = ref("");
const copyCommand = async (cmd: string, id: string) => {
  try {
    await navigator.clipboard.writeText(cmd);
    copiedCmd.value = id;
    setTimeout(() => { copiedCmd.value = ""; }, 1800);
  } catch { /* noop */ }
};

const downloadUrl = (filename: string) => `${RELEASE_URL}/download/${filename}`;

const quickInstall = `curl -fsSL "https://github.com/${REPO}/releases/latest/download/fontinass-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')" -o fontinass && chmod +x fontinass && sudo mv fontinass /usr/local/bin/`;

const codeExamples = [
  { id: "config",    titleKey: "cliExampleConfig",    code: "fontinass config set server https://font.anibt.net" },
  { id: "single",    titleKey: "cliExampleSingle",    code: "fontinass subset file.ass" },
  { id: "batch",     titleKey: "cliExampleBatch",     code: "fontinass subset *.ass" },
  { id: "output",    titleKey: "cliExampleOutput",    code: "fontinass subset -o ./output/ *.ass" },
  { id: "recursive", titleKey: "cliExampleRecursive", code: "fontinass subset -r ./subs/" },
  { id: "strict",    titleKey: "cliExampleStrict",    code: "fontinass subset --strict --clean file.ass" },
];

const configCmds = [
  { id: "cfg-server", titleKey: "cliConfigSetServer", code: "fontinass config set server https://font.anibt.net" },
  { id: "cfg-key",    titleKey: "cliConfigSetKey",    code: "fontinass config set api_key your_secret_key" },
  { id: "cfg-show",   titleKey: "cliConfigShow",      code: "fontinass config show" },
];
</script>

<template>
  <article class="text-page">
    <h1>{{ t('cliTitle') }}</h1>
    <p>{{ t('cliDesc') }}</p>

    <h2>{{ t('cliDownloadTitle') }}</h2>
    <p>Linux / macOS 用户可以一行命令完成下载和安装（自动识别 x64 / ARM 架构）。</p>
    <div class="code-block">
      <code>{{ quickInstall }}</code>
      <button @click="copyCommand(quickInstall, 'quick')">{{ copiedCmd === 'quick' ? '已复制' : '复制' }}</button>
    </div>

    <p>如果想手动选择平台，也可以从下面挑一个直接下载二进制文件：</p>
    <p>
      <span v-for="(p, i) in platforms" :key="p.key">
        <a :href="downloadUrl(p.filename)" target="_blank" rel="noopener">{{ p.label }}</a><span v-if="i < platforms.length - 1"> · </span>
      </span>
    </p>
    <p>更多版本和历史发行说明请前往 <a :href="RELEASE_URL" target="_blank" rel="noopener">GitHub Releases</a>。</p>

    <h2>{{ t('cliUsageTitle') }}</h2>
    <template v-for="ex in codeExamples" :key="ex.id">
      <p>{{ t(ex.titleKey) }}。</p>
      <div class="code-block">
        <code>{{ ex.code }}</code>
        <button @click="copyCommand(ex.code, ex.id)">{{ copiedCmd === ex.id ? '已复制' : '复制' }}</button>
      </div>
    </template>

    <h2>主要功能</h2>
    <ul>
      <li><strong>{{ t('cliFeatBatch') }}</strong> — {{ t('cliFeatBatchDesc') }}</li>
      <li><strong>{{ t('cliFeatRecursive') }}</strong> — {{ t('cliFeatRecursiveDesc') }}</li>
      <li><strong>{{ t('cliFeatConfig') }}</strong> — {{ t('cliFeatConfigDesc') }}</li>
    </ul>

    <h2>{{ t('cliConfigTitle') }}</h2>
    <p>{{ t('cliConfigDesc') }}</p>
    <template v-for="c in configCmds" :key="c.id">
      <p>{{ t(c.titleKey) }}。</p>
      <div class="code-block">
        <code>{{ c.code }}</code>
        <button @click="copyCommand(c.code, c.id)">{{ copiedCmd === c.id ? '已复制' : '复制' }}</button>
      </div>
    </template>

    <h2>源码</h2>
    <p>本工具源码托管于 <a :href="`https://github.com/${REPO}`" target="_blank" rel="noopener">{{ REPO }}</a>，采用 AGPL-3.0 许可证。</p>
  </article>
</template>

<style scoped>
.text-page {
  max-width: 48rem;
  margin: 0 auto;
  padding: 0.5rem 0 2rem;
  color: var(--color-ink-800);
  font-size: 16.5px;
  line-height: 1.8;
}
.text-page h1 {
  font-size: 2rem; font-weight: 700;
  color: var(--color-ink-900);
  margin: 0 0 1rem; line-height: 1.25;
  letter-spacing: -0.01em;
}
.text-page h2 {
  font-size: 1.4rem; font-weight: 600;
  color: var(--color-ink-900);
  margin: 2rem 0 0.6rem; line-height: 1.3;
  letter-spacing: -0.005em;
}
.text-page p { margin: 0 0 0.6rem; }
.text-page ul { list-style: disc; padding-left: 1.5rem; margin: 0 0 0.75rem; }
.text-page li { margin: 0.2rem 0; }
.text-page a {
  color: var(--color-sakura-600, oklch(60% 0.18 18));
  text-decoration: underline; text-underline-offset: 2px;
}
.text-page a:hover { color: var(--color-ink-900); }
.text-page a.active { color: var(--color-ink-900); font-weight: 600; }
.text-page code {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 0.9em;
  padding: 0.1em 0.35em;
  background: oklch(96% 0.008 12);
  border-radius: 3px;
  color: var(--color-ink-900);
}
:global(.dark) .text-page code { background: oklch(30% 0.008 280); }

.code-block {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.6rem 0.85rem;
  margin: 0 0 0.85rem;
  background: oklch(96% 0.008 12);
  border-radius: 4px;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 14.5px;
  overflow-x: auto;
}
:global(.dark) .code-block { background: oklch(28% 0.008 280); }
.code-block code {
  flex: 1; padding: 0; background: transparent;
  white-space: pre; color: var(--color-ink-900);
}
.code-block button {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--color-ink-500);
  padding: 0.15rem 0.5rem;
  font-family: var(--font-body);
}
.code-block button:hover { color: var(--color-ink-900); text-decoration: underline; }
</style>
