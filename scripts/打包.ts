/** 生成 src/server/assets.ts（嵌入资产清单）+ 三平台单文件编译（M6，08 打包与交付）
 *
 * 用法：bun scripts/打包.ts
 * 流程：vite build → 扫描 web/dist 生成 assets.ts（逐文件 import with {type:'file'}）
 *       → bun build --compile 三目标 → 产物进 dist/发布/
 * 麒麟 V10 = Linux x64（glibc 2.31 ≥ Bun 2.28 门槛），与通用 Linux 同二进制，
 * 复制一份按麒麟命名交付。
 */
import { readdirSync, statSync, copyFileSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, relative, extname } from 'node:path'
import { $ } from 'bun'

const ROOT = import.meta.dir + '/..'
const DIST = join(ROOT, 'web/dist')
const OUT = join(ROOT, 'dist/发布')
const ASSETS_TS = join(ROOT, 'src/server/assets.ts')

/** 递归收集目录下全部文件相对路径（含子目录前缀，如 assets/index-xxx.js） */
function walk(dir: string, prefix: string = ''): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...walk(join(dir, e.name), prefix + e.name + '/'))
    else out.push(prefix + e.name)
  }
  return out.sort()
}

// 1. 前端产物必须先存在（本脚本不代跑 vite build——版本发布流程里已单独构建过；
//    缺失时提示，避免用旧 dist 打出新包）
if (!statSync(DIST, { throwIfNoEntry: false })?.isDirectory()) {
  console.error('web/dist 不存在：先运行 bun run build')
  process.exit(1)
}

// 2. 生成 assets.ts（编译时逐文件 import 嵌入；运行时得到解包路径）
const distFiles = walk(DIST)
const tplFiles = ['测试说明模板.docx', '测试记录模板.docx']
const lines: string[] = [
  '// 由 scripts/打包.ts 生成，勿手改（M6 嵌入资产清单；开发形态此文件为空映射，走磁盘）',
  ''
]
for (let i = 0; i < distFiles.length; i++) {
  lines.push(`import a${i} from '../../web/dist/${distFiles[i]}' with { type: 'file' }`)
}
for (let i = 0; i < tplFiles.length; i++) {
  lines.push(`import t${i} from '../../模板/${tplFiles[i]}' with { type: 'file' }`)
}
lines.push('')
lines.push('export const EMBEDDED_ASSETS: Record<string, string> = {')
for (let i = 0; i < distFiles.length; i++) {
  lines.push(`  '/${distFiles[i]}': a${i},`)
}
lines.push('}')
lines.push('')
lines.push('export const EMBEDDED_TEMPLATES: Record<string, string> = {')
for (let i = 0; i < tplFiles.length; i++) {
  lines.push(`  '${tplFiles[i]}': t${i},`)
}
lines.push('}')
writeFileSync(ASSETS_TS, lines.join('\n') + '\n', 'utf8')
console.log(`assets.ts：${distFiles.length} 个前端文件 + ${tplFiles.length} 个模板`)

// 3. 三目标编译
mkdirSync(OUT, { recursive: true })
const VER = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version as string
const targets: Array<{ target: string; name: string }> = [
  { target: 'bun-windows-x64', name: `测试文档生成工具_v${VER}_win-x64.exe` },
  { target: 'bun-linux-x64', name: `测试文档生成工具_v${VER}_linux-x64` }
]
for (const t of targets) {
  console.log(`编译 ${t.target} → ${t.name} ...`)
  const common = ['--compile', `--target=${t.target}`, '--minify', '--sourcemap=none']
  if (t.target === 'bun-windows-x64') {
    // Windows 专属：exe 图标 + 版本资源（资源管理器里可见）
    common.push(
      '--windows-icon=资源/app.ico',
      '--windows-title=测试文档生成工具',
      `--windows-version=${VER}.0`,
      '--windows-publisher=CCNewTools',
      '--windows-description=测试大纲转测试说明/测试记录的离线单文件工具'
    )
  }
  await $`bun build ${common} src/server/index.ts --outfile ${join(OUT, t.name)}`.cwd(ROOT)
}
// 麒麟 V10 与 linux-x64 同二进制（glibc 2.31 兼容），按交付名复制一份
copyFileSync(join(OUT, `测试文档生成工具_v${VER}_linux-x64`), join(OUT, `测试文档生成工具_v${VER}_kylin-v10`))
console.log(`产物已输出到 ${relative(ROOT, OUT)}：`)
for (const f of readdirSync(OUT)) console.log('  ' + f)
void extname
