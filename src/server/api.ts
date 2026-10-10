import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readDocx } from '../core/parse/docx.ts'
import { extractOutline } from '../core/parse/outline.ts'
import { extractRecordCases } from '../core/parse/record.ts'
import { extractReturnSpec, type ReturnSpecData } from '../core/parse/returnspec.ts'
import { convertToTemplateData } from '../core/convert/index.ts'
import type { CaseRow } from '../core/convert/rows.ts'
import { renderTemplate, renderTemplateBatched, stripAnchorMarks, type LoopSpec } from '../core/render/docx.ts'
import { applyVmergeToDocx } from '../core/render/vmerge.ts'
import { buildTraceTable, TYPE_VARS, TRACE_TEMPLATE_NAMES } from '../core/trace/build.ts'
import type { TraceRowVM, TraceTable } from '../core/trace/table.ts'
import { IssueCollector, DEFAULT_PARAMS, type GlobalParams } from '../core/domain.ts'
import { sha132, mergeRestored, EDIT_STATE_VERSION, type EditState, type StoredCase } from '../core/persistence.ts'
import { loadSettings, saveSettings, dataRoot, type Settings } from './store.ts'
import {
  listProjects, loadProject, deleteProject, recordParse, recordGenerated,
  loadProjectEdits, saveProjectEdits, projectId, sourceFileOf, sourceTypeOf
} from './projects.ts'
import { appendLog } from './log.ts'
import { EMBEDDED_TEMPLATES } from './assets.ts'
import { VERSION } from './app.ts'

function templateFile(name: string): Buffer {
  // 单文件编译形态：嵌入模板优先（M6）；开发形态回退磁盘 模板/ 目录
  const embedded = EMBEDDED_TEMPLATES[name]
  if (embedded !== undefined) return readFileSync(embedded)
  return readFileSync(join(process.cwd(), '模板', name))
}

/** API 路由（F1~F7 的服务端部分） */

/** 核对进度（05：可疑判定唯一入口在前端，服务端只随存档透传展示） */
interface EditProgress {
  reviewed: number
  suspects: number
}

/**
 * 生成回退开关（10-大文档处理 5.2）：≤该用例数走整体渲染（成熟路径零风险），
 * 超过走分批渲染（逐批即用即弃，内存与用例总数脱钩——实测 29686 例整体渲染 6.7GB，
 * 分批后峰值 <1GB）。v1.3.0 起生成上限撤销。
 */
const BATCH_RENDER_THRESHOLD = 500

/**
 * 测试记录文档的用例数边界（2026-10-09 42MB 实测发现的产品边界）：
 * 记录模板每例 ~38KB XML（记录表+步骤+签字栏结构），29686 例产物解压后 1.1GB——
 * Word 物理上打不开（非生成过程问题，是产物体积边界）。2000 例 ≈ 76MB XML 为
 * Word 可用的保守上限；超限只生成测试说明并明确告知（说明每例 ~1.2KB，35MB@29686 可用）。
 */
const RECORD_CASE_LIMIT = 2000

/** 分批渲染的循环区配置（与模板锚点手术的锚点名对应；两份模板同一 cases 锚点名） */
const SPEC_LOOPS: LoopSpec[] = [
  { field: 'caselist', begin: '_CL_BEGIN_', end: '_CL_END_', batchSize: 1000 },
  { field: 'traceRows', begin: '_TR_BEGIN_', end: '_TR_END_', batchSize: 1000 },
  { field: 'cases', begin: '_CT_BEGIN_', end: '_CT_END_', batchSize: 300 }
]
const REC_LOOPS: LoopSpec[] = [
  { field: 'cases', begin: '_CT_BEGIN_', end: '_CT_END_', batchSize: 300 }
]

/** 追踪文档的循环区配置（模板/追踪-*.docx 四套模板锚点同构，循环字段同名 traceRows） */
const TRACE_LOOPS: LoopSpec[] = [
  { field: 'traceRows', begin: '_TR_BEGIN_', end: '_TR_END_', batchSize: 1000 }
]

const TRACE_MODES = ['outline', 'spec', 'report', 'returnSpec'] as const
type TraceMode = (typeof TRACE_MODES)[number]

