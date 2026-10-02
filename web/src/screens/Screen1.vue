<script setup lang="ts">
import { ref, useTemplateRef, onMounted } from 'vue'
import { store, doParse, loadProjects, openProjectById, showToast } from '../store.ts'
import { activeSuspects } from '../suspect.ts'
import { deleteProject } from '../api.ts'
import type { Issue, ProjectMeta } from '../types.ts'

const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
const dragging = ref(false)
const phase = ref<'idle' | 'parsing' | 'done'>('idle')
const fileName = ref('')
const progress = ref(0)

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
  progress.value = 0
  phase.value = 'parsing'
  requestAnimationFrame(() => (progress.value = 70))
  await doParse(f)
  progress.value = 100
  phase.value = store.parsed ? 'done' : 'idle'
}

// —— 最近项目 ——
// Screen1 是 v-if 挂载，每次回到第一屏都会重挂载，onMounted 即拉最新列表
onMounted(() => {
  void loadProjects()
})

const clearArmed = ref(false) // 「清空全部」待确认状态
const delArmed = ref<string | null>(null) // 待确认删除的项目 id
let confirmTimer: ReturnType<typeof setTimeout> | undefined

/** 两段式确认共用：3 秒未再点自动还原 */
function armConfirm(): void {
  clearTimeout(confirmTimer)
  confirmTimer = setTimeout(() => {
    clearArmed.value = false
    delArmed.value = null
  }, 3000)
}

/** 去掉 .docx 后缀用于展示 */
function stripDocx(name: string): string {
  return name.replace(/\.docx$/i, '')
}
/** 本地时间 "M/D HH:mm" */
function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hh + ':' + mm
}

/** 打开项目：复用 drop 区的解析中状态；失败 toast 由 openProjectById 统一处理 */
async function openOne(p: ProjectMeta): Promise<void> {
  if (phase.value !== 'idle') return
  fileName.value = p.name
  progress.value = 0
  phase.value = 'parsing'
  requestAnimationFrame(() => (progress.value = 70))
  try {
    await openProjectById(p.id)
  } finally {
    progress.value = 100
    phase.value = 'idle' // 成功时页面已切到第二屏，这里只是复位本屏状态
  }
}

/** 删除单个项目（两段式确认） */
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

/** 清空全部项目（两段式确认，逐个删除） */
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
  for (const i of store.issues) c[i.level]++
  const parts: string[] = []
  if (c.error) parts.push(c.error + ' 错误')
  if (c.warning) parts.push(c.warning + ' 告警')
  if (c.info) parts.push(c.info + ' 提示')
  return parts.length ? ' · ' + parts.join(' · ') : ''
}
function jumpTo(issue: Issue): void {
  const idx = store.cases.findIndex(c => c.itemName === issue.context || c.mingcheng === issue.context)
  if (idx >= 0) store.currentIdx = idx
  store.screen = 2
}
</script>

