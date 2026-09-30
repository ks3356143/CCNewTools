import { extname, join, normalize, resolve } from 'node:path'

/** 前端构建产物目录 */
export const DIST_DIR = resolve(import.meta.dir, '../../web/dist')
export const VERSION = '0.1.0'

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
  if (url.pathname.startsWith('/api/')) return api(req, url)
  return serveStatic(url)
}

function api(req: Request, url: URL): Response {
  if (url.pathname === '/api/ping') {
    return Response.json({ ok: true, version: VERSION, ts: Date.now() })
  }
  return Response.json({ ok: false, error: `未知接口 ${url.pathname}` }, { status: 404 })
}

async function serveStatic(url: URL): Promise<Response> {
  let p = decodeURIComponent(url.pathname)
  if (p === '/') p = '/index.html'
  const file = normalize(join(DIST_DIR, p))
  if (!file.startsWith(DIST_DIR)) return new Response('Forbidden', { status: 403 })

  const target = Bun.file(file)
  if (await target.exists()) {
    return new Response(target, {
      headers: { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' }
    })
  }

  // 单页应用兜底 & 未构建提示
  const index = Bun.file(join(DIST_DIR, 'index.html'))
  if (await index.exists()) {
    return new Response(index, { headers: { 'content-type': 'text/html; charset=utf-8' } })
  }
  return new Response(
    '<body style="font-family:sans-serif;padding:40px"><h2>前端尚未构建</h2><p>先运行 <code>bun run build</code>，或开发模式 <code>bun run dev:web</code>。</p></body>',
    { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } }
  )
}
