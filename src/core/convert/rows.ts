import type { TestItem, RawCase, GlobalParams } from '../domain.ts'
import { makeCaseId } from './caseId.ts'
import { splitStepText } from './split.ts'
import { criteriaFor } from './criteria.ts'

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
  steps: Array<{ no: number; action: string; expect: string; actual: string; result: string }>
  designer: string
  testTime: string
  tester: string
  monitor: string
  /** 记录模板的追踪关系（三行文本，03 第六节） */
  trace: string
  /** 期望结果来源（9.5）：通过准则 / 方法切分 */
  expectSource: string
  /** 可疑步骤数（界面用） */
  suspectCount: number
  /** 界面状态：已核对 / 不生成此用例 / 已确认无误的可疑步序号 */
  reviewed: boolean
  excluded: boolean
  dismissedSuspects: number[]
}

/** 记录模板的追踪关系三行文本（03 第六节假设格式，待用户最终确认） */
export function traceOf(item: TestItem, c: RawCase): string {
  return (
    '软件测试依据：软件测评大纲\n' +
    '测试需求分析：' + item.chapter + ' ' + item.itemName + '\n' +
    '测试需求标识：' + c.itemId
  )
}

/** 单个用例 → 模板数据行 */
export function buildRow(item: TestItem, c: RawCase, params: GlobalParams): CaseRow {
  const criteria = criteriaFor(item, c.steps.length)
  const expectSource = criteria !== null ? '通过准则' : '方法切分'

  const steps = c.steps.map(function (s: { no: number; text: string }) {
    if (criteria !== null) {
      return { no: s.no, action: s.text, expect: criteria[s.no - 1], actual: '', result: '通过', suspect: undefined as string | undefined }
    }
    const sp = splitStepText(s.text)
    return { no: s.no, action: sp.action, expect: sp.expect, actual: '', result: '通过', suspect: sp.suspect }
  })

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
    expectSource: expectSource,
    suspectCount: suspectCount,
    reviewed: false,
    excluded: false,
    dismissedSuspects: []
  }
}
