import { describe, test, expect } from 'bun:test'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import { DOMParser } from '@xmldom/xmldom'
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate'
import { handle } from '../src/server/app.ts'
import { VERSION } from '../src/server/app.ts'
import { exeDirNotice } from '../src/server/store.ts'

/** M0 冒烟：核心依赖在 Bun 下可用（实施计划 0.4） */

const PKG_VERSION = VERSION // 与 app.ts 同源（根 package.json），发版无需改此断言

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
      expect(data.version).toBe(PKG_VERSION)
    } finally {
      server.stop(true)
    }
  })

  describe('exe 运行位置风险提示（v1.1.3，内网复查）', () => {
    test('临时目录内（压缩包直运行的典型形态）→ 警示', () => {
      const msg = exeDirNotice(
        'C:\\Users\\a\\AppData\\Local\\Temp\\Rar$EX0.123',
        'C:\\Users\\a\\AppData\\Local\\Temp'
      )
      expect(msg).toContain('临时目录')
      expect(msg).toContain('解压')
    })
    test('大小写与分隔符不敏感；恰好等于临时目录也警示', () => {
      expect(exeDirNotice('C:\\Users\\A\\AppData\\Local\\Temp\\', 'c:/users/a/appdata/local/temp')).toContain('临时目录')
    })
    test('网络共享 UNC 路径 → 提示多人共用风险', () => {
      expect(exeDirNotice('\\\\FileSrv\\共享\\工具')).toContain('网络共享')
    })
    test('普通目录 → 无提示（含名称前缀相似的目录不误报）', () => {
      expect(exeDirNotice('E:\\测评工具')).toBeNull()
      expect(exeDirNotice('D:\\')).toBeNull()
      expect(exeDirNotice('C:\\Users\\a\\AppData\\Local\\temporary-x', 'C:\\Users\\a\\AppData\\Local\\temp')).toBeNull()
    })
  })
})
