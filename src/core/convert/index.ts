import type { ParsedOutline, GlobalParams, PathEntry } from '../domain.ts'
import { IssueCollector, KNOWN_TYPE_NAMES } from '../domain.ts'
import { buildRow, type CaseRow } from './rows.ts'

/** "测试说明"章的用例清单行（老说明第 4 章格式：序号/用例名称/用例标识/测试用例综述） */
export interface CaseListRow {
  no: number
  mingcheng: string
  caseId: string
  summary: string
}

/** "需求的可追踪性"章的追踪表行（老说明第 6 章格式） */
export interface TraceRow {
  no: number
  srsChapter: string
  srsDesc: string
  outlineChapter: string
  itemName: string
  itemItemId: string
  caseName: string
  caseId: string
}

/**
 * 领域模型 → 模板数据（01 数据流第 2 步）。
 * 标题槽位 head2~head9 挂在每个用例行上（2026-10-01 层级镜像改造，2026-10-13 扩容到 h9）：
 * 按测试项的 path（大纲路径）序号逐级映射模板标题层级（path[0]→h2 … 项标题→最深槽），
 * 槽的路径前缀与上一行不同才输出——分系统/容器等任意嵌套天然正确，
 * 跳级自动压缩（无组上浮行为保留），相邻同名层去重（静态类型不重复出标题）。
 * caselist = "测试说明"章用例清单；traceRows = "需求的可追踪性"章追踪表。
 * 被排除（不生成）的用例不进入任何表。
 */
export function convertToTemplateData(parsed: ParsedOutline, params: GlobalParams): {
  cases: CaseRow[]
  caselist: CaseListRow[]
  traceRows: TraceRow[]
  issues: IssueCollector['issues']
} {
  const cases: CaseRow[] = []
  const caselist: CaseListRow[] = []
  const traceRows: TraceRow[] = []
  const issues = new IssueCollector()
  // 各槽（head2~head9）上一行输出过的路径前缀；空串 = 尚未出现过任何标题
  const prevPrefix: string[] = ['', '', '', '', '', '', '', '']
  let warnedDeepPath = ''

  // —— 容器-类型语义重组（2026-10-12 内网 WQ 大纲反馈）——
  // 内网大纲经 WPS 等工具编辑后，类型标题可能与配置项容器写成同级（项内容直挂其下），
  // 文档镜像后出现「配置项测试/功能测试」同级反复。重组：path[0] 命中已知类型名时挂到
  // 最近一个「×××配置项测试」容器下；同名容器（去空白核名相同，WPS 可能留不可见差异）
  // 的 path[0] 统一用首个文本，让既有前缀去重把重复容器收成一次；遇到既非容器也非类型名
  // 的顶层标题（分系统等）时容器状态复位。黄金样本 path[0] 均非类型名，行为不变。
  const normKey = (t: string) => t.replace(/\s+/g, '')
  const isContainerName = (t: string) => normKey(t).endsWith('配置项测试')
  const isTypeName = (t: string) => KNOWN_TYPE_NAMES.includes(normKey(t))
  let curContainer: PathEntry | null = null
  // 收拢记忆：键 = 槽位\0祖先前缀 → 最近一次该槽在该祖先下输出的容器/类型文本。
  // 同名容器/类型在同一祖先下反复出现（WQ 形态：容器直挂项与类型组交错）只输出一次，
  // 项自动流入首次输出的标题下；不同祖先（不同容器/分系统）互不影响。
  const lastOut = new Map<string, string>()
  // 重组触发计数（2026-10-13 深探：内网验证需要可见信号——重组没触发 = 大纲形态与预期不同）
  let regroupCount = 0

  for (const item of parsed.items) {
    for (let i = 0; i < item.cases.length; i++) {
      const c = item.cases[i]
      const row = buildRow(item, c, params, issues)
      // 标识写重复（多配置项复制粘贴同 XQ → 同 YL 号）：按用户决定（2026-10-01）
      // 照原样生成、不告警——用户看生成文档自行修改

      // 标题槽位分配：path 超过 8 层时丢弃最浅的容器层（项标题必须落在 h9 内；2026-10-13 五槽→八槽扩容）
      let path = item.path
      if (path.length > 0 && isTypeName(path[0].text)) {
        // 类型直挂顶层：挂回最近的配置项容器（无容器可挂保持原样）
        if (curContainer !== null) {
          path = [curContainer, ...path]
          regroupCount++
        }
      } else if (path.length > 0 && isContainerName(path[0].text)) {
        if (curContainer === null || normKey(curContainer.text) !== normKey(path[0].text)) {
          curContainer = path[0] // 新容器（首个出现的文本为准）
        } else {
          path = [curContainer, ...path.slice(1)] // 同名容器归并：核名相同统一用首个文本
        }
      } else if (path.length > 0) {
        curContainer = null // 分系统等其他顶层标题：容器状态复位
      }
      if (path.length > 8) {
        path = path.slice(path.length - 8)
        if (item.path[0].text !== warnedDeepPath) {
          warnedDeepPath = item.path[0].text
          issues.warning('PATH_TOO_DEEP', '测试项「' + item.name + '」的标题层级超过 8 层，最浅的「' + item.path[0].text + '」层未在生成文档中体现', item.name)
        }
      }
      for (let s = 0; s < path.length; s++) {
        // 相邻同名层去重：静态类型（项名=类型名）不出深层标题，表格直接挂类型层下
        if (s > 0 && path[s].text === path[s - 1].text) continue
        const prefix = path.slice(0, s + 1).map(p => p.text).join('\u0000')
        if (prefix !== prevPrefix[s]) {
          const anc = s === 0 ? '' : path.slice(0, s).map(p => p.text).join('\u0000')
          if (isContainerName(path[s].text) || isTypeName(path[s].text)) {
            const lk = s + '\u0000' + anc
            if (lastOut.get(lk) === path[s].text) {
              prevPrefix[s] = prefix // 收拢：不重复出标题，但前缀照常推进供更深槽比较
              continue
            }
            lastOut.set(lk, path[s].text)
          }
          if (s === 0) row.head2 = path[s].text
          else if (s === 1) row.head3 = path[s].text
          else if (s === 2) row.head4 = path[s].text
          else if (s === 3) row.head5 = path[s].text
          else if (s === 4) row.head6 = path[s].text
          else if (s === 5) row.head7 = path[s].text
          else if (s === 6) row.head8 = path[s].text
          else row.head9 = path[s].text
          prevPrefix[s] = prefix
        }
      }

      cases.push(row)

      if (!row.excluded) {
        caselist.push({
          no: caselist.length + 1,
          mingcheng: row.mingcheng,
          caseId: row.caseId,
          summary: row.summary
        })
        traceRows.push({
          no: traceRows.length + 1,
          srsChapter: item.traceSrs.chapter,
          srsDesc: item.traceSrs.desc,
          outlineChapter: item.chapter,
          itemName: item.itemName,
          itemItemId: item.itemId,
          caseName: row.mingcheng,
          caseId: row.caseId
        })
      }
    }
  }
  // 重组触发提示（2026-10-13）：触发即说明大纲类型标题与容器同级（层级被编辑器调整过），
  // 让使用者一眼确认修复已生效；未触发而目录仍平铺 = 大纲形态超出预期，需要按实况迭代
  if (regroupCount > 0) {
    issues.info('PATH_REGROUP', '检测到 ' + regroupCount + ' 个测试项的类型标题（功能测试/文档审查等）与配置项容器写成同级，已自动归位到所属容器下生成', '测试项及方法')
  }
  return { cases: cases, caselist: caselist, traceRows: traceRows, issues: issues.issues }
}
