<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { store, doTraceGenerate, showToast } from '../store.ts'
import { downloadBase64 } from '../api.ts'
import { headRowsOf } from '../../../src/core/trace/table.ts'
import type { TraceRowVM } from '../types.ts'

// 第 2 步：追踪表预览（双层表头 + vmerge rowspan）+ 执行结果编辑 + 复制/下载（12 v2）

const spec = computed(() => store.traceSpec)
const rows = computed<TraceRowVM[]>(() => spec.value?.rows ?? [])
const editableCol = computed(() => spec.value?.editableCol)
const headTop = computed(() => (spec.value ? headRowsOf(spec.value.heads)[0] : []))
const headSub = computed(() => (spec.value ? headRowsOf(spec.value.heads)[1] : []))
const totalCols = computed(() => spec.value?.heads.reduce((a, g) => a + g.cols.length, 0) ?? 0)

/** 预览行上限（复制/下载不受此限）；截断处的合并块 rowspan 收缩到边界，不出"悬空合并" */
const PREVIEW_LIMIT = 200
const previewRows = computed<TraceRowVM[]>(() => {
  const all = rows.value
  if (all.length <= PREVIEW_LIMIT) return all
  return all.slice(0, PREVIEW_LIMIT).map(r => ({
    cells: r.cells,
    span: r.span.map(s => s)
  })).map((r, i) => {
    r.span = r.span.map(s => (s > 1 && i + s > PREVIEW_LIMIT ? PREVIEW_LIMIT - i : s))
    return r
  })
})

onMounted(() => {
  if (!store.traceParsed) {
    // 直接刷新进入第 2 步（无解析数据）→ 回第 1 步
    store.traceScreen = 1
  }
})

/** 报告追踪的执行结果列编辑（直接改 store.rows，生成随请求发送） */
function onEditResult(i: number, e: Event): void {
  const v = (e.target as HTMLInputElement).value
  if (store.traceSpec !== null) store.traceSpec.rows[i].cells[9] = v
}

/** 复制表格：text/html（含 colspan/rowspan，Word 直贴成合并单元格）+ text/plain TSV 兜底 */
async function copyTable(): Promise<void> {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const st = 'border:1px solid #7f7f7f;padding:4px 6px;vertical-align:middle'
  // 表头
  let html = '<table border="1" cellspacing="0" style="border-collapse:collapse;font-family:宋体;font-size:10.5pt"><thead>'
  html += '<tr>' + headTop.value.map(h => `<th colspan="${h.colspan}" rowspan="${h.rowspan}" style="${st};background:#f2f2f2;font-family:黑体">${esc(h.text)}</th>`).join('') + '</tr>'
  if (headSub.value.length > 0) {
    html += '<tr>' + headSub.value.map(h => `<th style="${st};background:#f2f2f2;font-family:黑体">${esc(h.text)}</th>`).join('') + '</tr>'
  }
  html += '</thead><tbody>'
  const tsvRows: string[] = []
  for (const r of rows.value) {
    html += '<tr>'
    const tsv: string[] = []
    for (let c = 0; c < totalCols.value; c++) {
      if (r.span[c] === 0) {
        tsv.push('')
        continue
      }
      const rs = r.span[c] > 1 ? ` rowspan="${r.span[c]}"` : ''
      const text = r.cells[c]
      html += `<td${rs} style="${st}">${esc(text)}</td>`
      tsv.push(text)
    }
    html += '</tr>'
    tsvRows.push(tsv.join('\t'))
  }
  html += '</tbody></table>'
  const tsv = [...headTop.value.map(h => h.text), ...(headSub.value.length ? [headSub.value.map(h => h.text).join('\t')] : []), ...tsvRows].join('\r\n')
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([tsv], { type: 'text/plain' })
      })
    ])
    showToast('已复制到剪贴板，可直接粘贴进 Word（保留合并单元格）')
  } catch {
    try {
      await navigator.clipboard.writeText(tsv)
      showToast('已复制为文本表格（制表符分隔），粘贴后可转为表格')
    } catch {
      showToast('复制失败：请改用下载文档后从 Word 里复制')
    }
  }
}

async function download(): Promise<void> {
  const ok = await doTraceGenerate()
  if (ok && store.traceResult?.doc) {
    downloadBase64(store.traceResult.doc, store.traceResult.name)
  }
}
</script>

