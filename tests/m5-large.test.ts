import { describe, test, expect } from 'bun:test'
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate'
import {
  readDocx, chunkTopLevel, type OfficeFile
} from '../src/core/parse/docx.ts'
import { extractOutline } from '../src/core/parse/outline.ts'
import { IssueCollector } from '../src/core/domain.ts'
import {
  buildDocx, buildDocxBuffer, paraXml, tableXml, itemTable, DESC, METHOD, CRITERIA, type DocSpec
} from './helpers/ooxml.ts'

/** M5 大文档分块解析（10-大文档处理 4.2~4.4，v1.2.0）：切块器、双路径一致性、阈值判定、分块 e2e */

const WNS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

// —— 切块器单元 ——

test('切块器：顶层段落/表格序列', () => {
  const s = '<w:p><w:r><w:t>a</w:t></w:r></w:p><w:tbl><w:tr/></w:tbl><w:p/>'
  expect([...chunkTopLevel(s, 0, s.length)]).toEqual([
    '<w:p><w:r><w:t>a</w:t></w:r></w:p>',
    '<w:tbl><w:tr/></w:tbl>',
    '<w:p/>'
  ])
})

test('切块器：嵌套表格深度配对', () => {
  const inner = '<w:tbl><w:tr><w:tc><w:p><w:t>内</w:t></w:p></w:tc></w:tr></w:tbl>'
  const s = '<w:tbl><w:tr><w:tc>' + inner + '</w:tc></w:tr></w:tbl><w:p><w:t>后</w:t></w:p>'
  const chunks = [...chunkTopLevel(s, 0, s.length)]
  expect(chunks.length).toBe(2)
  expect(chunks[0]).toBe('<w:tbl><w:tr><w:tc>' + inner + '</w:tc></w:tr></w:tbl>')
})

test('切块器：<w:p 不得误配 <w:pStyle（边界验证）', () => {
  const s = '<w:p><w:pPr><w:pStyle w:val="a"/></w:pPr><w:r><w:t>z</w:t></w:r></w:p>'
  expect([...chunkTopLevel(s, 0, s.length)].length).toBe(1)
})

test('切块器：属性值内的 > 不干扰标签头定位', () => {
  const s = '<w:p w:val="a>b"><w:r><w:t>x</w:t></w:r></w:p><w:tbl><w:tr/></w:tbl>'
  const chunks = [...chunkTopLevel(s, 0, s.length)]
  expect(chunks.length).toBe(2)
  expect(chunks[0]).toBe('<w:p w:val="a>b"><w:r><w:t>x</w:t></w:r></w:p>')
})

test('切块器：sectPr/注释/CDATA/自闭合各成一块或跳过', () => {
  const s = '<w:sectPr><w:pgSz w:w="1" w:h="2"/></w:sectPr><!--注释--><![CDATA[x]]><w:p/>'
  expect([...chunkTopLevel(s, 0, s.length)]).toEqual([
    '<w:sectPr><w:pgSz w:w="1" w:h="2"/></w:sectPr>',
    '<w:p/>'
  ])
})

test('切块器：同名标签不配对抛文件损坏', () => {
  const s = '<w:tbl><w:tbl></w:tbl>'
  expect(() => [...chunkTopLevel(s, 0, s.length)]).toThrow(/文件损坏/)
})

test('切块器：非同名残缺标签切块正常，由 xmldom parse 兜底', () => {
  // <w:tr> 未闭合不影响 w:tbl 同名配对；残缺块在分块解析的 parse 环节被拒
  const s = '<w:tbl><w:tr></w:tbl><w:p/>'
  expect([...chunkTopLevel(s, 0, s.length)].length).toBe(2)
  const bad: OfficeFile = {
    doc: null,
    docXml: `<w:document ${WNS}><w:body><w:tbl><w:tr></w:tbl></w:body></w:document>`,
    chunked: true,
    numbering: null,
    styles: null
  }
  expect(() => extractOutline(bad, new IssueCollector())).toThrow(/分块解析失败/)
})

// —— 双路径一致性（10-大文档处理 4.4：同一内容两条路径结果逐字节一致） ——

/** 手工构造分块路径 OfficeFile（绕过 20MB 阈值，直接驱动 chunkedBodyElements） */
function chunkedOfficeOf(spec: DocSpec): OfficeFile {
  const buf = buildDocxBuffer(spec)
  const files = unzipSync(new Uint8Array(buf))
  const whole = readDocx(new Uint8Array(buf))
  return {
    doc: null,
    docXml: strFromU8(files['word/document.xml']),
    chunked: true,
    numbering: whole.numbering,
    styles: whole.styles
  }
}

