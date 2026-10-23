import { describe, test, expect } from 'bun:test'
import { DOMParser } from '@xmldom/xmldom'
import { parseStyles, headingLevel, styleNumPr } from '../src/core/parse/styles.ts'

/** styles.xml → 标题级别/编号回退（真实大纲里标题样式可能只挂在样式上） */

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

function parse(xml: string): Document {
  return new DOMParser({ onError: () => {} }).parseFromString(xml, 'text/xml') as unknown as Document
}

const stylesDoc = parse(`<w:styles xmlns:w="${W}">
  <w:style w:styleId="H2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>
  <w:style w:styleId="CN4"><w:name w:val="标题 4"/></w:style>
  <w:style w:styleId="NUM"><w:pPr><w:numPr><w:ilvl w:val="2"/><w:numId w:val="7"/></w:numPr></w:pPr></w:style>
  <w:style w:styleId="PLAIN"><w:name w:val="正文"/></w:style>
</w:styles>`)

function para(inner: string): Element {
  return parse(`<w:p xmlns:w="${W}">${inner}</w:p>`).documentElement as unknown as Element
}

describe('M1 styles.xml 解析（低覆盖补测）', () => {
  test('parseStyles 读出 outlineLvl / 样式名 / numPr', () => {
    const map = parseStyles(stylesDoc)
    expect(map.get('H2')).toEqual({ outlineLvl: 1, name: 'heading 2', numPr: null })
    expect(map.get('CN4')?.name).toBe('标题 4')
    expect(map.get('NUM')?.numPr).toEqual({ numId: '7', ilvl: 2 })
  })

  test('headingLevel：段落直写 outlineLvl 优先，其次样式', () => {
    const map = parseStyles(stylesDoc)
    expect(headingLevel(para('<w:pPr><w:pStyle w:val="H2"/></w:pPr>'), map)).toBe(2)
    expect(headingLevel(para('<w:pPr><w:pStyle w:val="CN4"/></w:pPr>'), map)).toBe(4)
    // 段落直接格式 0 基（val=2）→ 3 级，压过样式的 2 级
    expect(headingLevel(para('<w:pPr><w:pStyle w:val="H2"/><w:outlineLvl w:val="2"/></w:pPr>'), map)).toBe(3)
    expect(headingLevel(para('<w:pPr><w:pStyle w:val="PLAIN"/></w:pPr>'), map)).toBeNull()
    expect(headingLevel(para(''), map)).toBeNull()
  })

  test('headingLevel：样式名 heading N / 标题 N 回退', () => {
    const map = parseStyles(parse(`<w:styles xmlns:w="${W}">
      <w:style w:styleId="A"><w:name w:val="Heading 5"/></w:style>
      <w:style w:styleId="B"><w:name w:val="标题 6"/></w:style>
    </w:styles>`))
    expect(headingLevel(para('<w:pPr><w:pStyle w:val="A"/></w:pPr>'), map)).toBe(5)
    expect(headingLevel(para('<w:pPr><w:pStyle w:val="B"/></w:pPr>'), map)).toBe(6)
  })

  test('styleNumPr：返回样式编号，无样式/无编号时 null', () => {
    const map = parseStyles(stylesDoc)
    expect(styleNumPr(para('<w:pPr><w:pStyle w:val="NUM"/></w:pPr>'), map)).toEqual({ numId: '7', ilvl: 2 })
    expect(styleNumPr(para('<w:pPr><w:pStyle w:val="PLAIN"/></w:pPr>'), map)).toBeNull()
    expect(styleNumPr(para(''), map)).toBeNull()
  })

  test('parseStyles(null) 返回空表', () => {
    expect(parseStyles(null).size).toBe(0)
  })
})
