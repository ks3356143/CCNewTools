import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readDocx } from '../core/parse/docx.ts'
import { extractOutline } from '../core/parse/outline.ts'
import { convertToTemplateData } from '../core/convert/index.ts'
import type { CaseRow } from '../core/convert/rows.ts'
import { renderTemplate } from '../core/render/docx.ts'
import { IssueCollector, DEFAULT_PARAMS, type GlobalParams } from '../core/domain.ts'
import { sha132, editFileName, mergeRestored, type EditState, type StoredCase } from '../core/persistence.ts'
import { loadSettings, saveSettings, loadEditState, saveEditState, type Settings } from './store.ts'
import { appendLog } from './log.ts'

function templateFile(name: string): Buffer {
  return readFileSync(join(process.cwd(), '模板', name))
}

/** API 路由（F1~F7 的服务端部分） */

export async function handleApi(req: Request, url: URL): Promise<Response> {
  try {
    if (url.pathname === '/api/ping') {
      return Response.json({ ok: true, version: '0.1.0', ts: Date.now() })
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
      const body = (await req.json()) as { outline: { name: string; hash: string }; cases: CaseRow[] }
      await saveEdits(body.outline, body.cases)
      return Response.json({ ok: true })
    }
    if (url.pathname === '/api/generate' && req.method === 'POST') {
      return await apiGenerate(req)
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

  const office = readDocx(bytes)
  const issues = new IssueCollector()
  const parsed = extractOutline(office, issues)

  const settings = loadSettings()
  // 老设置文件可能缺新字段（如 configName），合并默认值
  const params: GlobalParams = { ...DEFAULT_PARAMS, ...(settings.params ?? {}) }
  const fresh = convertToTemplateData(parsed, params)

  const state = loadEditState(editFileName(name, hash))
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

  return Response.json({
    ok: true,
    outline: { name: name, hash: hash },
    stats: parsed.stats,
    issues: parsed.issues,
    cases: cases,
    params: params,
    theme: settings.theme,
    restored: restored
  })
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

function apiEdits(req: Request): Response {
  void req
  return Response.json({ ok: false, error: '内部未使用' }, { status: 404 })
}

export async function saveEdits(outline: { name: string; hash: string }, cases: CaseRow[]): Promise<void> {
  const state: EditState = {
    version: 1,
    outline: outline,
    savedAt: new Date().toISOString(),
    cases: storedCasesOf(cases)
  }
  saveEditState(editFileName(outline.name, outline.hash), state)
  appendLog(`保存编辑：${outline.name}（${state.cases.length} 例）`)
}

async function apiGenerate(req: Request): Promise<Response> {
  const body = (await req.json()) as { outline: { name: string }; cases: CaseRow[]; params: GlobalParams }
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
  const base = body.outline.name.replace(/\.docx$/i, '')
  appendLog(`生成文档：${body.outline.name}，${cases.length} 例`)
  return Response.json({
    ok: true,
    spec: specBuf.toString('base64'),
    rec: recBuf.toString('base64'),
    specName: '测试说明_' + base + '.docx',
    recName: '测试记录_' + base + '.docx'
  })
}
