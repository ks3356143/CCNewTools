/**
 * 回归说明渲染后处理（2026-11-22 用户两拍板）：
 * ① 需求表 label|值 行的值格里，渲染器按 \n 生成的 <w:br/> 软换行 → 拆成真正的多个 <w:p>（回车段落）；
 * ② 测试项描述 / 测试方法 / 通过准则 三行中，子项标题行（如「1、合法文件变量名恢复（XQ_SU_VARR_SU01）」）整行加粗。
 * 模式：数字 + 、/./． 且后跟非数字（「3.2.1」类章节号行不误伤；「1）」步骤行不命中）。
 */
import { XMLSerializer } from '@xmldom/xmldom'
import PizZip from 'pizzip'
import { readDocx, bodyElements, textOf, W, type OfficeFile } from '../parse/docx.ts'

const BOLD_ROWS = new Set(['测试项描述', '测试方法', '通过准则'])
const SUB_ITEM_HEAD = /^\d+[、.．](?!\d)/
/** xmldom 序列化器收自家 Node 类型，与全局 Document 类型不一致——运行时同一对象，边界就地取参数类型 */
type XmlDomNode = Parameters<XMLSerializer['serializeToString']>[0]

export function regressPost(buf: Buffer): Buffer {
  const raw = new PizZip(buf).file('word/document.xml')!.asText()
  const office = readDocx(new Uint8Array(buf))
  // 分块路径理论上到不了（回归产物远小于阈值），保守跳过不改动
  if (office.doc === null) return buf
  const doc = office.doc
  let touched = false
  for (const tbl of bodyElements(office)) {
    if (tbl.localName !== 'tbl' || !textOf(tbl).replace(/\s+/g, '').startsWith('测试项名称')) continue
    for (const tr of Array.from(tbl.getElementsByTagNameNS(W, 'tr')) as Element[]) {
      const tcs = Array.from(tr.getElementsByTagNameNS(W, 'tc')) as Element[]
      if (tcs.length < 2) continue
      const label = textOf(tcs[0]).replace(/\s+/g, '')
      const value = tcs[tcs.length - 1]
      const boldRow = BOLD_ROWS.has(label)
      for (const p of Array.from(value.getElementsByTagNameNS(W, 'p')) as Element[]) {
        if (p.getElementsByTagNameNS(W, 'br').length === 0) continue
        splitBrParagraph(doc, p, boldRow)
        touched = true
      }
      if (!boldRow) continue
      for (const r of Array.from(value.getElementsByTagNameNS(W, 'r')) as Element[]) {
        const text = Array.from(r.getElementsByTagNameNS(W, 't')).map((t) => t.textContent ?? '').join('')
        if (SUB_ITEM_HEAD.test(text.trim())) addBold(doc, r)
      }
    }
  }
  if (!touched) return buf
  let outXml = new XMLSerializer().serializeToString(doc as unknown as XmlDomNode)
  outXml = outXml.replace(/^\s*<\?xml[^>]*\?>\s*/, '')
  outXml = outXml.replace(/ w14:(?:paraId|textId)="[^"]*"/g, '')
  const decl = raw.slice(0, raw.indexOf('<w:document'))
  const zip = new PizZip(buf)
  zip.file('word/document.xml', decl + outXml)
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer
}

/** 把含 <w:br/> 的段落拆成每行一个 <w:p>；boldRow 时命中子项标题模式的行加粗
 *  （工具四报告产物复用：表38 值格换行同样按用户「真回车」拍板处理，2026-11-22 起导出） */
export function splitBrParagraph(doc: Document, p: Element, boldRow: boolean): void {
  // 收行：br 结行；文本 run 归当前行（渲染器形态：文本 run 与 br-only run 交替）
  const lines: Element[][] = [[]]
  for (const r of Array.from(p.getElementsByTagNameNS(W, 'r')) as Element[]) {
    const hasBr = r.getElementsByTagNameNS(W, 'br').length > 0
    const ts = Array.from(r.getElementsByTagNameNS(W, 't'))
    if (hasBr && ts.length === 0) {
      lines.push([])
      continue
    }
    lines[lines.length - 1].push(r)
    if (hasBr) lines.push([])
  }
  // 逐行克隆段落壳（保留 pPr），行内 run 原样克隆（剥 br），命中加粗
  for (const line of lines) {
    const np = p.cloneNode(false) as Element
    const pPr = p.getElementsByTagNameNS(W, 'pPr')[0]
    if (pPr !== undefined) np.appendChild(pPr.cloneNode(true))
    for (const src of line) {
      const nr = src.cloneNode(true) as Element
      for (const br of Array.from(nr.getElementsByTagNameNS(W, 'br'))) br.parentNode!.removeChild(br)
      const text = Array.from(nr.getElementsByTagNameNS(W, 't')).map((t) => t.textContent ?? '').join('')
      if (boldRow && SUB_ITEM_HEAD.test(text.trim())) addBold(doc, nr)
      np.appendChild(nr)
    }
    p.parentNode!.insertBefore(np, p)
  }
  p.parentNode!.removeChild(p)
}

/** 给 run 加粗：无 rPr 则插 <w:rPr><w:b/></w:rPr>；有 rPr 则把 <w:b/> 放到 rFonts 之后（保持 rPr 子元素次序合法） */
function addBold(doc: Document, r: Element): void {
  const rPr = r.getElementsByTagNameNS(W, 'rPr')[0]
  if (rPr === undefined) {
    const newPr = doc.createElementNS(W, 'w:rPr')
    newPr.appendChild(doc.createElementNS(W, 'w:b'))
    r.insertBefore(newPr, r.firstChild)
    return
  }
  if (rPr.getElementsByTagNameNS(W, 'b').length > 0) return
  const b = doc.createElementNS(W, 'w:b')
  const rFonts = rPr.getElementsByTagNameNS(W, 'rFonts')[0]
  if (rFonts !== undefined && rFonts.nextSibling !== null) rPr.insertBefore(b, rFonts.nextSibling)
  else if (rFonts !== undefined) rPr.appendChild(b)
  else rPr.insertBefore(b, rPr.firstChild)
}
