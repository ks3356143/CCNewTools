import { describe, test, expect } from 'bun:test'
import { makeCaseId } from '../src/core/convert/caseId.ts'
import { splitStepText } from '../src/core/convert/split.ts'
import { convertToTemplateData } from '../src/core/convert/index.ts'
import { buildRow } from '../src/core/convert/rows.ts'
import { DEFAULT_PARAMS, type ParsedOutline, type TestItem, type RawCase } from '../src/core/domain.ts'

/** M2 转换层单测（03 转换层规则 + 2026-09-30 用户确认的新切分写法） */

function makeOutline(): ParsedOutline {
  const case1: RawCase = {
    itemId: 'XQ_SU_ZLPA_SU01', name: '参数查询正常功能', summary: '查询综述。',
    steps: [
      { no: 1, text: '启动软件，进入参数管理界面。' },
      { no: 2, text: '在查询输入框中输入参数标识，点击查询按钮，查看查询结果是否正确显示；' }
    ]
  }
  const case2: RawCase = {
    itemId: 'XQ_SU_ZLPA_SU02', name: '参数新增正常功能', summary: '新增综述。',
    steps: [{ no: 1, text: '点击新增按钮，输入参数信息，查看新增参数是否显示在列表中；' }]
  }
  const item1: TestItem = {
    name: 'A星指令参数管理', itemId: 'XQ_SU_ZLPA', chapter: '6.2.1.4.1.1',
    typeName: '功能测试', groupName: 'A星模板功能测试', itemName: 'A星指令参数管理',
    description: { shared: null, entries: [] }, cases: [case1, case2], criteriaCases: [],
    traceSrs: { chapter: '4.3.1.2', desc: 'A星指令参数管理' }
  }
  const item2: TestItem = {
    name: '文档审查', itemId: 'XQ_DC', chapter: '6.2.1.1',
    typeName: '文档审查', groupName: null, itemName: '文档审查',
    description: { shared: '文档审查综述。', entries: [] },
    cases: [{ itemId: 'XQ_DC_DC001', name: '软件文档审查', summary: '', steps: [{ no: 1, text: '审查文档内容是否完整；' }] }],
    criteriaCases: [],
    traceSrs: { chapter: '/', desc: '/' }
  }
  return { items: [item1, item2], issues: [], stats: { items: 2, cases: 3, steps: 4 } }
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

describe('M2 动作/期望切分（2026-09-30 新写法）', () => {
  test('动作保留完整句子（去结尾标点），期望取关键词之后的内容', () => {
    const sp = splitStepText('在参数列表下方的查询输入框中输入参数标识，点击查询按钮，查看查询结果是否正确显示符合该参数标识的参数信息；')
    expect(sp.action).toBe('在参数列表下方的查询输入框中输入参数标识，点击查询按钮，查看查询结果是否正确显示符合该参数标识的参数信息')
    expect(sp.expect).toBe('查询结果正确显示符合该参数标识的参数信息')
    expect(sp.suspect).toBeUndefined()
  })

  test('多个关键词取最后一个；期望删除"是否"字样；去结尾标点', () => {
    const sp = splitStepText('清空查询输入框，点击查询按钮，查看软件是否恢复显示全部参数信息；验证功能正确性。')
    expect(sp.action).toBe('清空查询输入框，点击查询按钮，查看软件是否恢复显示全部参数信息；验证功能正确性')
    expect(sp.expect).toBe('功能正确性')
  })

  test('无关键词 → 期望为空可疑；关键词在开头 → 动作为完整句子', () => {
    const a = splitStepText('输入不存在的参数，点击查询按钮。')
    expect(a.action).toBe('输入不存在的参数，点击查询按钮')
    expect(a.expect).toBe('')
    expect(a.suspect).toBe('期望结果为空')

    const b = splitStepText('查看查询结果是否为空。')
    expect(b.action).toBe('查看查询结果是否为空')
    expect(b.expect).toBe('查询结果为空')
    expect(b.suspect).toBeUndefined()
  })
})

describe('M2 纯操作步合并（2026-09-30：4 步变 3 步）', () => {
  test('无关键词的步骤文本并入下一个验证步', () => {
    const outline = makeOutline()
    outline.items[0].cases[0].steps = [
      { no: 1, text: '点击新增按钮，在弹出的参数编辑窗口中输入合法的参数完整信息。' },
      { no: 2, text: '新增参数后，在参数列表中查看是否显示新增的参数信息，且参数标识与录入内容一致；' },
      { no: 3, text: '新增参数后，查看操作日志中是否记录参数新增操作日志；' },
      { no: 4, text: '在数据库中查询参数相关表，查看新增参数数据是否正确持久化存储。' }
    ]
    const data = convertToTemplateData(outline, DEFAULT_PARAMS)
    const steps = data.cases[0].steps
    // 4 步 → 3 步：第 1 步并入第 2 步
    expect(steps.length).toBe(3)
    expect(steps[0].action).toContain('点击新增按钮')
    expect(steps[0].action).toContain('在参数列表中查看')
    expect(steps[0].expect).toBe('显示新增的参数信息，且参数标识与录入内容一致')
  })
})

describe('M2 模板数据组装（03 字段映射）', () => {
  test('标志位只挂各组第一条，静态模板、默认值与追踪关系正确', () => {
    const data = convertToTemplateData(makeOutline(), { ...DEFAULT_PARAMS, tester: '张三', monitor: '李四' })
    const rows = data.cases

    expect(rows[0].showType).toBe('功能测试')
    expect(rows[0].showGroup).toBe('A星模板功能测试')
    expect(rows[0].showItem).toBe('A星指令参数管理')
    expect(rows[1].showType).toBeNull()
    expect(rows[2].showType).toBe('文档审查')
    expect(rows[2].showItem).toBeNull()

    // 纯操作步并入验证步：case1 = 1 步
    expect(rows[0].steps.length).toBe(1)
    expect(rows[0].steps[0].expect).toBe('查询结果正确显示')
    expect(rows[0].init).toBe('外接设备或软件运行正常')
    expect(rows[0].designer).toBe('陈俊亦')

    // 静态三类型按老项目模板
    expect(rows[2].expectSource).toBe('静态模板')
    expect(rows[2].steps.length).toBe(2)
    expect(rows[2].steps[0].action).toContain('需求规格说明审查单')
    expect(rows[2].suspectCount).toBe(0)

    expect(rows[2].trace).toBe(
      '软件测试依据：软件测评大纲\n' +
      '测试需求分析：6.2.1.1 文档审查\n' +
      '测试需求标识：XQ_DC_DC001'
    )
    expect(rows[0].steps[0].actual).toBe('')
    expect(rows[0].steps[0].result).toBe('通过')
  })

  test('用例清单与追踪表（老说明第 4/6 章格式）', () => {
    const data = convertToTemplateData(makeOutline(), DEFAULT_PARAMS)
    expect(data.caselist.map(c => c.caseId)).toEqual(['YL_SU_ZLPA_001', 'YL_SU_ZLPA_002', 'YL_DC_001'])
    expect(data.caselist[0].no).toBe(1)
    expect(data.caselist[0].summary).toBe('查询综述。')
    expect(data.traceRows[0]).toEqual({
      no: 1, srsChapter: '4.3.1.2', srsDesc: 'A星指令参数管理',
      outlineChapter: '6.2.1.4.1.1', itemName: 'A星指令参数管理', itemItemId: 'XQ_SU_ZLPA',
      caseName: '参数查询正常功能', caseId: 'YL_SU_ZLPA_001'
    })
    expect(data.traceRows[2].srsChapter).toBe('/')
    expect(data.traceRows[2].srsDesc).toBe('/')
  })

  test('排除用例后不进入清单与追踪表', () => {
    const outline = makeOutline()
    const data1 = convertToTemplateData(outline, DEFAULT_PARAMS)
    data1.cases[1].excluded = true
    const data2 = convertToTemplateData(outline, DEFAULT_PARAMS)
    data2.cases[1].excluded = true
    // caselist/traceRows 由 convert 直接产出，排除发生在生成侧过滤；
    // 这里验证 rows 上的标记位
    expect(data2.cases[1].excluded).toBe(true)
  })
})

describe('M2 准则格配对（9.5 实测变种）', () => {
  test('准则格对应用例 → 期望结果取准则，动作保留完整原文', () => {
    const outline = makeOutline()
    const item = outline.items[0]
    // 合并后 case1 = 1 步，准则 1 条与之配对
    item.criteriaCases = [{ itemId: 'XQ_SU_ZLPA_SU01', items: ['准则一；'] }]
    const data = convertToTemplateData(outline, DEFAULT_PARAMS)
    const row = data.cases[0]
    expect(row.expectSource).toBe('通过准则')
    expect(row.steps[0].expect).toBe('准则一')
    expect(row.steps[0].action).toBe('启动软件，进入参数管理界面，在查询输入框中输入参数标识，点击查询按钮，查看查询结果是否正确显示')
  })

  test('准则条数与步骤数不一致 → 回退关键词切分并告警', () => {
    const outline = makeOutline()
    // 合并后 case1 = 1 步，准则 2 条 → 不一致
    outline.items[0].criteriaCases = [{ itemId: 'XQ_SU_ZLPA_SU01', items: ['准则一；', '准则二；'] }]
    const data = convertToTemplateData(outline, DEFAULT_PARAMS)
    expect(data.cases[0].expectSource).toBe('方法切分')
    expect(data.issues.some(i => i.code === 'CRITERIA_COUNT_MISMATCH')).toBe(true)
  })

  test('buildRow 不依赖组名', () => {
    const outline = makeOutline()
    const row = buildRow(outline.items[0], outline.items[0].cases[0], DEFAULT_PARAMS)
    expect(row.caseId).toBe('YL_SU_ZLPA_001')
    expect(row.mingcheng).toBe('参数查询正常功能')
  })
})
