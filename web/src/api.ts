import type { CaseRow, GlobalParams, ParseResponse, GenerateResponse, ProjectMeta, GeneratedFile } from './types.ts'

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  return (await res.json()) as T
}

/** DELETE 请求，返回 JSON（失败时服务端一般也返回 JSON，交由调用方判断 ok） */
async function del<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: 'DELETE' })
  return (await res.json()) as T
}

export async function parseOutline(file: File): Promise<ParseResponse> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/api/parse', { method: 'POST', body: form })
  return (await res.json()) as ParseResponse
}

export async function saveEdits(
  outline: { name: string; hash: string },
  cases: CaseRow[],
  progress?: { reviewed: number; suspects: number } | null
): Promise<void> {
  await post('/api/edits', { outline: outline, cases: cases, progress: progress })
}

/** 项目列表（按 updatedAt 降序）；接口异常时返回空列表 */
export async function listProjects(): Promise<ProjectMeta[]> {
  const res = await fetch('/api/projects')
  const data = (await res.json()) as { ok: boolean; projects?: ProjectMeta[] }
  return data.ok && Array.isArray(data.projects) ? data.projects : []
}

/** 打开项目：服务端读源副本重新解析并恢复编辑，返回结构与 /api/parse 一致 */
export async function openProject(id: string): Promise<ParseResponse> {
  return post<ParseResponse>('/api/projects/open', { id: id })
}

/** 删除项目目录，返回是否成功 */
export async function deleteProject(id: string): Promise<boolean> {
  const data = await del<{ ok: boolean }>(`/api/projects/${encodeURIComponent(id)}`)
  return data.ok === true
}

export async function loadSettings(): Promise<{ params: GlobalParams | null; theme: string }> {
  const res = await fetch('/api/settings')
  return (await res.json()) as { params: GlobalParams | null; theme: string }
}

export async function saveSettings(params: GlobalParams, theme: string): Promise<void> {
  await post('/api/settings', { params: params, theme: theme })
}

export async function generate(outline: { name: string; hash: string }, cases: CaseRow[], params: GlobalParams): Promise<GenerateResponse> {
  return post<GenerateResponse>('/api/generate', { outline: outline, cases: cases, params: params })
}

/** 追踪文档生成响应（12-追踪文档工具）：单文档，≤10MB 附 base64 双轨下载 */
export interface TraceGenerateResponse {
  ok: boolean
  error?: string
  name: string
  sizeKB: string
  files?: GeneratedFile[]
  /** ≤10MB 时携带 base64；大文档只有落盘路径 */
  doc?: string
}

export async function traceGenerate(outline: { name: string; hash: string }, cases: CaseRow[], configName: string): Promise<TraceGenerateResponse> {
  return post<TraceGenerateResponse>('/api/trace/generate', { outline: outline, cases: cases, configName: configName })
}

/** base64 → 浏览器下载 */
export function downloadBase64(base64: string, filename: string): void {
  const bytes = Uint8Array.from(atob(base64), ch => ch.charCodeAt(0))
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function base64KB(base64: string): string {
  return ((base64.length * 3) / 4 / 1024).toFixed(1)
}
