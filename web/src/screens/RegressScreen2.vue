<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { store, doRegressGenerate, showToast } from '../store.ts'
import { downloadBase64 } from '../api.ts'
import type { RegFailCase } from '../types.ts'

// 回归测试说明 第 2 步（F11/13）：不通过用例勾选 → 生成 → 结果卡
const selected = ref<string[]>([])
const allCaseIds = computed(() => store.regressDraft?.types.flatMap(t => t.cases.map(c => c.caseId)) ?? [])
const allSelected = computed(() => selected.value.length === allCaseIds.value.length && allCaseIds.value.length > 0)

onMounted(() => {
  // 默认全选命中用例（未匹配项本就不在 types 里，不参与勾选）
  selected.value = [...allCaseIds.value]
})

function toggle(c: RegFailCase): void {
  const i = selected.value.indexOf(c.caseId)
  if (i >= 0) selected.value.splice(i, 1)
  else selected.value.push(c.caseId)
}
function toggleAll(): void {
  selected.value = allSelected.value ? [] : [...allCaseIds.value]
}
function checked(c: RegFailCase): boolean {
  return selected.value.includes(c.caseId)
}
/** 同一 caseId 在草稿里只出现一次（选择层已去重），勾选切换按标识定位 */
function failStepsText(c: RegFailCase): string {
  return c.failSteps.length === c.stepCount ? '全部步骤' : '第 ' + c.failSteps.join('、') + ' 步'
}

async function generate(): Promise<void> {
  const ok = await doRegressGenerate(selected.value)
  if (ok) showToast('回归测试说明与回归测试记录已生成')
}

function download(f: { name: string; doc?: string }): void {
  if (f.doc) downloadBase64(f.doc, f.name)
}
function regenerate(): void {
  store.regressResult = null
}
</script>