<template>
  <div class="wrap">
    <div class="hero">
      <div class="badge"><v-icon size="34">mdi-file-word-box</v-icon></div>
      <h1>选择测试大纲</h1>
      <p>导入第三方测试大纲（.docx），自动解析其中的测试项表格，<br />生成测试说明与测试记录两份 Word 文档。</p>
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
      </template>
      <template v-else>
        <v-icon size="40" color="success">mdi-check-circle</v-icon>
        <div class="dt">解析完成</div>
        <div class="dc">文件：<b>{{ fileName }}</b></div>
      </template>
    </div>
    <input ref="fileInput" type="file" accept=".docx" hidden @change="onFile" />

    <!-- 最近项目 -->
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
              <span>{{ fmtTime(p.updatedAt) }}</span><span v-if="p.stats"> · {{ p.stats.cases }} 用例</span><span v-if="p.progress"> · 已核对 {{ p.progress?.reviewed }}</span><span v-if="p.progress && p.progress.suspects > 0" class="p-suspect"> · 可疑 {{ p.progress.suspects }}</span><span v-if="!p.hasSource" class="p-nosource"> · 无源文件副本</span>
            </div>
          </div>
          <div class="p-acts">
            <v-btn size="small" variant="tonal" color="primary" :loading="store.parsing" @click="openOne(p)">打开</v-btn>
            <v-btn size="small" :variant="delArmed === p.id ? 'flat' : 'text'" color="error" class="p-del" @click="removeOne(p)">{{ delArmed === p.id ? '确认删除' : '删除' }}</v-btn>
          </div>
        </div>
      </div>
    </div>

    <template v-if="phase === 'done'">
      <div class="result">
        <v-alert type="success" variant="tonal" rounded="lg" density="compact" class="ok-alert">
          <span>
            解析完成，共 <b>{{ store.stats.items }}</b> 个测试项、<b>{{ store.stats.cases }}</b> 个测试用例、<b>{{ store.stats.steps }}</b> 个测试步骤{{ issueCounts() }}
            <span v-if="store.restored.cases > 0">；已恢复上次编辑 {{ store.restored.cases }} 处</span>
          </span>
        </v-alert>
        <v-alert
          v-for="(iss, i) in store.issues" :key="i"
          :type="iss.level === 'error' ? 'error' : iss.level === 'warning' ? 'warning' : 'info'"
          variant="outlined" density="compact" class="row-alert"
          @click="jumpTo(iss)"
        >
          <div class="iss-inner">
            <span class="iss-text">{{ iss.context ? '【' + iss.context + '】' : '' }}{{ iss.message }}</span>
            <v-icon size="14" class="go">mdi-chevron-right</v-icon>
          </div>
        </v-alert>

        <v-card rounded="14" elevation="1" class="band">
          <div class="stat"><b>{{ store.stats.items }}</b><span>测试项</span></div>
          <div class="stat"><b>{{ store.stats.cases }}</b><span>测试用例</span></div>
          <div class="stat"><b>{{ store.stats.steps }}</b><span>测试步骤</span></div>
          <div class="stat"><b>{{ store.cases.reduce((n, c) => n + activeSuspects(c), 0) }}</b><span>切分可疑待核对</span></div>
        </v-card>

        <div class="cta">
          <v-btn color="primary" rounded="pill" size="large" @click="store.screen = 2">
            开始核对与编辑<v-icon size="17" class="ml-2">mdi-arrow-right</v-icon>
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
.bar { height: 5px; border-radius: 999px; background: rgba(var(--v-theme-outline), 0.5); overflow: hidden; margin-top: 18px; }
.bar i { display: block; height: 100%; width: 0; background: rgb(var(--v-theme-primary)); border-radius: inherit; transition: width 0.9s cubic-bezier(0.3, 0.6, 0.4, 1); }

.result { margin-top: 20px; display: flex; flex-direction: column; gap: 10px; }
.alert {
  display: flex; align-items: flex-start; gap: 11px; padding: 12px 16px; border-radius: 14px;
  font-size: 13.5px; text-align: left; width: 100%;
}
.alert b { font-weight: 650; }
.ok-alert { font-size: 13.5px; text-align: left; }
/* v-alert outlined（问题清单行，2026-10-02 组件化）：v-alert 自带类型色边框与图标，这里只补可点击语义 */
.row-alert { cursor: pointer; font-size: 13.5px; transition: box-shadow 0.15s, background 0.15s; }
.row-alert:hover { background: rgba(var(--v-theme-primary), 0.04); box-shadow: 0 2px 8px rgba(45, 91, 145, 0.1); }
.iss-inner { display: flex; align-items: center; gap: 8px; }
.iss-text { flex: 1; text-align: left; }
.go { opacity: 0.4; flex: none; }

.band { display: flex; overflow: hidden; }
.stat { flex: 1; padding: 15px 8px 13px; text-align: center; }
.stat + .stat { border-left: 1px solid rgba(var(--v-theme-outline), 0.45); }
.stat b { display: block; font-size: 28px; font-weight: 650; font-variant-numeric: tabular-nums; color: rgb(var(--v-theme-primary)); }
.stat span { display: block; font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.6); margin-top: 2px; }
.cta { display: flex; justify-content: center; margin-top: 18px; }
/* 主 CTA 渐变（页面唯一的大按钮，让行动点醒目） */
.cta :deep(.v-btn) {
  background: linear-gradient(135deg, #3d6fb5 0%, #2D5B91 55%, #24507f 100%);
  box-shadow: 0 4px 14px rgba(45, 91, 145, 0.32);
}
.cta :deep(.v-btn:hover) { box-shadow: 0 6px 18px rgba(45, 91, 145, 0.4); }
.foot { text-align: center; font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 20px; }

.projects { margin-top: 18px; }
.p-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; padding: 0 2px; }
.p-title { font-size: 13px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.75); }
.p-clear { border: none; background: none; padding: 3px 6px; border-radius: 6px; font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.55); cursor: pointer; }
.p-clear:hover { color: rgb(var(--v-theme-error)); background: rgba(var(--v-theme-error), 0.08); }
.p-clear.armed { color: rgb(var(--v-theme-error)); font-weight: 600; }
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
.p-suspect { color: rgb(var(--v-theme-error)); }
.p-nosource { color: rgba(var(--v-theme-on-surface), 0.4); }
.p-acts { display: flex; align-items: center; gap: 2px; flex: none; }
.p-del { min-width: 82px; }
</style>
