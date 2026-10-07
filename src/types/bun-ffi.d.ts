/**
 * bun:ffi 最小类型声明（v1.1.3）：@types/bun 1.4 尚未收录该模块。
 * 仅声明 index.ts 用到的形态：dlopen(path, 符号表) → { symbols }。
 * 注意 Bun 1.4 的第二参就是符号表本身（无 symbols 包装层——嵌套写法会把
 * "symbols" 当符号名查找而报 Symbol not found，2026-10-07 实测）。
 */
declare module 'bun:ffi' {
  export type FFIArgType = 'u8' | 'i8' | 'u16' | 'i16' | 'u32' | 'i32' | 'u64' | 'i64' | 'f32' | 'f64' | 'bool' | 'pointer'
  export function dlopen(
    path: string,
    symbols: Record<string, { args: FFIArgType[]; returns: FFIArgType }>
  ): { symbols: Record<string, (...args: unknown[]) => unknown> }
}
