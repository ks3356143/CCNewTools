/**
 * 追踪模板列重塑（2026-11-28 同事需求：四类追踪表列显隐/顺序可配）。
 * 模板表格六段（</w:tr> 切分）：组行 / 子列行 / _TR_BEGIN_ 锚点行 / 循环行 / _TR_END_ 锚点行 / 尾料。
 * 重塑 = 按目标变量序 toVars 对 循环行/子列行/组行/tblGrid 四层同时投影：
 * 循环行/子列行逐格按原位取格（样式保真），组行按组名归属重组跨列，tblGrid 重写。
 * 供服务端生成前在内存中调用，不落盘。
 */
import PizZip from 'pizzip'

const DOC = 'word/document.xml'

function cellsOf(tr: string): string[] {
  // 段首可能携带行开标签（首格的切分段以 <w:tr><w:tc> 开头）→ 剥到首个 <w:tc> 才是干净格体
  let body = tr
  const trOpen = body.indexOf('<w:tr')
  if (trOpen >= 0 && !body.slice(0, trOpen).includes('<w:tc>')) {
    const tcStart = body.indexOf('<w:tc>')
    if (tcStart > trOpen) body = body.slice(tcStart)
  }
  const parts = body.split('</w:tc>')
  return parts.slice(0, -1).map(p => p + '</w:tc>')
}

function txtOf(tc: string): string {
  return [...tc.matchAll(/<w:t[^>]*>([^<]*)</g)].map(m => m[1]).join('')
}

/** 文本写入第一个 w:t，其余 w:t 清空（克隆格改标题用） */
function setText(tc: string, text: string): string {
  const ms = [...tc.matchAll(/(<w:t[^>]*>)([^<]*)(<\/w:t>)/g)]
  let out = tc
  for (let k = ms.length - 1; k >= 0; k--) {
    const m = ms[k]
    out = out.slice(0, m.index) + m[1] + (k === 0 ? text : '') + m[3] + out.slice(m.index + m[0].length)
  }
  return out
}

function setW(tc: string, w: number): string {
  if (/<w:tcW /.test(tc)) return tc.replace(/<w:tcW [^>]*\/>/, `<w:tcW w:w="${w}" w:type="dxa"/>`)
  return tc.replace('<w:tcPr>', `<w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>`)
}

function spanOf(tc: string): number {
  const m = /<w:gridSpan w:val="(\d+)"/.exec(tc)
  return m !== null ? parseInt(m[1], 10) : 1
}

function setSpan(tc: string, n: number): string {
  if (/<w:gridSpan/.test(tc)) return tc.replace(/<w:gridSpan w:val="\d+"/, `<w:gridSpan w:val="${n}"`)
  return tc.replace(/(<w:tcW [^>]*\/>)/, `$1<w:gridSpan w:val="${n}"/>`)
}

export interface TraceReshapeInput {
  /** 模板当前叶子变量序（与模板实际列序一致） */
  fromVars: string[]
  /** 目标叶子变量序（fromVars 的子集或重排） */
  toVars: string[]
  /** 每个目标变量的组名（独立列 = 空串） */
  toGroups: string[]
  /** 每个目标变量的子列头文本（独立列的组行格文本与此一致：序号/备注） */
  toSubHeads: string[]
  /** 每个目标变量的列宽 dxa（调用方配平总宽） */
  toWidths: number[]
}

/**
 * 模板列重塑：返回改好 document.xml 的模板 buffer。
 * toVars 与 fromVars 完全同序时原样返回（零开销）；结构不符时原样返回（宁可不改不渲染坏文档）。
 */