<template>
  <div class="wrap">
    <div class="head">
      <h1>追踪表</h1>
      <p class="sub">
        来源：<b>{{ store.tracePrimary.name }}</b>
        <template v-if="store.traceAlignOutline"> · 配对大纲：<b>{{ store.traceAlignOutline.name }}</b></template>
        · 追踪表 <b class="n">{{ rows.length }}</b> 行
      </p>
      <p v-if="editableCol !== undefined" class="sub edit-hint">
        <v-icon size="13">mdi-pencil</v-icon> 执行结果列可直接编辑（默认"通过"，对不上的行已留空），改完再复制或下载
      </p>
    </div>

    <!-- 追踪表预览 -->
    <div class="pv-card">
      <div class="pv-head">
        <span>表格预览</span>
        <span v-if="rows.length > PREVIEW_LIMIT" class="pv-note">仅显示前 {{ PREVIEW_LIMIT }} 行，完整内容以下载文档与复制为准</span>
        <span v-else-if="rows.length === 0" class="pv-note warn">没有可生成的行</span>
      </div>
      <div class="pv-scroll">
        <table>
          <thead>
            <tr><th v-for="(h, i) in headTop" :key="'t' + i" :colspan="h.colspan" :rowspan="h.rowspan">{{ h.text }}</th></tr>
            <tr v-if="headSub.length > 0"><th v-for="(h, i) in headSub" :key="'s' + i">{{ h.text }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in previewRows" :key="i">
              <template v-for="c in totalCols" :key="c">
                <td v-if="r.span[c - 1] !== 0" :rowspan="r.span[c - 1] > 1 ? r.span[c - 1] : undefined" :class="{ num: c === 1, editable: c - 1 === editableCol }">
                  <input
                    v-if="c - 1 === editableCol"
                    class="res-input" :value="r.cells[c - 1]"
                    @input="onEditResult(i, $event)"
                  />
                  <template v-else>{{ r.cells[c - 1] }}</template>
                </td>
              </template>
            </tr>
          </tbody>
        </table>
        <div v-if="rows.length === 0" class="pv-empty">暂无可显示的追踪表行</div>
      </div>
    </div>

    <!-- 操作区 -->
    <div class="acts">
      <v-btn color="primary" rounded="pill" size="large" :disabled="rows.length === 0" @click="copyTable">
        <v-icon size="17" class="mr-2">mdi-content-copy</v-icon>复制表格
      </v-btn>
      <v-btn
        color="primary" variant="tonal" rounded="pill" size="large"
        :disabled="rows.length === 0" :loading="store.traceGenerating" @click="download"
      >
        <v-icon size="17" class="mr-2">mdi-download</v-icon>下载追踪文档
      </v-btn>
    </div>
    <p class="hint">复制表格后可直接粘贴进 Word（保留表格格式与合并单元格）；下载的 .docx 与对应文档中的追踪表样式一致。</p>

    <!-- 生成结果：下载双轨 -->
    <v-card v-if="store.traceResult" rounded="14" elevation="1" class="res">
      <div class="res-row">
        <v-icon size="19" color="success">mdi-check-circle</v-icon>
        <b>{{ store.traceResult.name }}</b>
        <span class="kb">{{ store.traceResult.sizeKB }} KB</span>
      </div>
      <div v-if="store.traceResult.path" class="res-path">
        <v-icon size="15" class="mr-1">mdi-folder-outline</v-icon>{{ store.traceResult.path }}
      </div>
    </v-card>

    <div class="foot">离线运行，文档内容不出本机。</div>
  </div>
</template>

<style scoped>
.wrap { max-width: 1100px; margin: 26px auto 0; padding: 0 22px 40px; }
.head h1 { font-size: 21px; font-weight: 650; }
.sub { margin-top: 6px; font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.65); }
.sub b { color: rgb(var(--v-theme-on-surface)); }
.sub .n { color: rgb(var(--v-theme-primary)); }
.edit-hint { display: flex; align-items: center; gap: 3px; color: rgb(var(--v-theme-primary)); }

.pv-card {
  margin-top: 18px; border-radius: 14px; overflow: hidden;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-outline), 0.5);
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.05);
}
.pv-head {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px; font-size: 13px; font-weight: 600;
  border-bottom: 1px solid rgba(var(--v-theme-outline), 0.5);
}
.pv-note { font-weight: 450; font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.55); }
.pv-note.warn { color: rgb(var(--v-theme-warning)); }
.pv-scroll { max-height: 520px; overflow: auto; }
.pv-empty { padding: 40px; text-align: center; font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5); }

table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
thead th {
  position: sticky; top: 0; z-index: 1;
  background: rgba(var(--v-theme-primary), 0.07);
  color: rgb(var(--v-theme-primary));
  font-weight: 600; text-align: center; white-space: nowrap;
  padding: 7px 9px;
  border-bottom: 1px solid rgba(var(--v-theme-outline), 0.7);
}
thead tr:first-child th { border-bottom: none; }
thead tr:last-child th { top: 32px; }
tbody td {
  padding: 5px 9px; white-space: nowrap; vertical-align: middle;
  border-bottom: 1px solid rgba(var(--v-theme-outline), 0.35);
  border-right: 1px solid rgba(var(--v-theme-outline), 0.22);
  color: rgba(var(--v-theme-on-surface), 0.85);
}
tbody tr:nth-child(even):not(:hover) { background: rgba(var(--v-theme-primary), 0.025); }
tbody tr:hover { background: rgba(var(--v-theme-primary), 0.05); }
td.num { font-variant-numeric: tabular-nums; color: rgba(var(--v-theme-on-surface), 0.55); }
td.editable { padding: 2px 5px; }
.res-input {
  width: 100%; min-width: 64px; border: 1px dashed rgba(var(--v-theme-primary), 0.55);
  border-radius: 6px; padding: 3px 6px; font-size: 12.5px;
  background: transparent; color: rgb(var(--v-theme-on-surface));
}
.res-input:focus { outline: none; border-color: rgb(var(--v-theme-primary)); background: rgba(var(--v-theme-primary), 0.05); }

.acts { display: flex; justify-content: center; gap: 14px; margin-top: 20px; }
.acts :deep(.v-btn:first-child) {
  background: linear-gradient(135deg, #3d6fb5 0%, #2D5B91 55%, #24507f 100%);
  box-shadow: 0 4px 14px rgba(45, 91, 145, 0.32);
}
.acts :deep(.v-btn:first-child:hover) { box-shadow: 0 6px 18px rgba(45, 91, 145, 0.4); }
.hint { text-align: center; font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.55); margin-top: 10px; }

.res { margin-top: 16px; padding: 12px 16px; }
.res-row { display: flex; align-items: center; gap: 8px; font-size: 13.5px; }
.res-row .kb { color: rgba(var(--v-theme-on-surface), 0.55); font-variant-numeric: tabular-nums; font-size: 12.5px; }
.res-path {
  margin-top: 7px; font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.6);
  display: flex; align-items: center; gap: 4px; word-break: break-all;
}
.foot { text-align: center; font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 22px; }
</style>
