<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { store, doTraceGenerate, saveTraceCols, showToast } from '../store.ts'
import { downloadBase64 } from '../api.ts'
import { headRowsOf, applyTraceCols } from '../../../src/core/trace/table.ts'
import type { TraceTable } from '../../../src/core/trace/table.ts'
import type { TraceRowVM } from '../types.ts'

// 第 2 步：追踪表预览（双层表头 + vmerge rowspan）+ 列显隐/顺序配置 + 执行结果编辑 + 复制/下载（12 v2，2026-11-28 列配置）

const fullSpec = computed(() => store.traceSpec)
/** 投影后的追踪表（列显隐/顺序按 store.traceCols；null = 全量原序）。执行结果编辑写回 fullSpec */
const viewSpec = computed<TraceTable | null>(() => {
  const t = fullSpec.value
  if (t === null) return null
  return store.traceCols !== null ? applyTraceCols(t, store.traceCols) : t
})
const spec = computed(() => viewSpec.value)
/** 编辑列的偏移 = 投影列序 - 全量列序（执行结果列在两形态中的位置差） */
const editShift = computed(() => {
  const full = fullSpec.value
  const view = viewSpec.value
  if (full === null || view === null || full.editableCol === undefined) return 0
  return (view.editableCol ?? 0) - full.editableCol
})
const rows = computed<TraceRowVM[]>(() => spec.value?.rows ?? [])
const editableCol = computed(() => spec.value?.editableCol)
const headTop = computed(() => (spec.value ? headRowsOf(spec.value.heads)[0] : []))
const headSub = computed(() => (spec.value ? headRowsOf(spec.value.heads)[1] : []))
const totalCols = computed(() => spec.value?.heads.reduce((a, g) => a + g.cols.length, 0) ?? 0)

// —— 列设置抽屉 ——
const colDrawer = ref(false)
/** 全量叶子列（配置清单的候选；label = 组名·子列名） */
const allCols = computed(() => {
  const t = fullSpec.value
  if (t === null) return []
  const vars = t.vars ?? t.heads.flatMap(g => g.cols)
  const labels: string[] = []
  for (const g of t.heads) {
    for (const c of g.cols) labels.push(g.group !== '' ? g.group + '·' + c : c)
  }
  return vars.map((v, i) => ({ v, label: labels[i] ?? v }))
})
/** 抽屉工作副本（打开时从 store 拷贝；确定时写回） */
const draftCols = ref<string[]>([])
function openDrawer(): void {
  const t = fullSpec.value
  const vars = t ? (t.vars ?? t.heads.flatMap(g => g.cols)) : []
  draftCols.value = store.traceCols ? [...store.traceCols] : [...vars]
  colDrawer.value = true
}
function moveCol(i: number, dir: -1 | 1): void {
  const j = i + dir
  if (j < 0 || j >= draftCols.value.length) return
  const a = draftCols.value
  ;[a[i], a[j]] = [a[j], a[i]]
}
function toggleCol(v: string): void {
  const a = draftCols.value
  const at = a.indexOf(v)
  if (at >= 0) a.splice(at, 1)
  else a.push(v)
}
function resetCols(): void {
  saveTraceCols(null)
  colDrawer.value = false
  showToast('已恢复默认列')
}
function applyCols(): void {
  if (draftCols.value.length === 0) {
    showToast('至少保留一列')
    return
  }
  saveTraceCols([...draftCols.value])
  colDrawer.value = false
  showToast('列配置已应用（复制/下载同步生效）')
}
/** 抽屉条目显示序：按 draftCols（已含顺序） */
const draftEntries = computed(() => {
  const all = allCols.value
  return draftCols.value.map(v => all.find(e => e.v === v) ?? { v, label: v })
})

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

