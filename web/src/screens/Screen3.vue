<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { store, doGenerate } from '../store.ts'
import { downloadBase64, base64KB } from '../api.ts'
import type { GenLogLine } from '../store.ts'

const lines = ref<GenLogLine[]>([])
const pct = ref(0)
const phase = ref<'gen' | 'done'>('gen')
const logEl = ref<HTMLElement | null>(null)
const showLog = ref(false)

const excludedCount = computed(() => store.cases.filter(c => c.excluded).length)

onMounted(async () => {
  const ok = await doGenerate((newLines, p) => {
    if (newLines.length > 0) {
      for (const l of newLines) lines.value.push({ ...l, done: false })
      const last = lines.value[lines.value.length - 1]
      if (last) setTimeout(() => (last.done = true), 240)
    }
    pct.value = p
    requestAnimationFrame(() => logEl.value?.scrollTo({ top: logEl.value.scrollHeight }))
  })
  if (ok) phase.value = 'done'
})

function back(): void {
  store.screen = 2
}
function restart(): void {
  store.screen = 1
  store.parsed = false
  store.genResult = null
}
function dl(which: 'spec' | 'rec'): void {
  const r = store.genResult!
  // v1.3.0 双轨：≤10MB 响应带 base64 可下载；大文档无 base64，按落盘路径取用
  if (!r.spec || !r.rec) return
  downloadBase64(which === 'spec' ? r.spec : r.rec, which === 'spec' ? r.specName : r.recName)
}
const specKB = computed(() => (store.genResult?.spec ? base64KB(store.genResult.spec) : ''))
const recKB = computed(() => (store.genResult?.rec ? base64KB(store.genResult.rec) : ''))
</script>

<template>
  <div class="wrap">
    <div v-if="phase === 'gen'" class="gen">
      <div class="gen-card">
        <div class="gen-head">
          <div class="gen-title">正在生成文档</div>
          <span class="u-mono gen-pct">{{ pct }}%</span>
        </div>
        <div class="bar"><i :style="{ width: pct + '%' }" /></div>
        <div class="row"><span>正在按测试项表格逐张渲染</span></div>
        <div ref="logEl" class="log">
          <div v-for="(l, i) in lines" :key="i" class="line">
            <span class="lk" :class="{ ok: l.done && !l.warn, warn: l.warn }">{{ l.warn ? '⚠' : l.done ? '✓' : '›' }}</span>
            <span class="lt" :class="{ warn: l.warn }">{{ l.text }}</span>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="done">
      <div class="success-wrap">
        <div class="success-orbit">
          <div class="success-mark"><v-icon size="26">mdi-check</v-icon></div>
        </div>
        <h2>生成完成</h2>
        <p class="sub">两份文档已按模板渲染完成，章节顺序与大纲一致。<span v-if="excludedCount">（已排除 {{ excludedCount }} 个用例）</span></p>

        <v-alert v-if="store.genWarnings.length" type="warning" variant="tonal" density="compact" class="gen-warn">
          <template v-for="w in store.genWarnings" :key="w">{{ w }}。<br /></template>
          建议返回核对后再出正式文档。
        </v-alert>
        <v-alert v-if="store.genResult?.recSkipped" type="info" variant="tonal" density="compact" class="gen-warn">
          {{ store.genResult.recNote }}
        </v-alert>

        <div class="download-grid">
          <div class="download-card">
            <div class="download-top">
              <div class="file-icon u-mono">DOCX</div>
              <div class="fi">
                <h3>{{ store.genResult?.specName }}</h3>
                <p class="u-mono">
                  <template v-if="specKB">{{ specKB }} KB</template>
                  <template v-else>{{ store.genResult?.files?.[0]?.sizeKB }} KB · 已保存到数据目录</template>
                </p>
              </div>
            </div>
            <div v-if="!specKB && store.genResult?.files?.[0]" class="fp u-mono">{{ store.genResult.files[0].path }}</div>
            <div class="download-foot">
              <span class="file-meta">测试说明</span>
              <v-btn v-if="specKB" size="small" variant="tonal" color="primary" @click="dl('spec')">下载</v-btn>
            </div>
          </div>

          <div class="download-card">
            <div class="download-top">
              <div class="file-icon u-mono">DOCX</div>
              <div class="fi">
                <h3>{{ store.genResult?.recName }}</h3>
                <p class="u-mono">
                  <template v-if="store.genResult?.recSkipped">未生成（用例数超出 Word 可用范围）</template>
                  <template v-else-if="recKB">{{ recKB }} KB</template>
                  <template v-else>{{ store.genResult?.files?.[1]?.sizeKB }} KB · 已保存到数据目录</template>
                </p>
              </div>
            </div>
            <div v-if="!recKB && !store.genResult?.recSkipped && store.genResult?.files?.[1]" class="fp u-mono">{{ store.genResult.files[1].path }}</div>
            <div class="download-foot">
              <span class="file-meta">测试记录</span>
              <v-btn v-if="recKB" size="small" variant="tonal" color="primary" @click="dl('rec')">下载</v-btn>
            </div>
          </div>
        </div>
        <div v-if="!specKB || (!recKB && !store.genResult?.recSkipped)" class="saved-hint">
          大文档不再经浏览器下载，请打开上方目录取用文件
        </div>

        <div class="logtoggle">
          <v-btn size="small" variant="text" color="primary" @click="showLog = !showLog">
            {{ showLog ? '收起生成日志' : '查看生成日志' }}
          </v-btn>
        </div>
        <div v-show="showLog" ref="logEl" class="log">
          <div v-for="(l, i) in lines" :key="i" class="line">
            <span class="lk" :class="{ ok: !l.warn, warn: l.warn }">{{ l.warn ? '⚠' : '✓' }}</span>
            <span class="lt" :class="{ warn: l.warn }">{{ l.text }}</span>
          </div>
        </div>

        <div class="cta">
          <v-btn variant="tonal" @click="back">返回修改</v-btn>
          <v-btn variant="text" color="primary" @click="restart">重新开始</v-btn>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wrap {
  position: relative;
  min-height: calc(100vh - 64px);
  padding: 34px 24px 46px;
  background-color: var(--cn-bg);
  background-image:
    radial-gradient(circle at 12% -8%, rgba(70, 151, 226, 0.12), transparent 38%),
    radial-gradient(circle at 96% 18%, rgba(55, 126, 192, 0.07), transparent 32%);
}

