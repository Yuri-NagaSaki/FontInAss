<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import {
  Archive,
  Check,
  ChevronRight,
  Copy,
  Download,
  FileKey2,
  FileUp,
  FolderCog,
  KeyRound,
  Library,
  Loader2,
  LogIn,
  RefreshCcw,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-vue-next";
import type {
  AccessReceipt,
  FontItem,
  ProgrammaticCredential,
  ProgrammaticCredentialScope,
  WorkspaceArchive,
} from "../api/client";
import {
  createProgrammaticCredential,
  downloadWorkspaceArchiveSource,
  downloadWorkspaceFont,
  listAccessReceipts,
  listAdminCredentials,
  listProgrammaticCredentialActivity,
  listProgrammaticCredentials,
  listWorkspaceArchives,
  listWorkspaceFonts,
  revokeAdminCredential,
  revokeProgrammaticCredential,
  uploadWorkspaceArchive,
  uploadWorkspaceFonts,
} from "../api/client";
import { useWorkspaceSession } from "../composables/useWorkspaceSession";
import { formatBytes } from "../lib/format";
import KButton from "../components/KButton.vue";
import KEmpty from "../components/KEmpty.vue";
import KBadge from "../components/KBadge.vue";

type Tab = "fonts" | "archives" | "credentials" | "admin";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const workspace = useWorkspaceSession();
const activeTab = ref<Tab>("fonts");
const selectedOrganizationId = ref("");
const pageError = ref("");

const authenticatedSession = computed(() =>
  workspace.session.value?.authenticated ? workspace.session.value : null,
);
const organizations = computed(() =>
  authenticatedSession.value?.organizations ?? [],
);
const selectedOrganization = computed(() =>
  organizations.value.find(
    (organization) => organization.organizationId === selectedOrganizationId.value,
  ) ?? null,
);
const tabs = computed(() => [
  ...(organizations.value.length
    ? [
        { id: "fonts" as const, icon: Library, label: t("workspaceFonts") },
        { id: "archives" as const, icon: Archive, label: t("workspaceArchives") },
        { id: "credentials" as const, icon: FileKey2, label: t("workspaceCredentials") },
      ]
    : []),
  ...(authenticatedSession.value?.canManage
    ? [{ id: "admin" as const, icon: ShieldCheck, label: t("workspaceAdmin") }]
    : []),
]);

const syncTab = () => {
  const requested = route.query.tab;
  const available = tabs.value;
  const selected = available.find((tab) => tab.id === requested)?.id;
  activeTab.value = selected ?? available[0]?.id ?? "fonts";
};

const selectTab = (tab: Tab) => {
  activeTab.value = tab;
  void router.replace({ query: { ...route.query, tab } });
};

// Font workspace
const fonts = ref<FontItem[]>([]);
const fontSearch = ref("");
const fontLoading = ref(false);
const fontUploading = ref(false);
const fontInput = ref<HTMLInputElement | null>(null);

async function loadFonts() {
  if (!selectedOrganizationId.value) return;
  fontLoading.value = true;
  pageError.value = "";
  try {
    fonts.value = (
      await listWorkspaceFonts(
        selectedOrganizationId.value,
        1,
        200,
        fontSearch.value,
      )
    ).data;
  } catch (error) {
    pageError.value = errorMessage(error);
  } finally {
    fontLoading.value = false;
  }
}

async function uploadFonts(files: FileList | null) {
  if (!files?.length || !selectedOrganizationId.value) return;
  fontUploading.value = true;
  pageError.value = "";
  try {
    await uploadWorkspaceFonts(selectedOrganizationId.value, [...files]);
    await loadFonts();
  } catch (error) {
    pageError.value = errorMessage(error);
  } finally {
    fontUploading.value = false;
    if (fontInput.value) fontInput.value.value = "";
  }
}

async function downloadFont(font: FontItem) {
  if (!selectedOrganizationId.value) return;
  try {
    const { saveAs } = await import("file-saver");
    const file = await downloadWorkspaceFont(selectedOrganizationId.value, font.id);
    saveAs(file.blob, file.filename);
  } catch (error) {
    pageError.value = errorMessage(error);
  }
}

// Subtitle workspace
const archives = ref<WorkspaceArchive[]>([]);
const archiveLoading = ref(false);
const archiveUploading = ref(false);
const archiveFile = ref<File | null>(null);
const archiveName = ref("");
const archiveLetter = ref("");
const archiveSeason = ref("S1");
const archiveLanguages = ref(t("workspaceDefaultLanguages"));
const archiveHasFonts = ref(true);

async function loadArchives() {
  if (!selectedOrganizationId.value) return;
  archiveLoading.value = true;
  pageError.value = "";
  try {
    archives.value = await listWorkspaceArchives(selectedOrganizationId.value);
  } catch (error) {
    pageError.value = errorMessage(error);
  } finally {
    archiveLoading.value = false;
  }
}

async function submitArchive() {
  if (!archiveFile.value || !selectedOrganizationId.value || !archiveName.value.trim()) return;
  archiveUploading.value = true;
  pageError.value = "";
  try {
    await uploadWorkspaceArchive(
      selectedOrganizationId.value,
      archiveFile.value,
      {
        name_cn: archiveName.value.trim(),
        letter: archiveLetter.value.trim().toUpperCase() || "#",
        season: archiveSeason.value.trim(),
        languages: archiveLanguages.value
          .split(/[,，]/)
          .map((value) => value.trim())
          .filter(Boolean),
        has_fonts: archiveHasFonts.value,
      },
    );
    archiveFile.value = null;
    archiveName.value = "";
    await loadArchives();
  } catch (error) {
    pageError.value = errorMessage(error);
  } finally {
    archiveUploading.value = false;
  }
}

async function downloadArchive(archive: WorkspaceArchive) {
  if (!selectedOrganizationId.value) return;
  try {
    const { saveAs } = await import("file-saver");
    const file = await downloadWorkspaceArchiveSource(
      selectedOrganizationId.value,
      archive.id,
    );
    saveAs(file.blob, file.filename);
  } catch (error) {
    pageError.value = errorMessage(error);
  }
}

// Programmatic credentials
const credentials = ref<ProgrammaticCredential[]>([]);
const credentialActivity = ref<AccessReceipt[]>([]);
const credentialLoading = ref(false);
const credentialCreating = ref(false);
const credentialName = ref("");
const credentialConfirmation = ref("");
const credentialScopes = ref<ProgrammaticCredentialScope[]>([
  "fonts.read",
  "fonts.write",
]);
const credentialExpiry = ref("");
const revealedSecret = ref("");
const copied = ref(false);
const availableScopes: ProgrammaticCredentialScope[] = [
  "fonts.read",
  "fonts.write",
  "subtitles.read",
  "subtitles.write",
];

async function loadCredentials() {
  credentialLoading.value = true;
  pageError.value = "";
  try {
    [credentials.value, credentialActivity.value] = await Promise.all([
      listProgrammaticCredentials(),
      listProgrammaticCredentialActivity(50),
    ]);
  } catch (error) {
    pageError.value = errorMessage(error);
  } finally {
    credentialLoading.value = false;
  }
}

function toggleScope(scope: ProgrammaticCredentialScope) {
  credentialScopes.value = credentialScopes.value.includes(scope)
    ? credentialScopes.value.filter((value) => value !== scope)
    : [...credentialScopes.value, scope];
}

async function createCredential() {
  if (
    !selectedOrganizationId.value ||
    !credentialName.value.trim() ||
    credentialScopes.value.length === 0
  ) return;
  credentialCreating.value = true;
  pageError.value = "";
  try {
    const result = await createProgrammaticCredential({
      organizationId: selectedOrganizationId.value,
      name: credentialName.value.trim(),
      confirmation: credentialConfirmation.value.trim(),
      scopes: credentialScopes.value,
      expiresAt: credentialExpiry.value
        ? new Date(`${credentialExpiry.value}T23:59:59Z`).toISOString()
        : null,
    });
    revealedSecret.value = result.plaintext;
    credentialName.value = "";
    credentialConfirmation.value = "";
    credentialExpiry.value = "";
    await loadCredentials();
  } catch (error) {
    const message = errorMessage(error);
    pageError.value = message;
  } finally {
    credentialCreating.value = false;
  }
}

async function revokeCredential(credential: ProgrammaticCredential) {
  if (!window.confirm(t("credentialRevokeConfirm", { name: credential.name }))) return;
  try {
    await revokeProgrammaticCredential(credential.id);
    await loadCredentials();
  } catch (error) {
    pageError.value = errorMessage(error);
  }
}

async function copySecret() {
  await navigator.clipboard.writeText(revealedSecret.value);
  copied.value = true;
  window.setTimeout(() => { copied.value = false; }, 1500);
}

// Administrator overview
const adminCredentials = ref<ProgrammaticCredential[]>([]);
const receipts = ref<AccessReceipt[]>([]);
const adminLoading = ref(false);

async function loadAdmin() {
  if (!authenticatedSession.value?.canManage) return;
  adminLoading.value = true;
  pageError.value = "";
  try {
    [adminCredentials.value, receipts.value] = await Promise.all([
      listAdminCredentials(),
      listAccessReceipts(30),
    ]);
  } catch (error) {
    pageError.value = errorMessage(error);
  } finally {
    adminLoading.value = false;
  }
}

async function adminRevoke(credential: ProgrammaticCredential) {
  if (!window.confirm(t("credentialRevokeConfirm", { name: credential.name }))) return;
  await revokeAdminCredential(credential.id);
  await loadAdmin();
}

function errorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error);
  const key = `workspaceError_${code}`;
  const translated = t(key);
  return translated === key ? code : translated;
}