/** 解析大纲 → 转换层用例行（恢复编辑保持排除口径；trace/parse 的大纲通道与 /api/parse 同源） */
function parseOutlineCases(name: string, hash: string, bytes: Uint8Array): { cases: CaseRow[]; stats: { items: number; cases: number; steps: number } } {
  const r = parseAndRestore(name, hash, bytes)
  return { cases: r.cases, stats: r.stats }
}

/** 解析大纲并套回项目内已存编辑（/api/parse 与 打开项目 共用，09） */
function parseAndRestore(name: string, hash: string, bytes: Uint8Array) {
  const t0 = Date.now()
  const office = readDocx(bytes)
  const issues = new IssueCollector()
  const parsed = extractOutline(office, issues)
  // 大文档分块模式的耗时随解析日志落盘（10-大文档处理 4.4 验收项）
  const mode = office.chunked ? `，大文档分块解析 ${Date.now() - t0}ms` : ''

  const settings = loadSettings()
  // 老设置文件可能缺新字段（如 configName），合并默认值
  const params: GlobalParams = { ...DEFAULT_PARAMS, ...(settings.params ?? {}) }
  const fresh = convertToTemplateData(parsed, params)

  const state = loadProjectEdits(projectId(hash))
  let cases: CaseRow[] = fresh.cases
  let restored = { cases: 0, steps: 0, skipped: 0 }
  if (state !== null) {
    const r = mergeRestored(fresh.cases, state.cases)
    cases = r.cases
    restored = { cases: r.restoredCases, steps: r.restoredSteps, skipped: r.skippedCases }
    appendLog(`解析 ${name}（哈希 ${hash.slice(0, 8)}）：恢复 ${r.restoredCases} 例 / ${r.restoredSteps} 步，跳过 ${r.skippedCases} 例${mode}`)
  } else {
    appendLog(`解析 ${name}（哈希 ${hash.slice(0, 8)}）：${parsed.stats.items} 项 / ${parsed.stats.cases} 例 / ${parsed.stats.steps} 步${mode}`)
  }

  return {
    outline: { name: name, hash: hash },
    stats: parsed.stats,
    // 解析层 + 转换层告警都要上界面（2026-10-01 对抗审查：此前 fresh.issues 被丢弃，
    // 准则条数不等/一句话共用/用例标识撞号等转换层告警在界面不可见）
    issues: parsed.issues.concat(fresh.issues),
    cases: cases,
    params: params,
    theme: settings.theme,
    restored: restored
  }
}

