import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import PizZip from 'pizzip'
import { DOMParser } from '@xmldom/xmldom'
import { buildDocxBuffer, buildDocx, DESC, METHOD, type Cell, type DocSpec } from './helpers/ooxml.ts'
import { handle } from '../src/server/app.ts'
import { extractOutline } from '../src/core/parse/outline.ts'
import { extractRecordCases } from '../src/core/parse/record.ts'
import { selectRegressCases, buildRegressData } from '../src/core/regress/build.ts'
import { DEFAULT_PARAMS, IssueCollector, type GlobalParams } from '../src/core/domain.ts'
import type { RecordCase } from '../src/core/parse/record.ts'

/** M9 回归测试说明工具（F11/13 号设计）：三级容差匹配 + 渲染数据 + /api/regress 端到端 */

beforeAll(() => {
  process.env.CC_DATA_DIR = mkdtempSync(join(tmpdir(), 'cc-m9-'))
})

const PARAMS: GlobalParams = { ...DEFAULT_PARAMS, tester: '张三', monitor: '李四', timeStart: '2026-11-01', timeEnd: '2026-11-05' }

/** 测试项表（六列首行 + 优先级/追踪关系/需求描述原文行） */
function fullItemTable(name: string, itemId: string, priority: string, trace: string, reqDesc: string, extraRows: Cell[][]): Cell[][] {
  return [
    [{ text: '测试项名称' }, { text: name }, { text: '测试项标识' }, { text: itemId }, { text: '优先级' }, { text: priority }],
    [{ text: '追踪关系' }, { text: trace }],
    [{ text: '需求描述' }, { text: reqDesc }],
    ...extraRows
  ]
}

/** 合成大纲：三个类型各一个测试项；功能测试项含两个用例 */
function outlineSpec(): DocSpec {
  return {
    content: [
      { kind: 'p', para: { text: '测试项及方法', heading: 2, numId: 1, ilvl: 1 } },
      { kind: 'p', para: { text: '文档审查', heading: 4, numId: 1, ilvl: 3 } },
      {
        kind: 'tbl',
        rows: fullItemTable('文档审查', 'XQ_DC', '高', '隐含需求', '--', [
          [DESC, '1.文档审查（XQ_DC_DC001）\n文档审查综述。'],
          [METHOD, '1.文档审查（XQ_DC_DC001）\n1）人工阅读文档，查看描述是否一致；']
        ])
      },
      { kind: 'p', para: { text: '功能测试', heading: 4, numId: 1, ilvl: 3 } },
      {
        kind: 'tbl',
        rows: fullItemTable('功能项一', 'XQ_A_B', '高', '《某需求规格说明》4.4 功能一', '功能一需求描述原文', [
          [DESC, '1.用例一（XQ_A_B001）\n用例一综述。\n2.用例二（XQ_A_B002）\n用例二综述。'],
          [METHOD, '1.用例一（XQ_A_B001）\n1）执行操作一，查看结果是否正确；\n2.用例二（XQ_A_B002）\n1）执行操作二，查看结果是否正确；']
        ])
      },
      { kind: 'p', para: { text: '静态分析', heading: 4, numId: 1, ilvl: 3 } },
      {
        kind: 'tbl',
        rows: fullItemTable('静态分析', 'XQ_E_F', '', '隐含需求', '--', [
          [DESC, '1.静态分析（XQ_E_F001）\n静态分析综述。'],
          [METHOD, '1.静态分析（XQ_E_F001）\n1）运行分析工具，查看报告是否生成；']
        ])
      }
    ]
  }
}
function sampleOutline(): Buffer {
  return buildDocxBuffer(outlineSpec())
}

