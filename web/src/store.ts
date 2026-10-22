import { reactive } from 'vue'
import type { CaseRow, GlobalParams, GeneratedFile, Issue, ParseResponse, ProjectMeta, TraceTable, TraceRowVM, TraceType } from './types.ts'
import type { TraceParseResponse } from './api.ts'
import { parseOutline, saveEdits, saveSettings, generate, listProjects, openProject, traceParse, traceGenerate, traceOpen } from './api.ts'
import { activeSuspects } from './suspect.ts'
import { DEFAULT_PARAMS } from '../../src/core/domain.ts'

export interface Toast { text: string; show: boolean }

export const store = reactive({
  /** 顶层视图：首页 / 工具一（大纲转换）/ 工具二（追踪文档生成）——11-工具集首页 */
  view: 'home' as 'home' | 'convert' | 'trace',
  /** 工具一屏号（view === 'convert' 时有效）；0 无意义，屏切换由 view 承担 */
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
  genResult: null as { spec?: string; rec?: string; specName: string; recName: string; files?: GeneratedFile[]; recSkipped?: boolean; recNote?: string } | null,
  /** 生成完成时仍存在的疑问文案（doGenerate 算一次，完成页横幅与日志共用同一来源） */
  genWarnings: [] as string[],
  /** 可疑跳转的闪烁行（步骤下标，1.6s 后清空；Vue 状态而非手工 DOM class，重渲染不丢） */
  suspectFlash: null as number | null,
  projects: [] as ProjectMeta[],
  // —— 工具二：追踪文档生成（12-追踪文档工具 v2：四 tab 四类表；与工具一共用项目库，状态独立） ——
  traceScreen: 1 as 1 | 2,
  /** 当前 tab：大纲追踪 / 说明追踪 / 报告追踪 / 回归说明追踪 */
  traceType: 'spec' as TraceType,
  traceParsing: false,
  traceParsed: false,
  /** 主文档（outline/spec tab=大纲；report=测试记录；returnSpec=回归说明） */
  tracePrimary: { name: '', hash: '' } as { name: string; hash: string },
  /** report/returnSpec 配对的文档（大纲或说明，自动识别） */
  traceAlignOutline: null as { name: string; hash: string } | null,
  /** 配对文档识别类型：大纲=SRS 自动填；说明=SRS 留空人工补 */
  traceAlignKind: null as 'outline' | 'spec' | null,
  traceStats: { items: 0, cases: 0, steps: 0 },
  traceIssues: [] as Issue[],
  /** 统一追踪表（双层表头 + rows[vmerge]）；执行结果列编辑直接改 rows 的 cells */
  traceSpec: null as TraceTable | null,
  traceGenerating: false,
  traceResult: null as { name: string; sizeKB: string; doc?: string; path?: string } | null,
  toast: { text: '', show: false } as Toast
})

// 验收深链（2026-10-22 UI 重验用）：?view=convert&screen=2 等让任意屏在首帧直接挂载——
// 预览面板隐藏态下 Vue 过渡冻结、无法切屏截图，深链绕开过渡；无参数时行为完全不变
if (typeof window !== 'undefined') {
  const q = new URLSearchParams(window.location.search)
  const v = q.get('view')
  if (v === 'home' || v === 'convert' || v === 'trace') store.view = v
  const s = Number(q.get('screen'))
  if (store.view === 'convert' && (s === 1 || s === 2 || s === 3)) store.screen = s as 1 | 2 | 3
  const ts = Number(q.get('traceScreen'))
  if (store.view === 'trace' && (ts === 1 || ts === 2)) store.traceScreen = ts as 1 | 2
  // 验收演示数据（?demo=trace2）：注入最小示例追踪表——隐藏预览面板下无法运行切屏过渡，
  // 只能靠首帧挂载截图核对视觉；无参数时行为完全不变
  if (q.get('demo') === 'trace2') {
    store.traceType = 'spec'
    store.traceParsed = true
    store.traceScreen = 2
    store.tracePrimary = { name: '演示-测试说明.docx', hash: 'demo' }
    store.traceAlignOutline = { name: '演示-测试大纲.docx', hash: 'demo-outline' }
    store.traceAlignKind = 'outline'
    store.traceStats = { items: 4, cases: 4, steps: 16 }
    store.traceSpec = {
      type: 'spec',
      heads: [
        { group: '序号', cols: ['序号'] },
        { group: '软件需求规格说明', cols: ['章节号', '章节名称'] },
        { group: '软件测试大纲', cols: ['大纲章节号', '测试项名称', '测试项标识'] },
        { group: '测试说明', cols: ['用例名称', '用例标识'] },
        { group: '备注', cols: ['备注'] }
      ],
      rows: [
        { cells: ['1', '4.1', '参数管理', '6.2.1.1', '参数查询项', 'XQ_A', '参数查询用例', 'YL_A_001', ''], span: [1, 2, 2, 2, 2, 2, 1, 1, 1] },
        { cells: ['2', '4.1', '参数管理', '6.2.1.1', '参数查询项', 'XQ_A', '参数设置用例', 'YL_A_002', ''], span: [1, 0, 0, 0, 0, 0, 1, 1, 1] },
        { cells: ['3', '4.2', '指令生成', '6.2.1.2', '指令生成项', 'XQ_B', '指令生成用例', 'YL_B_001', ''], span: [1, 1, 1, 1, 1, 1, 1, 1, 1] },
        { cells: ['4', '4.2', '指令生成', '6.2.1.2', '指令生成项', 'XQ_B', '指令校验用例', 'YL_B_002', ''], span: [1, 1, 1, 1, 1, 1, 1, 1, 1] }
      ]
    }
  }
}

