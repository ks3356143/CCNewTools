<script setup lang="ts">
import { ref } from 'vue'
import { store, scheduleSettingsSave } from '../store.ts'

const open = ref(true)
const fields = [
  { key: 'init', label: '用例初始化' },
  { key: 'constraint', label: '前提和约束' }
] as const
const fields4 = [
  { key: 'designer', label: '设计人员' },
  { key: 'testTime', label: '测试时间', type: 'date' },
  { key: 'tester', label: '测试人员', required: true },
  { key: 'monitor', label: '监测人员', required: true }
] as const

function onInput(): void {
  scheduleSettingsSave()
}
</script>

<template>
  <v-card rounded="lg" elevation="1">
    <div class="head" @click="open = !open">
      <span class="t">全局参数</span>
      <span class="sub">对所有用例生效，正式版会记住上次填写内容</span>
      <v-icon class="chev" :class="{ closed: !open }">mdi-chevron-down</v-icon>
    </div>
    <div v-show="open" class="body">
      <div class="grid2">
        <div class="f"><label>用例初始化</label><input :value="store.params.init" @input="store.params.init = ($event.target as HTMLInputElement).value; onInput()" /></div>
        <div class="f"><label>前提和约束</label><input :value="store.params.constraint" @input="store.params.constraint = ($event.target as HTMLInputElement).value; onInput()" /></div>
      </div>
      <div class="grid4">
        <div class="f"><label>设计人员</label><input :value="store.params.designer" @input="store.params.designer = ($event.target as HTMLInputElement).value; onInput()" /></div>
        <div class="f"><label>测试时间</label><input type="date" :value="store.params.testTime" @input="store.params.testTime = ($event.target as HTMLInputElement).value; onInput()" /></div>
        <div class="f"><label>测试人员</label><input :value="store.params.tester" placeholder="必填" @input="store.params.tester = ($event.target as HTMLInputElement).value; onInput()" /></div>
        <div class="f"><label>监测人员</label><input :value="store.params.monitor" placeholder="必填" @input="store.params.monitor = ($event.target as HTMLInputElement).value; onInput()" /></div>
      </div>
    </div>
  </v-card>
</template>

<style scoped>
.head { display: flex; align-items: center; gap: 10px; padding: 14px 18px; cursor: pointer; user-select: none; }
.head .t { font-size: 15px; font-weight: 600; }
.head .sub { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.55); }
.chev { margin-left: auto; transition: transform 0.18s; }
.chev.closed { transform: rotate(180deg); }
.body { padding: 2px 18px 16px; border-top: 1px solid rgba(var(--v-theme-outline), 0.35); padding-top: 14px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; }
.grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px 16px; margin-top: 12px; }
.f label { display: block; font-size: 12px; font-weight: 550; color: rgba(var(--v-theme-on-surface), 0.6); margin-bottom: 5px; }
.f input {
  width: 100%; height: 38px; padding: 0 12px; font: inherit; font-size: 13.5px;
  border: 1px solid rgba(var(--v-theme-outline), 0.9); border-radius: 8px;
  background: rgb(var(--v-theme-surface)); color: rgb(var(--v-theme-on-surface));
}
.f input:focus { border-color: rgb(var(--v-theme-primary)); outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: -1px; }
@media (max-width: 960px) { .grid2, .grid4 { grid-template-columns: 1fr; } }
</style>
