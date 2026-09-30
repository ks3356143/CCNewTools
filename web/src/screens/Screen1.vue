<script setup lang="ts">
import { ref, useTemplateRef } from 'vue'
import { store, doParse, activeSuspects } from '../store.ts'
import type { Issue } from '../types.ts'

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

function issueIcon(level: Issue['level']): string {
  return level === 'error' ? 'mdi-close-circle' : level === 'warning' ? 'mdi-alert' : 'mdi-information'
}
function issueColor(level: Issue['level']): string {
  return level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'info'
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

    <template v-if="phase === 'done'">
      <div class="result">
        <div class="alert ok">
          <v-icon size="19">mdi-check-circle</v-icon>
          <span>
            解析完成，共 <b>{{ store.stats.items }}</b> 个测试项、<b>{{ store.stats.cases }}</b> 个测试用例、<b>{{ store.stats.steps }}</b> 个测试步骤{{ issueCounts() }}
            <span v-if="store.restored.cases > 0">；已恢复上次编辑 {{ store.restored.cases }} 处</span>
          </span>
        </div>
        <button v-for="(iss, i) in store.issues" :key="i" class="alert row-alert" :class="iss.level" @click="jumpTo(iss)">
          <v-icon size="17">{{ issueIcon(iss.level) }}</v-icon>
          <span class="iss-text">{{ iss.context ? '【' + iss.context + '】' : '' }}{{ iss.message }}</span>
          <v-icon size="14" class="go">mdi-chevron-right</v-icon>
        </button>

        <div class="band">
          <div class="stat"><b>{{ store.stats.items }}</b><span>测试项</span></div>
          <div class="stat"><b>{{ store.stats.cases }}</b><span>测试用例</span></div>
          <div class="stat"><b>{{ store.stats.steps }}</b><span>测试步骤</span></div>
          <div class="stat"><b>{{ store.cases.reduce((n, c) => n + activeSuspects(c), 0) }}</b><span>切分可疑待核对</span></div>
        </div>

        <div class="cta">
          <v-btn color="primary" rounded="pill" size="large" @click="store.screen = 2">开始核对与编辑</v-btn>
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
  width: 68px; height: 68px; border-radius: 21px; margin: 0 auto 18px;
  background: rgba(var(--v-theme-primary), 0.14); color: rgb(var(--v-theme-primary));
  display: flex; align-items: center; justify-content: center;
}
h1 { font-size: 23px; font-weight: 650; }
p { margin-top: 9px; color: rgba(var(--v-theme-on-surface), 0.65); font-size: 14px; }
.drop {
  margin-top: 24px; padding: 42px 28px; border-radius: 20px; text-align: center;
  border: 1.6px dashed rgba(var(--v-theme-outline), 1); background: rgb(var(--v-theme-surface));
  cursor: pointer; transition: border-color 0.2s, background 0.2s;
}
.drop:hover, .drop.over { border-color: rgb(var(--v-theme-primary)); background: rgba(var(--v-theme-primary), 0.06); }
.drop.parsing { cursor: default; }
.dt { margin-top: 12px; font-size: 15.5px; font-weight: 550; }
.dc { margin-top: 5px; font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.6); }
.dn { margin-top: 13px; font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.65); }
.dn b { color: rgb(var(--v-theme-on-surface)); }
.bar { height: 5px; border-radius: 999px; background: rgba(var(--v-theme-outline), 0.5); overflow: hidden; margin-top: 18px; }
.bar i { display: block; height: 100%; width: 0; background: rgb(var(--v-theme-primary)); border-radius: inherit; transition: width 0.9s cubic-bezier(0.3, 0.6, 0.4, 1); }

.result { margin-top: 20px; display: flex; flex-direction: column; gap: 10px; }
.alert {
  display: flex; align-items: flex-start; gap: 11px; padding: 12px 16px; border-radius: 13px;
  font-size: 13.5px; text-align: left; width: 100%;
}
.alert b { font-weight: 650; }
.alert.ok { background: rgba(var(--v-theme-success), 0.13); color: rgb(var(--v-theme-success)); }
.row-alert { background: rgb(var(--v-theme-surface)); border: 1px solid rgba(var(--v-theme-outline), 0.6); color: rgb(var(--v-theme-on-surface)); cursor: pointer; }
.row-alert:hover { border-color: rgb(var(--v-theme-primary)); }
.row-alert.error { color: rgb(var(--v-theme-error)); }
.row-alert.warning { color: rgb(var(--v-theme-warning)); }
.row-alert.info { color: rgba(var(--v-theme-on-surface), 0.75); }
.iss-text { flex: 1; }
.go { opacity: 0.4; flex: none; align-self: center; }

.band { display: flex; background: rgb(var(--v-theme-surface)); border: 1px solid rgba(var(--v-theme-outline), 0.6); border-radius: 13px; overflow: hidden; }
.stat { flex: 1; padding: 15px 8px 13px; text-align: center; }
.stat + .stat { border-left: 1px solid rgba(var(--v-theme-outline), 0.5); }
.stat b { display: block; font-size: 28px; font-weight: 650; font-variant-numeric: tabular-nums; }
.stat span { display: block; font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.6); margin-top: 2px; }
.cta { display: flex; justify-content: center; margin-top: 18px; }
.foot { text-align: center; font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 20px; }
</style>