export async function handleApi(req: Request, url: URL): Promise<Response> {
  try {
    if (url.pathname === '/api/ping') {
      return Response.json({ ok: true, version: VERSION, ts: Date.now() })
    }
    if (url.pathname === '/api/settings' && req.method === 'GET') {
      return Response.json({ ok: true, ...loadSettings() })
    }
    if (url.pathname === '/api/settings' && req.method === 'POST') {
      const body = (await req.json()) as Settings
      saveSettings(body)
      return Response.json({ ok: true })
    }
    if (url.pathname === '/api/parse' && req.method === 'POST') {
      return await apiParse(req)
    }
    if (url.pathname === '/api/edits' && req.method === 'POST') {
      const body = (await req.json()) as { outline: { name: string; hash: string }; cases: CaseRow[]; progress?: EditProgress | null }
      await saveEdits(body.outline, body.cases, body.progress ?? null)
      return Response.json({ ok: true })
    }
    if (url.pathname === '/api/generate' && req.method === 'POST') {
      return await apiGenerate(req)
    }
    // 追踪工具（工具二，12-追踪文档工具 v2）：四类追踪表
    if (url.pathname === '/api/trace/parse' && req.method === 'POST') {
      return await apiTraceParse(req)
    }
    if (url.pathname === '/api/trace/open' && req.method === 'POST') {
      return await apiTraceOpen(req)
    }
    if (url.pathname === '/api/trace/generate' && req.method === 'POST') {
      return await apiTraceGenerate(req)
    }
    // 项目制本地数据管理（09）
    if (url.pathname === '/api/projects' && req.method === 'GET') {
      return Response.json({ ok: true, projects: listProjects() })
    }
    if (url.pathname === '/api/projects/open' && req.method === 'POST') {
      const body = (await req.json()) as { id: string }
      const p = loadProject(body.id)
      if (p === null) {
        return Response.json({ ok: false, error: '项目不存在' }, { status: 400 })
      }
      if (!p.meta.hasSource) {
        return Response.json({ ok: false, needsSource: true, error: '该项目没有源文件副本，请重新上传原大纲', name: p.meta.name })
      }
      const buf = readFileSync(sourceFileOf(p.meta.id))
      const data = parseAndRestore(p.meta.name, p.meta.hash, new Uint8Array(buf))
      appendLog('打开项目 ' + p.meta.name)
      return Response.json({ ok: true, ...data })
    }
    const mDelete = url.pathname.match(/^\/api\/projects\/([0-9a-f]{12})$/)
    if (mDelete !== null && req.method === 'DELETE') {
      deleteProject(mDelete[1])
      return Response.json({ ok: true })
    }
    return Response.json({ ok: false, error: '未知接口 ' + url.pathname }, { status: 404 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    appendLog('ERROR ' + msg)
    return Response.json({ ok: false, error: msg }, { status: 400 })
  }
}

async function apiParse(req: Request): Promise<Response> {
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) {
    return Response.json({ ok: false, error: '缺少上传文件' }, { status: 400 })
  }
  const name = file.name || '未命名.docx'
  const bytes = new Uint8Array(await file.arrayBuffer())
  const hash = sha132(bytes)

  try {
    const data = parseAndRestore(name, hash, bytes)
    // 解析成功自动建档/更新（09）：写源副本、刷统计，已有编辑保留
    recordParse(name, hash, bytes, data.stats)
    return Response.json({ ok: true, ...data })
  } catch (e) {
    // 外层 catch 只记 ERROR 无上下文；这里补上文件名与大小，内网排障一眼定位是哪份文件、多大
    const msg = e instanceof Error ? e.message : String(e)
    appendLog(`解析 ${name}（${(bytes.length / 1048576).toFixed(1)}MB）失败：${msg}`)
    return Response.json({ ok: false, error: msg }, { status: 400 })
  }
}

function storedCasesOf(cases: CaseRow[]): StoredCase[] {
  return cases.map(c => ({
    caseId: c.caseId,
    reviewed: c.reviewed,
    excluded: c.excluded,
    dismissedSuspects: c.dismissedSuspects,
    steps: c.steps.map(s => ({ action: s.action, expect: s.expect }))
  }))
}

async function saveEdits(
  outline: { name: string; hash: string },
  cases: CaseRow[],
  progress: EditProgress | null
): Promise<void> {
  const state: EditState = {
    version: EDIT_STATE_VERSION,
    outline: outline,
    savedAt: new Date().toISOString(),
    cases: storedCasesOf(cases)
  }
  // 编辑存进项目文件（09），progress 随存档上报供列表展示
  saveProjectEdits(outline, state, progress)
  appendLog(`保存编辑：${outline.name}（${state.cases.length} 例）`)
}

async function apiGenerate(req: Request): Promise<Response> {
  const body = (await req.json()) as { outline: { name: string; hash?: string }; cases: CaseRow[]; params: GlobalParams }
  const cases = body.cases.filter(c => !c.excluded)
  if (cases.length === 0) {
    return Response.json({ ok: false, error: '没有可生成的用例（全部被排除？）' }, { status: 400 })
  }
  // 用例清单 + 追踪表由送来的用例数据推导（保持与核对结果一致）
  const caselist = cases.map((c, i) => ({ no: i + 1, mingcheng: c.mingcheng, caseId: c.caseId, summary: c.summary }))
  const traceRows = cases.map((c, i) => ({
    no: i + 1,
    srsChapter: c.srsChapter,
    srsDesc: c.srsDesc,
    outlineChapter: c.chapter,
    itemName: c.itemName,
    itemItemId: c.itemItemId,
    caseName: c.mingcheng,
    caseId: c.caseId
  }))
  const configName = body.params?.configName ?? ''
  // ≤500 例走整体渲染（成熟路径），>500 例走分批渲染（内存与总数脱钩——10-大文档处理 5.2）
  const batched = cases.length > BATCH_RENDER_THRESHOLD
  const t0 = Date.now()
  const specBuf = batched
    ? renderTemplateBatched(templateFile('测试说明模板.docx'), { cases, caselist, traceRows, configName }, SPEC_LOOPS)
    : stripAnchorMarks(renderTemplate(templateFile('测试说明模板.docx'), { cases, caselist, traceRows, configName }))
  // 记录文档边界：超 2000 例产物 XML 超出 Word 可用范围（实测 1.1GB@29686），跳过并告知
  const recSkipped = cases.length > RECORD_CASE_LIMIT
  const recBuf = recSkipped
    ? null
    : batched
      ? renderTemplateBatched(templateFile('测试记录模板.docx'), { cases, configName }, REC_LOOPS)
      : stripAnchorMarks(renderTemplate(templateFile('测试记录模板.docx'), { cases, configName }))
  const elapsed = Date.now() - t0

  // 落盘交付（10-大文档处理 5.3）：产物写 数据/生成/<项目id12>/，浏览器不再承载大文件
  const id12 = body.outline.hash ? projectId(body.outline.hash) : null
  let files: Array<{ name: string; sizeKB: string; path: string }> = []
  if (id12) {
    const dir = join(dataRoot(), '生成', id12)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '测试说明-生成.docx'), specBuf)
    files.push({ name: '测试说明-生成.docx', sizeKB: (specBuf.length / 1024).toFixed(1), path: join(dir, '测试说明-生成.docx') })
    if (recBuf) {
      writeFileSync(join(dir, '测试记录-生成.docx'), recBuf)
      files.push({ name: '测试记录-生成.docx', sizeKB: (recBuf.length / 1024).toFixed(1), path: join(dir, '测试记录-生成.docx') })
    }
  }
  const mode = batched ? `分批渲染（${Math.ceil(cases.length / 300)} 批用例详情）` : '整体渲染'
  appendLog(`生成文档：${body.outline.name}，${cases.length} 例，${mode} ${elapsed}ms${recSkipped ? '，测试记录超 ' + RECORD_CASE_LIMIT + ' 例未生成' : ''}${id12 ? '，已落盘 数据/生成/' + id12 : ''}`)
  // 生成成功后更新项目元信息（09）
  if (body.outline.hash) recordGenerated(body.outline.hash)
  return Response.json({
    ok: true,
    files: files,
    recSkipped: recSkipped,
    recNote: recSkipped
      ? `用例数 ${cases.length} 超出测试记录文档的 Word 可用范围（上限 ${RECORD_CASE_LIMIT} 例），本批仅生成测试说明。如需完整测试记录，请把大纲按测试类型拆分成几个分册分别导入生成`
      : undefined,
    // ≤10MB 保留下载双轨（习惯延续）；大文档只给落盘路径，免浏览器大内存
    ...(specBuf.length <= 10 * 1024 * 1024 && recBuf && recBuf.length <= 10 * 1024 * 1024
      ? {
          spec: specBuf.toString('base64'),
          rec: recBuf.toString('base64')
        }
      : {}),
    // 固定文件名（2026-10-01 用户定稿）：与模板名区分的短名，不带大纲名前缀
    specName: '测试说明-生成.docx',
    recName: '测试记录-生成.docx'
  })
}

