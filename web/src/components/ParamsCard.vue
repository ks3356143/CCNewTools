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
    <!-- grid-template-rows 0fr/1fr 过渡（2026-10-02 用户反馈"展开卡顿一下"）：
         v-show 的 display:none→block 瞬间要整棵子树重排（7 个 outlined 输入框是大户），
         首帧顿挫；grid 方案内容常驻、无 display 切换，布局引擎一次插值，顺滑 -->
    <div class="body-wrap" :class="{ closed: !open }">
      <div class="body-clip">
        <div class="body">
          <v-text-field
            v-model="store.params.configName"
            label="软件配置项名称"
            placeholder="如：XX星指令生成与发控软件配置项"
            variant="outlined" density="compact" hide-details persistent-placeholder class="f wide"
            @update:model-value="onInput"
          />
          <div class="grid2">
            <v-text-field v-model="store.params.init" label="用例初始化" variant="outlined" density="compact" hide-details persistent-placeholder @update:model-value="onInput" />
            <v-text-field v-model="store.params.constraint" label="前提和约束" variant="outlined" density="compact" hide-details persistent-placeholder @update:model-value="onInput" />
          </div>
          <div class="grid4">
            <v-text-field v-model="store.params.designer" label="设计人员" variant="outlined" density="compact" hide-details persistent-placeholder @update:model-value="onInput" />
            <v-text-field v-model="store.params.testTime" label="测试时间" type="date" variant="outlined" density="compact" hide-details persistent-placeholder @update:model-value="onInput" />
            <v-text-field v-model="store.params.tester" label="测试人员 *" placeholder="必填" variant="outlined" density="compact" hide-details persistent-placeholder @update:model-value="onInput" />
            <v-text-field v-model="store.params.monitor" label="监测人员 *" placeholder="必填" variant="outlined" density="compact" hide-details persistent-placeholder @update:model-value="onInput" />
          </div>
        </div>
      </div>
    </div>
  </v-card>
</template>

<style scoped>
.head { display: flex; align-items: center; gap: 10px; padding: 14px 18px; cursor: pointer; user-select: none; }
.head .t { font-size: 15px; font-weight: 600; }
.head .sub { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.55); }
.chev { margin-left: auto; transition: transform 0.24s cubic-bezier(0.4, 0, 0.2, 1); }
.chev.closed { transform: rotate(180deg); }
/* grid 0fr/1fr 折叠（见模板注释）：body-clip 裁切层无 padding 保证收起归零，body 的
   padding/border 在内层被裁掉；visibility 过渡与行高同步，收起后 Tab 不可达 */
.body-wrap { display: grid; grid-template-rows: 1fr; transition: grid-template-rows 0.26s cubic-bezier(0.4, 0, 0.2, 1); }
.body-wrap.closed { grid-template-rows: 0fr; }
.body-clip { overflow: hidden; min-height: 0; }
.body { padding: 14px 18px 16px; border-top: 1px solid rgba(var(--v-theme-outline), 0.35); visibility: visible; transition: visibility 0.26s; }
.body-wrap.closed .body { visibility: hidden; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; margin-top: 12px; }
.grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px 16px; margin-top: 12px; }
@media (max-width: 960px) { .grid2, .grid4 { grid-template-columns: 1fr; } }
/* 永久浮起 label（Material persistent label，2026-10-09 内网实测"字体显大突兀"）：
   Vuetify outlined 空值时 label 以 16px 大字停在框内（超长 label 更甚），有值才浮成
   12px——同卡 7 框两种形态并存很突兀。显示切换是纯 visibility，这里统一强制浮起态：
   label 恒为边框缺口上的 12px 小字，空值框内只显示灰色 placeholder */
.body :deep(.v-field-label:not(.v-field-label--floating)) { visibility: hidden; }
.body :deep(.v-field-label--floating) { visibility: visible; }
</style>
