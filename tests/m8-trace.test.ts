import { describe, test, expect, beforeAll } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import PizZip from 'pizzip'
import { DOMParser } from '@xmldom/xmldom'
import { buildDocxBuffer, itemTable, DESC, METHOD } from './helpers/ooxml.ts'
import { handle } from '../src/server/app.ts'
import { renderTemplate, renderTemplateBatched, stripAnchorMarks, type LoopSpec } from '../src/core/render/docx.ts'
import { readFileSync } from 'node:fs'

/** M8 追踪文档工具（F10/12 号设计）：模板渲染 + /api/trace/generate 端到端 */

beforeAll(() => {
  process.env.CC_DATA_DIR = mkdtempSync(join(tmpdir(), 'cc-m8-'))
})

function start(): string {
  const server = Bun.serve({ port: 0, fetch: handle })
  return server.url.toString().replace(/\/$/, '')
}
const URL0 = start()

const TRACE_TPL = readFileSync(join(import.meta.dir, '../模板/追踪文档模板.docx'))
const TRACE_LOOPS: LoopSpec[] = [
  { field: 'traceRows', begin: '_TR_BEGIN_', end: '_TR_END_', batchSize: 1000 }
]

function sampleDocx(): Buffer {
  return buildDocxBuffer({
    content: [
      { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
      { kind: 'p', para: { text: '功能测试', heading: 4, numId: 1, ilvl: 3 } },
      {
        kind: 'tbl',
        rows: itemTable('某测试项', 'XQ_A_B', [
          [DESC, '1.用例一（XQ_A_B001）\n用例一综述。\n2.用例二（XQ_A_B002）\n用例二综述。'],
          [METHOD, '1.用例一（XQ_A_B001）\n1）打开界面，查看显示是否正确；\n2.用例二（XQ_A_B002）\n1）执行操作，查看结果是否正确；']
        ])
      }
    ]
  })
}

async function parse(name: string, buf: Buffer): Promise<any> {
  const form = new FormData()
  form.append('file', new File([new Uint8Array(buf)], name))
  const res = await fetch(URL0 + '/api/parse', { method: 'POST', body: form })
  return res.json()
}

function xmlOf(buf: Buffer): string {
  return (PizZip as any)(buf).file('word/document.xml').asText() as string
}
function textOf(buf: Buffer): string {
  return xmlOf(buf).replace(/<[^>]+>/g, '')
}
/** XML 良构断言（@xmldom/xmldom 0.9 的 onError 签名；error/fatalError 计 0 条才算过） */
function assertWellFormed(xml: string): void {
  const errors: string[] = []
  new DOMParser({
    onError: (level: unknown, msg: unknown) => {
      if (level === 'error' || level === 'fatalError') errors.push(String(msg))
    }
  }).parseFromString(xml, 'application/xml')
  expect(errors).toEqual([])
}

describe('M8 追踪文档模板', () => {
  test('模板结构：追踪章标题 + 题注 + 8 列表头，无工具一循环段残留', () => {
    const xml = xmlOf(TRACE_TPL)
    expect(xml).toContain('需求的可追踪性')
    // 题注断言打在剥标签文本上（{configName} 与"需求追踪表"在 XML 里分属两个 run）
    expect(textOf(TRACE_TPL as unknown as Buffer)).toContain('{configName}需求追踪表')
    for (const h of ['序号', '需求规格说明章节号', '需求规格说明描述', '大纲章节号', '测试项名称', '测试项标识', '测试用例名称', '测试用例标识']) {
      expect(textOf(TRACE_TPL as unknown as Buffer)).toContain(h)
    }
    expect(xml).toContain('{#traceRows}')
    expect(xml).not.toContain('{#cases}')
    expect(xml).not.toContain('{#caselist}')
  })

  test('渲染：数据全落位、无残留占位符、XML 良构', () => {
    const rows = [
      { no: 1, srsChapter: '3.1', srsDesc: '参数管理', outlineChapter: '6.2.1.4.1', itemName: '参数管理测试', itemItemId: 'XQ_A_B', caseName: '用例一', caseId: 'YL_A_B_001' },
      { no: 2, srsChapter: '3.1', srsDesc: '参数管理', outlineChapter: '6.2.1.4.1', itemName: '参数管理测试', itemItemId: 'XQ_A_B', caseName: '用例二', caseId: 'YL_A_B_002' }
    ]
    const buf = stripAnchorMarks(renderTemplate(TRACE_TPL, { traceRows: rows, configName: 'XX星测控软件' }))
    expect(buf.subarray(0, 2).toString()).toBe('PK')
    const text = textOf(buf)
    expect(text).toContain('XX星测控软件需求追踪表')
    for (const s of ['YL_A_B_001', 'YL_A_B_002', '6.2.1.4.1', '3.1', '参数管理']) {
      expect(text).toContain(s)
    }
    for (const bad of ['{traceRows}', '{no}', '{srsChapter}', '{caseId}', '{configName}', '_TR_BEGIN_', '_TR_END_']) {
      expect(text.includes(bad)).toBe(false)
    }
    assertWellFormed(xmlOf(buf))
  })

  test('分批渲染与整体渲染产物一致（剥离锚点后逐字节）', () => {
    const rows = Array.from({ length: 1201 }, (_, i) => ({
      no: i + 1, srsChapter: '3.' + (i % 9 + 1), srsDesc: '描述' + i, outlineChapter: '6.2.' + i,
      itemName: '项' + (i % 7), itemItemId: 'XQ_' + (i % 7), caseName: '用例' + i, caseId: 'YL_' + i
    }))
    const whole = stripAnchorMarks(renderTemplate(TRACE_TPL, { traceRows: rows, configName: 'C' }))
    const batched = stripAnchorMarks(renderTemplateBatched(TRACE_TPL, { traceRows: rows, configName: 'C' }, TRACE_LOOPS))
    expect(xmlOf(batched)).toBe(xmlOf(whole))
  })
})

describe('M8 /api/trace/generate', () => {
  test('端到端：解析 → 生成追踪文档（base64 双轨、行数据正确）', async () => {
    const data = await parse('测试大纲T.docx', sampleDocx())
    expect(data.ok).toBe(true)
    const cases = data.cases as any[]
    expect(cases.length).toBe(2)
    const res = await fetch(URL0 + '/api/trace/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outline: data.outline, cases: cases, configName: 'XX星测控软件' })
    })
    const r = await res.json()
    expect(r.ok).toBe(true)
    expect(r.name).toBe('追踪文档-生成.docx')
    expect(r.doc).toBeTruthy()
    const buf = Buffer.from(r.doc, 'base64')
    expect(buf.subarray(0, 2).toString()).toBe('PK')
    const text = textOf(buf)
    expect(text).toContain('YL_A_B_001')
    expect(text).toContain('YL_A_B_002')
    expect(text).toContain('XX星测控软件需求追踪表')
    // 生成文档也过 officecli 语义级校验由发版验证覆盖；这里保 XML 良构
    assertWellFormed(xmlOf(buf))
  })

  test('排除用例不入追踪表（与工具一口径一致）', async () => {
    const data = await parse('测试大纲T.docx', sampleDocx())
    const cases = (data.cases as any[]).map((c, i) => (i === 0 ? { ...c, excluded: true } : c))
    const res = await fetch(URL0 + '/api/trace/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outline: data.outline, cases: cases })
    })
    const r = await res.json()
    expect(r.ok).toBe(true)
    const text = textOf(Buffer.from(r.doc, 'base64'))
    expect(text).not.toContain('YL_A_B_001')
    expect(text).toContain('YL_A_B_002')
  })

  test('全部排除 → 400 明确报错', async () => {
    const data = await parse('测试大纲T.docx', sampleDocx())
    const cases = (data.cases as any[]).map(c => ({ ...c, excluded: true }))
    const res = await fetch(URL0 + '/api/trace/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outline: data.outline, cases: cases })
    })
    expect(res.status).toBe(400)
    const r = await res.json()
    expect(r.ok).toBe(false)
    expect(r.error).toContain('全部')
  })

  test('落盘交付：数据/生成/<项目>/ 出现追踪文档', async () => {
    const data = await parse('测试大纲T.docx', sampleDocx())
    const res = await fetch(URL0 + '/api/trace/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outline: data.outline, cases: data.cases })
    })
    const r = await res.json()
    expect(r.ok).toBe(true)
    expect(r.files).toBeTruthy()
    expect(r.files[0].name).toBe('追踪文档-生成.docx')
    expect(r.files[0].path).toContain(join('生成', ''))
    expect(r.sizeKB).toBeTruthy()
  })
})
