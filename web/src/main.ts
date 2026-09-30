import 'vuetify/styles'
import { createApp } from 'vue'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import App from './App.vue'

const vuetify = createVuetify({
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
          error: '#B3261E'
        }
      },
      dark: {
        dark: true,
        colors: {
          primary: '#A3C4EE',
          secondary: '#A9B0C1',
          background: '#101319',
          surface: '#181C24'
        }
      }
    }
  },
  components,
  directives
})

createApp(App).use(vuetify).mount('#app')
