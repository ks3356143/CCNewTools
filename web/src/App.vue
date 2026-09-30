<script setup lang="ts">
import { onMounted } from 'vue'
import { useTheme } from 'vuetify'
import { store, scheduleSettingsSave, showToast } from './store.ts'
import { loadSettings } from './api.ts'
import Screen1 from './screens/Screen1.vue'
import Screen2 from './screens/Screen2.vue'
import Screen3 from './screens/Screen3.vue'

const theme = useTheme()
const STEPS = ['选择大纲', '核对与编辑', '生成文档']

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
      <v-btn icon size="small" class="mr-3" @click="toggleTheme">
        <v-icon>{{ store.theme === 'dark' ? 'mdi-weather-sunny' : 'mdi-weather-night' }}</v-icon>
      </v-btn>
    </v-app-bar>

    <v-main>
      <Screen1 v-if="store.screen === 1" />
      <Screen2 v-else-if="store.screen === 2" />
      <Screen3 v-else />
    </v-main>

    <v-snackbar v-model="store.toast.show" location="bottom" timeout="2600" rounded="lg">
      {{ store.toast.text }}
    </v-snackbar>
  </v-app>
</template>

<style scoped>
.mark {
  width: 32px; height: 32px; border-radius: 9px; margin-left: 14px;
  background: rgba(255, 255, 255, 0.18); color: #fff;
  display: flex; align-items: center; justify-content: center;
}
.app-title { font-size: 16px; font-weight: 600; color: #fff; margin-left: 4px; }
.spacer { flex: 1; }
.stepper { display: flex; align-items: center; }
.step { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 999px; color: rgba(255, 255, 255, 0.75); }
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
@media (max-width: 760px) { .lbl { display: none; } .link { width: 12px; } }
</style>
