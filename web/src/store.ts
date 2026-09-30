import { reactive } from 'vue'
import type { CaseRow, GlobalParams, Issue } from './types.ts'
import { parseOutline, saveEdits, saveSettings, generate } from './api.ts'
import { DEFAULT_PARAMS } from '../../src/core/domain.ts'

export interface Toast { text: string; show: boolean }

export const store = reactive({
  screen: 1 as 1 | 2 | 3,
  theme: 'light',
  parsing: false,
  parsed: false,
  outline: { name: '', hash: '' },
  stats: { items: 0, cases: 0, steps: 0 },
  issues: [] as Issue[],
  cases: [] as CaseRow[],
  params: { ...DEFAULT_PARAMS } as GlobalParams,
  restored: { cases: 0, steps: 0, skipped: 0 },
  currentIdx: 0,
  generating: false,
  genResult: null as { spec: string; rec: string; specName: string; recName: string } | null,
  toast: { text: '', show: false } as Toast
})

let toastTimer: ReturnType<typeof setTimeout> | undefined
export function showToast(text: string): void {
  store.toast.text = text
  store.toast.show = true
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (store.toast.show = false), 2600)
}

export async function doParse(file: File): Promise<void> {
  store.parsing = true
  try {
    const res = await parseOutline(file)
    if (!res.ok) {
      showToast(res.error ?? '解析失败')
      return
    }
    store.outline = res.outline
    store.stats = res.stats
    store.issues = res.issues
    store.cases = res.cases
    store.params = res.params
    store.theme = res.theme || 'light'
    store.restored = res.restored
    store.parsed = true
    store.currentIdx = 0
    if (res.restored.cases > 0) {
      showToast('已恢复上次编辑：' + res.restored.cases + ' 处')
    }
  } catch (e) {
    showToast(e instanceof Error ? e.message : '无法连接本地服务')
  } finally {
    store.parsing = false
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
export function scheduleSave(): void {
  if (!store.parsed) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveEdits(store.outline, store.cases).catch(() => {})
  }, 800)
}

export function scheduleSettingsSave(): void {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveSettings(store.params, store.theme).catch(() => {})
  }, 800)
}

export interface GenLogLine { text: string; done: boolean }

export async function doGenerate(onLog: (lines: GenLogLine[], pct: number) => void): Promise<boolean> {
  if (!store.params.tester.trim() || !store.params.monitor.trim()) {
    showToast('请先填写测试人员与监测人员')
    store.screen = 2
    return false
  }
  store.generating = true
  // 按真实测试项生成日志序列（逐表展示）
  const tableNames: string[] = []
  let lastName = ''
  for (const c of store.cases) {
    if (c.excluded) continue
    const key = c.typeName + '/' + (c.groupName ?? '') + '/' + c.itemName
    if (key !== lastName) {
      tableNames.push(c.itemName + '（' + c.chapter + '）')
      lastName = key
    }
  }

  let genRes: Awaited<ReturnType<typeof generate>> | null = null
  let genError = ''
  const request = generate(store.outline, store.cases, store.params)
    .then(r => {
      if (!r.ok) genError = r.error ?? '生成失败'
      return r
    })
    .catch(e => {
      genError = e instanceof Error ? e.message : String(e)
      return null
    })

  const total = tableNames.length
  for (let i = 0; i < total; i++) {
    onLog(
      [{ text: '处理测试项表格 ' + (i + 1) + '/' + total + '：' + tableNames[i], done: false }],
      Math.round((i / total) * 92)
    )
    await new Promise(r => setTimeout(r, Math.max(60, Math.min(500, 2600 / total))))
    onLog([], Math.round(((i + 1) / total) * 92))
  }

  const result = await request
  store.generating = false
  if (genError || result === null) {
    showToast(genError || '生成失败')
    return false
  }
  genRes = result
  onLog([{ text: '两份文档渲染完成', done: false }], 100)
  store.genResult = { spec: genRes.spec, rec: genRes.rec, specName: genRes.specName, recName: genRes.recName }
  return true
}

export function currentCase(): CaseRow | null {
  return store.cases[store.currentIdx] ?? null
}

/** 可疑判定唯一入口（前后端语义一致）：
 *  - 期望为空且有动作文本 → 可疑（含用户编辑时误删期望的情况）；
 *  - 后端其他 suspect 标记（当前仅"期望结果为空"一种）——用户补写期望后自动解除；
 *  - 用户点过"确认无误"（dismissedSuspects）不再标。
 */
export function stepSuspectActive(row: CaseRow, s: CaseRow['steps'][number]): boolean {
  if (row.dismissedSuspects.includes(s.no)) return false
  if (!s.expect.trim()) return s.action.trim() !== ''
  return s.suspect !== undefined && s.suspect !== '' && s.suspect !== '期望结果为空'
}

export function activeSuspects(row: CaseRow): number {
  return row.steps.filter(s => stepSuspectActive(row, s)).length
}

export function goCase(idx: number): void {
  if (idx >= 0 && idx < store.cases.length) store.currentIdx = idx
}

export function resetAll(): void {
  store.screen = 1
  store.parsed = false
  store.cases = []
  store.issues = []
  store.genResult = null
  store.outline = { name: '', hash: '' }
}

// 调试探针（M5 开发期使用，打包前保留无妨——本地单用户工具）
if (typeof window !== 'undefined') {
  ;(window as any).__store = store
}