async function loadCurrentTab() {
  if (activeTab.value === "fonts") await loadFonts();
  if (activeTab.value === "archives") await loadArchives();
  if (activeTab.value === "credentials") await loadCredentials();
  if (activeTab.value === "admin") await loadAdmin();
}

watch([activeTab, selectedOrganizationId], () => void loadCurrentTab());
watch(tabs, syncTab);

onMounted(async () => {
  await workspace.refresh(true);
  selectedOrganizationId.value = organizations.value[0]?.organizationId ?? "";
  syncTab();
  await loadCurrentTab();
});
</script>

<template>
  <div v-if="workspace.loading.value" class="flex min-h-[45vh] items-center justify-center text-sakura-500">
    <Loader2 class="h-6 w-6 animate-spin" />
  </div>

  <section v-else-if="!authenticatedSession" class="mx-auto max-w-xl py-16 text-center">
    <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-sakura-100 text-sakura-600">
      <LogIn class="h-5 w-5" />
    </div>
    <h1 class="mt-5 font-display text-2xl font-bold text-ink-900">{{ t('workspaceLoginTitle') }}</h1>
    <p class="mx-auto mt-2 max-w-md text-sm text-ink-500">{{ t('workspaceLoginDesc') }}</p>
    <KButton class="mt-6" size="lg" @click="workspace.login('/workspace')">{{ t('loginWithAniBT') }}</KButton>
  </section>

  <div v-else class="flex flex-col gap-5">
    <header class="workspace-masthead">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <h1 class="font-display text-2xl font-bold tracking-tight text-ink-900">{{ t('workspaceTitle') }}</h1>
          <KBadge v-if="authenticatedSession.canManage" variant="success">{{ t('workspaceAdministrator') }}</KBadge>
        </div>
        <p class="mt-1 truncate text-sm text-ink-500">{{ authenticatedSession.displayName }}</p>
      </div>
      <label v-if="organizations.length" class="min-w-52">
        <span class="sr-only">{{ t('workspaceOrganization') }}</span>
        <select v-model="selectedOrganizationId" class="workspace-select">
          <option v-for="organization in organizations" :key="organization.organizationId" :value="organization.organizationId">
            {{ organization.name }} · {{ t(`workspaceRole_${organization.role}`) }}
          </option>
        </select>
      </label>
    </header>

    <div class="flex items-center gap-1 overflow-x-auto border-b border-ink-100 pb-px">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="workspace-tab"
        :class="activeTab === tab.id && 'workspace-tab-active'"
        @click="selectTab(tab.id)"
      >
        <component :is="tab.icon" class="h-4 w-4" />{{ tab.label }}
      </button>
    </div>

    <div v-if="pageError" class="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
      <span>{{ pageError }}</span><button @click="pageError = ''"><X class="h-4 w-4" /></button>
    </div>

    <section v-if="activeTab === 'fonts' && selectedOrganization" class="workspace-section">
      <div class="workspace-toolbar">
        <input v-model="fontSearch" class="workspace-input flex-1" :placeholder="t('searchFonts')" @keyup.enter="loadFonts" />
        <KButton variant="ghost" size="sm" :loading="fontLoading" @click="loadFonts"><RefreshCcw class="h-3.5 w-3.5" /></KButton>
        <input ref="fontInput" type="file" multiple accept=".ttf,.otf,.ttc,.otc" class="hidden" @change="uploadFonts(($event.target as HTMLInputElement).files)" />
        <KButton size="sm" :loading="fontUploading" @click="fontInput?.click()"><Upload class="h-3.5 w-3.5" />{{ t('workspaceUploadFonts') }}</KButton>
      </div>
      <KEmpty v-if="!fontLoading && !fonts.length" :title="t('workspaceNoFonts')" />
      <div v-else class="workspace-list">
        <div v-for="font in fonts" :key="font.id" class="workspace-row">
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold text-ink-800">{{ font.filename }}</p>
            <p class="truncate text-xs text-ink-400">{{ font.names.join(' · ') || '—' }}</p>
          </div>
          <span class="hidden text-xs text-ink-400 sm:inline">{{ formatBytes(font.size) }}</span>
          <button class="row-action" :aria-label="t('downloadFont')" @click="downloadFont(font)"><Download class="h-4 w-4" /></button>
        </div>
      </div>
    </section>

    <section v-if="activeTab === 'archives' && selectedOrganization" class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div class="workspace-section order-2 lg:order-1">
        <div class="workspace-toolbar">
          <h2 class="font-display font-semibold text-ink-800">{{ t('workspaceArchiveLibrary') }}</h2>
          <KButton class="ml-auto" variant="ghost" size="sm" :loading="archiveLoading" @click="loadArchives"><RefreshCcw class="h-3.5 w-3.5" /></KButton>
        </div>
        <KEmpty v-if="!archiveLoading && !archives.length" :title="t('workspaceNoArchives')" />
        <div v-else class="workspace-list">
          <div v-for="archive in archives" :key="archive.id" class="workspace-row">
            <Archive class="h-4 w-4 shrink-0 text-sakura-500" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold text-ink-800">{{ archive.name_cn }} · {{ archive.season }}</p>
              <p class="truncate text-xs text-ink-400">{{ archive.filename }} · {{ formatBytes(archive.file_size) }}</p>
            </div>
            <button class="row-action" :aria-label="t('workspaceDownloadSource')" @click="downloadArchive(archive)"><Download class="h-4 w-4" /></button>
          </div>
        </div>
      </div>

      <form class="workspace-form order-1 lg:order-2" @submit.prevent="submitArchive">
        <h2 class="font-display font-semibold text-ink-800">{{ t('workspaceUploadArchive') }}</h2>
        <input v-model="archiveName" class="workspace-input" required :placeholder="t('sharingAnimeName')" />
        <div class="grid grid-cols-2 gap-2">
          <input v-model="archiveLetter" class="workspace-input" maxlength="8" :placeholder="t('sharingLetter')" />
          <input v-model="archiveSeason" class="workspace-input" required :placeholder="t('sharingSeason')" />
        </div>
        <input v-model="archiveLanguages" class="workspace-input" :placeholder="t('sharingLanguages')" />
        <label class="flex items-center gap-2 text-sm text-ink-600"><input v-model="archiveHasFonts" type="checkbox" />{{ t('sharingHasFonts') }}</label>
        <label class="file-picker">
          <FileUp class="h-4 w-4" /><span class="truncate">{{ archiveFile?.name || t('workspaceChooseArchive') }}</span>
          <input type="file" accept=".zip,.7z" class="hidden" @change="archiveFile = ($event.target as HTMLInputElement).files?.[0] ?? null" />
        </label>
        <KButton type="submit" :loading="archiveUploading" :disabled="!archiveFile || !archiveName.trim()">{{ t('workspacePublishArchive') }}</KButton>
      </form>
    </section>

    <section v-if="activeTab === 'credentials' && selectedOrganization" class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div class="workspace-section">
        <div class="workspace-toolbar"><h2 class="font-display font-semibold text-ink-800">{{ t('workspaceCredentialList') }}</h2><KButton class="ml-auto" variant="ghost" size="sm" :loading="credentialLoading" @click="loadCredentials"><RefreshCcw class="h-3.5 w-3.5" /></KButton></div>
        <KEmpty v-if="!credentialLoading && !credentials.length" :title="t('workspaceNoCredentials')" />
        <div v-else class="workspace-list">
          <div v-for="credential in credentials" :key="credential.id" class="workspace-row">
            <KeyRound class="h-4 w-4 shrink-0" :class="credential.revokedAt ? 'text-ink-300' : 'text-mint-600'" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold text-ink-800">{{ credential.name }}</p>
              <p class="truncate font-mono text-xs text-ink-400">fia_{{ credential.prefix }}_••••{{ credential.suffix }} · {{ credential.scopes.join(', ') }}</p>
            </div>
            <KBadge :variant="credential.revokedAt ? 'default' : 'success'">{{ credential.revokedAt ? t('credentialRevoked') : t('credentialActive') }}</KBadge>
            <button v-if="!credential.revokedAt" class="row-action text-rose-500" @click="revokeCredential(credential)"><Trash2 class="h-4 w-4" /></button>
          </div>
        </div>
        <h3 class="mt-6 font-display text-sm font-semibold text-ink-800">{{ t('credentialRecentActivity') }}</h3>
        <KEmpty v-if="!credentialLoading && !credentialActivity.length" class="mt-2" :title="t('credentialNoActivity')" />
        <div v-else class="workspace-list">
          <div v-for="receipt in credentialActivity" :key="receipt.id" class="workspace-row text-xs">
            <span class="font-mono text-ink-400">{{ receipt.actorFingerprint }}</span>
            <span class="min-w-0 flex-1 truncate text-ink-600">{{ t(`credentialActivity_${receipt.capability.replace('.', '_')}`) }} · {{ t(`credentialOutcome_${receipt.outcome}`) }}</span>
            <span class="text-ink-300">{{ new Date(receipt.createdAt).toLocaleString() }}</span>
          </div>
        </div>
      </div>

      <form class="workspace-form" @submit.prevent="createCredential">
        <h2 class="font-display font-semibold text-ink-800">{{ t('credentialCreate') }}</h2>
        <input v-model="credentialName" class="workspace-input" required :placeholder="t('credentialName')" />
        <div class="grid grid-cols-2 gap-2">
          <button v-for="scope in availableScopes" :key="scope" type="button" class="scope-button" :class="credentialScopes.includes(scope) && 'scope-button-active'" @click="toggleScope(scope)">
            <Check v-if="credentialScopes.includes(scope)" class="h-3 w-3" />{{ t(`credentialScope_${scope.replace('.', '_')}`) }}
          </button>
        </div>
        <label class="text-xs text-ink-500">{{ t('credentialExpiry') }}<input v-model="credentialExpiry" type="date" class="workspace-input mt-1 w-full" /></label>
        <input v-model="credentialConfirmation" class="workspace-input" required :placeholder="t('credentialConfirmName')" />
        <KButton type="submit" :loading="credentialCreating" :disabled="credentialConfirmation !== credentialName || !credentialScopes.length">{{ t('credentialCreateAction') }}</KButton>
      </form>
    </section>

    <section v-if="activeTab === 'admin' && authenticatedSession.canManage" class="flex flex-col gap-6">
      <div class="grid gap-3 sm:grid-cols-3">
        <button v-for="link in [{ path: '/fonts', icon: FolderCog, key: 'adminFontMaintenance' }, { path: '/sharing', icon: Archive, key: 'adminArchiveMaintenance' }, { path: '/logs', icon: Library, key: 'adminActivityMaintenance' }]" :key="link.path" class="admin-link" @click="router.push(link.path)">
          <component :is="link.icon" class="h-5 w-5 text-sakura-500" /><span>{{ t(link.key) }}</span><ChevronRight class="ml-auto h-4 w-4 text-ink-300" />
        </button>
      </div>
      <div class="grid gap-6 lg:grid-cols-2">
        <div class="workspace-section">
          <div class="workspace-toolbar"><h2 class="font-display font-semibold text-ink-800">{{ t('adminAllCredentials') }}</h2><Loader2 v-if="adminLoading" class="ml-auto h-4 w-4 animate-spin text-sakura-500" /></div>
          <div class="workspace-list">
            <div v-for="credential in adminCredentials" :key="credential.id" class="workspace-row">
              <div class="min-w-0 flex-1"><p class="truncate text-sm font-semibold text-ink-800">{{ credential.name }}</p><p class="truncate text-xs text-ink-400">{{ credential.organizationName }} · fia_{{ credential.prefix }}_••••{{ credential.suffix }}</p></div>
              <button v-if="!credential.revokedAt" class="row-action text-rose-500" @click="adminRevoke(credential)"><Trash2 class="h-4 w-4" /></button>
            </div>
          </div>
        </div>
        <div class="workspace-section">
          <h2 class="font-display font-semibold text-ink-800">{{ t('adminRecentReceipts') }}</h2>
          <div class="workspace-list mt-3">
            <div v-for="receipt in receipts" :key="receipt.id" class="workspace-row text-xs">
              <span class="font-mono text-ink-400">{{ receipt.actorFingerprint }}</span><span class="min-w-0 flex-1 truncate text-ink-600">{{ receipt.capability }} · {{ receipt.outcome }}</span><span class="text-ink-300">{{ new Date(receipt.createdAt).toLocaleString() }}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>

  <transition name="modal">
    <div v-if="revealedSecret" class="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/45 p-4" role="dialog" aria-modal="true">
      <div class="w-full max-w-lg rounded-2xl border border-sakura-100 bg-surface p-5 shadow-[var(--shadow-lg)]">
        <div class="flex items-start gap-3"><div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600"><KeyRound class="h-4 w-4" /></div><div class="min-w-0"><h2 class="font-display font-semibold text-ink-900">{{ t('credentialSecretTitle') }}</h2><p class="mt-1 text-sm text-ink-500">{{ t('credentialSecretOnce') }}</p></div></div>
        <div class="mt-4 break-all rounded-xl bg-ink-50 p-3 font-mono text-sm text-ink-800">{{ revealedSecret }}</div>
        <div class="mt-4 flex justify-end gap-2"><KButton variant="outline" @click="copySecret"><Copy class="h-4 w-4" />{{ copied ? t('copied') : t('copy') }}</KButton><KButton @click="revealedSecret = ''">{{ t('credentialSecretSaved') }}</KButton></div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.workspace-masthead { display: flex; align-items: end; justify-content: space-between; gap: 1rem; padding: 1.25rem 0 0.5rem; }
