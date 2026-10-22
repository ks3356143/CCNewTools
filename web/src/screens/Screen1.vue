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
/** 大文件提示（10-大文档处理 P1：>20MB 正文走分块解析，耗时明显变长，先给出预期） */
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
  <div class="amb-wrap">
    <div class="amb" aria-hidden="true">
      <div class="amb-b1" /><div class="amb-b2" />
    </div>
    <div class="wrap">
      <header class="page-head">
        <div class="head-text">
          <div class="kicker">STEP 01 · 导入大纲</div>
          <h1 class="title">选择测试大纲</h1>
          <p class="sub">导入第三方测试大纲（.docx），自动解析测试项表格，生成测试说明与测试记录两份 Word 文档。</p>
        </div>
        <span class="offline">离线运行</span>
      </header>

      <div class="upload-layout">
        <div class="upload-main">
          <div
            class="drop"
            :class="{ over: dragging, parsing: phase === 'parsing' }"
            role="button" tabindex="0" :aria-busy="phase === 'parsing'"
            @click="pick" @keydown.enter="pick"
            @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="onDrop"
          >
            <template v-if="phase === 'idle'">
              <div class="drop-row">
                <div class="upload-icon"><v-icon size="24">mdi-cloud-upload</v-icon></div>
                <div class="drop-copy">
                  <h3>拖入文件，或点击选择</h3>
                  <p>支持 .docx 格式 · 文件仅在本机解析，不上传网络</p>
                </div>
                <div class="drop-action">
                  <span class="file-type">.DOCX</span>
                  <span class="link-hint">选择文件</span>
                </div>
              </div>
            </template>
            <template v-else-if="phase === 'parsing'">
              <div class="drop-copy">
                <h3>正在解析大纲…</h3>
                <p>文件：<b>{{ fileName }}</b></p>
              </div>
              <div class="bar"><i :style="{ width: progress + '%' }" /></div>
              <div v-if="bigFile" class="dn big">文件较大（正文超 20MB 走分块解析），预计需要 1~2 分钟，请耐心等待</div>
            </template>
            <template v-else>
              <div class="drop-row">
                <div class="upload-icon ok"><v-icon size="24">mdi-check</v-icon></div>
                <div class="drop-copy">
                  <h3>解析完成</h3>
                  <p>文件：<b>{{ fileName }}</b></p>
                </div>
              </div>
            </template>
          </div>
          <input ref="fileInput" type="file" accept=".docx" hidden @change="onFile" />

          <template v-if="phase === 'done'">
            <v-alert type="success" variant="tonal" density="compact" class="ok-alert">
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

            <div class="stats-band">
              <div class="stat">
                <span class="k">测试项<span class="u-mono">ITEMS</span></span>
                <b>{{ store.stats.items }}</b>
              </div>
              <div class="stat">
                <span class="k">测试用例<span class="u-mono">CASES</span></span>
                <b>{{ store.stats.cases }}</b>
              </div>
              <div class="stat">
                <span class="k">测试步骤<span class="u-mono">STEPS</span></span>
                <b>{{ store.stats.steps }}</b>
              </div>
              <div class="stat warn">
                <span class="k">切分可疑<span class="u-mono">SUSPECT</span></span>
                <b>{{ store.cases.reduce((n, c) => n + activeSuspects(c), 0) }}</b>
              </div>
            </div>

            <div class="cta">
              <v-btn color="primary" size="large" @click="store.screen = 2">
                开始核对与编辑<v-icon size="16" class="ml-2">mdi-arrow-right</v-icon>
              </v-btn>
            </div>
          </template>
        </div>

        <aside class="upload-aside">
          <div v-if="phase === 'idle' && store.projects.length > 0" class="panel recent">
            <div class="u-panel-head">
              <strong>最近项目</strong>
              <v-btn size="x-small" variant="text" color="error" :class="{ armed: clearArmed }" @click="clearAll">
                <v-icon v-if="clearArmed" size="12" class="mr-1">mdi-alert</v-icon>{{ clearArmed ? '确认清空？' : '清空全部' }}
              </v-btn>
            </div>
            <div class="p-list">
              <div v-for="p in store.projects" :key="p.id" class="p-row">
                <span class="u-mono p-idx">DOCX</span>
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
            <div class="p-foot">项目存档保存在本机 数据/ 目录，换机时与 exe 一并拷贝。</div>
          </div>

          <div v-else-if="phase === 'done'" class="panel guide">
            <div class="u-panel-head"><strong>下一步</strong></div>
            <div class="guide-body">
              <div class="guide-item"><b>1</b><span>逐条核对用例与步骤，可疑行会标红提示。</span></div>
              <div class="guide-item"><b>2</b><span>在「全局参数」中填写测试人员与监测人员（必填）。</span></div>
              <div class="guide-item"><b>3</b><span>点击「生成文档」，输出说明与记录两份 Word。</span></div>
            </div>
          </div>
        </aside>
      </div>
      <div class="foot">离线运行，文档内容不出本机。</div>
    </div>
  </div>