/** 用例记录表（追踪行可自定义——测试需求的标识决定兜底匹配路径；章节号/执行状态可覆盖做纠错夹具） */
function recordTable(
  caseId: string,
  caseName: string,
  traceItemId: string,
  results: string[],
  opts: { chapter?: string; executed?: string } = {}
): { kind: 'tbl'; rows: Cell[][] } {
  const chapter = opts.chapter ?? '1.1.1.1'
  const executed = opts.executed ?? '已执行'
  return {
    kind: 'tbl',
    rows: [
      [{ text: '' }],
      [{ text: '测试用例名称' }, { text: caseName }, { text: '标   识' }, { text: caseId }],
      [{ text: '追踪关系' }, { text: '软件测试依据：软件测评大纲\n测试需求分析：' + chapter + ' 某测试项\n测试需求标识：' + traceItemId }],
      [{ text: '测试步骤' }],
      [{ text: '序号' }, { text: '输入及操作' }, { text: '期望结果与评估标准' }, { text: '实测结果' }, { text: '通过与否' }],
      ...results.map((r, i) => [{ text: String(i + 1) }, { text: '执行操作' + (i + 1) }, { text: '结果正确' }, { text: '' }, { text: r }]),
      [{ text: '执行状态' }, { text: executed }, { text: '测试时间' }, { text: '2026-08-18' }],
      [{ text: '测试人员' }, { text: '张三' }, { text: '监测人员' }, { text: '李四' }],
      [{ text: '问题单标识' }, { text: '/' }],
      [{ text: '备注' }, { text: '/' }]
    ]
  }
}

/** 合成记录：YL_DC 无尾号（前缀匹配）YL_A_B_001 精确、YL_A_B_002 也失败、YL_ANY 走单用例兜底、YL_GHOST 匹配不上。
 *  步骤数与大纲转换行对齐（静态转换是固定 2 步），基线草稿不带步骤数告警 */
function recordSpec(): DocSpec {
  return {
    content: [
      { kind: 'p', para: { text: '测试记录', heading: 1 } },
      { kind: 'p', para: { text: '功能测试', heading: 2 } },
      recordTable('YL_DC', '文档审查', 'XQ_DC', ['未通过', '通过']),
      recordTable('YL_A_B_001', '用例一', 'XQ_A_B', ['不通过']),
      recordTable('YL_A_B_002', '用例二', 'XQ_A_B', ['未通过']),
      recordTable('YL_ANY', '静态分析', 'XQ_E_F', ['未通过', '通过']),
      recordTable('YL_GHOST', '幽灵用例', 'XQ_ZZ', ['未通过'])
    ]
  }
}
function sampleRecord(): Buffer {
  return buildDocxBuffer(recordSpec())
}

function parseFixtures(): { records: RecordCase[]; outline: ReturnType<typeof extractOutline> } {
  const iss = new IssueCollector()
  const outline = extractOutline(buildDocx(outlineSpec()), iss)
  const records = extractRecordCases(buildDocx(recordSpec()), new IssueCollector())
  return { outline, records }
}

