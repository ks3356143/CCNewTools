<script setup lang="ts">
import { ref, computed, useTemplateRef, onMounted, watch } from 'vue'
import { store, TRACE_TABS, traceNeedsOutline, setTraceType, doTraceParse, loadProjects, openTraceProject, showToast } from '../store.ts'
import { deleteProject } from '../api.ts'
import type { ProjectMeta, TraceType } from '../types.ts'

// 四 tab 追踪（12-追踪文档工具 v2）：主文档上传 + report/returnSpec 的大纲配对 + 按类型过滤的最近项目
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
const outlineInput = useTemplateRef<HTMLInputElement>('outlineInput')
const dragging = ref(false)
const phase = ref<'idle' | 'parsing' | 'done'>('idle')
const fileName = ref('')
const progress = ref(0)
const bigFile = ref(false)
/** report/returnSpec 配对的大纲：项目库 hash 或新上传文件 */
const alignProject = ref<ProjectMeta | null>(null)
const alignFileName = ref('')

const tab = computed(() => TRACE_TABS.find(t => t.key === store.traceType)!)
const needAlign = computed(() => traceNeedsOutline(store.traceType))
const alignReady = computed(() => alignProject.value !== null || alignFileName.value !== '')
const alignLabel = computed(() => alignProject.value?.name ?? alignFileName.value)

/** 最近项目按 tab 源类型过滤（outline 大纲项目两个大纲 tab 共用） */
const wantType = computed<'outline' | 'record' | 'returnSpec'>(() =>
  store.traceType === 'report' ? 'record' : store.traceType === 'returnSpec' ? 'returnSpec' : 'outline'
)
const visibleProjects = computed(() => store.projects.filter(p => (p.sourceType ?? 'outline') === wantType.value))
/** 大纲配对候选 = 全部大纲项目 */
const outlineProjects = computed(() => store.projects.filter(p => { const st = p.sourceType ?? 'outline'; return st === 'outline' || st === 'spec' }))

function pick(): void {
  if (phase.value === 'idle') fileInput.value?.click()
}
function onFile(e: Event): void {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) void startParse(f)
}
function onDrop(e: DragEvent): void {
  dragging.value = false
  if (phase.value !== 'idle') return
  const f = e.dataTransfer?.files?.[0]
  if (f) void startParse(f)
}
function pickOutline(): void {
  outlineInput.value?.click()
}
function onOutlineFile(e: Event): void {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) {
    alignProject.value = null
    alignFileName.value = f.name
    outlineFileRef = f
  }
}
function chooseAlign(p: ProjectMeta): void {
  alignFileName.value = ''
  alignProject.value = p
}

async function startParse(f: File): Promise<void> {
  if (needAlign.value && !alignReady.value) {
    showToast('请先选择或上传配对的大纲')
    return
  }
  fileName.value = f.name
  bigFile.value = f.size > 20 * 1024 * 1024
  progress.value = 0
  phase.value = 'parsing'
  requestAnimationFrame(() => (progress.value = 70))
  const outline = alignProject.value ? { hash: alignProject.value.hash } : alignFileName.value !== '' && outlineFileRef.value ? { file: outlineFileRef.value } : undefined
  await doTraceParse(f, outline)
  progress.value = 100
  phase.value = store.traceParsed ? 'done' : 'idle'
}
/** 上传的大纲 File 暂存（startParse 用；不能放进 reactive，File 对象代理会丢） */
let outlineFileRef: File | null = null

onMounted(() => {
  if (store.traceParsed) {
    phase.value = 'done'
    fileName.value = store.tracePrimary.name
  }
  void loadProjects()
})

// 切 tab 丢弃解析结果时，本屏的展示状态同步复位（store 已被 setTraceType 重置，
// phase 若留在 done 态会显示上一轮文件与"生成"入口，误导用户）
watch(() => store.traceType, () => {
  phase.value = 'idle'
  fileName.value = ''
  progress.value = 0
})

