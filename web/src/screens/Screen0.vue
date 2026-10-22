<script setup lang="ts">
import { openTool } from '../store.ts'

// 版本号（vite define 注入，与顶栏同源）
const appVersion = __APP_VERSION__

/** 工具卡片数据（11-工具集首页：纯入口，不加载项目数据） */
const TOOLS = [
  {
    key: 'convert' as const,
    icon: 'mdi-file-word-box',
    name: '大纲转换',
    desc: '测试大纲 → 测试说明 / 测试记录',
    note: '解析测试项表格 · 核对修正 · 一键生成两份 Word 文档',
    steps: ['选大纲', '核对', '生成']
  },
  {
    key: 'trace' as const,
    icon: 'mdi-link-variant',
    name: '追踪文档生成',
    desc: '大纲 / 记录 / 回归说明 → 四类追踪表',
    note: '大纲·说明·报告·回归说明四种追踪表，纵向合并，复制贴入自有文档',
    steps: ['选类型', '生成下载']
  }
]

/** 聚光边框：光标位置写进 CSS 变量（直改 style，不进响应式、零重渲染） */
function trackGlow(e: MouseEvent): void {
  const el = e.currentTarget as HTMLElement
  const r = el.getBoundingClientRect()
  el.style.setProperty('--mx', `${e.clientX - r.left}px`)
  el.style.setProperty('--my', `${e.clientY - r.top}px`)
}
</script>

<template>
  <div class="wrap">
    <!-- 环境层：两枚慢速漂移柔光（装饰只在背景） -->
    <div class="ambient" aria-hidden="true">
      <div class="blob b1" />
      <div class="blob b2" />
    </div>

    <div class="head">
      <div class="kicker">CCNewTools · 离线工作台</div>
      <h1 class="title">选择一个工具开始</h1>
      <p class="sub">导入测试大纲，自动生成测试文档，全程离线，数据不出本机。</p>
    </div>

    <div class="grid">
      <button
        v-for="(t, i) in TOOLS" :key="t.key"
        class="card" :style="{ '--i': i }"
        @click="openTool(t.key)"
        @mousemove="trackGlow"
      >
        <div class="top">
          <div class="icon"><v-icon size="23">{{ t.icon }}</v-icon></div>
          <span class="idx">0{{ i + 1 }}</span>
        </div>
        <h3>{{ t.name }}</h3>
        <p class="desc">{{ t.desc }}</p>
        <p class="note">{{ t.note }}</p>
        <div class="steps">
          <span v-for="(s, j) in t.steps" :key="s" class="step">
            <span class="snum">{{ j + 1 }}</span>{{ s }}
          </span>
        </div>
        <div class="enter">
          <span>进入</span>
          <v-icon size="15">mdi-arrow-right</v-icon>
        </div>
      </button>
    </div>

    <div class="foot">
      <span class="offline">离线运行 · 文档内容不出本机</span>
      <span class="mono">v{{ appVersion }}</span>
    </div>
  </div>
</template>

<style scoped>
/* ===== 首页 v2「工程仪器工作台」（2026-10-22 视觉系统重做）=====
   设计稿：OpenDesign「蓝调鎏光 · 工程仪器」。装饰（柔光/网格）只在背景，
   卡片为实色表面 + 细边框；聚光仅作边缘光，不进入内容区。 */
.wrap {
  position: relative;
  min-height: calc(100vh - 64px);
  overflow: hidden;
  display: flex; flex-direction: column;
  padding: 0 32px 22px;
  background-color: var(--cn-bg);
  background-image:
    radial-gradient(circle at 12% -8%, rgba(70, 151, 226, 0.15), transparent 38%),
    radial-gradient(circle at 96% 18%, rgba(55, 126, 192, 0.09), transparent 32%),
    radial-gradient(rgba(45, 100, 151, 0.13) 0.6px, transparent 0.8px);
  background-size: auto, auto, 18px 18px, auto;
}
.v-theme--dark .wrap {
  background-image:
    radial-gradient(circle at 8% -8%, rgba(28, 100, 167, 0.22), transparent 38%),
    radial-gradient(circle at 96% 18%, rgba(25, 83, 128, 0.16), transparent 32%),
    radial-gradient(rgba(104, 157, 204, 0.11) 0.6px, transparent 0.8px);
}