/**
 * 配对文档解析（12 v2.1：自动识别大纲/说明）。
 * 大纲：SRS/大纲章节号/项名/项标识/类型全有；说明：SRS 没有（留空人工补），其余取用例表追踪关系行。
 * 项目库 hash 按建档类型分派；上传文件先按大纲解析、失败转说明解析。
 */
async function resolveAlign(
  outlineHash: string,
  outlineFile: File | null
): Promise<{ kind: 'outline'; cases: CaseRow[]; info: { name: string; hash: string } } | { kind: 'spec'; rs: ReturnSpecData; info: { name: string; hash: string } } | { err: string }> {
  if (outlineHash !== '') {
    const p = loadProject(outlineHash.slice(0, 12))
    if (p === null || !p.meta.hasSource) {
      return { err: '所选配对项目无效或没有源文件副本，请重新选择或上传' }
    }
    const st = sourceTypeOf(p.meta)
    if (st === 'outline') {
      const ob = new Uint8Array(readFileSync(sourceFileOf(p.meta.id, 'outline')))
      return { kind: 'outline', cases: parseOutlineCases(p.meta.name, p.meta.hash, ob).cases, info: { name: p.meta.name, hash: p.meta.hash } }
    }
    if (st === 'spec') {
      const ob = new Uint8Array(readFileSync(sourceFileOf(p.meta.id, 'spec')))
      const iss = new IssueCollector()
      const rs = extractReturnSpec(readDocx(ob), iss)
      if (rs.cases.length === 0 && rs.items.length === 0) {
        return { err: '说明项目解析失败，请重新选择或上传' }
      }
      return { kind: 'spec', rs: rs, info: { name: p.meta.name, hash: p.meta.hash } }
    }
    return { err: '配对文档请选择大纲或说明项目' }
  }
  if (outlineFile !== null) {
    const ob = new Uint8Array(await outlineFile.arrayBuffer())
    const oh = sha132(ob)
    const n = outlineFile.name || '文档.docx'
    // 自动识别：先按大纲解析（找「测试项及方法」章），失败转说明解析
    try {
      const r = parseOutlineCases(n, oh, ob)
      recordParse(n, oh, ob, r.stats, 'outline')
      return { kind: 'outline', cases: r.cases, info: { name: n, hash: oh } }
    } catch {
      const iss = new IssueCollector()
      const rs = extractReturnSpec(readDocx(ob), iss)
      if (rs.cases.length === 0 && rs.items.length === 0) {
        return { err: '配对文档既不是测试大纲也不是测试说明（未识别到测试项表格或用例表）' }
      }
      recordParse(n, oh, ob, { items: rs.items.length, cases: rs.cases.length, steps: 0 }, 'spec')
      return { kind: 'spec', rs: rs, info: { name: n, hash: oh } }
    }
  }
  return { err: '报告追踪需要同时提供配对文档（大纲或说明，从项目库选择或上传）' }
}

