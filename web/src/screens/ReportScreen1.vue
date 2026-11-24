<script setup lang="ts">
import { ref, computed, useTemplateRef, onMounted } from 'vue'
import { store, loadProjects, showToast } from '../store.ts'
import { reportGenerate, downloadBase64, type ReportGenerateResponse } from '../api.ts'
import type { ProjectMeta } from '../types.ts'

/** 工具四（F14 报告统计与需求符合性）第一版：单屏选输入 → 生成表38 需求符合性对照。
 *  v1 范围（用户拍板"重点是需求符合性，先做一版"）：只生成表38，其余批注位置保留原文。 */
const outlineInput = useTemplateRef<HTMLInputElement>('outlineInput')
const recordInput = useTemplateRef<HTMLInputElement>('recordInput')
const regInput = useTemplateRef<HTMLInputElement>('regInput')

/** 配对的大纲：项目库或新上传 */
const alignProject = ref<ProjectMeta | null>(null)
const alignFileName = ref('')
/** 上传的大纲 File 暂存（不能进 reactive，File 代理会丢） */
let outlineFileRef: File | null = null
const alignReady = computed(() => alignProject.value !== null || alignFileName.value !== '')
const alignLabel = computed(() => alignProject.value?.name ?? alignFileName.value)
const outlineProjects = computed(() => store.projects.filter(p => (p.sourceType ?? 'outline') === 'outline'))

/** 首轮测试记录：项目库或新上传 */
const recordPick = ref<ProjectMeta | null>(null)
const recordFileName = ref('')
let recordFileRef: File | null = null
const recordReady = computed(() => recordPick.value !== null || recordFileName.value !== '')
const recordLabel = computed(() => recordPick.value?.name ?? recordFileName.value)
const recordProjects = computed(() => store.projects.filter(p => p.sourceType === 'record'))

/** 回归测试记录（可选）：仅现场上传，每次生成现传 */
const regFileName = ref('')
let regFileRef: File | null = null

/** 需求描述较长时的处理（2026-11-24 用户需求）：生成后在告警区点名哪些项被精简，可换模式重新生成 */
type DescModeOpt = 'smart' | 'clip' | 'full'
const DESC_OPTS: Array<{ v: DescModeOpt; label: string; note: string }> = [
  { v: 'smart', label: '智能精简', note: '只保留需求关键描述，处理流程等过程内容省略' },
  { v: 'clip', label: '400 字截断', note: '按段落边界截断并标记省略' },
  { v: 'full', label: '全文保留', note: '不删任何内容，表38 篇幅会明显变大' }
]
const savedDescMode = localStorage.getItem('cn-report-desc-mode')
const descMode = ref<DescModeOpt>(savedDescMode === 'clip' || savedDescMode === 'full' ? savedDescMode : 'smart')
function pickDescMode(v: DescModeOpt): void {
  descMode.value = v
  localStorage.setItem('cn-report-desc-mode', v)
}

const generating = ref(false)
const result = ref<ReportGenerateResponse | null>(null)
const resultBox = useTemplateRef<HTMLElement>('resultBox')

function pickAlign(p: ProjectMeta): void {
  alignProject.value = p
  alignFileName.value = ''
  outlineFileRef = null
}
function resetAlign(): void {
  alignProject.value = null
  alignFileName.value = ''
  outlineFileRef = null
}
function onOutlineFile(e: Event): void {
  const el = e.target as HTMLInputElement
  const f = el.files?.[0]
  el.value = ''
  if (f) {
    alignProject.value = null
    alignFileName.value = f.name
    outlineFileRef = f
  }
}
function pickRecord(p: ProjectMeta): void {
  recordPick.value = p
  recordFileName.value = ''
  recordFileRef = null
}
function resetRecord(): void {
  recordPick.value = null
  recordFileName.value = ''
  recordFileRef = null
}
function onRecordFile(e: Event): void {
  const el = e.target as HTMLInputElement
  const f = el.files?.[0]
  el.value = ''
  if (f) {
    recordPick.value = null
    recordFileName.value = f.name
    recordFileRef = f
  }
}
function onRegFile(e: Event): void {
  const el = e.target as HTMLInputElement
  const f = el.files?.[0]
  el.value = ''
  if (f) {
    regFileName.value = f.name
    regFileRef = f
  }
}
function clearReg(): void {
  regFileName.value = ''
  regFileRef = null
  if (regInput.value !== null) regInput.value.value = ''
}

