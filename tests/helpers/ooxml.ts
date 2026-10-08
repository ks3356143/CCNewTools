import { zipSync, strToU8 } from 'fflate'
import { DOMParser } from '@xmldom/xmldom'
import { readDocx, type OfficeFile } from '../../src/core/parse/docx.ts'

/** 合成 .docx 的最小 OOXML 构造器（07 测试策略：脱敏样本，纯代码生成不依赖 Word） */

export interface ParaSpec {
  /** 段落文本；给出 textParts 时可省略 */
  text?: string
  /** 标题级别（1 基），以 outlineLvl 直接标注 */
  heading?: number
  /** 自动编号列表 */
  numId?: number
  ilvl?: number
  /**
   * 段内软换行（Shift+Enter，w:br）测试记号（2026-10-08 新变种）：给出时优先于 text，
   * 各片段以 <w:br/> 连接在同一 run 内——模拟单元格里用 br 分隔行的真实写法
   */
  textParts?: string[]
}

export type Cell = string | ParaSpec | ParaSpec[]

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function paraXml(spec: ParaSpec): string {
  let pPr = ''
  const props: string[] = []
  if (spec.heading !== undefined) props.push('<w:outlineLvl w:val="' + (spec.heading - 1) + '"/>')
  if (spec.numId !== undefined) {
    props.push('<w:numPr><w:ilvl w:val="' + (spec.ilvl ?? 0) + '"/><w:numId w:val="' + spec.numId + '"/></w:numPr>')
  }
  if (props.length > 0) pPr = '<w:pPr>' + props.join('') + '</w:pPr>'
  if (spec.textParts !== undefined) {
    const inner = spec.textParts.map(t => '<w:t xml:space="preserve">' + esc(t) + '</w:t>').join('<w:br/>')
    return '<w:p>' + pPr + '<w:r>' + inner + '</w:r></w:p>'
  }
  return '<w:p>' + pPr + '<w:r><w:t xml:space="preserve">' + esc(spec.text ?? '') + '</w:t></w:r></w:p>'
}

export function cellXml(spec: Cell): string {
  let list: ParaSpec[]
  if (typeof spec === 'string') {
    list = spec.split('\n').map(function (t) { return { text: t } })
  } else if (Array.isArray(spec)) {
    list = spec
  } else {
    list = [spec]
  }
  let xml = '<w:tc>'
  if (list.length === 0) list.push({ text: '' })
  for (const s of list) xml += paraXml(s)
  xml += '</w:tc>'
  return xml
}

export function tableXml(rows: Cell[][]): string {
  let xml = '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>'
  for (const row of rows) {
    xml += '<w:tr>'
    for (const c of row) xml += cellXml(c)
    xml += '</w:tr>'
  }
  xml += '</w:tbl>'
  return xml
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

function numberingXml(): string {
  let lvls = ''
  for (let i = 0; i < 9; i++) {
    lvls += '<w:lvl w:ilvl="' + i + '"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl>'
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0">${lvls}</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`
}

export interface DocSpec {
  /** 文档顺序内容 */
  content: Array<{ kind: 'p'; para: ParaSpec } | { kind: 'tbl'; rows: Cell[][] }>
  /** 是否包含 numbering.xml（默认含） */
  withNumbering?: boolean
}

export function buildDocxBuffer(spec: DocSpec): Buffer {
  let body = ''
  for (const part of spec.content) {
    if (part.kind === 'p') body += paraXml(part.para)
    else body += tableXml(part.rows)
  }
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(RELS),
    'word/document.xml': strToU8(document)
  }
  if (spec.withNumbering !== false) files['word/numbering.xml'] = strToU8(numberingXml())
  return zipSync(files) as Buffer
}

export function buildDocx(spec: DocSpec): OfficeFile {
  return readDocx(new Uint8Array(buildDocxBuffer(spec)))
}

/** 构造测试项表格（首行：测试项名称 | 名称 | 标识 | 标识值） */
export function itemTable(name: string, itemId: string, extraRows: Cell[][]): Cell[][] {
  return [
    [{ text: '测试项名称' }, { text: name }, { text: '标识' }, { text: itemId }],
    ...extraRows
  ]
}

export const DESC = '测试项描述'
export const METHOD = '测试方法'
export const CRITERIA = '通过准则'
