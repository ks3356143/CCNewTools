<script setup lang="ts">
import { computed } from 'vue'
import type { CaseRow } from '../types.ts'
import { stepSuspectActive, store } from '../store.ts'

const props = defineProps<{ row: CaseRow }>()
const emit = defineEmits<{ changed: [] }>()

function isSuspect(idx: number): boolean {
  const s = props.row.steps[idx]
  if (props.row.dismissedSuspects.includes(s.no)) return false
  return stepSuspectActive(props.row, s)
}

function suspectReason(idx: number): string {
  const s = props.row.steps[idx]
  if (!s.expect.trim()) return '期望结果为空'
  return s.suspect ?? ''
}

function dismiss(idx: number): void {
  props.row.dismissedSuspects.push(props.row.steps[idx].no)
  emit('changed')
}

function onPaste(e: ClipboardEvent): void {
  e.preventDefault()
  const text = e.clipboardData?.getData('text') ?? ''
  document.execCommand('insertText', false, text)
}

function onBlur(e: FocusEvent, idx: number, field: 'action' | 'expect'): void {
  const el = e.target as HTMLElement
  props.row.steps[idx][field] = el.innerText.replace(/ /g, ' ')
  emit('changed')
}

const suspectCount = computed(() => props.row.steps.reduce((n, _s, i) => n + (isSuspect(i) ? 1 : 0), 0))

function addRow(idx: number): void {
  const no = props.row.steps[idx].no
  props.row.steps.splice(idx + 1, 0, { no: no + 1, action: '', expect: '', actual: '', result: '通过' })
  renumber()
  emit('changed')
}
function delRow(idx: number): void {
  if (props.row.steps.length <= 1) return
  props.row.steps.splice(idx, 1)
  renumber()
  emit('changed')
}
function moveRow(idx: number, dir: -1 | 1): void {
  const j = idx + dir
  if (j < 0 || j >= props.row.steps.length) return
  const arr = props.row.steps
  const tmp = arr[idx]
  arr[idx] = arr[j]
  arr[j] = tmp
  renumber()
  emit('changed')
}
function renumber(): void {
  props.row.steps.forEach((s, i) => (s.no = i + 1))
}
</script>

<template>
  <table class="steps">
    <colgroup><col class="c-no"><col class="c-act"><col><col class="c-ops"></colgroup>
    <thead>
      <tr><th class="c">序号</th><th>输入及操作</th><th>期望结果与评估标准</th><th class="c">操作</th></tr>
    </thead>
    <tbody>
      <tr v-for="(s, i) in row.steps" :key="i" :class="{ suspect: isSuspect(i), flash: store.suspectFlash === i }">
        <td class="c no">{{ i + 1 }}</td>
        <td>
          <div class="edit" contenteditable="true" @paste="onPaste" @blur="onBlur($event, i, 'action')">{{ s.action }}</div>
        </td>
        <td>
          <div class="edit" contenteditable="true" @paste="onPaste" @blur="onBlur($event, i, 'expect')">{{ s.expect }}</div>
          <div v-if="isSuspect(i)" class="sus-tag">
            <v-icon size="12">mdi-alert</v-icon>
            切分可疑 · {{ suspectReason(i) }}
            <button class="fix" @click="dismiss(i)">确认无误</button>
          </div>
        </td>
        <td class="c ops">
          <div class="ops-box">
            <button title="上移" :disabled="i === 0" @click="moveRow(i, -1)"><v-icon size="14">mdi-arrow-up</v-icon></button>
            <button title="下移" :disabled="i === row.steps.length - 1" @click="moveRow(i, 1)"><v-icon size="14">mdi-arrow-down</v-icon></button>
            <button title="在下方插入" @click="addRow(i)"><v-icon size="14">mdi-plus</v-icon></button>
            <button title="删除本行" :disabled="row.steps.length <= 1" @click="delRow(i)"><v-icon size="14">mdi-delete-outline</v-icon></button>
          </div>
        </td>
      </tr>
    </tbody>
  </table>
  <div v-if="suspectCount > 0" class="sus-note">有 {{ suspectCount }} 步切分可疑，请逐条确认或修改</div>
</template>

<style scoped>
.steps { width: 100%; border-collapse: collapse; table-layout: fixed; }
.steps th {
  text-align: left; font-size: 12.5px; font-weight: 550; white-space: nowrap;
  padding: 9px 12px; background: rgba(var(--v-theme-primary), 0.06);
  border-bottom: 1px solid rgba(var(--v-theme-outline), 0.5);
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.steps td { padding: 10px 12px; vertical-align: middle; border-bottom: 1px solid rgba(var(--v-theme-outline), 0.35); font-size: 13.5px; line-height: 1.65; }
.steps tr:last-child td { border-bottom: none; }
.c { text-align: center; }
.c-no { width: 44px; color: rgba(var(--v-theme-on-surface), 0.6); font-variant-numeric: tabular-nums; }
.c-act { width: 42%; }
.c-ops { width: 92px; }
td.editable, .edit { outline: none; cursor: text; min-height: 22px; }
.edit { padding: 2px 6px; border: 1px dashed rgba(var(--v-theme-outline), 0.45); border-radius: 6px; }
.edit:hover { border-color: rgba(var(--v-theme-primary), 0.5); background: rgba(var(--v-theme-primary), 0.06); }
.edit:focus { border: 1px solid rgb(var(--v-theme-primary)); box-shadow: 0 0 0 2px rgba(var(--v-theme-primary), 0.18); background: rgb(var(--v-theme-surface)); }
tr.suspect td { background: rgba(var(--v-theme-error), 0.08); }
tr.suspect td:first-child { box-shadow: inset 3px 0 0 rgb(var(--v-theme-error)); }
.sus-tag {
  display: inline-flex; align-items: center; gap: 4px; margin-top: 5px;
  font-size: 11.5px; color: rgb(var(--v-theme-error));
  background: rgba(var(--v-theme-error), 0.14); border-radius: 999px; padding: 2px 9px;
}
.fix { margin-left: 4px; text-decoration: underline; text-underline-offset: 3px; font-size: 11.5px; color: rgb(var(--v-theme-primary)); }
.ops { width: 104px; }
.ops .ops-box { display: inline-flex; gap: 2px; background: rgba(var(--v-theme-primary), 0.06); border-radius: 8px; padding: 3px; }
.ops button {
  width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center;
  border-radius: 6px; color: rgba(var(--v-theme-on-surface), 0.55); transition: all 0.12s;
}
.ops button:hover:not(:disabled) { color: rgb(var(--v-theme-primary)); background: rgba(var(--v-theme-primary), 0.14); }
.ops button:disabled { opacity: 0.3; cursor: default; }
.sus-note { font-size: 12px; color: rgb(var(--v-theme-error)); padding: 8px 14px; border-top: 1px dashed rgba(var(--v-theme-error), 0.4); }
tr.suspect.flash td { animation: sus-flash 1.6s ease-out; }
@keyframes sus-flash { 0% { box-shadow: inset 0 0 0 2px rgb(var(--v-theme-error)); } 100% { box-shadow: inset 0 0 0 2px transparent; } }
</style>