async function generate(): Promise<void> {
  if (!alignReady.value) {
    showToast('请先选择或上传测试大纲')
    return
  }
  if (!recordReady.value) {
    showToast('请先选择或上传首轮测试记录')
    return
  }
  generating.value = true
  try {
    const r = await reportGenerate({
      outline: alignProject.value !== null ? { hash: alignProject.value.hash } : { file: outlineFileRef! },
      record: recordPick.value !== null ? { hash: recordPick.value.hash } : { file: recordFileRef! },
      regFile: regFileRef,
      descMode: descMode.value
    })
    if (!r.ok) {
      showToast(r.error ?? '生成失败')
      return
    }
    result.value = r
    await loadProjects()
    requestAnimationFrame(() => resultBox.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
  } catch {
    showToast('生成失败：网络中断或服务未响应')
  } finally {
    generating.value = false
  }
}

function download(f: { name: string; doc?: string }): void {
  if (f.doc) downloadBase64(f.doc, f.name)
  else showToast('产物超过 10MB，未附下载，请到生成目录取文件')
}

function stripDocx(name: string): string {
  return name.replace(/\.docx$/i, '')
}
function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hh + ':' + mm
}

onMounted(() => {
  void loadProjects()
})
</script>

<template>
  <div class="amb-wrap">
    <div class="wrap">
    <div class="hero">
      <h1 class="amb-title">报告统计与需求符合性</h1>
      <p>配对测试大纲，提供首轮与回归测试记录，生成软件测评报告的<b>需求符合性情况对照表</b>（表38），统计数目在下方直接展示。</p>
    </div>

    <!-- 配对大纲 -->
    <div class="block req">
      <div class="b-head">
        <v-icon size="16" color="primary">mdi-file-document-outline</v-icon>
        <span>配对测试大纲<b class="req">*</b></span>
        <span class="b-note">表38 的「功能性能指标来源/功能性能指标」逐字取自大纲的追踪关系与需求描述</span>
      </div>
      <div class="b-body">
        <div class="b-picked">
          <template v-if="alignLabel">
            <v-icon size="15" color="success">mdi-check-circle</v-icon>
            <span class="b-name">{{ stripDocx(alignLabel) }}</span>
            <v-btn size="x-small" variant="text" @click="resetAlign">重选</v-btn>
          </template>
          <template v-else><span class="b-empty">未选择</span></template>
        </div>
        <v-btn size="small" variant="tonal" color="primary" @click="outlineInput?.click()">
          <v-icon size="15" class="mr-1">mdi-upload</v-icon>上传新大纲
        </v-btn>
      </div>
      <div v-if="outlineProjects.length > 0" class="b-list">
        <button
          v-for="p in outlineProjects" :key="p.id" type="button"
          class="chip" :class="{ on: alignProject?.id === p.id }" :title="p.name"
          @click="pickAlign(p)"
        >
          <v-icon size="14">{{ alignProject?.id === p.id ? 'mdi-check-circle' : 'mdi-folder-text-outline' }}</v-icon>
          <span class="chip-name">{{ stripDocx(p.name) }}</span>
          <span class="chip-tag">大纲</span>
        </button>
      </div>
    </div>
    <input ref="outlineInput" id="rep-outline" type="file" accept=".docx" hidden @change="onOutlineFile" />

    <!-- 首轮测试记录 -->
    <div class="block req">
      <div class="b-head">
        <v-icon size="16" color="primary">mdi-file-table-outline</v-icon>
        <span>首轮测试记录<b class="req">*</b></span>
        <span class="b-note">判定首轮用例是否通过，只认步骤「通过与否」列</span>
      </div>
      <div class="b-body">
        <div class="b-picked">
          <template v-if="recordLabel">
            <v-icon size="15" color="success">mdi-check-circle</v-icon>
            <span class="b-name">{{ stripDocx(recordLabel) }}</span>
            <v-btn size="x-small" variant="text" @click="resetRecord">重选</v-btn>
          </template>
          <template v-else><span class="b-empty">未选择</span></template>
        </div>
        <v-btn size="small" variant="tonal" color="primary" @click="recordInput?.click()">
          <v-icon size="15" class="mr-1">mdi-upload</v-icon>上传新记录
        </v-btn>
      </div>
      <div v-if="recordProjects.length > 0" class="r-list">
        <div v-for="p in recordProjects" :key="p.id" class="r-row" :class="{ on: recordPick?.id === p.id }">
          <v-icon size="17" class="r-icon">mdi-folder-text-outline</v-icon>
          <div class="r-main">
            <div class="r-name">{{ stripDocx(p.name) }}</div>
            <div class="r-meta"><span>{{ fmtTime(p.updatedAt) }}</span><span v-if="p.stats"> · {{ p.stats.cases }} 例</span></div>
          </div>
          <v-btn size="small" :variant="recordPick?.id === p.id ? 'flat' : 'tonal'" color="primary" @click="pickRecord(p)">
            {{ recordPick?.id === p.id ? '已选择' : '选择' }}
          </v-btn>
        </div>
      </div>
    </div>
    <input ref="recordInput" id="rep-record" type="file" accept=".docx" hidden @change="onRecordFile" />

    <!-- 回归测试记录（可选） -->
    <div class="block">
      <div class="b-head">
        <v-icon size="16" color="primary">mdi-history</v-icon>
        <span>回归测试记录</span>
        <span class="b-note">可选。首轮有不通过时建议提供，表38 对应行将取回归轮次结果</span>
      </div>
      <div class="b-body">
        <div class="b-picked">
          <template v-if="regFileName">
            <v-icon size="15" color="success">mdi-check-circle</v-icon>
            <span class="b-name">{{ stripDocx(regFileName) }}</span>
            <v-btn size="x-small" variant="text" @click="clearReg">清除</v-btn>
          </template>
          <template v-else><span class="b-empty">未提供（首轮全部通过时不需要）</span></template>
        </div>
        <v-btn size="small" variant="tonal" color="primary" @click="regInput?.click()">
          <v-icon size="15" class="mr-1">mdi-upload</v-icon>上传回归记录
        </v-btn>
      </div>
    </div>
    <input ref="regInput" id="rep-reg" type="file" accept=".docx" hidden @change="onRegFile" />

    <!-- 需求描述较长时（2026-11-24）：超长描述的取舍方式，生成后告警区会点名被精简的项 -->
    <div class="block">
      <div class="b-head">
        <v-icon size="16" color="primary">mdi-text-short</v-icon>
        <span>需求描述较长时</span>
        <span class="b-note">大纲需求描述超 400 字时，表38「功能性能指标」列的取舍方式</span>
      </div>
      <div class="d-opts" role="radiogroup" aria-label="需求描述较长时的处理方式">
        <button
          v-for="o in DESC_OPTS" :key="o.v" type="button"
          class="d-opt" :class="{ on: descMode === o.v }" role="radio" :aria-checked="descMode === o.v"
          @click="pickDescMode(o.v)"
        >
          <span class="d-lbl">{{ o.label }}</span>
          <span class="d-note">{{ o.note }}</span>
        </button>
      </div>
    </div>

    <div class="cta">
      <v-btn color="primary" size="large" :loading="generating" @click="generate">
        生成报告<v-icon size="17" class="ml-2">mdi-clipboard-check-outline</v-icon>
      </v-btn>
    </div>

    <template v-if="result !== null && result.ok">
      <div ref="resultBox" class="result">
        <!-- 统计数目文字展示（用户拍板"统计不仅生成文档，结果页面还要有数目文字"） -->
        <div class="stat-panel">
          <div class="stat-row">
            <div class="stat"><b>{{ result.stats.items }}</b><span>需求项（表38 行）</span></div>
            <div class="stat ok"><b>{{ result.stats.firstPass }}</b><span>首轮测试通过</span></div>
            <div class="stat ok"><b>{{ result.stats.regPass }}</b><span>回归测试通过</span></div>
            <div class="stat" :class="{ bad: result.stats.firstFail + result.stats.regFail > 0 }"><b>{{ result.stats.firstFail + result.stats.regFail }}</b><span>未通过</span></div>
            <div class="stat" :class="{ bad: result.stats.untested > 0 }"><b>{{ result.stats.untested }}</b><span>未测试</span></div>
          </div>
          <div class="stat-sub">
            用例口径 = 步骤行：大纲 {{ result.stats.outlineCases }} 表 / {{ result.stats.outlineSteps }} 步 ·
            首轮记录 {{ result.stats.recordCases }} 表（执行 {{ result.stats.executedSteps }} 步，不通过 {{ result.stats.failedSteps }} 步） ·
            回归记录 {{ result.stats.regCases }} 表{{ result.stats.regCases === 0 ? '（未提供）' : '' }}
          </div>
          <div v-if="result.stats.failedSteps > 0" class="stat-sub">
            问题（首轮不通过步骤行）共 {{ result.stats.failedSteps }} 个：回归归零 {{ result.stats.regZero }} 个 / 待核验 {{ result.stats.regLeft }} 个
          </div>
        </div>

        <!-- 用户拍板（2026-11-22）：未通过行已按「经过测试符合要求」填写，界面提示尽量上传回归记录核验 -->
        <v-alert
          v-if="result.stats.regCases === 0 && result.stats.firstFail > 0"
          type="warning" variant="tonal" density="compact" class="row-alert"
        >
          <span class="iss-text">首轮有 <b>{{ result.stats.firstFail }}</b> 个需求项未通过——建议上传<b>回归测试记录</b>后重新生成，以核验归零情况（当前表38 对应行已按「经过测试符合要求」填写）。</span>
        </v-alert>

        <v-alert
          v-for="(iss, i) in result.issues" :key="i"
          :type="iss.level === 'error' ? 'error' : iss.level === 'warning' ? 'warning' : 'info'"
          variant="outlined" density="compact" class="row-alert"
        >
          <span class="iss-text">{{ iss.context ? '【' + iss.context + '】' : '' }}{{ iss.message }}</span>
        </v-alert>

        <div v-for="f in result.files" :key="f.name" class="file-card">
          <v-icon size="20" color="primary">mdi-file-word</v-icon>
          <div class="f-main">
            <div class="f-name">{{ f.name }}</div>
            <div class="f-meta">{{ f.sizeKB }} KB · 已写入 数据/生成/ 目录</div>
          </div>
          <v-btn size="small" color="primary" variant="tonal" @click="download(f)">
            <v-icon size="15" class="mr-1">mdi-download</v-icon>下载
          </v-btn>
        </div>
      </div>
    </template>

    <div class="foot">离线运行，文档内容不出本机。表38 与全文统计按既定口径自动填写，生成后请按告警逐条核对。</div>
    </div>
  </div>
