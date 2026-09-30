<script setup lang="ts">
import { computed } from 'vue'
import { store, goCase, showToast } from '../store.ts'
import TreeNav from '../components/TreeNav.vue'
import ParamsCard from '../components/ParamsCard.vue'
import CasePanel from '../components/CasePanel.vue'

const reviewedCount = computed(() => store.cases.filter(c => c.reviewed).length)
const errorCount = computed(() => store.issues.filter(i => i.level === 'error').length)

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
  <div class="s2">
    <aside class="left">
      <TreeNav />
    </aside>
    <section class="main">
      <ParamsCard />
      <CasePanel />
      <div class="pad" />
    </section>

    <div class="actionbar">
      <div class="prog">
        <div class="txt"><span>核对进度</span><b>{{ reviewedCount }} / {{ store.cases.length }}</b></div>
        <div class="bar"><i :class="{ done: store.cases.length > 0 && reviewedCount === store.cases.length }" :style="{ width: (store.cases.length ? (reviewedCount / store.cases.length) * 100 : 0) + '%' }" /></div>
      </div>
      <v-btn size="small" rounded="pill" variant="tonal" :disabled="store.currentIdx === 0" @click="prev">
        <v-icon size="15" class="mr-1">mdi-arrow-left</v-icon>上一条
      </v-btn>
      <v-btn size="small" rounded="pill" variant="tonal" :disabled="store.currentIdx >= store.cases.length - 1" @click="next">
        下一条<v-icon size="15" class="ml-1">mdi-arrow-right</v-icon>
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
.s2 { display: flex; align-items: flex-start; max-width: 1360px; margin: 0 auto; padding: 18px 20px 110px; gap: 18px; }
.left {
  width: 336px; flex: none; position: sticky; top: 74px; max-height: calc(100vh - 150px);
  display: flex; flex-direction: column;
  background: rgb(var(--v-theme-surface)); border: 1px solid rgba(var(--v-theme-outline), 0.5);
  border-radius: 18px; overflow: hidden;
}
.main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 16px; }
.pad { height: 8px; }
.actionbar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 10;
  background: color-mix(in srgb, rgb(var(--v-theme-surface)) 88%, transparent);
  backdrop-filter: blur(10px); border-top: 1px solid rgba(var(--v-theme-outline), 0.4);
}
.actionbar > * { flex: none; }
.actionbar {
  display: flex; align-items: center; gap: 12px; padding: 11px 22px;
}
.prog { flex: 1; max-width: 300px; }
.prog .txt { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.6); margin-bottom: 6px; }
.prog .txt b {
  color: rgb(var(--v-theme-primary)); font-weight: 650; font-variant-numeric: tabular-nums;
  background: rgba(var(--v-theme-primary), 0.12); border-radius: 999px; padding: 1px 10px;
}
.bar { height: 6px; border-radius: 999px; background: rgba(var(--v-theme-outline), 0.5); overflow: hidden; }
.bar i { display: block; height: 100%; border-radius: inherit; background: rgb(var(--v-theme-primary)); transition: width 0.3s; }
.bar i.done { background: rgb(var(--v-theme-success)); }
.grow { flex: 1; }
.err-dot { width: 8px; height: 8px; border-radius: 50%; background: rgb(var(--v-theme-error)); margin-left: 6px; }
@media (max-width: 960px) {
  .s2 { flex-direction: column; }
  .left { width: 100%; position: static; max-height: 300px; }
}
</style>