let toastTimer: ReturnType<typeof setTimeout> | undefined
export function showToast(text: string): void {
  store.toast.text = text
  store.toast.show = true
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (store.toast.show = false), 2600)
}

// —— 刷新恢复（2026-10-22 用户反馈：核对屏 F5 后回到首页，项目与核对进度全丢）——
// sessionStorage 天然是"同标签刷新保留、新标签为空"，无需嗅探 navigation type；
// 数据仍以项目存档为准，不额外复制。显式深链（?view=…）保持测试语义，不抢屏。
const SESSION_KEY = 'ccn:last-session'
interface LastSession {
  view: 'home' | 'convert' | 'trace'
  screen: 1 | 2 | 3
  hash: string
  traceType: TraceType
  currentIdx: number
}

export function saveSession(): void {
  if (typeof window === 'undefined') return
  try {
    const data: LastSession = {
      view: store.view,
      screen: store.screen,
      hash: store.outline.hash,
      traceType: store.traceType,
      currentIdx: store.currentIdx
    }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(data))
  } catch { /* 隐私模式 / 存储禁用：静默 */ }
}

/** 刷新后恢复上次会话（新标签没有 sessionStorage，自然回首页） */
export async function restoreSession(): Promise<void> {
  if (typeof window === 'undefined') return
  if (new URLSearchParams(window.location.search).has('view')) return
  let saved: LastSession | null = null
  try { saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') } catch { saved = null }
  if (!saved || saved.view === 'home') return
  if (saved.view === 'trace') {
    store.view = 'trace'
    store.traceType = TRACE_TABS.some(t => t.key === saved!.traceType) ? saved.traceType : 'spec'
    // 追踪表规格只在内存里，刷新后回选择页，不假装还能预览
    store.traceScreen = 1
    return
  }
  store.view = 'convert'
  if (saved.screen === 1 || !saved.hash) {
    store.screen = 1
    return
  }
  // 项目 id = hash 前 12 位（src/server/projects.ts projectId），省一次项目列表 I/O
  const ok = await openProjectById(saved.hash.slice(0, 12), { silent: true })
  if (ok) {
    if (Number.isFinite(Number(saved.currentIdx))) goCase(Number(saved.currentIdx))
    store.screen = 2 // 完成屏不还原（生成结果只在内存）
  } else {
    store.screen = 1
  }
}

/** 生成前的必填闸门：顶部按钮态 / gen() / doGenerate() 共用同一规则与文案 */
export const REQUIRED_PARAMS_HINT = '请先填写测试人员与监测人员'
export function requiredParamsMissing(): boolean {
  return !store.params.tester?.trim() || !store.params.monitor?.trim()
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

/** 首页 → 进入工具；屏号保留（回首页不丢已上传大纲，重新进入仍在原屏） */
export function openTool(tool: 'convert' | 'trace'): void {
  store.view = tool
}

/** 工具内返回首页；两个工具各自的屏号与解析状态都保留 */
export function goHome(): void {
  store.view = 'home'
}

// —— 工具二：追踪文档生成（12-追踪文档工具 v2） ——

/** 追踪四 tab 定义（TraceScreen1 渲染用） */
export const TRACE_TABS: Array<{ key: TraceType; label: string; doc: string; hint: string }> = [
  { key: 'outline', label: '大纲追踪', doc: '大纲.docx', hint: '生成大纲附件2「测试项与软件需求规格说明对照表」' },
  { key: 'spec', label: '说明追踪', doc: '大纲.docx', hint: '生成测试说明「需求的可追踪性」追踪表' },
  { key: 'report', label: '报告追踪', doc: '测试记录.docx', hint: '生成报告附件2「软件满足软件需求规格说明对照表」' },
  { key: 'returnSpec', label: '回归说明', doc: '回归说明.docx', hint: '生成回归说明「需求的可追踪性」需求追溯表' }
]

/** report/returnSpec 需要配对大纲（SRS 与大纲章节号只有大纲里有） */
export function traceNeedsOutline(t: TraceType): boolean {
  return t === 'report' || t === 'returnSpec'
}

/** 切换 tab：丢弃旧解析结果（不同 tab 的表结构与上传要求不同） */
export function setTraceType(t: TraceType): void {
  if (store.traceType === t) return
  store.traceType = t
  resetTraceParse()
  store.traceScreen = 1
}

function resetTraceParse(): void {
  store.traceParsing = false
  store.traceParsed = false
  store.tracePrimary = { name: '', hash: '' }
  store.traceAlignOutline = null
  store.traceAlignKind = null
  store.traceStats = { items: 0, cases: 0, steps: 0 }
  store.traceIssues = []
  store.traceSpec = null
  store.traceResult = null
}

/** 追踪解析结果落库（trace/parse 与 trace/open 共用） */
function applyTraceResult(res: TraceParseResponse): void {
  store.tracePrimary = res.primary
  store.traceAlignOutline = res.outline
  store.traceAlignKind = res.alignKind ?? null
  store.traceStats = res.stats
  store.traceIssues = res.issues
  store.traceSpec = res.spec
  store.traceParsed = true
  store.traceResult = null
  void loadProjects()
}

/** 四 tab 上传解析：主文档 + report/returnSpec 的大纲配对（项目库 hash 或新文件） */
export async function doTraceParse(file: File, outline?: { hash?: string; file?: File }): Promise<void> {
  store.traceParsing = true
  try {
    const res = await traceParse(store.traceType, file, outline)
    if (!res.ok) {
      showToast(res.error ?? '解析失败')
      return
    }
    applyTraceResult(res)
  } catch (e) {
    showToast(e instanceof Error ? e.message : '无法连接本地服务')
  } finally {
    store.traceParsing = false
  }
}

/** 追踪工具打开最近项目：服务端按项目类型重建追踪表（outline 项目按当前 tab 的表型） */
export async function openTraceProject(id: string): Promise<boolean> {
  store.traceParsing = true
  try {
    const res = await traceOpen(id, store.traceType)
    if (!res.ok) {
      showToast(res.error ?? '打开失败')
      return false
    }
    applyTraceResult(res)
    store.traceScreen = 2
    showToast('已打开项目')
    return true
  } catch (e) {
    showToast(e instanceof Error ? e.message : '无法连接本地服务')
    return false
  } finally {
    store.traceParsing = false
  }
}

export async function doTraceGenerate(): Promise<boolean> {
  if (!store.traceParsed || store.traceSpec === null || store.traceSpec.rows.length === 0) {
    showToast('没有可生成的追踪表行')
    return false
  }
  store.traceGenerating = true
  try {
    const r = await traceGenerate(store.traceType, store.traceSpec.rows, store.tracePrimary, '')
    if (!r.ok) {
      showToast(r.error ?? '生成失败')
      return false
    }
    store.traceResult = { name: r.name, sizeKB: r.sizeKB, doc: r.doc, path: r.files?.[0]?.path }
    return true
  } catch (e) {
    showToast(e instanceof Error ? e.message : '无法连接本地服务')
    return false
  } finally {
    store.traceGenerating = false
  }
}

/** 打开已有项目：服务端读源副本重新解析并恢复编辑；失败 toast 统一在此处理，调用方勿重复弹 */
export async function openProjectById(id: string, opts: { silent?: boolean } = {}): Promise<boolean> {
  store.parsing = true
  try {
    const res = await openProject(id)
    if (!res.ok) {
      showToast(res.error ?? '打开失败')
      return false
    }
    applyParseResult(res)
    store.screen = 2
    if (!opts.silent) showToast('已打开项目')
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
  if (requiredParamsMissing()) {
    showToast(REQUIRED_PARAMS_HINT)
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
  store.genResult = {
    spec: genRes.spec,
    rec: genRes.rec,
    specName: genRes.specName,
    recName: genRes.recName,
    files: genRes.files,
    recSkipped: genRes.recSkipped,
    recNote: genRes.recNote
  }
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
  store.view = 'home'
  store.screen = 1
  store.parsed = false
  store.cases = []
  store.issues = []
  store.genResult = null
  store.genWarnings = []
  store.suspectFlash = null
  store.currentIdx = 0
  store.outline = { name: '', hash: '' }
  // 工具二状态一并复位（防御性：当前无调用方，保持与轮 10"复位补齐"约定一致）
  store.traceScreen = 1
  store.traceType = 'spec'
  store.traceGenerating = false
  resetTraceParse()
}

// 调试探针（M5 开发期使用，打包前保留无妨——本地单用户工具）
if (typeof window !== 'undefined') {
  ;(window as any).__store = store
  ;(window as any).__doParse = doParse // 隐藏面板下做数据级验证用（2026-10-13）
}
