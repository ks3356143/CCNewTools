import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderTemplate } from '../src/core/render/docx.ts'
import { convertToTemplateData } from '../src/core/convert/index.ts'
import { DEFAULT_PARAMS, type ParsedOutline, type TestItem, type RawCase } from '../src/core/domain.ts'
import PizZip from 'pizzip'
import { DOMParser } from '@xmldom/xmldom'

/** M3 渲染层：真实模板（模板/ 目录，非涉密）+ 合成数据 → 结构断言 */

const TPL_DIR = join(import.meta.dir, '../模板')
const SPEC = readFileSync(join(TPL_DIR, '测试说明模板.docx'))
const REC = readFileSync(join(TPL_DIR, '测试记录模板.docx'))

function makeOutline(): ParsedOutline {
  const c1: RawCase = {
    itemId: 'XQ_SU_ZLPA_SU01', name: '参数查询正常功能', summary: '查询综述。',
    steps: [
      { no: 1, text: '启动软件，进入参数管理界面。' },
      { no: 2, text: '输入参数标识，点击查询按钮，查看查询结果是否正确显示；' }
    ]
  }
  const c2: RawCase = {
    itemId: 'XQ_SU_ZLPA_SU02', name: '参数新增正常功能', summary: '新增综述。',
    steps: [{ no: 1, text: '点击新增按钮，查看新增参数是否显示；' }]
  }
  const item1: TestItem = {
    name: 'A星指令参数管理', itemId: 'XQ_SU_ZLPA', chapter: '6.2.1.4.1.1',
    typeName: '功能测试', groupName: 'A星模板功能测试', itemName: 'A星指令参数管理',
    description: { shared: null, entries: [] }, cases: [c1, c2], criteriaCases: [],
    traceSrs: { chapter: '4.3.1.2', desc: 'A星指令参数管理' }
  }
  const item2: TestItem = {
    name: '文档审查', itemId: 'XQ_DC', chapter: '6.2.1.1',
    typeName: '文档审查', groupName: null, itemName: '文档审查',
    description: { shared: '文档审查综述。', entries: [] },
    cases: [{ itemId: 'XQ_DC_DC001', name: '软件文档审查', summary: '文档审查综述。', steps: [{ no: 1, text: '审查内容是否完整；' }] }],
    criteriaCases: [],
    traceSrs: { chapter: '/', desc: '/' }
  }
  const item3: TestItem = {
    name: '指令边界测试', itemId: 'XQ_BJ_ZL', chapter: '6.2.1.7.1.1',
    typeName: '边界测试', groupName: null, itemName: '指令边界测试',
    description: { shared: null, entries: [] },
    cases: [{ itemId: 'XQ_BJ_ZL001', name: '指令边界测试用例', summary: '边界综述。', steps: [{ no: 1, text: '输入超长指令，查看是否正确拦截；' }] }],
    criteriaCases: [],
    traceSrs: { chapter: '4.3.2', desc: '指令边界测试' }
  }
  return { items: [item1, item2, item3], issues: [], stats: { items: 3, cases: 4, steps: 5 } }
}

function bodyText(buf: Buffer): string {
  const zip = new PizZip(buf)
  const xml = zip.file('word/document.xml')!.asText()
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  let out = ''
  for (const t of doc.getElementsByTagNameNS(W, 't')) out += t.textContent ?? ''
  return out
}

/** 输出文档的标题序列（style 2/3/4 + 文本） */
function headings(buf: Buffer): Array<{ level: string; text: string }> {
  const zip = new PizZip(buf)
  const xml = zip.file('word/document.xml')!.asText()
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const out: Array<{ level: string; text: string }> = []
  for (const p of doc.getElementsByTagNameNS(W, 'p')) {
    const styles = p.getElementsByTagNameNS(W, 'pStyle')
    if (styles.length === 0) continue
    const sid = styles.item(0)!.getAttributeNS(W, 'val') || styles.item(0)!.getAttribute('w:val') || ''
    if (!['1', '2', '3', '4'].includes(sid)) continue
    let text = ''
    for (const t of p.getElementsByTagNameNS(W, 't')) text += t.textContent ?? ''
    if (text.trim() !== '') out.push({ level: sid, text: text.trim() })
  }
  return out
}

