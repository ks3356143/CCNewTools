<script setup lang="ts">
import { computed } from 'vue'
import { requiredParamsMissing } from '../store.ts'

// 独立组件：参数输入时只有这颗按钮重渲染，不会带着整个核对屏的模板一起 diff
const missing = computed(requiredParamsMissing)
const emit = defineEmits<{ open: [] }>()
</script>

<template>
  <span class="params-wrap" :class="{ pending: missing }">
    <v-btn
      size="small" variant="tonal" class="params-btn" :class="{ pending: missing }"
      :title="missing ? '测试人员 / 监测人员未填写，点击填写' : '填写软件配置项、人员等全局参数'"
      @click="emit('open')"
    >
      <v-icon size="15" class="mr-1">{{ missing ? 'mdi-alert-circle-outline' : 'mdi-tune-variant' }}</v-icon>全局参数
    </v-btn>
  </span>
</template>

<style scoped>
.params-wrap { position: relative; display: inline-flex; flex: none; }
.params-btn { height: 36px !important; border-radius: var(--cn-r-2); }
/* 警示只发生在按钮外的光环：按钮本体保持可读，光环用伪元素 opacity/scale 呼吸（不重绘按钮） */
.params-wrap.pending::after {
  content: "";
  position: absolute; inset: -3px;
  border: 2px solid var(--cn-danger);
  border-radius: calc(var(--cn-r-2) + 3px);
  pointer-events: none;
  opacity: 0.5; /* 动画关闭/降级时的静态值 */
  animation: warning-breathe 2.4s linear infinite alternate;
}
.params-btn.pending {
  color: var(--cn-danger-text) !important;
  border-color: var(--cn-danger-line) !important;
  background: var(--cn-danger-soft) !important;
}
@keyframes warning-breathe {
  from { opacity: 0.28; transform: scale(0.99); }
  to { opacity: 0.72; transform: scale(1.015); }
}
@media (prefers-reduced-motion: reduce) {
  .params-wrap.pending::after { animation: none; opacity: 0.5; transform: none; }
}
</style>
