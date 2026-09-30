import { describe, test, expect, beforeAll } from 'bun:test'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildDocxBuffer, itemTable, DESC, METHOD } from './helpers/ooxml.ts'
import { handle } from '../src/server/app.ts'

/** M4 服务层集成测试：parse → edits → 恢复 → generate（数据目录指向临时目录） */

beforeAll(() => {
  process.env.CC_DATA_DIR = mkdtempSync(join(tmpdir(), 'cc-m4-'))
})

function start(): string {
  const server = Bun.serve({ port: 0, fetch: handle })
  return server.url.toString().replace(/\/$/, '')
}

const URL0 = start()

function sampleDocx(): Buffer {
  return buildDocxBuffer({
    content: [
      { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
      { kind: 'p', para: { text: '功能测试', heading: 4, numId: 1, ilvl: 3 } },
      {
        kind: 'tbl',
        rows: itemTable('某测试项', 'XQ_A_B', [
          [DESC, '1.用例一（XQ_A_B001）\n用例一综述。\n2.用例二（XQ_A_B002）\n用例二综述。'],
          [METHOD, '1.用例一（XQ_A_B001）\n1）打开界面，查看显示是否正确；\n2.用例二（XQ_A_B002）\n1）执行操作，查看结果是否正确；']
        ])
      }
    ]
  })
}

async function parse(name: string, buf: Buffer): Promise<any> {
  const form = new FormData()
  form.append('file', new File([new Uint8Array(buf)], name))
  const res = await fetch(URL0 + '/api/parse', { method: 'POST', body: form })
  return res.json()
}

describe('M4 /api/parse', () => {
  test('解析合成大纲：统计、问题清单、用例数据、默认参数', async () => {
    const data = await parse('测试大纲A.docx', sampleDocx())
    expect(data.ok).toBe(true)
    expect(data.outline.name).toBe('测试大纲A.docx')
    expect(data.outline.hash).toMatch(/^[0-9a-f]{40}$/)
    expect(data.stats).toEqual({ items: 1, cases: 2, steps: 2 })
    expect(data.cases.map((c: any) => c.caseId)).toEqual(['YL_A_B_001', 'YL_A_B_002'])
    expect(data.cases[0].summary).toBe('用例一综述。')
    expect(data.params.designer).toBe('陈俊亦')
    expect(data.theme).toBe('light')
  })

  test('非 docx 上传 → 400 带原因（06 导入错误）', async () => {
    const form = new FormData()
    form.append('file', new File([new Uint8Array([1, 2, 3, 4])], 'x.docx'))
    const res = await fetch(URL0 + '/api/parse', { method: 'POST', body: form })
    const data = await res.json()
    expect(res.status).toBe(400)
    expect(data.ok).toBe(false)
    expect(data.error).toContain('docx')
  })
})

describe('M4 编辑持久化（05）', () => {
  test('保存编辑 → 重新解析自动恢复（改过的步骤文本、已核对、排除）', async () => {
    const first = await parse('测试大纲A.docx', sampleDocx())
    const cases = first.cases
    cases[0].steps[0].action = '手工改过的操作步骤。'
    cases[0].steps[0].expect = '手工改过的期望。'
    cases[0].reviewed = true
    cases[1].excluded = true
    const saveRes = await fetch(URL0 + '/api/edits', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outline: first.outline, cases: cases })
    })
    expect((await saveRes.json()).ok).toBe(true)

    const second = await parse('测试大纲A.docx', sampleDocx())
    expect(second.restored.cases).toBeGreaterThanOrEqual(1)
    expect(second.cases[0].steps[0].action).toBe('手工改过的操作步骤。')
    expect(second.cases[0].steps[0].expect).toBe('手工改过的期望。')
    expect(second.cases[0].reviewed).toBe(true)
    expect(second.cases[1].excluded).toBe(true)
  })

  test('另一份大纲的编辑记录互不影响（05 影响域隔离）', async () => {
    const data = await parse('测试大纲B.docx', sampleDocx())
    expect(data.cases[0].steps[0].action).not.toBe('手工改过的操作步骤。')
    expect(data.restored.cases).toBe(0)
  })

  test('损坏的编辑记录 JSON → 按无记录处理，解析不受影响（06）', async () => {
    const { createHash } = await import('node:crypto')
    const hash = createHash('sha1').update(new Uint8Array(sampleDocx())).digest('hex')
    const dir = process.env.CC_DATA_DIR!
    const fs = await import('node:fs')
    writeFileSync(join(dir, '编辑记录', `测试大纲A_${hash.slice(0, 8)}.json`), '{损坏的JSON')
    const data = await parse('测试大纲A.docx', sampleDocx())
    expect(data.ok).toBe(true)
    expect(data.cases.length).toBe(2)
    void fs
  })
})

describe('M4 /api/generate', () => {
  test('生成两份 docx（base64），排除的用例不生成', async () => {
    const first = await parse('测试大纲A.docx', sampleDocx())
    const cases = first.cases.map((c: any) => ({ ...c, excluded: c.caseId === 'YL_A_B_002' }))
    const res = await fetch(URL0 + '/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outline: first.outline, cases: cases })
    })
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.specName).toBe('测试说明_测试大纲A.docx')

    const spec = Buffer.from(data.spec, 'base64')
    expect(spec.subarray(0, 2).toString()).toBe('PK')
    // 只含用例一：写入 zip 临时文件后文本检查
    const tmpZip = join(process.env.CC_DATA_DIR!, 'gen-spec.docx')
    writeFileSync(tmpZip, spec)
    const xml = new (require('pizzip').default)(readFileSync(tmpZip)).file('word/document.xml').asText()
    expect(xml).toContain('YL_A_B_001')
    expect(xml).not.toContain('YL_A_B_002')
  })
})
