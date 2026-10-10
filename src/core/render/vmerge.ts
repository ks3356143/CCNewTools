/**
 * 追踪表纵向合并渲染后处理（12-追踪文档工具 v2）。
 * docxtemplater 循环只能复制行，vMerge 单元格属性无法在模板里条件化——
 * 渲染完成后按 rows 的 span 标记对数据行做 XML 手术：
 * span≥2 首行加 <w:vMerge w:val="restart"/>，span=0 续行加 <w:vMerge/> 并清空格内文本。
 * 插入位置遵守 CT_TcPr 子元素顺序（tcW → gridSpan → vMerge → tcBorders → vAlign）。
 */
import PizZip from 'pizzip'
import type { TraceRowVM } from '../trace/table.ts'

const DOC = 'word/document.xml'

/** 表内逐行切开（保留分隔符） */
function splitRows(tbl: string): string[] {
  const parts = tbl.split('</w:tr>')
  return parts.map((s, i) => (i < parts.length - 1 ? s + '</w:tr>' : s))
}

/** 给一个 tc 的 tcPr 插入 vMerge 标记（tcW 之后；无 tcW 则 tcPr 开头） */
function insertVmerge(tc: string, restart: boolean): string {
  const tag = restart ? '<w:vMerge w:val="restart"/>' : '<w:vMerge/>'
  const tcWEnd = tc.indexOf('/><w:')
  const tcW = /<w:tcW [^>]*\/>/.exec(tc)
  if (tcW !== null) {
    const at = tc.indexOf(tcW[0]) + tcW[0].length
    return tc.slice(0, at) + tag + tc.slice(at)
  }
  void tcWEnd
  // 无 tcW：tcPr 开标签后直接插
  const prOpen = tc.indexOf('<w:tcPr>')
  if (prOpen >= 0) {
    const at = prOpen + '<w:tcPr>'.length
    return tc.slice(0, at) + tag + tc.slice(at)
  }
  return tc
}

/** 清空一个 tc 内全部 <w:t> 文本（vMerge 续行格的文本会被 Word 忽略，清空保干净） */
function clearCellText(tc: string): string {
  return tc.replace(/(<w:t[^>]*>)[^<]*(<\/w:t>)/g, '$1$2')
}

/**
 * 对追踪文档渲染产物执行纵向合并。
 * rows 与文档数据行一一对应（顺序一致）；headerRows = 表头行数（双层 = 2）。
 */
export function applyVmergeToDocx(buf: Buffer, rows: TraceRowVM[], headerRows: number): Buffer {
  const need = rows.some(r => r.span.some(s => s > 1))
  if (!need) return buf
  const zip = new PizZip(buf)
  const doc = zip.file(DOC)
  if (doc === null) return buf
  let xml = doc.asText()
  const t0 = xml.indexOf('<w:tbl>')
  const tEnd = xml.lastIndexOf('</w:tbl>') + '</w:tbl>'.length
  if (t0 < 0 || tEnd <= t0) return buf
  const trs = splitRows(xml.slice(t0, tEnd))
  // 数据行从表头之后开始；锚点行已被 stripAnchorMarks 剥离
  const dataStart = headerRows
  const nCols = rows[0]?.span.length ?? 0
  for (let i = 0; i < rows.length; i++) {
    const tr = trs[dataStart + i]
    if (tr === undefined) break
    if (!rows[i].span.some(s => s === 0 || s > 1)) continue
    // 行内逐格切开（保留分隔符）；格数 = 列数（vMerge 不改格数，gridSpan 才改——循环行无 gridSpan）
    const tcParts = tr.split('</w:tc>').map((s, k, a) => (k < a.length - 1 ? s + '</w:tc>' : s))
    for (let c = 0; c < nCols && c < tcParts.length - 1; c++) {
      const span = rows[i].span[c]
      if (span === 0) tcParts[c] = clearCellText(insertVmerge(tcParts[c], false))
      else if (span > 1) tcParts[c] = insertVmerge(tcParts[c], true)
    }
    trs[dataStart + i] = tcParts.join('')
  }
  xml = xml.slice(0, t0) + trs.join('') + xml.slice(tEnd)
  zip.file(DOC, xml)
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer
}
