/**
 * 黄金统计验收 CLI（07-测试策略 1.8）
 *
 * 用法：
 *   bun scripts/acceptance.ts <大纲.docx> [--expect 测试项:用例:步骤] [--issues] [--json]
 *
 * 只输出统计数字，不输出大纲内容（涉密数据不出本机、不进仓库）。
 * 退出码：0 = 通过（未指定 --expect 或统计一致），1 = 失败。
 */

import { readDocx } from '../src/core/parse/docx.ts'
import { extractOutline } from '../src/core/parse/outline.ts'
import { IssueCollector } from '../src/core/domain.ts'

function usage(): never {
  console.error('用法: bun scripts/acceptance.ts <大纲.docx> [--expect 测试项:用例:步骤] [--issues] [--json]')
  process.exit(1)
}

const args = process.argv.slice(2)
const file = args.find(a => !a.startsWith('--'))
if (!file) usage()

const expectIdx = args.indexOf('--expect')
const expectStr = expectIdx >= 0 ? args[expectIdx + 1] : null
const showIssues = args.includes('--issues')
const asJson = args.includes('--json')

const buf = await Bun.file(file).arrayBuffer()
const t0 = performance.now()
let parsed
try {
  const office = readDocx(new Uint8Array(buf))
  const issues = new IssueCollector()
  parsed = extractOutline(office, issues)
} catch (e) {
  console.error('解析失败：' + (e instanceof Error ? e.message : String(e)))
  process.exit(1)
}
const ms = Math.round(performance.now() - t0)

const stats = parsed.stats
const counts = { error: 0, warning: 0, info: 0 }
for (const i of parsed.issues) counts[i.level]++

if (asJson) {
  console.log(JSON.stringify({ file, stats, counts, ms, issues: parsed.issues }, null, 2))
} else {
  console.log(`文件: ${file}`)
  console.log(`测试项: ${stats.items}  测试用例: ${stats.cases}  测试步骤: ${stats.steps}`)
  console.log(`问题: 错误 ${counts.error} · 告警 ${counts.warning} · 提示 ${counts.info}`)
  console.log(`耗时: ${ms}ms`)
  if (showIssues) {
    for (const i of parsed.issues) {
      const tag = i.level === 'error' ? '错误' : i.level === 'warning' ? '告警' : '提示'
      console.log(`  [${tag}] ${i.code} ${i.context ?? ''} ${i.message}`)
    }
  }
}

let failed = false
if (expectStr) {
  const parts = expectStr.split(':').map(Number)
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) usage()
  const ok = parts[0] === stats.items && parts[1] === stats.cases && parts[2] === stats.steps
  if (!ok) {
    console.error(`基线不匹配：期望 ${parts.join('/')}，实际 ${stats.items}/${stats.cases}/${stats.steps}`)
    failed = true
  } else {
    console.log(`基线一致：${parts.join('/')}`)
  }
}
process.exit(failed ? 1 : 0)
