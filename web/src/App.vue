<script setup lang="ts">
import { onMounted, ref } from 'vue'

const pingState = ref<'pending' | 'ok' | 'fail'>('pending')
const pingInfo = ref('正在连接本地服务…')

async function checkPing() {
  try {
    const res = await fetch('/api/ping')
    const data = await res.json()
    pingState.value = data.ok ? 'ok' : 'fail'
    pingInfo.value = data.ok
      ? `服务正常 · v${data.version} · ${new Date(data.ts).toLocaleTimeString('zh-CN', { hour12: false })}`
      : '服务返回异常'
  } catch {
    pingState.value = 'fail'
    pingInfo.value = '无法连接本地服务（bun run dev:server 未启动？）'
  }
}

onMounted(checkPing)
</script>

<template>
  <v-app>
    <v-app-bar color="primary" elevation="0">
      <v-app-bar-title class="font-weight-semibold">测试文档生成工具</v-app-bar-title>
      <v-chip size="small" variant="tonal" class="mr-4">M0 工程骨架</v-chip>
    </v-app-bar>
    <v-main>
      <v-container class="fill-height" fluid>
        <v-row justify="center">
          <v-col cols="12" sm="9" md="6" lg="5">
            <v-card rounded="xl" elevation="2" class="pa-8 text-center">
              <v-icon size="56" color="primary">mdi-file-word-box</v-icon>
              <h1 class="text-h6 font-weight-bold mt-3">工程骨架已就绪</h1>
              <p class="text-body-2 text-medium-emphasis mt-1">
                Bun 服务 + Vue 3 / Vuetify 前端 + docxtemplater 冒烟测试全部通过
              </p>
              <v-alert
                class="mt-6" rounded="lg" :type="pingState === 'ok' ? 'success' : pingState === 'fail' ? 'error' : 'info'"
                variant="tonal" density="compact" :text="pingInfo"
              />
              <v-btn class="mt-4" color="primary" rounded="pill" @click="checkPing">再测一次</v-btn>
            </v-card>
          </v-col>
        </v-row>
      </v-container>
    </v-main>
  </v-app>
</template>