</template>

<style scoped>
.wrap { position: relative; width: 100%; max-width: 1240px; margin: 0 auto; padding: 24px 24px 30px; }
.hero { text-align: left; margin-bottom: 14px; animation: rise var(--cn-dur-4) var(--cn-ease-out) both; }
.hero h1 { margin: 0; font-family: var(--cn-font-display); font-size: 24px; font-weight: 650; letter-spacing: -0.025em; color: var(--cn-fg); }
.hero p { margin: 7px 0 0; color: var(--cn-muted); font-size: 12px; line-height: 1.7; }
.hero p b { color: var(--cn-accent); }

.block {
  margin-top: 12px; padding: 12px 14px;
  border: 1px solid var(--cn-border); border-radius: var(--cn-r-2);
  background: var(--cn-surface);
}
/* 必选输入块：左侧 2px 满高集中色轨（直角集中色风语义色轨），可选/选项块不带 */
.block.req {
  border-color: var(--cn-accent-line);
  box-shadow: inset 2px 0 0 var(--cn-accent);
  padding-left: 16px;
}
.b-head { display: flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 600; color: var(--cn-fg); }
.b-head .req { color: var(--cn-danger); margin-left: 1px; }
.b-note { font-weight: 450; font-size: 11px; color: var(--cn-muted); }
.b-body { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; gap: 10px; }
.b-picked { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1; }
.b-name { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--cn-fg-soft); }
.b-empty { font-size: 11.5px; color: var(--cn-subtle); }

