<script setup lang="ts">
import { computed } from 'vue'
import { store, goCase, showToast, scheduleSave, activeSuspects } from '../store.ts'
import TreeNav from '../components/TreeNav.vue'
import ParamsCard from '../components/ParamsCard.vue'
import CasePanel from '../components/CasePanel.vue'

const reviewedCount = computed(() => store.cases.filter(c => c.reviewed).length)
const suspectTotal = computed(() => store.cases.reduce((n, c) => n + activeSuspects(c), 0))
const errorCount = computed(() => store.issues.filter(i => i.level === 'error').length)

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
          <span class="sus" :class="{ zero: suspectTotal === 0 }" :title="suspectTotal > 0 ? '还有切分可疑步骤待确认' : '切分可疑已全部处理'">
            <v-icon size="12">mdi-alert-circle-outline</v-icon>
            可疑 {{ suspectTotal }}
          </span>
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
  height: calc(100vh - 64px); height: calc(100dvh - 64px); /* 64 = v-app-bar 默认高度 */
}
.s2 {
  flex: 1; min-height: 0; overflow: hidden;
  display: flex; gap: 18px; max-width: 1360px; width: 100%;
  margin: 0 auto; padding: 18px 20px 12px;
}
.left {
  width: 380px; flex: none;
  display: flex; flex-direction: column; min-height: 0;
  background: rgb(var(--v-theme-surface)); border: 1px solid rgba(var(--v-theme-outline), 0.5);
  border-radius: 18px; overflow: hidden;
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
  color: rgb(var(--v-theme-warning)); background: rgba(var(--v-theme-warning), 0.14);
  border-radius: 999px; padding: 1px 10px; cursor: default;
}
.prog .txt .sus.zero { color: rgb(var(--v-theme-success)); background: rgba(var(--v-theme-success), 0.13); }
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
