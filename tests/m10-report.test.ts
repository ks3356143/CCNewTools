import { describe, test, expect, beforeAll } from 'bun:test'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import PizZip from 'pizzip'
import { buildDocx, buildDocxBuffer, DESC, METHOD, type Cell, type DocSpec } from './helpers/ooxml.ts'
import { handle } from '../src/server/app.ts'
import { extractOutline } from '../src/core/parse/outline.ts'
import { extractRecordCases } from '../src/core/parse/record.ts'
import { buildConfData, STATIC_TYPES } from '../src/core/report/build.ts'
import { DEFAULT_PARAMS, IssueCollector, type GlobalParams } from '../src/core/domain.ts'
import type { RecordCase } from '../src/core/parse/record.ts'

/** M10 工具四「报告统计与需求符合性」（14）v2：用例=步骤行口径 + 静/动态分组 + 表26/33/34 + 表38 列4 用例文字 */

beforeAll(() => {
  process.env.CC_DATA_DIR = mkdtempSync(join(tmpdir(), 'cc-m10-'))
})

const PARAMS: GlobalParams = { ...DEFAULT_PARAMS }

/** 测试项表（与 m9 同构：六列首行 + 追踪关系/需求描述原文行 + 描述/方法） */
function fullItemTable(name: string, itemId: string, trace: string, reqDesc: string, desc: string, method: string): Cell[][] {
  return [
    [{ text: '测试项名称' }, { text: name }, { text: '测试项标识' }, { text: itemId }, { text: '优先级' }, { text: '高' }],
    [{ text: '追踪关系' }, { text: trace }],
    [{ text: '需求描述' }, { text: reqDesc }],
    [DESC, desc],
    [METHOD, method]
  ]
}