</template>

<style scoped>
.wrap { position: relative; width: 100%; max-width: 1240px; margin: 0 auto; padding: 24px 24px 30px;
  display: flex; flex-direction: column; min-height: calc(100vh - 64px); }

/* ---- 页头 ---- */
.page-head {
  display: flex; align-items: flex-end; justify-content: space-between; gap: 24px;
  margin-bottom: 22px;
  animation: rise var(--cn-dur-4) var(--cn-ease-out) both;
}
.kicker {
  display: inline-flex; align-items: center; gap: 8px; margin-bottom: 8px;
  color: var(--cn-accent); font-family: var(--cn-font-mono);
  font-size: 10.5px; font-weight: 600; letter-spacing: 0.13em; text-transform: uppercase;
}
.kicker::before { content: ""; width: 22px; height: 1px; background: var(--cn-accent-line); }
.title {
  margin: 0; font-family: var(--cn-font-display);
  font-size: 24px; line-height: 1.2; font-weight: 650; letter-spacing: -0.025em; color: var(--cn-fg);
}
.sub { margin: 7px 0 0; color: var(--cn-muted); font-size: 12px; line-height: 1.7; max-width: 720px; }
.offline {
  display: inline-flex; align-items: center; gap: 7px; flex: none;
  color: var(--cn-subtle); font-family: var(--cn-font-mono); font-size: 10px; letter-spacing: 0.04em;
}
.offline::before {
  content: ""; width: 5px; height: 5px; border-radius: 50%;
  background: var(--cn-success); box-shadow: 0 0 0 3px var(--cn-success-soft);
}

/* ---- 布局：上传主区 + 最近项目侧栏 ---- */
.upload-layout {
  display: grid; grid-template-columns: minmax(0, 1.38fr) minmax(380px, 0.78fr); gap: 16px;
  align-items: start;
}
.upload-main { display: grid; gap: 14px; animation: rise var(--cn-dur-4) var(--cn-ease-out) both; animation-delay: 60ms; }
.upload-aside { animation: rise var(--cn-dur-4) var(--cn-ease-out) both; animation-delay: 120ms; }
@media (max-width: 1000px) { .upload-layout { grid-template-columns: 1fr; } }

