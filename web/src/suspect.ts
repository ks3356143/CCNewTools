import type { CaseRow } from './types.ts'

/** 可疑判定唯一入口（前后端语义一致，05/09 设计文档约定）：
 *  - 期望为空且有动作文本 → 可疑（含用户编辑时误删期望的情况）；
 *  - 后端其他 suspect 标记（当前仅"期望结果为空"一种）——用户补写期望后自动解除；
 *  - 用户点过"确认无误"（dismissedSuspects）不再标。
 * 独立成模块而非挂在 store：这是纯领域谓词，新可疑规则（如切分语义升级）只改这里，
 * 状态管理（store.ts）与各组件均从这里导入。
 */
export function stepSuspectActive(row: CaseRow, s: CaseRow['steps'][number]): boolean {
  if (row.dismissedSuspects.includes(s.no)) return false
  if (!s.expect.trim()) return s.action.trim() !== ''
  return s.suspect !== undefined && s.suspect !== '' && s.suspect !== '期望结果为空'
}

export function activeSuspects(row: CaseRow): number {
  return row.steps.filter(s => stepSuspectActive(row, s)).length
}