describe('M3 渲染：测试说明模板', () => {
  const data = convertToTemplateData(makeOutline(), { ...DEFAULT_PARAMS, tester: '张三', monitor: '李四' })
  const buf = renderTemplate(SPEC, { ...data, configName: '某软件配置项' })

  test('标题层级：三章结构，类型/中间层/测试项各只出现一次', () => {
    const hs = headings(buf)
    expect(hs).toEqual([
      { level: '1', text: '测试说明' },
      { level: '1', text: '测试用例' },
      { level: '2', text: '功能测试' },
      { level: '3', text: 'A星模板功能测试' },
      { level: '4', text: 'A星指令参数管理' },
      { level: '2', text: '文档审查' },
      { level: '2', text: '边界测试' },
      { level: '3', text: '指令边界测试' },
      { level: '1', text: '需求的可追踪性' },
      { level: '2', text: '某软件配置项需求追踪表' }
    ])
  })

  test('用例清单与追踪表进入正文，无残留占位符', () => {
    const text = bodyText(buf)
    expect(text).toContain('某软件配置项测试说明')
    expect(text).toContain('用例综述')
    expect(text).toContain('需求规格说明章节号')
    expect(text).toContain('4.3.1.2')
    expect(text).toContain('6.2.1.4.1.1')
    expect(text).toContain('YL_SU_ZLPA_001')
    expect(text).toContain('YL_SU_ZLPA_002')
    expect(text).toContain('YL_DC_001')
    expect(text).toContain('启动软件，进入参数管理界面，输入参数标识，点击查询按钮，查看查询结果是否正确显示')
    expect(text).toContain('需求规格说明审查单')
    expect(text).not.toContain('{#cases')
    expect(text).not.toContain('{#caselist')
    expect(text).not.toContain('{configName}')
  })
})

describe('M3 渲染：测试记录模板', () => {
  const data = convertToTemplateData(makeOutline(), { ...DEFAULT_PARAMS, tester: '张三', monitor: '李四', testTime: '2026-09-30' })
  const buf = renderTemplate(REC, { cases: data.cases, configName: '某软件配置项' })

  test('标题层级与测试说明同构：类型→组→项三级、无组类型项上浮、静态类型免标题（2026-10-01）', () => {
    // 记录模板的样式 id 与说明模板不同：heading3 是 "30"、heading4 是 "4"
    const zip = new PizZip(buf)
    const xml = zip.file('word/document.xml')!.asText()
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    const got: string[] = []
    for (const p of Array.from(doc.getElementsByTagNameNS(W, 'p'))) {
      const ps = p.getElementsByTagNameNS(W, 'pStyle')
      if (ps.length === 0) continue
      const sid = ps.item(0)!.getAttribute('w:val') || ''
      if (!['1', '2', '30', '4'].includes(sid)) continue
      let text = ''
      for (const t of Array.from(p.getElementsByTagNameNS(W, 't'))) text += t.textContent ?? ''
      if (text.trim() !== '') got.push(sid + ':' + text.trim())
    }
    expect(got.slice(0, 7)).toEqual([
      '1:测试记录',
      '2:功能测试',
      '30:A星模板功能测试',
      '4:A星指令参数管理',
      '2:文档审查',
      '2:边界测试',
      '30:指令边界测试'
    ])
    // 其后是附录静态标题（文档审查单等，模板自带）
    expect(got.slice(7)).toEqual([
      '1:文档审查单',
      '2:软件文档齐套性检查单',
      '2:需求类文档审查单',
      '2:设计类文档审查单',
      '2:手册类文档审查单',
      '1:代码审查单',
      '1:静态分析结果记录',
      '1:未覆盖情况'
    ])
  })

  test('记录表字段：实测结果为空、结论"通过"、执行信息、追踪关系三行', () => {
    const text = bodyText(buf)
    expect(text).toContain('YL_SU_ZLPA_001')
    expect(text).toContain('通过')
    expect(text).toContain('2026-09-30')
    expect(text).toContain('张三')
    expect(text).toContain('李四')
    expect(text).toContain('软件测试依据：软件测评大纲')
    expect(text).toContain('测试需求分析：6.2.1.4.1.1 A星指令参数管理')
    expect(text).toContain('测试需求标识：XQ_SU_ZLPA_SU01')
  })

  test('记录模板附录（文档审查单等静态内容）原样保留', () => {
    const text = bodyText(buf)
    expect(text).toContain('文档审查单')
    expect(text).toContain('C语言代码审查单')
    expect(text).toContain('静态分析结果记录')
    expect(text).toContain('未覆盖情况')
  })
})

describe('M3 渲染错误处理（06）', () => {
  test('模板数据缺失时抛出含定位信息的错误', () => {
    const bad = { cases: [{ mingcheng: '某用例' }] } // 缺绝大多数字段
    expect(() => renderTemplate(SPEC, bad)).toThrow(/模板渲染失败/)
  })
})
