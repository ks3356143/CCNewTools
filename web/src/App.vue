<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useTheme } from 'vuetify'
import { store, scheduleSettingsSave, showToast } from './store.ts'
import { loadSettings } from './api.ts'
import Screen1 from './screens/Screen1.vue'
import Screen2 from './screens/Screen2.vue'
import Screen3 from './screens/Screen3.vue'

// vite define 注入（来源根 package.json）；必须先绑到局部常量——模板里直接写裸标识符
// 会被 Vue 编译成 _ctx.__APP_VERSION__ 属性访问，define 的标识符替换匹配不上
const appVersion = __APP_VERSION__

const theme = useTheme()
const STEPS = ['选择大纲', '核对与编辑', '生成文档']
// 使用说明对话框（08 交付物：内置界面，顶栏 ? 打开）
const about = ref(false)

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

function stepClick(n: number): void {
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
    <v-app-bar color="appbar" elevation="0">
      <div class="mark"><v-icon size="19">mdi-file-word-box</v-icon></div>
      <span class="app-title">测试文档生成工具</span>
      <span class="ver">v{{ appVersion }}</span>
      <div class="spacer" />
      <nav class="stepper">
        <template v-for="(t, i) in STEPS" :key="t">
          <button
            class="step"
            :class="{ active: store.screen === i + 1, done: store.screen > i + 1 }"
            @click="stepClick(i + 1)"
          >
            <span class="dot">
              <v-icon v-if="store.screen > i + 1" size="13">mdi-check</v-icon>
              <template v-else>{{ i + 1 }}</template>
            </span>
            <span class="lbl">{{ t }}</span>
          </button>
          <span v-if="i < 2" class="link" />
        </template>
      </nav>
      <div class="spacer" />
      <v-btn icon size="small" class="mr-2" title="使用说明" @click="about = true">
        <v-icon>mdi-help-circle-outline</v-icon>
      </v-btn>
      <v-btn icon size="small" class="mr-3" @click="toggleTheme">
        <v-icon>{{ store.theme === 'dark' ? 'mdi-weather-sunny' : 'mdi-weather-night' }}</v-icon>
      </v-btn>
    </v-app-bar>

    <v-main>
      <!-- 显式 duration：窗口隐藏时 CSS transitionend 不触发，mode="out-in" 会永久卡在
           leave 阶段（实测复现）——显式值让 Vue 用 setTimeout 定界，不依赖动画事件 -->
      <Transition name="screen" mode="out-in" :duration="180">
        <Screen1 v-if="store.screen === 1" />
        <Screen2 v-else-if="store.screen === 2" />
        <Screen3 v-else />
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
          <span>测试文档生成工具</span>
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
/* 顶栏品牌渐变（2026-10-02 用户要求"全局上一点颜色"）：主色同系深浅渐变 */
.v-app-bar {
  background: linear-gradient(120deg, #33639e 0%, #2D5B91 45%, #234a7c 100%) !important;
}
.mark {
  width: 32px; height: 32px; border-radius: 9px; margin-left: 14px;
  background: rgba(255, 255, 255, 0.18); color: #fff;
  display: flex; align-items: center; justify-content: center;
}
.app-title { font-size: 16px; font-weight: 600; color: #fff; margin-left: 4px; }
/* 版本徽标（08：版本号三处可见之一）；__APP_VERSION__ 由 vite define 从根 package.json 注入，发版只改一处 */
.ver {
  font-size: 11px; color: rgba(255, 255, 255, 0.72); margin-left: 8px;
  font-family: Consolas, monospace; letter-spacing: 0.4px;
  background: rgba(255, 255, 255, 0.14); border-radius: 999px; padding: 1px 8px;
}
.spacer { flex: 1; }
/* 三屏导航绝对居中（2026-10-01 用户反馈）：左右两侧内容宽度不等（左标题长、右仅一个按钮），
   两个等宽 spacer 会把导航推偏；改为相对整个顶栏居中，不受两侧宽度影响 */
.stepper { display: flex; align-items: center; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); }
.step { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 999px; color: rgba(255, 255, 255, 0.75); transition: background 0.15s, color 0.15s; }
.step:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
.dot {
  width: 24px; height: 24px; border-radius: 50%; flex: none;
  border: 1.4px solid rgba(255, 255, 255, 0.6);
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 600;
}
.lbl { font-size: 13px; white-space: nowrap; }
.step.active { color: #fff; }
.step.active .dot { background: #fff; border-color: #fff; color: rgb(var(--v-theme-primary)); }
.step.done { color: rgba(255, 255, 255, 0.92); }
.step.done .dot { background: rgba(255, 255, 255, 0.25); border-color: transparent; }
.link { width: 24px; height: 1.4px; background: rgba(255, 255, 255, 0.45); margin: 0 3px; }
/* 三屏切换过渡（Micro-interactions：180ms fade-slide，respect reduced-motion） */
.screen-enter-active, .screen-leave-active { transition: opacity 0.18s ease-out, transform 0.18s ease-out; }
.screen-enter-from { opacity: 0; transform: translateY(6px); }
.screen-leave-to { opacity: 0; transform: translateY(-4px); }
@media (prefers-reduced-motion: reduce) {
  .screen-enter-active, .screen-leave-active { transition: none; }
}
@media (max-width: 940px) { .lbl { display: none; } .link { width: 14px; } }
/* 绝对居中的导航不感知两侧内容，窄窗口靠分档收缩防撞（2026-10-01 用户反馈移动端与版本徽标重叠）：
   ≤940 藏导航文字、≤700 藏应用标题（图标与版本徽标保留） */
@media (max-width: 700px) {
  .app-title { display: none; }
  .step { padding: 5px 5px; }
  .link { width: 10px; margin: 0 2px; }
  .mark { margin-left: 10px; }
  .ver { margin-left: 6px; }
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
