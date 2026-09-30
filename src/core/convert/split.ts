/** 步骤文本 → 动作/期望（03 第五节：最后一个预期关键词前的最近标点切分） */

import { expectVerbOk } from '../parse/cases.ts'

const KEYWORDS = ['查看', '验证', '确认', '检查', '观测', '判定', '确保', '保证']
const DELIMS = '，,；;。'

export interface SplitResult {
  action: string
  expect: string
  suspect: string | undefined
}

export function splitStepText(text: string): SplitResult {
  let kw = -1
  for (const k of KEYWORDS) {
    const i = text.lastIndexOf(k)
    if (i > kw) kw = i
  }
  if (kw < 0) return { action: text, expect: '', suspect: '期望结果为空' }

  let delim = -1
  for (let i = kw - 1; i >= 0; i--) {
    if (DELIMS.includes(text[i])) {
      delim = i
      break
    }
  }
  if (delim < 0) return { action: '', expect: text, suspect: '输入及操作为空' }

  const action = text.slice(0, delim + 1)
  const expect = text.slice(delim + 1)
  const ok = expectVerbOk(expect)
  const suspect = ok ? undefined : '期望结果未以固定动词开头'
  return { action: action, expect: expect, suspect: suspect }
}
