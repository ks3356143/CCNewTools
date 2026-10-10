<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { store, traceRowsOf, doTraceGenerate, showToast } from '../store.ts'
import { downloadBase64 } from '../api.ts'

// 第 2 步：追踪表预览 + 复制表格（HTML 直贴 Word）+ 下载 docx（12-追踪文档工具）
const rows = computed(() => traceRowsOf(store.traceCases))
const excludedCount = computed(() => store.traceCases.filter(c => c.excluded).length)

/** 预览行上限（大文档 3 万行 DOM 不可行；复制与下载不受此限——数据驱动，不依赖 DOM） */
const PREVIEW_LIMIT = 200
const previewRows = computed(() => rows.value.slice(0, PREVIEW_LIMIT))

const HEADS = ['序号', '需求规格说明章节号', '需求规格说明描述', '大纲章节号', '测试项名称', '测试项标识', '测试用例名称', '测试用例标识']

function rowCells(r: (typeof rows.value)[number]): string[] {
  return [String(r.no), r.srsChapter, r.srsDesc, r.outlineChapter, r.itemName, r.itemItemId, r.caseName, r.caseId]
}

onMounted(() => {
  if (!store.traceParsed) {
    // 直接刷新进入第 2 步（无解析数据）→ 回第 1 步
    store.traceScreen = 1
  }
})

/** 复制表格：text/html（Word 直贴成真表格）+ text/plain（TSV 兜底） */
async function copyTable(): Promise<void> {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const cell = (s: string) => `<td style="border:1px solid #7f7f7f;padding:4px 6px">${esc(s)}</td>`
  const headCell = (s: string) => `<th style="border:1px solid #7f7f7f;padding:4px 6px;background:#f2f2f2">${esc(s)}</th>`
  const html =
    '<table border="1" cellspacing="0" style="border-collapse:collapse;font-family:宋体;font-size:10.5pt">' +
    '<tr>' + HEADS.map(headCell).join('') + '</tr>' +
    rows.value.map(r => '<tr>' + rowCells(r).map(cell).join('') + '</tr>').join('') +
    '</table>'
  const tsv = [HEADS.join('\t'), ...rows.value.map(r => rowCells(r).join('\t'))].join('\r\n')
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([tsv], { type: 'text/plain' })
      })
    ])
    showToast('已复制到剪贴板，可直接粘贴进 Word（保留表格格式）')
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
      <h1>追踪文档</h1>
      <p class="sub">
        来源：<b>{{ store.traceOutline.name }}</b>
        · {{ store.traceStats.items }} 测试项 / {{ store.traceStats.cases }} 用例
        · 追踪表 <b class="n">{{ rows.length }}</b> 行
        <span v-if="excludedCount > 0" class="ex">（{{ excludedCount }} 个已排除用例未入表）</span>
      </p>
    </div>

    <!-- 追踪表预览 -->
    <div class="pv-card">
      <div class="pv-head">
        <span>表格预览</span>
        <span v-if="rows.length > PREVIEW_LIMIT" class="pv-note">仅显示前 {{ PREVIEW_LIMIT }} 行，完整内容以下载文档为准</span>
        <span v-else-if="rows.length === 0" class="pv-note warn">没有可生成的行（全部用例被排除）</span>
      </div>
      <div class="pv-scroll">
        <table>
          <thead>
            <tr><th v-for="h in HEADS" :key="h">{{ h }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in previewRows" :key="r.no">
              <td v-for="(c, i) in rowCells(r)" :key="i" :class="{ num: i === 0 }">{{ c }}</td>
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
    <p class="hint">复制表格后可直接粘贴进 Word（保留表格格式）；下载的 .docx 与工具一生成的测试说明中追踪表样式一致。</p>

    <!-- 生成结果：下载双轨（≤10MB base64 / 大文档给落盘路径） -->
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
.wrap { max-width: 980px; margin: 26px auto 0; padding: 0 22px 40px; }
.head h1 { font-size: 21px; font-weight: 650; }
.sub { margin-top: 6px; font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.65); }
.sub b { color: rgb(var(--v-theme-on-surface)); }
.sub .n { color: rgb(var(--v-theme-primary)); }
.ex { color: rgb(var(--v-theme-warning)); }

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
.pv-scroll { max-height: 480px; overflow: auto; }
.pv-empty { padding: 40px; text-align: center; font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5); }

table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
thead th {
  position: sticky; top: 0; z-index: 1;
  background: rgba(var(--v-theme-primary), 0.07);
  color: rgb(var(--v-theme-primary));
  font-weight: 600; text-align: left; white-space: nowrap;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(var(--v-theme-outline), 0.7);
}
tbody td {
  padding: 6px 10px; white-space: nowrap;
  border-bottom: 1px solid rgba(var(--v-theme-outline), 0.35);
  color: rgba(var(--v-theme-on-surface), 0.85);
}
tbody tr:nth-child(even):not(:hover) { background: rgba(var(--v-theme-primary), 0.025); }
tbody tr:hover { background: rgba(var(--v-theme-primary), 0.05); }
td.num { font-variant-numeric: tabular-nums; color: rgba(var(--v-theme-on-surface), 0.55); }

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
