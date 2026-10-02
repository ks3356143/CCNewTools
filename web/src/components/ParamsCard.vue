<script setup lang="ts">
import { ref } from 'vue'
import { store, scheduleSettingsSave } from '../store.ts'

const open = ref(true)

function onInput(): void {
  scheduleSettingsSave()
}
</script>

<template>
  <v-card rounded="14" elevation="1">
    <div class="head" @click="open = !open">
      <span class="t">全局参数</span>
      <span class="sub">对所有用例生效，正式版会记住上次填写内容</span>
      <v-icon class="chev" :class="{ closed: !open }">mdi-chevron-down</v-icon>
    </div>
    <v-expand-transition>
      <div v-show="open" class="body">
        <v-text-field
          v-model="store.params.configName"
          label='软件配置项名称（"测试说明"、"需求追踪表"章标题使用）'
          placeholder="如：BCD星指令生成与发控软件配置项"
          variant="outlined" density="compact" hide-details class="f wide"
          @update:model-value="onInput"
        />
        <div class="grid2">
          <v-text-field v-model="store.params.init" label="用例初始化" variant="outlined" density="compact" hide-details @update:model-value="onInput" />
          <v-text-field v-model="store.params.constraint" label="前提和约束" variant="outlined" density="compact" hide-details @update:model-value="onInput" />
        </div>
        <div class="grid4">
          <v-text-field v-model="store.params.designer" label="设计人员" variant="outlined" density="compact" hide-details @update:model-value="onInput" />
          <v-text-field v-model="store.params.testTime" label="测试时间" type="date" variant="outlined" density="compact" hide-details @update:model-value="onInput" />
          <v-text-field v-model="store.params.tester" label="测试人员 *" placeholder="必填" variant="outlined" density="compact" hide-details @update:model-value="onInput" />
          <v-text-field v-model="store.params.monitor" label="监测人员 *" placeholder="必填" variant="outlined" density="compact" hide-details @update:model-value="onInput" />
        </div>
      </div>
    </v-expand-transition>
  </v-card>
</template>

<style scoped>
.head { display: flex; align-items: center; gap: 10px; padding: 14px 18px; cursor: pointer; user-select: none; }
.head .t { font-size: 15px; font-weight: 600; }
.head .sub { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.55); }
.chev { margin-left: auto; transition: transform 0.18s; }
.chev.closed { transform: rotate(180deg); }
.body { padding: 14px 18px 16px; border-top: 1px solid rgba(var(--v-theme-outline), 0.35); }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; margin-top: 12px; }
.grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px 16px; margin-top: 12px; }
@media (max-width: 960px) { .grid2, .grid4 { grid-template-columns: 1fr; } }
</style>