const m1LikeSpec: DocSpec = {
  content: [
    { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
    { kind: 'p', para: { text: '功能测试', heading: 4, numId: 1, ilvl: 3 } },
    { kind: 'p', para: { text: '一致性测试项', heading: 6, numId: 1, ilvl: 5 } },
    {
      kind: 'tbl',
      rows: itemTable('一致性测试项', 'XQ_YZ_TB', [
        [DESC, [
          { textParts: ['1.第一个用例（XQ_YZ_TB001）', '第一个用例的综述；'] },
          { text: '2.第二个用例（XQ_YZ_TB002）\n第二个用例的综述。' }
        ]],
        [METHOD, [
          { textParts: ['1.第一个用例（XQ_YZ_TB001）', '1）点击查询按钮，', '查看结果是否正确显示；'] },
          { text: '2.第二个用例（XQ_YZ_TB002）\n1）执行导出操作，查看导出文件完整；' }
        ]],
        [CRITERIA, [
          { textParts: ['1、第一个用例（XQ_YZ_TB001）', '1）结果正确显示；'] },
          { text: '2、第二个用例（XQ_YZ_TB002）\n1）导出文件完整；' }
        ]]
      ])
    }
  ]
}

const nestedSpec: DocSpec = {
  content: [
    { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
    { kind: 'p', para: { text: '接口测试', heading: 4, numId: 1, ilvl: 3 } },
    {
      kind: 'tbl',
      rows: itemTable('嵌套表格测试项', 'XQ_QT_NT', [
        [DESC, '1.嵌套用例（XQ_QT_NT001）\n嵌套表格项的综述。'],
        [METHOD, '1.嵌套用例（XQ_QT_NT001）\n1）执行嵌套场景，查看正常；']
      ])
    }
  ]
}

describe('双路径一致性', () => {
  for (const [name, spec] of [['m1 形态（含软换行）', m1LikeSpec], ['嵌套表格形态', nestedSpec]] as const) {
    test(name, () => {
      const a = extractOutline(buildDocx(spec), new IssueCollector())
      const b = extractOutline(chunkedOfficeOf(spec), new IssueCollector())
      expect(JSON.stringify(b.items)).toBe(JSON.stringify(a.items))
      expect(JSON.stringify(b.stats)).toBe(JSON.stringify(a.stats))
      expect(JSON.stringify(b.issues)).toBe(JSON.stringify(a.issues))
    })
  }
})

// —— 阈值判定与分块 e2e ——

/**
 * 合成大正文 docx：测试项部分 + 大量填充段落。中文填充（UTF-8 每字 3 字节），
 * 每个填充段 ≈ 23 字 × 3 + 标签 ≈ 134 字节，zip 内重复文本压缩率高、体积很小。
 */
function bigDocx(targetMB: number): Buffer {
  const section = paraXml({ text: '测试项及方法', heading: 2 })
    + paraXml({ text: '功能测试', heading: 4 })
    + tableXml(itemTable('大文档测试项', 'XQ_BIG', [
        [DESC, '1.大文档用例（XQ_BIG001）\n大文档分块解析用例综述。'],
        [METHOD, '1.大文档用例（XQ_BIG001）\n1）执行大文档解析，查看结果正确；']
      ]))
  const unit = '<w:p><w:r><w:t>填充段落文字用于撑大正文体积验证分块解析链路。</w:t></w:r></w:p>'
  const n = Math.ceil((targetMB * 1048576) / Buffer.byteLength(unit, 'utf8'))
  const xml = `<w:document ${WNS}><w:body>${section}${unit.repeat(n)}</w:body></w:document>`
  return zipSync({ 'word/document.xml': strToU8(xml) }) as Buffer
}

describe('阈值判定与分块 e2e', () => {
  test('21MB 正文：分块判定 + 解析统计 + 字段同构', () => {
    const office = readDocx(new Uint8Array(bigDocx(21)))
    expect(office.chunked).toBe(true)
    expect(office.doc).toBeNull()
    const parsed = extractOutline(office, new IssueCollector())
    expect(parsed.stats).toEqual({ items: 1, cases: 1, steps: 1 })
    expect(Object.keys(parsed.stats).sort()).toEqual(['cases', 'items', 'steps'])
  }, 30000)
})
