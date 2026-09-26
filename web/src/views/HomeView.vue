<script setup lang="ts">
import { useI18n } from "vue-i18n";
import {
  ArrowRight,
  ArrowUpRight,
  Upload,
  Library,
  MessageCircle,
  ChevronRight,
} from "lucide-vue-next";
import { communityServices } from "../lib/community";
const { t } = useI18n();
const contributions = [
  {
    to: "/upload",
    icon: Upload,
    title: "contributeFont",
    description: "contributeFontDesc",
  },
  {
    to: "/sharing",
    icon: Library,
    title: "contributeArchive",
    description: "contributeArchiveDesc",
  },
  {
    to: "/comments",
    icon: MessageCircle,
    title: "contributeDiscuss",
    description: "contributeDiscussDesc",
  },
];
</script>

<template>
  <div class="overview">
    <section class="overview-intro">
      <div class="overview-lead">
        <p class="eyebrow">{{ t("community.overviewLabel") }}</p>
        <h1>{{ t("community.heroTitle") }}</h1>
        <p class="lead-copy">{{ t("community.heroDesc") }}</p>
        <div class="action-row">
          <RouterLink to="/subset" class="button button-primary button-large"
            >{{ t("community.start") }}<ArrowRight :size="17" /></RouterLink
          ><RouterLink to="/sharing" class="button button-large">{{
            t("community.browse")
          }}</RouterLink>
        </div>
        <p class="format-hint">{{ t("community.formatHint") }}</p>
        <div class="workflow">
          <h2>{{ t("community.workflowTitle") }}</h2>
          <ol>
            <li
              v-for="(step, index) in ['Upload', 'Match', 'Download']"
              :key="step"
            >
              <span class="step-number">0{{ index + 1 }}</span>
              <div>
                <h3>{{ t("community.step" + step) }}</h3>
                <p>{{ t("community.step" + step + "Desc") }}</p>
              </div>
            </li>
          </ol>
        </div>
      </div>
      <aside class="contribution-well">
        <h2>{{ t("community.contributeTitle") }}</h2>
        <p>{{ t("community.contributeDesc") }}</p>
        <div class="contribution-links">
          <RouterLink v-for="item in contributions" :key="item.to" :to="item.to"
            ><component :is="item.icon" :size="20" /><span
              ><strong>{{ t("community." + item.title) }}</strong
              ><small>{{ t("community." + item.description) }}</small></span
            ><ChevronRight :size="17"
          /></RouterLink>
        </div>
        <RouterLink to="/about" class="text-link"
          >{{ t("community.guide") }}<ArrowRight :size="16"
        /></RouterLink>
      </aside>
    </section>

    <section
      class="community-section"
      aria-labelledby="community-services-title"
    >
      <div class="section-heading">
        <h2 id="community-services-title">
          {{ t("community.ecosystemTitle") }}
        </h2>
        <p>{{ t("community.ecosystemDesc") }}</p>
      </div>
      <div class="community-service-grid">
        <template v-for="service in communityServices" :key="service.id">
          <RouterLink
            v-if="service.id === 'subtitles'"
            to="/subset"
            class="community-service"
            ><div>
              <h3>{{ t(service.title) }}</h3>
              <span class="current-service">{{
                t("community.currentService")
              }}</span>
            </div>
            <p>{{ t(service.description) }}</p>
            <ArrowRight :size="18"
          /></RouterLink>
          <a v-else :href="service.href" class="community-service"
            ><div>
              <h3>{{ t(service.title) }}</h3>
              <ArrowUpRight :size="17" />
            </div>
            <p>{{ t(service.description) }}</p></a
          >
        </template>
      </div>
    </section>
    <section class="group-invitation">
      <div>
        <h2>{{ t("community.groupTitle") }}</h2>
        <p>{{ t("community.groupDesc") }}</p>
      </div>
      <div class="action-row">
        <RouterLink to="/access" class="button"
          >{{ t("community.groupAction") }}<ArrowRight :size="16" /></RouterLink
        ><RouterLink to="/cli" class="text-link">{{
          t("community.cliAction")
        }}</RouterLink>
      </div>
    </section>
  </div>
</template>
