<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { ArrowRight, ArrowUpRight, ChevronDown } from "lucide-vue-next";
import { communityLinks } from "../lib/community";
const { t } = useI18n();
const sections = [
  { id: "start", key: "guideStart" },
  { id: "fonts", key: "guideFonts" },
  { id: "sharing", key: "guideSharing" },
  { id: "access", key: "guideAccess" },
  { id: "faq", key: "guideFaq" },
  { id: "open", key: "guideOpen" },
];
</script>

<template>
  <div class="guide-layout">
    <nav class="guide-toc" :aria-label="t('community.guideOnPage')">
      <strong>{{ t("community.guideOnPage") }}</strong
      ><a
        v-for="section in sections"
        :key="section.id"
        :href="'#' + section.id"
        >{{ t("community." + section.key) }}</a
      >
    </nav>
    <article class="guide-content">
      <header class="page-heading">
        <p class="eyebrow">{{ t("community.brand") }}</p>
        <h1>{{ t("community.guideTitle") }}</h1>
        <p>{{ t("community.guideIntro") }}</p>
      </header>
      <section id="start">
        <h2>{{ t("community.guideStart") }}</h2>
        <p>{{ t("community.guideStartIntro") }}</p>
        <ol>
          <li v-for="step in 4" :key="step">
            {{ t("community.guideStep" + step) }}
          </li>
        </ol>
        <div class="action-row">
          <RouterLink to="/subset" class="button button-primary"
            >{{ t("community.start") }}<ArrowRight :size="16" /></RouterLink
          ><RouterLink to="/cli" class="text-link">{{
            t("community.cliAction")
          }}</RouterLink>
        </div>
      </section>
      <section id="fonts">
        <h2>{{ t("community.guideFonts") }}</h2>
        <p>{{ t("community.guideFontsBody") }}</p>
        <RouterLink to="/upload" class="text-link"
          >{{ t("community.contributeFont") }}<ArrowRight :size="16"
        /></RouterLink>
      </section>
      <section id="sharing">
        <h2>{{ t("community.guideSharing") }}</h2>
        <p>{{ t("community.guideSharingBody") }}</p>
        <RouterLink to="/sharing" class="text-link"
          >{{ t("community.browse") }}<ArrowRight :size="16"
        /></RouterLink>
      </section>
      <section id="access">
        <h2>{{ t("community.guideAccess") }}</h2>
        <p>{{ t("community.guideAccessBody") }}</p>
        <p>{{ t("community.guideAccessScope") }}</p>
        <div class="page-note">{{ t("community.guideAccessSecret") }}</div>
        <div class="action-row">
          <RouterLink to="/access" class="button"
            >{{ t("community.groupAction") }}<ArrowRight :size="16"
          /></RouterLink>
        </div>
      </section>
      <section id="faq">
        <h2>{{ t("community.guideFaq") }}</h2>
        <details
          v-for="key in ['Missing', 'Subset', 'Player', 'Privacy']"
          :key="key"
          class="faq-item"
        >
          <summary>
            {{ t("community.faq" + key) }}<ChevronDown :size="16" />
          </summary>
          <p>{{ t("community.faq" + key + "Answer") }}</p>
        </details>
      </section>
      <section id="open">
        <h2>{{ t("community.guideOpen") }}</h2>
        <p>{{ t("community.guideOpenBody") }}</p>
        <div class="action-row">
          <a
            :href="communityLinks.source"
            target="_blank"
            rel="noopener noreferrer"
            class="button"
            >{{ t("community.source") }}<ArrowUpRight :size="16" /></a
          ><a
            :href="communityLinks.telegram"
            target="_blank"
            rel="noopener noreferrer"
            class="button"
            >{{ t("community.contact") }}<ArrowUpRight :size="16"
          /></a>
        </div>
      </section>
    </article>
  </div>
</template>
