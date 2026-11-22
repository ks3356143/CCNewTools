<script setup lang="ts">
import { ref } from 'vue'
import { store, scheduleSettingsSave } from '../store.ts'

defineProps<{ headless?: boolean; narrow?: boolean; timeRange?: boolean }>()
const open = ref(true)

function onInput(): void {
  scheduleSettingsSave()
}

/** 必填警示：空值时给出错误态（设计稿 v2：危险色底 + 边框 + 行内提示），填写即熄 */
function reqEmpty(v: string | undefined): boolean {
  return !v || !v.trim()
}

/** 日期选择器（2026-11-22 换 Vuetify 成熟组件 v-menu + v-date-picker）：store 存 yyyy-mm-dd 字符串，选择器收发 Date */
const menuSingle = ref(false)
const menuStart = ref(false)
const menuEnd = ref(false)

function strToDate(s: string | undefined): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s ?? '')) return null
  const d = new Date(s + 'T00:00:00')
  return isNaN(d.getTime()) ? null : d
}

function dateToStr(v: unknown): string {
  if (!(v instanceof Date) || isNaN(v.getTime())) return ''
  return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0')
}
</script>

<template>
  <div class="pcard">
    <div v-if="!headless" class="param-head" @click="open = !open">
      <h3>全局参数</h3>
      <span class="param-count u-mono">ALL CASES</span>
      <v-icon class="chev" :class="{ closed: !open }" size="16">mdi-chevron-down</v-icon>
    </div>
    <div class="body-wrap" :class="{ closed: !open }">
      <div class="body-clip">
        <div class="body" :class="{ narrow }">
          <div v-if="!timeRange" class="param-field">
            <div class="param-label">软件配置项名称</div>
            <v-text-field
              v-model="store.params.configName"
              placeholder="如：XX星指令生成与发控软件配置项"
              variant="solo-filled" flat density="compact" hide-details
              class="param-input" @update:model-value="onInput"
            />
          </div>
          <div class="param-field">
            <div class="param-label">用例初始化</div>
            <v-text-field v-model="store.params.init" variant="solo-filled" flat density="compact" hide-details class="param-input" @update:model-value="onInput" />
          </div>
          <div class="param-field">
            <div class="param-label">前提和约束</div>
            <v-text-field v-model="store.params.constraint" variant="solo-filled" flat density="compact" hide-details class="param-input" @update:model-value="onInput" />
          </div>
          <div class="param-field">
            <div class="param-label">设计人员</div>
            <v-text-field v-model="store.params.designer" variant="solo-filled" flat density="compact" hide-details class="param-input" @update:model-value="onInput" />
          </div>
          <div v-if="!timeRange" class="param-field">
            <div class="param-label">测试时间</div>
            <v-menu v-model="menuSingle" :close-on-content-click="false" location="bottom start">
              <template #activator="{ props: menuProps }">
                <v-text-field
                  v-bind="menuProps" :model-value="store.params.testTime" readonly
                  placeholder="点击选择日期" variant="solo-filled" flat density="compact" hide-details
                  class="param-input" append-inner-icon="mdi-calendar"
                />
              </template>
              <v-date-picker
                :model-value="strToDate(store.params.testTime)"
                @update:model-value="v => { store.params.testTime = dateToStr(v); onInput(); menuSingle = false }"
                width="320"
              />
            </v-menu>
          </div>
          <!-- 回归模式（2026-11-22）：时间范围起/止必填，产物按范围在用例间自动铺开；日期用 VDatePicker 日历选择 -->
          <div v-if="timeRange" class="param-field" :class="{ err: reqEmpty(store.params.timeStart) }">
            <div class="param-label">测试时间（起） <span class="required">*</span></div>
            <v-menu v-model="menuStart" :close-on-content-click="false" location="bottom start">
              <template #activator="{ props: menuProps }">
                <v-text-field
                  v-bind="menuProps" :model-value="store.params.timeStart" readonly
                  placeholder="点击选择日期" variant="solo-filled" flat density="compact" hide-details
                  class="param-input" append-inner-icon="mdi-calendar"
                />
              </template>
              <v-date-picker
                :model-value="strToDate(store.params.timeStart)"
                @update:model-value="v => { store.params.timeStart = dateToStr(v); onInput(); menuStart = false }"
                width="320"
              />
            </v-menu>
            <div v-if="reqEmpty(store.params.timeStart)" class="param-error">
              <v-icon size="11">mdi-alert-circle-outline</v-icon>必填
            </div>
          </div>
          <div v-if="timeRange" class="param-field" :class="{ err: reqEmpty(store.params.timeEnd) }">
            <div class="param-label">测试时间（止） <span class="required">*</span></div>
            <v-menu v-model="menuEnd" :close-on-content-click="false" location="bottom start">
              <template #activator="{ props: menuProps }">
                <v-text-field
                  v-bind="menuProps" :model-value="store.params.timeEnd" readonly
                  placeholder="点击选择日期" variant="solo-filled" flat density="compact" hide-details
                  class="param-input" append-inner-icon="mdi-calendar"
                />
              </template>
              <v-date-picker
                :model-value="strToDate(store.params.timeEnd)"
                @update:model-value="v => { store.params.timeEnd = dateToStr(v); onInput(); menuEnd = false }"
                width="320"
              />
            </v-menu>
            <div v-if="reqEmpty(store.params.timeEnd)" class="param-error">
              <v-icon size="11">mdi-alert-circle-outline</v-icon>必填
            </div>
          </div>
          <div class="param-field" :class="{ err: reqEmpty(store.params.tester) }">
            <div class="param-label">测试人员 <span class="required">*</span></div>
            <v-text-field v-model="store.params.tester" placeholder="请输入" variant="solo-filled" flat density="compact" hide-details class="param-input" @update:model-value="onInput" />
            <div v-if="reqEmpty(store.params.tester)" class="param-error">
              <v-icon size="11">mdi-alert-circle-outline</v-icon>必填
            </div>
          </div>
          <div class="param-field" :class="{ err: reqEmpty(store.params.monitor) }">
            <div class="param-label">监测人员 <span class="required">*</span></div>
            <v-text-field v-model="store.params.monitor" placeholder="请输入" variant="solo-filled" flat density="compact" hide-details class="param-input" @update:model-value="onInput" />
            <div v-if="reqEmpty(store.params.monitor)" class="param-error">
              <v-icon size="11">mdi-alert-circle-outline</v-icon>必填
            </div>
          </div>
          <div class="param-note">{{ timeRange ? '两份产物共用；测试时间按起止范围在用例间自动铺开，修改自动保存。' : '对所有用例生效；正式版会记住上次填写内容，修改自动保存。' }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pcard { display: flex; flex-direction: column; }
.param-head { display: flex; align-items: center; gap: 8px; padding: 2px 2px 12px; cursor: pointer; user-select: none; }
.param-head h3 { margin: 0; font-size: 13.5px; font-weight: 650; color: var(--cn-fg); }
.param-count { color: var(--cn-subtle); font-size: 10px; letter-spacing: 0.08em; }
.chev { margin-left: auto; color: var(--cn-subtle); transition: transform var(--cn-dur-3) var(--cn-ease-standard); }
.chev.closed { transform: rotate(180deg); }

/* grid 0fr/1fr 折叠：内容常驻、无 display 切换，布局引擎一次插值（2026-10-02 实测顺滑） */
.body-wrap { display: grid; grid-template-rows: 1fr; transition: grid-template-rows var(--cn-dur-3) var(--cn-ease-standard); }
.body-wrap.closed { grid-template-rows: 0fr; }
.body-clip { overflow: hidden; min-height: 0; }
.body { visibility: visible; transition: visibility var(--cn-dur-3); }
.body-wrap.closed .body { visibility: hidden; }
/* 抽屉等窄容器：始终单列（不跟随视口断点） */
.body.narrow { display: block; }

.param-field { margin-bottom: 11px; }
.param-label {
  display: flex; align-items: center; gap: 3px;
  margin-bottom: 5px; color: var(--cn-muted); font-size: 11.5px;
}
.required { color: var(--cn-danger); font-weight: 700; }

/* 输入框：浅实底 + 细边框，聚焦由全局 token 提供强调环 */
.param-input :deep(.v-field) {
  min-height: 36px;
  border-radius: var(--cn-r-2);
  background: var(--cn-surface-soft);
  box-shadow: inset 0 0 0 1px var(--cn-control-line);
  transition: background var(--cn-dur-2) var(--cn-ease-out), box-shadow var(--cn-dur-2) var(--cn-ease-out);
}
.param-input :deep(.v-field:hover) { box-shadow: inset 0 0 0 1px var(--cn-border-strong); }
.v-theme--dark .param-input :deep(.v-field) { background: var(--cn-bg); }
/* 聚焦态：完整一圈 1.5px 强调描边（此前"内描边 + 外环"叠加在视觉上像上下两条蓝线，
   用户截图指出；去掉外环后聚焦框是干净的整圈圆角描边） */
.param-input :deep(.v-field--focused) {
  background: var(--cn-surface);
  box-shadow: inset 0 0 0 1.5px var(--cn-accent);
}
.v-theme--dark .param-input :deep(.v-field--focused) { box-shadow: inset 0 0 0 1.5px var(--cn-accent); }
.param-input :deep(.v-field__input) { font-size: 12.5px; min-height: 36px; padding-top: 0; padding-bottom: 0; }
.param-input :deep(input::placeholder) { color: var(--cn-subtle); opacity: 0.85; }

/* 必填错误态：1px 危险色描边 + #FFF9FA 极浅底 + 行内提示（v5 评审 010：
   去掉纯红填充，错误仍清晰但不比主操作抢眼） */
.err :deep(.v-field) {
  background: #fff9fa;
  box-shadow: inset 0 0 0 1px var(--cn-danger);
}
.err :deep(.v-field:hover) { box-shadow: inset 0 0 0 1px var(--cn-danger); }
.v-theme--dark .err :deep(.v-field) { background: var(--cn-danger-soft); }
.param-error {
  display: flex; align-items: center; gap: 4px;
  margin-top: 4px; color: #b63d4d; font-size: 10.5px; line-height: 16px;
}
.param-note {
  margin-top: 4px; padding: 9px 10px;
  border: 1px solid var(--cn-border); border-radius: var(--cn-r-2);
  background: var(--cn-surface-soft);
  color: var(--cn-muted); font-size: 10.5px; line-height: 1.6;
}
@media (max-width: 1180px) {
  /* 单列堆叠时参数卡变宽：两列网格放两栏，避免整屏都是长条输入框 */
  .body { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; }
  .body .param-field:first-child,
  .body .param-note { grid-column: 1 / -1; }
}
@media (max-width: 640px) {
  .body { grid-template-columns: 1fr; }
}
</style>
