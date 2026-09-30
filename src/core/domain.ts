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
  init: string
  constraint: string
  designer: string
  testTime: string
  tester: string
  monitor: string
}

export const DEFAULT_PARAMS: GlobalParams = {
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
  steps: RawStep[]
}

export interface DescriptionEntry {
  itemId: string
  summary: string
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
  /** 通过准则格的原始段落（9.5，转换层决定是否采用） */
  criteria: { text: string; numId: string | null }[]
}

export interface ParsedOutline {
  items: TestItem[]
  issues: Issue[]
  stats: { items: number; cases: number; steps: number }
}