const clearArmed = ref(false)
const delArmed = ref<string | null>(null)
let confirmTimer: ReturnType<typeof setTimeout> | undefined
function armConfirm(): void {
  clearTimeout(confirmTimer)
  confirmTimer = setTimeout(() => {
    clearArmed.value = false
    delArmed.value = null
  }, 3000)
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
async function openOne(p: ProjectMeta): Promise<void> {
  if (phase.value === 'parsing') return
  fileName.value = p.name
  progress.value = 0
  phase.value = 'parsing'
  requestAnimationFrame(() => (progress.value = 70))
  try {
    await openTraceProject(p.id)
  } finally {
    progress.value = 100
    phase.value = 'idle' // 成功时已切第 2 步，此处仅复位本屏
  }
}
async function removeOne(p: ProjectMeta): Promise<void> {
  if (delArmed.value !== p.id) {
    delArmed.value = p.id
    armConfirm()
    return
  }
  clearTimeout(confirmTimer)
  delArmed.value = null
  const ok = await deleteProject(p.id).catch(() => false)
  if (!ok) {
    showToast('删除失败')
    return
  }
  if (alignProject.value?.id === p.id) alignProject.value = null
  showToast('已删除项目')
  await loadProjects()
}
async function clearAll(): Promise<void> {
  if (!clearArmed.value) {
    clearArmed.value = true
    armConfirm()
    return
  }
  clearTimeout(confirmTimer)
  clearArmed.value = false
  for (const p of [...visibleProjects.value]) {
    await deleteProject(p.id).catch(() => false)
  }
  await loadProjects()
  showToast('已清空本类项目')
}

function issueCounts(): string {
  const c = { error: 0, warning: 0, info: 0 }
  for (const i of store.traceIssues) c[i.level]++
  const parts: string[] = []
  if (c.error) parts.push(c.error + ' 错误')
  if (c.warning) parts.push(c.warning + ' 告警')
  if (c.info) parts.push(c.info + ' 提示')
  return parts.length ? ' · ' + parts.join(' · ') : ''
}
</script>

<template>
  <div class="wrap">
    <div class="hero">
      <div class="badge"><v-icon size="34">mdi-link-variant</v-icon></div>
      <h1>生成追踪表</h1>
      <p>选择追踪类型，导入对应文档，自动生成追踪表，复制贴入你的文档。</p>
    </div>

    <!-- 四 tab -->
    <div class="tabs" role="tablist">
      <button
        v-for="t in TRACE_TABS" :key="t.key"
        type="button" role="tab"
        class="tab" :class="{ on: store.traceType === t.key }"
        :aria-selected="store.traceType === t.key"
        @click="setTraceType(t.key as TraceType)"
      >
        {{ t.label }}
      </button>
    </div>
    <!-- tab 内容整体过渡（切换类型时淡入淡出，与工具一屏切换同风格） -->
    <Transition name="tabbody" mode="out-in">
      <div :key="store.traceType" class="tab-body">
        <p class="tab-hint">{{ tab.hint }}</p>

    <!-- 大纲配对（报告/回归说明 tab） -->
    <div v-if="needAlign" class="align">
      <div class="a-head">
        <v-icon size="16" color="primary">mdi-file-document-outline</v-icon>
        <span>配对大纲<b class="req">*</b></span>
        <span class="a-note">从项目库选大纲或说明（或上传新文档自动识别）；说明作源时 SRS 两列留空人工补</span>
      </div>
      <div class="a-body">
        <div class="a-picked">
          <template v-if="alignLabel">
            <v-icon size="15" color="success">mdi-check-circle</v-icon>
            <span class="a-name">{{ stripDocx(alignLabel) }}</span>
            <v-btn size="x-small" variant="text" @click="alignProject = null; alignFileName = ''">重选</v-btn>
          </template>
          <template v-else>
            <span class="a-empty">未选择</span>
          </template>
        </div>
        <v-btn size="small" variant="tonal" color="primary" @click="pickOutline">
          <v-icon size="15" class="mr-1">mdi-upload</v-icon>上传新大纲
        </v-btn>
      </div>
      <div v-if="outlineProjects.length > 0" class="a-list">
        <button
          v-for="p in outlineProjects.slice(0, 4)" :key="p.id"
          type="button" class="a-item" :class="{ on: alignProject?.id === p.id }"
          @click="chooseAlign(p)"
        >
          <v-icon size="14">{{ alignProject?.id === p.id ? 'mdi-check-circle' : 'mdi-folder-text-outline' }}</v-icon>
          <span class="a-item-name">{{ stripDocx(p.name) }}</span><span class="a-item-tag" :class="{ isSpec: (p.sourceType ?? 'outline') === 'spec' }">{{ (p.sourceType ?? 'outline') === 'spec' ? '说明' : '大纲' }}</span>
        </button>
      </div>
    </div>
    <input ref="outlineInput" type="file" accept=".docx" hidden @change="onOutlineFile" />

    <!-- 主文档上传 -->
    <div
      class="drop"
      :class="{ over: dragging, parsing: phase === 'parsing' }"
      role="button" tabindex="0"
      @click="pick" @keydown.enter="pick"
      @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="onDrop"
    >
      <template v-if="phase === 'idle'">
        <v-icon size="42" color="primary">mdi-cloud-upload</v-icon>
        <div class="dt">拖入{{ tab.doc }}，或点击选择</div>
        <div class="dc">支持 .docx 格式 · 离线运行，文档内容不出本机<template v-if="store.traceType === 'spec'">（大纲或说明均可，自动识别；说明作源时需求章节列留空人工补）</template></div>
      </template>
      <template v-else-if="phase === 'parsing'">
        <div class="dt">正在解析…</div>
        <div class="bar"><i :style="{ width: progress + '%' }" /></div>
        <div class="dn">文件：<b>{{ fileName }}</b></div>
        <div v-if="bigFile" class="dn big">文件较大（正文超 20MB 走分块解析），预计需要 1~2 分钟，请耐心等待</div>
      </template>
      <template v-else>
        <v-icon size="40" color="success">mdi-check-circle</v-icon>
        <div class="dt">解析完成</div>
        <div class="dc">文件：<b>{{ fileName }}</b></div>
        <button type="button" class="re-pick" @click.stop="phase = 'idle'">
          <v-icon size="14">mdi-refresh</v-icon>重新选择
        </button>
      </template>
    </div>
    <input ref="fileInput" type="file" accept=".docx" hidden @change="onFile" />

    <!-- 最近项目（按 tab 类型过滤） -->
    <div v-if="visibleProjects.length > 0" class="projects">
      <div class="p-head">
        <span class="p-title">最近{{ tab.label }}项目</span>
        <v-btn size="x-small" variant="text" color="error" :class="{ armed: clearArmed }" @click="clearAll">
          <v-icon v-if="clearArmed" size="13" class="mr-1">mdi-alert</v-icon>{{ clearArmed ? '确认清空？' : '清空全部' }}
        </v-btn>
      </div>
      <div class="p-list">
        <div v-for="p in visibleProjects" :key="p.id" class="p-row">
          <v-icon size="19" class="p-icon">mdi-folder-text-outline</v-icon>
          <div class="p-main">
            <div class="p-name">{{ stripDocx(p.name) }}</div>
            <div class="p-meta">
              <span>{{ fmtTime(p.updatedAt) }}</span><span v-if="p.stats"> · {{ p.stats.cases }} 例</span><span v-if="!p.hasSource" class="p-nosource"> · 无源文件副本</span>
            </div>
          </div>
          <div class="p-acts">
            <v-btn size="small" variant="tonal" color="primary" :loading="store.traceParsing" @click="openOne(p)">打开</v-btn>
            <v-btn size="small" :variant="delArmed === p.id ? 'flat' : 'text'" color="error" class="p-del" @click="removeOne(p)">{{ delArmed === p.id ? '确认删除' : '删除' }}</v-btn>
          </div>
        </div>
      </div>
    </div>

    <template v-if="phase === 'done'">
      <div class="result">
        <v-alert type="success" variant="tonal" rounded="lg" density="compact" class="ok-alert">
          <span>
            解析完成，识别 <b>{{ store.traceStats.cases }}</b> 个用例，追踪表 <b>{{ store.traceSpec?.rows.length ?? 0 }}</b> 行{{ issueCounts() }}
            <span v-if="store.traceAlignOutline">；配对{{ store.traceAlignKind === 'spec' ? '说明（SRS 列留空人工补）' : '大纲' }} <b>{{ stripDocx(store.traceAlignOutline.name) }}</b></span>
          </span>
        </v-alert>
        <v-alert
          v-for="(iss, i) in store.traceIssues" :key="i"
          :type="iss.level === 'error' ? 'error' : iss.level === 'warning' ? 'warning' : 'info'"
          variant="outlined" density="compact" class="row-alert"
        >
          <span class="iss-text">{{ iss.context ? '【' + iss.context + '】' : '' }}{{ iss.message }}</span>
        </v-alert>

        <div class="cta">
          <v-btn color="primary" rounded="pill" size="large" @click="store.traceScreen = 2">
            生成追踪表<v-icon size="17" class="ml-2">mdi-arrow-right</v-icon>
          </v-btn>
        </div>
      </div>
      <div class="foot">离线运行，文档内容不出本机。</div>
    </template>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.wrap { max-width: 680px; margin: 26px auto 0; padding: 0 22px 40px; }
.hero { text-align: center; }
.badge {
  width: 68px; height: 68px; border-radius: 18px; margin: 0 auto 18px;
  background: linear-gradient(135deg, #3d6fb5 0%, #2D5B91 60%, #24507f 100%);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 6px 18px rgba(45, 91, 145, 0.28);
}
h1 { font-size: 23px; font-weight: 650; }
p { margin-top: 9px; color: rgba(var(--v-theme-on-surface), 0.65); font-size: 14px; }

.tabs { display: flex; gap: 6px; margin-top: 22px; }
.tab {
  flex: 1; padding: 9px 0; border-radius: 10px; border: 1px solid rgba(var(--v-theme-outline), 0.7);
  background: rgb(var(--v-theme-surface)); color: rgba(var(--v-theme-on-surface), 0.75);
  font-size: 13.5px; font-weight: 550; cursor: pointer; transition: all 0.15s;
}
.tab:hover { border-color: rgb(var(--v-theme-primary)); color: rgb(var(--v-theme-primary)); }
.tab.on {
  background: rgba(var(--v-theme-primary), 0.1); border-color: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-primary)); font-weight: 600;
}
.tab-hint { text-align: center; font-size: 12.5px; margin-top: 8px; color: rgba(var(--v-theme-on-surface), 0.55); }

