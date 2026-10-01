import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readDocx } from '../core/parse/docx.ts'
import { extractOutline } from '../core/parse/outline.ts'
import { convertToTemplateData } from '../core/convert/index.ts'
import type { CaseRow } from '../core/convert/rows.ts'
import { renderTemplate } from '../core/render/docx.ts'
import { IssueCollector, DEFAULT_PARAMS, type GlobalParams } from '../core/domain.ts'
import { sha132, mergeRestored, EDIT_STATE_VERSION, type EditState, type StoredCase } from '../core/persistence.ts'
import { loadSettings, saveSettings, type Settings } from './store.ts'
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

/** 解析大纲并套回项目内已存编辑（/api/parse 与 打开项目 共用，09） */
function parseAndRestore(name: string, hash: string, bytes: Uint8Array) {
  const office = readDocx(bytes)
  const issues = new IssueCollector()
  const parsed = extractOutline(office, issues)

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
    appendLog(`解析 ${name}（哈希 ${hash.slice(0, 8)}）：恢复 ${r.restoredCases} 例 / ${r.restoredSteps} 步，跳过 ${r.skippedCases} 例`)
  } else {
    appendLog(`解析 ${name}（哈希 ${hash.slice(0, 8)}）：${parsed.stats.items} 项 / ${parsed.stats.cases} 例 / ${parsed.stats.steps} 步`)
  }

  return {
    outline: { name: name, hash: hash },
    stats: parsed.stats,
    issues: parsed.issues,
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

  const data = parseAndRestore(name, hash, bytes)
  // 解析成功自动建档/更新（09）：写源副本、刷统计，已有编辑保留
  recordParse(name, hash, bytes, data.stats)
  return Response.json({ ok: true, ...data })
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
  const specBuf = renderTemplate(templateFile('测试说明模板.docx'), {
    cases: cases, caselist: caselist, traceRows: traceRows, configName: configName
  })
  const recBuf = renderTemplate(templateFile('测试记录模板.docx'), { cases: cases, configName: configName })
  appendLog(`生成文档：${body.outline.name}，${cases.length} 例`)
  // 生成成功后更新项目元信息（09）：文档本体不落盘
  if (body.outline.hash) recordGenerated(body.outline.hash)
  return Response.json({
    ok: true,
    spec: specBuf.toString('base64'),
    rec: recBuf.toString('base64'),
    // 固定文件名（2026-10-01 用户定稿）：与模板名区分的短名，不带大纲名前缀
    specName: '测试说明-生成.docx',
    recName: '测试记录-生成.docx'
  })
}