/** 报告追踪的执行结果列编辑：预览行是投影形态，写回全量 rows（行号一致、列号按偏移换算），生成随请求发送 */
function onEditResult(i: number, e: Event): void {
  const v = (e.target as HTMLInputElement).value
  const col = editableCol.value
  const full = store.traceSpec
  if (col !== undefined && full !== null) {
    const fullCol = col - editShift.value
    if (fullCol >= 0 && fullCol < full.rows[i].cells.length) full.rows[i].cells[fullCol] = v
  }
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

/** 追踪表预览卡 hover 只作用边框（与工具一第二屏同轮移除跟随柔光，用户"挡视野"） */

/** 双层 sticky 表头第二行 top 动态测量（审计项：32px 硬编码在行高变化/缩放下会错位） */
const theadSubTop = ref(32)
let theadRO: ResizeObserver | undefined
function measureThead(): void {
  const tr = document.querySelector('.pv-scroll thead tr')
  if (tr) theadSubTop.value = Math.round(tr.getBoundingClientRect().height)
}
onMounted(() => {
  measureThead()
  theadRO = new ResizeObserver(measureThead)
  const thead = document.querySelector('.pv-scroll thead')
  if (thead) theadRO.observe(thead)
})
onUnmounted(() => theadRO?.disconnect())

async function download(): Promise<void> {
  const ok = await doTraceGenerate()
  if (ok && store.traceResult?.doc) {
    downloadBase64(store.traceResult.doc, store.traceResult.name)
  }
}
</script>

<template>
  <div class="amb-wrap">
    <div class="amb" aria-hidden="true">
      <div class="amb-b1" /><div class="amb-b2" /><div class="amb-b3" /><div class="amb-dots" />
    </div>
    <div class="wrap">
    <div class="head">
      <h1 class="amb-title">追踪表</h1>
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
    <div class="pv-card glass" :aria-busy="store.traceGenerating">
      <div class="pv-head">
        <span>表格预览</span>
        <span v-if="rows.length > PREVIEW_LIMIT" class="pv-note">仅显示前 {{ PREVIEW_LIMIT }} 行，完整内容以下载文档与复制为准</span>
        <span v-else-if="rows.length === 0" class="pv-note warn">没有可生成的行</span>
        <v-btn size="x-small" variant="tonal" rounded="pill" prepend-icon="mdi-view-column" @click="openDrawer">列设置</v-btn>
      </div>
      <div class="pv-scroll">
        <table>
          <thead>
            <tr><th v-for="(h, i) in headTop" :key="'t' + i" :colspan="h.colspan" :rowspan="h.rowspan">{{ h.text }}</th></tr>
            <tr v-if="headSub.length > 0"><th v-for="(h, i) in headSub" :key="'s' + i" :style="{ top: theadSubTop + 'px' }">{{ h.text }}</th></tr>
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
        <div v-if="rows.length === 0" class="pv-empty u-empty">暂无可显示的追踪表行</div>
      </div>
    </div>

    <!-- 列设置抽屉：勾选显隐 + 上下移排序（2026-11-28 同事需求） -->
    <v-navigation-drawer v-model="colDrawer" location="right" temporary width="340" class="col-drawer">
      <div class="cd-head">
        <span>列设置</span>
        <v-btn icon="mdi-close" size="small" variant="text" @click="colDrawer = false" />
      </div>
      <div class="cd-tip">勾选要显示的列，箭头调整顺序；对复制与下载文档同样生效。</div>
      <div class="cd-list">
        <div v-for="(e, i) in draftEntries" :key="e.v" class="cd-row">
          <v-checkbox
            density="compact" hide-details
            :model-value="draftCols.includes(e.v)"
            @update:model-value="toggleCol(e.v)"
          />
          <span class="cd-label" :title="e.label">{{ e.label }}</span>
          <span class="cd-ops">
            <v-btn icon="mdi-arrow-up" size="x-small" variant="text" :disabled="i === 0" @click="moveCol(i, -1)" />
            <v-btn icon="mdi-arrow-down" size="x-small" variant="text" :disabled="i === draftEntries.length - 1" @click="moveCol(i, 1)" />
          </span>
        </div>
      </div>
      <div class="cd-acts">
        <v-btn variant="text" @click="resetCols">恢复默认</v-btn>
        <v-btn color="primary" rounded="pill" @click="applyCols">应用</v-btn>
      </div>
    </v-navigation-drawer>

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
  </div>
</template>

<style scoped>
.wrap { position: relative; width: 100%; max-width: 1280px; margin: 0 auto; padding: 24px 24px 30px; }

/* ---- 页头 ---- */
.head { margin-bottom: 14px; animation: rise var(--cn-dur-4) var(--cn-ease-out) both; }
.head h1 {
  margin: 0; font-family: var(--cn-font-display);
  font-size: 24px; font-weight: 650; letter-spacing: -0.025em; color: var(--cn-fg);
}
.sub { margin: 7px 0 0; color: var(--cn-muted); font-size: 12px; line-height: 1.7; }
.sub b { color: var(--cn-fg-soft); font-weight: 600; }
.sub .n { color: var(--cn-accent); font-family: var(--cn-font-mono); }
.edit-hint { display: flex; align-items: center; gap: 4px; color: var(--cn-subtle); font-size: 11.5px; }

/* ---- 预览表卡（数据区实色承载） ---- */
.pv-card {
  margin-top: 4px;
  background: var(--cn-surface);
  border: 1px solid var(--cn-border);
  border-radius: var(--cn-r-3);
  box-shadow: var(--cn-shadow-1);
  overflow: hidden;
  animation: rise var(--cn-dur-4) var(--cn-ease-out) both;
  animation-delay: 60ms;
}
.pv-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 11px 15px;
  border-bottom: 1px solid var(--cn-border);
  background: var(--cn-surface-soft);
  font-size: 12.5px; font-weight: 650; color: var(--cn-fg);
}
.pv-note { font-size: 10.5px; color: var(--cn-subtle); font-weight: 400; }
.pv-note.warn { color: var(--cn-warning); }