.align { margin-top: 14px; padding: 12px 14px; border-radius: 14px; border: 1px solid rgba(var(--v-theme-primary), 0.4); background: rgba(var(--v-theme-primary), 0.045); }
.a-head { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 600; }
.a-head .req { color: rgb(var(--v-theme-error)); margin-left: 1px; }
.a-note { font-weight: 450; font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.55); }
.a-body { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; gap: 10px; }
.a-picked { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1; }
.a-name { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.a-empty { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.5); }
.a-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.a-item {
  display: inline-flex; align-items: center; gap: 5px; max-width: 100%;
  padding: 4px 10px; border-radius: 999px; border: 1px solid rgba(var(--v-theme-outline), 0.7);
  background: rgb(var(--v-theme-surface)); font-size: 12px; cursor: pointer; transition: all 0.15s;
}
.a-item:hover { border-color: rgb(var(--v-theme-primary)); }
.a-item.on { border-color: rgb(var(--v-theme-primary)); background: rgba(var(--v-theme-primary), 0.1); color: rgb(var(--v-theme-primary)); }
.a-item-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.drop {
  margin-top: 16px; padding: 42px 28px; border-radius: 16px; text-align: center;
  border: 1.6px dashed rgba(var(--v-theme-outline), 1); background: rgb(var(--v-theme-surface));
  cursor: pointer; transition: border-color 0.2s, background 0.2s, box-shadow 0.2s;
}
.drop:hover, .drop.over { border-color: rgb(var(--v-theme-primary)); background: rgba(var(--v-theme-primary), 0.06); box-shadow: 0 2px 10px rgba(45, 91, 145, 0.08); }
.drop.parsing { cursor: default; }
.drop :deep(.v-icon) { transition: transform 0.2s ease-out; }
.drop:hover :deep(.v-icon) { transform: translateY(-3px); }
.dt { margin-top: 12px; font-size: 15.5px; font-weight: 550; }
.re-pick {
  margin-top: 12px; display: inline-flex; align-items: center; gap: 4px;
  border: none; background: rgba(var(--v-theme-primary), 0.08); color: rgb(var(--v-theme-primary));
  font-size: 12.5px; font-weight: 550; padding: 4px 12px; border-radius: 999px; cursor: pointer;
  transition: background 0.15s;
}
.re-pick:hover { background: rgba(var(--v-theme-primary), 0.16); }
.dc { margin-top: 5px; font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.6); }
.dn { margin-top: 13px; font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.65); }
.dn b { color: rgb(var(--v-theme-on-surface)); }
.dn.big { color: rgb(var(--v-theme-warning)); font-weight: 550; }
.bar { height: 5px; border-radius: 999px; background: rgba(var(--v-theme-outline), 0.5); overflow: hidden; margin-top: 18px; }
.bar i { display: block; height: 100%; width: 0; background: rgb(var(--v-theme-primary)); border-radius: inherit; transition: width 0.9s cubic-bezier(0.3, 0.6, 0.4, 1); }

