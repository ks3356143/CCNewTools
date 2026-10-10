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
  /** 软件配置项名称（"测试说明"/"需求追踪表"章的标题用，如"XX软件配置项"） */
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

export interface PathEntry {
  /** 大纲中的绝对标题层级（3 = H3） */
  level: number
  text: string
}

export interface TestItem {
  /** 测试项名称（表格第 1 行第 2 格） */
  name: string
  /** 测试项标识（表格第 1 行第 4 格，原样） */
  itemId: string
  /** 测试项标题的完整章节号，如 6.2.1.4.1.1 */
  chapter: string
  /**
   * 从「测试项及方法」节下第一级到测试项标题的完整路径（含项标题自身）。
   * 生成文档按此逐级出标题（镜像大纲层级，槽位 = 序号 + 2），
   * 容器（配置项/分系统等）只是路径节点，不参与结构判断（2026-10-01 用户定稿）。
   */
  path: PathEntry[]
  /** 测试类型（兼容字段：路径中命中静态三类型名的层，否则第一个以「测试」结尾的层名，否则首层） */
  typeName: string
  /** 中间层（兼容字段：类型层与项标题之间的所有层拼接；相邻时为 null） */
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
  /** 准则格无标题的编号条目（单用例时按唯一用例整体配对，见 criteria.ts） */
  criteriaOrphans?: string[]
  /** 追踪关系格解析出的需求规格说明信息（追踪表用） */
  traceSrs: { chapter: string; desc: string }
  /** 追踪关系格解析出的研制任务书信息（大纲追踪表用；老文档通常没有 → undefined） */
  traceTask?: { chapter: string; desc: string }
}

export interface ParsedOutline {
  items: TestItem[]
  issues: Issue[]
  stats: { items: number; cases: number; steps: number }
}

/** 静态三类型名（转换层固定话术的键，解析层类型识别共用；03 转换层 STATIC_TEMPLATES 的键必须与此一致） */
export const STATIC_TYPE_NAMES = ['文档审查', '静态分析', '代码审查']

/**
 * 已知测试类型清单（静态三类型 + 军用软件测评常见动态类型）。
 * typeName 从路径最深层往上找第一个命中；容器名（如「XX星…配置项测试」）以「测试」结尾
 * 但不在清单内，不会误当类型。遇到清单外的新类型时回退后缀匹配（见 outline.ts）。
 */
export const KNOWN_TYPE_NAMES = [
  ...STATIC_TYPE_NAMES,
  '功能测试', '性能测试', '接口测试', '边界测试', '人机交互界面测试', '安全性测试',
  '余量测试', '强度测试', '恢复性测试', '安装性测试', '兼容性测试'
]
