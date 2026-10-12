<script setup lang="ts">
import { openTool } from '../store.ts'

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
    <!-- 环境层：主色系光晕 + 点阵网格（径向渐变自带柔边，不用 blur 滤镜） -->
    <div class="ambient" aria-hidden="true">
      <div class="blob b1" />
      <div class="blob b2" />
      <div class="blob b3" />
      <div class="dots" />
    </div>

    <div class="head">
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
        <v-icon class="wm" size="110" aria-hidden="true">{{ t.icon }}</v-icon>
        <div class="inner">
          <div class="icon"><v-icon size="30">{{ t.icon }}</v-icon></div>
          <div class="name">{{ t.name }}</div>
          <div class="desc">{{ t.desc }}</div>
          <div class="note">{{ t.note }}</div>
          <div class="steps">
            <span v-for="(s, j) in t.steps" :key="s" class="spill">
              <span class="sdot">{{ j + 1 }}</span>{{ s }}
            </span>
          </div>
          <div class="enter">
            <span>进入</span>
            <v-icon size="16">mdi-arrow-right</v-icon>
          </div>
        </div>
      </button>
    </div>

    <div class="foot">全程离线运行，文档内容不出本机。</div>
  </div>
</template>

<style scoped>
/* ===== 蓝调鎏光首屏（2026-10-12 用户拍板"首页华丽点"）=====
   环境光晕 + 点阵网格 + 渐变墨水标题 + 跟随光标聚光边框卡片 + 进场编排。
   全部主题 token / 纯 CSS，离线零外链；reduced-motion 全量降级；
   内网老 Chromium（Edge 100）兼容优先：clip/遮罩类属性带 -webkit- 前缀并以 @supports 兜底。 */
.wrap {
  --b1a: 0.13; --b2a: 0.11; --b3a: 0.09; /* 光晕浓度（深色主题加深） */
  --ring: 0.7;                            /* 聚光边框亮度 */
  --mx: 50%; --my: 36%;                   /* 聚光默认位（键盘 focus 态居中） */
  position: relative;
  min-height: calc(100vh - 64px);
  overflow: hidden;
  display: flex; flex-direction: column;
  padding: 0 22px 30px;
}
.v-theme--dark .wrap { --b1a: 0.26; --b2a: 0.2; --b3a: 0.16; --ring: 0.9; }

/* ---- 环境层 ---- */
.ambient { position: absolute; inset: 0; pointer-events: none; }
.blob { position: absolute; border-radius: 50%; }
.b1 {
  width: 680px; height: 680px; left: -200px; top: -260px;
  background: radial-gradient(circle closest-side, rgba(var(--v-theme-primary), var(--b1a)), rgba(var(--v-theme-primary), 0) 72%);
  animation: drift1 26s ease-in-out infinite alternate;
}
.b2 {
  width: 560px; height: 560px; right: -180px; top: 4%;
  background: radial-gradient(circle closest-side, rgba(79, 144, 201, var(--b2a)), rgba(79, 144, 201, 0) 72%);
  animation: drift2 32s ease-in-out infinite alternate;
}
.b3 {
  width: 940px; height: 430px; left: calc(50% - 470px); bottom: -250px;
  background: radial-gradient(circle closest-side, rgba(var(--v-theme-primary), var(--b3a)), rgba(var(--v-theme-primary), 0) 74%);
  animation: drift3 38s ease-in-out infinite alternate;
}
@keyframes drift1 { to { transform: translate(70px, 46px) scale(1.07); } }
@keyframes drift2 { to { transform: translate(-60px, -42px) scale(1.1); } }
@keyframes drift3 { to { transform: translate(46px, -26px) scale(1.04); } }

