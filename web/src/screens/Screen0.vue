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
  },
  {
    key: 'regress' as const,
    icon: 'mdi-history',
    name: '回归测试说明',
    desc: '测试大纲 + 测试记录 → 回归测试说明',
    note: '筛出记录中不通过的用例，生成 4.1 回归需求 / 5 概述 / 6 测试用例',
    steps: ['选大纲与记录', '生成下载']
  },
  {
    key: 'report' as const,
    icon: 'mdi-clipboard-check-outline',
    name: '报告统计与需求符合性',
    desc: '大纲 + 首轮/回归记录 → 软件测评报告',
    note: '需求符合性对照表逐条生成 · 统计数目界面直接展示 · 只填批注标注的内容',
    steps: ['选输入', '生成下载']
  }
]

/** 聚光跟手：光标位置写进 CSS 变量（直改 style，不进响应式、零重渲染） */
function trackGlow(e: MouseEvent): void {
  const el = e.currentTarget as HTMLElement
  const r = el.getBoundingClientRect()
  el.style.setProperty('--mx', `${e.clientX - r.left}px`)
  el.style.setProperty('--my', `${e.clientY - r.top}px`)
}
</script>

<template>
  <div class="wrap">
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
/* ===== 首页 v6「直角集中色 · 工程仪器」（2026-11-24 去 AI 化重塑）=====
   依据知识库「ChenMeridian-直角集中色风」：漂移光斑与渐变墨水标题退役；
   环境 = 平实纸底 + 静态点阵刻度；卡片直角 + 发丝线边界 + 小面积软阴影，
   聚光跟手保留（语言指定主动效之一），hover 不位移，高光为一次式回扫。 */
.wrap {
  position: relative;
  min-height: calc(100vh - 64px);
  display: flex; flex-direction: column;
  padding: 0 32px 22px;
  background-color: var(--cn-bg);
  background-image: radial-gradient(rgba(110, 153, 195, 0.16) 0.6px, transparent 0.8px);
  background-size: 18px 18px;
}
.v-theme--dark .wrap {
  background-image: radial-gradient(rgba(110, 153, 195, 0.12) 0.6px, transparent 0.8px);
}

/* ---- 标题区：左对齐工作台式（去居中营销式 hero） ---- */
.head { max-width: 1240px; margin: 64px auto 0; text-align: left; }
.kicker {
  display: inline-flex; align-items: center; gap: 8px; margin-bottom: 14px;
  color: var(--cn-accent); font-family: var(--cn-font-mono);
  font-size: 11px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase;
  animation: rise var(--cn-dur-5) var(--cn-ease-out) both;
}
.kicker::before {
  content: ""; width: 7px; height: 7px; flex: none;
  background: var(--cn-accent);
}
.title {
  margin: 0;
  font-family: var(--cn-font-display);
  font-size: clamp(26px, 2.6vw, 32px);
  line-height: 1.2; font-weight: 660; letter-spacing: -0.01em;
  color: var(--cn-fg);
  animation: rise var(--cn-dur-5) var(--cn-ease-out) both;
  animation-delay: 40ms;
}
.sub {
  margin: 10px 0 0; max-width: 640px;
  color: var(--cn-muted); font-size: 13px; line-height: 1.8;
  animation: rise var(--cn-dur-5) var(--cn-ease-out) both;
  animation-delay: 90ms;
}

/* ---- 工具卡片 ---- */
.grid {
  width: 100%; max-width: 1240px;
  margin: 34px auto 0;
  /* 四工具一排（2026-11-22 用户需求）：宽屏固定 4 列，卡片宽 ≈300px；
     中屏降 2×2，窄屏单列 */
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px;
}
@media (max-width: 1180px) { .grid { grid-template-columns: repeat(2, 1fr); } }
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
  transition: box-shadow var(--cn-dur-2) var(--cn-ease-out), border-color var(--cn-dur-2) var(--cn-ease-out);
  animation: rise var(--cn-dur-5) var(--cn-ease-out) both;
  animation-delay: calc(150ms + var(--i) * 90ms);
}
/* 聚光跟手：卡片内一层极轻径向光，不进内容区（语言指定主动效，保留） */
.card::before {
  content: "";
  position: absolute; inset: 0; pointer-events: none; z-index: 0;
  opacity: 0;
  background: radial-gradient(260px circle at var(--mx) var(--my), rgba(47, 128, 232, 0.13), transparent 68%);
  transition: opacity var(--cn-dur-2) var(--cn-ease-out);
}
/* 回扫高光：一次式从左到右轻扫后缓慢回位，全程起点终点不可见、只动 transform */
.card::after {
  content: "";
  position: absolute; top: 0; bottom: 0; left: 0; width: 55%; z-index: 0;
  pointer-events: none;
  background: linear-gradient(100deg, transparent, rgba(130, 180, 235, 0.1) 45%, transparent);
  transform: translateX(-110%) skewX(-14deg);
  opacity: 0;
}
.card:hover { box-shadow: var(--cn-shadow-2); border-color: var(--cn-accent-line); }
.card:hover::before { opacity: 1; }
.card:hover::after { animation: cn-sheen 1.1s var(--cn-ease-standard) 1 both; }
.card:active { box-shadow: var(--cn-shadow-1); border-color: var(--cn-accent); }
.card:focus-visible { outline: 2px solid var(--cn-accent); outline-offset: 3px; }
@keyframes cn-sheen {
  0% { transform: translateX(-110%) skewX(-14deg); opacity: 0; }
  10% { opacity: 1; }
  55% { transform: translateX(210%) skewX(-14deg); opacity: 0; }
  100% { transform: translateX(-110%) skewX(-14deg); opacity: 0; }
}

.top { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; position: relative; z-index: 1; }
.icon {
  width: 44px; height: 44px; border-radius: var(--cn-r-2);
  display: grid; place-items: center;
  color: var(--cn-accent);
  background: var(--cn-accent-soft);
  border: 1px solid var(--cn-accent-line);
  transition: border-color var(--cn-dur-2) var(--cn-ease-out), background-color var(--cn-dur-2) var(--cn-ease-out);
}
.card:hover .icon { border-color: var(--cn-accent); }
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
  .card::before, .card::after { animation: none; opacity: 0; }
  .card, .icon, .enter :deep(.v-icon) { transition: none; }
}
</style>
