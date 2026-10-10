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
    desc: '测试大纲 → 追踪关系文档',
    note: '生成"大纲 ↔ 需求规格说明"追踪表，复制进自有文档',
    steps: ['选大纲', '生成下载']
  }
]
</script>

<template>
  <div class="wrap">
    <div class="head">
      <h1>选择一个工具开始</h1>
    </div>
    <div class="grid">
      <button
        v-for="(t, i) in TOOLS" :key="t.key"
        class="card" :style="{ '--i': i }"
        @click="openTool(t.key)"
      >
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
      </button>
    </div>
    <div class="foot">全程离线运行，文档内容不出本机。</div>
  </div>
</template>

<style scoped>
.wrap { max-width: 880px; margin: 0 auto; padding: 0 22px 40px; }
.head { text-align: center; margin-top: 44px; }
h1 { font-size: 21px; font-weight: 650; color: rgba(var(--v-theme-on-surface), 0.85); }

.grid {
  margin-top: 30px;
  display: grid; grid-template-columns: 1fr 1fr; gap: 20px;
}
@media (max-width: 760px) { .grid { grid-template-columns: 1fr; } }

.card {
  text-align: left; cursor: pointer;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-outline), 0.5);
  border-radius: 14px;
  padding: 22px 22px 16px;
  display: flex; flex-direction: column;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.05);
  transition: box-shadow 0.2s, transform 0.2s, border-color 0.2s;
  animation: cardIn 0.34s ease-out both;
  animation-delay: calc(var(--i) * 150ms);
}
.card:hover {
  transform: translateY(-2px);
  border-color: rgba(var(--v-theme-primary), 0.45);
  box-shadow: 0 8px 22px rgba(45, 91, 145, 0.14);
}
.card:active { transform: translateY(0) scale(0.995); }
.card:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 2px; }
@keyframes cardIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .card { animation: none; transition: none; }
}

.icon {
  width: 52px; height: 52px; border-radius: 13px;
  background: linear-gradient(135deg, #3d6fb5 0%, #2D5B91 60%, #24507f 100%);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 12px rgba(45, 91, 145, 0.24);
}
.name { margin-top: 14px; font-size: 17px; font-weight: 650; }
.desc { margin-top: 4px; font-size: 13.5px; font-weight: 550; color: rgb(var(--v-theme-primary)); }
.note { margin-top: 6px; font-size: 12.5px; line-height: 1.6; color: rgba(var(--v-theme-on-surface), 0.62); }

.steps { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }
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
  margin-top: 14px; padding-top: 12px;
  border-top: 1px solid rgba(var(--v-theme-outline), 0.4);
  display: flex; align-items: center; justify-content: flex-end; gap: 3px;
  font-size: 13px; font-weight: 600; color: rgb(var(--v-theme-primary));
  transition: gap 0.15s;
}
.card:hover .enter { gap: 7px; }

.foot { text-align: center; font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 34px; }
</style>
