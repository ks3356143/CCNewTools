import { describe, test, expect } from 'bun:test'
import { applyVmerge, headRowsOf, caseIdWithStepRange, traceColumnCount } from '../src/core/trace/table.ts'
import type { TraceHeadGroup, TraceRowVM } from '../src/core/trace/table.ts'

/** 追踪表模型单元测试（M8 补充：vmerge 键规则 / 双层表头 / 步骤范围标识） */

const row = (cells: string[]): TraceRowVM => ({ cells, span: cells.map(() => 1) })

describe('M8 trace/table 模型', () => {
  test('traceColumnCount 为各组子列之和', () => {
    const heads: TraceHeadGroup[] = [
      { group: '序号', cols: ['序号'] },
      { group: '软件测试大纲', cols: ['章节号', '名称', '标识'] }
    ]
    expect(traceColumnCount(heads)).toBe(4)
  })

  test('headRowsOf：独立列两行合并，分组列拆第二行', () => {
    const [top, sub] = headRowsOf([
      { group: '', cols: ['序号'] },
      { group: '软件测试大纲', cols: ['章节号', '名称'] }
    ])
    expect(top).toEqual([
      { text: '序号', colspan: 1, rowspan: 2 },
      { text: '软件测试大纲', colspan: 2, rowspan: 1 }
    ])
    expect(sub).toEqual([
      { text: '章节号', colspan: 1, rowspan: 1 },
      { text: '名称', colspan: 1, rowspan: 1 }
    ])
  })

  test('caseIdWithStepRange：0 步不加后缀，1 步 -001，多步范围', () => {
    expect(caseIdWithStepRange('YL_X_001', 0)).toBe('YL_X_001')
    expect(caseIdWithStepRange('YL_X_001', 1)).toBe('YL_X_001-001')
    expect(caseIdWithStepRange('YL_X_001', 5)).toBe('YL_X_001-001~005')
    expect(caseIdWithStepRange('YL_X_001', 12)).toBe('YL_X_001-001~012')
  })

  test('applyVmerge：连续相同键整块合并，其余列不动', () => {
    const rows = [
      row(['1', 'A', 'x', 'keep']),
      row(['2', 'A', 'x', 'keep2']),
      row(['3', 'B', 'y', 'keep3'])
    ]
    applyVmerge(rows, [1, 2])
    expect(rows[0].span).toEqual([1, 2, 2, 1])
    expect(rows[1].span).toEqual([1, 0, 0, 1])
    expect(rows[2].span).toEqual([1, 1, 1, 1])
  })

  test('applyVmerge：合并列空值不参与键（说明作源 SRS 全空仍可合并）', () => {
    const rows = [
      row(['1', '', '大纲A', 'XQ_A']),
      row(['2', '', '大纲A', 'XQ_A']),
      row(['3', '4.1', '大纲A', 'XQ_A'])
    ]
    applyVmerge(rows, [1, 2, 3])
    // 前两行键相同（空列被过滤）→ 合并；第三行多出 4.1 → 新键
    expect(rows[0].span).toEqual([1, 2, 2, 2])
    expect(rows[2].span).toEqual([1, 1, 1, 1])
  })

  test('applyVmerge：合并列全空的行不参与合并', () => {
    const rows = [row(['1', '', '']), row(['2', '', ''])]
    applyVmerge(rows, [1, 2])
    expect(rows[0].span).toEqual([1, 1, 1])
    expect(rows[1].span).toEqual([1, 1, 1])
  })

  test('applyVmerge：空列清单直接返回，单行不合并', () => {
    const rows = [row(['1', 'A']), row(['2', 'A'])]
    applyVmerge(rows, [])
    expect(rows[0].span).toEqual([1, 1])
    const single = [row(['1', 'A'])]
    applyVmerge(single, [1])
    expect(single[0].span).toEqual([1, 1])
  })

  test('applyVmerge：被其他列打断的相同键不跨块合并', () => {
    const rows = [
      row(['1', 'A']),
      row(['2', 'B']),
      row(['3', 'A'])
    ]
    applyVmerge(rows, [1])
    expect(rows.map(r => r.span[1])).toEqual([1, 1, 1])
  })
})
