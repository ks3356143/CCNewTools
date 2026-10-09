import type { TestItem, RawCase, GlobalParams, IssueCollector, RawStep, PathEntry } from '../domain.ts'
import { makeCaseId } from './caseId.ts'
import { splitStepText, stripTrailingPunct, hasExpectKeyword } from './split.ts'

/** 模板数据行（04 变量清单：说明/记录两模板共用一套字段） */
export interface CaseRow {
  /** 生成文档第 1~5 层标题（h2~h6，按大纲路径序号映射；本行需要输出该层时非空，由转换层槽位分配填充） */
  head2: string | null
  head3: string | null
  head4: string | null
  head5: string | null
  head6: string | null
  /** 完整大纲路径（树目录按此逐级展示，与生成文档同构；2026-10-02 树镜像改造） */
  path: PathEntry[]
  typeName: string
  groupName: string | null
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
      action: '按照需求规格说明审查单，对被测文档《被测软件需求规格说明》进行审查',
      expect: '依据附录A.1对需求规格说明进行审查'
    },
    {
      action: '《被测软件概要设计说明》和《被测软件用户手册》齐套性进行审查',
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

/**
 * 单个用例 → 模板数据行。
 * 期望来源三模式（2026-10-01 用户定稿的判定顺序）：
 *  1. 静态三类型 → 固定模板步；
 *  2. 通过准则格已给本用例写预期 → 步骤是纯输入，**不做关键词切分**，
 *     期望逐条取准则（等数 1:1；一句话准则全步骤共用；不等数按序配，
 *     多余步骤期望留空待补/多余准则并入末步并告警）；
 *  3. 其余 → 纯操作步合并 + 关键词切分（旧行为）。
 * 准则模式的步骤清单：条数等于合并后步骤数 → 用合并（A星 9.5 形态，
 * 纯操作步并入验证步后一一配对）；等于原始步骤数 → 用原始（变种新写法，
 * 步骤与准则原样一一对应）；都不等 → 用原始按序配对。
 */
export function buildRow(item: TestItem, c: RawCase, params: GlobalParams, issues?: IssueCollector): CaseRow {
  const staticTpl = STATIC_TEMPLATES[item.typeName]
  const crit = c.criteria ?? null
  const useCriteria = staticTpl === undefined && crit !== null && crit.length > 0
  const expectSource = staticTpl !== undefined ? '静态模板' : useCriteria ? '通过准则' : '方法切分'

  interface OutStep { no: number; action: string; expect: string; actual: string; result: string; suspect: string | undefined }
  const pair = function (s: RawStep, i: number, expect: string): OutStep {
    return { no: i + 1, action: stripTrailingPunct(s.text), expect: stripTrailingPunct(expect), actual: '', result: '通过', suspect: undefined }
  }

  let steps: OutStep[]
  if (staticTpl !== undefined) {
    steps = staticTpl.map(function (t, i) {
      return { no: i + 1, action: t.action, expect: t.expect, actual: '', result: '通过', suspect: undefined }
    })
  } else if (useCriteria) {
    const merged = mergePureOps(c.steps)
    // 步骤清单选择：步骤含预期关键词 = 拆分式写法（A星 9.5 形态，纯操作步并入
    // 验证步后与准则配对）；不含 = 纯输入写法（新变种，步骤与准则原样一一对应，
    // 合并会破坏 1:1）。都不满足配对数时用原始按序配对。
    const splitStyle = c.steps.some(function (s) { return hasExpectKeyword(s.text) })
    const list = splitStyle && crit!.length === merged.length && merged.length !== c.steps.length ? merged : c.steps
    if (crit!.length === list.length) {
      steps = list.map(function (s, i) { return pair(s, i, crit![i]) })
    } else if (crit!.length === 1) {
      // 一句话准则：全部步骤共用（用户确认"通过准则可能是一句话"）
      issues?.info('CRITERIA_SINGLE_SHARED', '通过准则仅 1 条，已应用到全部 ' + list.length + ' 个步骤', item.name)
      steps = list.map(function (s, i) { return pair(s, i, crit![0]) })
    } else if (crit!.length < list.length) {
      issues?.warning('CRITERIA_COUNT_MISMATCH', '通过准则 ' + crit!.length + ' 条少于步骤 ' + list.length + ' 条，多出的步骤期望留空待补', item.name)
      steps = list.map(function (s, i) {
        if (i < crit!.length) return pair(s, i, crit![i])
        return { no: i + 1, action: stripTrailingPunct(s.text), expect: '', actual: '', result: '通过', suspect: '期望结果为空' }
      })
    } else {
      issues?.warning('CRITERIA_COUNT_MISMATCH', '通过准则 ' + crit!.length + ' 条多于步骤 ' + list.length + ' 条，多余条目并入最后一步', item.name)
      steps = list.map(function (s, i) {
        if (i < list.length - 1) return pair(s, i, crit![i])
        return { no: i + 1, action: stripTrailingPunct(s.text), expect: crit!.slice(i).map(stripTrailingPunct).join('；'), actual: '', result: '通过', suspect: undefined }
      })
    }
  } else {
    const merged = mergePureOps(c.steps)
    steps = merged.map(function (s, i) {
      const sp = splitStepText(s.text)
      return { no: i + 1, action: sp.action, expect: sp.expect, actual: '', result: '通过', suspect: sp.suspect }
    })
  }

  let suspectCount = 0
  for (const s of steps) {
    if (s.suspect !== undefined) suspectCount++
  }

  return {
    head2: null, head3: null, head4: null, head5: null, head6: null, // 由 convertToTemplateData 槽位分配填充
    path: item.path,
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
