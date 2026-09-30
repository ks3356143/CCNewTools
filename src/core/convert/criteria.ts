import type { TestItem } from '../domain.ts'
import { makeCaseId } from './caseId.ts'
import { splitStepText } from './split.ts'

/**
 * 通过准则格是否可用作期望结果来源（9.5）：
 * 有内容，且条数与步骤数相同；条数不同时需全部带 n） 编号且编号能与步骤一一对齐。
 */
export function criteriaFor(item: TestItem, stepCount: number): string[] | null {
  const crits: string[] = []
  for (const c of item.criteria) {
    const t = c.text.trim()
    if (t !== '') crits.push(t)
  }
  if (crits.length === 0) return null

  if (crits.length === stepCount) {
    return crits.map(c => c.replace(/^\d{1,3}\s*[）)]\s*/, ''))
  }

  const allNumbered = crits.every(c => /^\d{1,3}\s*[）)]/.test(c))
  if (!allNumbered) return null

  const map = new Map<number, string>()
  for (const c of crits) {
    const m = /^(\d{1,3})\s*[）)]\s*/.exec(c)
    if (m === null) return null
    map.set(Number(m[1]), c.replace(/^\d{1,3}\s*[）)]\s*/, ''))
  }
  const out: string[] = []
  for (let i = 1; i <= stepCount; i++) {
    const v = map.get(i)
    if (v === undefined) return null
    out.push(v)
  }
  return out
}
