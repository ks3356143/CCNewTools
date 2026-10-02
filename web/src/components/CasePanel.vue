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
      <template v-for="(p, i) in path" :key="i">
        <span v-if="i > 0" class="sep">/</span><span>{{ p }}</span>
      </template>
    </div>
    <div class="title-row">
      <h2>{{ row.mingcheng }}</h2>
      <div class="btns">
        <v-btn size="small" rounded="pill" :color="row.excluded ? 'warning' : 'secondary'" variant="tonal" @click="toggleExcluded">
          {{ row.excluded ? '已排除，点击恢复' : '不生成此用例' }}
        </v-btn>
        <v-btn size="small" rounded="pill" :color="row.reviewed ? 'success' : 'primary'" variant="tonal" @click="toggleReviewed">
          <v-icon size="14" class="mr-1">{{ row.reviewed ? 'mdi-check-circle' : 'mdi-check' }}</v-icon>
          {{ row.reviewed ? '已核对' : '标记已核对' }}
        </v-btn>
      </div>
    </div>
    <div class="chips">
      <span class="chip id1"><span class="k">标识</span><span class="mono">{{ row.caseId }}</span></span>
      <span class="chip id2"><span class="k">测试需求标识</span><span class="mono">{{ row.itemId }}</span></span>
      <span class="chip ch"><span class="k">章节</span><span class="mono">{{ row.chapter }}</span></span>
      <span v-if="row.expectSource === '通过准则'" class="chip ch">期望结果来源：通过准则</span>
    </div>
    <div class="summary"><b>用例综述：</b>{{ row.summary || '（空）' }}</div>

    <v-card rounded="14" elevation="1" class="table-card" :class="{ dim: row.excluded }">
      <div class="tbl-head">
        <span class="t">测试步骤</span>
        <span class="hint">单击单元格修改，自动保存</span>
      </div>
      <StepsTable :row="row" @changed="onChanged" />
    </v-card>
  </div>
</template>

<style scoped>
.case { min-width: 0; }
.crumb { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.6); display: flex; gap: 6px; flex-wrap: wrap; }
.sep { opacity: 0.45; }
.title-row { display: flex; align-items: center; gap: 12px; margin-top: 4px; flex-wrap: wrap; }
.title-row h2 { font-size: 21px; font-weight: 650; }
.btns { margin-left: auto; display: flex; gap: 8px; }
.chips { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
.chip { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 11px; border-radius: 999px; font-size: 12.5px; }
.chip .k { opacity: 0.66; }
.mono { font-family: Consolas, monospace; font-size: 11.5px; }
.chip.id1 { background: rgba(var(--v-theme-primary), 0.14); color: rgb(var(--v-theme-primary)); }
.chip.id2 { background: rgba(var(--v-theme-on-surface), 0.08); }
.chip.ch { border: 1px solid rgba(var(--v-theme-outline), 0.7); color: rgba(var(--v-theme-on-surface), 0.7); }
.summary { margin-top: 12px; padding: 12px 15px; border-radius: 12px; background: rgba(var(--v-theme-primary), 0.05); font-size: 13.5px; color: rgba(var(--v-theme-on-surface), 0.8); }
.table-card { margin-top: 14px; overflow: hidden; }
.table-card.dim { opacity: 0.55; }
.tbl-head { display: flex; align-items: center; padding: 12px 16px; border-bottom: 1px solid rgba(var(--v-theme-outline), 0.4); }
.tbl-head .t { font-size: 15px; font-weight: 600; }
.tbl-head .hint { margin-left: auto; font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.55); }
</style>
