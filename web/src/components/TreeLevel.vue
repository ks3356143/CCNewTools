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
      <v-icon size="16" class="chev" :class="{ closed: !open }">mdi-chevron-down</v-icon>
      <span class="name">{{ node.name }}</span>
      <span class="cnt">{{ node.caseCount }}</span>
    </button>
    <!-- v-if（非 v-show）：折叠的子树不创建 DOM——2026-10-09 验证轮实测 29686 例全量渲染约 30 万节点卡死主线程 -->
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
        <v-icon v-if="cn.row.reviewed" size="13" color="success">mdi-check</v-icon>
        <span v-else class="dot-holder">
          <span v-if="activeSuspects(cn.row) > 0" class="dot" />
        </span>
        <span class="name" :class="{ excluded: cn.row.excluded }">{{ cn.row.mingcheng }}</span>
        <span class="cid">{{ cn.row.caseId }}</span>
      </button>
      <div v-if="hiddenCases > 0" class="more">…还有 {{ hiddenCases }} 个用例未显示，请用搜索定位</div>
    </div>
  </div>
</template>

<style scoped>
/* 缩进只靠嵌套 .indent 的 margin-left 累积（每层 15px，与常见树控件同量级）——
   行内 padding 固定；此前行 padding 又乘 depth 与嵌套 margin 双重叠加，每层实缩 30px，
   四层深的用例行缩进 145px，内网实测"缩进太大"（2026-10-09） */
.lvl { min-width: 0; }
.row { width: 100%; display: flex; align-items: center; gap: 6px; border-radius: 8px; text-align: left; cursor: pointer; transition: background 0.13s, color 0.13s; }
.row:hover { background: rgba(var(--v-theme-primary), 0.08); }
.level-row { padding-left: 8px; padding-right: 8px; font-size: 13.5px; font-weight: 550; color: rgba(var(--v-theme-on-surface), 0.88); }
.level-row.is-item { font-weight: 500; color: rgba(var(--v-theme-on-surface), 0.68); font-size: 13px; }
.indent { margin-left: 15px; border-left: 1px solid rgba(var(--v-theme-outline), 0.35); padding-left: 0; }
.case-row { padding-left: 10px; margin-right: 6px; font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.75); }
.case-row.cur { background: rgba(var(--v-theme-primary), 0.14); color: rgb(var(--v-theme-primary)); font-weight: 550; }
.chev { transition: transform 0.18s; flex: none; }
.chev.closed { transform: rotate(-90deg); }
.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
.name.excluded { text-decoration: line-through; opacity: 0.5; }
.cnt { margin-left: auto; font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.5); flex: none; }
.cid { margin-left: auto; font-family: Consolas, monospace; font-size: 10.5px; opacity: 0.65; flex: none; }
.dot-holder { width: 14px; display: inline-flex; justify-content: center; flex: none; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: rgb(var(--v-theme-error)); }
.more { padding: 2px 0 4px; font-size: 11.5px; color: rgb(var(--v-theme-warning)); }
</style>
