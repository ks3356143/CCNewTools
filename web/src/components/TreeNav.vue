<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { store, goCase, activeSuspects } from '../store.ts'
import type { CaseRow } from '../types.ts'

const keyword = ref('')
const bodyEl = ref<HTMLElement | null>(null)

interface CaseNode { row: CaseRow; idx: number }
interface ItemNode { name: string; cases: CaseNode[] }
interface GroupNode { name: string; items: ItemNode[] }
interface TypeNode { name: string; groups: GroupNode[]; caseCount: number }

const tree = computed<TypeNode[]>(() => {
  const kw = keyword.value.trim().toLowerCase()
  const types: TypeNode[] = []
  const idxByName = new Map<string, number>()
  store.cases.forEach((c, i) => idxByName.set(c.caseId, i))

  for (const c of store.cases) {
    if (kw && !(c.mingcheng + c.caseId + c.itemId).toLowerCase().includes(kw)) continue
    const idx = idxByName.get(c.caseId) ?? 0
    let t = types.find(x => x.name === c.typeName)
    if (!t) { t = { name: c.typeName, groups: [], caseCount: 0 }; types.push(t) }
    t.caseCount++
    let g = t.groups.find(x => x.name === (c.groupName ?? ''))
    if (!g) { g = { name: c.groupName ?? '', items: [] }; t.groups.push(g) }
    let it = g.items.find(x => x.name === c.itemName)
    if (!it) { it = { name: c.itemName, cases: [] }; g.items.push(it) }
    it.cases.push({ row: c, idx: idx })
  }
  return types
})

const opened = reactiveTypeSet()

function reactiveTypeSet() {
  const s = ref(new Set<string>())
  return {
    s,
    toggle(key: string) {
      const next = new Set(s.value)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      s.value = next
    },
    isOpen(key: string): boolean {
      return !s.value.has(key)
    }
  }
}

// 当前用例变化（徽章跳转/上下条按钮）时：展开当前用例所属类型并滚动树到当前用例
watch(() => store.currentIdx, async () => {
  const c = store.cases[store.currentIdx]
  if (!c) return
  if (!opened.isOpen(c.typeName)) {
    const next = new Set(opened.s.value)
    next.delete(c.typeName)
    opened.s.value = next
  }
  await nextTick()
  bodyEl.value?.querySelector<HTMLElement>(`[data-idx="${store.currentIdx}"]`)
    ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
})
</script>

<template>
  <div class="tree">
    <div class="search">
      <v-icon size="16">mdi-magnify</v-icon>
      <input v-model="keyword" placeholder="搜索用例名称或标识" />
    </div>
    <div class="note">数字为大纲中的实际用例数</div>
    <div ref="bodyEl" class="body">
      <div v-for="t in tree" :key="t.name" class="type">
        <button class="row type-row" @click="opened.toggle(t.name)">
          <v-icon size="16" class="chev" :class="{ closed: !opened.isOpen(t.name) }">mdi-chevron-down</v-icon>
          <span class="name">{{ t.name }}</span>
          <span class="cnt">{{ keyword ? '' : t.caseCount }}</span>
        </button>
        <div v-show="opened.isOpen(t.name)" class="indent">
          <div v-for="g in t.groups" :key="g.name">
            <div v-if="g.name" class="item-row group">{{ g.name }}</div>
            <div class="indent" :class="{ plain: !g.name }">
              <div v-for="it in g.items" :key="it.name">
                <div class="item-row">{{ it.name }}</div>
                <div class="indent">
                  <button
                    v-for="cn in it.cases"
                    :key="cn.row.caseId"
                    class="row case-row"
                    :data-idx="cn.idx"
                    :class="{ cur: cn.idx === store.currentIdx }"
                    @click="goCase(cn.idx)"
                  >
                    <v-icon v-if="cn.row.reviewed" size="13" color="success">mdi-check</v-icon>
                    <span v-else class="dot-holder">
                      <span v-if="activeSuspects(cn.row) > 0" class="dot" />
                    </span>
                    <span class="name" :class="{ excluded: cn.row.excluded }">{{ cn.row.mingcheng }}</span>
                    <span class="cid">{{ cn.row.caseId }}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div v-if="tree.length === 0" class="empty">没有匹配的用例</div>
    </div>
  </div>
</template>

<style scoped>
.tree { display: flex; flex-direction: column; flex: 1; min-height: 0; height: 100%; }
.search {
  display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 12px;
  border: 1px solid rgba(var(--v-theme-outline), 0.4); border-radius: 8px; margin: 12px 12px 6px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.search input { border: none; outline: none; background: none; font: inherit; font-size: 13px; width: 100%; color: inherit; }
.note { font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.55); padding: 2px 14px 8px; border-bottom: 1px solid rgba(var(--v-theme-outline), 0.3); }
.body { overflow-y: auto; flex: 1; padding: 6px; }
.row { width: 100%; display: flex; align-items: center; gap: 6px; border-radius: 8px; text-align: left; cursor: pointer; }
.row:hover { background: rgba(var(--v-theme-primary), 0.08); }
.type-row { padding: 7px 8px; font-size: 14px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.9); }
.item-row { padding: 5px 8px; font-size: 13px; font-weight: 500; color: rgba(var(--v-theme-on-surface), 0.65); }
.item-row.group { font-weight: 550; }
.case-row { padding: 5px 10px; font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.75); }
.case-row.cur { background: rgba(var(--v-theme-primary), 0.14); color: rgb(var(--v-theme-primary)); font-weight: 550; }
.indent { margin-left: 14px; border-left: 1px solid rgba(var(--v-theme-outline), 0.35); padding-left: 5px; }
.indent.plain { border-left: none; margin-left: 4px; }
.chev { transition: transform 0.18s; }
.chev.closed { transform: rotate(-90deg); }
.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.name.excluded { text-decoration: line-through; opacity: 0.5; }
.cnt { margin-left: auto; font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.5); }
.cid { margin-left: auto; font-family: Consolas, monospace; font-size: 10.5px; opacity: 0.65; }
.dot-holder { width: 14px; display: inline-flex; justify-content: center; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: rgb(var(--v-theme-warning)); }
.empty { padding: 16px; font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5); }
</style>
