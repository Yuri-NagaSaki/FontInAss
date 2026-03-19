<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { message } from "ant-design-vue";
import type { TreeProps } from "ant-design-vue";
import {
  listFonts, uploadFonts, deleteFont, deleteFontsBatch,
  browseR2, indexR2Folder, indexR2Keys,
  getApiKey, setApiKey,
} from "../api/client";
import type { FontItem, BrowseFile } from "../api/client";

const { t } = useI18n();

// ─── API Key lock ─────────────────────────────────────────────────────────────
const apiKey = ref(getApiKey());
const hasKey = computed(() => !!apiKey.value.trim());
const lockKeyInput = ref("");

const unlockWithKey = () => {
  const k = lockKeyInput.value.trim();
  if (!k) return;
  setApiKey(k);
  apiKey.value = k;
  loadRoot();
  loadFontList();
};

// ─── R2 Browser tree ─────────────────────────────────────────────────────────

interface TreeNode {
  key: string;
  title: string;
  isLeaf: boolean;
  children?: TreeNode[];
  // custom fields
  _type: "folder" | "file";
  _size?: number;
  _indexed?: boolean;
  _indexing?: boolean;
}

const treeData = ref<TreeNode[]>([]);
const browserLoading = ref(false);

// Per-folder indexing state (kept outside tree so reactivity works cleanly)
interface FolderIndexState {
  indexing: boolean;
  indexed: number;
  skipped: number;
  errors: number;
}
const folderIndex = reactive<Record<string, FolderIndexState>>({});

const buildNodes = (parentPrefix: string, folders: string[], files: BrowseFile[]): TreeNode[] => {
  const folderNodes: TreeNode[] = folders.map(f => {
    const name = f.slice(parentPrefix.length).replace(/\/$/, "") || f;
    if (!folderIndex[f]) folderIndex[f] = { indexing: false, indexed: 0, skipped: 0, errors: 0 };
    return { key: f, title: name, isLeaf: false, children: [], _type: "folder" };
  });

  const fileNodes: TreeNode[] = files.map(f => ({
    key: f.key,
    title: f.name,
    isLeaf: true,
    _type: "file",
    _size: f.size,
    _indexed: f.indexed,
    _indexing: false,
  }));

  return [...folderNodes, ...fileNodes];
};

const loadRoot = async () => {
  browserLoading.value = true;
  try {
    const res = await browseR2("");
    treeData.value = buildNodes("", res.folders, res.files);
  } catch (e) {
    message.error("R2 browse failed: " + String(e));
  } finally {
    browserLoading.value = false;
  }
};

// Called by AntD Tree when a folder node is expanded
const loadTreeData: TreeProps["loadData"] = ({ dataRef }: any): Promise<void> => {
  const node = dataRef as TreeNode;
  if (node._type !== "folder" || (node.children && node.children.length > 0)) {
    return Promise.resolve();
  }
  return (async () => {
    let allFolders: string[] = [];
    let allFiles: BrowseFile[] = [];
    let cursor: string | null = null;
    do {
      const res = await browseR2(node.key, cursor ?? undefined);
      allFolders.push(...res.folders);
      allFiles.push(...res.files);
      cursor = res.cursor;
    } while (cursor);
    node.children = buildNodes(node.key, allFolders, allFiles);
  })();
};

// Refresh indexed status for files under a folder node (after indexing)
const refreshFolderIndexed = (_nodeKey: string, indexedKeys: Set<string>) => {
  const walk = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if (n._type === "file" && indexedKeys.has(n.key)) n._indexed = true;
      if (n.children) walk(n.children);
    }
  };
  walk(treeData.value);
};

// Index all fonts in a folder (loop until done)
const doIndexFolder = async (folderKey: string) => {
  if (!folderIndex[folderKey]) folderIndex[folderKey] = { indexing: false, indexed: 0, skipped: 0, errors: 0 };
  const state = folderIndex[folderKey];
  state.indexing = true;
  state.indexed = 0;
  state.skipped = 0;
  state.errors = 0;

  const indexedKeys = new Set<string>();
  try {
    let cursor: string | undefined = undefined;
    let done = false;
    while (!done) {
      const res = await indexR2Folder(folderKey, cursor, 5);
      state.indexed += res.indexed;
      state.skipped += res.skipped;
      state.errors += res.errors.length;
      done = res.done;
      cursor = res.nextCursor ?? undefined;
    }
    message.success(t("indexDone", { n: state.indexed }));
    refreshFolderIndexed(folderKey, indexedKeys);
    await loadFontList();
  } catch (e) {
    message.error(t("indexFailed") + ": " + String(e));
  } finally {
    state.indexing = false;
  }
};

