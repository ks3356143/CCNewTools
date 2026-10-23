import { describe, test, expect } from 'bun:test'
import { handle } from '../src/server/app.ts'

/** 静态资源边界（本地工具也要守住路径穿越；编码斜杠会绕过 startsWith 前缀判断） */

describe('M0 静态资源边界', () => {
  test('编码斜杠路径穿越被拒（不得读到 dist 之外）', async () => {
    const res = await handle(new Request('http://local/assets%2f..%2f..%2fpackage.json'))
    expect(res.status).toBe(403)
    expect(await res.text()).not.toContain('"name"')
  })

  test('畸形百分号编码返回 400 而不是抛错', async () => {
    const res = await handle(new Request('http://local/%E0%A4%A'))
    expect(res.status).toBe(400)
  })

  test('正常首页仍可访问', async () => {
    const res = await handle(new Request('http://local/'))
    expect([200, 404]).toContain(res.status) // 未构建时 404 提示页，构建后 200
  })
})
