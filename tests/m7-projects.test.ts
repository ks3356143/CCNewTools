import { describe, test, expect, beforeAll } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { EDIT_STATE_VERSION } from '../src/core/persistence.ts'
import { buildDocxBuffer, itemTable, DESC, METHOD } from './helpers/ooxml.ts'
import { handle } from '../src/server/app.ts'
import { setDataRootForTests } from '../src/server/store.ts'
import { migrateLegacyEdits } from '../src/server/projects.ts'

/** M7 项目制本地数据管理（09）：建档、进度上报、打开、删除、无副本提示、旧数据迁移 */

let DATA = ''

beforeAll(() => {
  DATA = mkdtempSync(join(tmpdir(), 'cc-m7-'))
  process.env.CC_DATA_DIR = DATA
  // bun test 单进程跑多个测试文件，dataRoot 可能已被别的文件缓存，必须显式重定向
  setDataRootForTests(DATA)
})

function start(): string {
  const server = Bun.serve({ port: 0, fetch: handle })
  return server.url.toString().replace(/\/$/, '')
}

const URL0 = start()

let sample: Buffer | null = null

/** 合成大纲（缓存同一份字节，保证多次上传哈希一致、可比较源副本） */
function sampleDocx(): Buffer {
  if (sample === null) {
    sample = buildDocxBuffer({
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
  return sample
}

async function parse(name: string, buf: Buffer): Promise<any> {
  const form = new FormData()
  form.append('file', new File([new Uint8Array(buf)], name))
  const res = await fetch(URL0 + '/api/parse', { method: 'POST', body: form })
  return res.json()
}

async function openProject(id: string): Promise<any> {
  const res = await fetch(URL0 + '/api/projects/open', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: id })
  })
  return res.json()
}

async function listProjects(): Promise<any[]> {
  const res = await fetch(URL0 + '/api/projects')
  const data = await res.json()
  expect(data.ok).toBe(true)
  return data.projects
}

/** 手工伪造项目文件（无副本项目 / 迁移场景用） */
function writeProjectFile(id: string, meta: Record<string, unknown>, edits: unknown): void {
  const dir = join(DATA, '项目', id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, '项目.json'), JSON.stringify({ meta: meta, edits: edits }), 'utf8')
}

let first: any = null

function pid(): string {
  return first.outline.hash.slice(0, 12)
}

describe('M7 上传建档（09）', () => {
  test('/api/parse 后自动建档：列表 1 个项目、源副本落盘', async () => {
    expect(await listProjects()).toHaveLength(0)
    first = await parse('测试大纲A.docx', sampleDocx())
    expect(first.ok).toBe(true)

    const projects = await listProjects()
    expect(projects).toHaveLength(1)
    const p = projects[0]
    expect(p.id).toBe(pid())
    expect(p.hasSource).toBe(true)
    expect(p.stats).toEqual({ items: 1, cases: 2, steps: 2 })

    // 源副本存在且字节与上传一致
    const src = join(DATA, '项目', pid(), '大纲.docx')
    expect(existsSync(src)).toBe(true)
    expect(new Uint8Array(readFileSync(src))).toEqual(new Uint8Array(sampleDocx()))
  })
})

describe('M7 编辑保存与进度上报（09）', () => {
  test('/api/edits 带 progress → 列表可见；再解析恢复编辑', async () => {
    const cases = first.cases
    cases[0].steps[0].action = 'M7 改过的操作步骤。'
    cases[0].steps[0].expect = 'M7 改过的期望结果。'
    cases[0].reviewed = true
    const saveRes = await fetch(URL0 + '/api/edits', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outline: first.outline, cases: cases, progress: { reviewed: 1, suspects: 0 } })
    })
    expect((await saveRes.json()).ok).toBe(true)

    const p = (await listProjects()).find((x: any) => x.id === pid())
    expect(p.progress).toEqual({ reviewed: 1, suspects: 0 })

    const second = await parse('测试大纲A.docx', sampleDocx())
    expect(second.restored.cases).toBeGreaterThanOrEqual(1)
    expect(second.cases[0].steps[0].action).toBe('M7 改过的操作步骤。')
    expect(second.cases[0].steps[0].expect).toBe('M7 改过的期望结果。')
  })
})

