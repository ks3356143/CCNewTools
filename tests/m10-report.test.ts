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
