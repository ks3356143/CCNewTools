<script setup lang="ts">
import { computed } from 'vue'
import { store, goCase } from '../store.ts'
import { activeSuspects } from '../suspect.ts'
import type { CaseRow, PathNode } from '../types.ts'

const props = defineProps<{ node: PathNode; collapsed: Set<string>; depth: number }>()

const emit = defineEmits<{ toggle: [key: string] }>()

const open = computed(() => !props.collapsed.has(props.node.key))
function toggle(): void {
  emit('toggle', props.node.key)
}

const hasContent = computed(() => props.node.children.length > 0 || props.node.cases.length > 0)
</script>

<template>
  <div class="lvl">
    <button
      v-if="hasContent"
      class="row level-row"
      :class="{ 'is-item': depth >= 2 }"
      :style="{ paddingLeft: 8 + depth * 15 + 'px' }"
      @click="toggle"
    >
      <v-icon size="16" class="chev" :class="{ closed: !open }">mdi-chevron-down</v-icon>
      <span class="name">{{ node.name }}</span>
      <span class="cnt">{{ node.caseCount }}</span>
    </button>
    <div v-show="open && hasContent" class="indent">
      <TreeLevel
        v-for="ch in node.children"
        :key="ch.key"
        :node="ch"
        :collapsed="collapsed"
        :depth="depth + 1"
        @toggle="k => emit('toggle', k)"
      />
      <button
        v-for="cn in node.cases"
        :key="cn.row.caseId + '@' + cn.idx"
        class="row case-row"
        :data-idx="cn.idx"
        :style="{ paddingLeft: 10 + (depth + 1) * 15 + 'px' }"
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
    </div>
  </div>
</template>

<style scoped>
/* 折叠行按深度缩进（根层 8px 起步，每层 +15px）；深度 ≥2（测试项级）弱化为分组视觉 */
.lvl { min-width: 0; }
.row { width: 100%; display: flex; align-items: center; gap: 6px; border-radius: 8px; text-align: left; cursor: pointer; transition: background 0.13s, color 0.13s; }
.row:hover { background: rgba(var(--v-theme-primary), 0.08); }
.level-row { padding-right: 8px; font-size: 13.5px; font-weight: 550; color: rgba(var(--v-theme-on-surface), 0.88); }
.level-row.is-item { font-weight: 500; color: rgba(var(--v-theme-on-surface), 0.68); font-size: 13px; }
.indent { margin-left: 15px; border-left: 1px solid rgba(var(--v-theme-outline), 0.35); padding-left: 0; }
.case-row { margin-right: 6px; font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.75); }
.case-row.cur { background: rgba(var(--v-theme-primary), 0.14); color: rgb(var(--v-theme-primary)); font-weight: 550; }
.chev { transition: transform 0.18s; flex: none; }
.chev.closed { transform: rotate(-90deg); }
.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
.name.excluded { text-decoration: line-through; opacity: 0.5; }
.cnt { margin-left: auto; font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.5); flex: none; }
.cid { margin-left: auto; font-family: Consolas, monospace; font-size: 10.5px; opacity: 0.65; flex: none; }
.dot-holder { width: 14px; display: inline-flex; justify-content: center; flex: none; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: rgb(var(--v-theme-error)); }
</style>
