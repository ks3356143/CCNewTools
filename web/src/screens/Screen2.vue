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
  <div class="s2">
    <aside class="left">
      <TreeNav />
    </aside>
    <section class="main">
      <ParamsCard />
      <CasePanel />
      <div class="pad" />
    </section>
    </div>

    <div class="actionbar">
      <div class="prog">
        <div class="txt">
          <span>核对进度</span>
          <b>{{ reviewedCount }} / {{ store.cases.length }}</b>
          <button type="button" class="sus" :class="{ zero: suspectTotal === 0 }" :title="suspectTotal > 0 ? '还有 ' + suspectTotal + ' 处切分可疑待确认，点击逐条跳转' : '切分可疑已全部处理'" @click="jumpSuspect">
            <v-icon size="12">mdi-alert-circle-outline</v-icon>
            可疑 {{ suspectTotal }}
          </button>
          <v-menu v-if="warnCount > 0" location="top start" origin="bottom start" :close-on-content-click="false">
            <template #activator="{ props: menuProps }">
              <button type="button" class="sus warn" v-bind="menuProps" :title="warnCount + ' 条解析告警（标题悬空、标识不一致等），点击查看'">
                <v-icon size="12">mdi-alert-outline</v-icon>
                告警 {{ warnCount }}
              </button>
            </template>
            <v-card rounded="10" elevation="8" class="isslist">
              <div v-for="(w, i) in warningList" :key="i" class="iss-row">
                <span class="iss-tag">{{ w.context ? '【' + w.context + '】' : '' }}</span>
                <span>{{ w.message }}</span>
              </div>
            </v-card>
          </v-menu>
        </div>
        <div class="bar"><i :class="{ done: store.cases.length > 0 && reviewedCount === store.cases.length }" :style="{ width: (store.cases.length ? (reviewedCount / store.cases.length) * 100 : 0) + '%' }" /></div>
      </div>
      <v-btn size="small" rounded="pill" variant="tonal" :disabled="store.currentIdx === 0" @click="prev">
        <v-icon size="15" class="mr-1">mdi-arrow-left</v-icon>上一条
      </v-btn>
      <v-btn size="small" rounded="pill" variant="tonal" :disabled="store.currentIdx >= store.cases.length - 1" @click="next">
        下一条<v-icon size="15" class="ml-1">mdi-arrow-right</v-icon>
      </v-btn>
      <v-btn size="small" rounded="pill" variant="tonal" @click="markAllReviewed">
        <v-icon size="15" class="mr-1">mdi-check-all</v-icon>全部已核对
      </v-btn>
      <div class="grow" />
      <v-btn rounded="pill" color="primary" elevation="1" @click="gen">
        <v-icon size="16" class="mr-1">mdi-file-word-box</v-icon>生成文档
        <span v-if="errorCount > 0" class="err-dot" :title="errorCount + ' 条错误未处理'" />
      </v-btn>
    </div>
  </div>
</template>
<style scoped>
/* 应用壳布局（2026-10-01 用户反馈）：页面整体不滚，右列独立滚动，左树固定不动；
   操作栏随排版落在最底（不再悬浮盖内容），不留大块空窗 */
.screen {
  display: flex; flex-direction: column;
  /* 必须单 100vh 声明：CSS 压缩器会把"先 vh 后 dvh"的双声明回退合并成只留 dvh（2026-10-10
     Edge 100 实测 bug）——Chromium <108 不认 dvh，整条声明被丢 → .screen 失高 → 整页滚动。
     内网桌面浏览器无动态视口（dvh 是给移动端地址栏伸缩的），100vh 足够 */
  height: calc(100vh - 64px); /* 64 = v-app-bar 默认高度 */
}
.s2 {
  flex: 1; min-height: 0; overflow: hidden;
  display: flex; gap: 18px; width: 100%;
  margin: 0 auto; padding: 18px 20px 12px;
}
.left {
  width: 500px; flex: none;
  display: flex; flex-direction: column; min-height: 0;
  background: rgb(var(--v-theme-surface)); border: 1px solid rgba(var(--v-theme-outline), 0.5);
  border-radius: 14px; overflow: hidden; box-shadow: 0 1px 2px rgba(16, 24, 40, 0.05);
}
.main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 16px; overflow-y: auto; padding-bottom: 8px; padding-right: 12px; }
/* 纵向 flex 里子项默认会被压缩（全局参数卡片被裁掉半截的根因），一律按自然高度排 */
.main > * { flex: none; }
.pad { height: 8px; }
.actionbar {
  flex: none; border-top: 1px solid rgba(var(--v-theme-outline), 0.4);
  background: rgb(var(--v-theme-surface));
  display: flex; align-items: center; gap: 12px; padding: 11px 22px;
}
.prog { flex: 1; max-width: 300px; }
.prog .txt { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.6); margin-bottom: 6px; }
.prog .txt b {
  color: rgb(var(--v-theme-primary)); font-weight: 650; font-variant-numeric: tabular-nums;
  background: rgba(var(--v-theme-primary), 0.12); border-radius: 999px; padding: 1px 10px;
}
.prog .txt .sus {
  display: inline-flex; align-items: center; gap: 3px;
  color: rgb(var(--v-theme-error)); background: rgba(var(--v-theme-error), 0.12);
  border: none; font: inherit; cursor: pointer;
  border-radius: 999px; padding: 1px 10px;
}
.prog .txt .sus.zero { color: rgb(var(--v-theme-success)); background: rgba(var(--v-theme-success), 0.13); cursor: default; }
.prog .txt .sus.warn { color: rgb(var(--v-theme-warning)); background: rgba(var(--v-theme-warning), 0.14); }
/* 告警胶囊的弹出清单（重开项目路径的问题可见性，2026-10-01）；容器改 v-card（2026-10-02 组件化） */
.isslist {
  max-width: 560px; max-height: 320px; overflow-y: auto;
  color: rgba(var(--v-theme-on-surface), 0.85);
  padding: 6px 4px; font-size: 12.5px; line-height: 1.6;
}
.iss-row { display: flex; gap: 6px; padding: 4px 10px; text-align: left; align-items: flex-start; }
.iss-row + .iss-row { border-top: 1px solid rgba(var(--v-theme-outline), 0.25); }
.iss-tag { color: rgb(var(--v-theme-warning)); flex: none; font-weight: 550; }
.bar { height: 6px; border-radius: 999px; background: rgba(var(--v-theme-outline), 0.5); overflow: hidden; }
.bar i { display: block; height: 100%; border-radius: inherit; background: rgb(var(--v-theme-primary)); transition: width 0.3s; }
.bar i.done { background: rgb(var(--v-theme-success)); }
.grow { flex: 1; }
.err-dot { width: 8px; height: 8px; border-radius: 50%; background: rgb(var(--v-theme-error)); margin-left: 6px; }
@media (max-width: 960px) {
  .screen { height: auto; padding-bottom: 64px; }
  .s2 { flex-direction: column; overflow: visible; }
  .left { width: 100%; height: 320px; }
  .actionbar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 10; }
}
</style>
