<script setup lang="ts">
import { useI18n } from "vue-i18n";
const { t } = useI18n();
</script>

<template>
  <article class="text-page">
    <h1>{{ t('aboutTitle') }}</h1>
    <p>{{ t('aboutDesc') }}</p>

    <h2>{{ t('openSourceTitle') }}</h2>
    <p>{{ t('openSourceDesc') }}</p>
    <p>{{ t('aboutLibraryScale') }}</p>

    <h2>{{ t('techStackTitle') }}</h2>
    <p>{{ t('techStackDesc') }}</p>
    <ul>
      <li>{{ t('aboutStackBackend') }}</li>
      <li>{{ t('aboutStackFrontend') }}</li>
      <li>{{ t('aboutStackDeploy') }}</li>
    </ul>

    <h2>{{ t('openSourceRepoTitle') }}</h2>
    <p>{{ t('openSourceRepoDesc') }}</p>
    <p>{{ t('aboutRepositoryPrefix') }} <a href="https://github.com/Yuri-NagaSaki/FontInAss" target="_blank" rel="noopener">Yuri-NagaSaki/FontInAss</a>，{{ t('aboutRepositoryLicense') }}</p>

    <h2>{{ t('communityTitle') }}</h2>
    <ul>
      <li><a href="https://github.com/Yuri-NagaSaki/FontInAss" target="_blank" rel="noopener">{{ t('aboutLinkGitHub') }}</a></li>
      <li><a href="https://t.me/anibtass" target="_blank" rel="noopener">{{ t('aboutLinkTelegram') }}</a></li>
      <li><a href="mailto:sa@catcat.blog">{{ t('aboutLinkEmail') }}</a></li>
      <li><a href="https://catcat.blog" target="_blank" rel="noopener">{{ t('aboutLinkBlog') }}</a></li>
      <li><a href="https://anibt.net/" target="_blank" rel="noopener">{{ t('aboutLinkAniBT') }}</a></li>
    </ul>
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
.text-page p { margin: 0 0 0.75rem; }
.text-page ul { list-style: disc; padding-left: 1.5rem; margin: 0 0 0.75rem; }
.text-page li { margin: 0.2rem 0; }
.text-page a {
  color: var(--color-sakura-600, oklch(60% 0.18 18));
  text-decoration: underline; text-underline-offset: 2px;
}
.text-page a:hover { color: var(--color-ink-900); }
</style>
