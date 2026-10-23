<script setup lang="ts">
import { computed } from 'vue'
import { activeSuspects } from '../suspect.ts'
import type { CaseRow } from '../types.ts'

// 独立组件：切用例时父级会重渲染整层树，但每行的可疑判定在 props 未变时被 Vue 跳过，
// 避免大文档下每次 currentIdx 变化都重算所有行的步骤
const props = defineProps<{ row: CaseRow }>()
const active = computed(() => activeSuspects(props.row) > 0)
</script>

<template>
  <span v-if="active" class="dot" />
</template>

<style scoped>
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--cn-danger); }
</style>
