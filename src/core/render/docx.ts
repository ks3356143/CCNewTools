import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import { totalmem } from 'node:os'

/** 渲染单份文档（01 数据流第 3 步）：模板 + 数据 → docx buffer */
export function renderTemplate(template: Buffer, data: object): Buffer {
  const zip = renderDocxtemplater(template, data)
  return fixOrphanBookmarkEnds(zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer)
}

/** 渲染内核：模板 + 数据 → 渲染后的 PizZip 实例（不打包；批渲染只取 document.xml，跳过压缩开销） */
function renderDocxtemplater(template: Buffer, data: object): PizZip {
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
  return doc.getZip()
}

/* ------------------------------------------------------------------ *
 * 分批渲染（10-大文档处理 5.2，v1.3.0）
 *
 * 整体渲染内存 ≈226KB/例（29686 例实测 6.7GB），docxtemplater 对全量循环
 * 做字符串复制的放大不可控。分批思路：模板循环区埋锚点（模板/测试说明模板、
 * 测试记录模板已手术），骨架渲染（循环区喂空）+ 逐批渲染（每批只喂该区数据、
 * 其余区空），按锚点抽取循环区片段累积进骨架，锚点与悬空书签最终清理。
 * 每批渲染完即弃（峰值 = 单批 + 累积 XML 片段），内存与用例总数脱钩。
 * ------------------------------------------------------------------ */

export interface LoopSpec {
  /** 数据字段名（data[field] 是该循环区的行数组） */
  field: string
  /** 模板中该区 BEGIN 锚点串 */
  begin: string
  /** 模板中该区 END 锚点串 */
  end: string
  /** 每批行数 */
  batchSize: number
}

/** 锚点在模板中的固定形态（模板锚点手术保证），渲染产物中按此精确切片 */
const paraAnchorXml = (name: string) => `<w:p><w:r><w:t>${name}</w:t></w:r></w:p>`
const rowAnchorXml = (name: string) =>
  '<w:tr><w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p><w:r><w:t>' + name + '</w:t></w:r></w:p></w:tc></w:tr>'

function anchorXml(kind: 'row' | 'para', name: string): string {
  return kind === 'row' ? rowAnchorXml(name) : paraAnchorXml(name)
}

/**
 * 分批渲染。data 中 loops 声明的字段按 batchSize 拆批，其余变量整场共用。
 * 逐区处理：当前 XML 定位锚点 → 逐批渲染（其余区喂空，片段即用即弃）→ 组装删锚点。
 * 返回与 renderTemplate 同构的 docx buffer。
 */
export function renderTemplateBatched(
  template: Buffer,
  data: Record<string, unknown>,
  loops: LoopSpec[],
  onProgress?: (done: number, total: number) => void
): Buffer {
  // 1. 骨架：所有循环区喂空
  const skeletonData: Record<string, unknown> = { ...data }
  for (const l of loops) skeletonData[l.field] = []
  const skeletonZip = new PizZip(renderTemplate(template, skeletonData))
  let finalXml = skeletonZip.file('word/document.xml')!.asText()

  const totalBatches = loops.reduce((n, l) => n + Math.ceil(((data[l.field] as unknown[] | undefined)?.length ?? 0) / l.batchSize), 0)
  let done = 0

  // 2. 逐区：定位（前区组装会移动位置，每次重定位）→ 批渲染累积 → 组装删锚点
  for (const l of loops) {
    const rows = (data[l.field] as unknown[] | undefined) ?? []
    const beginForm = anchorForm(finalXml, l.begin)
    const endForm = anchorForm(finalXml, l.end)
    if (!beginForm || !endForm) throw new Error('模板锚点缺失：' + l.begin)

    const chunks: string[] = []
    for (let off = 0; off < rows.length; off += l.batchSize) {
      const batch = rows.slice(off, off + l.batchSize)
      const batchData: Record<string, unknown> = { ...data }
      // 其余区喂空：批产物只取本区片段，别让全量数据在每批重复渲染（内存白烧）
      for (const other of loops) batchData[other.field] = other.field === l.field ? batch : []
      // 只取渲染后的 document.xml（跳过整包压缩/解包——260 批累积分配是内存爆表的来源，实测 18.5GB）
      const batchXml = renderDocxtemplater(template, batchData).file('word/document.xml')!.asText()
      const bForm = anchorForm(batchXml, l.begin)
      const eForm = anchorForm(batchXml, l.end)
      if (!bForm || !eForm) throw new Error('批产物锚点定位失败：' + l.begin)
      const raw = batchXml.slice(bForm.idx + bForm.len, eForm.idx)
      // 批间书签 id 会重复：自配对书签整体迁到唯一号段（悬空 end 保持原 id，组装后统一 fix）
      chunks.push(remapBookmarks(raw, 100000 + done * 1000))
      done++
      onProgress?.(done, totalBatches)
      // 批产物即弃。内存兜底（06 哲学：宁可明确报错不可拖垮系统）：
      // docxtemplater 循环展开的内部分配是批输出的 10~20 倍，JSC 在内存充裕的机器上
      // 倾向扩堆不回收（32GB 实测 RSS 可到 12GB，其中绝大部分是可回收垃圾页）。
      // 水位按物理内存比例设线：超 55% 先强 GC，仍超 60% 明确报错——小内存机器（8GB）
      // 的最坏结果是"提示拆分"而不是无声拖垮系统；大内存机器不误伤
      if (process.memoryUsage().rss > totalmem() * 0.55) Bun.gc(true)
      if (process.memoryUsage().rss > totalmem() * 0.6) {
        throw new Error('生成占用的系统内存过高，为保护运行环境已中止。请把大纲按测试类型拆分成几个分册，分别导入后生成')
      }
    }

    finalXml = finalXml.slice(0, beginForm.idx) + chunks.join('') + finalXml.slice(endForm.idx + endForm.len)
  }

  // 3. 写回同一 zip（避免二次解包），统一清理悬空书签结束标记
  skeletonZip.file('word/document.xml', finalXml)
  return fixOrphanBookmarkEnds(skeletonZip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer)
}

