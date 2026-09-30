/** 用例标识生成（03 第二节）：测试项标识去掉 XQ 换成 YL + _3 位序号，每测试项内重新从 001 起 */

export function makeCaseId(itemItemId: string, index: number): string {
  const base = itemItemId.replace(/^XQ/, 'YL')
  // index ≥ 1000 时自然扩为 4 位（06 第三节：几乎不可能发生）
  const seq = String(index).padStart(3, '0')
  return base + '_' + seq
}
