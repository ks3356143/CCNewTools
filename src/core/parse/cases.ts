import type { ParaInfo } from './docx.ts'
import type { RawCase, IssueCollector } from '../domain.ts'

/**
 * 用例标题行：n.名称（标识）——02 第六节。
 * 标识形如 XQ_SU_ZLPA_SU01（两个大写字母开头 + 下划线）。
 * 容错（实测 A星大纲 V1.10）：编号后允许省略「.」「、」分隔符
 * （如「8宏动作与模板映射修改异常功能（XQ_SU_HHZM_SU08）」）；
 * 但编号后紧跟「）」的是普通步骤（m）开头），不作为标题。
 */
export function matchCaseTitle(t: string): { name: string; itemId: string } | null {
  const m = /^\d{1,3}\s*(.+?)\s*[（(]\s*([A-Za-z]{2}_[A-Za-z0-9_]+)\s*[)）]\s*$/.exec(t)
  if (m === null) return null
  let name = m[1].trim()
  name = name.replace(/^[.、]\s*/, '')
  if (name === '' || name.startsWith('）') || name.startsWith(')')) return null
  return { name: name, itemId: m[2] }
}

/** 步骤起始：m）或 m) 开头 */
const STEP_START_RE = /^\d{1,3}\s*[）)]/

/** 判断期望结果是否以固定动词开头（03 第五节可疑启发式） */
interface WorkingStep {
  text: string
  /** 以「：」结尾的段落开启的"步骤"，若最终没有内容并入则按 9.1 丢弃 */
  fromLabel: boolean
  /**
   * 列表项以「：」结尾开启的步骤：其后的列表项是同一动作的子条件，
   * 逐一并入（实测依据：静态分析格的"统计软件质量度量信息，包含："，
   * 02 验证记录"静态分析 3 步"）。
   */
  listColon: boolean
}

interface MethodState {
  cases: RawCase[]
  cur: RawCase | null
  working: WorkingStep[]
  leadIn: string | null
  prevText: string
  firstPara: boolean
  /**
   * 用例标题后、首个步骤前的普通段落 → 暂记为综述（02 变种规则：方法格子项标题下
   * 可直接写用例综述，也可能省略）。首个步骤内容出现时提交进 cur.methodSummary，
   * 最终归宿（综述 or 退回第 1 步）由 resolveCriteria 按是否配上通过准则裁决。
   */
  pendingSummary: string | null
  /** 首个用例标题之前的段落（整格无标题时整体作为单个用例） */
  preBuffer: ParaInfo[]
}

function newState(): MethodState {
  return { cases: [], cur: null, working: [], leadIn: null, prevText: '', firstPara: true, pendingSummary: null, preBuffer: [] }
}

/** 首个步骤内容进入 working 时，把标题后暂存的普通段落定为本用例的方法格综述 */
function commitPendingSummary(st: MethodState): void {
  if (st.pendingSummary !== null && st.working.length === 0 && st.cur !== null) {
    st.cur.methodSummary = st.pendingSummary
    st.pendingSummary = null
  }
}

function finishCase(st: MethodState, issues: IssueCollector, ctx: string): void {
  if (st.cur === null) return
  if (st.working.length === 0 && st.pendingSummary !== null) {
    // 整个用例只有这一段、没有任何步骤：无从判综述，退回为唯一步骤（旧行为）。
    // 多段拼接去换行——旧规则 5 的并入是无分隔符直接相连
    st.working.push({ text: st.pendingSummary.replace(/\n/g, ''), fromLabel: false, listColon: false })
    st.pendingSummary = null
  }
  for (const s of st.working) {
    if (s.fromLabel && s.text.endsWith('：')) {
      issues.info('DANGLING_LABEL', '已忽略小标题行：' + s.text, ctx)
    }
  }
  const kept: WorkingStep[] = []
  for (const s of st.working) {
    if (s.fromLabel && s.text.endsWith('：')) continue
    kept.push(s)
  }
  const steps = kept.map(function (s, i) {
    return { no: i + 1, text: s.text }
  })
  if (steps.length === 0) {
    issues.error('ZERO_STEPS', '用例「' + st.cur.name + '」没有任何步骤', ctx)
  }
  st.cur.steps = steps
  st.cases.push(st.cur)
  st.cur = null
  st.working = []
  st.leadIn = null
}

