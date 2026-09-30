import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'
import './base.css'
import { createApp } from 'vue'
import { createVuetify } from 'vuetify'
import { mdi } from 'vuetify/iconsets/mdi'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import App from './App.vue'

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
          primary: '#2D5B91',
          'primary-darken-1': '#24507F',
          secondary: '#4A5060',
          background: '#F4F6FB',
          surface: '#FFFFFF',
          success: '#22642F',
          warning: '#8F5F00',
          error: '#B3261E',
          appbar: '#2D5B91'
        }
      },
      dark: {
        dark: true,
        colors: {
          primary: '#A3C4EE',
          secondary: '#A9B0C1',
          background: '#101319',
          surface: '#181C24',
          success: '#8BD697',
          warning: '#F0C463',
          error: '#F2B8B5',
          appbar: '#1E3A5F'
        }
      }
    }
  },
  components,
  directives
})

createApp(App).use(vuetify).mount('#app')
