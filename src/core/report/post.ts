/**
 * 工具四报告产物渲染后处理：
 * 表38（需求符合性情况对照表）值格里渲染器按 \n 生成的 <w:br/> 软换行
 * → 拆成真正的多个 <w:p>（与工具三第五轮用户拍板「换行用真回车」同规则）。
 */
import { XMLSerializer } from '@xmldom/xmldom'
import PizZip from 'pizzip'
import { readDocx, bodyElements, textOf, W, type OfficeFile } from '../parse/docx.ts'
import { splitBrParagraph } from '../regress/post.ts'

/** xmldom 序列化器收自家 Node 类型，与全局 Document 类型不一致——运行时同一对象，边界就地取参数类型 */
type XmlDomNode = Parameters<XMLSerializer['serializeToString']>[0]

/** 表38 表头连排文字（去空白比对，避免空白差异漏识别） */
const TBL_HEAD = '序号功能性能指标来源功能性能指标测评结果及符合情况'

export function reportPost(buf: Buffer): Buffer {
  const raw = new PizZip(buf).file('word/document.xml')!.asText()
  const office: OfficeFile = readDocx(new Uint8Array(buf))
  // 分块路径理论上到不了（报告产物远小于阈值），保守跳过不改动
  if (office.doc === null) return buf
  let touched = false
  for (const el of bodyElements(office)) {
    if (el.localName !== 'tbl') continue
    if (!textOf(el).replace(/\s+/g, '').startsWith(TBL_HEAD)) continue
    for (const p of Array.from(el.getElementsByTagNameNS(W, 'p')) as Element[]) {
      if (p.getElementsByTagNameNS(W, 'br').length === 0) continue
      splitBrParagraph(office.doc, p, false)
      touched = true
    }
  }
  if (!touched) return buf
  let outXml = new XMLSerializer().serializeToString(office.doc as unknown as XmlDomNode)
  outXml = outXml.replace(/^\s*<\?xml[^>]*\?>\s*/, '')
  outXml = outXml.replace(/ w14:(?:paraId|textId)="[^"]*"/g, '')
  const decl = raw.slice(0, raw.indexOf('<w:document'))
  const zip = new PizZip(buf)
  zip.file('word/document.xml', decl + outXml)
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer
}
