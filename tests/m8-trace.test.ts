import { describe, test, expect, beforeAll } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import PizZip from 'pizzip'
import { DOMParser } from '@xmldom/xmldom'
import { buildDocxBuffer, itemTable, DESC, METHOD } from './helpers/ooxml.ts'
import { handle } from '../src/server/app.ts'
import { renderTemplate, stripAnchorMarks } from '../src/core/render/docx.ts'
import { applyVmergeToDocx } from '../src/core/render/vmerge.ts'
import { buildTraceTable } from '../src/core/trace/build.ts'
import { IssueCollector } from '../src/core/domain.ts'
import type { TraceRowVM, TraceTable } from '../src/core/trace/table.ts'
import type { CaseRow } from '../src/core/convert/rows.ts'
import type { RecordCase } from '../src/core/parse/record.ts'

/** M8 追踪文档工具（F10/12 号设计 v2）：四套模板 + /api/trace/parse + /api/trace/generate 端到端 */

beforeAll(() => {
  process.env.CC_DATA_DIR = mkdtempSync(join(tmpdir(), 'cc-m8-'))
})

function start(): string {
  const server = Bun.serve({ port: 0, fetch: handle })
  return server.url.toString().replace(/\/$/, '')
}
const URL0 = start()

const TPL_NAMES = ['追踪-大纲模板.docx', '追踪-说明模板.docx', '追踪-报告模板.docx', '追踪-回归模板.docx'] as const

