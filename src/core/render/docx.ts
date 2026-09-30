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

  return doc.getZip().generate({ type: 'nodebuffer' }) as Buffer
}
