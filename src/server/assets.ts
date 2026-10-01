// 由 scripts/打包.ts 生成，勿手改（M6 嵌入资产清单；开发形态此文件为空映射，走磁盘）

import a0 from '../../web/dist/_test.docx' with { type: 'file' }
import a1 from '../../web/dist/assets/index-CHytbkoh.css' with { type: 'file' }
import a2 from '../../web/dist/assets/index-DBAGZGCn.js' with { type: 'file' }
import a3 from '../../web/dist/assets/materialdesignicons-webfont-B7mPwVP_.ttf' with { type: 'file' }
import a4 from '../../web/dist/assets/materialdesignicons-webfont-CSr8KVlo.eot' with { type: 'file' }
import a5 from '../../web/dist/assets/materialdesignicons-webfont-Dp5v-WZN.woff2' with { type: 'file' }
import a6 from '../../web/dist/assets/materialdesignicons-webfont-PXm3-2wK.woff' with { type: 'file' }
import a7 from '../../web/dist/favicon.svg' with { type: 'file' }
import a8 from '../../web/dist/index.html' with { type: 'file' }
import t0 from '../../模板/测试说明模板.docx' with { type: 'file' }
import t1 from '../../模板/测试记录模板.docx' with { type: 'file' }

export const EMBEDDED_ASSETS: Record<string, string> = {
  '/_test.docx': a0,
  '/assets/index-CHytbkoh.css': a1,
  '/assets/index-DBAGZGCn.js': a2,
  '/assets/materialdesignicons-webfont-B7mPwVP_.ttf': a3,
  '/assets/materialdesignicons-webfont-CSr8KVlo.eot': a4,
  '/assets/materialdesignicons-webfont-Dp5v-WZN.woff2': a5,
  '/assets/materialdesignicons-webfont-PXm3-2wK.woff': a6,
  '/favicon.svg': a7,
  '/index.html': a8,
}

export const EMBEDDED_TEMPLATES: Record<string, string> = {
  '测试说明模板.docx': t0,
  '测试记录模板.docx': t1,
}
