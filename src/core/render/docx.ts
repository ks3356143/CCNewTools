import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'

/** 渲染单份文档（01 数据流第 3 步）：模板 + 数据 → docx buffer */
export function renderTemplate(template: Buffer, data: object): Buffer {
  let zip: PizZip
  try {
    zip = new PizZip(template)
  } catch {
    throw new Error('模板文件损坏，无法读取')
  }

  let doc: Docxtemplater
  try {
    doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      // 缺失的简单变量直接抛错（06：渲染异常必须暴露，不允许静默出空文档）；
      // 循环/模块标签（{#cases} 等）返回空串让 section 正常跳过
      nullGetter(part: { module?: unknown; value?: unknown; exprOrGlobalName?: unknown }) {
        if (part && part.module) return ''
        const name = (part?.value ?? part?.exprOrGlobalName ?? '未知占位符') as string
        throw new Error('数据缺少模板变量：' + String(name))
      }
    })
    doc.render(data)
  } catch (e) {
    const prop = e as { properties?: { errors?: Array<{ message?: string }> } }
    const detail = prop?.properties?.errors
      ? prop.properties.errors.map(x => x.message ?? '').join('；')
      : e instanceof Error ? e.message : String(e)
    throw new Error('模板渲染失败：' + detail)
  }

  return fixOrphanBookmarkEnds(doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer)
}

/**
 * 渲染后处理：剔除悬空/重复的书签结束标记（2026-10-01 终验发现）。
 * 记录模板的 _Toc 书签结束标记落在 {#cases} 循环区内，docxtemplater 复制循环体时
 * 把 bookmarkEnd 一并复制（起标记在循环外仅 1 个 → "1 起 N 终"）。Word 能容忍打开，
 * 但产物须通过 OOXML 语义校验（bookmark id 必须唯一配对）。
 * 处理：每个 id 保留与起标记等量的结束标记（按出现顺序取前 N 个），多余的删除。
 */
function fixOrphanBookmarkEnds(buf: Buffer): Buffer {
  const zip = new PizZip(buf)
  const file = zip.files['word/document.xml']
  if (!file) return buf
  const xml = file.asText()

  const startCount = new Map<string, number>()
  for (const m of xml.matchAll(/<w:bookmarkStart\b[^>]*>/g)) {
    const id = /w:id="([^"]+)"/.exec(m[0])?.[1]
    if (id !== undefined) startCount.set(id, (startCount.get(id) ?? 0) + 1)
  }
  const seen = new Map<string, number>()
  const fixed = xml.replace(/<w:bookmarkEnd\b[^>]*\/?>/g, function (el: string): string {
    const id = /w:id="([^"]+)"/.exec(el)?.[1]
    if (id === undefined) return el
    const n = (seen.get(id) ?? 0) + 1
    seen.set(id, n)
    return n <= (startCount.get(id) ?? 0) ? el : ''
  })
  if (fixed === xml) return buf
  zip.file('word/document.xml', fixed)
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer
}
