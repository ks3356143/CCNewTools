<script setup lang="ts">
import { ref, useTemplateRef, onMounted } from 'vue'
import { store, doTraceParse, loadProjects, openTraceProject, showToast } from '../store.ts'
import { deleteProject } from '../api.ts'
import type { ProjectMeta } from '../types.ts'

// 结构复用 Screen1（拖拽上传 / 最近项目 / 解析概要），无核对跳转——追踪表是机械映射（12 设计）
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
const dragging = ref(false)
const phase = ref<'idle' | 'parsing' | 'done'>('idle')
const fileName = ref('')
const progress = ref(0)
const bigFile = ref(false)

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
async function startParse(f: File): Promise<void> {
  fileName.value = f.name
  bigFile.value = f.size > 20 * 1024 * 1024
  progress.value = 0
  phase.value = 'parsing'
  requestAnimationFrame(() => (progress.value = 70))
  await doTraceParse(f)
  progress.value = 100
  phase.value = store.traceParsed ? 'done' : 'idle'
}

onMounted(() => {
  // 已有解析结果时（从第 2 步返回/回首页再进）直接呈现概要态
  if (store.traceParsed) {
    phase.value = 'done'
    fileName.value = store.traceOutline.name
  }
  void loadProjects()
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
  if (phase.value !== 'idle') return
  fileName.value = p.name
  progress.value = 0
  phase.value = 'parsing'
  requestAnimationFrame(() => (progress.value = 70))
  try {
    await openTraceProject(p.id)
  } finally {
    progress.value = 100
    phase.value = 'idle' // 成功时已切到第 2 步，这里只是复位本屏状态
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
  for (const p of [...store.projects]) {
    await deleteProject(p.id).catch(() => false)
  }
  await loadProjects()
  showToast('已清空全部项目')
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
/** 追踪表行数 = 未排除用例数（与服务端生成口径一致） */
function traceRowCount(): number {
  return store.traceCases.filter(c => !c.excluded).length
}
function excludedCount(): number {
  return store.traceCases.filter(c => c.excluded).length
}
</script>

<template>
  <div class="wrap">
    <div class="hero">
      <div class="badge"><v-icon size="34">mdi-link-variant</v-icon></div>
      <h1>生成追踪文档</h1>
      <p>导入第三方测试大纲（.docx），自动生成"大纲 ↔ 需求规格说明"追踪关系文档，<br />复制其中表格贴入你的文档。</p>
    </div>

    <div
      class="drop"
      :class="{ over: dragging, parsing: phase === 'parsing' }"
      role="button" tabindex="0"
      @click="pick" @keydown.enter="pick"
      @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="onDrop"
    >
      <template v-if="phase === 'idle'">
        <v-icon size="42" color="primary">mdi-cloud-upload</v-icon>
        <div class="dt">拖入文件，或点击选择</div>
        <div class="dc">支持 .docx 格式 · 离线运行，文档内容不出本机</div>
      </template>
      <template v-else-if="phase === 'parsing'">
        <div class="dt">正在解析大纲…</div>
        <div class="bar"><i :style="{ width: progress + '%' }" /></div>
        <div class="dn">文件：<b>{{ fileName }}</b></div>
        <div v-if="bigFile" class="dn big">文件较大（正文超 20MB 走分块解析），预计需要 1~2 分钟，请耐心等待</div>
      </template>
      <template v-else>
        <v-icon size="40" color="success">mdi-check-circle</v-icon>
        <div class="dt">解析完成</div>
        <div class="dc">文件：<b>{{ fileName }}</b></div>
      </template>
    </div>
    <input ref="fileInput" type="file" accept=".docx" hidden @change="onFile" />

    <!-- 最近项目（与工具一共用项目库） -->
    <div v-if="phase === 'idle' && store.projects.length > 0" class="projects">
      <div class="p-head">
        <span class="p-title">最近项目</span>
        <v-btn size="x-small" variant="text" color="error" :class="{ armed: clearArmed }" @click="clearAll">
          <v-icon v-if="clearArmed" size="13" class="mr-1">mdi-alert</v-icon>{{ clearArmed ? '确认清空？' : '清空全部' }}
        </v-btn>
      </div>
      <div class="p-list">
        <div v-for="p in store.projects" :key="p.id" class="p-row">
          <v-icon size="19" class="p-icon">mdi-folder-text-outline</v-icon>
          <div class="p-main">
            <div class="p-name">{{ stripDocx(p.name) }}</div>
            <div class="p-meta">
              <span>{{ fmtTime(p.updatedAt) }}</span><span v-if="p.stats"> · {{ p.stats.cases }} 用例</span><span v-if="p.progress"> · 已核对 {{ p.progress?.reviewed }}</span><span v-if="!p.hasSource" class="p-nosource"> · 无源文件副本</span>
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
            解析完成，共 <b>{{ store.traceStats.items }}</b> 个测试项、<b>{{ store.traceStats.cases }}</b> 个测试用例，追踪表 <b>{{ traceRowCount() }}</b> 行{{ issueCounts() }}
            <span v-if="excludedCount() > 0">；<b>{{ excludedCount() }}</b> 个已排除用例未入表</span>
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
            生成追踪文档<v-icon size="17" class="ml-2">mdi-arrow-right</v-icon>
          </v-btn>
        </div>
      </div>
      <div class="foot">离线运行，文档内容不出本机。</div>
    </template>
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
.drop {
  margin-top: 24px; padding: 42px 28px; border-radius: 16px; text-align: center;
  border: 1.6px dashed rgba(var(--v-theme-outline), 1); background: rgb(var(--v-theme-surface));
  cursor: pointer; transition: border-color 0.2s, background 0.2s, box-shadow 0.2s;
}
.drop:hover, .drop.over { border-color: rgb(var(--v-theme-primary)); background: rgba(var(--v-theme-primary), 0.06); box-shadow: 0 2px 10px rgba(45, 91, 145, 0.08); }
.drop.parsing { cursor: default; }
.drop :deep(.v-icon) { transition: transform 0.2s ease-out; }
.drop:hover :deep(.v-icon) { transform: translateY(-3px); }
.dt { margin-top: 12px; font-size: 15.5px; font-weight: 550; }
.dc { margin-top: 5px; font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.6); }
.dn { margin-top: 13px; font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.65); }
.dn b { color: rgb(var(--v-theme-on-surface)); }
.dn.big { color: rgb(var(--v-theme-warning)); font-weight: 550; }
.bar { height: 5px; border-radius: 999px; background: rgba(var(--v-theme-outline), 0.5); overflow: hidden; margin-top: 18px; }
.bar i { display: block; height: 100%; width: 0; background: rgb(var(--v-theme-primary)); border-radius: inherit; transition: width 0.9s cubic-bezier(0.3, 0.6, 0.4, 1); }

.result { margin-top: 20px; display: flex; flex-direction: column; gap: 10px; }
.ok-alert { font-size: 13.5px; text-align: left; }
/* 问题清单行：工具二无核对屏，仅展示不可跳转 */
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
