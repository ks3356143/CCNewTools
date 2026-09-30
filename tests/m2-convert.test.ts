import { describe, test, expect } from 'bun:test'
import { makeCaseId } from '../src/core/convert/caseId.ts'
import { splitStepText } from '../src/core/convert/split.ts'
import { convertToTemplateData } from '../src/core/convert/index.ts'
import { buildRow } from '../src/core/convert/rows.ts'
import { DEFAULT_PARAMS, type ParsedOutline, type TestItem, type RawCase } from '../src/core/domain.ts'

/** M2 转换层单测（03 转换层各规则） */

function makeOutline(): ParsedOutline {
  const case1: RawCase = {
    itemId: 'XQ_SU_ZLPA_SU01', name: '参数查询正常功能', summary: '查询综述。',
    steps: [
      { no: 1, text: '启动软件，进入参数管理界面。' },
      { no: 2, text: '在查询输入框中输入参数标识，点击查询按钮，查看查询结果是否正确显示；' },
      { no: 3, text: '输入不存在的参数，点击查询按钮。' }
    ]
  }
  const case2: RawCase = {
    itemId: 'XQ_SU_ZLPA_SU02', name: '参数新增正常功能', summary: '新增综述。',
    steps: [{ no: 1, text: '点击新增按钮，输入参数信息，查看新增参数是否显示在列表中；' }]
  }
  const item1: TestItem = {
    name: 'A星指令参数管理', itemId: 'XQ_SU_ZLPA', chapter: '6.2.1.4.1.1',
    typeName: '功能测试', groupName: 'A星模板功能测试', itemName: 'A星指令参数管理',
    description: { shared: null, entries: [] }, cases: [case1, case2], criteriaCases: []
  }
  const item2: TestItem = {
    name: '文档审查', itemId: 'XQ_DC', chapter: '6.2.1.1',
    typeName: '文档审查', groupName: null, itemName: '文档审查',
    description: { shared: '文档审查综述。', entries: [] },
    cases: [{ itemId: 'XQ_DC_DC001', name: '软件文档审查', summary: '', steps: [{ no: 1, text: '审查文档内容是否完整；' }] }],
    criteriaCases: []
  }
  return {
    items: [item1, item2],
    issues: [],
    stats: { items: 2, cases: 3, steps: 4 }
  }
}

describe('M2 用例标识（03 第二节）', () => {
  test('XQ→YL 换前缀，序号每项重新从 001 起', () => {
    expect(makeCaseId('XQ_SU_ZLPA', 1)).toBe('YL_SU_ZLPA_001')
    expect(makeCaseId('XQ_SU_ZLPA', 5)).toBe('YL_SU_ZLPA_005')
    expect(makeCaseId('XQ_DC', 1)).toBe('YL_DC_001')
    expect(makeCaseId('XQ_AC_SCZQ', 1)).toBe('YL_AC_SCZQ_001')
  })

  test('序号超 999 自然扩为 4 位', () => {
    expect(makeCaseId('XQ_A_B', 999)).toBe('YL_A_B_999')
    expect(makeCaseId('XQ_A_B', 1000)).toBe('YL_A_B_1000')
  })

  test('整个大纲的用例标识按项重编号', () => {
    const data = convertToTemplateData(makeOutline(), DEFAULT_PARAMS)
    expect(data.cases.map(c => c.caseId)).toEqual(['YL_SU_ZLPA_001', 'YL_SU_ZLPA_002', 'YL_DC_001'])
  })
})

describe('M2 动作/期望切分（03 第五节）', () => {
  test('真实示例：最后一个预期关键词前的最近标点', () => {
    const sp = splitStepText('在参数列表下方的查询输入框中输入参数标识，点击查询按钮，查看查询结果是否正确显示符合该参数标识的参数信息；')
    expect(sp.action).toBe('在参数列表下方的查询输入框中输入参数标识，点击查询按钮，')
    expect(sp.expect).toBe('查看查询结果是否正确显示符合该参数标识的参数信息；')
    expect(sp.suspect).toBeUndefined()
  })

  test('句中多个关键词时取最后一个', () => {
    const sp = splitStepText('清空查询输入框，点击查询按钮，查看软件是否恢复显示全部参数信息；验证功能正确性。')
    expect(sp.action).toBe('清空查询输入框，点击查询按钮，查看软件是否恢复显示全部参数信息；')
    expect(sp.expect).toBe('验证功能正确性。')
  })

  test('无关键词 → 期望为空可疑；关键词在开头 → 动作为空可疑', () => {
    const a = splitStepText('输入不存在的参数，点击查询按钮。')
    expect(a.expect).toBe('')
    expect(a.suspect).toBe('期望结果为空')

    const b = splitStepText('查看查询结果是否为空。')
    expect(b.action).toBe('')
    expect(b.expect).toBe('查看查询结果是否为空。')
    expect(b.suspect).toBe('输入及操作为空')
  })
})