<template>
  <div class="amb-wrap">
    <div class="amb" aria-hidden="true">
      <div class="amb-b1" /><div class="amb-b2" />
    </div>
    <div class="wrap">
    <template v-if="store.regressDraft === null">
      <div class="u-empty hero-empty">
        <v-icon size="26">mdi-history</v-icon>
        <b>还没有解析草稿</b>
        <span>回到第 1 步上传测试记录并配对大纲，再来这里勾选生成。</span>
        <v-btn size="small" variant="tonal" color="primary" @click="store.regressScreen = 1">返回第 1 步</v-btn>
      </div>
    </template>

    <template v-else-if="store.regressResult !== null">
      <!-- 生成结果卡（双产物：说明 + 记录） -->
      <div class="result-card glass">
        <div class="rc-head">
          <v-icon size="22" color="success">mdi-check-circle</v-icon>
          <div>
            <h2>回归测试文档已生成</h2>
            <p>回归测试说明（4.1 / 5 / 6 三章）与回归测试记录（第 2 章测试记录，实测预填期望、通过与否预填通过、时间按范围铺开）两份同时生成。</p>
          </div>
        </div>
        <div v-for="f in store.regressResult" :key="f.name" class="rc-file">
          <v-icon size="19" color="primary">mdi-file-word-box</v-icon>
          <div class="rc-file-main">
            <div class="rc-name">{{ f.name }}</div>
            <div class="rc-path">{{ f.path }}</div>
          </div>
          <span class="rc-size">{{ f.sizeKB }} KB</span>
          <v-btn v-if="f.doc" size="small" variant="tonal" color="primary" @click="download(f)">
            <v-icon size="15" class="mr-1">mdi-download</v-icon>下载
          </v-btn>
        </div>
        <div class="rc-acts">
          <v-btn variant="text" @click="regenerate">
            <v-icon size="16" class="mr-1">mdi-refresh</v-icon>调整勾选重新生成
          </v-btn>
        </div>
      </div>
      <div class="foot">两份文件同时保存在上方路径，每次生成覆盖旧文件。</div>
    </template>

    <template v-else>
      <!-- 草稿勾选 -->
      <div class="hero">
        <h1 class="amb-title">勾选要回归的用例</h1>
        <p>
          记录 <b>{{ store.regressPrimary.name.replace(/\.docx$/i, '') }}</b>
          · 大纲 <b>{{ store.regressOutline.name.replace(/\.docx$/i, '') }}</b>
          · 共 {{ store.regressDraft.stats.failed }} 个不通过用例
          <button type="button" class="back1" @click="store.regressScreen = 1">← 返回重选文档</button>
        </p>
      </div>

      <div class="toolbar">
        <v-btn size="small" variant="tonal" color="primary" @click="toggleAll">
          {{ allSelected ? '取消全选' : '全选' }}
        </v-btn>
        <span class="count">已勾选 <b>{{ selected.length }}</b> / {{ allCaseIds.length }} 个用例</span>
        <v-spacer />
        <v-btn color="primary" size="large" rounded="pill" :loading="store.regressGenerating" @click="generate">
          生成回归测试说明<v-icon size="17" class="ml-2">mdi-file-word-box</v-icon>
        </v-btn>
      </div>

      <!-- 未匹配告警行（默认不生成） -->
      <div v-if="store.regressDraft.unmatched.length > 0" class="u-alerts">
        <div v-for="u in store.regressDraft.unmatched" :key="u.recordCaseId" class="u-row">
          <v-icon size="15" color="warning">mdi-alert-outline</v-icon>
          <span><b>{{ u.recordCaseId }}</b>（{{ u.recordCaseName }}）在测试大纲中未找到对应用例，默认不生成，请人工核对</span>
        </div>
      </div>

      <!-- 类型分组清单 -->
      <div v-for="t in store.regressDraft.types" :key="t.typeName" class="group glass">
        <div class="g-head">
          <v-icon size="15" color="primary">mdi-bookmark-outline</v-icon>
          <b>{{ t.typeName }}</b>
          <span class="g-chapter">产物小节 {{ t.reqChapter }} · {{ t.cases.length }} 个用例</span>
        </div>
        <div
          v-for="c in t.cases" :key="c.caseId"
          class="row" :class="{ on: checked(c) }"
          role="checkbox" :aria-checked="checked(c)" tabindex="0"
          @click="toggle(c)" @keydown.enter="toggle(c)"
        >
          <span class="cb" :class="{ on: checked(c) }" aria-hidden="true">
            <v-icon v-if="checked(c)" size="13">mdi-check</v-icon>
          </span>
          <div class="r-main">
            <div class="r-name">{{ c.mingcheng }}<span class="r-id u-mono">{{ c.caseId }}</span></div>
            <div class="r-meta">
              <span>所属测试项：{{ c.itemName }}（{{ c.itemId }}）</span>
              <span class="r-fail">{{ failStepsText(c) }}不通过</span>
              <span v-if="c.problemId && c.problemId !== '/'">问题单 {{ c.problemId }}</span>
              <span class="r-req">→ 产物 {{ c.reqChapter }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="foot">用例属性一律「继承」（沿用上一轮步骤原文）；未勾选的用例不出现在产物中。</div>
    </template>
    </div>
  </div>
</template>

<style scoped>
.wrap { position: relative; width: 100%; max-width: 1240px; margin: 0 auto; padding: 24px 24px 30px; }
.hero { text-align: left; margin-bottom: 12px; animation: rise var(--cn-dur-4) var(--cn-ease-out) both; }
.hero h1 { margin: 0; font-family: var(--cn-font-display); font-size: 24px; font-weight: 650; letter-spacing: -0.025em; color: var(--cn-fg); }
.hero p { margin: 7px 0 0; color: var(--cn-muted); font-size: 12px; line-height: 1.7; }
.hero p b { color: var(--cn-fg-soft); font-weight: 600; }
.back1 { margin-left: 10px; border: 0; background: none; color: var(--cn-accent); font-size: 11.5px; cursor: pointer; }
.back1:hover { text-decoration: underline; }

.toolbar { display: flex; align-items: center; gap: 12px; margin: 10px 0 12px; }
.count { font-size: 12px; color: var(--cn-muted); }
.count b { color: var(--cn-accent); }

.u-alerts { margin-bottom: 12px; border: 1px solid var(--cn-warning); border-radius: var(--cn-r-2); background: var(--cn-surface); overflow: hidden; }
.u-row { display: flex; align-items: center; gap: 8px; padding: 9px 13px; font-size: 12px; color: var(--cn-fg-soft); }
.u-row + .u-row { border-top: 1px solid var(--cn-border); }
.u-row b { color: var(--cn-fg); }

.group { background: var(--cn-surface); border: 1px solid var(--cn-border); border-radius: var(--cn-r-3); box-shadow: var(--cn-shadow-1); overflow: hidden; margin-bottom: 14px; }
.g-head { display: flex; align-items: center; gap: 7px; padding: 11px 14px; border-bottom: 1px solid var(--cn-border); font-size: 13px; }
.g-head b { color: var(--cn-fg); }
.g-chapter { font-size: 11px; color: var(--cn-subtle); }
.row { display: flex; align-items: center; gap: 11px; padding: 10px 14px; cursor: pointer; transition: background var(--cn-dur-1) var(--cn-ease-out); }
.row:hover { background: var(--cn-surface-soft); }
.row + .row { border-top: 1px solid var(--cn-border); }
.row.on { background: var(--cn-accent-soft); }
.cb {
  width: 18px; height: 18px; flex: none; border-radius: 5px;
  border: 1.5px solid var(--cn-border-strong); background: var(--cn-surface);
  display: grid; place-items: center; color: #fff;
  transition: background var(--cn-dur-1) var(--cn-ease-out), border-color var(--cn-dur-1) var(--cn-ease-out);
}
.cb.on { background: var(--cn-accent); border-color: var(--cn-accent); }
.r-main { flex: 1; min-width: 0; }
.r-name { font-size: 13px; font-weight: 600; color: var(--cn-fg); }
.r-id { margin-left: 8px; font-size: 11px; color: var(--cn-subtle); font-weight: 450; }
.r-meta { margin-top: 3px; display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 11.5px; color: var(--cn-subtle); }
.r-fail { color: var(--cn-danger-text); }
.r-req { color: var(--cn-accent); }

.hero-empty { margin: 60px auto 0; max-width: 420px; padding: 30px 24px; }
.result-card { padding: 18px 20px; max-width: 760px; }
.rc-head { display: flex; gap: 12px; align-items: flex-start; }
.rc-head h2 { margin: 0; font-size: 16px; font-weight: 650; color: var(--cn-fg); }
.rc-head p { margin: 5px 0 0; font-size: 12px; color: var(--cn-muted); line-height: 1.7; }
.rc-file { display: flex; align-items: center; gap: 10px; margin-top: 16px; padding: 12px 14px; border: 1px solid var(--cn-border); border-radius: var(--cn-r-2); background: var(--cn-surface-soft); }
.rc-file-main { flex: 1; min-width: 0; }
.rc-name { font-size: 13px; font-weight: 600; color: var(--cn-fg); }
.rc-path { margin-top: 3px; font-size: 11px; color: var(--cn-subtle); word-break: break-all; }
.rc-size { flex: none; font-size: 11.5px; color: var(--cn-muted); font-family: var(--cn-font-mono); }
.rc-acts { display: flex; gap: 10px; margin-top: 14px; }

.foot { margin-top: 16px; text-align: center; color: var(--cn-subtle); font-family: var(--cn-font-mono); font-size: 10px; letter-spacing: 0.03em; }

@keyframes rise {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .hero { animation: none; }
}
</style>
