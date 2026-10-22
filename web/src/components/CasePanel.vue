<script setup lang="ts">
import { computed } from 'vue'
import { store, scheduleSave, showToast } from '../store.ts'
import StepsTable from './StepsTable.vue'

const row = computed(() => store.cases[store.currentIdx] ?? null)

const path = computed(() => {
  if (!row.value) return []
  return [row.value.typeName, row.value.groupName, row.value.itemName].filter(Boolean) as string[]
})

function toggleReviewed(): void {
  if (!row.value) return
  row.value.reviewed = !row.value.reviewed
  scheduleSave()
}

function toggleExcluded(): void {
  if (!row.value) return
  row.value.excluded = !row.value.excluded
  scheduleSave()
  showToast(row.value.excluded ? '该用例不生成' : '已恢复生成该用例')
}

function onChanged(): void {
  scheduleSave()
}
</script>

<template>
  <div v-if="row" class="case">
    <div class="crumb">
      <span class="u-mono crumb-idx">CASE {{ String(store.currentIdx + 1).padStart(3, '0') }}</span>
      <template v-for="(p, i) in path" :key="i">
        <span v-if="i > 0" class="sep">/</span><span>{{ p }}</span>
      </template>
    </div>

    <div class="title-row">
      <h2>{{ row.mingcheng }}</h2>
      <div class="btns">
        <v-btn size="small" :color="row.excluded ? 'warning' : 'secondary'" variant="tonal" @click="toggleExcluded">
          {{ row.excluded ? '已排除，点击恢复' : '不生成此用例' }}
        </v-btn>
        <v-btn size="small" :color="row.reviewed ? 'success' : 'primary'" variant="tonal" @click="toggleReviewed">
          <v-icon size="13" class="mr-1">{{ row.reviewed ? 'mdi-check-circle' : 'mdi-check' }}</v-icon>
          {{ row.reviewed ? '已核对' : '标记已核对' }}
        </v-btn>
      </div>
    </div>

    <div class="chips">
      <span class="u-tag">标识 {{ row.caseId }}</span>
      <span class="chip"><span class="k">测试需求标识</span><span class="u-mono">{{ row.itemId }}</span></span>
      <span class="chip"><span class="k">章节</span><span class="u-mono">{{ row.chapter }}</span></span>
      <span v-if="row.expectSource === '通过准则'" class="chip"><span class="k">期望来源</span>通过准则</span>
    </div>

    <div class="summary"><b>用例综述</b><span>{{ row.summary || '（空）' }}</span></div>

    <div class="case-card" :class="{ dim: row.excluded }">
      <div class="case-card-head">
        <strong>测试步骤</strong>
        <span class="hint">单击单元格修改 · 自动保存</span>
      </div>
      <StepsTable :row="row" @changed="onChanged" />
    </div>
  </div>

  <!-- 空态（无任何用例时不再留白屏，2026-10-22 样式审计） -->
  <div v-else class="case-empty">
    <v-icon size="34" class="empty-icon">mdi-file-document-outline</v-icon>
    <b>没有可核对的用例</b>
    <span>请返回「选择大纲」导入测试大纲，解析完成后再来核对。</span>
    <v-btn size="small" variant="tonal" color="primary" @click="store.screen = 1">返回选择大纲</v-btn>
  </div>
</template>

<style scoped>
.case { min-width: 0; }
.crumb {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  color: var(--cn-subtle); font-size: 11px;
}
.crumb-idx { color: var(--cn-accent); font-size: 10.5px; letter-spacing: 0.08em; margin-right: 2px; }
.sep { opacity: 0.45; }

.title-row { display: flex; align-items: center; gap: 12px; margin-top: 5px; flex-wrap: wrap; }
.title-row h2 {
  margin: 0; font-family: var(--cn-font-display);
  font-size: 19px; font-weight: 650; letter-spacing: -0.015em; color: var(--cn-fg);
}
.btns { margin-left: auto; display: flex; gap: 7px; }

.chips { display: flex; align-items: center; gap: 7px; margin-top: 10px; flex-wrap: wrap; }
.chip {
  display: inline-flex; align-items: center; gap: 6px;
  min-height: 22px; padding: 0 8px;
  border: 1px solid var(--cn-border); border-radius: var(--cn-r-1);
  color: var(--cn-muted); font-size: 11px;
  background: var(--cn-surface);
}
.chip .k { opacity: 0.8; }
.chip .u-mono { font-size: 10.5px; color: var(--cn-fg-soft); }

.summary {
  position: relative; margin-top: 12px;
  padding: 11px 14px 11px 16px;
  border: 1px solid var(--cn-border); border-radius: var(--cn-r-2);
  background: var(--cn-surface-soft);
  font-size: 12.5px; line-height: 1.7; color: var(--cn-fg-soft);
  overflow: hidden;
}
.summary::before {
  content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
  background: linear-gradient(180deg, var(--cn-accent-line), var(--cn-accent));
}
.summary b { margin-right: 8px; color: var(--cn-fg); font-weight: 650; }

/* 步骤表卡：实色数据承载（装饰不进入表格区） */
.case-card {
  margin-top: 14px;
  background: var(--cn-surface);
  border: 1px solid var(--cn-border);
  border-radius: var(--cn-r-2);
  box-shadow: var(--cn-shadow-1);
  overflow: hidden;
  transition: opacity var(--cn-dur-2) var(--cn-ease-out);
}
.case-card.dim { opacity: 0.55; }
.case-card-head {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--cn-border);
  background: var(--cn-surface-soft);
}
.case-card-head strong { font-size: 13px; font-weight: 650; color: var(--cn-fg); }
.case-card-head .hint { margin-left: auto; color: var(--cn-subtle); font-size: 10.5px; }

/* 空态：居中提示 + 明确下一步 */
.case-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; min-height: 320px; padding: 32px 20px;
  text-align: center;
  border: 1px dashed var(--cn-border-strong);
  border-radius: var(--cn-r-4);
  background: rgba(255, 255, 255, 0.45);
  color: var(--cn-muted);
}
.v-theme--dark .case-empty { background: rgba(18, 36, 59, 0.4); }
.case-empty .empty-icon { color: var(--cn-accent); opacity: 0.85; }
.case-empty b { font-size: 14px; color: var(--cn-fg); }
.case-empty span { font-size: 12px; line-height: 1.7; }
</style>
