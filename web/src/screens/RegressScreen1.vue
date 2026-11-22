<script setup lang="ts">
import { ref, computed, useTemplateRef, onMounted } from 'vue'
import { store, doRegressParse, loadProjects, showToast, clearRegressDraft } from '../store.ts'
import { loadSettings, deleteProject } from '../api.ts'
import ParamsCard from '../components/ParamsCard.vue'
import type { ProjectMeta } from '../types.ts'

// 回归测试说明 第 1 步（F11/13）：配对大纲 + 上传测试记录（或从最近记录项目打开）
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
const outlineInput = useTemplateRef<HTMLInputElement>('outlineInput')
const dragging = ref(false)
const phase = ref<'idle' | 'parsing' | 'done'>('idle')
const fileName = ref('')
const progress = ref(0)
const bigFile = ref(false)
/** 配对的大纲：项目库或新上传 */
const alignProject = ref<ProjectMeta | null>(null)
const alignFileName = ref('')
/** 上传的大纲 File 暂存（不能进 reactive，File 代理会丢） */
let outlineFileRef: File | null = null

const alignReady = computed(() => alignProject.value !== null || alignFileName.value !== '')
const alignLabel = computed(() => alignProject.value?.name ?? alignFileName.value)
const outlineProjects = computed(() => store.projects.filter(p => (p.sourceType ?? 'outline') === 'outline'))
const recordProjects = computed(() => store.projects.filter(p => p.sourceType === 'record'))
const parsed = computed(() => store.regressDraft !== null)

/** 必填测试信息（2026-11-22 用户拍板"没填不能进下一步"）：人员 + 时间范围（工具按范围在用例间自动铺开测试时间） */
const paramsReady = computed(() =>
  store.params.tester.trim() !== '' && store.params.monitor.trim() !== '' &&
  (store.params.timeStart ?? '').trim() !== '' && (store.params.timeEnd ?? '').trim() !== ''
)
// 测试信息卡片（2026-11-22 用户拍板：回到卡片形式，撤抽屉与全局参数按钮）
const infoCard = useTemplateRef<HTMLElement>('infoCard')
const infoPulse = ref(false)
let pulseTimer: ReturnType<typeof setTimeout> | undefined
/** 缺参引导：滚到卡片并红框脉冲；补齐前 CTA 不放行 */
function attentionCard(): void {
  infoCard.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  infoPulse.value = false
  clearTimeout(pulseTimer)
  requestAnimationFrame(() => { infoPulse.value = true })
  pulseTimer = setTimeout(() => { infoPulse.value = false }, 1800)
}
function goNext(): void {
  if (!paramsReady.value) {
    attentionCard()
    showToast('请先填写测试人员、监测人员与测试时间范围')
    return
  }
  if (store.params.timeStart > store.params.timeEnd) {
    attentionCard()
    showToast('测试时间的止期不能早于起期')
    return
  }
  store.regressScreen = 2
}