describe('M9 选择与数据组装', () => {
  test('三级容差匹配：精确 / 去尾号前缀 / 单用例测试项兜底；全通过用例不入草稿', () => {
    const { outline, records } = parseFixtures()
    expect(records.length).toBe(5)
    const draft = selectRegressCases(outline, records, PARAMS)
    // 幽灵用例对不上大纲 → 告警并默认排除
    expect(draft.stats).toEqual({ recordCases: 5, failed: 5, matched: 4 })
    expect(draft.unmatched.map(u => u.recordCaseId)).toEqual(['YL_GHOST'])
    expect(draft.issues.some(i => i.code === 'REGRESS_NO_MATCH')).toBe(true)
    // 基线全部为测试项级合法标识 → ID 不一致告警应为 0（用例级形态的合法性由真实 WQ 记录实证）
    expect(draft.issues.filter(i => i.code === 'REGRESS_ITEM_ID_MISMATCH').length).toBe(0)
    // 类型序 = 大纲测试项序；reqChapter 与 4.1.x 自动编号同序
    expect(draft.types.map(t => [t.typeName, t.reqChapter])).toEqual([
      ['文档审查', '4.1.1'],
      ['功能测试', '4.1.2'],
      ['静态分析', '4.1.3']
    ])
    const flat = draft.types.flatMap(t => t.cases)
    expect(flat.map(c => c.caseId)).toEqual(['YL_DC_001', 'YL_A_B_001', 'YL_A_B_002', 'YL_E_F_001'])
    expect(flat.map(c => c.failSteps)).toEqual([[1], [1], [1], [1]])
  })

  test('buildRegressData：4.1 五字段原文照抄、类型首例出标题、reqChapter 交叉对号', () => {
    const { outline, records } = parseFixtures()
    const draft = selectRegressCases(outline, records, PARAMS)
    const selected = draft.types.flatMap(t => t.cases.map(c => c.caseId))
    const data = buildRegressData(outline, records, selected, PARAMS)
    // 需求表三个测试项，五字段全为大纲原文（v2：测试项描述/测试方法/充分性要求/通过准则一并原样拷贝）
    expect(data.regItems.map(i => [i.h3, i.name, i.itemId, i.priority, i.traceRaw, i.reqDesc])).toEqual([
      ['文档审查', '文档审查', 'XQ_DC', '高', '隐含需求', '--'],
      ['功能测试', '功能项一', 'XQ_A_B', '高', '《某需求规格说明》4.4 功能一', '功能一需求描述原文'],
      ['静态分析', '静态分析', 'XQ_E_F', '', '隐含需求', '--']
    ])
    expect(data.regItems[0].descRaw).toContain('1.文档审查（XQ_DC_DC001）')
    expect(data.regItems[0].methodRaw).toContain('1）人工阅读文档')
    expect(data.regItems[0].sufficientRaw).toBe('')
    expect(data.regItems[0].criteriaRaw).toBe('')
    // 用例序与类型首例标记（平路径：h3=首层标题，深层槽空）；追踪行 reqChapter = 大纲原章节号（2026-11-22 拍板「章节原封不动」）
    expect(data.regCases.map(c => [c.h3, c.caseId, c.reqChapter, c.regTypeName, c.itemId, c.steps.length])).toEqual([
      ['文档审查', 'YL_DC_001', '1.1.1.1', '文档审查', 'XQ_DC', 2],
      ['功能测试', 'YL_A_B_001', '1.1.1.2', '功能项一', 'XQ_A_B', 1],
      ['', 'YL_A_B_002', '1.1.1.2', '功能项一', 'XQ_A_B', 1],
      ['静态分析', 'YL_E_F_001', '1.1.1.3', '静态分析', 'XQ_E_F', 2]
    ])
    // 概述表序号连续；全局参数按生成时提交带入
    expect(data.regRows.map(r => [r.no, r.caseId])).toEqual([
      [1, 'YL_DC_001'], [2, 'YL_A_B_001'], [3, 'YL_A_B_002'], [4, 'YL_E_F_001']
    ])
    expect(data.regCases[0].init).toBe(PARAMS.init)
    expect(data.regCases[0].designer).toBe(PARAMS.designer)
    // 记录表参数（2026-11-22 双产物拍板）：人员逐例带入；测试时间按范围在用例间铺开（4 例 11-01→11-05）
    expect(data.regCases.every(c => c.tester === '张三' && c.monitor === '李四')).toBe(true)
    expect(data.regCases.map(c => c.testTime)).toEqual(['2026-11-01', '2026-11-02', '2026-11-04', '2026-11-05'])
    expect(data.stats).toEqual({ items: 3, cases: 4, steps: 6 })
  })

  test('mirrorSlots 标题镜像：深路径逐层出、共前缀抑制、相邻同名去重、超 7 层截最深', async () => {
    const { mirrorSlots } = await import('../src/core/regress/build.ts')
    const pe = (text: string) => ({ text } as any)
    const st = () => ({ prev: ['', '', '', '', '', '', ''] })
    // 深路径逐层出
    const a = mirrorSlots([pe('容器'), pe('功能测试'), pe('子系统'), pe('领域'), pe('项名')], st())
    expect(a).toEqual({ h3: '容器', h4: '功能测试', h5: '子系统', h6: '领域', h7: '项名', h8: '', h9: '' })
    // 同前缀第二项：仅差异层出
    const b = mirrorSlots([pe('容器'), pe('功能测试'), pe('子系统'), pe('领域2'), pe('项名2')], (() => { const s = st(); mirrorSlots([pe('容器'), pe('功能测试'), pe('子系统'), pe('领域'), pe('项名')], s); return s })())
    expect(b).toEqual({ h3: '', h4: '', h5: '', h6: '领域2', h7: '项名2', h8: '', h9: '' })
    // 相邻同名（静态：项名=类型名）不出深层标题
    const c = mirrorSlots([pe('文档审查'), pe('文档审查')], st())
    expect(c).toEqual({ h3: '文档审查', h4: '', h5: '', h6: '', h7: '', h8: '', h9: '' })
    // 超 7 层丢最浅层
    const d = mirrorSlots([pe('L1'), pe('L2'), pe('L3'), pe('L4'), pe('L5'), pe('L6'), pe('L7'), pe('L8')], st())
    expect(d).toEqual({ h3: 'L2', h4: 'L3', h5: 'L4', h6: 'L5', h7: 'L6', h8: 'L7', h9: 'L8' })
  })

  test('鲁棒性（2026-11-22 收尾审查）：同标识撞号项双键 / 空格标识 / 跨项重名告警 / 子集镜像抑制', () => {
    const hp = (text: string, heading: number, ilvl: number) => ({ kind: 'p', para: { text, heading, numId: 1, ilvl } }) as any
    const itbl = (name: string, itemId: string, caseTitle: string) => ({
      kind: 'tbl',
      rows: fullItemTable(name, itemId, '高', '隐含需求', '--', [
        [DESC, '1.' + caseTitle + '（' + itemId + '_A001）\n' + caseTitle + '综述。'],
        [METHOD, '1.' + caseTitle + '（' + itemId + '_A001）\n1）执行操作一，查看结果是否正确；']
      ])
    })
    // ① 同标识撞号项 + 跨项重名用例：两测试项共用 XQ_A，各自派生 YL_A_001
    {
      const outline = extractOutline(buildDocx({ content: [
        hp('测试项及方法', 2, 1),
        hp('容器A', 4, 3), itbl('甲', 'XQ_A', '用例甲'),
        hp('容器B', 4, 3), itbl('乙', 'XQ_A', '用例乙')
      ] }), new IssueCollector())
      const records = extractRecordCases(buildDocx({ content: [
        hp('测试记录', 1, 0), hp('功能测试', 2, 1),
        recordTable('YL_A_001', '用例甲', 'XQ_A', ['未通过'], { chapter: '1.1.1.1' })
      ] }), new IssueCollector())
      const draft = selectRegressCases(outline, records, PARAMS)
      expect(draft.issues.some(i => i.code === 'REGRESS_DUP_CASEID')).toBe(true)
      const picked = draft.types.flatMap(t => t.cases).filter(c => c.matched).map(c => c.caseId)
      const data = buildRegressData(outline, records, picked, PARAMS)
      // 双键修复：追踪行取自第一项（甲），不是后解析的同标识项（乙）
      expect(data.regCases[0].regTypeName).toBe('甲')
      expect(data.regCases[0].reqChapter).toBe('1.1.1.1')
    }
    // ② 空格标识：记录标识带尾随空格仍精确命中
    {
      const outline = extractOutline(buildDocx({ content: [hp('测试项及方法', 2, 1), hp('文档审查', 4, 3), itbl('文档审查', 'XQ_B', '用例B')] }), new IssueCollector())
      const records = extractRecordCases(buildDocx({ content: [hp('测试记录', 1, 0), recordTable('YL_B_001 ', '用例B', 'XQ_B', ['未通过'])] }), new IssueCollector())
      const draft = selectRegressCases(outline, records, PARAMS)
      expect(draft.stats.matched).toBe(1)
    }
    // ③ 子集镜像：只勾第二项，共享祖先标题仍渲染
    {
      const outline = extractOutline(buildDocx({ content: [
        hp('测试项及方法', 2, 1),
        hp('功能测试', 4, 3), hp('子系统A', 5, 4),
        hp('甲', 6, 5), itbl('甲', 'XQ_P1', '用例甲'),
        hp('乙', 6, 5), itbl('乙', 'XQ_P2', '用例乙')
      ] }), new IssueCollector())
      const records = extractRecordCases(buildDocx({ content: [hp('测试记录', 1, 0), recordTable('YL_P2_001', '用例乙', 'XQ_P2', ['未通过'])] }), new IssueCollector())
      const draft = selectRegressCases(outline, records, PARAMS)
      const data = buildRegressData(outline, records, draft.types.flatMap(t => t.cases).filter(c => c.matched).map(c => c.caseId), PARAMS)
      expect([data.regCases[0].h3, data.regCases[0].h4, data.regCases[0].h5]).toEqual(['功能测试', '子系统A', '乙'])
    }
  })

  test('空勾选 → REGRESS_EMPTY 错误', () => {
    const { outline, records } = parseFixtures()
    const data = buildRegressData(outline, records, [], PARAMS)
    expect(data.stats.cases).toBe(0)
    expect(data.issues.some(i => i.code === 'REGRESS_EMPTY')).toBe(true)
  })

  test('配套性纠错：标识/章节号/用例名/步骤数不一致、无尾号歧义、判定列缺失、未执行、字段空缺全部识别', () => {
    const iss = new IssueCollector()
    const outline = extractOutline(buildDocx(outlineSpec()), iss)
    const anomalous: DocSpec = {
      content: [
        { kind: 'p', para: { text: '测试记录', heading: 1 } },
        { kind: 'p', para: { text: '功能测试', heading: 2 } },
        // 标识/章节号/用例名三重不一致 + 步骤数一致（专测前三个）
        recordTable('YL_A_B_002', '用例二改名', 'XQ_OTHER', ['未通过'], { chapter: '9.9.9.9' }),
        // 无尾号标识且测试项下有两个用例 → 歧义告警（YL_A_B_002 已被上一表占用，此表按基名取 YL_A_B_001）
        recordTable('YL_A_B', '用例一', 'XQ_A_B', ['未通过']),
        // 步骤数不一致：记录 3 步 vs 大纲 1 步
        recordTable('YL_DC', '文档审查', 'XQ_DC', ['未通过', '通过', '通过']),
        // 判定列缺失（无法判定是否通过，且不进草稿）
        recordTable('YL_NORES', '无结果用例', 'XQ_A_B', ['']),
        // 执行状态异常且不通过
        recordTable('YL_E_F_001', '静态分析', 'XQ_E_F', ['未通过'], { executed: '未执行' })
      ]
    }
    const records = extractRecordCases(buildDocx(anomalous), new IssueCollector())
    const draft = selectRegressCases(outline, records, PARAMS)
    const codes = new Set(draft.issues.map(i => i.code))
    expect(codes.has('REGRESS_ITEM_ID_MISMATCH')).toBe(true)
    expect(draft.issues.filter(i => i.code === 'REGRESS_ITEM_ID_MISMATCH').length).toBe(1)
    expect(codes.has('REGRESS_CHAPTER_MISMATCH')).toBe(true)
    expect(codes.has('REGRESS_NAME_MISMATCH')).toBe(true)
    expect(codes.has('REGRESS_ID_AMBIG')).toBe(true)
    expect(codes.has('REGRESS_STEP_MISMATCH')).toBe(true)
    expect(codes.has('REGRESS_NO_RESULT')).toBe(true)
    expect(codes.has('REGRESS_NOT_EXECUTED')).toBe(true)
    // 大纲侧字段空缺：静态分析没写优先级（基线夹具即如此）
    expect(codes.has('REGRESS_ITEM_FIELD_EMPTY')).toBe(true)
    // 文案抽查：标识不一致告警带两侧标识
    const idMsg = draft.issues.find(i => i.code === 'REGRESS_ITEM_ID_MISMATCH')!.message
    expect(idMsg).toContain('XQ_OTHER')
    expect(idMsg).toContain('XQ_A_B')
    // 歧义表按基名取到第一个用例；无判定列表不入草稿（failed 只计 4）
    expect(draft.stats.failed).toBe(4)
    expect(draft.unmatched.map(u => u.recordCaseId)).toEqual([])
  })
})