function addStep(st: MethodState, text: string, fromLabel: boolean): void {
  commitPendingSummary(st)
  if (st.leadIn !== null && st.working.length === 0 && !fromLabel) {
    text = st.leadIn + text
    st.leadIn = null
  }
  st.working.push({ text: text, fromLabel: fromLabel, listColon: false })
}

function appendToLast(st: MethodState, text: string): void {
  const last = st.working[st.working.length - 1]
  if (last) {
    last.text = last.text + text
    last.fromLabel = false
    last.listColon = false
    st.leadIn = null
  } else {
    addStep(st, text, false)
  }
}

function feedPara(st: MethodState, para: ParaInfo, issues: IssueCollector, ctx: string): void {
  const t = para.text.trim()
  if (t === '') return

  const titleM = matchCaseTitle(t)
  if (titleM !== null) {
    finishCase(st, issues, ctx)
    st.cur = { itemId: titleM.itemId, name: titleM.name, summary: '', steps: [] }
    st.working = []
    st.leadIn = null
    st.prevText = ''
    st.firstPara = true
    return
  }

  if (st.cur === null) {
    st.preBuffer.push(para)
    return
  }

  if (para.numId !== null) {
    // 自动编号列表项（02 第五节：正文没有 1） 字面文本）
    const last = st.working[st.working.length - 1]
    if (last !== undefined && last.listColon) {
      // 列表项以「：」结尾后，其后的列表项并入同一步骤
      last.text = last.text + t
    } else if (t.endsWith('：')) {
      commitPendingSummary(st)
      st.working.push({ text: t, fromLabel: false, listColon: true })
    } else {
      addStep(st, t, false)
    }
    st.prevText = t
    st.firstPara = false
    return
  }

  if (STEP_START_RE.test(t)) {
    addStep(st, t.replace(/^\d{1,3}\s*[）)]\s*/, ''), false)
    st.prevText = t
    st.firstPara = false
    return
  }

  if (st.firstPara === true && t.endsWith('：')) {
    // 引导句（02 第六节规则 2）
    st.leadIn = t
    st.prevText = t
    st.firstPara = false
    return
  }

  if (t.endsWith('：')) {
    // 规则 4：以「：」结尾 → 新步骤，后续非编号段落并入（无并入则按 9.1 丢弃）
    st.working.push({ text: t, fromLabel: true, listColon: false })
    st.prevText = t
    st.firstPara = false
    return
  }

  // 用例标题后、首个步骤前的普通段落 → 暂记为综述（连续普通段落拼接；
  // 步骤/引导句/小标题（：结尾）不会走到这里，各自的分支在上方已 return）
  if (st.working.length === 0 && st.leadIn === null) {
    st.pendingSummary = st.pendingSummary === null ? t : st.pendingSummary + '\n' + t
    st.prevText = t
    st.firstPara = false
    return
  }

  // 规则 5：按上一段结尾标点决定并入或新开
  const last = st.working[st.working.length - 1]
  if (last !== undefined && st.prevText.endsWith('；')) {
    appendToLast(st, t)
  } else if (last !== undefined && st.prevText.endsWith('。')) {
    addStep(st, t, false)
  } else if (last !== undefined) {
    appendToLast(st, t)
  } else {
    addStep(st, t, false)
  }
  st.firstPara = false
  st.prevText = t
}

/**
 * 测试方法格 → 用例与步骤（02 第六、八、九节）。
 * itemName 用于上下文标注与"整格无用例标题"兜底时的用例命名。
 */
export function parseMethod(paras: ParaInfo[], issues: IssueCollector, itemName: string): RawCase[] {
  const st = newState()
  for (const para of paras) {
    feedPara(st, para, issues, itemName)
  }
  finishCase(st, issues, itemName)

  // 整格无用例标题（02 第八节兜底）：所有段落（含标题前缓冲）作为一个用例
  if (st.cases.length === 0 && st.preBuffer.length > 0) {
    const st2 = newState()
    st2.cur = { itemId: '', name: itemName, summary: '', steps: [] }
    st2.preBuffer = []
    for (const para of st.preBuffer) {
      feedPara(st2, para, issues, itemName)
    }
    finishCase(st2, issues, itemName)
    if (st2.cases.length > 0) {
      const only = st2.cases[0]
      issues.warning('NO_TITLE', '测试方法格没有用例标题行，整格按单个用例处理', itemName)
      st.cases.push(only)
    }
  }
  return st.cases
}
