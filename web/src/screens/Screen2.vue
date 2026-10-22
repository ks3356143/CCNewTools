<script setup lang="ts">
import { computed, nextTick } from 'vue'
import { store, goCase, showToast, scheduleSave } from '../store.ts'
import { activeSuspects, stepSuspectActive } from '../suspect.ts'
import TreeNav from '../components/TreeNav.vue'
import ParamsCard from '../components/ParamsCard.vue'
import CasePanel from '../components/CasePanel.vue'

const reviewedCount = computed(() => store.cases.filter(c => c.reviewed).length)
const suspectTotal = computed(() => store.cases.reduce((n, c) => n + activeSuspects(c), 0))
const errorCount = computed(() => store.issues.filter(i => i.level === 'error').length)
/** 解析告警（悬空标题、标识不一致等）：重开项目直接进第二屏，第一屏问题清单看不到，这里兜底可见 */
const warnCount = computed(() => store.issues.filter(i => i.level === 'warning').length)
const warningList = computed(() => store.issues.filter(i => i.level === 'warning'))

async function jumpSuspect(): Promise<void> {
  const list: number[] = []
  store.cases.forEach((c, i) => { if (activeSuspects(c) > 0) list.push(i) })
  if (list.length === 0) return
  const pos = list.indexOf(store.currentIdx)
  goCase(list[(pos + 1) % list.length])
  await nextTick()
  // 闪烁走 Vue 状态（store.suspectFlash），行重渲染不会把 class 抹掉
  const row = store.cases[store.currentIdx]
  const fi = row.steps.findIndex(s => stepSuspectActive(row, s))
  if (fi >= 0) {
    store.suspectFlash = fi
    setTimeout(() => { if (store.suspectFlash === fi) store.suspectFlash = null }, 1600)
  }
  document.querySelector('.main tr.suspect')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

function markAllReviewed(): void {
  for (const c of store.cases) {
    if (!c.excluded) c.reviewed = true
  }
  scheduleSave()
  showToast('已将全部用例标记为已核对')
}

function prev(): void {
  if (store.currentIdx > 0) goCase(store.currentIdx - 1)
}
function next(): void {
  if (store.currentIdx < store.cases.length - 1) goCase(store.currentIdx + 1)
  else showToast('已是最后一个用例')
}
function gen(): void {
  if (!store.params.tester.trim() || !store.params.monitor.trim()) {
    showToast('请先填写测试人员与监测人员')
    return
  }
  store.screen = 3
}

</script>

<template>
  <div class="screen">
    <!-- 状态带：标题 + 计数 + 进度（v2 设计稿：进度上移到头部，底部只留操作） -->
    <div class="verify-head">
      <div class="vtitle">
        <div class="kicker">STEP 02 · 核对与编辑</div>
        <h2>核对测试用例</h2>
        <p class="meta">{{ store.outline.name || '未命名大纲' }} · 修改自动保存 · 共 {{ store.cases.length }} 条用例</p>
      </div>
      <div class="summary">
        <button type="button" class="sus" :class="{ zero: suspectTotal === 0 }" :title="suspectTotal > 0 ? '还有 ' + suspectTotal + ' 处切分可疑待确认，点击逐条跳转' : '切分可疑已全部处理'" @click="jumpSuspect">
          <v-icon size="12">mdi-alert-circle-outline</v-icon>
          可疑 {{ suspectTotal }}
        </button>
        <v-menu v-if="warnCount > 0" location="bottom start" origin="top start" :close-on-content-click="false">
          <template #activator="{ props: menuProps }">
            <button type="button" class="sus warn" v-bind="menuProps" :title="warnCount + ' 条解析告警（标题悬空、标识不一致等），点击查看'">
              <v-icon size="12">mdi-alert-outline</v-icon>
              告警 {{ warnCount }}
            </button>
          </template>
          <v-card rounded="8" elevation="8" class="isslist">
            <div v-for="(w, i) in warningList" :key="i" class="iss-row">
              <span class="iss-tag">{{ w.context ? '【' + w.context + '】' : '' }}</span>
              <span>{{ w.message }}</span>
            </div>
          </v-card>
        </v-menu>
      </div>
      <div class="progress-wrap">
        <div class="progress-labels">
          <span>核对进度</span>
          <span class="u-mono">{{ reviewedCount }} / {{ store.cases.length }}</span>
        </div>
        <div class="progress-track"><i :class="{ done: store.cases.length > 0 && reviewedCount === store.cases.length }" :style="{ width: (store.cases.length ? (reviewedCount / store.cases.length) * 100 : 0) + '%' }" /></div>
      </div>
    </div>

    <!-- 三栏工作区：目录 / 编辑 / 参数（数据区实色，装饰只在背景） -->
    <div class="verify-content">
      <aside class="verify-sidebar">
        <TreeNav />
      </aside>
      <section class="main verify-editor">
        <CasePanel />
        <div class="pad" />
      </section>
      <aside class="verify-params">
        <ParamsCard />
      </aside>
    </div>

    <!-- 固定操作栏 -->
    <div class="actionbar">
      <v-btn size="small" variant="tonal" :disabled="store.currentIdx === 0" @click="prev">
        <v-icon size="14" class="mr-1">mdi-arrow-left</v-icon>上一条
      </v-btn>
      <v-btn size="small" variant="tonal" :disabled="store.currentIdx >= store.cases.length - 1" @click="next">
        下一条<v-icon size="14" class="ml-1">mdi-arrow-right</v-icon>
      </v-btn>
      <v-btn size="small" variant="tonal" @click="markAllReviewed">
        <v-icon size="14" class="mr-1">mdi-check-all</v-icon>全部已核对
      </v-btn>
      <div class="grow" />
      <span class="save-hint">修改自动保存</span>
      <v-btn color="primary" @click="gen">
        <v-icon size="16" class="mr-1">mdi-file-word-box</v-icon>生成文档
        <span v-if="errorCount > 0" class="err-dot" :title="errorCount + ' 条错误未处理'" />
      </v-btn>
    </div>
  </div>
</template>

<style scoped>
/* 应用壳布局：页面整体不滚，右列独立滚动，左树固定不动（2026-10-01 用户反馈），
   v2 改为「头部状态带 + 三栏工作区 + 底部操作栏」。
   height 必须单 100vh 声明：CSS 压缩器会把"先 vh 后 dvh"双声明合并成只留 dvh
   （2026-10-10 Edge 100 实测）——Chromium <108 不认 dvh，整条声明被丢 → 失高 */
.screen {
  display: flex; flex-direction: column;
  height: calc(100vh - 64px);
  background-color: var(--cn-bg);
  background-image:
    radial-gradient(circle at 12% -8%, rgba(70, 151, 226, 0.12), transparent 38%),
    radial-gradient(circle at 96% 18%, rgba(55, 126, 192, 0.07), transparent 32%);
}

/* ---- 头部状态带 ---- */
.verify-head {
  flex: none;
  display: flex; align-items: center; gap: 22px;
  min-height: 76px;
  padding: 12px 24px;
  background: var(--cn-surface);
  border-bottom: 1px solid var(--cn-border);
}
.vtitle { min-width: 0; }
.kicker {
  display: inline-flex; align-items: center; gap: 7px;
  color: var(--cn-accent); font-family: var(--cn-font-mono);
  font-size: 10.5px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase;
}
.kicker::before { content: ""; width: 18px; height: 1px; background: var(--cn-accent-line); }
.vtitle h2 { margin: 4px 0 0; font-family: var(--cn-font-display); font-size: 22px; line-height: 1.3; font-weight: 650; letter-spacing: -0.02em; color: var(--cn-fg); }
.meta { margin: 3px 0 0; color: var(--cn-subtle); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.summary { display: flex; align-items: center; gap: 8px; flex: none; margin-left: auto; }
.sus {
  display: inline-flex; align-items: center; gap: 4px;
  min-height: 26px; padding: 0 9px;
  border: 1px solid transparent; border-radius: var(--cn-r-1);
  font: inherit; font-size: 12px; line-height: 18px; font-weight: 600; cursor: pointer;
  color: var(--cn-danger); background: var(--cn-danger-soft);
}
.sus.zero { color: var(--cn-success); background: var(--cn-success-soft); cursor: default; }
.sus.warn { color: var(--cn-warning); background: var(--cn-warning-soft); }
.progress-wrap { margin-left: 0; width: 200px; max-width: 30vw; flex: none; }
.progress-labels { display: flex; justify-content: space-between; margin-bottom: 5px; color: var(--cn-muted); font-size: 10.5px; }
.progress-labels .u-mono { color: var(--cn-accent); }
.progress-track { height: 6px; border-radius: 3px; background: var(--cn-border); overflow: hidden; }
.progress-track i { display: block; height: 100%; width: 0; border-radius: inherit; background: var(--cn-accent); transition: width var(--cn-dur-4) var(--cn-ease-standard); }
.progress-track i.done { background: var(--cn-success); }

/* ---- 三栏工作区 ---- */
.verify-content {
  flex: 1; min-height: 0; overflow: hidden;
  display: grid;
  grid-template-columns: 288px minmax(0, 1fr) 312px;
  grid-template-areas: "side editor params";
}
.verify-sidebar {
  grid-area: side;
  min-height: 0; display: flex; flex-direction: column;
  background: var(--cn-surface);
  border-right: 1px solid var(--cn-border);
}
.verify-editor {
  grid-area: editor;
  min-width: 0; min-height: 0;
  overflow-y: auto;
  padding: 16px 24px 0;
}
/* 纵向 flex 里子项默认会被压缩（全局参数卡片被裁掉半截的根因），一律按自然高度排 */
.main > * { flex: none; }
.pad { height: 18px; }
.verify-params {
  grid-area: params;
  min-height: 0; overflow-y: auto;
  background: var(--cn-surface);
  border-left: 1px solid var(--cn-border);
  padding: 14px 16px 20px;
}

/* ---- 底部操作栏 ---- */
.actionbar {
  flex: none;
  display: flex; align-items: center; gap: 8px;
  min-height: 64px; padding: 0 24px;
  background: var(--cn-surface);
  border-top: 1px solid var(--cn-border);
}
.grow { flex: 1; }
.save-hint { color: var(--cn-subtle); font-family: var(--cn-font-mono); font-size: 10px; letter-spacing: 0.03em; }
.err-dot { width: 7px; height: 7px; border-radius: 50%; background: rgb(var(--v-theme-on-primary, 255, 255, 255)); margin-left: 6px; }

/* ---- 告警清单弹层 ---- */
.isslist {
  max-width: 560px; max-height: 320px; overflow-y: auto;
  padding: 6px 4px; font-size: 12px; line-height: 1.6;
  color: var(--cn-fg-soft);
}
.iss-row { display: flex; gap: 6px; padding: 4px 10px; text-align: left; align-items: flex-start; }
.iss-row + .iss-row { border-top: 1px solid var(--cn-border); }
.iss-tag { color: var(--cn-warning); flex: none; font-weight: 550; }

/* ---- 窄屏：单列堆叠（参数与目录都保留，功能不丢）。
   断点 1180 而非 1000：三栏在 <1180 时编辑区不足 ~700px，步骤表头会竖排换行 */
@media (max-width: 1180px) {
  .screen { height: auto; min-height: calc(100vh - 64px); }
  .verify-head { flex-wrap: wrap; gap: 10px 16px; }
  .progress-wrap { margin-left: 0; width: 100%; max-width: none; }
  .verify-content {
    grid-template-columns: 1fr;
    grid-template-areas: "side" "editor" "params";
    overflow: visible;
    /* 吸底操作栏会盖住最后一段内容，留出同等高度 */
    padding-bottom: 72px;
  }
  /* 窄屏：目录限高可滚，编辑区优先于参数区（核心工作在前） */
  .verify-sidebar { height: auto; max-height: 340px; overflow-y: auto; border-right: 0; border-bottom: 1px solid var(--cn-border); }
  .verify-params { border-left: 0; border-top: 1px solid var(--cn-border); overflow: visible; }
  .verify-editor { overflow: visible; padding-bottom: 16px; }
  .actionbar { position: sticky; bottom: 0; z-index: 10; }
  .save-hint { display: none; }
}
</style>
