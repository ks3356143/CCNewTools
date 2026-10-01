import { extname, join, normalize, resolve } from 'node:path'
import { handleApi } from './api.ts'
import { EMBEDDED_ASSETS } from './assets.ts'
import pkg from '../../package.json' with { type: 'json' }

/** 前端构建产物目录（开发形态回退；单文件编译形态走嵌入资产，见 assets.ts） */
export const DIST_DIR = resolve(import.meta.dir, '../../web/dist')
/** 版本号唯一来源：package.json（08 发版检查单：界面/横幅/接口三处一致） */
export const VERSION = pkg.version as string

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
}

export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url)
  if (url.pathname.startsWith('/api/')) return handleApi(req, url)
  return serveStatic(url)
}

async function serveStatic(url: URL): Promise<Response> {
  let p = decodeURIComponent(url.pathname)
  if (p === '/') p = '/index.html'
  // 单文件编译形态：先查嵌入资产（M6，08 一：全部资源打进二进制）
  const embedded = EMBEDDED_ASSETS[p]
  if (embedded !== undefined) {
    const file = Bun.file(embedded)
    if (await file.exists()) {
      const immutable = p.startsWith('/assets/')
      return new Response(file, {
        headers: {
          'content-type': MIME[extname(p).toLowerCase()] ?? 'application/octet-stream',
          'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache'
        }
      })
    }
  }
  // 开发/磁盘形态回退
  const file = normalize(join(DIST_DIR, p))
  if (!file.startsWith(DIST_DIR)) return new Response('Forbidden', { status: 403 })

  const target = Bun.file(file)
  if (await target.exists()) {
    // 带内容哈希的 assets 可永久缓存；其余（尤其 index.html）必须每次回源，
    // 否则浏览器启发式缓存会让构建升级后用户仍看到旧版页面（2026-10-01 实测踩坑）
    const immutable = p.startsWith('/assets/')
    return new Response(target, {
      headers: {
        'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache'
      }
    })
  }

  // 单页应用兜底 & 未构建提示
  const index = Bun.file(join(DIST_DIR, 'index.html'))
  if (await index.exists()) {
    return new Response(index, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } })
  }
  return new Response(
    '<body style="font-family:sans-serif;padding:40px"><h2>前端尚未构建</h2><p>先运行 <code>bun run build</code>，或开发模式 <code>bun run dev:web</code>。</p></body>',
    { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } }
  )
}
