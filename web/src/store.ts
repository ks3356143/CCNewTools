import { reactive } from 'vue'
import type { CaseRow, GlobalParams, Issue, ParseResponse, ProjectMeta } from './types.ts'
import { parseOutline, saveEdits, saveSettings, generate, listProjects, openProject } from './api.ts'
import { activeSuspects } from './suspect.ts'
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
  /** 生成完成时仍存在的疑问文案（doGenerate 算一次，完成页横幅与日志共用同一来源） */
  genWarnings: [] as string[],
  /** 可疑跳转的闪烁行（步骤下标，1.6s 后清空；Vue 状态而非手工 DOM class，重渲染不丢） */
  suspectFlash: null as number | null,
  projects: [] as ProjectMeta[],
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
    applyParseResult(res)
  } catch (e) {
    showToast(e instanceof Error ? e.message : '无法连接本地服务')
  } finally {
    store.parsing = false
  }
}

/** 解析结果统一落库到 store（上传解析与打开项目共用）；解析建档成功后刷新最近项目列表 */
function applyParseResult(res: ParseResponse): void {
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
  void loadProjects()
}

/** 拉取最近项目列表（失败静默，不影响主流程） */
export async function loadProjects(): Promise<void> {
  try {
    store.projects = await listProjects()
  } catch {
    // 静默
  }
}

/** 打开已有项目：服务端读源副本重新解析并恢复编辑；失败 toast 统一在此处理，调用方勿重复弹 */
export async function openProjectById(id: string): Promise<boolean> {
  store.parsing = true
  try {
    const res = await openProject(id)
    if (!res.ok) {
      showToast(res.error ?? '打开失败')
      return false
    }
    applyParseResult(res)
    store.screen = 2
    showToast('已打开项目')
    return true
  } catch (e) {
    showToast(e instanceof Error ? e.message : '无法连接本地服务')
    return false
  } finally {
    store.parsing = false
  }
}

// 编辑存档与设置各用各的防抖计时器（2026-10-01 检查发现：共用一个会互相清掉——
// 编辑步骤后 800ms 内改设置，编辑保存被 clearTimeout 静默丢弃）
let saveTimer: ReturnType<typeof setTimeout> | undefined
let settingsTimer: ReturnType<typeof setTimeout> | undefined
// 防抖窗口内的未落盘标记：pagehide 兜底只在真有待存数据时才发请求
let editsDirty = false
let settingsDirty = false

/** 核对进度随存档上报（可疑判定唯一入口在 suspect.ts，见 09 设计文档） */
function editProgress() {
  return {
    reviewed: store.cases.filter(c => c.reviewed).length,
    suspects: store.cases.reduce((n, c) => n + activeSuspects(c), 0)
  }
}

export function scheduleSave(): void {
  if (!store.parsed) return
  editsDirty = true
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    editsDirty = false
    saveEdits(store.outline, store.cases, editProgress()).catch(() => {})
  }, 800)
}

export function scheduleSettingsSave(): void {
  settingsDirty = true
  clearTimeout(settingsTimer)
  settingsTimer = setTimeout(() => {
    settingsDirty = false
    saveSettings(store.params, store.theme).catch(() => {})
  }, 800)
}

// 防抖窗口内关标签页/关浏览器：最后一次编辑会随计时器一起丢（审计轮 2026-10-07 确认）。
// 兜底必须用同步 XHR——sendBeacon/fetch keepalive 有 64KB 上限，实测存档 27~123KB 会被
// 静默截断；本机回环同步写 <10ms，页面关闭前必达。pagehide 在关标签/刷新/关浏览器时都触发。
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (editsDirty) {
      editsDirty = false
      syncPost('/api/edits', { outline: store.outline, cases: store.cases, progress: editProgress() })
    }
    if (settingsDirty) {
      settingsDirty = false
      syncPost('/api/settings', { params: store.params, theme: store.theme })
    }
  })
}

function syncPost(path: string, body: unknown): void {
  try {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', path, false)
    xhr.setRequestHeader('content-type', 'application/json')
    xhr.send(JSON.stringify(body))
  } catch {
    // 卸载路径尽力而为：失败无法补救，也不能阻塞页面关闭
  }
}

export interface GenLogLine { text: string; done: boolean; warn?: boolean }

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
  // 动画封顶（2026-10-09 验证轮）：日志是前端本地节流展示（服务端渲染并发进行），表数上万时
  // 60ms 下限要放 15 分钟——最多展示 200 条跳跃推进（总时长 ~12s），真实完成以响应为准
  const step = Math.max(1, Math.ceil(total / 200))
  for (let i = 0; i < total; i += step) {
    onLog(
      [{ text: '处理测试项表格 ' + (i + 1) + '/' + total + '：' + tableNames[i], done: false }],
      Math.round((i / total) * 92)
    )
    await new Promise(r => setTimeout(r, Math.max(60, Math.min(500, 2600 / total))))
    onLog([], Math.round(((i + step) / total) * 92))
  }

  const result = await request
  store.generating = false
  if (genError || result === null) {
    showToast(genError || '生成失败')
    return false
  }
  genRes = result
  onLog([{ text: '两份文档渲染完成', done: false }], 100)
  // 疑问提醒（2026-10-01 用户反馈）：可疑未确认/用例未核对时日志必须明示，不能只报成功。
  // 只在此算一次，完成页横幅直接读 store.genWarnings（同一来源，文案不漂移）
  store.genWarnings = []
  const active = store.cases.filter(c => !c.excluded)
  const warnSus = active.reduce((n, c) => n + activeSuspects(c), 0)
  if (warnSus > 0) {
    store.genWarnings.push(`有 ${warnSus} 处切分可疑未确认，文档已按当前文本生成`)
  }
  const warnUnreviewed = active.filter(c => !c.reviewed).length
  if (warnUnreviewed > 0) {
    store.genWarnings.push(`有 ${warnUnreviewed} 个用例未核对`)
  }
  for (const w of store.genWarnings) {
    onLog([{ text: w, done: false, warn: true }], 100)
  }
  store.genResult = { spec: genRes.spec, rec: genRes.rec, specName: genRes.specName, recName: genRes.recName }
  return true
}

export function currentCase(): CaseRow | null {
  return store.cases[store.currentIdx] ?? null
}

export function goCase(idx: number): void {
  store.suspectFlash = null
  if (idx >= 0 && idx < store.cases.length) store.currentIdx = idx
}

export function resetAll(): void {
  store.screen = 1
  store.parsed = false
  store.cases = []
  store.issues = []
  store.genResult = null
  store.genWarnings = []
  store.suspectFlash = null
  store.currentIdx = 0
  store.outline = { name: '', hash: '' }
}

// 调试探针（M5 开发期使用，打包前保留无妨——本地单用户工具）
if (typeof window !== 'undefined') {
  ;(window as any).__store = store
}
