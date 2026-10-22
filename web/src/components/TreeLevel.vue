<script setup lang="ts">
import { computed } from 'vue'
import { store, goCase } from '../store.ts'
import { activeSuspects } from '../suspect.ts'
import type { CaseRow, PathNode } from '../types.ts'

const props = defineProps<{ node: PathNode; openFn: (key: string) => boolean; depth: number }>()

const emit = defineEmits<{ toggle: [key: string] }>()

// 展开与否由父级 openFn 判定（小文档/搜索默认全展开、手动收缩为例外；大文档非搜索按 expanded 逐层展开）
const open = computed(() => props.openFn(props.node.key))

function toggle(): void {
  emit('toggle', props.node.key)
}

const hasContent = computed(() => props.node.children.length > 0 || props.node.cases.length > 0)

/**
 * 单层渲染上限（2026-10-09 验证轮）：极端文档单层可挂上万个节点（42MB 样本"功能测试"
 * 一层 14843 个测试项），展开即卡死。每层只渲染前 LIMIT 行，其余折叠计数提示、可搜索定位。
 */
const CHILD_LIMIT = 200
const CASE_LIMIT = 500
const shownChildren = computed(() => props.node.children.slice(0, CHILD_LIMIT))
const hiddenChildren = computed(() => Math.max(0, props.node.children.length - CHILD_LIMIT))
const shownCases = computed(() => props.node.cases.slice(0, CASE_LIMIT))
const hiddenCases = computed(() => Math.max(0, props.node.cases.length - CASE_LIMIT))
</script>

<template>
  <div class="lvl">
    <button
      v-if="hasContent"
      class="row level-row"
      :class="{ 'is-item': depth >= 2 }"
      @click="toggle"
    >
      <v-icon size="15" class="chev" :class="{ closed: !open }">mdi-chevron-down</v-icon>
      <span class="name">{{ node.name }}</span>
      <span class="cnt u-mono">{{ node.caseCount }}</span>
    </button>
    <!-- v-if（非 v-show）：折叠的子树不创建 DOM——29686 例全量渲染约 30 万节点卡死主线程 -->
    <div v-if="open && hasContent" class="indent">
      <TreeLevel
        v-for="ch in shownChildren"
        :key="ch.key"
        :node="ch"
        :open-fn="openFn"
        :depth="depth + 1"
        @toggle="k => emit('toggle', k)"
      />
      <div v-if="hiddenChildren > 0" class="more">…还有 {{ hiddenChildren }} 个下级未显示，请用搜索定位</div>
      <button
        v-for="cn in shownCases"
        :key="cn.row.caseId + '@' + cn.idx"
        class="row case-row"
        :data-idx="cn.idx"
        :class="{ cur: cn.idx === store.currentIdx }"
        @click="goCase(cn.idx)"
      >
        <v-icon v-if="cn.row.reviewed" size="12" color="success">mdi-check</v-icon>
        <span v-else class="dot-holder">
          <span v-if="activeSuspects(cn.row) > 0" class="dot" />
        </span>
        <span class="name" :class="{ excluded: cn.row.excluded }">{{ cn.row.mingcheng }}</span>
        <span class="cid u-mono">{{ cn.row.caseId }}</span>
      </button>
      <div v-if="hiddenCases > 0" class="more">…还有 {{ hiddenCases }} 个用例未显示，请用搜索定位</div>
    </div>
  </div>
</template>

<style scoped>
/* 缩进只靠嵌套 .indent 的 margin-left 累积（每层 14px）——行内 padding 固定，
   避免"行 padding × depth + 嵌套 margin"双重叠加（2026-10-09 内网实测"缩进太大"） */
.lvl { min-width: 0; }
.row {
  width: 100%; min-height: 34px;
  display: flex; align-items: center; gap: 6px;
  padding: 3px 8px; border-radius: var(--cn-r-1);
  text-align: left; cursor: pointer;
  transition: background var(--cn-dur-1) var(--cn-ease-out), color var(--cn-dur-1) var(--cn-ease-out);
}
.row:hover { background: var(--cn-surface-soft); }
.level-row { font-size: 13px; font-weight: 600; color: var(--cn-fg-soft); }
.level-row.is-item { font-weight: 500; color: var(--cn-muted); font-size: 12.5px; }
/* 子级展开：淡入 + 上移 3px（200ms）；收起仍为 v-if 即时移除（大文档不保留 DOM 的既定取舍） */
.indent {
  margin-left: 16px;
  border-left: 1px solid var(--cn-border);
  animation: tree-open 200ms var(--cn-ease-out);
}
@keyframes tree-open {
  from { opacity: 0; transform: translateY(-3px); }
  to { opacity: 1; transform: translateY(0); }
}
.case-row { padding-left: 9px; margin-right: 4px; font-size: 12.5px; color: var(--cn-muted); }
.case-row:hover { color: var(--cn-fg); }
/* 选中态：浅蓝底 + 左侧 3px 主色标记（v5 评审 006），一眼可见但不压过正文 */
.case-row.cur {
  background: #e9f3ff; color: #1459a9; font-weight: 600;
  box-shadow: inset 3px 0 0 var(--cn-accent);
}
.v-theme--dark .case-row.cur { background: var(--cn-accent-soft); color: var(--cn-accent-strong); }
.chev { transition: transform var(--cn-dur-2) var(--cn-ease-out); flex: none; color: var(--cn-subtle); }
.chev.closed { transform: rotate(-90deg); }
.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
.name.excluded { text-decoration: line-through; opacity: 0.5; }
.cnt { margin-left: auto; font-size: 10px; color: var(--cn-subtle); flex: none; }
.cid { margin-left: auto; font-size: 10px; opacity: 0.75; flex: none; }
.dot-holder { width: 13px; display: inline-flex; justify-content: center; flex: none; }
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--cn-danger); }
.more { padding: 3px 6px 4px; font-size: 10.5px; color: var(--cn-warning); }
</style>