describe('M2 模板数据组装（03 字段映射）', () => {
  test('标志位只挂各组第一条，默认值与追踪关系正确', () => {
    const data = convertToTemplateData(makeOutline(), { ...DEFAULT_PARAMS, tester: '张三', monitor: '李四' })
    const rows = data.cases

    expect(rows[0].showType).toBe('功能测试')
    expect(rows[0].showGroup).toBe('A星模板功能测试')
    expect(rows[0].showItem).toBe('A星指令参数管理')
    expect(rows[1].showType).toBeNull()
    expect(rows[1].showGroup).toBeNull()
    expect(rows[1].showItem).toBeNull()
    expect(rows[2].showType).toBe('文档审查')
    expect(rows[2].showGroup).toBeNull() // 组为空，不输出该标题
    expect(rows[2].showItem).toBe('文档审查')

    expect(rows[0].init).toBe('外接设备或软件运行正常')
    expect(rows[0].constraint).toBe('软件正常工作，环境连接正常')
    expect(rows[0].designer).toBe('陈俊亦')
    expect(rows[0].tester).toBe('张三')
    expect(rows[2].trace).toBe(
      '软件测试依据：软件测评大纲\n' +
      '测试需求分析：6.2.1.1 文档审查\n' +
      '测试需求标识：XQ_DC_DC001'
    )
    // 记录列
    expect(rows[0].steps[0].actual).toBe('')
    expect(rows[0].steps[0].result).toBe('通过')
  })

  test('可疑判定：无关键词的步骤计为可疑（第 1、3、4 步）', () => {
    const outline = makeOutline()
    outline.items[0].cases[0].steps.push({ no: 4, text: '输入不存在的参数标识。' })
    const data = convertToTemplateData(outline, DEFAULT_PARAMS)
    // 第 1、3 步没有期望关键词，第 4 步也是 → 共 3 步可疑
    expect(data.cases[0].suspectCount).toBe(3)
    expect(data.cases[0].steps[3].expect).toBe('')
    expect(data.cases[0].steps[3].action).toBe('输入不存在的参数标识。')
  })

  test('准则格对应用例 → 期望结果取准则，动作保留完整原文（9.5 实测变种）', () => {
    const outline = makeOutline()
    const item = outline.items[0]
    item.criteriaCases = [
      { itemId: 'XQ_SU_ZLPA_SU01', items: ['准则一；', '准则二；', '准则三；'] }
    ]
    const data = convertToTemplateData(outline, DEFAULT_PARAMS)
    const row = data.cases[0]
    expect(row.expectSource).toBe('通过准则')
    expect(row.steps[0].expect).toBe('准则一；')
    expect(row.steps[1].expect).toBe('准则二；')
    expect(row.steps[2].expect).toBe('准则三；')
    expect(row.steps[0].action).toBe('启动软件，进入参数管理界面。')
  })

  test('准则条数与步骤数不一致 → 回退关键词切分并告警（9.5）', () => {
    const outline = makeOutline()
    outline.items[0].criteriaCases = [
      { itemId: 'XQ_SU_ZLPA_SU01', items: ['总结论。'] }
    ]
    const data = convertToTemplateData(outline, DEFAULT_PARAMS)
    expect(data.cases[0].expectSource).toBe('方法切分')
    expect(data.issues.some(i => i.code === 'CRITERIA_COUNT_MISMATCH')).toBe(true)
  })

  test('方法用例在准则格无对应条目 → 正常回退，不告警', () => {
    const outline = makeOutline()
    outline.items[0].criteriaCases = [
      { itemId: 'XQ_SU_ZLPA_SU01', items: ['准则一；'] }
    ]
    const data = convertToTemplateData(outline, DEFAULT_PARAMS)
    expect(data.cases[0].expectSource).toBe('方法切分')
  })
})

describe('M2 buildRow 直接调用（边界）', () => {
  test('buildRow 不依赖组名', () => {
    const outline = makeOutline()
    const row = buildRow(outline.items[0], outline.items[0].cases[0], DEFAULT_PARAMS)
    expect(row.caseId).toBe('YL_SU_ZLPA_001')
    expect(row.mingcheng).toBe('参数查询正常功能')
  })
})
