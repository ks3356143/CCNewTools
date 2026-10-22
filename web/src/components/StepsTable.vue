<script setup lang="ts">
import { computed } from 'vue'
import type { CaseRow } from '../types.ts'
import { stepSuspectActive } from '../suspect.ts'
import { store } from '../store.ts'

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
  props.row.steps[idx][field] = el.innerText.replace(/ /g, ' ')
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
        <td class="c no u-mono">{{ i + 1 }}</td>
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
            <v-btn icon size="x-small" variant="text" title="上移" :disabled="i === 0" @click="moveRow(i, -1)"><v-icon size="14">mdi-arrow-up</v-icon></v-btn>
            <v-btn icon size="x-small" variant="text" title="下移" :disabled="i === row.steps.length - 1" @click="moveRow(i, 1)"><v-icon size="14">mdi-arrow-down</v-icon></v-btn>
            <v-btn icon size="x-small" variant="text" title="在下方插入" @click="addRow(i)"><v-icon size="14">mdi-plus</v-icon></v-btn>
            <v-btn icon size="x-small" variant="text" title="删除本行" :disabled="row.steps.length <= 1" @click="delRow(i)"><v-icon size="14">mdi-delete-outline</v-icon></v-btn>
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
  text-align: left; font-size: 11.5px; font-weight: 600; white-space: nowrap;
  padding: 8px 10px;
  background: var(--cn-surface-soft);
  border-bottom: 1px solid var(--cn-border);
  border-right: 1px solid var(--cn-border);
  color: var(--cn-muted);
}
.steps th:last-child { border-right: 0; }
.steps td {
  padding: 9px 10px; vertical-align: middle;
  border-bottom: 1px solid var(--cn-border);
  border-right: 1px solid var(--cn-border);
  font-size: 12.5px; line-height: 1.65; color: var(--cn-fg-soft);
}
.steps td:last-child { border-right: 0; }
.steps tbody tr:hover:not(.suspect) td { background: var(--cn-accent-soft); }
.steps tr:last-child td { border-bottom: none; }
.c { text-align: center; }
.c-no { width: 40px; }
td.no { color: var(--cn-accent); font-weight: 650; font-size: 12px; }
.c-act { width: 40%; }
/* 操作列：按钮 36px（桌面可点性），4×36 + gap2×3 + box padding 2×2 = 156，列宽 172 盖住 */
.c-ops { width: 172px; }
td.editable, .edit { outline: none; cursor: text; min-height: 22px; }
.edit {
  padding: 2px 6px;
  border: 1px dashed transparent;
  border-radius: var(--cn-r-1);
  transition: border-color var(--cn-dur-1) var(--cn-ease-out), background var(--cn-dur-1) var(--cn-ease-out);
}
.edit:hover { border-color: var(--cn-border-strong); background: var(--cn-surface-soft); }
.edit:focus { border: 1px solid var(--cn-accent); box-shadow: 0 0 0 2px rgba(18, 103, 180, 0.14); background: var(--cn-surface); }
.v-theme--dark .edit:focus { box-shadow: 0 0 0 2px rgba(103, 183, 255, 0.18); }
tr.suspect td { background: var(--cn-danger-soft); }
tr.suspect td:first-child { box-shadow: inset 3px 0 0 var(--cn-danger); }
.sus-tag {
  display: inline-flex; align-items: center; gap: 4px; margin-top: 5px;
  font-size: 10.5px; color: var(--cn-danger);
  background: rgba(168, 59, 52, 0.1); border-radius: 999px; padding: 2px 9px;
}
.v-theme--dark .sus-tag { background: rgba(255, 147, 139, 0.12); }
.fix { margin-left: 4px; text-decoration: underline; text-underline-offset: 3px; font-size: 10.5px; color: var(--cn-accent); }
.ops { width: 172px; padding-left: 4px; padding-right: 10px; }
.ops .ops-box {
  display: inline-flex; gap: 2px;
  background: var(--cn-surface-soft);
  border-radius: var(--cn-r-2); padding: 2px;
}
.ops .ops-box .v-btn { --v-btn-size: 26px; height: 36px; width: 36px; color: var(--cn-muted); }
.sus-note {
  font-size: 11px; color: var(--cn-danger);
  padding: 8px 12px; border-top: 1px dashed rgba(168, 59, 52, 0.35);
}
tr.suspect.flash td { animation: sus-flash 1.6s ease-out; }
@keyframes sus-flash {
  0% { box-shadow: inset 0 0 0 2px var(--cn-danger); }
  100% { box-shadow: inset 0 0 0 2px transparent; }
}
</style>
