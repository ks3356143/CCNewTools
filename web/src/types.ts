/** 前端共享类型：直接复用 core 的类型定义（type-only import，构建时擦除） */
import type { CaseRow } from '../../src/core/convert/rows.ts'
import type { Issue } from '../../src/core/domain.ts'
import type { GlobalParams } from '../../src/core/domain.ts'
import type { TraceTable, TraceRowVM, TraceHeadGroup } from '../../src/core/trace/table.ts'

export type { CaseRow, Issue, GlobalParams, TraceTable, TraceRowVM, TraceHeadGroup }

/** 追踪工具的四种表类型（12-追踪文档工具 v2） */
export type TraceType = 'outline' | 'spec' | 'report' | 'returnSpec'

export interface ParseResponse {
  ok: boolean
  error?: string
  outline: { name: string; hash: string }
  stats: { items: number; cases: number; steps: number }
  issues: Issue[]
  cases: CaseRow[]
  params: GlobalParams
  theme: string
  restored: { cases: number; steps: number; skipped: number }
}

/** 项目元信息（GET /api/projects 返回的每一行，见 SRS/设计/09-本地数据管理.md） */
export interface ProjectMeta {
  id: string
  name: string
  hash: string
  addedAt: string
  updatedAt: string
  lastGeneratedAt?: string
  hasSource: boolean
  stats: { items: number; cases: number; steps: number } | null
  progress: { reviewed: number; suspects: number } | null
}

export interface GeneratedFile {
  name: string
  sizeKB: string
  path: string
}

export interface GenerateResponse {
  ok: boolean
  error?: string
  /** 产物落盘信息（v1.3.0 起恒有：数据/生成/<项目>/ 下生成的文档） */
  files?: GeneratedFile[]
  /** 测试记录超 Word 可用边界被跳过时为 true（v1.3.0），recNote 给说明 */
  recSkipped?: boolean
  recNote?: string
  /** base64 下载双轨：≤10MB 时携带，大文档不传（免浏览器大内存） */
  spec?: string
  rec?: string
  specName: string
  recName: string
}

/** 树目录节点：按完整大纲路径逐级构建（与生成文档同构；2026-10-02 树镜像改造） */
export interface PathNode {
  /** 全链 key（祖先链参与），同名节点在不同分支不合并 */
  key: string
  name: string
  children: PathNode[]
  /** 挂在该层的用例（最深层=测试项级） */
  cases: { row: CaseRow; idx: number }[]
  /** 子树用例总数（自下而上累加） */
  caseCount: number
}
