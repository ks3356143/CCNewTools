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
  downloadBase64(which === 'spec' ? r.spec : r.rec, which === 'spec' ? r.specName : r.recName)
}
const specKB = computed(() => (store.genResult ? base64KB(store.genResult.spec) : ''))
const recKB = computed(() => (store.genResult ? base64KB(store.genResult.rec) : ''))
</script>

<template>
  <div class="wrap">
    <div v-if="phase === 'gen'" class="gen">
      <v-card rounded="lg" elevation="1" class="card">
        <div class="title">正在生成文档</div>
        <div class="row"><span>正在按测试项表格逐张渲染</span><b>{{ pct }}%</b></div>
        <div class="bar"><i :style="{ width: pct + '%' }" /></div>
        <div ref="logEl" class="log">
          <div v-for="(l, i) in lines" :key="i" class="line">
            <span class="lk" :class="{ ok: l.done && !l.warn, warn: l.warn }">{{ l.warn ? '⚠' : l.done ? '✓' : '›' }}</span>
            <span class="lt" :class="{ warn: l.warn }">{{ l.text }}</span>
          </div>
        </div>
      </v-card>
    </div>

    <div v-else class="done">
      <div class="badge"><v-icon size="38">mdi-check</v-icon></div>
      <h1>生成完成</h1>
      <p class="sub">两份文档已按模板渲染完成，章节顺序与大纲一致。<span v-if="excludedCount">（已排除 {{ excludedCount }} 个用例）</span></p>
      <div v-if="store.genWarnings.length" class="warnbox">
        <v-icon size="18">mdi-alert</v-icon>
        <div class="wt">
          <template v-for="w in store.genWarnings" :key="w">{{ w }}。</template>
          建议返回核对后再出正式文档。
        </div>
      </div>
      <v-card rounded="lg" elevation="1" class="files">
        <div class="frow">
          <v-icon size="21" color="primary">mdi-file-word-box</v-icon>
          <div class="fi">
            <div class="fn">{{ store.genResult?.specName }}</div>
            <div class="fm">{{ specKB }} KB</div>
          </div>
          <v-btn size="small" rounded="pill" variant="tonal" color="primary" @click="dl('spec')">下载</v-btn>
        </div>
        <div class="frow">
          <v-icon size="21" color="primary">mdi-file-word-box</v-icon>
          <div class="fi">
            <div class="fn">{{ store.genResult?.recName }}</div>
            <div class="fm">{{ recKB }} KB</div>
          </div>
          <v-btn size="small" rounded="pill" variant="tonal" color="primary" @click="dl('rec')">下载</v-btn>
        </div>
      </v-card>
      <div class="logtoggle">
        <v-btn size="small" variant="text" color="primary" @click="showLog = !showLog">
          {{ showLog ? '收起日志' : '查看生成日志' }}
        </v-btn>
      </div>
      <div v-show="showLog" ref="logEl" class="log">
        <div v-for="(l, i) in lines" :key="i" class="line">
          <span class="lk" :class="{ ok: !l.warn, warn: l.warn }">{{ l.warn ? '⚠' : '✓' }}</span>
          <span class="lt" :class="{ warn: l.warn }">{{ l.text }}</span>
        </div>
      </div>
      <div class="cta">
        <v-btn rounded="pill" variant="tonal" @click="back">返回修改</v-btn>
        <v-btn variant="text" color="primary" @click="restart">重新开始</v-btn>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wrap { max-width: 860px; margin: 40px auto 0; padding: 0 24px 50px; }
.gen .card { padding: 20px 22px; }
.title { text-align: center; font-size: 17px; font-weight: 650; margin-bottom: 16px; }
.row { display: flex; justify-content: space-between; font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.65); margin-bottom: 7px; }
.row b { color: rgb(var(--v-theme-on-surface)); font-variant-numeric: tabular-nums; }
.bar { height: 7px; border-radius: 999px; background: rgba(var(--v-theme-outline), 0.5); overflow: hidden; }
.bar i { display: block; height: 100%; background: rgb(var(--v-theme-primary)); transition: width 0.3s; }
.log {
  margin-top: 16px; height: 210px; overflow-y: auto; border-radius: 12px;
  background: #10141d; color: #c4ccdc; padding: 10px 14px;
  font-family: Consolas, monospace; font-size: 12px; line-height: 2;
}
.line { display: flex; align-items: flex-start; gap: 8px; }
.lk { flex: none; width: 13px; color: #e8c36a; }
.lk.ok { color: #7bd88f; }
.lt { flex: 1; min-width: 0; }
.lt.warn { color: #e8c36a; }
.done { text-align: center; }
.badge {
  width: 72px; height: 72px; border-radius: 24px; margin: 0 auto 18px;
  background: rgba(var(--v-theme-success), 0.15); color: rgb(var(--v-theme-success));
  display: flex; align-items: center; justify-content: center;
}
h1 { font-size: 22px; font-weight: 650; }
.sub { margin-top: 7px; color: rgba(var(--v-theme-on-surface), 0.65); font-size: 13.5px; }
.files { margin-top: 22px; text-align: left; overflow: hidden; }
.frow { display: flex; align-items: center; gap: 13px; padding: 14px 18px; }
.frow + .frow { border-top: 1px solid rgba(var(--v-theme-outline), 0.45); }
.fi { flex: 1; min-width: 0; }
.fn { font-size: 14px; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fm { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.55); }
.logtoggle { margin-top: 14px; }
.done .log { max-height: 220px; }
.warnbox {
  margin: 16px auto 0; max-width: 620px;
  display: flex; align-items: flex-start; gap: 10px; text-align: left;
  padding: 12px 16px; border-radius: 12px;
  background: rgba(var(--v-theme-warning), 0.14); color: rgb(var(--v-theme-warning));
  font-size: 13.5px; line-height: 1.7;
}
.warnbox .wt { flex: 1; min-width: 0; }
.cta { display: flex; gap: 10px; justify-content: center; margin-top: 18px; }
</style>
