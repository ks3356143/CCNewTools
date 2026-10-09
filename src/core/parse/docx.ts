import { unzipSync, strFromU8 } from 'fflate'
import { DOMParser } from '@xmldom/xmldom'

/** OOXML 命名空间（wordprocessingml 主命名空间） */
export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

export interface OfficeFile {
  /** document.xml 整份 DOM（≤20MB 全量路径）；>20MB 走分块时为 null（改从 docXml 逐块取） */
  doc: Document | null
  /** document.xml 原文（仅分块路径携带，避免大文档双份常驻；全量路径为空串） */
  docXml: string
  /** 是否走了分块路径（api 层日志标记） */
  chunked: boolean
  numbering: Document | null
  styles: Document | null
}

function xmlParse(xml: string, what: string): Document {
  try {
    // xmldom 自声明了一套 Document/Element 接口，与 lib.dom 全局类型互不兼容；
    // 在此边界一次性断言到全局 DOM 类型（运行时 xmldom 提供下游用到的全部 API）
    const doc = new DOMParser().parseFromString(xml, 'application/xml') as unknown as Document
    if (!doc.documentElement) throw new Error('empty')
    return doc
  } catch {
    throw new Error(`${what} XML 无法解析，文件可能已损坏`)
  }
}

/**
 * 大小上限（v1.2.0 大文档口径，2026-10-08 内网实测）：.docx 是 zip，截图/流程图占大头
 * 但完全不参与解析，按整个文件限制会误杀带图大纲；真正的解析负担是 document.xml 文本，限它才准。
 * 42MB 正文全量 DOM 实测爆内存 24GB+ → 架构改为分块解析（见下 chunkTopLevel）后放开上限：
 * 100MB ≈ 实测分册2（42.2MB）的 2.4 倍余量。
 */
const MAX_ZIP_MB = 200
const MAX_XML_MB = 100
/** 分块开关阈值：正文 ≤20MB 走整份 DOM（老路径，行为零变化），>20MB 走 ChunkReader 分块 */
const CHUNK_THRESHOLD_BYTES = 20 * 1024 * 1024

function mb(n: number): string {
  return (n / 1024 / 1024).toFixed(1)
}

/**
 * 读取 .docx（zip 包）。只读解析，不修改文件——被 Word 打开占用时依然可读
 * （踩坑记录 2026-09-30：officecli 以可写方式打开被占文件会失败）。
 */
export function readDocx(data: Uint8Array): OfficeFile {
  // 魔数判别（06-错误处理：导入阶段终止性错误）
  if (data.length === 0) {
    throw new Error('文件为空，请确认选择的是大纲原文')
  }
  if (data.length > MAX_ZIP_MB * 1024 * 1024) {
    throw new Error(`文件 ${mb(data.length)}MB 超过 ${MAX_ZIP_MB}MB 上限，请确认是大纲原文`)
  }
  const magic = data.length >= 4 ? [data[0], data[1], data[2], data[3]] : []
  if (magic[0] === 0xd0 && magic[1] === 0xcf && magic[2] === 0x11 && magic[3] === 0xe0) {
    throw new Error('这是旧版 .doc 格式（或已加密的文档），请用 Word 另存为 .docx 后再导入')
  }
  if (!(magic[0] === 0x50 && magic[1] === 0x4b)) {
    throw new Error('不是有效的 .docx 文件（缺少 zip 文件头）')
  }

  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(new Uint8Array(data))
  } catch {
    throw new Error('文件损坏或不是有效的 Word 文档（zip 解析失败）')
  }

  // 加密文档检测（06：zip 内含 EncryptionInfo/EncryptedPackage 即为加密包）
  if (files['EncryptionInfo'] || files['EncryptedPackage']) {
    throw new Error('文档已加密，请解密后重新另存为 .docx 再导入')
  }

  const docBytes = files['word/document.xml']
  if (!docBytes) throw new Error('文件损坏：缺少 word/document.xml，请确认是 Word 文档')
  // 正文超限检查在 XML 解析之前——超大 XML 才是真正的解析负担
  if (docBytes.length > MAX_XML_MB * 1024 * 1024) {
    throw new Error(`文档正文 ${mb(docBytes.length)}MB 超过 ${MAX_XML_MB}MB 上限，大纲规模异常庞大，请拆分后分批导入`)
  }
  const docXml = strFromU8(docBytes)

  const numbering = files['word/numbering.xml']
    ? xmlParse(strFromU8(files['word/numbering.xml']), 'numbering.xml')
    : null

  const styles = files['word/styles.xml']
    ? xmlParse(strFromU8(files['word/styles.xml']), 'styles.xml')
    : null

  // 大文档走 ChunkReader 分块（10-大文档处理 4.2）：跳过整份 DOM（42MB 实测 2~6GB），
  // body 顶层元素逐块 DOM 化即用即弃；≤20MB 仍整份解析，行为零变化
  if (docBytes.length > CHUNK_THRESHOLD_BYTES) {
    return { doc: null, docXml, chunked: true, numbering, styles }
  }
  return { doc: xmlParse(docXml, 'document.xml'), docXml: '', chunked: false, numbering, styles }
}

