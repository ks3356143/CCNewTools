/** 三级问题收集（06-错误处理） */

export type IssueLevel = 'error' | 'warning' | 'info'

export interface Issue {
  level: IssueLevel
  code: string
  message: string
  /** 关联上下文，如测试项名称 */
  context?: string
}

export class IssueCollector {
  readonly issues: Issue[] = []

  error(code: string, message: string, context?: string): void {
    this.issues.push({ level: 'error', code, message, context })
  }
  warning(code: string, message: string, context?: string): void {
    this.issues.push({ level: 'warning', code, message, context })
  }
  info(code: string, message: string, context?: string): void {
    this.issues.push({ level: 'info', code, message, context })
  }
  counts(): { error: number; warning: number; info: number } {
    let error = 0, warning = 0, info = 0
    for (const i of this.issues) {
      if (i.level === 'error') error++
      else if (i.level === 'warning') warning++
      else info++
    }
    return { error, warning, info }
  }
}

/** 界面全局参数（03 字段映射：默认值来自老工具写死值，界面可改并记住上次填写内容） */
export interface GlobalParams {
  /** 软件配置项名称（"测试说明"/"需求追踪表"章的标题用，如"BCD星指令生成与发控软件配置项"） */
  configName: string
  init: string
  constraint: string
  designer: string
  testTime: string
  tester: string
  monitor: string
}

export const DEFAULT_PARAMS: GlobalParams = {
  configName: '',
  init: '外接设备或软件运行正常',
  constraint: '软件正常工作，环境连接正常',
  designer: '陈俊亦',
  testTime: new Date().toISOString().slice(0, 10),
  tester: '',
  monitor: ''
}

/** 解析层的步骤：仅承载段落合并后的原文，动作/期望拆分属转换层（03 第五节） */
export interface RawStep {
  no: number
  text: string
}

/** 用例（解析层产出，summary 已按 9.2/9.3 解析完成；caseId 由转换层生成） */
export interface RawCase {
  /** 测试需求标识，用例标题里的 XQ_… 原样 */
  itemId: string
  name: string
  summary: string
  /**
   * 方法格内紧跟用例标题的普通段落（变种写法：综述写在子项标题下）。
   * 由 resolveCriteria 裁决归宿：本用例配上通过准则 → 转正为 summary；
   * 没配上 → 退回为第 1 步（与旧解析行为一致，保护无准则大纲的基线）。
   */
  methodSummary?: string
  /** 通过准则格配到本用例的条目（undefined/null = 未配上，转换层走关键词切分） */
  criteria?: string[] | null
  steps: RawStep[]
}

export interface DescriptionEntry {
  itemId: string
  summary: string
}

/** 通过准则格解析出的逐用例准则（9.5：方法=输入，准则=预期） */
export interface CriteriaEntry {
  itemId: string
  items: string[]
}

export interface TestItem {
  /** 测试项名称（表格第 1 行第 2 格） */
  name: string
  /** 测试项标识（表格第 1 行第 4 格，原样） */
  itemId: string
  /** 测试项标题的完整章节号，如 6.2.1.4.1.1 */
  chapter: string
  /** 测试类型（最近的 level-4 标题） */
  typeName: string
  /** 中间层（level-5，可能不存在） */
  groupName: string | null
  /** 测试项标题文本（表格挂载前最近的标题） */
  itemName: string
  description: {
    shared: string | null
    entries: DescriptionEntry[]
  }
  cases: RawCase[]
  /** 通过准则格的逐用例准则（9.5，转换层按用例标识+条目序号配对） */
  criteriaCases: CriteriaEntry[]
  /** 追踪关系格解析出的需求规格说明信息（追踪表用） */
  traceSrs: { chapter: string; desc: string }
}

export interface ParsedOutline {
  items: TestItem[]
  issues: Issue[]
  stats: { items: number; cases: number; steps: number }
}
