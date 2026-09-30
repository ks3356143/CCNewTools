/** 步骤文本 → 动作/期望（03 第五节，2026-09-30 用户确认的新写法）：
 *  - 动作 = 完整步骤文本（去结尾标点——用户要求步骤不以标点结尾）；
 *  - 期望 = 最后一个预期关键词之后的内容（剥"是否"前缀、去结尾标点）；
 *  - 期望允许与动作部分重复（"输入及操作文字多一点，期望重复点"）。
 */

const KEYWORDS = ['查看', '验证', '确认', '检查', '观测', '判定', '确保', '保证']

export interface SplitResult {
  action: string
  expect: string
  suspect: string | undefined
}

/** 去掉结尾的句读（用户要求：步骤文本不以标点结尾） */
export function stripTrailingPunct(text: string): string {
  return text.replace(/[；;。，,、\s]+$/, '').trim()
}

/** 文本中是否含有预期关键词（无关键词的"纯操作步"由 buildRow 并进下一个验证步） */
export function hasExpectKeyword(text: string): boolean {
  for (const k of KEYWORDS) {
    if (text.includes(k)) return true
  }
  return false
}

export function splitStepText(text: string): SplitResult {
  const clean = stripTrailingPunct(text)

  let kw = -1
  let kwLen = 0
  for (const k of KEYWORDS) {
    const i = clean.lastIndexOf(k)
    if (i > kw) {
      kw = i
      kwLen = k.length
    }
  }
  if (kw < 0) {
    return { action: clean, expect: '', suspect: '期望结果为空' }
  }

  let expect = clean.slice(kw + kwLen).trim()
  if (expect.startsWith('是否')) expect = expect.slice(2)
  expect = stripTrailingPunct(expect)

  if (expect === '') {
    return { action: clean, expect: '', suspect: '期望结果为空' }
  }
  return { action: clean, expect: expect, suspect: undefined }
}