/* ------------------------------------------------------------------ *
 * ChunkReader 分块解析（10-大文档处理 4.2，v1.2.0）
 *
 * 业务解析只消费 body 顶层元素的顺序结构（段落/表格）；全量 DOM 里 99% 的
 * 节点在消费完一个顶层元素后就是死重（42MB 正文整份 DOM 实测 2~6GB）。
 * 把 document.xml 的 body 内容按顶层子元素切块，逐块 DOM 化、用完即弃——
 * 单块 DOM 峰值 = 一个测试项测试项表格的量级（几 MB）。
 * 业务规则（标题栈/表格判别/软换行）原样生效：它们工作在段落/表格粒度，与块来源无关。
 *
 * 安全性：XML 文本里的 < 和 & 必转义，标签边界扫描不会被正文干扰；
 * 属性值内的 > 合法（XML 允许不转义），用引号状态机跳过。
 * Word 输出的 body 顶层子元素只有 w:p / w:tbl / w:sectPr / 书签等零散标记，
 * 切块器按标签名通用配对，不预设标签种类。
 * ------------------------------------------------------------------ */

/** 从 start（指向 '<'）找到该标签头的 '>' 下标；引号内的 '>' 不算（XML 属性值允许未转义 >） */
function tagEnd(s: string, start: number): number {
  let inQuote = false
  for (let i = start + 1; i < s.length; i++) {
    const c = s[i]
    if (c === '"') inQuote = !inQuote
    else if (c === '>' && !inQuote) return i
  }
  return -1
}

export function localName(el: Element): string {
  if (el.localName) return el.localName
  const tag = el.tagName
  return tag.includes(':') ? tag.slice(tag.indexOf(':') + 1) : tag
}

/** 开标签名（start 指向 '<' 的下一字符），到空白 / '>' / '/' 为止 */
function tagNameAt(s: string, start: number): string {
  let i = start
  while (i < s.length) {
    const c = s[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '>' || c === '/') break
    i++
  }
  return s.slice(start, i)
}

/** 下一个 <name 开标签（边界验证：<w:p 不得误配 <w:pStyle / <w:pgSz 等），返回 '<' 下标或 -1 */
function findOpenTag(s: string, name: string, from: number): number {
  const pat = '<' + name
  let i = s.indexOf(pat, from)
  while (i !== -1) {
    const c = s[i + pat.length]
    if (c === undefined || c === '>' || c === '/' || c === ' ' || c === '\t' || c === '\n' || c === '\r') return i
    i = s.indexOf(pat, i + 1)
  }
  return -1
}

/** 深度配对找 name 的闭标签（容错嵌套表格），返回闭标签结束位置；不配对抛"文件损坏" */
function matchClose(s: string, name: string, from: number): number {
  const closePat = '</' + name + '>'
  let depth = 1
  let j = from
  for (;;) {
    const nextOpen = findOpenTag(s, name, j)
    const nextClose = s.indexOf(closePat, j)
    if (nextClose === -1) {
      throw new Error('文件损坏：XML 标签 <' + name + '> 不配对（文件可能已损坏或不是 Word 生成的大纲）')
    }
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++
      j = nextOpen + 1
    } else {
      depth--
      j = nextClose + closePat.length
      if (depth === 0) return j
    }
  }
}