/* ---- 生成中 ---- */
.gen { max-width: 760px; margin: 6px auto 0; animation: rise var(--cn-dur-4) var(--cn-ease-out) both; }
.gen-card {
  padding: 20px 22px;
  background: var(--cn-surface);
  border: 1px solid var(--cn-border);
  border-radius: var(--cn-r-3);
  box-shadow: var(--cn-shadow-1);
}
.gen-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 12px; }
.gen-title { font-family: var(--cn-font-display); font-size: 16px; font-weight: 650; }
.gen-pct { color: var(--cn-accent); font-size: 14px; }
.row { display: flex; justify-content: space-between; font-size: 12px; color: var(--cn-muted); margin-top: 8px; }
.bar { height: 5px; border-radius: 3px; background: var(--cn-border); overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--cn-accent); border-radius: inherit; transition: width var(--cn-dur-4) var(--cn-ease-standard); }
.log {
  margin-top: 14px; height: 220px; overflow-y: auto;
  border: 1px solid var(--cn-border); border-radius: var(--cn-r-2);
  background: #0b1220; color: #c4ccdc;
  padding: 10px 12px;
  font-family: var(--cn-font-mono); font-size: 11px; line-height: 1.9;
  text-align: left;
}
.line { display: flex; align-items: flex-start; gap: 8px; }
.lk { flex: none; width: 12px; color: #e8c36a; }
.lk.ok { color: #7bd88f; }
.lt { flex: 1; min-width: 0; }
.lt.warn { color: #e8c36a; }

/* ---- 完成 ---- */
.done { display: grid; place-items: center; min-height: calc(100vh - 160px); }
.success-wrap { width: min(760px, 100%); text-align: center; animation: rise var(--cn-dur-5) var(--cn-ease-out) both; }
.success-orbit {
  position: relative; width: 92px; height: 92px; margin: 0 auto 18px;
  display: grid; place-items: center;
}
.success-orbit::before,
.success-orbit::after {
  content: ""; position: absolute; border-radius: 50%;
  border: 1px solid rgba(24, 121, 78, 0.35);
}
.success-orbit::before { inset: 0; }
.success-orbit::after { inset: 10px; border-style: dashed; animation: rotate 18s linear infinite; }
@keyframes rotate { to { transform: rotate(360deg); } }
.success-mark {
  width: 56px; height: 56px; border-radius: 50%;
  display: grid; place-items: center;
  color: var(--cn-success);
  background: var(--cn-success-soft);
  border: 1px solid rgba(24, 121, 78, 0.35);
  box-shadow: 0 8px 28px rgba(24, 121, 78, 0.12);
}
.done h2 {
  margin: 0; font-family: var(--cn-font-display);
  font-size: 27px; line-height: 1.2; font-weight: 650; letter-spacing: -0.03em; color: var(--cn-fg);
}
.sub { margin: 9px 0 0; color: var(--cn-muted); font-size: 12.5px; }
.gen-warn { margin: 16px auto 0; max-width: 620px; font-size: 12.5px; text-align: left; }

.download-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 26px; text-align: left; }
@media (max-width: 700px) { .download-grid { grid-template-columns: 1fr; } }
.download-card {
  padding: 16px;
  background: var(--cn-surface);
  border: 1px solid var(--cn-border-strong);
  border-radius: var(--cn-r-2);
  box-shadow: var(--cn-shadow-1);
}
.download-top { display: flex; gap: 12px; align-items: center; }
.file-icon {
  width: 38px; height: 46px; flex: none; position: relative;
  border-radius: 4px;
  background: var(--cn-accent-soft);
  border: 1px solid var(--cn-accent-line);
  display: grid; place-items: end center; padding-bottom: 5px;
  color: var(--cn-accent); font-size: 10px; font-weight: 700; letter-spacing: 0.04em;
}
.file-icon::before {
  content: ""; position: absolute; right: -1px; top: -1px;
  border-left: 10px solid transparent;
  border-bottom: 10px solid var(--cn-surface);
}
.fi { min-width: 0; }
.fi h3 { margin: 0; font-size: 12.5px; font-weight: 650; color: var(--cn-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fi p { margin: 3px 0 0; color: var(--cn-subtle); font-size: 10.5px; }
.fp { margin-top: 8px; color: var(--cn-subtle); font-size: 10px; word-break: break-all; }
.download-foot {
  display: flex; justify-content: space-between; align-items: center;
  margin-top: 13px; padding-top: 11px; border-top: 1px solid var(--cn-border);
}
.file-meta { color: var(--cn-subtle); font-size: 10.5px; }
.saved-hint { margin-top: 10px; color: var(--cn-warning); font-size: 11px; text-align: center; }
.logtoggle { margin-top: 14px; }
.done .log { max-height: 220px; }
.cta { display: flex; gap: 10px; justify-content: center; margin-top: 18px; }

@keyframes rise {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .gen, .success-wrap { animation: none; }
  .success-orbit::after { animation: none; }
}
</style>