describe('M7 打开项目（09）', () => {
  test('POST /api/projects/open：重解析并套回编辑，返回结构与 parse 一致', async () => {
    const data = await openProject(pid())
    expect(data.ok).toBe(true)
    expect(data.outline.name).toBe(first.outline.name)
    expect(data.outline.hash).toBe(first.outline.hash)
    expect(data.cases.map((c: any) => c.caseId)).toEqual(first.cases.map((c: any) => c.caseId))
    expect(data.restored.cases).toBeGreaterThanOrEqual(1)
    expect(data.cases[0].steps[0].action).toBe('M7 改过的操作步骤。')
  })
})

describe('M7 内容寻址归并（09）', () => {
  test('同内容换名上传：不新建项目，编辑随内容共享，name 刷成最近上传名', async () => {
    const before = await listProjects()
    const renamed = await parse('测试大纲A-改名.docx', sampleDocx())
    expect(renamed.ok).toBe(true)
    expect(renamed.restored.cases).toBeGreaterThanOrEqual(1)
    const after = await listProjects()
    expect(after).toHaveLength(before.length)
    const p = after.find((x: any) => x.id === pid())
    expect(p.name).toBe('测试大纲A-改名.docx')
  })
})

describe('M7 删除项目（09）', () => {
  test('DELETE：列表变空、再打开报错、非法 id 拒绝且不影响别的目录', async () => {
    const delRes = await fetch(URL0 + '/api/projects/' + pid(), { method: 'DELETE' })
    expect((await delRes.json()).ok).toBe(true)
    expect(await listProjects()).toHaveLength(0)

    const data = await openProject(pid())
    expect(data.ok).toBe(false)

    // 守卫项目：非法 id 删除不得误伤别的目录
    const guard = '000000000000'
    writeProjectFile(guard, {
      id: guard, name: '守卫.docx', hash: '0'.repeat(40),
      addedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      hasSource: true, stats: null, progress: null
    }, null)
    for (const bad of ['zzz', encodeURIComponent('../../etc')]) {
      const res = await fetch(URL0 + '/api/projects/' + bad, { method: 'DELETE' })
      expect([404, 400]).toContain(res.status)
    }
    expect(existsSync(join(DATA, '项目', guard))).toBe(true)
  })
})

describe('M7 无副本项目（09）', () => {
  test('没有源文件副本 → open 返回 needsSource:true', async () => {
    const hash = createHash('sha1').update('m7-无副本').digest('hex')
    const id = hash.slice(0, 12)
    writeProjectFile(id, {
      id: id, name: '无副本大纲.docx', hash: hash,
      addedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      hasSource: false, stats: null, progress: null
    }, null)

    const data = await openProject(id)
    expect(data.ok).toBe(false)
    expect(data.needsSource).toBe(true)
    expect(data.name).toBe('无副本大纲.docx')
    expect(data.error).toContain('没有源文件副本')
  })
})

describe('M7 旧数据迁移（09）', () => {
  test('编辑记录/*.json → 建档（无副本、编辑保留）、旧文件删除', async () => {
    const outline = { name: '旧版大纲.docx', hash: createHash('sha1').update('m7-legacy').digest('hex') }
    // 版本闸：非当前版本的旧存档按设计作废留存（不迁移不删除），这里用当前版本验证迁移路径
    const state = { version: EDIT_STATE_VERSION, outline: outline, savedAt: '2025-12-31T00:00:00.000Z', cases: [] }
    const legacyDir = join(DATA, '编辑记录')
    mkdirSync(legacyDir, { recursive: true })
    const legacyFile = join(legacyDir, '旧版大纲_abcdef12.json')
    writeFileSync(legacyFile, JSON.stringify(state), 'utf8')

    migrateLegacyEdits()

    const p = (await listProjects()).find((x: any) => x.id === outline.hash.slice(0, 12))
    expect(p).toBeDefined()
    expect(p.hasSource).toBe(false)
    expect(p.name).toBe('旧版大纲.docx')

    // 编辑保留进项目文件
    const f = JSON.parse(readFileSync(join(DATA, '项目', outline.hash.slice(0, 12), '项目.json'), 'utf8'))
    expect(f.edits).not.toBeNull()
    expect(f.edits.version).toBe(EDIT_STATE_VERSION)
    expect(f.edits.outline.name).toBe('旧版大纲.docx')

    // 旧文件已删除
    expect(existsSync(legacyFile)).toBe(false)
  })
})