/**
 * 把 [start, end) 区间（w:body 内容）按顶层子元素切成块，逐块产出（生成器，不积压内存）。
 * 单次线性扫描；文本节点里的 < 必转义，扫描不会被正文干扰。
 */
export function* chunkTopLevel(s: string, start: number, end: number): Generator<string> {
  let i = start
  while (i < end) {
    if (s[i] !== '<') { i++; continue }
    if (s.startsWith('<!--', i)) {
      const ce = s.indexOf('-->', i + 4)
      if (ce === -1) throw new Error('文件损坏：XML 注释未闭合')
      i = ce + 3
      continue
    }
    if (s.startsWith('<![CDATA[', i)) {
      const ce = s.indexOf(']]>', i + 9)
      if (ce === -1) throw new Error('文件损坏：XML CDATA 未闭合')
      i = ce + 3
      continue
    }
    if (s[i + 1] === '?') {
      const gt = tagEnd(s, i)
      if (gt === -1) throw new Error('文件损坏：XML 声明未闭合')
      i = gt + 1
      continue
    }
    const gt = tagEnd(s, i)
    if (gt === -1) throw new Error('文件损坏：XML 标签未闭合（文件可能已损坏）')
    const name = tagNameAt(s, i + 1)
    const selfClose = gt > 0 && s[gt - 1] === '/'
    const stop = selfClose ? gt + 1 : matchClose(s, name, gt + 1)
    yield s.slice(i, stop)
    i = stop
  }
}

/** document.xml 根开标签原文（含 XML 声明与全部 xmlns 声明）——分块 wrapper 复用它，命名空间与整份解析一致 */
function documentOpenTag(s: string): string {
  const open = s.indexOf('<w:document')
  if (open === -1) throw new Error('文件损坏：document.xml 缺少根元素')
  const gt = tagEnd(s, open)
  if (gt === -1) throw new Error('文件损坏：document.xml 结构异常')
  return s.slice(0, gt + 1)
}

function firstElementChild(el: Node): Element | null {
  for (let i = 0; i < el.childNodes.length; i++) {
    const n = el.childNodes.item(i)
    if (n.nodeType === 1) return n as Element
  }
  return null
}

/**
 * body 顶层元素序列（文档顺序）。≤20MB 整份 DOM 逐个 yield（老路径，行为零变化）；
 * >20MB ChunkReader 分块（10-大文档处理 4.2/4.3）——两条路径对消费者完全同构。
 */
export function bodyElements(office: OfficeFile): Generator<Element> {
  return office.chunked ? chunkedBodyElements(office.docXml) : wholeBodyElements(office.doc)
}

function* wholeBodyElements(doc: Document | null): Generator<Element> {
  if (doc === null) throw new Error('内部错误：OfficeFile.doc 缺失（全量路径）')
  const docEl = doc.documentElement
  const body = docEl ? children(docEl, W, 'body')[0] : null
  if (!body) throw new Error('文件损坏：document.xml 中没有 body')
  for (let i = 0; i < body.childNodes.length; i++) {
    const n = body.childNodes.item(i)
    if (n.nodeType === 1) yield n as Element
  }
}

function* chunkedBodyElements(docXml: string): Generator<Element> {
  const open = findOpenTag(docXml, 'w:body', 0)
  if (open === -1) throw new Error('文件损坏：document.xml 中没有 body')
  const gt = tagEnd(docXml, open)
  if (gt === -1) throw new Error('文件损坏：document.xml 中没有 body')
  const end = docXml.lastIndexOf('</w:body>')
  if (end === -1 || end < gt) throw new Error('文件损坏：document.xml 中没有 body')
  const docOpen = documentOpenTag(docXml)
  const parser = new DOMParser()
  for (const chunk of chunkTopLevel(docXml, gt + 1, end)) {
    let doc: Document | null = null
    try {
      // wrapper 复用根开标签（全部 xmlns 声明），块内前缀/命名空间与整份解析完全一致
      const d = parser.parseFromString(docOpen + chunk + '</w:document>', 'application/xml') as unknown as Document
      if (d.documentElement) doc = d
    } catch {
      doc = null
    }
    if (doc === null) throw new Error('文件损坏：document.xml 分块解析失败（文件可能已损坏）')
    const el = firstElementChild(doc.documentElement)
    if (el === null) throw new Error('文件损坏：document.xml 分块解析异常')
    yield el
  }
}