.pv-scroll { max-height: 60vh; overflow: auto; background: var(--cn-surface); }
.pv-scroll table {
  width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed;
  font-size: 12px; min-width: 920px;
}
.pv-scroll th,
.pv-scroll td {
  padding: 8px 9px;
  border-right: 1px solid var(--cn-border);
  border-bottom: 1px solid var(--cn-border);
  text-align: left; vertical-align: top;
  line-height: 1.55;
}
.pv-scroll th:last-child, .pv-scroll td:last-child { border-right: 0; }
.pv-scroll thead th {
  position: sticky; top: 0; z-index: 2;
  height: 38px;
  background: #f4f9fe; color: #4c617b;
  font-weight: 650; font-size: 11.5px;
  white-space: nowrap;
  border-color: #c9d9ea;
}
.v-theme--dark .pv-scroll thead th { background: #172a43; color: #b7c9dc; border-color: var(--cn-border); }
/* 第二行表头：产品蓝锚定（v5 评审 009），替代原来的浅灰第二行 */
.pv-scroll thead tr:nth-child(2) th { z-index: 1; height: 34px; background: #173b62; color: #fff; }
.v-theme--dark .pv-scroll thead tr:nth-child(2) th { background: #0d1826; color: #e8f2fd; border-bottom: 2px solid var(--cn-accent); }
.pv-scroll tbody tr:hover td { background: #f4f9fd; }
.v-theme--dark .pv-scroll tbody tr:hover td { background: #12273c; }
.pv-scroll td { color: var(--cn-fg-soft); }
.pv-scroll td.num { font-family: var(--cn-font-mono); color: var(--cn-subtle); }
.pv-empty { margin: 16px; padding: 28px 20px; font-size: 12px; }
.res-input {
  width: 100%; padding: 4px 6px;
  border: 1px solid transparent; border-radius: var(--cn-r-1);
  background: transparent; color: var(--cn-fg-soft); font: inherit;
  transition: border-color var(--cn-dur-1) var(--cn-ease-out), background var(--cn-dur-1) var(--cn-ease-out);
}
.res-input:hover { border-color: var(--cn-border-strong); background: var(--cn-surface-soft); }
.res-input:focus { outline: none; border-color: var(--cn-accent); background: var(--cn-surface); box-shadow: 0 0 0 3px rgba(47, 128, 232, 0.16); }

/* ---- 操作区 ---- */
.acts {
  display: flex; align-items: center; gap: 10px;
  margin-top: 14px;
  animation: rise var(--cn-dur-4) var(--cn-ease-out) both;
  animation-delay: 120ms;
}
.hint { margin: 10px 0 0; color: var(--cn-subtle); font-size: 11px; line-height: 1.7; }

/* ---- 生成结果 ---- */
.res {
  margin-top: 16px;
  background: var(--cn-surface);
  border: 1px solid var(--cn-border);
  border-radius: var(--cn-r-2);
  box-shadow: var(--cn-shadow-1);
}
.res-row { display: flex; align-items: center; gap: 8px; padding: 12px 14px; font-size: 12.5px; color: var(--cn-fg-soft); }
.res-row b { font-weight: 650; color: var(--cn-fg); }
.res-row .kb { color: var(--cn-subtle); font-family: var(--cn-font-mono); font-size: 10.5px; }
.res-path {
  display: flex; align-items: center; padding: 0 14px 12px;
  color: var(--cn-subtle); font-family: var(--cn-font-mono); font-size: 10px;
  word-break: break-all;
}

.foot { margin-top: 18px; text-align: center; color: var(--cn-subtle); font-family: var(--cn-font-mono); font-size: 10px; letter-spacing: 0.03em; }

@keyframes rise {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .head, .pv-card, .acts { animation: none; }
  .res-input { transition: none; }
}

/* ---- 列设置抽屉 ---- */
.col-drawer { padding: 0; }
.cd-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px 8px; font-size: 14px; font-weight: 650; color: var(--cn-fg);
}
.cd-tip { padding: 0 16px 10px; font-size: 11px; color: var(--cn-subtle); line-height: 1.7; }
.cd-list { padding: 0 8px; max-height: calc(100vh - 190px); overflow-y: auto; }
.cd-row { display: flex; align-items: center; gap: 2px; }
.cd-row :deep(.v-checkbox) { flex: 0 0 auto; }
.cd-label { flex: 1 1 auto; font-size: 12px; color: var(--cn-fg-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cd-ops { flex: 0 0 auto; display: flex; }
.cd-acts {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 12px 16px; border-top: 1px solid var(--cn-border);
}
</style>
