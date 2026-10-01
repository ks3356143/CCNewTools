/** tsc 类型检查用的 .vue 模块声明（Vite 构建由插件处理 .vue，此文件仅供 --noEmit） */
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}
