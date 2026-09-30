import type { CaseRow, GlobalParams, ParseResponse, GenerateResponse } from './types.ts'

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  return (await res.json()) as T
}

export async function parseOutline(file: File): Promise<ParseResponse> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/api/parse', { method: 'POST', body: form })
  return (await res.json()) as ParseResponse
}

export async function saveEdits(outline: { name: string; hash: string }, cases: CaseRow[]): Promise<void> {
  await post('/api/edits', { outline: outline, cases: cases })
}

export async function loadSettings(): Promise<{ params: GlobalParams | null; theme: string }> {
  const res = await fetch('/api/settings')
  return (await res.json()) as { params: GlobalParams | null; theme: string }
}

export async function saveSettings(params: GlobalParams, theme: string): Promise<void> {
  await post('/api/settings', { params: params, theme: theme })
}

export async function generate(outline: { name: string; hash: string }, cases: CaseRow[]): Promise<GenerateResponse> {
  return post<GenerateResponse>('/api/generate', { outline: outline, cases: cases })
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
