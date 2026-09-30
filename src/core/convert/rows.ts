import type { TestItem, RawCase, GlobalParams, IssueCollector, RawStep } from '../domain.ts'
import { makeCaseId } from './caseId.ts'
import { splitStepText, stripTrailingPunct, hasExpectKeyword } from './split.ts'

/** 模板数据行（04 变量清单：说明/记录两模板共用一套字段） */
export interface CaseRow {
  showType: string | null
  typeName: string
  showGroup: string | null
  groupName: string | null
  showItem: string | null
  itemName: string
  chapter: string
  itemId: string
  caseId: string
  mingcheng: string
  summary: string
  init: string
  constraint: string
  steps: Array<{ no: number; action: string; expect: string; actual: string; result: string; suspect?: string }>
  designer: string
  testTime: string
  tester: string
  monitor: string
  /** 记录模板的追踪关系（三行文本，03 第六节，措辞已确认：软件测评大纲） */
  trace: string
  /** 测试项标识（追踪表用） */
  itemItemId: string
  /** 需求规格说明章节号/描述（追踪表用，来自大纲追踪关系行） */
  srsChapter: string
  srsDesc: string
  /** 期望结果来源（9.5）：通过准则 / 方法切分 / 静态模板 */
  expectSource: string
  /** 可疑步骤数（界面用） */
  suspectCount: number
  /** 界面状态：已核对 / 不生成此用例 / 已确认无误的可疑步序号 */
  reviewed: boolean
  excluded: boolean
  dismissedSuspects: number[]
}

/** 记录模板的追踪关系三行文本（03 第六节，措辞已确认：软件测评大纲） */
export function traceOf(item: TestItem, c: RawCase): string {
  return (
    '软件测试依据：软件测评大纲\n' +
    '测试需求分析：' + item.chapter + ' ' + item.itemName + '\n' +
    '测试需求标识：' + c.itemId
  )
}

/**
 * 静态三类型（文档审查/静态分析/代码审查）完全按老项目写法（2026-09-30 用户确认）：
 * 步骤是固定的模板化内容，不产生可疑标记，用户无需审核。
 */
const STATIC_TEMPLATES: Record<string, Array<{ action: string; expect: string }>> = {
  '文档审查': [
    {
      action: '按照需求规格说明审查单，对被测文档《BCD星指令生成与发控软件需求规格说明》进行审查',
      expect: '依据附录A.1对需求规格说明进行审查'
    },
    {
      action: '《BCD星指令生成与发控软件概要设计说明》和《BCD星指令生成与发控软件用户手册》齐套性进行审查',
      expect: '文档完整，齐套'
    }
  ],
  '静态分析': [
    {
      action: '使用科代代码分析工具对被测软件全部源程序进行静态分析，对源程序进行检查',
      expect: '使用科代代码分析工具得到编码规则和质量度量结果，注释率不小于20%且无静态问题为通过'
    },
    {
      action: '使用静态分析工具结合人工分析对控制流和数据流进行分析',
      expect: '软件满足控制流和数据流要求'
    }
  ],
  '代码审查': [
    {
      action: '通过人工审查及借助科代代码分析工具辅助分析的方式，依据代码审查单对代码审查范围内的源代码开展四个方面的审查',
      expect: '符合代码检查单的各项预期结果为通过，包括编程准则检查、代码流程审查、软件结构审查、需求实现审查'
    }
  ]
}

/**
 * 纯操作步合并（2026-09-30 用户确认：如参数新增 4 步变 3 步）：
 * 没有预期关键词的"纯操作步"（如"点击新增按钮，输入信息。"）的文本
 * 并进下一个带验证步骤的动作开头，减少用户的审核负担；
 * 末尾仍未并入的纯操作步保持原样。
 */
export function mergePureOps(steps: RawStep[]): RawStep[] {
  const out: RawStep[] = []
  let pending = ''
  for (const s of steps) {
    if (hasExpectKeyword(s.text)) {
      out.push({ no: 0, text: pending + s.text })
      pending = ''
    } else {
      pending = pending + stripTrailingPunct(s.text) + '，'
    }
  }
  for (const p of pendingSplit(pending)) {
    out.push({ no: 0, text: p })
  }
  return out.map((s, i) => ({ no: i + 1, text: s.text }))
}

/** 末尾剩余的纯操作文本回拆为独立步骤（按原本的步数均分不可行，整段作为一步） */
function pendingSplit(pending: string): string[] {
  const t = pending.replace(/，$/, '')
  return t === '' ? [] : [t]
}

/** 单个用例 → 模板数据行（9.5：先合并纯操作步，准则条数与合并后步骤一致时期望取准则） */
export function buildRow(item: TestItem, c: RawCase, params: GlobalParams, issues?: IssueCollector): CaseRow {
  const merged = mergePureOps(c.steps)
  const entry = item.criteriaCases.find(e => e.itemId.toUpperCase() === c.itemId.toUpperCase())
  let criteria: string[] | null = null
  if (entry !== undefined && entry.items.length > 0) {
    if (entry.items.length === merged.length) {
      criteria = entry.items
    } else if (issues) {
      issues.warning(
        'CRITERIA_COUNT_MISMATCH',
        '通过准则条目 ' + entry.items.length + ' 条与步骤 ' + merged.length + ' 条不一致，该用例回退关键词切分',
        item.name
      )
    }
  }

  const staticTpl = STATIC_TEMPLATES[item.typeName]
  const expectSource = staticTpl !== undefined ? '静态模板' : criteria !== null ? '通过准则' : '方法切分'

  let steps: Array<{ no: number; action: string; expect: string; actual: string; result: string; suspect: string | undefined }>
  if (staticTpl !== undefined) {
    steps = staticTpl.map((t, i) => ({ no: i + 1, action: t.action, expect: t.expect, actual: '', result: '通过', suspect: undefined }))
  } else {
    steps = merged.map(function (s, i) {
      if (criteria !== null) {
        return { no: i + 1, action: stripTrailingPunct(s.text), expect: stripTrailingPunct(criteria![i]), actual: '', result: '通过', suspect: undefined as string | undefined }
      }
      const sp = splitStepText(s.text)
      return { no: i + 1, action: sp.action, expect: sp.expect, actual: '', result: '通过', suspect: sp.suspect }
    })
  }

  let suspectCount = 0
  for (const s of steps) {
    if (s.suspect !== undefined) suspectCount++
  }

  return {
    showType: null, showGroup: null, showItem: null, // 由 assemble 填充
    typeName: item.typeName,
    groupName: item.groupName,
    itemName: item.itemName,
    chapter: item.chapter,
    itemId: c.itemId,
    caseId: makeCaseId(item.itemId, item.cases.indexOf(c) + 1),
    mingcheng: c.name,
    summary: c.summary,
    init: params.init,
    constraint: params.constraint,
    steps: steps,
    designer: params.designer,
    testTime: params.testTime,
    tester: params.tester,
    monitor: params.monitor,
    trace: traceOf(item, c),
    itemItemId: item.itemId,
    srsChapter: item.traceSrs.chapter,
    srsDesc: item.traceSrs.desc,
    expectSource: expectSource,
    suspectCount: suspectCount,
    reviewed: false,
    excluded: false,
    dismissedSuspects: []
  }
}