/** 合成大纲：功能测试 XQ_A_B 下两个用例（同 SRS 同项 → 说明表出 vmerge 合并组） */
function sampleOutline(): Buffer {
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

/** 合成测试记录：一张用例记录表（YL_A_B_001，2 步全通过、无问题单） */
export function sampleRecordTable(caseId: string, caseName: string, results: string[], problem: string): { kind: 'tbl'; rows: any[][] } {
  return {
    kind: 'tbl',
    rows: [
      [{ text: '' }],
      [{ text: '测试用例名称' }, { text: caseName }, { text: '标识' }, { text: caseId }],
      [{ text: '追踪关系' }, { text: '软件测试依据：软件测评大纲\n测试需求分析：6.2.1.1 某测试项\n测试需求标识：XQ_A_B' }],
      [{ text: '测试步骤' }],
      [{ text: '序号' }, { text: '输入及操作' }, { text: '期望结果与评估标准' }, { text: '实测结果' }, { text: '通过与否' }],
      ...results.map((r, i) => [{ text: String(i + 1) }, { text: '执行操作' + (i + 1) }, { text: '结果正确' }, { text: '' }, { text: r }]),
      [{ text: '执行状态' }, { text: '已执行' }, { text: '测试时间' }, { text: '2026-08-18' }],
      [{ text: '测试人员' }, { text: '张三' }, { text: '监测人员' }, { text: '李四' }],
      [{ text: '问题单标识' }, { text: problem }],
      [{ text: '备注' }, { text: '/' }]
    ]
  }
}

function sampleRecord(): Buffer {
  return buildDocxBuffer({
    content: [
      { kind: 'p', para: { text: '测试记录', heading: 1 } },
      { kind: 'p', para: { text: '功能测试', heading: 2 } },
      sampleRecordTable('YL_A_B_001', '用例一', ['通过', '通过'], '/')
    ]
  })
}

function xmlOf(buf: Buffer): string {
  return (PizZip as any)(buf).file('word/document.xml').asText() as string
}
function textOf(buf: Buffer): string {
  return xmlOf(buf).replace(/<[^>]+>/g, '')
}
/** XML 良构断言（@xmldom/xmldom 0.9 的 onError 签名） */
function assertWellFormed(xml: string): void {
  const errors: string[] = []
  new DOMParser({
    onError: (level: unknown, msg: unknown) => {
      if (level === 'error' || level === 'fatalError') errors.push(String(msg))
    }
  }).parseFromString(xml, 'application/xml')
  expect(errors).toEqual([])
}

describe('M8 四套追踪模板', () => {
  test('每套模板：双层表头 + 锚点 + traceRows 循环，无工具一循环段残留，XML 良构', () => {
    for (const name of TPL_NAMES) {
      const buf = readFileSync(join(import.meta.dir, '../模板/' + name))
      const xml = xmlOf(buf)
      expect(xml).toContain('{#traceRows}')
      expect(xml).toContain('_TR_BEGIN_')
      expect(xml).toContain('_TR_END_')
      expect(xml).not.toContain('{#cases}')
      expect(xml).not.toContain('{#caselist}')
      // 全部单元格垂直居中（用户反馈定稿）——锚点辅助行除外（2 格，rowAnchorXml 剥离形态要求无 vAlign）
      const tcCount = (xml.match(/<w:tc>/g) ?? []).length
      const vaCount = (xml.match(/<w:vAlign w:val="center"\/>/g) ?? []).length
      expect(vaCount).toBe(tcCount - 2)
      assertWellFormed(xml)
    }
  })

  test('说明模板表头：分组行（软件需求规格说明/软件测试大纲/测试用例）+ 子列行', () => {
    const text = textOf(readFileSync(join(import.meta.dir, '../模板/追踪-说明模板.docx')))
    for (const h of ['序号', '软件需求规格说明', '章节号', '章节描述', '软件测试大纲', '大纲章节号', '测试项名称', '测试项标识', '测试用例', '测试用例名称', '测试用例标识']) {
      expect(text).toContain(h)
    }
  })

  test('报告模板表头：11 列（含测试类型/执行结果/备注）', () => {
    const text = textOf(readFileSync(join(import.meta.dir, '../模板/追踪-报告模板.docx')))
    for (const h of ['测评大纲', '测试类型', '测试用例标识', '名称', '执行结果', '备注']) {
      expect(text).toContain(h)
    }
  })

  test('大纲模板表头（2026-10-10 改版）：SRS/大纲两块 + 无任务书块', () => {
    const text = textOf(readFileSync(join(import.meta.dir, '../模板/追踪-大纲模板.docx')))
    for (const h of ['软件需求规格说明', '章节号', '章节名称', '软件测试大纲', '大纲章节号', '测试项名称', '测试项标识', '备注']) {
      expect(text).toContain(h)
    }
    // 任务书块整块省略（无任务书形态）
    expect(text).not.toContain('软件研制任务书')
    expect(text).toContain('{srsName}')
    expect(text).toContain('{outlineChapter}')
    expect(text).toContain('{itemName}')
    expect(text).not.toContain('{typeName}')
  })

  test('含任务书大纲模板表头：9 列（任务书块在前）', () => {
    const text = textOf(readFileSync(join(import.meta.dir, '../模板/追踪-大纲-含任务书模板.docx')))
    for (const h of ['软件研制任务书', '章节号', '章节名称', '软件需求规格说明', '软件测试大纲', '大纲章节号', '测试项名称', '测试项标识', '备注']) {
      expect(text).toContain(h)
    }
    for (const v of ['{taskBookChapter}', '{taskBookName}', '{srsChapter}', '{srsName}']) {
      expect(text).toContain(v)
    }
  })

  test('回归模板表头：9 列（含用例章节号）', () => {
    const text = textOf(readFileSync(join(import.meta.dir, '../模板/追踪-回归模板.docx')))
    for (const h of ['测评大纲', '用例章节号', '测试用例名称', '测试用例标识']) {
      expect(text).toContain(h)
    }
  })

  test('渲染：占位符变量与模板循环行一致，数据全落位无残留', () => {
    const buf = readFileSync(join(import.meta.dir, '../模板/追踪-报告模板.docx'))
    const rows = [
      { no: '1', srsChapter: '3.1', srsDesc: '参数管理', outlineChapter: '6.2.1.4.1', itemName: '参数管理测试', itemItemId: 'XQ_A_B', typeName: '功能测试', caseId: 'YL_A_B_001-001~002', caseName: '用例一', result: '通过', remark: '--' }
    ]
    const out = stripAnchorMarks(renderTemplate(buf, { traceRows: rows, configName: 'C' }))
    expect(out.subarray(0, 2).toString()).toBe('PK')
    const text = textOf(out)
    expect(text).toContain('YL_A_B_001-001~002')
    expect(text).toContain('通过')
    for (const bad of ['{traceRows}', '{no}', '{caseId}', '{result}', '{configName}', '_TR_BEGIN_', '_TR_END_']) {
      expect(text.includes(bad)).toBe(false)
    }
    assertWellFormed(xmlOf(out))
  })
})

async function postForm(path: string, form: FormData): Promise<any> {
  const res = await fetch(URL0 + path, { method: 'POST', body: form })
  return { status: res.status, body: await res.json() }
}

function formWithFile(mode: string, buf: Buffer, name: string): FormData {
  const form = new FormData()
  form.append('mode', mode)
  form.append('file', new File([new Uint8Array(buf)], name))
  return form
}

describe('M8 /api/trace/parse（四 tab 第 1 步）', () => {
  test('spec：大纲 → 说明追踪表，同项两例出 vmerge 合并组', async () => {
    const r = await postForm('/api/trace/parse', formWithFile('spec', sampleOutline(), '大纲T.docx'))
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.traceType).toBe('spec')
    const spec = r.body.spec as TraceTable
    expect(spec.heads.reduce((a: number, g: any) => a + g.cols.length, 0)).toBe(8)
    expect(spec.rows.length).toBe(2)
    // 同 SRS 同项：第 0 行 1~5 列 span=2，第 1 行同列 span=0
    expect(spec.rows[0].span[1]).toBe(2)
    expect(spec.rows[1].span[1]).toBe(0)
    expect(spec.rows[1].span[6]).toBe(1)
  })

  test('report：记录 + 项目库大纲 → 11 列对齐（步骤范围/执行结果/备注自动推导）', async () => {
    // 先上传大纲建档（拿 outlineHash）
    const f0 = new FormData()
    f0.append('file', new File([new Uint8Array(sampleOutline())], '大纲T.docx'))
    const pr = await (await fetch(URL0 + '/api/parse', { method: 'POST', body: f0 })).json()
    expect(pr.ok).toBe(true)
    const form = new FormData()
    form.append('mode', 'report')
    form.append('file', new File([new Uint8Array(sampleRecord())], '记录T.docx'))
    form.append('outlineHash', pr.outline.hash)
    const r = await postForm('/api/trace/parse', form)
    expect(r.status).toBe(200)
    const spec = r.body.spec as TraceTable
    expect(spec.heads.reduce((a: number, g: any) => a + g.cols.length, 0)).toBe(11)
    expect(spec.rows.length).toBe(1)
    expect(spec.rows[0].cells[7]).toBe('YL_A_B_001-001~002')
    expect(spec.rows[0].cells[9]).toBe('通过')
    expect(spec.rows[0].cells[10]).toBe('--')
    expect(spec.rows[0].cells[6]).toBe('功能测试')
    expect(spec.editableCol).toBe(9)
  })

  test('report：缺大纲 → 400 明确报错', async () => {
    const r = await postForm('/api/trace/parse', formWithFile('report', sampleRecord(), '记录T.docx'))
    expect(r.status).toBe(400)
    expect(r.body.ok).toBe(false)
    expect(r.body.error).toContain('大纲')
  })

  test('returnSpec：回归说明 + 大纲 → 9 列（用例章节号/SRS 优先回归说明）', async () => {
    const ret = buildDocxBuffer({
      content: [
        { kind: 'p', para: { text: '软件更改部分', heading: 1 } },
        { kind: 'p', para: { text: '回归测试需求', heading: 2, numId: 1, ilvl: 1 } },
        {
          kind: 'tbl',
          rows: itemTable('某测试项', 'XQ_A_B', [
            [{ text: '追踪关系' }, { text: '《XX需求规格说明》3.1 参数管理' }]
          ])
        },
        { kind: 'p', para: { text: '测试用例', heading: 1, numId: 1, ilvl: 0 } },
        sampleRecordTable('YL_A_B_001', '用例一', ['通过'], '/')
      ]
    })
    const pr = await (await fetch(URL0 + '/api/parse', { method: 'POST', body: (() => { const f = new FormData(); f.append('file', new File([new Uint8Array(sampleOutline())], '大纲T.docx')); return f })() })).json()
    const form = new FormData()
    form.append('mode', 'returnSpec')
    form.append('file', new File([new Uint8Array(ret)], '回归说明T.docx'))
    form.append('outlineHash', pr.outline.hash)
    const r = await postForm('/api/trace/parse', form)
    expect(r.status).toBe(200)
    const spec = r.body.spec as TraceTable
    expect(spec.heads.reduce((a: number, g: any) => a + g.cols.length, 0)).toBe(9)
    expect(spec.rows.length).toBe(1)
    // SRS 取回归说明追踪关系行（3.1），大纲章节号取大纲（6.2.1.4.x），用例章节号来自回归说明编号
    expect(spec.rows[0].cells[1]).toBe('3.1')
    expect(spec.rows[0].cells[3]).not.toBe('')
    expect(spec.rows[0].cells[6]).not.toBe('')
    expect(spec.rows[0].cells[8]).toBe('YL_A_B_001')
  })

  test('未知类型 → 400', async () => {
    const r = await postForm('/api/trace/parse', formWithFile('bogus', sampleOutline(), 'x.docx'))
    expect(r.status).toBe(400)
  })
})