/** 合成大纲：四个测试项——项甲=文档审查（静态）、项乙=功能测试（动态）、项丙=静态分析（静态）、项丁=性能测试（动态，无记录） */
function outlineSpec(): DocSpec {
  return {
    content: [
      { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
      { kind: 'p', para: { text: '文档审查', heading: 4, numId: 1, ilvl: 3 } },
      { kind: 'tbl', rows: fullItemTable('项甲', 'XQ_A', '《某需求规格说明》3.1 功能甲', '功能甲需求描述原文。', '1.用例甲（XQ_A001）\n用例甲综述。', '1.用例甲（XQ_A001）\n1）执行操作甲，查看结果是否正确；') },
      { kind: 'p', para: { text: '功能测试', heading: 4, numId: 1, ilvl: 3 } },
      { kind: 'tbl', rows: fullItemTable('项乙', 'XQ_B', '《某需求规格说明》3.2 功能乙', '功能乙需求描述原文。', '1.用例乙（XQ_B001）\n用例乙综述。', '1.用例乙（XQ_B001）\n1）执行操作乙，查看结果是否正确；') },
      { kind: 'p', para: { text: '静态分析', heading: 4, numId: 1, ilvl: 3 } },
      { kind: 'tbl', rows: fullItemTable('项丙', 'XQ_C', '隐含需求', '--', '1.用例丙（XQ_C001）\n用例丙综述。', '1.用例丙（XQ_C001）\n1）执行操作丙，查看结果是否正确；') },
      { kind: 'p', para: { text: '性能测试', heading: 4, numId: 1, ilvl: 3 } },
      { kind: 'tbl', rows: fullItemTable('项丁', 'XQ_D', '《某需求规格说明》3.4 功能丁', '甲'.repeat(200) + '\n' + '乙'.repeat(200) + '\n' + '丙'.repeat(200), '1.用例丁（XQ_D001）\n用例丁综述。', '1.用例丁（XQ_D001）\n1）执行操作丁，查看结果是否正确；') }
    ]
  }
}

/** 用例记录表（m9 同构；期望结果列写「期望文字X」供表38 列4 断言） */
function recordTable(caseId: string, caseName: string, traceItemId: string, results: string[], expect: string, traceName = '某测试项'): { kind: 'tbl'; rows: Cell[][] } {
  return {
    kind: 'tbl',
    rows: [
      [{ text: '' }],
      [{ text: '测试用例名称' }, { text: caseName }, { text: '标   识' }, { text: caseId }],
      [{ text: '追踪关系' }, { text: '软件测试依据：软件测评大纲\n测试需求分析：1.1.1.1 ' + traceName + '\n测试需求标识：' + traceItemId }],
      [{ text: '测试步骤' }],
      [{ text: '序号' }, { text: '输入及操作' }, { text: '期望结果与评估标准' }, { text: '实测结果' }, { text: '通过与否' }],
      ...results.map((r, i) => [{ text: String(i + 1) }, { text: '执行操作' + (i + 1) }, { text: expect }, { text: '' }, { text: r }]),
      [{ text: '执行状态' }, { text: '已执行' }, { text: '测试时间' }, { text: '2026-08-18' }],
      [{ text: '测试人员' }, { text: '张三' }, { text: '监测人员' }, { text: '李四' }],
      [{ text: '问题单标识' }, { text: '/' }],
      [{ text: '备注' }, { text: '/' }]
    ]
  }
}

/** 首轮记录：甲通过、乙丙不通过、幽灵对不上、项丁无记录；另有「同名异标识」幽灵（项丁用例名挂在别的标识下 → 改名嫌疑） */
function firstRecordSpec(): DocSpec {
  return {
    content: [
      { kind: 'p', para: { text: '测试记录', heading: 1 } },
      recordTable('YL_A_001', '用例甲', 'XQ_A', ['通过'], '期望文字甲'),
      recordTable('YL_B_001', '用例乙', 'XQ_B', ['未通过'], '期望文字乙'),
      recordTable('YL_C_001', '用例丙', 'XQ_C', ['不通过'], '期望文字丙'),
      recordTable('YL_GHOST', '幽灵用例', 'XQ_ZZ', ['未通过'], '期望文字幽灵'),
      recordTable('YL_OTHER_001', '用例丁', 'XQ_OTHER', ['通过'], '期望文字丁替')
    ]
  }
}

/** 回归记录：乙回归通过、丙回归仍未通过 */
function regRecordSpec(): DocSpec {
  return {
    content: [
      { kind: 'p', para: { text: '回归测试记录', heading: 1 } },
      recordTable('YL_B_001', '用例乙', 'XQ_B', ['通过'], '期望文字乙'),
      recordTable('YL_C_001', '用例丙', 'XQ_C', ['未通过'], '期望文字丙')
    ]
  }
}

function parseFixtures(): { outline: ReturnType<typeof extractOutline>; first: RecordCase[]; reg: RecordCase[] } {
  const outline = extractOutline(buildDocx(outlineSpec()), new IssueCollector())
  const first = extractRecordCases(buildDocx(firstRecordSpec()), new IssueCollector())
  const reg = extractRecordCases(buildDocx(regRecordSpec()), new IssueCollector())
  return { outline, first, reg }
}

describe('M10 表38 + 统计（v2：用例=步骤行）', () => {
  test('列4 规则：通过=记录用例文字（无图）；不通过=经过测试符合要求；未测试', () => {
    const { outline, first, reg } = parseFixtures()
    const data = buildConfData(outline, first, reg, PARAMS)
    expect(data.rows.map(r => r.result)).toEqual([
      '期望文字甲',
      '经过测试符合要求',   // 项乙：首轮不通过 → 拍板不写未通过
      '经过测试符合要求',   // 项丙：首轮不通过且回归仍未过 → 同上（回归未过出告警）
      '未测试'
    ])
    // 列2/列3 仍取大纲原文；'--' 置空
    expect(data.rows[0].source).toBe('《某需求规格说明》3.1 功能甲')
    expect(data.rows[0].metric).toBe('功能甲需求描述原文。')
    expect(data.rows[2].metric).toBe('')
    // 表38 判定统计（按需求项）：首轮通过 1 / 回归通过 1 / 回归未过 1 / 未测试 1
    expect([data.stats.firstPass, data.stats.regPass, data.stats.firstFail, data.stats.regFail, data.stats.untested]).toEqual([1, 1, 0, 1, 1])
    // 用例口径 = 步骤行：大纲 4 表 6 步（静态两类型转换层固定 2 步）；首轮执行 3 步、不通过 2 步；回归 2 表、乙归零 1、丙遗留 1
    expect([data.stats.outlineCases, data.stats.outlineSteps, data.stats.executedSteps, data.stats.failedSteps]).toEqual([4, 6, 3, 2])
    expect([data.stats.regCases, data.stats.regZero, data.stats.regLeft]).toEqual([2, 1, 1])
    expect(data.issues.some(i => i.code === 'REPORT_REG_FAIL')).toBe(true)
    expect(data.issues.some(i => i.code === 'REPORT_ITEM_UNTESTED')).toBe(true)
    expect(data.issues.some(i => i.code === 'REPORT_LEVEL_ASSUMED' && i.message.includes('2 个'))).toBe(true)
    // 改名嫌疑（用户质疑"未测试项肯定能找到"探针结论）：项丁在记录里有同名用例但标识不同
    expect(data.issues.some(i => i.code === 'REPORT_RENAME_SUSPECT' && i.message.includes('项丁') && i.message.includes('YL_OTHER_001'))).toBe(true)
    // 两张幽灵表（YL_GHOST + 同名异标识的 YL_OTHER_001）都不参与判定
    expect(data.issues.some(i => i.code === 'REPORT_NO_MATCH' && i.message.includes('首轮记录中 2'))).toBe(true)
  })

  test('未上传回归记录：不通过项照写「经过测试符合要求」+ 告警提示尽量上传回归记录', () => {
    const { outline, first } = parseFixtures()
    const data = buildConfData(outline, first, [], PARAMS)
    expect(data.rows.map(r => r.result)).toEqual(['期望文字甲', '经过测试符合要求', '经过测试符合要求', '未测试'])
    expect(data.stats.firstFail).toBe(2)
    expect(data.stats.regLeft).toBe(2)
    const warn = data.issues.find(i => i.code === 'REPORT_REG_MISSING')
    expect(warn !== undefined && warn.message.includes('建议上传回归测试记录')).toBe(true)
  })

  test('静态/动态分组：表26 只含动态类型；文档审查段落独立统计；2.1 问题按首轮不通过', () => {
    const { outline, first, reg } = parseFixtures()
    const data = buildConfData(outline, first, reg, PARAMS)
    expect(STATIC_TYPES.has('文档审查') && STATIC_TYPES.has('静态分析')).toBe(true)
    // 动态类型 = 功能测试 + 性能测试（静态分析/文档审查不算）
    expect(data.t26Rows.map(r => [r.t26Type, r.t26Total, r.t26Exec, r.t26Unexec, r.t26Pass, r.t26Fail])).toEqual([
      ['功能测试', 1, 1, 0, 0, 1],
      ['性能测试', 1, 0, 1, 0, 0]
    ])
    expect(data.vars.t26STotal).toBe(2)
    expect(data.vars.p244Cases).toBe(2)
    expect(data.vars.p244ExecPhrase).toBe('执行1个、未执行1个')
    expect(data.vars.p244TypeCount).toBe(2)
    // 文档审查（静态，转换层固定 2 步）：设计 2、执行 1、不通过 0
    expect([data.vars.p221Designed, data.vars.p221Exec, data.vars.p221Failed]).toEqual([2, 1, 0])
    // 全量类型清单含静态；用例数（步骤行）6 = 静态 2+2 + 动态 1+1
    expect(data.vars.p173Types).toBe('文档审查、功能测试、静态分析、性能测试')
    expect(data.vars.p173TypeCount).toBe(4)
    expect([data.vars.p173Items, data.vars.p174Cases, data.vars.p23bItems, data.vars.p23cCases]).toEqual([6, 6, 6, 6])
    // 2.1 / 2.3d 问题数 = 首轮不通过步骤行 2；等级/类型默认归类
    expect([data.vars.p21Total, data.vars.p21General, data.vars.p21Other, data.vars.p23dProblems]).toEqual([2, 2, 2, 2])
    // 表33/34：一般×其他 = 2；归零 1 / 遗留 1
    expect([data.vars.q33GeneralOther, data.vars.q33GeneralZero, data.vars.q33GeneralLeft, data.vars.q33SumOther]).toEqual([2, 1, 1, 2])
    expect([data.vars.q34GeneralFunc, data.vars.q34SumFunc, data.vars.q34GeneralZero, data.vars.q34GeneralLeft]).toEqual([1, 1, 1, 1])
    // 表34 固定四列：静态分析的不通过只进总计 → 有告警
    expect(data.issues.some(i => i.code === 'REPORT_T34_UNMATCHED' && i.message.includes('静态分析'))).toBe(true)
    // 表26 导语：有未执行 → 不写「无未执行」
    expect(data.vars.p26NoUnexecText).toBe('另有 1 个用例未执行，见上表未执行列。')
  })

  test('撞号消歧：同 caseId 跨章节两行时按用例名落位（用户质疑"未测试"实证的 bug）', () => {
    // 大纲两个项共用 itemId XQ_A（撞号跨章节），各有一行 caseId YL_A_001 但用例名不同；
    // 记录表「测试用例名称」= 用例名乙 → 必须落到项乙，不能盲取第一行记到项甲头上
    const spec: DocSpec = {
      content: [
        { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
        { kind: 'p', para: { text: '功能测试', heading: 4, numId: 1, ilvl: 3 } },
        { kind: 'tbl', rows: fullItemTable('项甲', 'XQ_A', '《某需求规格说明》3.1 甲', '甲描述。', '1.用例名甲（XQ_A001）\n甲综述。', '1.用例名甲（XQ_A001）\n1）执行操作甲；') },
        { kind: 'p', para: { text: '性能测试', heading: 4, numId: 1, ilvl: 3 } },
        { kind: 'tbl', rows: fullItemTable('项乙', 'XQ_A', '《某需求规格说明》3.2 乙', '乙描述。', '1.用例名乙（XQ_A001）\n乙综述。', '1.用例名乙（XQ_A001）\n1）执行操作乙；') }
      ]
    }
    const outline = extractOutline(buildDocx(spec), new IssueCollector())
    const first = extractRecordCases(buildDocx({
      content: [
        { kind: 'p', para: { text: '测试记录', heading: 1 } },
        recordTable('YL_A_001', '用例名乙', 'XQ_A', ['通过'], '期望文字乙')
      ]
    }), new IssueCollector())
    const data = buildConfData(outline, first, [], PARAMS)
    expect(data.rows.map(r => r.result)).toEqual(['未测试', '期望文字乙'])
    expect(data.stats.untested).toBe(1)
    expect(data.stats.firstPass).toBe(1)
  })

  test('改版漂移重定位：标识指向旧项（名不符），按追踪名+用例名唯一锁定新项', () => {
    // 真实形态（WQ）：旧标识 XQ_SU_PJRT 在新大纲里给了「凭据检索」，旧记录表名/追踪名仍是「关键词检索」
    const spec: DocSpec = {
      content: [
        { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
        { kind: 'p', para: { text: '功能测试', heading: 4, numId: 1, ilvl: 3 } },
        { kind: 'tbl', rows: fullItemTable('凭据检索', 'XQ_PJRT', '隐含需求', '凭据描述。', '1.甲凭据用例（XQ_PJRT001）\n甲综述。', '1.甲凭据用例（XQ_PJRT001）\n1）执行操作甲；') },
        { kind: 'p', para: { text: '性能测试', heading: 4, numId: 1, ilvl: 3 } },
        { kind: 'tbl', rows: fullItemTable('关键词检索', 'XQ_GC', '《某需求规格说明》3.8 关键词检索', '关键词描述。', '1.关键词检索（XQ_GC001）\n关键词综述。', '1.关键词检索（XQ_GC001）\n1）执行操作关键词；') }
      ]
    }
    const outline = extractOutline(buildDocx(spec), new IssueCollector())
    const first = extractRecordCases(buildDocx({
      content: [
        { kind: 'p', para: { text: '测试记录', heading: 1 } },
        recordTable('YL_PJRT_001', '关键词检索', 'XQ_PJRT', ['通过'], '期望文字关键词', '关键词检索')
      ]
    }), new IssueCollector())
    const data = buildConfData(outline, first, [], PARAMS)
    // 记录结果重定位到「关键词检索」；凭据检索不再错收别人的结果
    expect(data.rows.map(r => r.result)).toEqual(['未测试', '期望文字关键词'])
    expect(data.stats.untested).toBe(1)
    expect(data.stats.firstPass).toBe(1)
    const w = data.issues.find(i => i.code === 'REPORT_MATCH_BY_NAME')
    expect(w !== undefined && w.message.includes('凭据检索') && w.message.includes('关键词检索')).toBe(true)
  })

  test('零宽字符不阻断匹配：标识/用例名混入 U+200B 仍按等值命中（同事反馈排查）', () => {
    const spec: DocSpec = {
      content: [
        { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
        { kind: 'p', para: { text: '功能测试', heading: 4, numId: 1, ilvl: 3 } },
        { kind: 'tbl', rows: fullItemTable('项甲', 'XQ_A', '《某需求规格说明》3.1 甲', '甲描述。', '1.用例甲（XQ_A001）\n甲综述。', '1.用例甲（XQ_A001）\n1）执行操作甲；') }
      ]
    }
    const outline = extractOutline(buildDocx(spec), new IssueCollector())
    const ZW = String.fromCharCode(0x200b)
    const first = extractRecordCases(buildDocx({
      content: [
        { kind: 'p', para: { text: '测试记录', heading: 1 } },
        recordTable('YL' + ZW + '_A_001', '用例' + ZW + '甲', 'XQ_A', ['通过'], '期望文字甲')
      ]
    }), new IssueCollector())
    const data = buildConfData(outline, first, [], PARAMS)
    expect(data.rows.map(r => r.result)).toEqual(['期望文字甲'])
    expect(data.stats.untested).toBe(0)
  })

  test('撞号且用例名对不上：回退首行 + REPORT_DUP_CASEID 点名（原静默错配盲区）', () => {
    // 同事反馈「实际有测试却显示未测试」的可达形态：标识撞号、名称消歧落空 → 结果记到回退行、被挤掉的项凭空未测试
    const spec: DocSpec = {
      content: [
        { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
        { kind: 'p', para: { text: '功能测试', heading: 4, numId: 1, ilvl: 3 } },
        { kind: 'tbl', rows: fullItemTable('项甲', 'XQ_A', '《某需求规格说明》3.1 甲', '甲描述。', '1.用例名甲（XQ_A001）\n甲综述。', '1.用例名甲（XQ_A001）\n1）执行操作甲；') },
        { kind: 'p', para: { text: '性能测试', heading: 4, numId: 1, ilvl: 3 } },
        { kind: 'tbl', rows: fullItemTable('项乙', 'XQ_A', '《某需求规格说明》3.2 乙', '乙描述。', '1.用例名乙（XQ_A001）\n乙综述。', '1.用例名乙（XQ_A001）\n1）执行操作乙；') }
      ]
    }
    const outline = extractOutline(buildDocx(spec), new IssueCollector())
    const first = extractRecordCases(buildDocx({
      content: [
        { kind: 'p', para: { text: '测试记录', heading: 1 } },
        recordTable('YL_A_001', '与两行都不同的用例名', 'XQ_A', ['通过'], '期望文字X')
      ]
    }), new IssueCollector())
    const data = buildConfData(outline, first, [], PARAMS)
    expect(data.rows.map(r => r.result)).toEqual(['期望文字X', '未测试'])
    const w = data.issues.find(i => i.code === 'REPORT_DUP_CASEID')
    expect(w !== undefined && w.message.includes('2 行') && w.message.includes('项甲') && w.message.includes('未测试')).toBe(true)
  })

  test('标识多子项段（同事习惯 YL_SU_STJS_SU01_001）：删段按用例名对齐到同项用例', () => {
    // 2026-11-27 同事揭晓根因：记录用例标识比大纲多一段子项号（SU01），精确/去尾号都够不着
    // → matchRow 段级对齐（删段候选须同落一个大纲基形）+ 用例名消歧，工具三同享
    const spec: DocSpec = {
      content: [
        { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
        { kind: 'p', para: { text: '功能测试', heading: 4, numId: 1, ilvl: 3 } },
        { kind: 'tbl', rows: fullItemTable('检索测试', 'XQ_SU_STJS', '《某需求规格说明》3.1 检索', '检索需求描述原文。', '1.检索正常（XQ_SU_STJS_SU01）\n检索正常综述。\n2.检索异常（XQ_SU_STJS_SU02）\n检索异常综述。', '1.检索正常（XQ_SU_STJS_SU01）\n1）执行操作，查看结果是否正确；\n2.检索异常（XQ_SU_STJS_SU02）\n1）执行异常操作，查看结果是否正确；') }
      ]
    }
    const outline = extractOutline(buildDocx(spec), new IssueCollector())
    const first = extractRecordCases(buildDocx({
      content: [
        { kind: 'p', para: { text: '测试记录', heading: 1 } },
        recordTable('YL_SU_STJS_SU01_001', '检索正常', 'XQ_SU_STJS', ['通过'], '期望文字检索', '检索测试')
      ]
    }), new IssueCollector())
    const data = buildConfData(outline, first, [], PARAMS)
    // 段级对齐前 matchRow 落空 → 该项凭空「未测试」；现在按用例名落到检索正常这例，项级结果取记录期望文字
    expect(data.rows.map(r => r.result)).toEqual(['期望文字检索'])
    expect(data.stats.untested).toBe(0)
    expect(data.stats.firstPass).toBe(1)
  })

  test('两子项两张表（IO01/IO02 同用例名）：子项号序数落位 + REPORT_SEG_MATCH 点名', () => {
    // 同事口径（2026-11-27）：一个测试项 2 个子项 = 2 张用例表（YL_IO_RWGL_IO01_001 / IO02_001），
    // 子项号 = 大纲该测试项用例序；用例名对不上时按序数落位并点名请核对
    const spec: DocSpec = {
      content: [
        { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
        { kind: 'p', para: { text: '功能测试', heading: 4, numId: 1, ilvl: 3 } },
        { kind: 'tbl', rows: fullItemTable('读写管理测试', 'XQ_IO_RWGL', '《某需求规格说明》3.1 读写', '读写需求描述原文。', '1.读写管理（XQ_IO_RWGL01）\n综述。\n2.读写管理（XQ_IO_RWGL02）\n综述。', '1.读写管理（XQ_IO_RWGL01）\n1）执行操作，查看结果是否正确；\n2.读写管理（XQ_IO_RWGL02）\n1）执行操作，查看结果是否正确；') }
      ]
    }
    const outline = extractOutline(buildDocx(spec), new IssueCollector())
    const first = extractRecordCases(buildDocx({
      content: [
        { kind: 'p', para: { text: '测试记录', heading: 1 } },
        recordTable('YL_IO_RWGL_IO01_001', '同事随手写的名', 'XQ_IO_RWGL', ['通过'], '期望文字读', '读写管理测试'),
        recordTable('YL_IO_RWGL_IO02_001', '同事随手写的名', 'XQ_IO_RWGL', ['通过'], '期望文字写', '读写管理测试')
      ]
    }), new IssueCollector())
    const data = buildConfData(outline, first, [], PARAMS)
    expect(data.stats.untested).toBe(0)
    expect(data.stats.firstPass).toBe(1)
    const warns = data.issues.filter(i => i.code === 'REPORT_SEG_MATCH')
    expect(warns.length).toBe(2)
    expect(warns.some(w => w.message.includes('第 1 个用例（YL_IO_RWGL_001）'))).toBe(true)
    expect(warns.some(w => w.message.includes('第 2 个用例（YL_IO_RWGL_002）'))).toBe(true)
  })

  test('大纲用例标题带子项标识（XQ_IO_RWGL_IO01）：硬键落位，用例名对不上也不再猜', () => {
    // 大纲标题的用例级标识派生硬键：XQ_IO_RWGL_IO01 → YL_IO_RWGL_IO01，与记录标识严丝合缝
    const spec: DocSpec = {
      content: [
        { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
        { kind: 'p', para: { text: '功能测试', heading: 4, numId: 1, ilvl: 3 } },
        { kind: 'tbl', rows: fullItemTable('读写管理测试', 'XQ_IO_RWGL', '《某需求规格说明》3.1 读写', '读写需求描述原文。', '1.读写管理（XQ_IO_RWGL_IO01）\n综述。\n2.读写管理（XQ_IO_RWGL_IO02）\n综述。', '1.读写管理（XQ_IO_RWGL_IO01）\n1）执行操作，查看结果是否正确；\n2.读写管理（XQ_IO_RWGL_IO02）\n1）执行操作，查看结果是否正确；') }
      ]
    }
    const outline = extractOutline(buildDocx(spec), new IssueCollector())
    const first = extractRecordCases(buildDocx({
      content: [
        { kind: 'p', para: { text: '测试记录', heading: 1 } },
        recordTable('YL_IO_RWGL_IO01_001', '同事随手写的名', 'XQ_IO_RWGL', ['通过'], '期望文字读', '读写管理测试'),
        recordTable('YL_IO_RWGL_IO02_001', '同事随手写的名', 'XQ_IO_RWGL', ['未通过'], '期望文字写', '读写管理测试')
      ]
    }), new IssueCollector())
    const data = buildConfData(outline, first, [], PARAMS)
    // 硬键严丝合缝 → 静默落位，无猜测性告警；第二表未通过 → 首轮未通过
    expect(data.stats.untested).toBe(0)
    expect(data.stats.firstFail).toBe(1)
    expect(data.issues.some(i => i.code === 'REPORT_SEG_MATCH')).toBe(false)
  })

  test('记录类型码与大纲不同（YL_DC3_001 ↔ YL_DC_001）：追踪行测试项名称兜底计数，隐含需求格不再点名', () => {
    // 同事形态（2026-11-28 实测大纲）：记录标识类型码与大纲不一致，caseId 路线全断；
    // 追踪行的测试项名称定位到唯一测试项 → 单用例直接落位，不再凭空「未测试」。
    // 静态类追踪关系写「隐含需求」是合法形态 → 不再出 TRACE_REL_UNPARSED
    const spec: DocSpec = {
      content: [
        { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
        { kind: 'p', para: { text: '文档审查', heading: 4, numId: 1, ilvl: 3 } },
        { kind: 'tbl', rows: fullItemTable('文档审查', 'XQ_DC', '隐含需求', '--', '1.用例丁（XQ_DC001）\n用例丁综述。', '1.用例丁（XQ_DC001）\n1）执行操作丁，查看结果是否正确；') }
      ]
    }
    const issO = new IssueCollector()
    const outline = extractOutline(buildDocx(spec), issO)
    expect(issO.issues.some(i => i.code === 'TRACE_REL_UNPARSED')).toBe(false)
    expect(outline.items[0].traceSrs).toEqual({ chapter: '/', desc: '隐含需求' })
    const first = extractRecordCases(buildDocx({
      content: [
        { kind: 'p', para: { text: '测试记录', heading: 1 } },
        recordTable('YL_DC3_001', '用例丁', 'XQ_DC3', ['通过'], '期望文字丁', '文档审查')
      ]
    }), new IssueCollector())
    const data = buildConfData(outline, first, [], PARAMS)
    expect(data.stats.untested).toBe(0)
    expect(data.stats.firstPass).toBe(1)
    // 单用例测试项 + 名称唯一 = 强证据 → 静默落位；名称/剥序号名/序数落位的点名口径见 REGRESS/REPORT_ITEM_MATCH
    expect(data.issues.some(i => i.code === 'REPORT_DUP_CASEID')).toBe(false)
  })

  test('记录表少于大纲用例：REPORT_COVERAGE 显性提示（解析漏表防线）', () => {
    const { outline, first } = parseFixtures()
    const data = buildConfData(outline, first.slice(0, 2), [], PARAMS)
    const cov = data.issues.find(i => i.code === 'REPORT_COVERAGE')
    expect(cov !== undefined && cov.message.includes('记录只有 2 张')).toBe(true)
    expect(data.stats.untested).toBe(2)
  })

  test('需求描述超长：smart 省略流程段 + DESC_LONG 提示；clip/full 模式可选', () => {
    // 项乙需求描述 = 概述 + 「处理流程如下：」 + 超长流程步骤（>400 字触发精简）
    const spec: DocSpec = {
      content: [
        { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
        { kind: 'p', para: { text: '功能测试', heading: 4, numId: 1, ilvl: 3 } },
        { kind: 'tbl', rows: fullItemTable('项甲', 'XQ_A', '《某需求规格说明》3.1 甲', '该功能用于核验甲能力。', '1.用例甲（XQ_A001）\n甲综述。', '1.用例甲（XQ_A001）\n1）执行操作甲；') },
        { kind: 'p', para: { text: '性能测试', heading: 4, numId: 1, ilvl: 3 } },
        { kind: 'tbl', rows: fullItemTable('项乙', 'XQ_B', '《某需求规格说明》3.2 乙',
          '乙功能概述如下。\n处理流程如下：\n1）用户输入乙数据；\n' + '2）系统执行乙处理并回显结果；\n'.repeat(60),
          '1.用例乙（XQ_B001）\n乙综述。', '1.用例乙（XQ_B001）\n1）执行操作乙；') }
      ]
    }
    const outline = extractOutline(buildDocx(spec), new IssueCollector())
    const first = extractRecordCases(buildDocx({
      content: [
        { kind: 'p', para: { text: '测试记录', heading: 1 } },
        recordTable('YL_A_001', '用例甲', 'XQ_A', ['通过'], '期望文字甲'),
        recordTable('YL_B_001', '用例乙', 'XQ_B', ['通过'], '期望文字乙')
      ]
    }), new IssueCollector())
    const smart = buildConfData(outline, first, [], PARAMS)
    expect(smart.rows[0].metric).toBe('该功能用于核验甲能力。')
    expect(smart.rows[1].metric).toBe('乙功能概述如下。\n……（已省略处理流程等内容，保留需求关键描述，全文详见需求规格说明）')
    expect(smart.issues.some(i => i.code === 'REPORT_DESC_LONG' && i.message.includes('智能精简'))).toBe(true)
    // clip 模式（v1 原行为）：不认流程段头，按 400 字截断
    const clip = buildConfData(outline, first, [], PARAMS, 'clip')
    expect(clip.rows[1].metric.includes('处理流程如下')).toBe(true)
    expect(clip.rows[1].metric.includes('（内容过长，已截断')).toBe(true)
    // full 模式：全文照排不精简
    const full = buildConfData(outline, first, [], PARAMS, 'full')
    expect(full.rows[1].metric.includes('处理流程如下')).toBe(true)
    expect(full.rows[1].metric.includes('已省略')).toBe(false)
    expect(full.rows[1].metric.includes('（内容过长')).toBe(false)
  })

  test('智能精简真实形态：『项名』的处理流程：段头 + 段内嵌过程句；无段头「流程从…开讲」', () => {
    // 真实大纲主流形态（128 个超长描述校准）：段头带项名前缀「变量名恢复的处理流程：」，
    // 且首段需求句里混写过程叙述（该功能首先校验…若文件非法…）——只留需求关键句
    const spec: DocSpec = {
      content: [
        { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
        { kind: 'p', para: { text: '功能测试', heading: 4, numId: 1, ilvl: 3 } },
        { kind: 'tbl', rows: fullItemTable('项甲', 'XQ_A', '《某需求规格说明》3.1 甲',
          '能将给定二进制函数中的变量恢复为有明确含义的名称。该功能首先校验文件是否为合法二进制格式。若文件非法，系统直接输出错误提示并结束流程。变量名恢复的处理流程：\n1.获取伪代码及变量上下文。\n2.输出推断依据。',
          '1.用例甲（XQ_A001）\n甲综述。', '1.用例甲（XQ_A001）\n1）执行操作甲；') },
        { kind: 'p', para: { text: '性能测试', heading: 4, numId: 1, ilvl: 3 } },
        { kind: 'tbl', rows: fullItemTable('项乙', 'XQ_B', '《某需求规格说明》3.2 乙',
          'XX组件推荐功能用于将需求描述解析为结构化表示并生成推荐结果。流程从需求文本接收开始，首先进行初步解析，直至生成推荐结果或流程结束。用户需求进入子系统后被转交至推荐模块。',
          '1.用例乙（XQ_B001）\n乙综述。', '1.用例乙（XQ_B001）\n1）执行操作乙；') },
        { kind: 'p', para: { text: '文档审查', heading: 4, numId: 1, ilvl: 3 } },
        { kind: 'tbl', rows: fullItemTable('项丙', 'XQ_C', '《某需求规格说明》3.3 丙',
          'Escalation 战术抽取能从恶意样本中围绕权限提升相关的代码模块，输出该战术相关的函数地址、摘要描述与对应的源码形态信息Privilege Escalation战术语义规范的处理流程：(1)通过深度学习分析提取技术语义。',
          '1.用例丙（XQ_C001）\n丙综述。', '1.用例丙（XQ_C001）\n1）执行操作丙；') }
      ]
    }
    const outline = extractOutline(buildDocx(spec), new IssueCollector())
    const first = extractRecordCases(buildDocx({
      content: [
        { kind: 'p', para: { text: '测试记录', heading: 1 } },
        recordTable('YL_A_001', '用例甲', 'XQ_A', ['通过'], '期望文字甲'),
        recordTable('YL_B_001', '用例乙', 'XQ_B', ['通过'], '期望文字乙'),
        recordTable('YL_C_001', '用例丙', 'XQ_C', ['通过'], '期望文字丙')
      ]
    }), new IssueCollector())
    const data = buildConfData(outline, first, [], PARAMS)
    // 项甲：段头截断 + 过程句剔除，只剩能力句
    expect(data.rows[0].metric).toBe('能将给定二进制函数中的变量恢复为有明确含义的名称。\n……（已省略处理流程等内容，保留需求关键描述，全文详见需求规格说明）')
    // 项乙：无段头「流程从…开讲」也算流程段，只留需求句
    expect(data.rows[1].metric).toBe('XX组件推荐功能用于将需求描述解析为结构化表示并生成推荐结果。\n……（已省略处理流程等内容，保留需求关键描述，全文详见需求规格说明）')
    // 项丙：英文前缀超长混排段头（真实残留形态）——截到段头名起点，需求枚举完整保留
    expect(data.rows[2].metric).toBe('Escalation 战术抽取能从恶意样本中围绕权限提升相关的代码模块，输出该战术相关的函数地址、摘要描述与对应的源码形态信息。\n……（已省略处理流程等内容，保留需求关键描述，全文详见需求规格说明）')
  })

  test('智能精简异常形态：图题句/指针句是流程起点；「流程」开头的需求段不误切；短行精简也点名', () => {
    const spec: DocSpec = {
      content: [
        { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
        { kind: 'p', para: { text: '功能测试', heading: 4, numId: 1, ilvl: 3 } },
        { kind: 'tbl', rows: fullItemTable('项甲', 'XQ_A', '《某需求规格说明》3.1 甲',
          '问答引擎子功能负责接收用户问题并生成精准答案。该功能主要流程如下图所示：\n1.接收用户问题。\n2.生成答案。',
          '1.用例甲（XQ_A001）\n甲综述。', '1.用例甲（XQ_A001）\n1）执行操作甲；') },
        { kind: 'p', para: { text: '性能测试', heading: 4, numId: 1, ilvl: 3 } },
        { kind: 'tbl', rows: fullItemTable('项乙', 'XQ_B', '《某需求规格说明》3.2 乙',
          '支持生产任务的分配与检索。提交协同生产任务子功能的工作流程如图所示。\n首先用户提交任务，随后系统流转。',
          '1.用例乙（XQ_B001）\n乙综述。', '1.用例乙（XQ_B001）\n1）执行操作乙；') },
        { kind: 'p', para: { text: '文档审查', heading: 4, numId: 1, ilvl: 3 } },
        { kind: 'tbl', rows: fullItemTable('项丙', 'XQ_C', '《某需求规格说明》3.3 丙',
          '流程管理功能应支持配置导出与全流程追溯。系统应提供审批能力。',
          '1.用例丙（XQ_C001）\n丙综述。', '1.用例丙（XQ_C001）\n1）执行操作丙；') },
        { kind: 'p', para: { text: '静态分析', heading: 4, numId: 1, ilvl: 3 } },
        { kind: 'tbl', rows: fullItemTable('项丁', 'XQ_D', '《某需求规格说明》3.4 丁',
          '系统对文档内容进行解析与结构化整理。\n处理流程需求\n(1) 文档接入与识别。',
          '1.用例丁（XQ_D001）\n丁综述。', '1.用例丁（XQ_D001）\n1）执行操作丁；') },
        { kind: 'p', para: { text: '人机交互界面测试', heading: 4, numId: 1, ilvl: 3 } },
        { kind: 'tbl', rows: fullItemTable('项戊', 'XQ_E', '《某需求规格说明》3.5 戊',
          '用户发起请求后，系统根据请求判断是否进行记录查询操作，最终将分析结果返回给用户。该功能主要流程如下图所示：\n系统首先解析请求内容，随后执行任务。',
          '1.用例戊（XQ_E001）\n戊综述。', '1.用例戊（XQ_E001）\n1）执行操作戊；') }
      ]
    }
    const outline = extractOutline(buildDocx(spec), new IssueCollector())
    const first = extractRecordCases(buildDocx({
      content: [
        { kind: 'p', para: { text: '测试记录', heading: 1 } },
        recordTable('YL_A_001', '用例甲', 'XQ_A', ['通过'], '期望文字甲'),
        recordTable('YL_B_001', '用例乙', 'XQ_B', ['通过'], '期望文字乙'),
        recordTable('YL_C_001', '用例丙', 'XQ_C', ['通过'], '期望文字丙'),
        recordTable('YL_D_001', '用例丁', 'XQ_D', ['通过'], '期望文字丁'),
        recordTable('YL_E_001', '用例戊', 'XQ_E', ['通过'], '期望文字戊')
      ]
    }), new IssueCollector())
    const data = buildConfData(outline, first, [], PARAMS)
    // 项甲：图题句「主要流程如下图所示：」即流程起点——表38 无图，指图句不悬空留在正文
    expect(data.rows[0].metric).toBe('问答引擎子功能负责接收用户问题并生成精准答案。\n……（已省略处理流程等内容，保留需求关键描述，全文详见需求规格说明）')
    // 项乙：句号式指针句「…工作流程如图所示。」也是流程起点
    expect(data.rows[1].metric).toBe('支持生产任务的分配与检索。\n……（已省略处理流程等内容，保留需求关键描述，全文详见需求规格说明）')
    // 项丙：以「流程」开头的需求段不是段头（PROCESS 行尾锚定），短文原样保留
    expect(data.rows[2].metric).toBe('流程管理功能应支持配置导出与全流程追溯。系统应提供审批能力。')
    // 项丁：无标点裸行段头「处理流程需求」（真实形态）也是流程起点
    expect(data.rows[3].metric).toBe('系统对文档内容进行解析与结构化整理。\n……（已省略处理流程等内容，保留需求关键描述，全文详见需求规格说明）')
    // 项戊：句级判定一句不剩时保住流程截断后的主体原文（真实形态「交互管理功能测试」），不回退整段
    expect(data.rows[4].metric).toBe('用户发起请求后，系统根据请求判断是否进行记录查询操作，最终将分析结果返回给用户。\n……（已省略处理流程等内容，保留需求关键描述，全文详见需求规格说明）')
    // 实际被精简的行逐项点名（含 <400 字的短行），未动的项丙不点名
    const dl = data.issues.find(i => i.code === 'REPORT_DESC_LONG')
    const ctx = dl?.context ?? ''
    expect(dl !== undefined && ctx.includes('项甲') && ctx.includes('项乙') && !ctx.includes('项丙')).toBe(true)
  })

  test('图片引用提示：需求描述/记录期望结果含「如图/见图」分别点名（表38 无图）', () => {
    const spec: DocSpec = {
      content: [
        { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
        { kind: 'p', para: { text: '功能测试', heading: 4, numId: 1, ilvl: 3 } },
        { kind: 'tbl', rows: fullItemTable('项甲', 'XQ_A', '《某需求规格说明》3.1 甲', '系统界面如图3-1所示，支持甲功能。', '1.用例甲（XQ_A001）\n甲综述。', '1.用例甲（XQ_A001）\n1）执行操作甲；') }
      ]
    }
    const outline = extractOutline(buildDocx(spec), new IssueCollector())
    const first = extractRecordCases(buildDocx({
      content: [
        { kind: 'p', para: { text: '测试记录', heading: 1 } },
        recordTable('YL_A_001', '用例甲', 'XQ_A', ['通过'], '实测界面见图5-2')
      ]
    }), new IssueCollector())
    const data = buildConfData(outline, first, [], PARAMS)
    expect(data.rows[0].metric).toBe('系统界面如图3-1所示，支持甲功能。')
    expect(data.rows[0].result).toBe('实测界面见图5-2')
    const figreq = data.issues.find(i => i.code === 'REPORT_FIG_REQ')
    expect(figreq !== undefined && (figreq.context ?? '').includes('项甲')).toBe(true)
    expect(data.issues.some(i => i.code === 'REPORT_FIG_RESULT' && i.message.includes('人工改写'))).toBe(true)
  })

  test('列3 超长精简：按段落边界截断并标记省略；短文原样', () => {
    const { outline, first, reg } = parseFixtures()
    const data = buildConfData(outline, first, reg, PARAMS)
    const m = data.rows[3].metric
    expect(m.includes('（内容过长，已截断')).toBe(true)
    expect(m.includes('丙')).toBe(false)
    expect(m.split('\n').length).toBeLessThanOrEqual(3)
  })
})

describe('M10 /api/report 端到端', () => {
  const server = Bun.serve({ port: 0, fetch: handle })
  const base = server.url.toString().replace(/\/$/, '')

  test('上传大纲 + 首轮记录 + 回归记录 → 全批注产物断言', async () => {
    const fd = new FormData()
    fd.append('outlineFile', new File([new Uint8Array(buildDocxBuffer(outlineSpec()))], '合成测试大纲.docx'))
    fd.append('recordFile', new File([new Uint8Array(buildDocxBuffer(firstRecordSpec()))], '合成首轮记录.docx'))
    fd.append('regFile', new File([new Uint8Array(buildDocxBuffer(regRecordSpec()))], '合成回归记录.docx'))
    const r = await (await fetch(base + '/api/report/generate', { method: 'POST', body: fd })).json() as any
    expect(r.ok).toBe(true)
    expect(r.files[0].name).toBe('软件测评报告-生成.docx')
    expect(r.stats.failedSteps).toBe(2)

    const zip = (PizZip as any)(Buffer.from(r.files[0].doc, 'base64')) as PizZip
    const xml = zip.file('word/document.xml')!.asText() as string
    const text = xml.replace(/<[^>]+>/g, '')
    // 无未解析占位符
    expect(/\{[#/a-zA-Z]/.test(text)).toBe(false)
    // 段落统计：用例=步骤行（6，静态固定 2 步），问题=首轮不通过（2），类型清单动态两态
    expect(text).toContain('共分析6个测试项')
    expect(text).toContain('共设计用例6个')
    expect(text).toContain('共发现2个问题')
    expect(text).toContain('一般问题2个')
    expect(text).toContain('其他问题2个')
    expect(text).toContain('首轮文档审查共设计测试用例2个，执行1个，不通过0个')
    expect(text).toContain('第一轮动态测试共设计用例2个，执行1个、未执行1个')
    expect(text).toContain('测试类型包含功能测试、性能测试等2种测试类型')
    expect(text).toContain('共发现2软件问题')
    // 表26：功能测试行 + 小计 + 未执行导语
    expect(text).toContain('功能测试11001')
    expect(text).toContain('小计21101')
    expect(text).toContain('另有 1 个用例未执行')
    // 表38 列4：通过=记录文字；不通过=经过测试符合要求；未测试
    expect(text).toContain('期望文字甲')
    expect(text).toContain('经过测试符合要求')
    expect(text).toContain('未测试')
    // 换行是真回车段落（产物零软换行 br）；产物不带批注
    expect(xml.includes('<w:br/>')).toBe(false)
    expect(xml.includes('commentReference')).toBe(false)
    expect(zip.file('word/comments.xml')).toBe(null)
  })

  test('无回归记录通道：未通过项写「经过测试符合要求」+ REG_MISSING 告警', async () => {
    const fd = new FormData()
    fd.append('outlineFile', new File([new Uint8Array(buildDocxBuffer(outlineSpec()))], '合成测试大纲.docx'))
    fd.append('recordFile', new File([new Uint8Array(buildDocxBuffer(firstRecordSpec()))], '合成首轮记录.docx'))
    const r = await (await fetch(base + '/api/report/generate', { method: 'POST', body: fd })).json() as any
    expect(r.ok).toBe(true)
    expect(r.stats.firstFail).toBe(2)
    expect(r.issues.some((i: any) => i.code === 'REPORT_REG_MISSING')).toBe(true)
    const text2 = ((PizZip as any)(Buffer.from(r.files[0].doc, 'base64')) as PizZip).file('word/document.xml')!.asText() as string
    expect(text2.replace(/<[^>]+>/g, '')).toContain('经过测试符合要求')
    expect((text2.match(/经过测试符合要求/g) ?? []).length).toBe(2)
  })

  test('记录项目不得在工具一按大纲打开（跨工具污染防御）', async () => {
    // 报告生成的现场上传会自动把记录建档进项目库；工具一的 open 必须拒绝它而不是裸 ENOENT
    const projects = await (await fetch(base + '/api/projects')).json() as any
    const recProj = projects.projects.find((p: any) => p.sourceType === 'record' && p.name === '合成首轮记录.docx')
    expect(recProj !== undefined).toBe(true)
    const openRes = await (await fetch(base + '/api/projects/open', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: recProj.id })
    })).json() as any
    expect(openRes.ok).toBe(false)
    expect(openRes.error).toContain('该项目不是测试大纲')
  })

  test('缺大纲 / 缺首轮记录 → 400', async () => {
    const fd = new FormData()
    fd.append('recordFile', new File([new Uint8Array(buildDocxBuffer(firstRecordSpec()))], '合成首轮记录.docx'))
    const r = await (await fetch(base + '/api/report/generate', { method: 'POST', body: fd })).json() as any
    expect(r.ok).toBe(false)
    expect(r.error).toContain('测试大纲')

    const fd2 = new FormData()
    fd2.append('outlineFile', new File([new Uint8Array(buildDocxBuffer(outlineSpec()))], '合成测试大纲.docx'))
    const r2 = await (await fetch(base + '/api/report/generate', { method: 'POST', body: fd2 })).json() as any
    expect(r2.ok).toBe(false)
    expect(r2.error).toContain('首轮测试记录')
  })
})

describe('M10 模板守门', () => {
  test('报告模板：批注铺开标签齐全、批注剥净、打包清单已登记', () => {
    const zip = (PizZip as any)(readFileSync('模板/报告模板.docx')) as PizZip
    const xml = zip.file('word/document.xml')!.asText() as string
    // 表38 行内循环
    expect(xml.includes('{#confRows}{no}')).toBe(true)
    expect(xml.includes('{result}{/}')).toBe(true)
    // 段落统计标签（v2 批注铺开）
    for (const m of ['{p173Types}', '{p174Cases}', '{p21Total}', '{p221Designed}', '{p244Cases}', '{p23bTypes}', '{p23cCases}', '{p23dProblems}', '{p26NoUnexecText}']) {
      expect(xml.includes(m)).toBe(true)
    }
    // 表26 循环 + 小计；表33/34 交叉格
    for (const m of ['{#t26Rows}', '{t26STotal}', '{q33GeneralOther}', '{q33SumLeft}', '{q34GeneralFunc}', '{q34SumZero}']) {
      expect(xml.includes(m)).toBe(true)
    }
    expect(xml.includes('commentReference')).toBe(false)
    expect(zip.file('word/comments.xml')).toBe(null)
    // 打包清单登记（exe 内嵌守门，m0 同款口径）
    const pack = readFileSync('scripts/打包.ts', 'utf8')
    expect(pack.includes("'报告模板.docx'")).toBe(true)
  })
})