.workspace-select, .workspace-input { height: 2.5rem; border: 1px solid var(--color-ink-200); border-radius: 0.75rem; background: var(--color-surface); padding: 0 0.75rem; color: var(--color-ink-800); font-size: 0.875rem; outline: none; }
.workspace-select:focus, .workspace-input:focus { border-color: var(--color-sakura-400); box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-sakura-300) 25%, transparent); }
.workspace-tab { display: inline-flex; height: 2.5rem; flex-shrink: 0; align-items: center; gap: 0.4rem; padding: 0 0.85rem; border-bottom: 2px solid transparent; color: var(--color-ink-500); font-size: 0.875rem; font-weight: 600; }
.workspace-tab-active { border-color: var(--color-sakura-500); color: var(--color-ink-900); }
.workspace-section { min-width: 0; }
.workspace-toolbar { display: flex; min-height: 2.5rem; align-items: center; gap: 0.5rem; }
.workspace-list { display: flex; flex-direction: column; gap: 0.25rem; margin-top: 0.75rem; }
.workspace-row { display: flex; min-height: 3.5rem; align-items: center; gap: 0.75rem; border-bottom: 1px solid var(--color-ink-100); padding: 0.55rem 0.25rem; }
.workspace-row:last-child { border-bottom: 0; }
.row-action { display: inline-flex; height: 2rem; width: 2rem; flex-shrink: 0; align-items: center; justify-content: center; border-radius: 0.6rem; color: var(--color-ink-500); }
.row-action:hover { background: var(--color-sakura-50); color: var(--color-sakura-600); }
.workspace-form { display: flex; flex-direction: column; gap: 0.75rem; border: 1px solid var(--color-sakura-100); border-radius: 1rem; background: var(--color-surface); padding: 1rem; box-shadow: var(--shadow-sm); }
.file-picker { display: flex; height: 2.75rem; cursor: pointer; align-items: center; gap: 0.5rem; border: 1px dashed var(--color-sakura-300); border-radius: 0.75rem; padding: 0 0.75rem; color: var(--color-ink-600); font-size: 0.8rem; }
.scope-button { display: flex; min-height: 2.3rem; align-items: center; justify-content: center; gap: 0.3rem; border: 1px solid var(--color-ink-150, var(--color-ink-200)); border-radius: 0.65rem; padding: 0.35rem; color: var(--color-ink-500); font-size: 0.72rem; }
.scope-button-active { border-color: var(--color-sakura-300); background: var(--color-sakura-50); color: var(--color-sakura-700); }
.admin-link { display: flex; min-height: 3.5rem; align-items: center; gap: 0.75rem; border: 1px solid var(--color-sakura-100); border-radius: 1rem; background: var(--color-surface); padding: 0.75rem 1rem; color: var(--color-ink-700); font-weight: 600; box-shadow: var(--shadow-sm); }
.admin-link:hover { border-color: var(--color-sakura-200); color: var(--color-sakura-600); }
@media (max-width: 640px) { .workspace-masthead { align-items: stretch; flex-direction: column; } .workspace-select { width: 100%; } }
</style>