describe('M8 /api/trace/generate（rows 渲染 + vMerge 后处理）', () => {
  test('端到端：rows（含 span）→ 生成 → vMerge XML 标记正确、续行文本清空', async () => {
    const rows: TraceRowVM[] = [
      { cells: ['1', '3.1', '参数管理', '6.2.1.4.1', '参数管理测试', 'XQ_A_B', '用例一', 'YL_A_B_001'], span: [1, 2, 2, 2, 2, 2, 1, 1] },
      { cells: ['2', '3.1', '参数管理', '6.2.1.4.1', '参数管理测试', 'XQ_A_B', '用例二', 'YL_A_B_002'], span: [1, 0, 0, 0, 0, 0, 1, 1] }
    ]
    const res = await fetch(URL0 + '/api/trace/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ traceType: 'spec', rows: rows, primary: { name: '大纲T.docx', hash: null }, configName: 'XX星测控软件' })
    })
    const r = await res.json()
    expect(r.ok).toBe(true)
    expect(r.name).toBe('追踪文档-生成.docx')
    const buf = Buffer.from(r.doc, 'base64')
    expect(buf.subarray(0, 2).toString()).toBe('PK')
    const xml = xmlOf(buf)
    // 数据行 5 列合并 + 表头"序号"独立列自带的 1 组 = 6 restart / 6 continue
    expect((xml.match(/<w:vMerge w:val="restart"\/>/g) ?? []).length).toBe(6)
    expect((xml.match(/<w:vMerge\/>/g) ?? []).length).toBe(6)
    const text = textOf(buf)
    expect(text).toContain('YL_A_B_001')
    expect(text).toContain('YL_A_B_002')
    // 题注 configName 由服务端设置取（测试环境为空 → 题注仅"需求追踪表"）
    expect(text).toContain('需求追踪表')
    assertWellFormed(xml)
  })

  test('执行结果编辑值随 rows 进入产物', async () => {
    const rows: TraceRowVM[] = [
      { cells: ['1', '', '', '', '', '', '手工用例', 'YL_X_001', '手工用例', '未通过', 'PT_T_1'], span: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] }
    ]
    const res = await fetch(URL0 + '/api/trace/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ traceType: 'report', rows: rows, primary: { name: '记录T.docx' } })
    })
    const r = await res.json()
    expect(r.ok).toBe(true)
    const text = textOf(Buffer.from(r.doc, 'base64'))
    expect(text).toContain('未通过')
    expect(text).toContain('PT_T_1')
  })

  test('行数据列数不符 → 400', async () => {
    const rows = [{ cells: ['1', 'x'], span: [1, 1] }]
    const res = await fetch(URL0 + '/api/trace/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ traceType: 'spec', rows: rows, primary: { name: 'x' } })
    })
    expect(res.status).toBe(400)
  })

  test('落盘交付：primary.hash 存在时写 数据/生成/<项目>/', async () => {
    const pr = await (await fetch(URL0 + '/api/parse', { method: 'POST', body: (() => { const f = new FormData(); f.append('file', new File([new Uint8Array(sampleOutline())], '大纲T.docx')); return f })() })).json()
    const rows: TraceRowVM[] = [
      { cells: ['1', '3.1', '参数管理', '6.2.1.4.1', '参数管理测试', 'XQ_A_B', '用例一', 'YL_A_B_001'], span: [1, 1, 1, 1, 1, 1, 1, 1] }
    ]
    const res = await fetch(URL0 + '/api/trace/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ traceType: 'spec', rows: rows, primary: { name: '大纲T.docx', hash: pr.outline.hash } })
    })
    const r = await res.json()
    expect(r.ok).toBe(true)
    expect(r.files[0].path).toContain(join('生成', ''))
    expect(r.sizeKB).toBeTruthy()
  })
})