/** 直接子元素中按命名空间+名称筛选 */
export function children(parent: Node, ns: string, name: string): Element[] {
  const out: Element[] = []
  for (let i = 0; i < parent.childNodes.length; i++) {
    const n = parent.childNodes.item(i)
    if (n.nodeType === 1 && localName(n as Element) === name && (n as Element).namespaceURI === ns) {
      out.push(n as Element)
    }
  }
  return out
}

/** 后代元素中按命名空间+名称筛选 */
export function deep(parent: Node, ns: string, name: string): Element[] {
  const out: Element[] = []
  const list = (parent as Element).getElementsByTagNameNS(ns, name)
  for (let i = 0; i < list.length; i++) out.push(list.item(i)!)
  return out
}

/** 首个后代元素 */
export function firstDeep(parent: Node, ns: string, name: string): Element | null {
  const list = deep(parent, ns, name)
  return list.length ? list[0] : null
}

/** OOXML 属性取名（w:val 等在 DOM 里可能带前缀也可能带命名空间，两种都试） */
export function attr(el: Element, name: string, ns: string = W): string | null {
  const v = el.getAttributeNS(ns, name)
  if (v != null) return v
  return el.getAttribute(`w:${name}`) ?? el.getAttribute(name)
}

/**
 * 段落全部文本（w:t 串联）。Shift+Enter 软换行（w:br / w:cr）输出 \n——
 * 2026-10-08 内网新变种实测：此前 br 被静默丢弃，单元格内以 br 分隔的
 * 用例标题行/步骤行全部粘连，切分整段失准（一个步骤粘下一千多字符）。
 * w:tab 维持既有行为（丢弃），消费方按需展开（见 cases.ts expandSoftBreaks）。
 */
export function textOf(p: Node): string {
  let out = ''
  const walk = (node: Node): void => {
    for (let i = 0; i < node.childNodes.length; i++) {
      const n = node.childNodes.item(i)
      if (n.nodeType !== 1) continue
      const el = n as Element
      if (el.namespaceURI !== W) continue
      const name = localName(el)
      if (name === 't') out += el.textContent ?? ''
      else if (name === 'br' || name === 'cr') out += '\n'
      else walk(el)
    }
  }
  walk(p)
  return out
}

export interface ParaInfo {
  text: string
  /** 自动编号列表的 numId；普通段落为 null */
  numId: string | null
  ilvl: number
}

/** 段落的 numPr 信息 */
export function numPrOf(p: Element): { numId: string; ilvl: number } | null {
  const pPr = firstDeep(p, W, 'pPr')
  if (!pPr) return null
  const numPr = children(pPr, W, 'numPr')[0]
  if (!numPr) return null
  const numIdEl = children(numPr, W, 'numId')[0]
  const ilvlEl = children(numPr, W, 'ilvl')[0]
  const numId = numIdEl ? attr(numIdEl, 'val') : null
  if (!numId) return null
  const ilvl = ilvlEl ? Number(attr(ilvlEl, 'val') ?? '0') : 0
  return { numId, ilvl: Number.isFinite(ilvl) ? ilvl : 0 }
}

export function pStyleId(p: Element): string | null {
  const pPr = firstDeep(p, W, 'pPr')
  if (!pPr) return null
  const st = children(pPr, W, 'pStyle')[0]
  return st ? attr(st, 'val') : null
}

/** 段落自身的 outlineLvl（0 基） */
export function outlineLvlOf(p: Element): number | null {
  const pPr = firstDeep(p, W, 'pPr')
  if (!pPr) return null
  const ol = children(pPr, W, 'outlineLvl')[0]
  if (!ol) return null
  const v = Number(attr(ol, 'val') ?? 'NaN')
  return Number.isFinite(v) ? v : null
}