.result { margin-top: 20px; display: flex; flex-direction: column; gap: 10px; }
.ok-alert { font-size: 13.5px; text-align: left; }
.row-alert { font-size: 13.5px; text-align: left; }
.iss-text { text-align: left; }

.cta { display: flex; justify-content: center; margin-top: 18px; }
.cta :deep(.v-btn) {
  background: linear-gradient(135deg, #3d6fb5 0%, #2D5B91 55%, #24507f 100%);
  box-shadow: 0 4px 14px rgba(45, 91, 145, 0.32);
}
.cta :deep(.v-btn:hover) { box-shadow: 0 6px 18px rgba(45, 91, 145, 0.4); }
.foot { text-align: center; font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 20px; }

.projects { margin-top: 18px; }
.p-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; padding: 0 2px; }
.p-title { font-size: 13px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.75); }
.p-list {
  background: rgb(var(--v-theme-surface)); border: 1px solid rgba(var(--v-theme-outline), 0.55);
  border-radius: 14px; overflow: hidden; box-shadow: 0 1px 2px rgba(16, 24, 40, 0.05);
}
.p-row { display: flex; align-items: center; gap: 11px; padding: 11px 14px; transition: background 0.15s; }
.p-row:hover { background: rgba(var(--v-theme-primary), 0.045); }
.p-row + .p-row { border-top: 1px solid rgba(var(--v-theme-outline), 0.45); }
.p-icon { color: rgba(var(--v-theme-primary), 0.8); flex: none; }
.p-main { flex: 1; min-width: 0; }
.p-name { font-size: 13.5px; font-weight: 550; color: rgb(var(--v-theme-on-surface)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.p-meta { margin-top: 2px; font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.6); font-variant-numeric: tabular-nums; }
.p-nosource { color: rgba(var(--v-theme-on-surface), 0.4); }
.p-acts { display: flex; align-items: center; gap: 2px; flex: none; }
.p-del { min-width: 82px; }
</style>
<style scoped>
.a-item-tag {
  flex: none; font-size: 10.5px; padding: 0 5px; border-radius: 4px;
  background: rgba(var(--v-theme-primary), 0.1); color: rgb(var(--v-theme-primary));
}
.a-item-tag.isSpec { background: rgba(var(--v-theme-success), 0.12); color: rgb(var(--v-theme-success)); }
</style>
<style scoped>
/* tab 内容切换过渡（与工具一屏切换同风格 180ms fade-slide，respect reduced-motion） */
.tabbody-enter-active, .tabbody-leave-active { transition: opacity 0.18s ease-out, transform 0.18s ease-out; }
.tabbody-enter-from { opacity: 0; transform: translateY(6px); }
.tabbody-leave-to { opacity: 0; transform: translateY(-4px); }
@media (prefers-reduced-motion: reduce) {
  .tabbody-enter-active, .tabbody-leave-active { transition: none; }
}
</style>