describe('M8 vmerge 后处理与表构建单元', () => {
  const mkCase = (over: Partial<CaseRow>): CaseRow => ({
    head2: null, head3: null, head4: null, head5: null, head6: null,
    path: [], typeName: '功能测试', groupName: null, itemName: '项A', chapter: '6.2.1.1',
    itemId: 'XQ_A', caseId: 'YL_A_001', mingcheng: '用例', summary: '', init: '', constraint: '',
    steps: [], designer: '', testTime: '', tester: '', monitor: '', trace: '', itemItemId: 'XQ_A',
    srsChapter: '/', srsDesc: '/', taskBookChapter: '/', taskBookName: '/', expectSource: '方法切分', suspectCount: 0,
    reviewed: false, excluded: false, dismissedSuspects: [],
    ...over
  } as CaseRow)

  test('buildTraceTable outline（2026-10-10 改版）：无任务书 7 列 / 有任务书 9 列 + 类型列去除', () => {
    // 全部无任务书 → 7 列基形，SRS 无对应 '--'
    const t7 = buildTraceTable({ type: 'outline', outlineCases: [mkCase({ srsChapter: '3.1', srsDesc: '参数' })] }, new IssueCollector())
    expect(t7.heads.reduce((a, g) => a + g.cols.length, 0)).toBe(7)
    expect(t7.heads.map(h => h.group)).toEqual(['', '软件需求规格说明', '软件测试大纲', ''])
    expect(t7.rows[0].cells).toEqual(['1', '3.1', '参数', '6.2.1.1', '项A', 'XQ_A', '/'])
    const t7miss = buildTraceTable({ type: 'outline', outlineCases: [mkCase({})] }, new IssueCollector())
    expect(t7miss.rows[0].cells[1]).toBe('--')
    expect(t7miss.rows[0].cells[2]).toBe('--')
    // 任一行有任务书 → 9 列（任务书块插入），无的行 '--'
    const mixed = [
      mkCase({ srsChapter: '3.1', srsDesc: '参数', taskBookChapter: '3.2', taskBookName: '指令要求' }),
      mkCase({ srsChapter: '3.3', srsDesc: '查询', chapter: '6.2.1.2', itemItemId: 'XQ_B', itemName: '项B' })
    ]
    const t9 = buildTraceTable({ type: 'outline', outlineCases: mixed }, new IssueCollector())
    expect(t9.heads.reduce((a, g) => a + g.cols.length, 0)).toBe(9)
    expect(t9.heads.map(h => h.group)).toEqual(['', '软件研制任务书', '软件需求规格说明', '软件测试大纲', ''])
    expect(t9.rows[0].cells[1]).toBe('3.2')
    expect(t9.rows[0].cells[2]).toBe('指令要求')
    expect(t9.rows[1].cells[1]).toBe('--')
    expect(t9.rows[1].cells[2]).toBe('--')
    // '/' 视为无任务书（不触发 9 列）
    const tSlash = buildTraceTable({ type: 'outline', outlineCases: [mkCase({ taskBookChapter: '/', taskBookName: '/' })] }, new IssueCollector())
    expect(tSlash.heads.reduce((a, g) => a + g.cols.length, 0)).toBe(7)
  })

  test('outline 渲染：两套模板按列数分派，产物落位无残留', () => {
    // 7 列走无任务书模板
    const buf7 = renderTemplate(readFileSync(join(import.meta.dir, '../模板/追踪-大纲模板.docx')), {
      traceRows: [{ no: '1', srsChapter: '3.1', srsName: '参数管理', outlineChapter: '6.2.1.1', itemName: '项A', itemItemId: 'XQ_A', remark: '/' }],
      configName: 'C'
    })
    const out7 = stripAnchorMarks(buf7)
    expect(out7.subarray(0, 2).toString()).toBe('PK')
    const text7 = textOf(out7)
    expect(text7).toContain('参数管理')
    for (const bad of ['{srsName}', '{no}', '_TR_BEGIN_']) expect(text7.includes(bad)).toBe(false)
    assertWellFormed(xmlOf(out7))
    // 9 列走含任务书模板
    const buf9 = renderTemplate(readFileSync(join(import.meta.dir, '../模板/追踪-大纲-含任务书模板.docx')), {
      traceRows: [{ no: '1', taskBookChapter: '3.2', taskBookName: '指令要求', srsChapter: '3.1', srsName: '参数管理', outlineChapter: '6.2.1.1', itemName: '项A', itemItemId: 'XQ_A', remark: '/' }],
      configName: 'C'
    })
    const out9 = stripAnchorMarks(buf9)
    expect(out9.subarray(0, 2).toString()).toBe('PK')
    const text9 = textOf(out9)
    expect(text9).toContain('指令要求')
    for (const bad of ['{taskBookChapter}', '{taskBookName}', '_TR_BEGIN_']) expect(text9.includes(bad)).toBe(false)
    assertWellFormed(xmlOf(out9))
  })

  test('buildTraceTable spec：vmerge 整块合并 + 排除用例不入表', () => {
    
    const cases = [
      mkCase({ caseId: 'YL_A_001', mingcheng: '用例1', srsChapter: '3.1', srsDesc: '参数' }),
      mkCase({ caseId: 'YL_A_002', mingcheng: '用例2', srsChapter: '3.1', srsDesc: '参数', excluded: true }),
      mkCase({ caseId: 'YL_B_001', mingcheng: '用例3', srsChapter: '3.2', srsDesc: '查询', chapter: '6.2.1.2', itemItemId: 'XQ_B', itemName: '项B' })
    ]
    const t = buildTraceTable({ type: 'spec', outlineCases: cases }, new IssueCollector())
    expect(t.rows.length).toBe(2)
    expect(t.rows[0].span[1]).toBe(1) // 同项的第二例被排除 → 无合并
  })

  test('buildTraceTable report：标识去序号兜底 + miss 告警 + 执行结果推导', () => {
    
    const cases = [mkCase({ caseId: 'YL_A_001', srsChapter: '3.1', srsDesc: '参数' })]
    const rec = (over: Partial<RecordCase>): RecordCase => ({
      caseName: '用例', caseId: 'YL_A_001', traceChapter: '', traceItemName: '', traceItemId: '',
      stepCount: 2, stepResults: ['通过', '通过'], executed: '已执行', problemId: '/', typeName: '', ...over
    } as RecordCase)
    const iss1 = new IssueCollector()
    const t1 = buildTraceTable({ type: 'report', outlineCases: cases, records: [rec({ caseId: 'YL_A' })] }, iss1)
    expect(t1.rows[0].cells[3]).toBe('6.2.1.1') // base 兜底命中
    expect(iss1.issues.length).toBe(0)
    const iss2 = new IssueCollector()
    const t2 = buildTraceTable({ type: 'report', outlineCases: cases, records: [rec({ caseId: 'YL_NOPE_009' })] }, iss2)
    expect(t2.rows[0].cells[3]).toBe('')
    expect(iss2.issues.filter(i => i.code === 'TRACE_ALIGN_MISS').length).toBe(1)
    // 执行结果：有未通过步骤 → 留空；有问题单 → 留空+备注=问题单
    const t3 = buildTraceTable({ type: 'report', outlineCases: cases, records: [rec({ stepResults: ['通过', '未通过'] })] }, new IssueCollector())
    expect(t3.rows[0].cells[9]).toBe('')
    const t4 = buildTraceTable({ type: 'report', outlineCases: cases, records: [rec({ problemId: 'PT_1' })] }, new IssueCollector())
    expect(t4.rows[0].cells[9]).toBe('')
    expect(t4.rows[0].cells[10]).toBe('PT_1')
  })

  test('applyVmergeToDocx：无合并需求时零改动', () => {
    const rows: TraceRowVM[] = [{ cells: ['1', 'a'], span: [1, 1] }]
    const buf = Buffer.from('not-a-zip')
    expect(applyVmergeToDocx(buf, rows, 2)).toBe(buf)
  })

  test('buildTraceTable 说明源（12 v2.1）：说明追踪表 SRS 留空 + 空列通配合并；报告表说明源对齐', () => {
    const rsData = {
      items: [],
      cases: [
        { caseName: '用例1', caseId: 'YL_A_001', caseChapter: '6.1.1', traceChapter: '6.2.1.1', traceItemName: '项A', traceItemId: 'XQ_A', typeName: '功能测试' },
        { caseName: '用例2', caseId: 'YL_A_002', caseChapter: '6.1.1', traceChapter: '6.2.1.1', traceItemName: '项A', traceItemId: 'XQ_A', typeName: '功能测试' }
      ]
    }
    // 说明追踪表：SRS 两列留空，同项两例整块合并（空 SRS 通配参与合并键）
    const t1 = buildTraceTable({ type: 'spec', specAlign: rsData }, new IssueCollector())
    expect(t1.rows.length).toBe(2)
    expect(t1.rows[0].cells[1]).toBe('')
    expect(t1.rows[0].cells[3]).toBe('6.2.1.1')
    expect(t1.rows[0].span[1]).toBe(2)
    expect(t1.rows[1].span[1]).toBe(0)
    // 报告表说明源：SRS 空 + 大纲章节号/项名/项标识/类型从说明用例表追踪关系行提取
    const rec: RecordCase = {
      caseName: '用例1', caseId: 'YL_A_001', traceChapter: '', traceItemName: '', traceItemId: '',
      stepCount: 1, stepResults: ['通过'], executed: '已执行', problemId: '/', typeName: ''
    }
    const t2 = buildTraceTable({ type: 'report', specAlign: rsData, records: [rec] }, new IssueCollector())
    expect(t2.rows[0].cells[1]).toBe('')
    expect(t2.rows[0].cells[3]).toBe('6.2.1.1')
    expect(t2.rows[0].cells[4]).toBe('项A')
    expect(t2.rows[0].cells[6]).toBe('功能测试')
    expect(t2.rows[0].cells[7]).toBe('YL_A_001-001')
  })
})