function docXmlOf(buf: Buffer): string {
  return new PizZip(buf).file('word/document.xml')!.asText()
}

/**
 * 剥离循环区锚点标记（固定形态精确匹配，幂等）。
 * 整体渲染路径（≤回退阈值）的产物也带锚点（模板手术埋入），交付前必须剥掉；
 * 分批路径组装时已逐一删除，此函数对其是无操作。
 */
export function stripAnchorMarks(buf: Buffer): Buffer {
  const zip = new PizZip(buf)
  const file = zip.files['word/document.xml']
  if (!file) return buf
  const xml = file.asText()
  const anchors = ['_CL_BEGIN_', '_CL_END_', '_CT_BEGIN_', '_CT_END_', '_TR_BEGIN_', '_TR_END_']
  let out = xml
  for (const a of anchors) {
    // 先删行形态（内含段形态文本），再删段形态——顺序颠倒会把行锚点剥成残骸
    out = out.split(rowAnchorXml(a)).join('')
    out = out.split(paraAnchorXml(a)).join('')
  }
  if (out === xml) return buf
  zip.file('word/document.xml', out)
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer
}

/** 锚点在产物中的实际形态（段或行），返回位置与长度 */
function anchorForm(xml: string, name: string): { idx: number; len: number } | null {
  const para = paraAnchorXml(name)
  const row = rowAnchorXml(name)
  const pi = xml.indexOf(para)
  const ri = xml.indexOf(row)
  if (pi === -1 && ri === -1) return null
  if (pi === -1) return { idx: ri, len: row.length }
  if (ri === -1) return { idx: pi, len: para.length }
  return pi < ri ? { idx: pi, len: para.length } : { idx: ri, len: row.length }
}

/**
 * 批内书签重映射：片段内同时有 start 与 end 的 id（自配对）整体迁到 idBase 起的唯一号段，
 * 保持批内配对关系；只有 end 的悬空 id（起标记在骨架区，如 _Toc）保持原 id——
 * 组装后的多余 end 由 fixOrphanBookmarkEnds 统一清理。
 */
function remapBookmarks(fragment: string, idBase: number): string {
  const starts = new Set<string>()
  for (const m of fragment.matchAll(/<w:bookmarkStart\b[^>]*w:id="([^"]+)"/g)) starts.add(m[1])
  if (starts.size === 0) return fragment
  const map = new Map<string, string>()
  let next = idBase
  for (const id of starts) map.set(id, String(next++))
  return fragment
    .replace(/(<w:bookmarkStart\b[^>]*w:id=")([^"]+)(")/g, (whole, pre, id, post) => (map.has(id) ? pre + (map.get(id) as string) + post : whole))
    .replace(/(<w:bookmarkEnd\b[^>]*w:id=")([^"]+)(")/g, (whole, pre, id, post) => (map.has(id) ? pre + (map.get(id) as string) + post : whole))
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