function pick(): void {
  if (phase.value === 'idle') fileInput.value?.click()
}
function onFile(e: Event): void {
  const el = e.target as HTMLInputElement
  const f = el.files?.[0]
  // value 复位：失败后再次选择同一个文件也能触发 change（Screen1 同款坑位）
  el.value = ''
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
/** 配对大纲变更：已出解析结果时作废旧草稿（旧告警/勾选与新配对不再对应）；同一配对（按全局配对哈希）不算变更 */
function invalidateDraftOnAlignChange(nextHash?: string): void {
  if (phase.value !== 'done' || store.regressDraft === null) return
  if (nextHash !== undefined && nextHash !== '' && nextHash === store.regressOutline.hash) return
  clearRegressDraft()
  phase.value = 'idle'
  fileName.value = ''
  showToast('配对大纲已变更，请重新解析记录')
}
function pickAlign(p: ProjectMeta): void {
  invalidateDraftOnAlignChange(p.hash)
  alignProject.value = p
  alignFileName.value = ''
}
function resetAlign(): void {
  invalidateDraftOnAlignChange()
  alignProject.value = null
  alignFileName.value = ''
}
function onOutlineFile(e: Event): void {
  const el = e.target as HTMLInputElement
  const f = el.files?.[0]
  el.value = ''
  if (f) {
    invalidateDraftOnAlignChange()
    alignProject.value = null
    alignFileName.value = f.name
    outlineFileRef = f
  }
}

async function startParse(f: File): Promise<void> {
  if (!alignReady.value) {
    showToast('请先选择或上传配对的测试大纲')
    return
  }
  fileName.value = f.name
  bigFile.value = f.size > 20 * 1024 * 1024
  progress.value = 0
  phase.value = 'parsing'
  requestAnimationFrame(() => (progress.value = 70))
  const outline = alignProject.value ? { hash: alignProject.value.hash } : outlineFileRef !== null ? { file: outlineFileRef } : undefined
  await doRegressParse({ file: f }, outline)
  progress.value = 100
  phase.value = parsed.value ? 'done' : 'idle'
}

/** 从最近记录项目直接打开（服务端读源副本，35MB 记录不用重传） */
async function openOne(p: ProjectMeta): Promise<void> {
  if (phase.value === 'parsing' || !alignReady.value) {
    if (!alignReady.value) showToast('请先选择或上传配对的测试大纲')
    return
  }
  fileName.value = p.name
  progress.value = 0
  phase.value = 'parsing'
  requestAnimationFrame(() => (progress.value = 70))
  const outline = alignProject.value ? { hash: alignProject.value.hash } : outlineFileRef !== null ? { file: outlineFileRef } : undefined
  try {
    await doRegressParse({ hash: p.hash }, outline)
  } finally {
    progress.value = 100
    phase.value = parsed.value ? 'done' : 'idle'
  }
}

onMounted(async () => {
  if (store.regressDraft !== null) {
    phase.value = 'done'
    fileName.value = store.regressPrimary.name
  }
  // 水合服务端已存参数（工具一保存过的人员带过来，避免重复填写）；仅本地四项全空时，
  // 不覆写会话内已编辑的值
  if (store.params.tester === '' && store.params.monitor === '' && (store.params.timeStart ?? '') === '' && (store.params.timeEnd ?? '') === '') {
    try {
      const s = await loadSettings()
      if (s.params !== null) store.params = { ...store.params, ...s.params }
    } catch { /* 设置读取失败按本地默认走 */ }
  }
  await loadProjects()
  // 换屏重挂后局部配对 ref 会丢：从全局配对态恢复，避免「明明解析过却显示未选择/要求重选」
  if (store.regressDraft !== null && alignProject.value === null && alignFileName.value === '') {
    const op = store.projects.find(p => p.hash === store.regressOutline.hash && (p.sourceType ?? 'outline') === 'outline')
    if (op !== undefined) alignProject.value = op
    else if (store.regressOutline.name !== '') alignFileName.value = store.regressOutline.name
  }
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
  await loadProjects()
  // 删的就是当前解析的那份记录：解析结果与告警区同步清空
  if (store.regressPrimary.hash !== '' && store.regressPrimary.hash === p.hash) {
    clearRegressDraft()
    phase.value = 'idle'
    fileName.value = ''
    showToast('已删除项目（当前解析记录，结果已清空）')
  } else {
    showToast('已删除项目')
  }
}
/** 删除配对大纲项目（chips 的 ×，两击确认与记录删除同款） */
async function removeOutline(p: ProjectMeta): Promise<void> {
  const key = 'o:' + p.id
  if (delArmed.value !== key) {
    delArmed.value = key
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
  if (alignProject.value?.id === p.id) {
    alignProject.value = null
    alignFileName.value = ''
    invalidateDraftOnAlignChange()
  }
  await loadProjects()
  showToast('已删除大纲项目')
}
async function clearAll(): Promise<void> {
  if (!clearArmed.value) {
    clearArmed.value = true
    armConfirm()
    return
  }
  clearTimeout(confirmTimer)
  clearArmed.value = false
  const curHash = store.regressPrimary.hash
  const hadCurrent = curHash !== '' && recordProjects.value.some(x => x.hash === curHash)
  for (const p of [...recordProjects.value]) {
    await deleteProject(p.id).catch(() => false)
  }
  await loadProjects()
  if (hadCurrent) {
    clearRegressDraft()
    phase.value = 'idle'
    fileName.value = ''
    showToast('已清空记录项目（含当前解析记录，结果已清空）')
  } else {
    showToast('已清空记录项目')
  }
}
</script>

<template>
  <div class="amb-wrap">
    <div class="amb" aria-hidden="true">
      <div class="amb-b1" /><div class="amb-b2" />
    </div>
    <div class="wrap">
    <div class="hero">
      <h1 class="amb-title">生成回归测试说明</h1>
      <p>配对测试大纲，上传测试记录，筛出<b>不通过的用例</b>，生成 4.1 回归测试需求 / 5 用例概述 / 6 测试用例三章。</p>
    </div>

    <!-- 配对大纲（必选） -->
    <div class="align">
      <div class="a-head">
        <v-icon size="16" color="primary">mdi-file-document-outline</v-icon>
        <span>配对测试大纲<b class="req">*</b></span>
        <span class="a-note">从项目库选择大纲，或上传新大纲（4.1 需求表的名称/标识/优先级/追踪关系/需求描述全部原文照抄自大纲）</span>
      </div>
      <div class="a-body">
        <div class="a-picked">
          <template v-if="alignLabel">
            <v-icon size="15" color="success">mdi-check-circle</v-icon>
            <span class="a-name">{{ stripDocx(alignLabel) }}</span>
            <v-btn size="x-small" variant="text" @click="resetAlign">重选</v-btn>
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
        <div v-for="p in outlineProjects" :key="p.id" class="a-item" :class="{ on: alignProject?.id === p.id }">
          <button type="button" class="a-pick" @click="pickAlign(p)">
            <v-icon size="14">{{ alignProject?.id === p.id ? 'mdi-check-circle' : 'mdi-folder-text-outline' }}</v-icon>
            <span class="a-item-name">{{ stripDocx(p.name) }}</span>
            <span class="a-item-tag">大纲</span>
          </button>
          <button
            type="button" class="a-x" :class="{ armed: delArmed === 'o:' + p.id }"
            :title="delArmed === 'o:' + p.id ? '再点一次确认删除' : '删除该大纲项目'"
            @click.stop="removeOutline(p)"
          >
            <v-icon size="12">mdi-close</v-icon>
          </button>
        </div>
      </div>
    </div>
    <input ref="outlineInput" id="reg-outline" type="file" accept=".docx" hidden @change="onOutlineFile" />

    <!-- 测试记录上传 -->
    <div
      class="drop"
      :class="{ over: dragging, parsing: phase === 'parsing' }"
      role="button" tabindex="0" :aria-busy="phase === 'parsing'"
      @click="pick" @keydown.enter="pick"
      @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="onDrop"
    >
      <template v-if="phase === 'idle'">
        <v-icon size="42" color="primary">mdi-cloud-upload</v-icon>
        <div class="dt">拖入测试记录，或点击选择</div>
        <div class="dc">支持 .docx 格式 · 只读文字，截图不参与 · 离线运行，文档内容不出本机</div>
      </template>
      <template v-else-if="phase === 'parsing'">
        <div class="dt">正在解析记录…</div>
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
    <input ref="fileInput" id="reg-record" type="file" accept=".docx" hidden @change="onFile" />

    <!-- 最近记录项目 -->
    <div v-if="recordProjects.length > 0" class="projects">
      <div class="p-head">
        <span class="p-title">最近测试记录项目</span>
        <v-btn size="x-small" variant="text" color="error" :class="{ armed: clearArmed }" @click="clearAll">
          <v-icon v-if="clearArmed" size="13" class="mr-1">mdi-alert</v-icon>{{ clearArmed ? '确认清空？' : '清空全部' }}
        </v-btn>
      </div>
      <div class="p-list glass">
        <div v-for="p in recordProjects" :key="p.id" class="p-row">
          <v-icon size="19" class="p-icon">mdi-folder-text-outline</v-icon>
          <div class="p-main">
            <div class="p-name">{{ stripDocx(p.name) }}</div>
            <div class="p-meta">
              <span>{{ fmtTime(p.updatedAt) }}</span><span v-if="p.stats"> · {{ p.stats.cases }} 例</span><span v-if="!p.hasSource" class="p-nosource"> · 无源文件副本</span>
            </div>
          </div>
          <div class="p-acts">
            <v-btn size="small" variant="tonal" color="primary" :loading="store.regressParsing" @click="openOne(p)">解析</v-btn>
            <v-btn size="small" :variant="delArmed === p.id ? 'flat' : 'text'" color="error" class="p-del" @click="removeOne(p)">{{ delArmed === p.id ? '确认删除' : '删除' }}</v-btn>
          </div>
        </div>
      </div>
    </div>

    <!-- 测试信息（两份产物共用，生成前必填；卡片形式内嵌页面） -->
    <div ref="infoCard" class="info-card" :class="{ miss: infoPulse }">
      <div class="i-head">
        <v-icon size="16" color="primary">mdi-account-multiple-outline</v-icon>
        <span>测试信息<b class="req">*</b></span>
        <span class="i-note">两份产物共用；测试时间按起止范围在用例间自动铺开，修改自动保存</span>
      </div>
      <div class="i-body">
        <ParamsCard headless time-range />
      </div>
    </div>

    <template v-if="phase === 'done' && store.regressDraft !== null">
      <div class="result">
        <v-alert type="success" variant="tonal" rounded="lg" density="compact" class="ok-alert">
          <span>
            记录共 <b>{{ store.regressDraft.stats.recordCases }}</b> 个用例表，<b>{{ store.regressDraft.stats.failed }}</b> 个含不通过步骤，其中
            <b>{{ store.regressDraft.stats.matched }}</b> 个已对上大纲用例
            <span v-if="store.regressDraft.unmatched.length > 0">；{{ store.regressDraft.unmatched.length }} 个对不上，生成时默认排除</span>
          </span>
        </v-alert>
        <v-alert v-if="store.regressDraft.stats.failed === 0" type="info" variant="outlined" density="compact" class="row-alert">
          <span class="iss-text">记录中所有步骤均「通过」——没有需要回归的用例。若这是第二轮记录，请确认上传的文档正确。</span>
        </v-alert>
        <v-alert
          v-for="(iss, i) in store.regressDraft.issues" :key="i"
          :type="iss.level === 'error' ? 'error' : iss.level === 'warning' ? 'warning' : 'info'"
          variant="outlined" density="compact" class="row-alert"
        >
          <span class="iss-text">{{ iss.context ? '【' + iss.context + '】' : '' }}{{ iss.message }}</span>
        </v-alert>

        <div class="cta">
          <v-btn color="primary" rounded="pill" size="large" @click="goNext">
            查看勾选并生成<v-icon size="17" class="ml-2">mdi-arrow-right</v-icon>
          </v-btn>
        </div>
      </div>
      <div class="foot">离线运行，文档内容不出本机。</div>
    </template>

    </div>
  </div>
</template>

<style scoped>
.wrap { position: relative; width: 100%; max-width: 1240px; margin: 0 auto; padding: 24px 24px 30px; }
.hero { text-align: left; margin-bottom: 14px; animation: rise var(--cn-dur-4) var(--cn-ease-out) both; }
.hero h1 { margin: 0; font-family: var(--cn-font-display); font-size: 24px; font-weight: 650; letter-spacing: -0.025em; color: var(--cn-fg); }
.hero p { margin: 7px 0 0; color: var(--cn-muted); font-size: 12px; line-height: 1.7; }
.hero p b { color: var(--cn-accent); }

.align { margin-top: 12px; padding: 12px 14px; border: 1px solid var(--cn-accent-line); border-radius: var(--cn-r-2); background: var(--cn-accent-soft); }
.a-head { display: flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 600; color: var(--cn-fg); }
.a-head .req { color: var(--cn-danger); margin-left: 1px; }
.a-note { font-weight: 450; font-size: 11px; color: var(--cn-muted); }
.a-body { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; gap: 10px; }
.a-picked { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1; }
.a-name { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--cn-fg-soft); }
.a-empty { font-size: 11.5px; color: var(--cn-subtle); }
.a-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.a-item {
  display: inline-flex; align-items: center; gap: 0; max-width: 320px; padding: 0 0 0 9px;
  border: 1px solid var(--cn-border); border-radius: var(--cn-r-1); background: var(--cn-surface);
  color: var(--cn-muted); font-size: 11.5px;
  transition: border-color var(--cn-dur-1) var(--cn-ease-out), color var(--cn-dur-1) var(--cn-ease-out);
}
.a-item:hover { border-color: var(--cn-accent-line); }
.a-item.on { border-color: var(--cn-accent); }
.a-item.on .a-pick { color: var(--cn-accent); }
.a-pick {
  display: inline-flex; align-items: center; gap: 6px; min-width: 0; padding: 4px 2px 4px 0;
  border: 0; background: none; color: inherit; font-size: inherit; cursor: pointer; text-align: left;
}
.a-item-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.a-item-tag { flex: none; font-size: 10px; padding: 0 5px; border-radius: var(--cn-r-1); background: var(--cn-accent-soft); color: var(--cn-accent); }

/* 测试信息卡片：字段复用 ParamsCard（headless），页内固定两列 */
.info-card { margin-top: 16px; padding: 12px 14px; border: 1px solid var(--cn-accent-line); border-radius: var(--cn-r-2); background: var(--cn-accent-soft); }
.i-head { display: flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 600; color: var(--cn-fg); }
.i-head .req { color: var(--cn-danger); margin-left: 1px; }
.i-note { font-weight: 450; font-size: 11px; color: var(--cn-muted); }
.i-body { margin-top: 10px; }
.i-body :deep(.body) { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; }
.i-body :deep(.body .param-note) { grid-column: 1 / -1; }
@media (max-width: 640px) {
  .i-body :deep(.body) { grid-template-columns: 1fr; }
}
/* 缺参引导：红框脉冲两拍（与删除确认同危险色） */
.info-card.miss { animation: info-pulse 0.85s var(--cn-ease-out) 2; }
@keyframes info-pulse {
  0%, 100% { border-color: var(--cn-accent-line); box-shadow: none; }
  50% { border-color: var(--cn-danger); box-shadow: 0 0 0 3px var(--cn-danger-soft, rgba(214, 69, 69, 0.18)); }
}
.a-x {
  display: inline-flex; align-items: center; justify-content: center; flex: none; width: 20px; height: 20px; margin: 0 3px;
  border: 0; border-radius: var(--cn-r-1); background: none; color: var(--cn-subtle); cursor: pointer;
  opacity: 0.55; transition: opacity var(--cn-dur-1) var(--cn-ease-out), color var(--cn-dur-1) var(--cn-ease-out), background var(--cn-dur-1) var(--cn-ease-out);
}
.a-item:hover .a-x { opacity: 1; }
.a-x:focus-visible { opacity: 1; }
.a-x:hover { color: var(--cn-danger); background: var(--cn-danger-soft, rgba(214, 69, 69, 0.1)); }
.a-x.armed { color: var(--cn-danger); background: var(--cn-danger-soft, rgba(214, 69, 69, 0.18)); }

.drop {
  min-height: 150px; margin-top: 12px; padding: 22px;
  display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 8px;
  text-align: center;
  border: 1px dashed var(--cn-accent-line); border-radius: var(--cn-r-3);
  background: rgba(255, 255, 255, 0.62);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.4);
  cursor: pointer;
  transition: transform var(--cn-dur-2) var(--cn-ease-out), border-color var(--cn-dur-2) var(--cn-ease-out), background var(--cn-dur-2) var(--cn-ease-out);
}
.v-theme--dark .drop { background: rgba(14, 29, 47, 0.55); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03); }
.drop:hover, .drop.over { transform: translateY(-2px); border-color: var(--cn-accent); background: var(--cn-accent-soft); }
.drop.parsing { cursor: default; transform: none; }
.dt { margin-top: 4px; font-size: 14px; font-weight: 650; color: var(--cn-fg); }
.dc { font-size: 11.5px; color: var(--cn-muted); line-height: 1.6; max-width: 620px; }
.dn { font-size: 11.5px; color: var(--cn-muted); }
.dn b { color: var(--cn-fg-soft); }
.dn.big { color: var(--cn-warning); font-weight: 550; }
.bar { width: min(420px, 100%); height: 5px; border-radius: 3px; background: var(--cn-border); overflow: hidden; margin-top: 6px; }
.bar i { display: block; height: 100%; width: 0; background: var(--cn-accent); border-radius: inherit; transition: width 0.9s var(--cn-ease-standard); }
.re-pick { display: inline-flex; align-items: center; gap: 4px; margin-top: 4px; border: 0; background: none; color: var(--cn-accent); font-size: 11.5px; cursor: pointer; }
.re-pick:hover { text-decoration: underline; }

