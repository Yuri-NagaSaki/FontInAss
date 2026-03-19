<script setup lang="ts">
import { FolderOpen, FolderClosed, FileText, Loader2, MoreHorizontal, Layers } from "lucide-vue-next";

interface R2Node {
  prefix: string;
  name: string;
  type: "folder" | "file";
  size?: number;
  indexed?: boolean;
  loading?: boolean;
  expanded?: boolean;
  children?: R2Node[];
  cursor?: string | null;
  hasMore?: boolean;
  loadingMore?: boolean;
}

interface IndexProg {
  active: boolean;
  indexed: number;
  skipped: number;
  total: number;
  phase: string;
}

const props = defineProps<{
  node: R2Node;
  depth?: number;
  indexProgress?: Record<string, IndexProg>;
}>();

const emit = defineEmits<{
  toggle: [node: R2Node];
  "load-more": [node: R2Node];
  "index-file": [node: R2Node];
  "index-all": [prefix: string];
}>();

const indent = `${(props.depth ?? 0) * 16 + 12}px`;

const fmt = (n: number) =>
  n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;

const prog = () => props.indexProgress?.[props.node.prefix];
</script>

<template>
  <div class="select-none">
    <!-- Row -->
    <div
      class="flex items-center gap-2 px-3 py-1.5 rounded-xl group transition-colors"
      :class="node.type === 'folder'
        ? 'hover:bg-sakura-50 cursor-pointer'
        : 'hover:bg-ink-50'"
      :style="{ paddingLeft: indent }"
      @click="node.type === 'folder' ? emit('toggle', node) : undefined"
    >
      <!-- Icon -->
      <Loader2
        v-if="node.type === 'folder' && node.loading"
        class="w-4 h-4 shrink-0 text-sakura-400 animate-spin-slow"
      />
      <FolderOpen
        v-else-if="node.type === 'folder' && node.expanded"
        class="w-4 h-4 shrink-0 text-sky-400"
      />
      <FolderClosed
        v-else-if="node.type === 'folder'"
        class="w-4 h-4 shrink-0 text-sky-300"
      />
      <FileText v-else class="w-4 h-4 shrink-0 text-ink-300" />

      <!-- Name -->
      <span
        class="flex-1 truncate text-xs"
        :class="node.type === 'folder' ? 'font-medium text-ink-700' : 'text-ink-500'"
      >{{ node.name }}</span>

      <!-- File: size & indexed badge -->
      <template v-if="node.type === 'file'">
        <span v-if="node.size" class="text-[11px] text-ink-300 shrink-0">{{ fmt(node.size) }}</span>
        <span v-if="node.indexed" class="text-[11px] text-mint-600 bg-mint-100 px-1.5 py-0.5 rounded-md shrink-0 font-medium">✓</span>
        <button
          v-if="!node.indexed"
          class="opacity-0 group-hover:opacity-100 text-[11px] text-sky-500 hover:text-sky-700 shrink-0 px-2 py-0.5 rounded-md hover:bg-sky-50 transition-all"
          @click.stop="emit('index-file', node)"
        >Index</button>
      </template>

      <!-- Folder: index-all button or progress -->
      <template v-if="node.type === 'folder'">
        <button
          v-if="!prog()?.active"
          class="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-[11px] text-sakura-500 hover:text-sakura-700 shrink-0 px-2 py-0.5 rounded-md hover:bg-sakura-50 transition-all"
          @click.stop="emit('index-all', node.prefix)"
        >
          <Layers class="w-3 h-3" /> Index All
        </button>
        <span v-else class="text-[11px] text-sakura-500 shrink-0 flex items-center gap-1">
          <Loader2 class="w-3 h-3 animate-spin-slow" />
          <span v-if="prog()!.phase === 'listing'">Scanning…</span>
          <span v-else>{{ prog()!.indexed + prog()!.skipped }}/{{ prog()!.total }}</span>
        </span>
      </template>
    </div>

    <!-- Children -->
    <template v-if="node.expanded && node.children">
      <R2NodeRow
        v-for="child in node.children"
        :key="child.prefix"
        :node="child"
        :depth="(depth ?? 0) + 1"
        :index-progress="indexProgress"
        @toggle="emit('toggle', $event)"
        @load-more="emit('load-more', $event)"
        @index-file="emit('index-file', $event)"
        @index-all="emit('index-all', $event)"
      />
      <!-- Load more -->
      <div v-if="node.hasMore" :style="{ paddingLeft: `${(depth ?? 0) * 16 + 28}px` }" class="mt-0.5">
        <button
          class="flex items-center gap-1 text-[11px] text-sky-500 hover:text-sky-700 px-2 py-1 rounded-md hover:bg-sky-50 transition-colors"
          @click="emit('load-more', node)"
        >
          <Loader2 v-if="node.loadingMore" class="w-3 h-3 animate-spin-slow" />
          <MoreHorizontal v-else class="w-3 h-3" />
          {{ node.loadingMore ? "Loading…" : `Load more (${node.children.length} loaded)` }}
        </button>
      </div>
    </template>
  </div>
</template>
