<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useTheme } from 'vuetify'
import { store, scheduleSettingsSave, showToast, openTool, goHome } from './store.ts'
import { loadSettings } from './api.ts'
import Screen0 from './screens/Screen0.vue'
import Screen1 from './screens/Screen1.vue'
import Screen2 from './screens/Screen2.vue'
import Screen3 from './screens/Screen3.vue'
import TraceScreen1 from './screens/TraceScreen1.vue'
import TraceScreen2 from './screens/TraceScreen2.vue'

// vite define 注入（来源根 package.json）；必须先绑到局部常量——模板里直接写裸标识符
// 会被 Vue 编译成 _ctx.__APP_VERSION__ 属性访问，define 的标识符替换匹配不上
const appVersion = __APP_VERSION__

const theme = useTheme()
// 顶栏 stepper 随工具切换（11-工具集首页：顶栏三态）
const STEPS = {
  convert: ['选择大纲', '核对与编辑', '生成文档'],
  trace: ['选大纲', '生成文档']
} as const
// 使用说明对话框（08 交付物：内置界面，顶栏 ? 打开）
const about = ref(false)

/** 当前工具的步骤名与当前步（顶栏居中 stepper；首页态无 stepper） */
const curSteps = computed(() => (store.view === 'trace' ? STEPS.trace : STEPS.convert))
const curStep = computed(() => (store.view === 'trace' ? store.traceScreen : store.screen))

onMounted(async () => {
  try {
    const s = await loadSettings()
    if (s.theme === 'dark' || s.theme === 'light') {
      store.theme = s.theme
      theme.global.name.value = s.theme
    }
  } catch {
    // 服务未就绪时忽略
  }
})

function toggleTheme(): void {
  store.theme = store.theme === 'dark' ? 'light' : 'dark'
  theme.global.name.value = store.theme
  scheduleSettingsSave()
}

/** stepper 点击守卫（工具一守卫原样保留；工具二同构） */
function stepClick(n: number): void {
  if (store.view === 'trace') {
    if (n === 1) {
      store.traceScreen = 1
      return
    }
    if (!store.traceParsed) {
      showToast('请先选择并解析大纲')
      return
    }
    store.traceScreen = 2
    return
  }
  if (n === 1) {
    store.screen = 1
    return
  }
  if (!store.parsed) {
    showToast('请先选择并解析大纲')
    return
  }
  if (n === 3 && store.screen !== 3) {
    showToast('请先点击「生成文档」')
    return
  }
  store.screen = n as 2 | 3
}
</script>

