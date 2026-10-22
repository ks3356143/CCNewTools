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

// 视觉系统 v4「冷蓝晨雾 · 精密仪器」（2026-10-22 OpenDesign v4 稿）：
// 语义色全部重定，深色不是反色而是独立配色；非 Vuetify 令牌见 design.css
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
          primary: '#2F80E8',
          'primary-darken-1': '#1767CE',
          secondary: '#6B809A',
          background: '#EEF5FC',
          surface: '#FFFFFF',
          success: '#1F9975',
          warning: '#C58A22',
          error: '#D55463',
          info: '#397BC5',
          // MD3 outline 色：Vuetify 4 不内置 --v-theme-outline，界面所有细分隔线/边框
          // 引用该 token，缺了会被浏览器整条丢弃（2026-09-30 踩坑）
          outline: '#D9E5F2',
          'on-background': '#152741',
          'on-surface': '#152741'
        }
      },
      dark: {
        dark: true,
        colors: {
          primary: '#65A9F4',
          secondary: '#AFC3D8',
          background: '#0D1B2D',
          surface: '#12243B',
          success: '#5ED3AC',
          warning: '#F0BF61',
          error: '#FF8794',
          info: '#79B9FF',
          outline: '#28415E',
          'on-background': '#EDF6FF',
          'on-surface': '#EDF6FF'
        }
      }
    }
  },
  components,
  directives
})

createApp(App).use(vuetify).mount('#app')
