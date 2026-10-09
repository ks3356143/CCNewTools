<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { store, goCase } from '../store.ts'
import { activeSuspects } from '../suspect.ts'
import TreeLevel from './TreeLevel.vue'
import type { PathNode } from '../types.ts'
import type { CaseRow } from '../types.ts'

const keyword = ref('')
const bodyEl = ref<HTMLElement | null>(null)

/** 搜索命中渲染上限（构建侧截断，见 tree computed 注释） */
const SEARCH_RENDER_LIMIT = 300

// 搜索输入防抖 300ms：大文档（29686 例）每次 keystroke 全量重算树，逐键卡顿
const searchInput = ref('')
let debounceTimer: ReturnType<typeof setTimeout> | undefined
watch(searchInput, v => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => { keyword.value = v }, 300)
})

// 树按完整大纲路径逐级构建（2026-10-02 树镜像改造）：树与生成文档同构，
// XXX分系统/容器/类型/项 层层可见。idx 用 store.cases 真实下标（撞号不合并）。
// 纯计算（不写外部 ref——computed 副作用会打乱渲染调度）：搜索命中只入树前
// SEARCH_RENDER_LIMIT 个（42MB 样本 29686 例实测宽泛词全量渲染卡死），hits 累计
// 全部命中数供溢出提示；非搜索态不截断（大文档默认折叠，无此问题）。
const tree = computed<{ roots: PathNode[]; hits: number }>(() => {
  const kw = (keyword.value ?? '').trim().toLowerCase()
  const roots: PathNode[] = []
  let hits = 0
  for (const [i, c] of store.cases.entries()) {
    if (kw && !(c.mingcheng + c.caseId + c.itemId).toLowerCase().includes(kw)) continue
    hits++
    if (kw && hits > SEARCH_RENDER_LIMIT) continue
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
  return { roots, hits }
})
const treeRoots = computed(() => tree.value.roots)
const searchOverflow = computed(() => (keyword.value ?? '').trim() !== '' && tree.value.hits > SEARCH_RENDER_LIMIT)

// 展开语义（2026-10-09 验证轮改造）：expanded 记录手动展开的节点；小文档（≤600 例，覆盖全部已知真实样本）
// 或搜索态强制全展开保持原体验；大文档默认全折叠——折叠子树不渲染（TreeLevel v-if），
// 逐层按需创建 DOM（29686 例全量渲染实测卡死主线程）。openFn 是稳定引用，TreeLevel 的 computed
// 调用它时自动收集 expanded/keyword 依赖。
const expanded = ref(new Set<string>())
const smallOrSearch = computed(() => store.cases.length <= 600 || (keyword.value ?? '').trim() !== '')
function isOpen(key: string): boolean {
  return smallOrSearch.value || expanded.value.has(key)
}
function toggle(key: string): void {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}

// 当前用例变化（徽章跳转/上下条按钮）时：展开当前用例的祖先链并滚动树到当前用例
watch(() => store.currentIdx, async () => {
  const c = store.cases[store.currentIdx]
  if (!c) return
  const next = new Set(expanded.value)
  let chain = ''
  for (const p of c.path) {
    chain = chain + '\u0000' + p.text
    next.add(chain)
  }
  expanded.value = next
  await nextTick()
  bodyEl.value?.querySelector<HTMLElement>(`[data-idx="${store.currentIdx}"]`)
    ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
})

const totalCases = computed(() => store.cases.length)
</script>

<template>
  <div class="tree">
    <v-text-field
      v-model="searchInput"
      placeholder="搜索用例名称或标识"
      prepend-inner-icon="mdi-magnify"
      variant="solo" density="compact" hide-details
      flat rounded="lg" clearable
      class="search"
    />
    <div class="note">数字为该层下的实际用例数</div>
    <div ref="bodyEl" class="body">
      <TreeLevel
        v-for="root in treeRoots"
        :key="root.key"
        :node="root"
        :open-fn="isOpen"
        :depth="0"
        @toggle="toggle"
      />
      <div v-if="treeRoots.length === 0" class="empty">没有匹配的用例</div>
    </div>
    <div v-if="keyword && treeRoots.length > 0" class="found">
      匹配 {{ tree.hits }} / {{ totalCases }} 个用例
    </div>
    <div v-if="searchOverflow" class="found overflow">
      匹配过多，仅显示前 {{ SEARCH_RENDER_LIMIT }} 个用例，请细化关键词
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
.found.overflow { color: rgb(var(--v-theme-warning)); }
.empty { padding: 16px; font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5); }
</style>
