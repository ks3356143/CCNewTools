import { describe, test, expect } from 'bun:test'
import { buildDocx, type Cell } from './helpers/ooxml.ts'
import { extractOutline } from '../src/core/parse/outline.ts'
import { IssueCollector } from '../src/core/domain.ts'

/** M1 解析层单测：每条规则至少一个合成样本（02 解析层 + 06 错误处理） */

function parse(content: Array<{ kind: 'p'; para: any } | { kind: 'tbl'; rows: Cell[][] }>) {
  const office = buildDocx({ content })
  const issues = new IssueCollector()
  const result = extractOutline(office, issues)
  return { result, issues }
}

/** 构造一张测试项表格；rows 依次为：名称行之后的行 */
function itemTable(name: string, itemId: string, extraRows: Cell[][]): Cell[][] {
  return [
    [{ text: '测试项名称' }, { text: name }, { text: '标识' }, { text: itemId }],
    ...extraRows
  ]
}

const DESC = '测试项描述'
const METHOD = '测试方法'
const CRITERIA = '通过准则'

describe('M1 标题与章节号（02 第二节）', () => {
  test('章节号跨文档累积、三级标题路径、用例与步骤切分', () => {
    const content: any[] = []
    for (let i = 1; i <= 6; i++) content.push({ kind: 'p', para: { text: '第' + i + '章占位', heading: 1, numId: 1, ilvl: 0 } })
    content.push({ kind: 'p', para: { text: '测试依据', heading: 2, numId: 1, ilvl: 1 } })
    content.push({ kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } })
    content.push({ kind: 'p', para: { text: '文档审查', heading: 4, numId: 1, ilvl: 3 } })
    content.push({ kind: 'p', para: { text: '静态分析', heading: 4, numId: 1, ilvl: 3 } })
    content.push({ kind: 'p', para: { text: '代码审查', heading: 4, numId: 1, ilvl: 3 } })
    content.push({ kind: 'p', para: { text: '功能测试', heading: 4, numId: 1, ilvl: 3 } })
    content.push({ kind: 'p', para: { text: 'A星模板功能测试', heading: 5, numId: 1, ilvl: 4 } })
    content.push({ kind: 'p', para: { text: 'A星指令参数管理', heading: 6, numId: 1, ilvl: 5 } })
    content.push({
      kind: 'tbl',
      rows: itemTable('A星指令参数管理', 'XQ_SU_ZLPA', [
        [DESC, '1.参数查询正常功能（XQ_SU_ZLPA_SU01）\n验证参数查询功能是否正确。\n2.参数新增正常功能（XQ_SU_ZLPA_SU02）\n验证参数新增功能是否正确。'],
        [METHOD, '1.参数查询正常功能（XQ_SU_ZLPA_SU01）\n1）启动软件，进入参数管理界面。\n2）在查询输入框中输入参数标识，点击查询按钮，查看查询结果是否正确显示；\n2.参数新增正常功能（XQ_SU_ZLPA_SU02）\n1）点击新增按钮，输入参数信息。\n2）点击保存按钮，查看新增参数是否显示在列表中；']
      ])
    })
    const { result, issues } = parse(content)

    expect(result.stats).toEqual({ items: 1, cases: 2, steps: 4 })
    const item = result.items[0]
    expect(item.chapter).toBe('6.2.1.4.1.1')
    expect(item.typeName).toBe('功能测试')
    expect(item.groupName).toBe('A星模板功能测试')
    expect(item.itemName).toBe('A星指令参数管理')
    expect(item.itemId).toBe('XQ_SU_ZLPA')
    // 步骤切分：m）前缀剥掉，序号独立
    expect(item.cases[0].steps[0].text).toBe('启动软件，进入参数管理界面。')
    expect(item.cases[0].steps[1].text).toBe('在查询输入框中输入参数标识，点击查询按钮，查看查询结果是否正确显示；')
    // 综述逐条匹配
    expect(item.cases[0].summary).toBe('验证参数查询功能是否正确。')
    expect(item.cases[1].summary).toBe('验证参数新增功能是否正确。')
    expect(issues.issues.length).toBe(0)
  })

  test('表格挂在 level-4 上（文档审查形态）：类型与测试项同名', () => {
    const { result } = parse([
      { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
      { kind: 'p', para: { text: '文档审查', heading: 4, numId: 1, ilvl: 3 } },
      {
        kind: 'tbl',
        rows: itemTable('文档审查', 'XQ_DC', [
          [DESC, '对软件文档进行审查。'],
          [METHOD, '1.文档审查（XQ_DC_DC001）\n1）审查内容是否完整；\n2）审查描述是否准确。']
        ])
      }
    ])
    const item = result.items[0]
    expect(item.typeName).toBe('文档审查')
    expect(item.groupName).toBeNull()
    expect(item.itemName).toBe('文档审查')
    expect(result.stats.cases).toBe(1)
  })

  test('跳级挂载（性能测试 level-4 → level-6）：中间层为空', () => {
    const { result } = parse([
      { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
      { kind: 'p', para: { text: '性能测试', heading: 4, numId: 1, ilvl: 3 } },
      { kind: 'p', para: { text: 'BCD星指令生成准确率测试', heading: 6, numId: 1, ilvl: 5 } },
      {
        kind: 'tbl',
        rows: itemTable('BCD星指令生成准确率测试', 'XQ_AC_SCZQ', [
          [DESC, '验证指令生成准确率。'],
          [METHOD, '1.指令生成准确率（XQ_AC_SCZQ_AC01）\n1）生成指令并统计准确率，查看准确率是否达标。']
        ])
      }
    ])
    const item = result.items[0]
    expect(item.typeName).toBe('性能测试')
    expect(item.groupName).toBeNull()
    // level-6 标题 → 章节号 6 段（fixture 无前置章节，各级均为 1）
    expect(item.chapter.split('.').length).toBe(6)
  })

  test('节外内容跳过：到下一个 level ≤ 2 的标题为止', () => {
    const { result } = parse([
      { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
      { kind: 'p', para: { text: '文档审查', heading: 4, numId: 1, ilvl: 3 } },
      {
        kind: 'tbl',
        rows: itemTable('文档审查', 'XQ_DC', [[METHOD, '1.文档审查（XQ_DC_DC001）\n1）审查内容。']])
      },
      { kind: 'p', para: { text: '测试通过准则', heading: 2, numId: 1, ilvl: 1 } },
      {
        kind: 'tbl',
        rows: itemTable('伪装表格', 'XQ_FAKE', [[METHOD, '1.不应被解析（XQ_FAKE_F001）\n1）不存在。']])
      }
    ])
    expect(result.stats.items).toBe(1)
    expect(result.items[0].name).toBe('文档审查')
  })
})

describe('M1 段落形态与步骤切分（02 第五、六节）', () => {
  test('自动编号列表段落成为步骤且无编号污染，引导句并入第 1 步', () => {
    const { result } = parse([
      { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
      { kind: 'p', para: { text: '静态分析', heading: 4, numId: 1, ilvl: 3 } },
      {
        kind: 'tbl',
        rows: itemTable('静态分析', 'XQ_SA', [
          [METHOD, [
            { text: '1.静态分析（XQ_SA_SA001）' },
            { text: '依据检查单开展静态分析，检查内容如下：' },
            { text: '检查命名规范是否符合要求；', numId: 1, ilvl: 0 },
            { text: '检查圈复杂度是否超标。', numId: 1, ilvl: 0 }
          ]]
        ])
      }
    ])
    const c = result.items[0].cases[0]
    expect(c.steps.length).toBe(2)
    expect(c.steps[0].text).toBe('依据检查单开展静态分析，检查内容如下：检查命名规范是否符合要求；')
    expect(c.steps[1].text).toBe('检查圈复杂度是否超标。')
    expect(c.steps[0].text).not.toContain('1）')
  })

  test('悬空小标题行被丢弃并记录提示（9.1）', () => {
    const { result, issues } = parse([
      { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
      { kind: 'p', para: { text: '功能测试', heading: 4, numId: 1, ilvl: 3 } },
      { kind: 'p', para: { text: 'BCD星指令参数管理', heading: 6, numId: 1, ilvl: 5 } },
      {
        kind: 'tbl',
        rows: itemTable('BCD星指令参数管理', 'XQ_SU_ZLPA', [
          [DESC, '验证参数管理功能。'],
          [METHOD, '1.参数查询正常功能（XQ_SU_ZLPA_SU01）\n1）打开参数管理窗口。\n查询标识：\n2）输入参数标识，查看查询结果是否正确；']
        ])
      }
    ])
    const c = result.items[0].cases[0]
    expect(c.steps.length).toBe(2)
    expect(c.steps[1].text).toBe('输入参数标识，查看查询结果是否正确；')
    const info = issues.issues.find(i => i.code === 'DANGLING_LABEL')
    expect(info).toBeDefined()
    expect(info!.level).toBe('info')
    expect(info!.message).toContain('查询标识：')
  })

  test('小标题行后有正文并入则保留为步骤（规则 4）', () => {
    const { result } = parse([
      { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
      { kind: 'p', para: { text: '功能测试', heading: 4, numId: 1, ilvl: 3 } },
      {
        kind: 'tbl',
        rows: itemTable('某测试项', 'XQ_A_B', [
          [METHOD, '1.某用例（XQ_A_B001）\n1）打开窗口。\n查询标识：\n输入参数标识后点击查询按钮。\n2）关闭窗口。']
        ])
      }
    ])
    const c = result.items[0].cases[0]
    expect(c.steps.length).toBe(3)
    expect(c.steps[1].text).toBe('查询标识：输入参数标识后点击查询按钮。')
  })

  test('规则 5：上一段以；结尾并入、以。结尾新开', () => {
    const { result } = parse([
      { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
      { kind: 'p', para: { text: '功能测试', heading: 4, numId: 1, ilvl: 3 } },
      {
        kind: 'tbl',
        rows: itemTable('某测试项', 'XQ_M_N', [
          [METHOD, '1.某用例（XQ_M_N001）\n1）执行操作步骤一；\n继续补充操作内容。\n2）执行操作步骤二。\n补充说明文字。']
        ])
      }
    ])
    const c = result.items[0].cases[0]
    expect(c.steps.map(s => s.text)).toEqual([
      '执行操作步骤一；继续补充操作内容。',
      '执行操作步骤二。',
      '补充说明文字。'
    ])
  })

  test('列表项以「：」结尾吸收其后的列表项（02 抽查：静态分析 3 步）', () => {
    const { result } = parse([
      { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
      { kind: 'p', para: { text: '静态分析', heading: 4, numId: 1, ilvl: 3 } },
      {
        kind: 'tbl',
        rows: itemTable('静态分析', 'XQ_SA', [
          [METHOD, [
            { text: '1.静态分析（XQ_SA_SA001）' },
            { text: '使用科代代码分析工具对被测软件全部源程序进行静态分析，依据附录5对源程序进行检查。' },
            { text: '使用静态分析工具统计软件质量度量信息，包含：', numId: 1, ilvl: 0 },
            { text: '软件总注释率不小于20%；', numId: 1, ilvl: 0 },
            { text: '模块的平均规模不大于200行；', numId: 1, ilvl: 0 },
            { text: '模块的平均圈复杂度不大于10；', numId: 1, ilvl: 0 },
            { text: '模块的平均扇出数不大于7。', numId: 1, ilvl: 0 },
            { text: '使用静态分析工具结合人工分析对控制流和数据流进行分析，验证软件是否满足要求。' }
          ]]
        ])
      }
    ])
    const c = result.items[0].cases[0]
    expect(c.steps.length).toBe(3)
    expect(c.steps[0].text).toContain('科代代码分析工具')
    expect(c.steps[1].text).toContain('统计软件质量度量信息，包含：')
    expect(c.steps[1].text).toContain('平均扇出数不大于7。')
    expect(c.steps[2].text).toContain('控制流和数据流')
  })

  test('整格无用例标题 → 单用例兜底 + 告警（02 第八节）', () => {
    const { result, issues } = parse([
      { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
      { kind: 'p', para: { text: '功能测试', heading: 4, numId: 1, ilvl: 3 } },
      {
        kind: 'tbl',
        rows: itemTable('某测试项', 'XQ_T_N', [
          [METHOD, '1）打开软件。\n2）查看界面是否正常显示。']
        ])
      }
    ])
    expect(result.stats.cases).toBe(1)
    expect(result.items[0].cases[0].name).toBe('某测试项')
    expect(issues.issues.some(i => i.code === 'NO_TITLE' && i.level === 'warning')).toBe(true)
  })

  test('编号后缺分隔符的标题行仍被识别（实测 A星 V1.10：8宏动作…）', () => {
    const { result, issues } = parse([
      { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
      { kind: 'p', para: { text: '功能测试', heading: 4, numId: 1, ilvl: 3 } },
      {
        kind: 'tbl',
        rows: itemTable('宏动作映射管理', 'XQ_SU_HHZM', [
          [DESC, '1.查询（XQ_SU_HHZM_SU01）\n查询综述。\n2.修改异常（XQ_SU_HHZM_SU08）\n修改异常综述。'],
          [METHOD, '1.查询（XQ_SU_HHZM_SU01）\n1）查询操作，查看结果；\n8修改异常功能（XQ_SU_HHZM_SU08）\n1）修改操作，查看错误提示；']
        ])
      }
    ])
    expect(result.stats.cases).toBe(2)
    const cases = result.items[0].cases
    expect(cases[1].name).toBe('修改异常功能')
    expect(cases[1].itemId).toBe('XQ_SU_HHZM_SU08')
    expect(cases[1].summary).toBe('修改异常综述。')
    expect(cases[0].summary).toBe('查询综述。')
    expect(issues.issues.length).toBe(0)
  })

  test('用例零步骤 → 错误级问题（06）', () => {
    const { result, issues } = parse([
      { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
      { kind: 'p', para: { text: '功能测试', heading: 4, numId: 1, ilvl: 3 } },
      {
        kind: 'tbl',
        rows: itemTable('某测试项', 'XQ_Z_S', [
          [METHOD, '1.空用例（XQ_Z_S001）\n2.正常用例（XQ_Z_S002）\n1）正常步骤。']
        ])
      }
    ])
    expect(result.items[0].cases[0].steps.length).toBe(0)
    const err = issues.issues.find(i => i.code === 'ZERO_STEPS')
    expect(err).toBeDefined()
    expect(err!.level).toBe('error')
  })
})

describe('M1 综述与标识（9.2/9.3/9.4、02 第八节）', () => {
  test('描述格无子项 → 共用综述，不产生提示（9.2）', () => {
    const { result, issues } = parse([
      { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
      { kind: 'p', para: { text: '功能测试', heading: 4, numId: 1, ilvl: 3 } },
      {
        kind: 'tbl',
        rows: itemTable('人机交互界面', 'XQ_GUI', [
          [DESC, '验证人机交互界面各项功能。'],
          [METHOD, '1.界面显示（XQ_GUI_G001）\n1）打开界面，查看显示是否正确；\n2.界面操作（XQ_GUI_G002）\n1）执行操作，查看响应是否正确。']
        ])
      }
    ])
    expect(result.items[0].cases[0].summary).toBe('验证人机交互界面各项功能。')
    expect(result.items[0].cases[1].summary).toBe('验证人机交互界面各项功能。')
    expect(issues.issues.length).toBe(0)
  })

  test('描述格多出的子项 → 告警并忽略（9.3）', () => {
    const { result, issues } = parse([
      { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
      { kind: 'p', para: { text: '功能测试', heading: 4, numId: 1, ilvl: 3 } },
      {
        kind: 'tbl',
        rows: itemTable('宏动作映射管理', 'XQ_SU_HHZM', [
          [DESC, '1.查询（XQ_SU_HHZM_SU01）\n查询综述。\n2.添加（XQ_SU_HHZM_SU02）\n添加综述。\n3.删除（XQ_SU_HHZM_SU03）\n删除综述。'],
          [METHOD, '1.查询（XQ_SU_HHZM_SU01）\n1）查询操作，查看结果；\n2.添加（XQ_SU_HHZM_SU02）\n1）添加操作，查看结果；']
        ])
      }
    ])
    expect(result.stats.cases).toBe(2)
    expect(result.items[0].cases[0].summary).toBe('查询综述。')
    const warn = issues.issues.find(i => i.code === 'DESC_ENTRY_UNUSED')
    expect(warn).toBeDefined()
    expect(warn!.message).toContain('XQ_SU_HHZM_SU03')
  })

  test('描述与方法标识笔误 → 综述按顺序推断匹配（9.4）', () => {
    const { result, issues } = parse([
      { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
      { kind: 'p', para: { text: '性能测试', heading: 4, numId: 1, ilvl: 3 } },
      {
        kind: 'tbl',
        rows: itemTable('准确率测试', 'XQ_AC_SCZQ', [
          [DESC, '1.准确率一（XQ_AC_SCZQ_AC01）\n综述一。\n2.准确率二（XQ_AC_SCZQ_AC02）\n综述二。'],
          [METHOD, '1.准确率一（XQ_AC_SCZQL_AC01）\n1）操作一，查看结果；\n2.准确率二（XQ_AC_SCZQL_AC02）\n1）操作二，查看结果；']
        ])
      }
    ])
    const cases = result.items[0].cases
    expect(cases[0].summary).toBe('综述一。')
    expect(cases[1].summary).toBe('综述二。')
    expect(issues.issues.some(i => i.code === 'SUMMARY_ORDER_MATCH')).toBe(true)
  })

  test('用例标识与测试项标识不一致 → 告警，以用例标题为准（02 第八节）', () => {
    const { result, issues } = parse([
      { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
      { kind: 'p', para: { text: '功能测试', heading: 4, numId: 1, ilvl: 3 } },
      {
        kind: 'tbl',
        rows: itemTable('某测试项', 'XQ_SU_ZLQQ', [
          [DESC, '验证某功能。'],
          [METHOD, '1.某功能（XQ_SU_ZLQX_SU01）\n1）操作，查看结果；']
        ])
      }
    ])
    expect(result.items[0].cases[0].itemId).toBe('XQ_SU_ZLQX_SU01')
    expect(issues.issues.some(i => i.code === 'ID_MISMATCH')).toBe(true)
  })
})

describe('M1 通过准则格解析（9.5 实测变种）', () => {
  test('准则格按用例标题分桶、丢弃小标题行、条目剥离编号', () => {
    const { result, issues } = parse([
      { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
      { kind: 'p', para: { text: '功能测试', heading: 4, numId: 1, ilvl: 3 } },
      {
        kind: 'tbl',
        rows: itemTable('检索测试', 'XQ_SU_JSWQ', [
          [METHOD, '1.界面元素测试（XQ_SU_JSWQ_SU01）\n1）打开界面，查看元素是否正确显示；'],
          [CRITERIA, '1、界面元素测试（XQ_SU_JSWQ_SU01）\n不同检索类型（类型一、类型二、类型三）：\n1）软件展示页面层级信息、搜索栏和搜索按钮、检索结果统计栏、信息列表；\n2、正常检索功能（XQ_SU_JSWQ_SU02）\n1）展示统计检索结果数量，数量与库中数量一致；']
        ])
      }
    ])
    const cc = result.items[0].criteriaCases
    expect(cc.length).toBe(2)
    expect(cc[0].itemId).toBe('XQ_SU_JSWQ_SU01')
    expect(cc[0].items).toEqual(['软件展示页面层级信息、搜索栏和搜索按钮、检索结果统计栏、信息列表；'])
    expect(cc[1].itemId).toBe('XQ_SU_JSWQ_SU02')
    expect(cc[1].items).toEqual(['展示统计检索结果数量，数量与库中数量一致；'])
    expect(issues.issues.some(i => i.code === 'CRITERIA_LABEL' && i.message.includes('不同检索类型'))).toBe(true)
  })
})