<template>
  <v-app>
    <v-app-bar elevation="0" class="cn-bar">
      <!-- 工具态：左侧「‹ 工具集」返回；首页态：无 -->
      <button v-if="store.view !== 'home'" class="back" @click="goHome">
        <v-icon size="16">mdi-chevron-left</v-icon>
        <span>工具集</span>
      </button>
      <div class="brand">
        <div class="brand-mark"><v-icon size="17">mdi-file-word-box</v-icon></div>
        <span class="app-title">{{ store.view === 'home' ? '测试文档工具集' : store.view === 'convert' ? '大纲转换' : '追踪文档生成' }}</span>
        <span class="ver">v{{ appVersion }}</span>
      </div>
      <div class="spacer" />
      <nav v-if="store.view !== 'home'" class="stepper">
        <template v-for="(t, i) in curSteps" :key="t">
          <button
            class="step"
            :class="{ active: curStep === i + 1, done: curStep > i + 1 }"
            @click="stepClick(i + 1)"
          >
            <span class="dot">
              <v-icon v-if="curStep > i + 1" size="12">mdi-check</v-icon>
              <template v-else>{{ i + 1 }}</template>
            </span>
            <span class="lbl">{{ t }}</span>
          </button>
          <span v-if="i < curSteps.length - 1" class="link" />
        </template>
      </nav>
      <div class="spacer" />
      <button class="icon-btn" title="使用说明" @click="about = true">
        <v-icon size="17">mdi-help-circle-outline</v-icon>
      </button>
      <button class="icon-btn" :title="store.theme === 'dark' ? '切换浅色' : '切换深色'" @click="toggleTheme">
        <v-icon size="17">{{ store.theme === 'dark' ? 'mdi-weather-sunny' : 'mdi-weather-night' }}</v-icon>
      </button>
    </v-app-bar>

    <v-main>
      <!-- 显式 duration：窗口隐藏时 CSS transitionend 不触发，mode="out-in" 会永久卡在
           leave 阶段（实测复现）——显式值让 Vue 用 setTimeout 定界，不依赖动画事件 -->
      <Transition name="screen" mode="out-in" :duration="180">
        <Screen0 v-if="store.view === 'home'" />
        <Screen1 v-else-if="store.view === 'convert' && store.screen === 1" />
        <Screen2 v-else-if="store.view === 'convert' && store.screen === 2" />
        <Screen3 v-else-if="store.view === 'convert'" />
        <TraceScreen1 v-else-if="store.traceScreen === 1" />
        <TraceScreen2 v-else />
      </Transition>
    </v-main>

    <v-snackbar v-model="store.toast.show" location="bottom" timeout="2600" rounded="lg">
      {{ store.toast.text }}
    </v-snackbar>

    <!-- 使用说明（08：一页说明内置界面，丢失手册也能自助） -->
    <v-dialog v-model="about" max-width="620">
      <v-card rounded="lg">
        <v-card-title class="d-flex align-center">
          <v-icon class="mr-2" color="primary">mdi-file-word-box</v-icon>
          <span>测试文档工具集</span>
          <span class="about-ver">v{{ appVersion }}</span>
          <v-spacer />
          <v-btn icon size="small" variant="text" @click="about = false">
            <v-icon>mdi-close</v-icon>
          </v-btn>
        </v-card-title>
        <v-divider />
        <v-card-text class="about-body">
          <div class="sec">打开界面</div>
          <p>双击 exe 启动后会<b>自动打开默认浏览器</b>进入界面；个别机器没设默认浏览器时不弹出，把黑色控制台窗口里显示的地址（默认
            <code>http://127.0.0.1:8300</code>，被占用时自动换下一个端口，以控制台显示为准）抄进浏览器即可。</p>

          <div class="sec">两个工具</div>
          <p><b>大纲转换</b>：导入测试大纲，自动生成测试说明与测试记录两份 Word 文档。<b>追踪文档生成</b>：导入测试大纲，生成追踪关系文档，复制其中表格贴入自己的文档。</p>

          <div class="sec">数据保存在哪里</div>
          <p>exe 旁边的 <code>数据/</code> 文件夹（上传的大纲副本、核对修改、参数设置都在里面，全程不联网）。<b>换电脑</b>：把
            exe 和 <code>数据/</code> 文件夹一起拷贝；<b>升级</b>：用新 exe 覆盖旧的，<code>数据/</code> 不用动。</p>

          <div class="sec">常见问题</div>
          <ul>
            <li>只有黑窗口、没见着界面？浏览器没自动弹出时，用浏览器打开控制台里显示的地址即可。</li>
            <li>页面一片空白？浏览器版本太旧，请换 2022 年以后的 Chrome / Edge。</li>
            <li>公司代理环境打不开页面？在代理设置里"绕过本地地址"（把 127.0.0.1 加入例外）。</li>
            <li>首次运行被 Windows 蓝色提示拦截？点「更多信息」→「仍要运行」；杀毒软件误报时加入信任白名单。</li>
            <li>核对时的修改会丢吗？不会，自动保存；直接关闭窗口，下次打开项目继续。</li>
          </ul>
        </v-card-text>
      </v-card>
    </v-dialog>
  </v-app>
</template>

<style scoped>
/* 顶栏 v2（视觉系统「工程仪器」）：半透明玻璃表面 + 细底边，装饰退场、信息清晰。
   扫光/深蓝渐变已按设计稿移除；backdrop-filter 带 -webkit- 前缀（Edge 100 可用） */