.projects { margin-top: 16px; }
.p-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; padding: 0 2px; }
.p-title { font-size: 12px; font-weight: 650; color: var(--cn-fg-soft); }
.p-list { background: var(--cn-surface); border: 1px solid var(--cn-border); border-radius: var(--cn-r-3); box-shadow: var(--cn-shadow-1); overflow: hidden; }
.p-row { display: flex; align-items: center; gap: 11px; padding: 10px 14px; transition: background var(--cn-dur-1) var(--cn-ease-out); }
.p-row:hover { background: var(--cn-surface-soft); }
.p-row + .p-row { border-top: 1px solid var(--cn-border); }
.p-icon { color: var(--cn-accent); flex: none; }
.p-main { flex: 1; min-width: 0; }
.p-name { font-size: 12.5px; font-weight: 600; color: var(--cn-fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.p-meta { margin-top: 2px; font-size: 11px; color: var(--cn-subtle); font-variant-numeric: tabular-nums; }
.p-nosource { color: var(--cn-subtle); opacity: 0.7; }
.p-acts { display: flex; align-items: center; gap: 2px; flex: none; }
.p-del { min-width: 74px; }

.result { margin-top: 14px; display: flex; flex-direction: column; gap: 10px; }
.ok-alert { font-size: 12.5px; text-align: left; }
.row-alert { font-size: 12.5px; }
.iss-text { flex: 1; text-align: left; }
.cta { display: flex; justify-content: flex-start; margin-top: 4px; }
.foot { margin-top: 18px; text-align: center; color: var(--cn-subtle); font-family: var(--cn-font-mono); font-size: 10px; letter-spacing: 0.03em; }

@keyframes rise {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .hero { animation: none; }
  .drop, .bar i { transition: none; }
  .info-card.miss { animation: none; border-color: var(--cn-danger); }
}
</style>