// Index a single file node
const doIndexFile = async (node: TreeNode) => {
  node._indexing = true;
  try {
    const res = await indexR2Keys([node.key]);
    if (res.indexed > 0) {
      node._indexed = true;
      message.success(t("indexDone", { n: 1 }));
      await loadFontList();
    } else if (res.skipped > 0) {
      node._indexed = true;
      message.info(t("r2AlreadyIndexed"));
    } else {
      message.error(res.errors[0] ?? t("indexFailed"));
    }
  } catch (e) {
    message.error(String(e));
  } finally {
    node._indexing = false;
  }
};

// ─── Indexed fonts table ──────────────────────────────────────────────────────

const loading = ref(false);
const uploading = ref(false);
const uploadProgress = ref({ done: 0, total: 0 });
const fonts = ref<FontItem[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(50);
const search = ref("");
const selectedRowKeys = ref<string[]>([]);
const dragActive = ref(false);
let dragCounter = 0;
const browserExpanded = ref(true);

const loadFontList = async () => {
  if (!hasKey.value) return;
  loading.value = true;
  try {
    const res = await listFonts(page.value, pageSize.value, search.value);
    fonts.value = res.data as FontItem[];
    total.value = res.total;
  } catch (e) {
    message.error(String(e));
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  if (hasKey.value) {
    loadRoot();
    loadFontList();
  }
});
watch([page, pageSize], loadFontList);

let searchTimer: ReturnType<typeof setTimeout>;
const onSearch = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { page.value = 1; loadFontList(); }, 400);
};

// ─── Upload ───────────────────────────────────────────────────────────────────

const handleUpload = async (fileList: FileList | File[]) => {
  const files = Array.from(fileList).filter(f => /\.(ttf|otf|ttc|otc)$/i.test(f.name));
  if (files.length === 0) { message.warning(t("noFontFiles")); return; }

  uploading.value = true;
  uploadProgress.value = { done: 0, total: files.length };

  try {
    const results = await uploadFonts(files, (done, total) => {
      uploadProgress.value = { done, total };
    });
    const ok = results.filter(r => !r.error);
    const fail = results.filter(r => r.error);
    if (ok.length) message.success(`${t("fontUploadOk")} (${ok.length})`);
    if (fail.length) message.error(`${t("fontUploadFail")}: ${fail.map(r => r.error).join("; ")}`);
    await loadFontList();
  } catch (e) {
    message.error(String(e));
  } finally {
    uploading.value = false;
    uploadProgress.value = { done: 0, total: 0 };
  }
};

const onClickUpload = () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".ttf,.otf,.ttc,.otc";
  input.multiple = true;
  input.onchange = (e) => {
    const files = (e.target as HTMLInputElement).files;
    if (files) handleUpload(files);
  };
  input.click();
};

const onDragEnter = (e: DragEvent) => { e.preventDefault(); dragCounter++; dragActive.value = true; };
const onDragOver = (e: DragEvent) => { e.preventDefault(); };
const onDragLeave = (e: DragEvent) => { e.preventDefault(); if (--dragCounter <= 0) { dragActive.value = false; dragCounter = 0; } };
const onDrop = (e: DragEvent) => {
  e.preventDefault(); dragActive.value = false; dragCounter = 0;
  if (e.dataTransfer?.files) handleUpload(e.dataTransfer.files);
};

// ─── Delete ───────────────────────────────────────────────────────────────────

const doDelete = async (id: string) => {
  try { await deleteFont(id); message.success(t("fontDeleteOk")); await loadFontList(); }
  catch { message.error(t("fontDeleteFail")); }
};

const doBatchDelete = async () => {
  if (!selectedRowKeys.value.length) return;
  try {
    const n = await deleteFontsBatch(selectedRowKeys.value);
    message.success(`${t("fontDeleteOk")} (${n})`);
    selectedRowKeys.value = [];
    await loadFontList();
  } catch { message.error(t("fontDeleteFail")); }
};