.v-app-bar {
  background: var(--cn-surface-glass) !important;
  -webkit-backdrop-filter: blur(18px) saturate(130%);
  backdrop-filter: blur(18px) saturate(130%);
  border-bottom: 1px solid var(--cn-border);
  box-shadow: none !important;
  color: var(--cn-fg);
}
/* 「‹ 工具集」返回 */
.back {
  display: flex; align-items: center; gap: 1px;
  margin-left: 10px; padding: 5px 9px 5px 5px; border-radius: var(--cn-r-2);
  color: var(--cn-muted); font-size: 12.5px; cursor: pointer;
  background: none; border: 1px solid transparent;
  transition: background var(--cn-dur-2) var(--cn-ease-out), color var(--cn-dur-2) var(--cn-ease-out);
}
.back:hover { background: var(--cn-surface-soft); color: var(--cn-fg); border-color: var(--cn-border); }
.brand { display: flex; align-items: center; gap: 10px; }
.brand-mark {
  width: 30px; height: 30px; border-radius: 9px; margin-left: 8px;
  background: linear-gradient(145deg, #5ebef3, #2b79d5 62%, #1955a1);
  color: #fff;
  box-shadow: 0 6px 14px rgba(33, 108, 190, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.5);
  display: flex; align-items: center; justify-content: center;
}
.app-title {
  font-family: var(--cn-font-display);
  font-size: 14.5px; font-weight: 680; color: var(--cn-fg); letter-spacing: 0.01em;
}
/* 版本徽标（08：版本号三处可见之一）；__APP_VERSION__ 由 vite define 注入 */
.ver {
  font-size: 10px; color: var(--cn-subtle); margin-left: 2px;
  font-family: var(--cn-font-mono); letter-spacing: 0.05em;
  border: 1px solid var(--cn-border); border-radius: var(--cn-r-1); padding: 1px 7px;
}
.spacer { flex: 1; }
/* 工具内 stepper 绝对居中；首页态不渲染 */
.stepper { display: flex; align-items: center; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); }
.step {
  display: flex; align-items: center; gap: 7px; padding: 5px 9px;
  border-radius: var(--cn-r-2); color: var(--cn-muted);
  border: 1px solid transparent;
  transition: background var(--cn-dur-2) var(--cn-ease-out), color var(--cn-dur-2) var(--cn-ease-out);
}
.step:hover { background: var(--cn-surface-soft); color: var(--cn-fg); }
.dot {
  width: 20px; height: 20px; border-radius: 50%; flex: none;
  border: 1px solid var(--cn-border-strong);
  background: var(--cn-surface);
  display: flex; align-items: center; justify-content: center;
  font-family: var(--cn-font-mono);
  font-size: 10px; font-weight: 650;
  transition: background var(--cn-dur-2) var(--cn-ease-out), border-color var(--cn-dur-2) var(--cn-ease-out), color var(--cn-dur-2) var(--cn-ease-out);
}
.lbl { font-size: 12px; white-space: nowrap; }
.step.active { color: var(--cn-accent); font-weight: 650; }
.step.active .dot { border-color: var(--cn-accent); box-shadow: inset 0 0 0 4px var(--cn-accent-soft); color: var(--cn-accent); }
.step.done { color: var(--cn-success); }
.step.done .dot { background: var(--cn-success-soft); border-color: #a6d7bf; color: var(--cn-success); }
.link { width: 22px; height: 1px; background: var(--cn-border); margin: 0 3px; }
/* 顶栏图标按钮（帮助/主题）：32px 描边方钮 */
.icon-btn {
  width: 36px; height: 36px; margin-right: 6px;
  border: 1px solid transparent; border-radius: var(--cn-r-2);
  background: transparent; color: var(--cn-muted);
  display: grid; place-items: center; cursor: pointer;
  transition: background var(--cn-dur-2) var(--cn-ease-out), color var(--cn-dur-2) var(--cn-ease-out);
}
/* v5 评审 012：默认安静、hover 才上浅蓝，边框留给容器与表格 */
.icon-btn:hover { background: var(--cn-accent-soft); color: var(--cn-fg); }
.icon-btn:active { transform: scale(0.97); }
/* 三屏切换过渡（240ms fade-slide，respect reduced-motion） */
.screen-enter-active, .screen-leave-active { transition: opacity 0.24s var(--cn-ease-out), transform 0.24s var(--cn-ease-out); }
.screen-enter-from { opacity: 0; transform: translateY(8px); }
.screen-leave-to { opacity: 0; transform: translateY(-4px); }
@media (prefers-reduced-motion: reduce) {
  .screen-enter-active, .screen-leave-active { transition: none; }
}
@media (max-width: 940px) { .lbl { display: none; } .link { width: 14px; } .back span { display: none; } }
/* 绝对居中的导航不感知两侧内容，窄窗口靠分档收缩防撞 */
@media (max-width: 700px) {
  .app-title { display: none; }
  .step { padding: 5px 6px; }
  .link { width: 10px; margin: 0 2px; }
  .brand-mark { margin-left: 2px; }
  .ver { margin-left: 4px; }
}
/* 使用说明对话框（v-dialog 传送到 body 渲染，scoped 属性编译期落在节点上，样式仍生效） */
.about-ver {
  font-size: 11px; margin-left: 8px;
  font-family: Consolas, monospace; letter-spacing: 0.4px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.about-body { line-height: 1.8; font-size: 13.5px; padding-top: 14px; }
.about-body .sec {
  font-weight: 600; font-size: 13px; margin: 14px 0 2px;
  color: rgb(var(--v-theme-primary));
}
.about-body .sec:first-child { margin-top: 0; }
.about-body p { margin: 0 0 4px; }
.about-body ul { margin: 0; padding-left: 20px; }
.about-body li { margin-bottom: 4px; }
.about-body b { font-weight: 600; }
.about-body code {
  background: rgba(var(--v-theme-primary), 0.1); padding: 0 5px;
  border-radius: 4px; font-size: 12.5px;
}
</style>