describe('M9 /api/regress 端到端', () => {
  const server = Bun.serve({ port: 0, fetch: handle })
  const base = server.url.toString().replace(/\/$/, '')

  function form(file: File): FormData {
    const fd = new FormData()
    fd.append('file', file)
    return fd
  }

  test('配对上传解析 → 勾选生成 → 产物断言', async () => {
    const outlineBuf = sampleOutline()
    const recordBuf = sampleRecord()
    // ① 解析（大纲现场上传 + 记录上传）
    const fd = new FormData()
    fd.append('file', new File([new Uint8Array(recordBuf)], '合成测试记录.docx'))
    fd.append('outlineFile', new File([new Uint8Array(outlineBuf)], '合成测试大纲.docx'))
    const pr = await (await fetch(base + '/api/regress/parse', { method: 'POST', body: fd })).json() as any
    expect(pr.ok).toBe(true)
    expect(pr.draft.stats).toEqual({ recordCases: 5, failed: 5, matched: 4 })
    expect(pr.draft.types.length).toBe(3)
    expect(pr.outline.hash).toBeTruthy()
    expect(pr.primary.hash).toBeTruthy()
    // ② 生成（全勾选）
    const selected = pr.draft.types.flatMap((t: any) => t.cases.map((c: any) => c.caseId))
    const gr = await (await fetch(base + '/api/regress/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outline: pr.outline, record: pr.primary, selected, params: PARAMS })
    })).json() as any
    expect(gr.ok).toBe(true)
    // 双产物（2026-11-22 用户需求"两个一起"）：说明 + 记录
    expect(gr.files.length).toBe(2)
    expect(gr.files[0].name).toBe('回归测试说明-生成.docx')
    expect(gr.files[1].name).toBe('回归测试记录-生成.docx')
    expect(existsSync(gr.files[0].path)).toBe(true)
    expect(existsSync(gr.files[1].path)).toBe(true)
    // ③ 说明产物：无未解析占位符、追踪关系为回归措辞、概述属性继承、XML 良构
    const xml = (PizZip as any)(Buffer.from(gr.files[0].doc, 'base64')).file('word/document.xml').asText() as string
    const text = xml.replace(/<[^>]+>/g, '')
    expect(/\{[#/a-zA-Z]/.test(text)).toBe(false)
    expect(text).toContain('软件测试依据：回归测试需求')
    expect(text).toContain('测试需求分析：1.1.1.2 功能项一')
    expect(text).toContain('测试需求标识：XQ_A_B')
    expect(text).toContain('继承')
    expect(text).toContain('《某需求规格说明》4.4 功能一')
    // 子项标题行加粗（2026-11-22 用户拍板）：DESC/METHOD 的「N.」行加粗；步骤「N）」行不加粗
    expect(xml).toMatch(/<w:b\/><\/w:rPr><w:t[^>]*>1\.文档审查/)
    expect(xml).not.toMatch(/<w:b\/><\/w:rPr><w:t[^>]*>1）/)
    const errs: string[] = []
    new DOMParser({
      onError: (level: unknown, msg: unknown) => {
        if (level === 'error' || level === 'fatalError') errs.push(String(msg))
      }
    }).parseFromString(xml, 'application/xml')
    expect(errs).toEqual([])
    // ④ 记录产物（回归测试记录）：预填形态 + 人员/时间参数 + 良构
    const recXml = (PizZip as any)(Buffer.from(gr.files[1].doc, 'base64')).file('word/document.xml').asText() as string
    const recText = recXml.replace(/<[^>]+>/g, '')
    expect(/\{[#/a-zA-Z]/.test(recText)).toBe(false)
    expect(recText).toContain('执行状态已执行')
    expect(recText).toContain('测试人员张三')
    expect(recText).toContain('监测人员李四')
    expect(recText).toContain('测试需求分析：1.1.1.2 功能项一')
    expect(recText).toContain('2026-11-01')
    expect(recText).toContain('2026-11-05')
    // 通过与否预填「通过」（4 例共 6 步）+ 实测结果 = 期望原文（首例首步三格连排可见双写）
    expect((recText.match(/通过/g) ?? []).length).toBeGreaterThanOrEqual(6)
    expect(recText).toContain('依据附录A.1对需求规格说明进行审查依据附录A.1对需求规格说明进行审查通过')
    const recErrs: string[] = []
    new DOMParser({
      onError: (level: unknown, msg: unknown) => {
        if (level === 'error' || level === 'fatalError') recErrs.push(String(msg))
      }
    }).parseFromString(recXml, 'application/xml')
    expect(recErrs).toEqual([])
  })

  test('从项目库配对大纲（outlineHash）解析同样成立', async () => {
    const fd = new FormData()
    fd.append('file', new File([new Uint8Array(sampleRecord())], '合成测试记录.docx'))
    fd.append('outlineFile', new File([new Uint8Array(sampleOutline())], '再次上传大纲.docx'))
    const pr1 = await (await fetch(base + '/api/regress/parse', { method: 'POST', body: fd })).json() as any
    expect(pr1.ok).toBe(true)
    const fd2 = new FormData()
    fd2.append('file', new File([new Uint8Array(sampleRecord())], '合成测试记录2.docx'))
    fd2.append('outlineHash', pr1.outline.hash)
    const pr2 = await (await fetch(base + '/api/regress/parse', { method: 'POST', body: fd2 })).json() as any
    expect(pr2.ok).toBe(true)
    expect(pr2.draft.stats.matched).toBe(4)
  })

  test('缺记录 / 非大纲配对 / 空勾选 → 400', async () => {
    const noFile = new FormData()
    noFile.append('outlineFile', new File([new Uint8Array(sampleOutline())], 'o.docx'))
    const r1 = await fetch(base + '/api/regress/parse', { method: 'POST', body: noFile })
    expect(r1.status).toBe(400)
    const badOutline = new FormData()
    badOutline.append('file', new File([new Uint8Array(sampleRecord())], '记录.docx'))
    badOutline.append('outlineFile', new File([new Uint8Array(sampleRecord())], '拿记录冒充大纲.docx'))
    const r2 = await (await fetch(base + '/api/regress/parse', { method: 'POST', body: badOutline })).json() as any
    expect(r2.ok).toBe(false)
    expect(r2.error).toContain('不是测试大纲')
    const fd = new FormData()
    fd.append('file', new File([new Uint8Array(sampleRecord())], '记录.docx'))
    fd.append('outlineFile', new File([new Uint8Array(sampleOutline())], '大纲.docx'))
    const pr = await (await fetch(base + '/api/regress/parse', { method: 'POST', body: fd })).json() as any
    const gr = await fetch(base + '/api/regress/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outline: pr.outline, record: pr.primary, selected: [], params: PARAMS })
    })
    expect(gr.status).toBe(400)
    // 必填参数硬闸（2026-11-22 拍板"没填不能进下一步"）：缺人员 / 缺时间范围 → 400
    const gen = (params: object): Promise<Response> => fetch(base + '/api/regress/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outline: pr.outline, record: pr.primary, selected: ['YL_DC_001'], params })
    })
    const grT = await gen({ ...PARAMS, tester: ' ', monitor: '李四' })
    expect(grT.status).toBe(400)
    const grD = await gen({ ...PARAMS, timeStart: '', timeEnd: '' })
    expect(grD.status).toBe(400)
    const grR = await gen({ ...PARAMS, timeStart: '2026-11-09', timeEnd: '2026-11-02' })
    expect(grR.status).toBe(400)
  })

  afterAll(() => {
    server.stop(true)
  })
})

describe('回归模板守门（2026-11-22 用户拍板）', () => {
  test('模板无「需求的可追踪性」且全部节为竖版 A4', () => {
    const raw = new PizZip(readFileSync('模板/回归测试说明模板.docx')).file('word/document.xml')!.asText()
    expect(raw).not.toContain('需求的可追踪性')
    expect(raw).not.toContain('w:orient="landscape"')
    // 竖版 A4（两节：目录节 1418 边距 + 正文节 1247 边距）
    const sizes = raw.match(/<w:pgSz[^>]*\/>/g) ?? []
    expect(sizes).toHaveLength(2)
    for (const s of sizes) {
      expect(s).toContain('w:w="11906"')
      expect(s).toContain('w:h="16838"')
    }
  })

  test('循环体表后带隔段（防表贴表回归）', async () => {
    const { readDocx, bodyElements, textOf, W } = await import('../src/core/parse/docx.ts')
    const office = readDocx(new Uint8Array(readFileSync('模板/回归测试说明模板.docx')))
    const tops: Element[] = []
    for (const el of bodyElements(office as any)) tops.push(el)
    const norm = (s: string) => s.replace(/\s+/g, '')
    const find = (start: string): Element => {
      const t = tops.find((e) => e.localName === 'tbl' && norm(textOf(e as Element)).startsWith(start))
      if (!t) throw new Error('循环表未找到: ' + start)
      return t
    }
    // 需求表 → 空段 → {/regItems}
    const itemIdx = tops.indexOf(find('测试项名称'))
    expect(norm(textOf(tops[itemIdx + 1] as Element))).toBe('')
    expect(norm(textOf(tops[itemIdx + 2] as Element))).toBe('{/regItems}')
    // 用例表 → 空段 → {/regCases}
    const caseIdx = tops.indexOf(find('用例测试用例名称'))
    expect(norm(textOf(tops[caseIdx + 1] as Element))).toBe('')
    expect(norm(textOf(tops[caseIdx + 2] as Element))).toBe('{/regCases}')
    // 步骤序号格纯文字：无题注样式（2026-11-22 用户拍板，a7 在用户环境渲染黑点）
    const caseTbl = find('用例测试用例名称')
    const stepsRow = (Array.from(caseTbl.getElementsByTagNameNS(W, 'tr')) as Element[]).find((r) => norm(textOf(r)).includes('{#steps}'))
    const cell0 = (Array.from(stepsRow!.getElementsByTagNameNS(W, 'tc')) as Element[])[0]
    for (const p of Array.from(cell0.getElementsByTagNameNS(W, 'p')) as Element[]) {
      expect(p.getElementsByTagNameNS(W, 'pStyle').length).toBe(0)
    }
    // 概述表：前面紧贴 5 标题（用户 2026-11-22 手改模板定形），后面空行接 6 标题
    const sumIdx = tops.indexOf(find('序号测试用例名称'))
    expect(norm(textOf(tops[sumIdx - 1] as Element))).toBe('回归测试用例概述')
    expect(norm(textOf(tops[sumIdx + 1] as Element))).toBe('')
  })

  test('七级/八级标题样式拍板：小四 + eastAsia 黑体；编号 L6/L7 Times New Roman', () => {
    const zip = new PizZip(readFileSync('模板/回归测试说明模板.docx'))
    const styles = zip.file('word/styles.xml')!.asText()
    for (const sid of ['7', '8']) {
      const i = styles.indexOf('w:styleId="' + sid + '"')
      const block = styles.slice(styles.lastIndexOf('<w:style ', i), styles.indexOf('</w:style>', i))
      expect(block).toContain('w:eastAsia="黑体"')
      expect(block).toContain('<w:sz w:val="24"/>')
    }
    const abs0 = zip.file('word/numbering.xml')!.asText().match(/<w:abstractNum w:abstractNumId="0"[\s\S]*?<\/w:abstractNum>/)![0]
    for (const l of abs0.match(/<w:lvl [^>]*>[\s\S]*?<\/w:lvl>/g) ?? []) {
      if (!/w:ilvl="(6|7)"/.test(l)) continue
      expect(l).toContain('w:ascii="Times New Roman"')
      expect(l).toContain('w:hint="default"')
    }
  })
})