.b-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.chip {
  display: inline-flex; align-items: center; gap: 6px; max-width: 320px; padding: 4px 9px;
  border: 1px solid var(--cn-border); border-radius: var(--cn-r-1); background: var(--cn-surface);
  color: var(--cn-muted); font-size: 11.5px; cursor: pointer; text-align: left;
  transition: border-color var(--cn-dur-1) var(--cn-ease-out), color var(--cn-dur-1) var(--cn-ease-out);
}
.chip:hover { border-color: var(--cn-accent-line); }
.chip.on { border-color: var(--cn-accent); color: var(--cn-accent); }
.chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip-tag { flex: none; font-size: 10px; padding: 0 5px; border-radius: var(--cn-r-1); background: var(--cn-accent-soft); color: var(--cn-accent); }

/* 需求描述较长时：三选项分段选择（选中 = 集中色轨 + 浅底） */
.d-opts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 10px; }
@media (max-width: 860px) { .d-opts { grid-template-columns: 1fr; } }
.d-opt {
  text-align: left; cursor: pointer;
  padding: 10px 12px 10px 14px;
  border: 1px solid var(--cn-border); border-radius: var(--cn-r-2);
  background: var(--cn-surface-soft);
  transition: border-color var(--cn-dur-2) var(--cn-ease-out), background-color var(--cn-dur-2) var(--cn-ease-out), box-shadow var(--cn-dur-2) var(--cn-ease-out);
}
.d-opt:hover { border-color: var(--cn-accent-line); background: var(--cn-surface); }
.d-opt.on {
  border-color: var(--cn-accent); background: var(--cn-accent-soft);
  box-shadow: inset 2px 0 0 var(--cn-accent);
}
.d-lbl { display: block; font-size: 12.5px; font-weight: 650; color: var(--cn-fg); }
.d-opt.on .d-lbl { color: var(--cn-accent-strong); }
.d-note { display: block; margin-top: 3px; font-size: 11px; line-height: 1.6; color: var(--cn-muted); }
.d-opt:focus-visible { outline: 2px solid var(--cn-accent); outline-offset: 2px; }