/**
 * 追踪解析（12-追踪文档工具 v2）：四 tab 的第 1 步。
 * multipart: file=主文档（outline/spec=大纲；report=测试记录；returnSpec=回归说明），
 * mode=四类之一；report/returnSpec 另需大纲（outlineHash=项目库选现有，或 outlineFile=上传新大纲）。
 * 返回统一 TraceTable（双层表头 + rows[vmerge 标记] + 问题清单）。
 */
async function apiTraceParse(req: Request): Promise<Response> {
  const form = await req.formData()
  const mode = String(form.get('mode') ?? '') as TraceMode
  if (!TRACE_MODES.includes(mode)) {
    return Response.json({ ok: false, error: '未知追踪类型 ' + mode }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof File)) {
    return Response.json({ ok: false, error: '缺少上传文件' }, { status: 400 })
  }
  const name = file.name || '未命名.docx'
  const bytes = new Uint8Array(await file.arrayBuffer())
  const hash = sha132(bytes)
  try {
    const issues = new IssueCollector()
    const needOutline = mode === 'report' || mode === 'returnSpec'

    // 配对文档（report 必须配大纲或说明；回归说明仍只配大纲）。自动识别：大纲/说明二选一
    let alignCases: CaseRow[] = []
    let alignSpec: ReturnSpecData | null = null
    let outlineInfo: { name: string; hash: string } | null = null
    let alignKind: 'outline' | 'spec' | null = null
    if (needOutline) {
      const outlineFile = form.get('outlineFile')
      const aligned = await resolveAlign(String(form.get('outlineHash') ?? ''), outlineFile instanceof File ? outlineFile : null)
      if ('err' in aligned) {
        return Response.json({ ok: false, error: aligned.err }, { status: 400 })
      }
      if (mode === 'returnSpec' && aligned.kind === 'spec') {
        return Response.json({ ok: false, error: '回归说明追踪的配对文档请选择测试大纲（回归说明自身编号不能替代大纲章节号）' }, { status: 400 })
      }
      alignKind = aligned.kind
      outlineInfo = aligned.info
      if (aligned.kind === 'outline') alignCases = aligned.cases
      else alignSpec = aligned.rs
    }

    // 主文档解析 + 表构建
    let spec: TraceTable
    let primaryStats: { items: number; cases: number; steps: number } | null = null
    if (mode === 'outline' || mode === 'spec') {
      // 主文档自动识别：先按大纲解析（找「测试项及方法」章），失败转说明文档解析
      let specAlign: ReturnSpecData | null = null
      let r: { cases: CaseRow[]; stats: { items: number; cases: number; steps: number } }
      let parsedAs: 'outline' | 'spec' = 'outline'
      try {
        r = parseOutlineCases(name, hash, bytes)
      } catch (e) {
        const rs = extractReturnSpec(readDocx(bytes), issues)
        if (rs.cases.length === 0 && rs.items.length === 0) throw e
        parsedAs = 'spec'
        specAlign = rs
        r = { cases: [], stats: { items: rs.items.length, cases: rs.cases.length, steps: 0 } }
      }
      primaryStats = r.stats
      if (parsedAs === 'spec') {
        if (mode === 'outline') {
          throw new Error('大纲追踪表需要测试大纲（识别到的是说明/回归说明文档，请切到说明追踪）')
        }
        spec = buildTraceTable({ type: 'spec', specAlign: specAlign! }, issues)
      } else {
        spec = buildTraceTable({ type: mode, outlineCases: r.cases }, issues)
      }
      recordParse(name, hash, bytes, r.stats, parsedAs)
      outlineInfo = { name: name, hash: hash }
    } else if (mode === 'report') {
      const office = readDocx(bytes)
      const records = extractRecordCases(office, issues)
      if (records.length === 0) {
        return Response.json({ ok: false, error: issues.issues.find(i => i.level === 'error')?.message ?? '未识别到用例记录表' }, { status: 400 })
      }
      primaryStats = { items: records.length, cases: records.length, steps: records.reduce((a, r) => a + r.stepCount, 0) }
      recordParse(name, hash, bytes, primaryStats, 'record', outlineInfo?.hash)
      spec = buildTraceTable(
        alignKind === 'spec'
          ? { type: 'report', specAlign: alignSpec!, records: records }
          : { type: 'report', outlineCases: alignCases, records: records },
        issues
      )
    } else {
      const office = readDocx(bytes)
      const rs = extractReturnSpec(office, issues)
      if (rs.cases.length === 0 && rs.items.length === 0) {
        return Response.json({ ok: false, error: issues.issues.find(i => i.level === 'error')?.message ?? '未识别到回归说明的测试项与用例表' }, { status: 400 })
      }
      primaryStats = { items: rs.items.length, cases: rs.cases.length, steps: 0 }
      recordParse(name, hash, bytes, primaryStats, 'returnSpec', outlineInfo?.hash)
      spec = buildTraceTable({ type: 'returnSpec', outlineCases: alignCases, returnSpec: rs }, issues)
    }

    appendLog(`追踪解析[${mode}]：${name}，${spec.rows.length} 行${outlineInfo !== null ? '，配对' + (alignKind === 'spec' ? '说明' : '大纲') + ' ' + outlineInfo.name : ''}，告警 ${issues.issues.filter(i => i.level !== 'info').length}`)
    return Response.json({
      ok: true,
      traceType: mode,
      spec: spec,
      issues: issues.issues,
      stats: primaryStats ?? { items: 0, cases: 0, steps: 0 },
      outline: outlineInfo,
      alignKind: alignKind,
      primary: { name: name, hash: hash }
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    appendLog(`追踪解析[${mode}] ${name}（${(bytes.length / 1048576).toFixed(1)}MB）失败：${msg}`)
    return Response.json({ ok: false, error: msg }, { status: 400 })
  }
}

/**
 * 追踪工具打开最近项目（12 v2）：按项目 sourceType 分派重建追踪表。
 * outline 项目按 mode（outline/spec）重建；record/returnSpec 用 meta.alignHash
 * （或请求指定）从项目库重配大纲。
 */
async function apiTraceOpen(req: Request): Promise<Response> {
  const body = (await req.json()) as { id: string; mode?: TraceMode; alignHash?: string }
  const p = loadProject(body.id)
  if (p === null) {
    return Response.json({ ok: false, error: '项目不存在' }, { status: 400 })
  }
  if (!p.meta.hasSource) {
    return Response.json({ ok: false, needsSource: true, error: '该项目没有源文件副本，请重新上传原文档', name: p.meta.name }, { status: 400 })
  }
  try {
    const st = sourceTypeOf(p.meta)
    const issues = new IssueCollector()
    const buf = new Uint8Array(readFileSync(sourceFileOf(p.meta.id, st)))
    if (st === 'outline' || st === 'spec') {
      // 大纲项目按 mode 重建（6/8 列表）；说明项目只出说明追踪表（8 列，SRS 留空）
      if (st === 'spec' && body.mode === 'outline') {
        return Response.json({ ok: false, error: '大纲追踪表需要测试大纲项目，请在说明追踪下打开该说明项目' }, { status: 400 })
      }
      const mode: TraceMode = st === 'spec' ? 'spec' : body.mode === 'outline' ? 'outline' : 'spec'
      if (st === 'spec') {
        const iss = new IssueCollector()
        const rs = extractReturnSpec(readDocx(buf), iss)
        if (rs.cases.length === 0 && rs.items.length === 0) {
          return Response.json({ ok: false, error: '说明项目解析失败，请重新上传' }, { status: 400 })
        }
        const spec = buildTraceTable({ type: 'spec', specAlign: rs }, issues)
        appendLog(`追踪打开[spec×说明] ` + p.meta.name)
        return Response.json({
          ok: true, traceType: 'spec', spec: spec, issues: issues.issues,
          stats: { items: rs.items.length, cases: rs.cases.length, steps: 0 },
          alignKind: 'spec',
          outline: { name: p.meta.name, hash: p.meta.hash }, primary: { name: p.meta.name, hash: p.meta.hash }
        })
      }
      const r = parseOutlineCases(p.meta.name, p.meta.hash, buf)
      const spec = buildTraceTable({ type: mode, outlineCases: r.cases }, issues)
      appendLog(`追踪打开[${mode}] ` + p.meta.name)
      return Response.json({
        ok: true, traceType: mode, spec: spec, issues: issues.issues, stats: r.stats,
        alignKind: 'outline',
        outline: { name: p.meta.name, hash: p.meta.hash }, primary: { name: p.meta.name, hash: p.meta.hash }
      })
    }
    const aligned = await resolveAlign(body.alignHash ?? p.meta.alignHash ?? '', null)
    if ('err' in aligned) {
      return Response.json({ ok: false, alignMissing: true, error: '打开该项目需要重新配对文档：' + aligned.err }, { status: 400 })
    }
    let spec: TraceTable
    let stats: { items: number; cases: number; steps: number }
    if (st === 'record') {
      const office = readDocx(buf)
      const records = extractRecordCases(office, issues)
      if (records.length === 0) {
        return Response.json({ ok: false, error: '未识别到用例记录表，请重新上传测试记录' }, { status: 400 })
      }
      stats = { items: records.length, cases: records.length, steps: records.reduce((a, r) => a + r.stepCount, 0) }
      spec = buildTraceTable(
        aligned.kind === 'spec'
          ? { type: 'report', specAlign: aligned.rs, records: records }
          : { type: 'report', outlineCases: aligned.cases, records: records },
        issues
      )
    } else {
      const office = readDocx(buf)
      const rs = extractReturnSpec(office, issues)
      stats = { items: rs.items.length, cases: rs.cases.length, steps: 0 }
      spec = buildTraceTable({ type: 'returnSpec', outlineCases: aligned.kind === 'outline' ? aligned.cases : [], returnSpec: rs }, issues)
    }
    appendLog(`追踪打开[${st}] ` + p.meta.name + '，配对' + (aligned.kind === 'spec' ? '说明' : '大纲') + ' ' + aligned.info.name)
    return Response.json({
      ok: true, traceType: st, spec: spec, issues: issues.issues, stats: stats,
      alignKind: aligned.kind,
      outline: aligned.info, primary: { name: p.meta.name, hash: p.meta.hash }
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    appendLog('ERROR 追踪打开失败 ' + msg)
    return Response.json({ ok: false, error: msg }, { status: 400 })
  }
}

/**
 * 追踪文档生成（12-追踪文档工具 v2）：前端送来编辑后的 rows（执行结果列可改），
 * 按类型选四套模板渲染 + vMerge 后处理。
 */
async function apiTraceGenerate(req: Request): Promise<Response> {
  const body = (await req.json()) as {
    traceType: TraceMode
    rows: TraceRowVM[]
    primary: { name: string; hash?: string }
    configName?: string
  }
  if (!TRACE_MODES.includes(body.traceType)) {
    return Response.json({ ok: false, error: '未知追踪类型' }, { status: 400 })
  }
  const rows = body.rows
  if (!Array.isArray(rows) || rows.length === 0 || !Array.isArray(rows[0]?.cells)) {
    return Response.json({ ok: false, error: '没有可生成的追踪表行' }, { status: 400 })
  }
  const vars = TYPE_VARS[body.traceType]
  const colN = vars.length
  for (const r of rows) {
    if (!Array.isArray(r.cells) || r.cells.length !== colN) {
      return Response.json({ ok: false, error: '追踪表行数据与列数不符，请回到第 1 步重新解析' }, { status: 400 })
    }
  }
  const data = rows.map(r => {
    const o: Record<string, string> = {}
    vars.forEach((v, i) => (o[v] = r.cells[i]))
    return o
  })
  // 题注 configName 服务端从设置取（追踪工具无参数卡，12 v2 起前端不传）
  const settings = loadSettings()
  const configName = body.configName ?? settings.params?.configName ?? ''
  const t0 = Date.now()
  const tmpl = templateFile(TRACE_TEMPLATE_NAMES[body.traceType])
  const buf0 = rows.length > BATCH_RENDER_THRESHOLD
    ? renderTemplateBatched(tmpl, { traceRows: data, configName: body.configName ?? '' }, TRACE_LOOPS)
    : stripAnchorMarks(renderTemplate(tmpl, { traceRows: data, configName: body.configName ?? '' }))
  // vMerge 后处理：按 span 标记对数据行做纵向合并（双层表头 = 2 行）
  const buf = applyVmergeToDocx(buf0, rows, 2)
  const elapsed = Date.now() - t0

  // 落盘交付（10-大文档处理 5.3 规则沿用）：写 数据/生成/<项目id12>/，≤10MB 附 base64 下载
  const id12 = body.primary.hash ? projectId(body.primary.hash) : null
  const name = '追踪文档-生成.docx'
  let files: Array<{ name: string; sizeKB: string; path: string }> = []
  if (id12) {
    const dir = join(dataRoot(), '生成', id12)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, name), buf)
    files.push({ name: name, sizeKB: (buf.length / 1024).toFixed(1), path: join(dir, name) })
  }
  const batched = rows.length > BATCH_RENDER_THRESHOLD
  const mode = batched ? `分批渲染（${Math.ceil(rows.length / 1000)} 批追踪行）` : '整体渲染'
  appendLog(`生成追踪文档[${body.traceType}]：${body.primary.name}，${rows.length} 行，${mode} ${elapsed}ms${id12 ? '，已落盘 数据/生成/' + id12 : ''}`)
  if (body.primary.hash) recordGenerated(body.primary.hash)
  return Response.json({
    ok: true,
    name: name,
    sizeKB: (buf.length / 1024).toFixed(1),
    files: files,
    // ≤10MB 保留下载双轨（习惯延续）；大文档只给落盘路径，免浏览器大内存
    ...(buf.length <= 10 * 1024 * 1024 ? { doc: buf.toString('base64') } : {})
  })
}
