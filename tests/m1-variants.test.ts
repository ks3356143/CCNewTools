import { describe, test, expect } from 'bun:test'
import { buildDocx, itemTable, DESC, METHOD, CRITERIA, type Cell } from './helpers/ooxml.ts'
import { extractOutline } from '../src/core/parse/outline.ts'
import { convertToTemplateData } from '../src/core/convert/index.ts'
import { IssueCollector, DEFAULT_PARAMS } from '../src/core/domain.ts'

/**
 * 变种大杂烩（用户 2026-09-30 要求：不同的写法都要转换成功）。
 * 一份合成大纲同时包含全部已知变种形态，断言零错误转换。
 */

function content(): Array<{ kind: 'p'; para: any } | { kind: 'tbl'; rows: Cell[][] }> {
  return [
    { kind: 'p', para: { text: '测试依据', heading: 2, numId: 1, ilvl: 1 } },
    { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
    // 形态1：level-4 直接挂表（文档审查式）+ 引导句
    { kind: 'p', para: { text: '文档审查', heading: 4, numId: 1, ilvl: 3 } },
    {
      kind: 'tbl',
      rows: itemTable('文档审查', 'XQ_DC', [
        [DESC, '对软件文档进行审查。'],
        [METHOD, '1.文档审查（XQ_DC_DC001）\n依据检查单开展审查：\n1）审查内容是否完整；\n2）审查描述是否准确。']
      ])
    },
    // 形态2：level-4 → 5 → 6 正常三级 + 悬空小标题 + 准则格配对
    { kind: 'p', para: { text: '功能测试', heading: 4, numId: 1, ilvl: 3 } },
    { kind: 'p', para: { text: 'A星模板功能测试', heading: 5, numId: 1, ilvl: 4 } },
    { kind: 'p', para: { text: 'A星指令参数管理', heading: 6, numId: 1, ilvl: 5 } },
    {
      kind: 'tbl',
      rows: itemTable('A星指令参数管理', 'XQ_SU_ZLPA', [
        [DESC, '1.参数查询正常功能（XQ_SU_ZLPA_SU01）\n查询综述。\n2.参数新增正常功能（XQ_SU_ZLPA_SU02）\n新增综述。'],
        [METHOD, '1.参数查询正常功能（XQ_SU_ZLPA_SU01）\n1）打开窗口。\n查询标识：\n2）输入参数标识，点击查询按钮，查看查询结果是否正确显示；\n2.参数新增正常功能（XQ_SU_ZLPA_SU02）\n1）点击新增按钮。\n2）保存参数，查看新增参数是否显示；'],
        [CRITERIA, '1、参数查询正常功能（XQ_SU_ZLPA_SU01）\n不同检索类型（类型一、类型二）：\n1）查询结果正确显示；\n2、参数新增正常功能（XQ_SU_ZLPA_SU02）\n1）新增参数显示在列表中；']
      ])
    },
    // 形态3：跳级 level-4 → level-6 + 缺分隔符标题 + 自动编号列表吸收 + 共用综述
    { kind: 'p', para: { text: '性能测试', heading: 4, numId: 1, ilvl: 3 } },
    { kind: 'p', para: { text: 'BCD星指令生成准确率测试', heading: 6, numId: 1, ilvl: 5 } },
    {
      kind: 'tbl',
      rows: itemTable('BCD星指令生成准确率测试', 'XQ_AC_SCZQ', [
        [DESC, '验证指令生成准确率满足指标要求。'],
        [METHOD, [
          { text: '1指令生成准确率测试（XQ_AC_SCZQL_AC01）' },
          { text: '按大纲要求搭建测试环境：' },
          { text: '检查测试环境与大纲一致；', numId: 1, ilvl: 0 },
          { text: '检查测试数据已加载；', numId: 1, ilvl: 0 },
          { text: '生成指令并统计准确率，查看准确率是否达标。' }
        ]]
      ])
    },
    // 形态4：描述格子项数与测试方法不一致（多一个子项）
    { kind: 'p', para: { text: '接口测试', heading: 4, numId: 1, ilvl: 3 } },
    { kind: 'p', para: { text: '与控制计划编制软件接口', heading: 6, numId: 1, ilvl: 5 } },
    {
      kind: 'tbl',
      rows: itemTable('与控制计划编制软件接口', 'XQ_IO_JHBZ', [
        [DESC, '1.接口查询（XQ_IO_JHBZ_SU01）\n查询综述。\n2.接口发送（XQ_IO_JHBZ_SU02）\n发送综述。\n3.多出来的子项（XQ_IO_JHBZ_SU03）\n多余综述。'],
        [METHOD, '1.接口查询（XQ_IO_JHBZ_SU01）\n1）查询接口数据，查看返回是否正确；\n2.接口发送（XQ_IO_JHBZ_SU02）\n1）发送接口数据，查看发送是否成功；']
      ])
    },
    // 形态5：表格直接挂在 level-5 标题上（真实大纲接口/边界类形态，2026-10-01）——
    // 该标题是测试项本身，组必须为空（否则组名=项名，文档/树里多出一层重复标题）
    { kind: 'p', para: { text: '边界测试', heading: 4, numId: 1, ilvl: 3 } },
    { kind: 'p', para: { text: '指令边界测试', heading: 5, numId: 1, ilvl: 4 } },
    {
      kind: 'tbl',
      rows: itemTable('指令边界测试', 'XQ_BJ_ZL', [
        [DESC, '验证指令边界处理正确。'],
        [METHOD, '1.指令边界测试（XQ_BJ_ZL_BJ01）\n1）输入边界指令，查看是否正确处理；']
      ])
    },
    // 形态6（2026-10-01 用户样例"1.test测试大纲"）：准则一问一答式——
    // 重名标识（两个子项同 XQ_SU_BZXF_SU01）+ 方法格子项标题下写综述（子项2忘了写）
    // + 步骤与准则原样一一对应（不做关键词切分）
    { kind: 'p', para: { text: '功能测试', heading: 4, numId: 1, ilvl: 3 } },
    { kind: 'p', para: { text: '变种写法中间层', heading: 5, numId: 1, ilvl: 4 } },
    { kind: 'p', para: { text: '变种写法测试项', heading: 6, numId: 1, ilvl: 5 } },
    {
      kind: 'tbl',
      rows: itemTable('变种写法测试项', 'XQ_SU_BZXF', [
        [DESC, '变种写法中这里只有一段描述。'],
        [METHOD, '1.变种写法测试子项1号（XQ_SU_BZXF_SU01）\n我是子项1的描述，应放进用例综述。\n1）子项步骤1；\n2）子项步骤2；\n3）子项步骤3；\n2.变种写法测试子项2号（XQ_SU_BZXF_SU01）\n1）子项2步骤1；\n2）子项2步骤2；\n3）子项2步骤3'],
        [CRITERIA, '1.变种写法测试子项1号（XQ_SU_BZXF_SU01）\n1）子项预期1；\n2）子项预期2；\n3）子项预期3。\n2.变种写法测试子项2号（XQ_SU_BZXF_SU01）\n1）子项2预期1；\n2）子项2预期2；\n3）子项2预期3。']
      ])
    },
    // 形态7：无准则 + 方法格标题下普通段 → 退回第 1 步（旧解析行为不变，
    // 黄金基线保障——真实大纲静态分析等此形态段落仍是步骤）
    { kind: 'p', para: { text: '恢复性测试', heading: 4, numId: 1, ilvl: 3 } },
    { kind: 'p', para: { text: '指令恢复测试', heading: 6, numId: 1, ilvl: 5 } },
    {
      kind: 'tbl',
      rows: itemTable('指令恢复测试', 'XQ_HF_ZL', [
        [DESC, '1.指令恢复测试（XQ_HF_ZL_HF01）\n恢复综述。'],
        [METHOD, '1.指令恢复测试（XQ_HF_ZL_HF01）\n先做准备工作，检查环境正常。\n1）执行恢复操作；\n2）查看恢复结果是否正确；']
      ])
    }
  ]
}

describe('变种大杂烩：不同写法都要转换成功', () => {
  const issues = new IssueCollector()
  const office = buildDocx({ content: content() })
  const parsed = extractOutline(office, issues)
  const data = convertToTemplateData(parsed, DEFAULT_PARAMS)

  test('全部用例零错误转换', () => {
    const errors = parsed.issues.filter(i => i.level === 'error')
    expect(errors).toEqual([])
  })

  test('统计正确：7 项 10 例（解析层 20 步）', () => {
    expect(parsed.stats).toEqual({ items: 7, cases: 10, steps: 20 })
  })

  test('形态细节全部按规则处理', () => {
    // 缺分隔符的标题被识别
    const acc = parsed.items.find(i => i.name === 'BCD星指令生成准确率测试')!
    expect(acc.cases[0].name).toBe('指令生成准确率测试')
    expect(acc.cases[0].itemId).toBe('XQ_AC_SCZQL_AC01')
    // 自动编号吸收 + 引导句：准确率用例 2 步
    expect(acc.cases[0].steps.length).toBe(2)
    expect(acc.cases[0].steps[0].text).toContain('按大纲要求搭建测试环境：')
    // 悬空小标题静默丢弃（2026-10-09 用户裁决：忽略行不提醒）
    expect(parsed.issues.filter(i => i.code === 'DANGLING_LABEL').length).toBe(0)
    // 多余描述子项告警
    expect(parsed.issues.some(i => i.code === 'DESC_ENTRY_UNUSED')).toBe(true)
    // 标识笔误告警（XQ_AC_SCZQ vs XQ_AC_SCZQL）
    expect(parsed.issues.some(i => i.code === 'ID_MISMATCH')).toBe(true)
    // 综述共用 + 逐条匹配
    expect(acc.cases[0].summary).toBe('验证指令生成准确率满足指标要求。')
    expect(parsed.items[0].cases[0].summary).toBe('对软件文档进行审查。')
    // 形态5：表格挂 level-5 标题 → 该标题就是测试项，组为空（不与项名重复）
    const bj = parsed.items.find(i => i.name === '指令边界测试')!
    expect(bj.groupName).toBeNull()
    expect(bj.itemName).toBe('指令边界测试')
    expect(bj.chapter).not.toBe('')
  })

  test('准则格配对：期望取准则、动作保留原文', () => {
    const row = data.cases.find(c => c.caseId === 'YL_SU_ZLPA_001')!
    expect(row.expectSource).toBe('通过准则')
    expect(row.steps.length).toBe(1)
    expect(row.steps[0].expect).toBe('查询结果正确显示')
    expect(row.steps[0].action).toContain('打开窗口')
    expect(row.steps[0].action).toContain('输入参数标识，点击查询按钮，查看查询结果是否正确显示')
    const row2 = data.cases.find(c => c.caseId === 'YL_SU_ZLPA_002')!
    expect(row2.expectSource).toBe('通过准则')
    expect(row2.steps.length).toBe(1)
    expect(row2.steps[0].expect).toBe('新增参数显示在列表中')
  })

  test('形态6：准则一问一答式——重名标识轮转、方法格综述、步骤准则一一对应不切分', () => {
    const v = parsed.items.find(i => i.name === '变种写法测试项')!
    expect(v.cases.length).toBe(2)
    // 重名标识按出现顺序轮转：两个用例各配到自己的准则，而不是都配第一个
    expect(v.cases[0].criteria).toEqual(['子项预期1；', '子项预期2；', '子项预期3。'])
    expect(v.cases[1].criteria).toEqual(['子项2预期1；', '子项2预期2；', '子项2预期3。'])
    // 方法格综述：写了的转正为用例综述；忘了写的回退描述格共用综述
    expect(v.cases[0].summary).toBe('我是子项1的描述，应放进用例综述。')
    expect(v.cases[1].summary).toBe('变种写法中这里只有一段描述。')
    // 有准则不切分：步骤原文原样、期望逐条取准则、零可疑
    const r1 = data.cases.find(c => c.caseId === 'YL_SU_BZXF_001')!
    expect(r1.expectSource).toBe('通过准则')
    expect(r1.steps.map(s => s.action)).toEqual(['子项步骤1', '子项步骤2', '子项步骤3'])
    expect(r1.steps.map(s => s.expect)).toEqual(['子项预期1', '子项预期2', '子项预期3'])
    expect(r1.suspectCount).toBe(0)
    const r2 = data.cases.find(c => c.caseId === 'YL_SU_BZXF_002')!
    expect(r2.steps.map(s => s.action)).toEqual(['子项2步骤1', '子项2步骤2', '子项2步骤3'])
    expect(r2.steps.map(s => s.expect)).toEqual(['子项2预期1', '子项2预期2', '子项2预期3'])
    expect(r2.suspectCount).toBe(0)
  })

  test('形态7：无准则时方法格标题下普通段退回第 1 步（旧行为，黄金基线保障）', () => {
    const hf = parsed.items.find(i => i.name === '指令恢复测试')!
    expect(hf.cases[0].steps.length).toBe(3)
    expect(hf.cases[0].steps[0].text).toBe('先做准备工作，检查环境正常。')
    expect(hf.cases[0].summary).toBe('恢复综述。')
    const r = data.cases.find(c => c.itemId === 'XQ_HF_ZL_HF01')!
    expect(r.expectSource).toBe('方法切分')
  })
})

describe('软换行变种（Shift+Enter / w:br，2026-10-08 内网实测）', () => {
  // 真实形态（内网 4最新变种.docx，38 处 br）：单元格内用 br 分隔
  // "条目标题⏎综述；"、"标题⏎1）步骤"、"步骤⏎步骤"——此前 br 丢失全部粘连
  function brContent(): Array<{ kind: 'p'; para: any } | { kind: 'tbl'; rows: Cell[][] }> {
    return [
      { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
      { kind: 'p', para: { text: '功能测试', heading: 4, numId: 1, ilvl: 3 } },
      { kind: 'p', para: { text: '软换行测试项', heading: 6, numId: 1, ilvl: 5 } },
      {
        kind: 'tbl',
        rows: itemTable('软换行测试项', 'XQ_RJ_HC', [
          [DESC, [
            { textParts: ['1.第一个用例（XQ_RJ_HC001）', '第一个用例的综述；'] },
            { textParts: ['2.正常检索功能（XQ_RJ_HC002）', '第二个用例的综述；'] }
          ]],
          [METHOD, [
            { textParts: ['1.第一个用例（XQ_RJ_HC001）', '1）点击查询按钮，', '查看结果是否正确显示；', '2）执行导出操作，查看导出文件完整；'] },
            { textParts: ['2.正常检索功能（XQ_RJ_HC002）', '边界类：', '1）输入超长文本，', '查看软件正确处理；', '2）输入特殊字符，查看软件正确处理；'] },
            { textParts: ['3.双轨标题用例', '（XQ_RJ_HC003）'] },
            { text: '1）唯一步骤，查看正常；' }
          ]],
          [CRITERIA, [
            { textParts: ['1、第一个用例（XQ_RJ_HC001）', '1）结果正确显示；', '2）导出文件完整；'] },
            { textParts: ['2、正常检索功能（XQ_RJ_HC002）', '1）软件正确处理；'] }
          ]]
        ])
      }
    ]
  }

  const issues = new IssueCollector()
  const parsed = extractOutline(buildDocx({ content: brContent() }), issues)
  const data = convertToTemplateData(parsed, DEFAULT_PARAMS)

  test('用例识别：br 语义分行与被拆标题（双轨）都识别出 3 例', () => {
    expect(parsed.stats).toEqual({ items: 1, cases: 3, steps: 5 })
    const item = parsed.items[0]
    expect(item.cases.map(c => c.name)).toEqual(['第一个用例', '正常检索功能', '双轨标题用例'])
  })

  test('方法格：碎行并入还原步骤文本，标题/综述/小标题各归其位', () => {
    const c1 = parsed.items[0].cases[0]
    expect(c1.steps.map(s => s.text)).toEqual(['点击查询按钮，查看结果是否正确显示；', '执行导出操作，查看导出文件完整；'])
    const c2 = parsed.items[0].cases[1]
    // "边界类："是标题后的引导句，并入步骤 1（既有规则 2，不因 br 改变）
    expect(c2.steps.map(s => s.text)).toEqual(['边界类：输入超长文本，查看软件正确处理；', '输入特殊字符，查看软件正确处理；'])
    const c3 = parsed.items[0].cases[2]
    expect(c3.steps.map(s => s.text)).toEqual(['唯一步骤，查看正常；'])
  })

  test('描述格与准则格：br 条目拆分、综述与准则配对正确', () => {
    const item = parsed.items[0]
    expect(item.description.entries.map(e => e.summary)).toEqual(['第一个用例的综述；', '第二个用例的综述；'])
    expect(item.criteriaCases[0].items).toEqual(['结果正确显示；', '导出文件完整；'])
    expect(item.criteriaCases[1].items).toEqual(['软件正确处理；'])
    const r1 = data.cases.find(c => c.caseId === 'YL_RJ_HC_001')!
    expect(r1.expectSource).toBe('通过准则')
    expect(r1.summary).toBe('第一个用例的综述；')
    expect(r1.steps.map(s => s.expect)).toEqual(['结果正确显示', '导出文件完整'])
  })
})

describe('内网实测形态固化（2026-10-09：无编号首子项标题 + 括号小标题丢弃，检索WQ资源信息测试项）', () => {
  // 结构浓缩自真实文档：①方法格首段带 numPr（"1、"是 Word 自动编号渲染，字面无前缀），
  // 旧 matchCaseTitle 要求编号开头 → 首子项整体丢失；②标题后首个"："行含括号枚举
  // （「不同检索类型（WQ类型、目标、行业分类、标签、关键词）：」），旧逻辑走引导句规则
  // 与第 1 步粘连；③无括号"："行（「边界类：」）维持引导句并入（既有规则 2 不变）。
  // 忽略行一律静默（用户裁决：被忽略的行不在解析完成后提醒）。
  const issues = new IssueCollector()
  const parsed = extractOutline(buildDocx({
    content: [
      { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
      { kind: 'p', para: { text: '功能测试', heading: 4, numId: 1, ilvl: 3 } },
      { kind: 'p', para: { text: '检索WQ资源信息', heading: 6, numId: 1, ilvl: 5 } },
      {
        kind: 'tbl',
        rows: itemTable('检索WQ资源信息', 'XQ_SU_JSWQ', [
          [DESC, [
            { textParts: ['1、检索WQ资源信息人机界面元素测试（XQ_SU_JSWQ_SU01）', '验证软件人机界面元素与需求规格说明要求是否一致；'] },
            { textParts: ['2、正常检索WQ资源信息功能测试（XQ_SU_JSWQ_SU02）', '验证软件检索WQ资源信息功能实现与需求规格说明是否一致；'] }
          ]],
          [METHOD, [
            { numId: 11, textParts: ['检索WQ资源信息人机界面元素测试（XQ_SU_JSWQ_SU01）', '1）打开界面，查看页面层级信息；', '2）关键词搜索后查看统计数量；'] },
            { textParts: ['2、正常检索WQ资源信息功能测试（XQ_SU_JSWQ_SU02）', '不同检索类型（WQ类型、目标、行业分类、标签、关键词）：', '1）输入不同WQ类型，查看检索结果数量一致；'] }
          ]],
          [CRITERIA, [
            { textParts: ['1、检索WQ资源信息人机界面元素测试（XQ_SU_JSWQ_SU01）', '1）展示页面层级信息；'] },
            { textParts: ['2、正常检索WQ资源信息功能测试（XQ_SU_JSWQ_SU02）', '1）数量一致；'] }
          ]]
        ])
      }
    ]
  }), issues)

  test('无编号标题（numPr 渲染编号）识别为首子项用例：2 例完整', () => {
    expect(parsed.stats).toEqual({ items: 1, cases: 2, steps: 3 })
    const item = parsed.items[0]
    expect(item.cases.map(c => c.name)).toEqual(['检索WQ资源信息人机界面元素测试', '正常检索WQ资源信息功能测试'])
    expect(item.cases[0].itemId).toBe('XQ_SU_JSWQ_SU01')
    expect(item.cases[0].steps.map(s => s.text)).toEqual(['打开界面，查看页面层级信息；', '关键词搜索后查看统计数量；'])
  })

  test('括号小标题丢弃不粘连，忽略行零提醒', () => {
    const c2 = parsed.items[0].cases[1]
    expect(c2.steps.map(s => s.text)).toEqual(['输入不同WQ类型，查看检索结果数量一致；'])
    expect(c2.steps[0].text.startsWith('不同检索类型')).toBe(false)
    expect(parsed.issues.filter(i => i.level !== 'error').length).toBe(0)
  })
})