// ─── Table columns ────────────────────────────────────────────────────────────

const columns = computed(() => [
  { title: t("colFilename"), dataIndex: "filename", key: "filename", ellipsis: true },
  { title: t("colFamilyNames"), dataIndex: "names", key: "names", ellipsis: true },
  { title: t("colWeight"), dataIndex: "weight", key: "weight", width: 80 },
  { title: t("colStyle"), key: "style", width: 90 },
  { title: t("colSize"), key: "size", width: 90 },
  { title: t("colDate"), dataIndex: "created_at", key: "created_at", width: 160, ellipsis: true },
  { title: t("colAction"), key: "action", width: 80, fixed: "right" },
]);

const formatSize = (bytes: number) => {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
  return (bytes / 1024).toFixed(0) + " KB";
};

const styleLabel = (row: FontItem) => {
  if (row.bold && row.italic) return t("boldItalic");
  if (row.bold) return t("bold");
  if (row.italic) return t("italic");
  return t("regular");
};

const rowSelection = reactive({
  selectedRowKeys,
  onChange: (keys: string[]) => { selectedRowKeys.value = keys; },
});
</script>

<template>
  <!-- ─── Lock screen ─────────────────────────────────────────────────────── -->
  <div v-if="!hasKey" class="lock-screen">
    <div class="lock-card">
      <div class="lock-icon">🔒</div>
      <h2>{{ t("lockScreenTitle") }}</h2>
      <p class="lock-desc">{{ t("lockScreenDesc") }}</p>
      <a-input-password
        v-model:value="lockKeyInput"
        :placeholder="t('apiKeyPlaceholder')"
        size="large"
        style="margin-bottom:12px"
        @press-enter="unlockWithKey"
      />
      <a-button type="primary" size="large" block @click="unlockWithKey">
        {{ t("apiKeySave") }}
      </a-button>
    </div>
  </div>

  <!-- ─── Main content (requires API key) ───────────────────────────────── -->
  <div v-else @dragenter="onDragEnter" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
    <!-- Drag overlay -->
    <transition name="fade">
      <div v-if="dragActive" class="drop-overlay">{{ t("dropFontTip") }}</div>
    </transition>

    <!-- ─── R2 File Browser ──────────────────────────────────────────────── -->
    <a-card
      :title="t('r2Browser')"
      style="margin-bottom:16px"
      :body-style="{ padding: browserExpanded ? '12px' : '0' }"
    >
      <template #extra>
        <a-button type="link" size="small" @click="browserExpanded = !browserExpanded">
          {{ browserExpanded ? t("collapse") : t("expand") }}
        </a-button>
        <a-button type="link" size="small" :loading="browserLoading" @click="loadRoot">
          {{ t("refresh") }}
        </a-button>
      </template>

      <div v-show="browserExpanded">
        <a-spin :spinning="browserLoading">
          <a-tree
            v-if="treeData.length > 0"
            :tree-data="treeData"
            :load-data="loadTreeData"
            block-node
            class="r2-tree"
          >
            <template #title="nodeData">
              <span class="tree-node">
                <span class="tree-node-icon">
                  {{ nodeData._type === 'folder' ? '📁' : (nodeData._indexed ? '✅' : '📄') }}
                </span>
                <span class="tree-node-name">{{ nodeData.title }}</span>
                <span v-if="nodeData._type === 'file'" class="tree-node-size">
                  {{ formatSize(nodeData._size ?? 0) }}
                </span>

                <!-- File: index button if not yet indexed -->
                <a-button
                  v-if="nodeData._type === 'file' && !nodeData._indexed"
                  :loading="nodeData._indexing"
                  size="small"
                  type="default"
                  class="tree-action"
                  @click.stop="doIndexFile(nodeData)"
                >
                  {{ t("r2IndexFile") }}
                </a-button>
                <a-tag v-if="nodeData._type === 'file' && nodeData._indexed" color="success" class="tree-action">
                  {{ t("r2Indexed") }}
                </a-tag>

                <!-- Folder: index-all button + progress -->
                <template v-if="nodeData._type === 'folder'">
                  <a-button
                    :loading="folderIndex[nodeData.key]?.indexing"
                    size="small"
                    type="primary"
                    ghost
                    class="tree-action"
                    @click.stop="doIndexFolder(nodeData.key)"
                  >
                    {{ t("r2IndexAll") }}
                  </a-button>
                  <span
                    v-if="folderIndex[nodeData.key]?.indexing || folderIndex[nodeData.key]?.indexed > 0"
                    class="index-stats"
                  >
                    <template v-if="folderIndex[nodeData.key]?.indexing">{{ t("r2Indexing") }}…</template>
                    <template v-else>
                      +{{ folderIndex[nodeData.key]?.indexed }}
                      <span v-if="folderIndex[nodeData.key]?.errors" style="color:#ff4d4f">
                        / {{ folderIndex[nodeData.key]?.errors }} err
                      </span>
                    </template>
                  </span>
                </template>
              </span>
            </template>
          </a-tree>
          <a-empty v-else-if="!browserLoading" :description="t('r2Empty')" />
        </a-spin>
      </div>
    </a-card>

    <!-- ─── Indexed fonts ─────────────────────────────────────────────────── -->
    <a-card :title="t('indexedFonts')">
      <!-- Toolbar -->
      <a-space style="margin-bottom:16px;flex-wrap:wrap;" :size="8">
        <a-button type="primary" :loading="uploading" @click="onClickUpload">
          <template v-if="uploading && uploadProgress.total > 0">
            {{ t("fontUploading") }} ({{ uploadProgress.done }}/{{ uploadProgress.total }})
          </template>
          <template v-else>{{ t("fontUpload") }}</template>
        </a-button>
        <a-button danger :disabled="selectedRowKeys.length === 0" @click="doBatchDelete">
          {{ t("fontBatchDelete") }}
          <template v-if="selectedRowKeys.length">({{ selectedRowKeys.length }})</template>
        </a-button>
        <a-input-search
          v-model:value="search"
          :placeholder="t('fontSearch')"
          allow-clear
          style="width:240px"
          @change="onSearch"
          @search="onSearch"
        />
        <span style="color:#888;font-size:13px;">{{ t("fontTotal", { n: total }) }}</span>
      </a-space>

      <a-alert
        v-if="fonts.length === 0 && !loading"
        :message="t('noFonts')"
        :description="t('fontsHint')"
        type="info"
        show-icon
        style="margin-bottom:16px"
      />

      <a-table
        :columns="columns"
        :data-source="fonts"
        :loading="loading"
        :row-selection="rowSelection"
        row-key="id"
        :pagination="{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          pageSizeOptions: ['20','50','100','200'],
          onChange: (p: number, ps: number) => { page = p; pageSize = ps; },
          showTotal: (t: number) => `共 ${t} 条`,
        }"
        size="small"
        :scroll="{ x: 900 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'style'">
            <a-tag :color="record.bold || record.italic ? 'blue' : 'default'">
              {{ styleLabel(record as FontItem) }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'size'">{{ formatSize((record as FontItem).size) }}</template>
          <template v-else-if="column.key === 'action'">
            <a-popconfirm :title="t('deleteConfirm')" @confirm="doDelete((record as FontItem).id)">
              <a-button type="link" danger size="small">{{ t("delete") }}</a-button>
            </a-popconfirm>
          </template>
        </template>
      </a-table>
    </a-card>
  </div>
</template>

<style scoped>
.lock-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
}
.lock-card {
  width: 380px;
  padding: 40px 32px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.1);
  text-align: center;
}
.lock-icon { font-size: 48px; margin-bottom: 16px; }
.lock-card h2 { margin-bottom: 8px; }
.lock-desc { color: #888; margin-bottom: 20px; }

.drop-overlay {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(22,119,255,0.12);
  border: 3px dashed #1677ff;
  display: flex; align-items: center; justify-content: center;
  font-size: 20px; color: #1677ff; pointer-events: none;
}

.r2-tree { max-height: 480px; overflow-y: auto; }

.tree-node {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 24px;
}
.tree-node-icon { flex-shrink: 0; }
.tree-node-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tree-node-size { color: #999; font-size: 12px; flex-shrink: 0; }
.tree-action { flex-shrink: 0; }
.index-stats { color: #888; font-size: 12px; flex-shrink: 0; }

.fade-enter-active, .fade-leave-active { transition: opacity .25s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>


