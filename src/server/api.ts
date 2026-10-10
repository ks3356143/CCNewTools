import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readDocx } from '../core/parse/docx.ts'
import { extractOutline } from '../core/parse/outline.ts'
import { convertToTemplateData } from '../core/convert/index.ts'
import type { CaseRow } from '../core/convert/rows.ts'
import { renderTemplate, renderTemplateBatched, stripAnchorMarks, type LoopSpec } from '../core/render/docx.ts'
import { IssueCollector, DEFAULT_PARAMS, type GlobalParams } from '../core/domain.ts'
import { sha132, mergeRestored, EDIT_STATE_VERSION, type EditState, type StoredCase } from '../core/persistence.ts'
import { loadSettings, saveSettings, dataRoot, type Settings } from './store.ts'
import {
  listProjects, loadProject, deleteProject, recordParse, recordGenerated,
  loadProjectEdits, saveProjectEdits, projectId, sourceFileOf
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

/** 追踪文档的循环区配置（模板/追踪文档模板.docx 由测试说明模板截取追踪章生成，锚点同源继承） */
const TRACE_LOOPS: LoopSpec[] = [
  { field: 'traceRows', begin: '_TR_BEGIN_', end: '_TR_END_', batchSize: 1000 }
]

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
    // 追踪文档生成（工具二，12-追踪文档工具）：与 /api/generate 同源推导 traceRows
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

/** 追踪文档生成（工具二，12-追踪文档工具）：与 /api/generate 同源推导 traceRows，只出一份追踪文档 */
async function apiTraceGenerate(req: Request): Promise<Response> {
  const body = (await req.json()) as { outline: { name: string; hash?: string }; cases: CaseRow[]; configName?: string }
  const cases = body.cases.filter(c => !c.excluded)
  if (cases.length === 0) {
    return Response.json({ ok: false, error: '没有可生成的追踪表行（全部用例被排除？）' }, { status: 400 })
  }
  // 追踪表数据推导与 /api/generate 完全同源（列定义见 12-追踪文档工具）
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
  const configName = body.configName ?? ''
  const batched = cases.length > BATCH_RENDER_THRESHOLD
  const t0 = Date.now()
  const buf = batched
    ? renderTemplateBatched(templateFile('追踪文档模板.docx'), { traceRows: traceRows, configName: configName }, TRACE_LOOPS)
    : stripAnchorMarks(renderTemplate(templateFile('追踪文档模板.docx'), { traceRows: traceRows, configName: configName }))
  const elapsed = Date.now() - t0

  // 落盘交付（10-大文档处理 5.3 规则沿用）：写 数据/生成/<项目id12>/，≤10MB 附 base64 下载
  const id12 = body.outline.hash ? projectId(body.outline.hash) : null
  const name = '追踪文档-生成.docx'
  let files: Array<{ name: string; sizeKB: string; path: string }> = []
  if (id12) {
    const dir = join(dataRoot(), '生成', id12)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, name), buf)
    files.push({ name: name, sizeKB: (buf.length / 1024).toFixed(1), path: join(dir, name) })
  }
  const mode = batched ? `分批渲染（${Math.ceil(cases.length / 1000)} 批追踪行）` : '整体渲染'
  appendLog(`生成追踪文档：${body.outline.name}，${cases.length} 行，${mode} ${elapsed}ms${id12 ? '，已落盘 数据/生成/' + id12 : ''}`)
  if (body.outline.hash) recordGenerated(body.outline.hash)
  return Response.json({
    ok: true,
    name: name,
    sizeKB: (buf.length / 1024).toFixed(1),
    files: files,
    // ≤10MB 保留下载双轨（习惯延续）；大文档只给落盘路径，免浏览器大内存
    ...(buf.length <= 10 * 1024 * 1024 ? { doc: buf.toString('base64') } : {})
  })
}