export function reshapeTraceTemplate(buf: Buffer, input: TraceReshapeInput): Buffer {
  const { fromVars, toVars, toGroups, toSubHeads, toWidths } = input
  const same = fromVars.length === toVars.length && fromVars.every((v, i) => v === toVars[i])
  if (same) return buf
  const zip = new PizZip(buf)
  const doc = zip.file(DOC)
  if (doc === null) return buf
  const xml = doc.asText()
  const t0 = xml.indexOf('<w:tbl>')
  const tEnd = xml.lastIndexOf('</w:tbl>') + '</w:tbl>'.length
  if (t0 < 0 || tEnd <= t0) return buf
  const tbl = xml.slice(t0, tEnd)
  // </w:tr> 切分：段 0=组行 1=子列行 2=BEGIN 锚点 3=循环行 4=END 锚点 5=尾料（通常空串）
  const trs = tbl.split('</w:tr>')
  const loopAt = trs.findIndex(t => t.includes('{#traceRows}'))
  if (loopAt !== 3) return buf
  const subCells = cellsOf(trs[1])
  const loopCells = cellsOf(trs[3])
  const grpCells = cellsOf(trs[0])
  if (subCells.length !== fromVars.length || loopCells.length !== fromVars.length) return buf

  // 循环行/子列行：按 toVars 取原位格（样式随格走），写宽度/子列头
  const newSub: string[] = []
  const newLoop: string[] = []
  for (let i = 0; i < toVars.length; i++) {
    const at = fromVars.indexOf(toVars[i])
    if (at < 0) return buf
    // 原格可能携带旧循环标记（首格 {#traceRows} / 尾格 {/traceRows}），重排后位置错乱 → 先剥净
    let loopCell = loopCells[at].replace(/\{#traceRows\}/g, '').replace(/\{\/traceRows\}/g, '')
    newSub.push(setW(setText(subCells[at], toSubHeads[i]), toWidths[i]))
    newLoop.push(setW(loopCell, toWidths[i]))
  }
  // 循环标记按新位置放回：open/close 都锚在循环变量文本上（{no} 前 / {result} 后），
  // 不锚 w:t 开闭标签——格内空段在前时 w:t 锚会落空段
  const openVar = '{' + toVars[0] + '}'
  if (!newLoop[0].includes(openVar)) return buf
  newLoop[0] = newLoop[0].replace(openVar, '{#traceRows}' + openVar)
  const closeVar = '{' + toVars[toVars.length - 1] + '}'
  const lastCell = newLoop[newLoop.length - 1]
  if (!lastCell.includes(closeVar)) return buf
  newLoop[newLoop.length - 1] = lastCell.replace(closeVar, closeVar + '{/traceRows}')

  // 组行：按 toGroups 重组（同组连续叶子合成一格；组名空 = 独立列）
  const grpOut: string[] = []
  let li = 0
  while (li < toVars.length) {
    const g = toGroups[li]
    let n = 1
    while (li + n < toVars.length && toGroups[li + n] === g && g !== '') n++
    if (g === '') {
      // 独立列：原组行同文本格做供体（序号/备注的组行格文本 = 子列头文本，带 vMerge 两行合并）；
      // 供体用一次剥一次 vMerge 标记，防同文本多列时重复挂标记
      let donor = grpCells.find(tc => spanOf(tc) === 1 && txtOf(tc) === toSubHeads[li])
      if (donor === undefined) {
        donor = setSpan(setText(grpCells[0], toSubHeads[li]), 1)
        grpCells.push(donor)
      }
      donor = donor.replace(/<w:vMerge[^/]*\/>/, '')
      grpOut.push(setW(donor, toWidths[li]))
    } else {
      const donor = grpCells.find(tc => txtOf(tc) === g)
      if (donor === undefined) return buf
      grpOut.push(setW(setSpan(setText(donor, g), n), toWidths.slice(li, li + n).reduce((a, b) => a + b, 0)))
    }
    li += n
  }

  const gridXml = '<w:tblGrid>' + toWidths.map(w => `<w:gridCol w:w="${w}"/>`).join('') + '</w:tblGrid>'
  // 切分段自带 <w:tr> 开头（</w:tr> 已被切走）与尾料段自带 </w:tbl>；组/子列/循环三行是新拼的
  const newTbl =
    tbl.slice(0, tbl.indexOf('<w:tr')) +
    gridXml +
    '<w:tr>' + grpOut.join('') + '</w:tr>' +
    '<w:tr>' + newSub.join('') + '</w:tr>' +
    trs[2] + '</w:tr>' +
    '<w:tr>' + newLoop.join('') + '</w:tr>' +
    trs[4] + '</w:tr>' +
    trs[5]
  zip.file(DOC, xml.slice(0, t0) + newTbl + xml.slice(tEnd))
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer
}
