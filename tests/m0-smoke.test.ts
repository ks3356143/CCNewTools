import { describe, test, expect } from 'bun:test'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import { DOMParser } from '@xmldom/xmldom'
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate'
import { handle } from '../src/server/app.ts'

/** M0 冒烟：核心依赖在 Bun 下可用（实施计划 0.4） */

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

const DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:r><w:t>标题：{title}</w:t></w:r></w:p>
<w:p><w:r><w:t>{#cases}</w:t></w:r></w:p>
<w:p><w:r><w:t>{no} - {name}</w:t></w:r></w:p>
<w:p><w:r><w:t>{/cases}</w:t></w:r></w:p>
</w:body>
</w:document>`

function minimalDocx(): Buffer {
  const zip = new PizZip()
  zip.file('[Content_Types].xml', CONTENT_TYPES)
  zip.file('_rels/.rels', RELS)
  zip.file('word/document.xml', DOCUMENT)
  return zip.generate({ type: 'nodebuffer' })
}

describe('M0 冒烟', () => {
  test('fflate 解压/压缩往返', () => {
    const raw = strToU8('中文内容 hello')
    const packed = zipSync({ 'a.txt': raw })
    const out = unzipSync(packed)
    expect(strFromU8(out['a.txt'])).toBe('中文内容 hello')
  })

  test('@xmldom/xmldom 解析 OOXML', () => {
    const doc = new DOMParser().parseFromString(DOCUMENT, 'application/xml')
    const paras = doc.getElementsByTagNameNS(
      'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'p'
    )
    expect(paras.length).toBe(4)
  })

  test('docxtemplater 渲染最小 docx（含行循环）', () => {
    const zip = new PizZip(minimalDocx())
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true })
    doc.render({
      title: 'M0 冒烟',
      cases: [
        { no: 1, name: '参数查询正常功能' },
        { no: 2, name: '参数新增正常功能' }
      ]
    })
    const out = doc.getZip().file('word/document.xml')!.asText()
    expect(out).toContain('标题：M0 冒烟')
    expect(out).toContain('1 - 参数查询正常功能')
    expect(out).toContain('2 - 参数新增正常功能')
    expect(out).not.toContain('{#cases}')
  })

  test('服务层 /api/ping', async () => {
    const server = Bun.serve({ port: 0, fetch: handle })
    try {
      const res = await fetch(new URL('/api/ping', server.url))
      const data = await res.json()
      expect(data.ok).toBe(true)
      expect(data.version).toBe('1.0.0')
    } finally {
      server.stop(true)
    }
  })
})
