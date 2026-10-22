import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'
import './base.css'
import './ambient.css'
import './design.css'
import { createApp } from 'vue'
import { createVuetify } from 'vuetify'
import { mdi } from 'vuetify/iconsets/mdi'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import App from './App.vue'

// 视觉系统 v3「蓝图纸面 · 校对台」（2026-10-22 OpenDesign 重置稿）：
// 冷白工程纸 + 蓝黑规线 + 工程蓝交互色；深色为图纸反相（ink），独立配色
const vuetify = createVuetify({
  icons: {
    defaultSet: 'mdi',
    sets: { mdi }
  },
  theme: {
    defaultTheme: 'light',
    themes: {
      light: {
        dark: false,
        colors: {
          primary: '#075DA8',
          'primary-darken-1': '#034A88',
          secondary: '#5B6E79',
          background: '#E9EEF1',
          surface: '#FBFCFC',
          success: '#176B4A',
          warning: '#9B6100',
          error: '#A33B35',
          info: '#075DA8',
          // MD3 outline 色：Vuetify 4 不内置 --v-theme-outline，界面所有细分隔线/边框
          // 引用该 token，缺了会被浏览器整条丢弃（2026-09-30 踩坑）
          outline: '#C9D4DA',
          'on-background': '#0B2231',
          'on-surface': '#0B2231'
        }
      },
      dark: {
        dark: true,
        colors: {
          primary: '#51B5FF',
          secondary: '#91A6B2',
          background: '#06131D',
          surface: '#0B1D2A',
          success: '#65D1A0',
          warning: '#FFC766',
          error: '#FF9289',
          info: '#51B5FF',
          outline: '#254255',
          'on-background': '#E1EDF4',
          'on-surface': '#E1EDF4'
        }
      }
    }
  },
  components,
  directives
})

createApp(App).use(vuetify).mount('#app')
