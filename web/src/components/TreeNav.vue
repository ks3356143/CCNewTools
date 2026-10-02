<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { store, goCase } from '../store.ts'
import { activeSuspects } from '../suspect.ts'
import TreeLevel from './TreeLevel.vue'
import type { PathNode } from '../types.ts'
import type { CaseRow } from '../types.ts'

const keyword = ref('')
const bodyEl = ref<HTMLElement | null>(null)

// 树按完整大纲路径逐级构建（2026-10-02 树镜像改造）：树与生成文档同构，
// XXX分系统/容器/类型/项 层层可见。idx 用 store.cases 真实下标（撞号不合并）。
const tree = computed<PathNode[]>(() => {
  const kw = (keyword.value ?? '').trim().toLowerCase()
  const roots: PathNode[] = []
  // 全链 key 保证同名节点在不同分支独立
  for (const [i, c] of store.cases.entries()) {
    if (kw && !(c.mingcheng + c.caseId + c.itemId).toLowerCase().includes(kw)) continue
    let level = roots
    let chain = ''
    const pathTexts = c.path.map(p => p.text)
    for (const [d, text] of pathTexts.entries()) {
      chain = chain + '\u0000' + text
      let node = level.find(n => n.key === chain)
      if (!node) {
        node = { key: chain, name: text, children: [], cases: [], caseCount: 0 }
        level.push(node)
      }
      node.caseCount++
      if (d < pathTexts.length - 1) level = node.children
      else node.cases.push({ row: c, idx: i })
    }
  }
  return roots
})

const collapsed = ref(new Set<string>())
function toggle(key: string): void {
  const next = new Set(collapsed.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  collapsed.value = next
}

// 当前用例变化（徽章跳转/上下条按钮）时：展开当前用例的祖先链并滚动树到当前用例
watch(() => store.currentIdx, async () => {
  const c = store.cases[store.currentIdx]
  if (!c) return
  const chainSet = new Set(collapsed.value)
  let chain = ''
  for (const p of c.path) {
    chain = chain + '\u0000' + p.text
    chainSet.delete(chain)
  }
  collapsed.value = chainSet
  await nextTick()
  bodyEl.value?.querySelector<HTMLElement>(`[data-idx="${store.currentIdx}"]`)
    ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
})

const totalCases = computed(() => store.cases.length)
</script>

<template>
  <div class="tree">
    <v-text-field
      v-model="keyword"
      placeholder="搜索用例名称或标识"
      prepend-inner-icon="mdi-magnify"
      variant="solo" density="compact" hide-details
      flat rounded="lg" clearable
      class="search"
    />
    <div class="note">数字为该层下的实际用例数</div>
    <div ref="bodyEl" class="body">
      <TreeLevel
        v-for="root in tree"
        :key="root.key"
        :node="root"
        :collapsed="collapsed"
        :depth="0"
        @toggle="toggle"
      />
      <div v-if="tree.length === 0" class="empty">没有匹配的用例</div>
    </div>
    <div v-if="keyword && tree.length > 0" class="found">
      匹配 {{ tree.reduce((n, r) => n + r.caseCount, 0) }} / {{ totalCases }} 个用例
    </div>
  </div>
</template>

<style scoped>
.tree { display: flex; flex-direction: column; flex: 1; min-height: 0; height: 100%; }
/* v-input 自带 flex:1 1 auto，在纵向 flex 容器 .tree 里会被平分拉伸（实测 364px）——显式关掉 */
.search { margin: 12px 12px 6px; flex: none; }
/* solo 变体去白底突兀感：浅色填充融入树容器（深浅主题通用，on-surface 低透明度叠加） */
.search :deep(.v-field) { background: rgba(var(--v-theme-on-surface), 0.045); }
.note { font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.55); padding: 2px 14px 8px; border-bottom: 1px solid rgba(var(--v-theme-outline), 0.3); }
.body { overflow-y: auto; flex: 1; padding: 6px; }
.found { flex: none; font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.55); padding: 6px 14px 8px; border-top: 1px solid rgba(var(--v-theme-outline), 0.3); }
.empty { padding: 16px; font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5); }
</style>
