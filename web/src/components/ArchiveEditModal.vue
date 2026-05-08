<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { X } from "lucide-vue-next";
import KButton from "./KButton.vue";
import { useConfirm } from "../composables/useConfirm";
import type { SharedArchive } from "../api/client";
import { editArchive } from "../api/client";

const { t } = useI18n();

const LANG_OPTIONS = ["chs", "cht", "jpn", "chs_jpn", "cht_jpn", "sc", "tc", "eng"];

const props = defineProps<{
  archive: SharedArchive | null;
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
}>();

const editForm = ref({ name_cn: "", letter: "", season: "S1", sub_group: "", languages: [] as string[], has_fonts: false, episode_count: 0 });
const editSubmitting = ref(false);

watch(() => props.archive, (archive) => {
  if (!archive) return;
  editForm.value = {
    name_cn: archive.name_cn,
    letter: archive.letter,
    season: archive.season,
    sub_group: archive.sub_group,
    languages: (() => { try { return JSON.parse(archive.languages); } catch { return []; } })(),
    has_fonts: !!archive.has_fonts,
    episode_count: archive.episode_count,
  };
});

function toggleLang(lang: string) {
  const idx = editForm.value.languages.indexOf(lang);
  if (idx >= 0) editForm.value.languages.splice(idx, 1);
  else editForm.value.languages.push(lang);
}

function close() {
  emit("close");
}

async function submit() {
  if (editSubmitting.value || !props.archive) return;
  editSubmitting.value = true;
  try {
    await editArchive(props.archive.id, editForm.value);
    close();
    emit("saved");
  } catch (e: any) {
    useConfirm().alert({ title: t('errorTitle'), message: e.message || String(e), variant: 'danger' });
  } finally {
    editSubmitting.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="slide">
      <div v-if="archive" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" role="dialog" aria-modal="true" @click.self="close">
        <div class="bg-surface rounded-2xl shadow-2xl max-w-lg w-full max-h-[80vh] flex flex-col overflow-hidden">
          <div class="flex items-center justify-between px-6 py-4 border-b border-ink-100">
            <h3 class="font-display font-bold text-lg text-ink-900">{{ t('sharingEditTitle') }}</h3>
            <button @click="close" class="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-ink-100 transition-colors">
              <X class="w-4 h-4 text-ink-400" />
            </button>
          </div>
          <div class="flex-1 overflow-y-auto p-6">
            <div class="flex flex-col gap-4">
              <div class="flex gap-3">
                <div class="flex-1">
                  <label class="text-xs font-medium text-ink-500 mb-1.5 block">{{ t('sharingAnimeName') }}</label>
                  <input v-model="editForm.name_cn" class="w-full px-3.5 py-2.5 rounded-xl border border-ink-200 text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-sakura-300/50" />
                </div>
                <div class="w-20">
                  <label class="text-xs font-medium text-ink-500 mb-1.5 block">{{ t('sharingLetter') }}</label>
                  <input v-model="editForm.letter" maxlength="1" class="w-full px-3 py-2.5 rounded-xl border border-ink-200 text-sm text-center uppercase bg-surface focus:outline-none focus:ring-2 focus:ring-sakura-300/50" />
                </div>
              </div>
              <div class="flex gap-3">
                <div class="w-32">
                  <label class="text-xs font-medium text-ink-500 mb-1.5 block">{{ t('sharingSeason') }}</label>
                  <select v-model="editForm.season" class="w-full px-3 py-2.5 rounded-xl border border-ink-200 text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-sakura-300/50">
                    <option v-for="s in ['S1','S2','S3','S4','Movie','SPs','OVA','合集']" :key="s" :value="s">{{ s }}</option>
                  </select>
                </div>
                <div class="flex-1">
                  <label class="text-xs font-medium text-ink-500 mb-1.5 block">{{ t('sharingSubGroup') }}</label>
                  <input v-model="editForm.sub_group" class="w-full px-3.5 py-2.5 rounded-xl border border-ink-200 text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-sakura-300/50" />
                </div>
              </div>
              <div>
                <label class="text-xs font-medium text-ink-500 mb-2 block">{{ t('sharingLanguages') }}</label>
                <div class="flex flex-wrap gap-2">
                  <button
                    v-for="lang in LANG_OPTIONS"
                    :key="lang"
                    @click="toggleLang(lang)"
                    class="px-3.5 py-2 rounded-xl text-xs font-medium border-2 transition-colors duration-150"
                    :class="editForm.languages.includes(lang)
                      ? 'bg-sakura-50 border-sakura-300 text-sakura-700 shadow-sm'
                      : 'bg-surface border-ink-100 text-ink-400 hover:border-sakura-200 hover:text-ink-600'"
                  >
                    {{ lang }}
                  </button>
                </div>
              </div>
              <div class="flex gap-3">
                <div class="w-32">
                  <label class="text-xs font-medium text-ink-500 mb-1.5 block">{{ t('sharingEpisodeCount') }}</label>
                  <input v-model.number="editForm.episode_count" type="number" min="0" class="w-full px-3 py-2.5 rounded-xl border border-ink-200 text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-sakura-300/50" />
                </div>
                <label class="flex items-center gap-2.5 text-sm text-ink-600 cursor-pointer select-none mt-auto pb-2.5">
                  <input type="checkbox" v-model="editForm.has_fonts" class="rounded border-ink-300 text-sakura-500 focus:ring-sakura-300" />
                  {{ t('sharingHasFonts') }}
                </label>
              </div>
            </div>
          </div>
          <div class="px-6 py-4 border-t border-ink-100 flex justify-end gap-3">
            <KButton variant="secondary" @click="close">{{ t('cancel') }}</KButton>
            <KButton variant="primary" :loading="editSubmitting" @click="submit">{{ t('save') }}</KButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.slide-enter-from {
  opacity: 0;
  transform: translateY(12px);
}
.slide-leave-to {
  opacity: 0;
  transform: translateY(-12px);
}
</style>
