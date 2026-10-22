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

// 视觉系统 v2「蓝调鎏光 · 工程仪器」（2026-10-22 OpenDesign 稿）：
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
          primary: '#1267B4',
          'primary-darken-1': '#0C4D8C',
          secondary: '#5A6D84',
          background: '#EDF3F9',
          surface: '#FFFFFF',
          success: '#18794E',
          warning: '#986000',
          error: '#A83B34',
          info: '#1768B3',
          // MD3 outline 色：Vuetify 4 不内置 --v-theme-outline，界面所有细分隔线/边框
          // 引用该 token，缺了会被浏览器整条丢弃（2026-09-30 踩坑）
          outline: '#D3DFEB',
          'on-background': '#12233B',
          'on-surface': '#12233B'
        }
      },
      dark: {
        dark: true,
        colors: {
          primary: '#67B7FF',
          secondary: '#9CAFC5',
          background: '#07111D',
          surface: '#0E1D2F',
          success: '#68D6A1',
          warning: '#FFD277',
          error: '#FF938B',
          info: '#79BFFF',
          outline: '#213A54',
          'on-background': '#E9F1FA',
          'on-surface': '#E9F1FA'
        }
      }
    }
  },
  components,
  directives
})

createApp(App).use(vuetify).mount('#app')