.r-list { margin-top: 10px; border: 1px solid var(--cn-border); border-radius: var(--cn-r-3); background: var(--cn-surface); overflow: hidden; }
.r-row { display: flex; align-items: center; gap: 10px; padding: 8px 12px; transition: background var(--cn-dur-1) var(--cn-ease-out); }
.r-row + .r-row { border-top: 1px solid var(--cn-border); }
.r-row:hover { background: var(--cn-surface-soft); }
.r-row.on { background: var(--cn-accent-soft); }
.r-icon { color: var(--cn-accent); flex: none; }
.r-main { flex: 1; min-width: 0; }
.r-name { font-size: 12.5px; font-weight: 600; color: var(--cn-fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.r-meta { margin-top: 2px; font-size: 11px; color: var(--cn-subtle); font-variant-numeric: tabular-nums; }

.cta { display: flex; justify-content: flex-start; margin-top: 18px; }
.result { margin-top: 14px; display: flex; flex-direction: column; gap: 10px; }

/* 统计数目面板：数字为主体的文字展示 */
.stat-panel { border: 1px solid var(--cn-border); border-radius: var(--cn-r-3); background: var(--cn-surface); padding: 14px 16px; }
.stat-row { display: flex; flex-wrap: wrap; gap: 10px 26px; }
.stat b {
  display: block; font-family: var(--cn-font-mono); font-size: 26px; font-weight: 650; line-height: 1.15;
  color: var(--cn-fg); font-variant-numeric: tabular-nums;
}
.stat span { display: block; margin-top: 2px; font-size: 11px; color: var(--cn-muted); }
.stat.ok b { color: var(--cn-success, #2e7d32); }
.stat.bad b { color: var(--cn-danger); }
.stat-sub { margin-top: 10px; font-size: 11.5px; color: var(--cn-subtle); border-top: 1px solid var(--cn-border); padding-top: 9px; }

.row-alert { font-size: 12.5px; }
.iss-text { flex: 1; text-align: left; }

.file-card {
  display: flex; align-items: center; gap: 12px; padding: 12px 14px;
  border: 1px solid var(--cn-border); border-radius: var(--cn-r-3); background: var(--cn-surface);
}
.f-main { flex: 1; min-width: 0; }
.f-name { font-size: 13px; font-weight: 650; color: var(--cn-fg); }
.f-meta { margin-top: 2px; font-size: 11px; color: var(--cn-subtle); font-variant-numeric: tabular-nums; }

.foot { margin-top: 18px; text-align: center; color: var(--cn-subtle); font-family: var(--cn-font-mono); font-size: 10px; letter-spacing: 0.03em; }

@keyframes rise {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .hero { animation: none; }
}
</style>