/* 点阵网格：工程坐标纸质感，径向 mask 向边缘淡出（前缀 + 标准，属性名不同不属压缩器合并对象） */
.dots {
  position: absolute; inset: 0;
  background-image: radial-gradient(rgba(var(--v-theme-on-surface), 0.13) 1px, transparent 1.4px);
  background-size: 26px 26px;
  -webkit-mask-image: radial-gradient(ellipse 72% 58% at 50% 36%, #000 26%, transparent 74%);
  mask-image: radial-gradient(ellipse 72% 58% at 50% 36%, #000 26%, transparent 74%);
  opacity: 0.5;
}

/* ---- 首屏标题 ---- */
.head { text-align: center; margin-top: 76px; position: relative; }
.title {
  font-size: 34px; font-weight: 700; letter-spacing: 0.3px;
  color: rgb(var(--v-theme-primary)); /* @supports 兜底：clip 不支持时仍是实色可读 */
}
@supports ((-webkit-background-clip: text) or (background-clip: text)) {
  .title {
    background-image: linear-gradient(105deg, #24507f 0%, #2d5b91 34%, #4c86c6 68%, #6fa3d8 100%);
    background-size: 200% 100%;
    -webkit-background-clip: text; background-clip: text;
    color: transparent;
    animation: ink 7s ease-in-out infinite alternate;
  }
  .v-theme--dark .title {
    background-image: linear-gradient(105deg, #8fb4e3 0%, #b7d0f0 48%, #7fa8dc 100%);
  }
}
@keyframes ink { to { background-position: 100% 0; } }
.sub {
  margin-top: 12px; font-size: 14px;
  color: rgba(var(--v-theme-on-surface), 0.66);
  animation: rise 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: 80ms;
}

/* ---- 卡片 ---- */
.grid {
  position: relative;
  margin-top: 44px;
  display: grid; grid-template-columns: 1fr 1fr; gap: 20px;
  max-width: 880px; width: 100%; margin-left: auto; margin-right: auto;
}
@media (max-width: 760px) { .grid { grid-template-columns: 1fr; } }

.card {
  position: relative; text-align: left; cursor: pointer;
  background: transparent; border: 1px solid rgba(var(--v-theme-outline), 0.5);
  border-radius: 14px; padding: 0;
  display: flex; /* 让 .inner 拉伸填满：两卡内容长度不同也等高等沿（用户反馈"两卡样式不一样"） */
  animation: rise 0.55s cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: calc(150ms + var(--i) * 130ms);
  transition: box-shadow 0.2s, transform 0.2s, border-color 0.2s;
}
/* 聚光边框：渐变环画在 ::before（inset -1px 外溢 1px），实体底色移到 .inner
   —— 卡片背景透明，.inner 盖住环的中部，只露出边缘一圈，跟随光标流动 */
.card::before {
  content: ''; position: absolute; inset: -1px; z-index: -1;
  border-radius: inherit;
  background: radial-gradient(
    280px circle at var(--mx) var(--my),
    rgba(var(--v-theme-primary), var(--ring)),
    rgba(var(--v-theme-primary), 0.18) 45%,
    transparent 72%
  );
  opacity: 0; transition: opacity 0.25s;
  pointer-events: none;
}
.card:hover::before, .card:focus-visible::before { opacity: 1; }
.card:hover {
  transform: translateY(-4px);
  border-color: rgba(var(--v-theme-primary), 0.35);
  box-shadow: 0 14px 34px rgba(45, 91, 145, 0.18);
}
.card:active { transform: translateY(-1px) scale(0.995); }
.card:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 3px; }

/* 实体底色在 .inner（内容层），盖住聚光环中部；z-index 压过水印图标 */
.inner {
  position: relative; z-index: 1;
  flex: 1; /* 填满卡片高度，消除内容短卡的底部缺口 */
  background: rgb(var(--v-theme-surface));
  border-radius: 13px;
  padding: 22px 22px 16px;
  display: flex; flex-direction: column;
  transition: background 0.2s;
}
.card:hover .inner { background: linear-gradient(rgba(var(--v-theme-primary), 0.05), rgba(var(--v-theme-primary), 0)), rgb(var(--v-theme-surface)); }

/* 角落水印大图标（低透明度，hover 微动） */
.wm {
  position: absolute; right: -14px; top: -16px; z-index: 0;
  opacity: 0.055; color: rgb(var(--v-theme-primary));
  pointer-events: none;
  transition: transform 0.3s ease;
}
.card:hover .wm { transform: scale(1.07) rotate(-3deg); }

.icon {
  width: 52px; height: 52px; border-radius: 13px;
  background: linear-gradient(135deg, #3d6fb5 0%, #2d5b91 60%, #24507f 100%);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 12px rgba(45, 91, 145, 0.24);
  transition: transform 0.2s, box-shadow 0.2s;
}
.card:hover .icon {
  transform: translateY(-1px) scale(1.05);
  box-shadow: 0 6px 18px rgba(45, 91, 145, 0.36);
}
.name { margin-top: 14px; font-size: 17px; font-weight: 650; }
.desc { margin-top: 4px; font-size: 13.5px; font-weight: 550; color: rgb(var(--v-theme-primary)); }
.note { margin-top: 6px; font-size: 12.5px; line-height: 1.6; color: rgba(var(--v-theme-on-surface), 0.62); }

.steps { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; margin-bottom: 14px; }
.spill {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.72);
  background: rgba(var(--v-theme-primary), 0.07);
  border-radius: 999px; padding: 3px 10px 3px 4px;
}
.sdot {
  width: 17px; height: 17px; border-radius: 50%; flex: none;
  background: rgb(var(--v-theme-primary)); color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 10.5px; font-weight: 600;
}

.enter {
  margin-top: auto; padding-top: 12px; /* 钉底：两卡"进入"行恒对齐 */
  border-top: 1px solid rgba(var(--v-theme-outline), 0.4);
  display: flex; align-items: center; justify-content: flex-end; gap: 3px;
  font-size: 13px; font-weight: 600; color: rgb(var(--v-theme-primary));
  transition: gap 0.15s;
}
.card:hover .enter { gap: 7px; }

.foot {
  position: relative;
  margin-top: auto; padding-top: 34px;
  text-align: center; font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  animation: rise 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: 480ms;
}

/* ---- 进场编排 ---- */
.head { animation: rise 0.5s cubic-bezier(0.16, 1, 0.3, 1) both; }
@keyframes rise {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (max-width: 760px) {
  .head { margin-top: 42px; }
  .title { font-size: 25px; }
  .sub { font-size: 13px; }
  .grid { margin-top: 30px; }
}

@media (prefers-reduced-motion: reduce) {
  .blob, .title, .head, .card, .sub, .foot { animation: none; }
  .card, .icon, .wm { transition: none; }
}
</style>