/* ---- 环境层（慢速漂移柔光，只动 transform） ---- */
.ambient { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.blob { position: absolute; border-radius: 50%; }
.b1 {
  width: 76vw; height: 76vw; left: -18vw; top: -34vw;
  background: radial-gradient(circle, rgba(75, 155, 230, 0.16) 0, rgba(75, 155, 230, 0.04) 46%, transparent 72%);
  animation: drift1 26s var(--cn-ease-standard) infinite alternate;
}
.b2 {
  width: 70vw; height: 70vw; right: -24vw; bottom: -40vw;
  background: radial-gradient(circle, rgba(39, 114, 185, 0.12) 0, rgba(39, 114, 185, 0.03) 48%, transparent 74%);
  animation: drift2 32s var(--cn-ease-standard) infinite alternate;
}
.v-theme--dark .b1 { background: radial-gradient(circle, rgba(30, 110, 180, 0.2) 0, rgba(30, 110, 180, 0.05) 46%, transparent 72%); }
.v-theme--dark .b2 { background: radial-gradient(circle, rgba(22, 80, 130, 0.18) 0, rgba(22, 80, 130, 0.04) 48%, transparent 74%); }
@keyframes drift1 { from { transform: translate3d(0, 0, 0) scale(1); } to { transform: translate3d(7vw, 5vw, 0) scale(1.08); } }
@keyframes drift2 { from { transform: translate3d(0, 0, 0) scale(1.04); } to { transform: translate3d(-6vw, -4vw, 0) scale(0.96); } }

/* ---- 标题区 ---- */
.head { position: relative; text-align: center; max-width: 780px; margin: 72px auto 0; }
.kicker {
  display: inline-flex; align-items: center; gap: 8px; margin-bottom: 16px;
  color: var(--cn-accent); font-family: var(--cn-font-mono);
  font-size: 11px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase;
  animation: rise var(--cn-dur-5) var(--cn-ease-out) both;
}
.kicker::before, .kicker::after { content: ""; width: 24px; height: 1px; background: var(--cn-accent-line); }
.title {
  margin: 0;
  font-family: var(--cn-font-display);
  font-size: clamp(32px, 4.2vw, 52px);
  line-height: 1.12; font-weight: 640; letter-spacing: -0.04em;
  color: var(--cn-accent-strong);
  animation: rise var(--cn-dur-5) var(--cn-ease-out) both;
  animation-delay: 40ms;
}
@supports ((-webkit-background-clip: text) or (background-clip: text)) {
  .title {
    background-image: linear-gradient(100deg, #133964 6%, #2167b5 56%, #18a8c4 100%);
    -webkit-background-clip: text; background-clip: text;
    color: transparent;
  }
  .v-theme--dark .title {
    background-image: linear-gradient(100deg, #d9edff 4%, #79bfff 52%, #62d9e9 100%);
  }
}
.sub {
  margin: 15px auto 0; max-width: 610px;
  color: var(--cn-muted); font-size: 13.5px; line-height: 1.85;
  animation: rise var(--cn-dur-5) var(--cn-ease-out) both;
  animation-delay: 90ms;
}

/* ---- 工具卡片 ---- */
.grid {
  position: relative;
  width: 100%; max-width: 1020px;
  margin: 38px auto 0;
  display: grid; grid-template-columns: 1fr 1fr; gap: 18px;
}
@media (max-width: 860px) { .grid { grid-template-columns: 1fr; } }

.card {
  --mx: 70%; --my: 10%;
  position: relative; overflow: hidden; text-align: left; cursor: pointer;
  padding: 24px;
  background: var(--cn-surface);
  border: 1px solid var(--cn-border-strong);
  border-radius: var(--cn-r-3);
  box-shadow: var(--cn-shadow-1);
  display: flex; flex-direction: column;
  transition: transform var(--cn-dur-3) var(--cn-ease-out), box-shadow var(--cn-dur-3) var(--cn-ease-out), border-color var(--cn-dur-3) var(--cn-ease-out);
  animation: rise var(--cn-dur-5) var(--cn-ease-out) both;
  animation-delay: calc(150ms + var(--i) * 90ms);
}
/* 光标聚光：只在卡片内部一层极轻径向光，不进内容区 */
.card::before {
  content: "";
  position: absolute; inset: 0; pointer-events: none;
  opacity: 0;
  background: radial-gradient(260px circle at var(--mx) var(--my), rgba(47, 128, 232, 0.15), transparent 68%);
  transition: opacity var(--cn-dur-3) var(--cn-ease-out);
}
.card:hover { transform: translateY(-4px); box-shadow: var(--cn-shadow-2); border-color: var(--cn-accent-line); }
.card:hover::before { opacity: 1; }
.card:active { transform: translateY(-1px) scale(0.995); }
.card:focus-visible { outline: 2px solid var(--cn-accent); outline-offset: 3px; }

.top { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; position: relative; z-index: 1; }
.icon {
  width: 44px; height: 44px; border-radius: 8px;
  display: grid; place-items: center;
  color: var(--cn-accent);
  background: var(--cn-accent-soft);
  border: 1px solid var(--cn-accent-line);
  transition: transform var(--cn-dur-2) var(--cn-ease-out);
}
.card:hover .icon { transform: translateY(-1px) scale(1.04); }
.idx { color: var(--cn-subtle); font-family: var(--cn-font-mono); font-size: 10px; letter-spacing: 0.12em; }
.card h3 {
  margin: 20px 0 7px; position: relative; z-index: 1;
  font-family: var(--cn-font-display);
  font-size: 19px; line-height: 1.25; font-weight: 650; color: var(--cn-fg);
}
.desc { margin: 0; position: relative; z-index: 1; color: var(--cn-accent); font-size: 12.5px; font-weight: 550; }
.note {
  margin: 7px 0 0; position: relative; z-index: 1;
  min-height: 42px; color: var(--cn-muted); font-size: 12px; line-height: 1.7;
}

.steps { display: grid; gap: 8px; margin: 18px 0 20px; position: relative; z-index: 1; }
.step { display: flex; align-items: center; gap: 9px; color: var(--cn-fg-soft); font-size: 12px; }
.snum {
  width: 20px; height: 20px; border-radius: 50%; flex: none;
  border: 1px solid var(--cn-border-strong);
  display: grid; place-items: center;
  color: var(--cn-accent); font-family: var(--cn-font-mono); font-size: 10px;
  background: var(--cn-surface-soft);
}

.enter {
  margin-top: auto;
  display: flex; align-items: center; justify-content: space-between;
  padding-top: 15px; border-top: 1px solid var(--cn-border);
  color: var(--cn-accent); font-size: 12.5px; font-weight: 650;
  position: relative; z-index: 1;
}
.enter :deep(.v-icon) { transition: transform var(--cn-dur-2) var(--cn-ease-out); }
.card:hover .enter :deep(.v-icon) { transform: translateX(4px); }

/* ---- 页脚 ---- */
.foot {
  position: relative; margin-top: auto; padding-top: 34px;
  display: flex; justify-content: space-between; align-items: center;
  color: var(--cn-subtle); font-family: var(--cn-font-mono); font-size: 10.5px; letter-spacing: 0.03em;
  animation: rise var(--cn-dur-5) var(--cn-ease-out) both;
  animation-delay: 420ms;
}
.offline { display: inline-flex; align-items: center; gap: 7px; }
.offline::before {
  content: ""; width: 5px; height: 5px; border-radius: 50%;
  background: var(--cn-success); box-shadow: 0 0 0 3px var(--cn-success-soft);
}

@keyframes rise {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (max-width: 760px) {
  .wrap { padding: 0 18px 18px; }
  .head { margin-top: 42px; }
  .sub { font-size: 12.5px; }
  .grid { margin-top: 26px; }
  .foot { flex-direction: column; gap: 6px; padding-top: 24px; }
}
@media (prefers-reduced-motion: reduce) {
  .kicker, .title, .sub, .card, .foot { animation: none; }
  .b1, .b2 { animation: none; }
  .card, .icon, .enter :deep(.v-icon) { transition: none; }
}
</style>
