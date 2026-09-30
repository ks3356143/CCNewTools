/**
 * 手工比对辅助：真实大纲 → 解析 → 转换 → 渲染，输出两份 docx 供与老工具样例比对。
 * 用法：bun scripts/render.ts <大纲.docx> <输出目录>
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { readDocx } from '../src/core/parse/docx.ts'
import { extractOutline } from '../src/core/parse/outline.ts'
import { convertToTemplateData } from '../src/core/convert/index.ts'
import { renderTemplate } from '../src/core/render/docx.ts'
import { IssueCollector, DEFAULT_PARAMS } from '../src/core/domain.ts'

const [outlinePath, outDir] = process.argv.slice(2)
if (!outlinePath || !outDir) {
  console.error('用法: bun scripts/render.ts <大纲.docx> <输出目录>')
  process.exit(1)
}
mkdirSync(outDir, { recursive: true })

const buf = readFileSync(outlinePath)
const office = readDocx(new Uint8Array(buf))
const issues = new IssueCollector()
const parsed = extractOutline(office, issues)
const data = convertToTemplateData(parsed, DEFAULT_PARAMS)

const spec = renderTemplate(readFileSync('模板/测试说明模板.docx'), data)
const rec = renderTemplate(readFileSync('模板/测试记录模板.docx'), data)

const specPath = join(outDir, '测试说明_render.docx')
const recPath = join(outDir, '测试记录_render.docx')
writeFileSync(specPath, spec)
writeFileSync(recPath, rec)

console.log(`用例 ${data.cases.length} 条；已输出：`)
console.log(specPath)
console.log(recPath)