/* ---- 拖放区 ---- */
.drop {
  min-height: 220px; padding: 24px;
  display: flex; flex-direction: column; justify-content: center; gap: 14px;
  border: 1px dashed var(--cn-accent-line);
  border-radius: var(--cn-r-3);
  background: rgba(255, 255, 255, 0.62);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.4);
  cursor: pointer;
  transition: transform var(--cn-dur-2) var(--cn-ease-out), border-color var(--cn-dur-2) var(--cn-ease-out), background var(--cn-dur-2) var(--cn-ease-out);
}
.v-theme--dark .drop { background: rgba(14, 29, 47, 0.55); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03); }
.drop:hover, .drop.over { transform: translateY(-2px); border-color: var(--cn-accent); background: var(--cn-accent-soft); }
.drop.parsing { cursor: default; transform: none; }
.drop.parsing:hover { border-color: var(--cn-accent-line); background: rgba(255, 255, 255, 0.62); }
.v-theme--dark .drop.parsing:hover { background: rgba(14, 29, 47, 0.55); }
.drop-row { display: flex; align-items: center; gap: 16px; }
.upload-icon {
  position: relative; width: 54px; height: 54px; flex: none;
  border: 1px solid var(--cn-accent-line); border-radius: 10px;
  display: grid; place-items: center;
  color: var(--cn-accent); background: var(--cn-accent-soft);
}
.upload-icon.ok { color: var(--cn-success); background: var(--cn-success-soft); border-color: #a6d7bf; }
.drop-copy { flex: 1; min-width: 0; }
.drop-copy h3 { margin: 0 0 5px; font-size: 16px; font-weight: 650; color: var(--cn-fg); }
.drop-copy p { margin: 0; color: var(--cn-muted); font-size: 12.5px; line-height: 1.6; }
.drop-copy p b { color: var(--cn-fg-soft); font-weight: 600; }
.drop-action { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; flex: none; }
.file-type { color: var(--cn-subtle); font-family: var(--cn-font-mono); font-size: 10px; letter-spacing: 0.08em; }
.link-hint { color: var(--cn-accent); font-size: 12px; font-weight: 650; }
.bar { height: 5px; border-radius: 3px; background: var(--cn-border); overflow: hidden; }
.bar i { display: block; height: 100%; width: 0; background: var(--cn-accent); border-radius: inherit; transition: width 0.9s var(--cn-ease-standard); }
.dn { font-size: 12px; color: var(--cn-muted); }
.dn.big { color: var(--cn-warning); font-weight: 550; }

/* ---- 结果区 ---- */
.ok-alert { font-size: 13px; text-align: left; }
.row-alert { cursor: pointer; font-size: 13px; transition: box-shadow var(--cn-dur-1) var(--cn-ease-out), background var(--cn-dur-1) var(--cn-ease-out); }
.row-alert:hover { background: var(--cn-accent-soft); box-shadow: var(--cn-shadow-1); }
.iss-inner { display: flex; align-items: center; gap: 8px; }
.iss-text { flex: 1; text-align: left; }
.go { opacity: 0.4; flex: none; }

/* ---- 统计带（实色数据区） ---- */
.stats-band {
  display: grid; grid-template-columns: repeat(4, 1fr);
  background: var(--cn-surface);
  border: 1px solid var(--cn-border);
  border-radius: var(--cn-r-2);
  overflow: hidden;
}
.stat { padding: 15px 16px; border-right: 1px solid var(--cn-border); }
.stat:last-child { border-right: 0; }
.stat .k {
  display: flex; justify-content: space-between; align-items: center; gap: 8px;
  color: var(--cn-muted); font-size: 11px;
}
.stat .k .u-mono { color: var(--cn-subtle); font-size: 9.5px; letter-spacing: 0.06em; }
.stat b {
  display: block; margin-top: 6px;
  font-family: var(--cn-font-mono); font-size: 26px; line-height: 1; font-weight: 650;
  letter-spacing: -0.04em; color: var(--cn-fg);
}
.stat.warn b { color: var(--cn-warning); }
.cta { display: flex; justify-content: flex-start; margin-top: 2px; }

/* ---- 最近项目面板 ---- */
.panel { background: var(--cn-surface); border: 1px solid var(--cn-border); border-radius: var(--cn-r-3); box-shadow: var(--cn-shadow-1); overflow: hidden; }
.u-panel-head { display: flex; align-items: center; justify-content: space-between; padding: 11px 14px; border-bottom: 1px solid var(--cn-border); }
.u-panel-head strong { font-size: 12.5px; font-weight: 650; }
.p-list { padding: 3px 0; max-height: 520px; overflow-y: auto; }
.p-row { display: flex; align-items: center; gap: 12px; padding: 13px 14px; transition: background var(--cn-dur-1) var(--cn-ease-out); }
.p-row:hover { background: var(--cn-surface-soft); }
.p-row + .p-row { border-top: 1px solid var(--cn-border); }
.p-idx { flex: none; color: var(--cn-subtle); font-size: 10px; letter-spacing: 0.08em; }
.p-main { flex: 1; min-width: 0; }
.p-name { font-size: 13.5px; font-weight: 600; color: var(--cn-fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.p-meta { margin-top: 3px; font-size: 12px; color: var(--cn-subtle); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.p-suspect { color: var(--cn-danger); }
.p-nosource { color: var(--cn-subtle); opacity: 0.7; }
.p-acts { display: flex; align-items: center; gap: 2px; flex: none; }
.p-del { min-width: 74px; }
.p-foot { padding: 11px 14px; border-top: 1px solid var(--cn-border); color: var(--cn-subtle); font-size: 11px; line-height: 1.6; }

/* ---- 下一步指引 ---- */
.guide-body { display: grid; gap: 10px; padding: 14px; }
.guide-item { display: flex; gap: 9px; color: var(--cn-muted); font-size: 12px; line-height: 1.6; }
.guide-item b {
  width: 20px; height: 20px; flex: none; display: grid; place-items: center;
  border-radius: 50%; background: var(--cn-accent-soft); color: var(--cn-accent);
  font-family: var(--cn-font-mono); font-size: 10px; font-weight: 650;
}

.foot { margin-top: auto; padding-top: 22px; text-align: center; color: var(--cn-subtle); font-family: var(--cn-font-mono); font-size: 10px; letter-spacing: 0.03em; }

@keyframes rise {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .page-head, .upload-main, .upload-aside { animation: none; }
  .drop, .bar i { transition: none; }
}
</style>
