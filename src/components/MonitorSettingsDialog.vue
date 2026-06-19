<script setup lang="ts">
import type { CameraSource } from '@/types/printer'
import { Camera, Save, Settings, Video } from 'lucide-vue-next'
import { reactive, watch } from 'vue'
import InlineNotice from '@/components/InlineNotice.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DialogContent, DialogDescription, DialogHeader, DialogRoot, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { useNotice } from '@/composables/useNotice'
import { usePrinterStore } from '@/stores/printer'

const store = usePrinterStore()
const open = defineModel<boolean>('open', { required: true })

const { notice, showNotice } = useNotice()

const form = reactive({
  cameraEnabled: true,
  cameraSource: 'bambu' as CameraSource,
  externalUrl: '',
  webhookEnabled: false,
  webhookUrl: '',
  webhookSecret: '',
  historyRetentionDays: 7,
})

watch(
  () => store.config.settings,
  (settings) => {
    form.cameraEnabled = settings.camera.enabled
    form.cameraSource = settings.camera.source
    form.externalUrl = settings.camera.externalUrl
    form.webhookEnabled = settings.webhook.enabled
    form.webhookUrl = settings.webhook.url
    form.webhookSecret = ''
    form.historyRetentionDays = settings.historyRetentionDays
  },
  { immediate: true },
)

async function handleSubmit(): Promise<void> {
  try {
    await store.saveSettings({
      camera: {
        enabled: form.cameraEnabled,
        source: form.cameraSource,
        externalUrl: form.externalUrl,
      },
      webhook: {
        enabled: form.webhookEnabled,
        url: form.webhookUrl,
        secret: form.webhookSecret || undefined,
      },
      historyRetentionDays: Number(form.historyRetentionDays) || 7,
    })
    form.webhookSecret = ''
    showNotice('监控设置已保存')
  }
  catch {
    // Store owns the user-facing error message.
  }
}

function setCameraSource(source: CameraSource): void {
  form.cameraSource = source
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogContent class="max-h-[85vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2 text-lg uppercase tracking-wide">
          <Settings class="size-5 text-primary" />
          监控设置
        </DialogTitle>
        <DialogDescription>实时视频、Webhook 与本地历史保留</DialogDescription>
      </DialogHeader>

      <InlineNotice v-if="notice">
        {{ notice }}
      </InlineNotice>

      <InlineNotice v-if="store.error" variant="destructive">
        {{ store.error }}
      </InlineNotice>

      <form class="space-y-4" @submit.prevent="handleSubmit">
        <Card>
          <CardHeader>
            <CardTitle class="text-sm font-medium uppercase tracking-wider">
              实时视频
            </CardTitle>
            <CardDescription>内置相机或外部 HTTP/RTSP 源由后端 ffmpeg 代理为 MJPEG</CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
            <div class="flex items-center justify-between rounded-md border px-3 py-2">
              <Label for="monitor-camera-enabled" class="text-sm font-medium">启用视频</Label>
              <Switch id="monitor-camera-enabled" v-model="form.cameraEnabled" />
            </div>

            <div class="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" :class="form.cameraSource === 'bambu' ? 'border-primary bg-primary/10 text-primary' : ''" @click="setCameraSource('bambu')">
                <Camera class="size-4" />
                内置
              </Button>
              <Button type="button" variant="outline" :class="form.cameraSource === 'external' ? 'border-primary bg-primary/10 text-primary' : ''" @click="setCameraSource('external')">
                <Video class="size-4" />
                外部
              </Button>
            </div>

            <div class="space-y-2">
              <Label for="monitor-external-camera-url">外部视频 URL</Label>
              <Input id="monitor-external-camera-url" v-model="form.externalUrl" placeholder="http://camera.local/mjpeg 或 rtsp://camera/stream" autocomplete="off" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle class="text-sm font-medium uppercase tracking-wider">
              Webhook 与历史
            </CardTitle>
            <CardDescription>事件推送和本地运行数据保留时间</CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
            <div class="flex items-center justify-between rounded-md border px-3 py-2">
              <Label for="monitor-webhook-enabled" class="text-sm font-medium">Webhook</Label>
              <Switch id="monitor-webhook-enabled" v-model="form.webhookEnabled" />
            </div>

            <div class="space-y-2">
              <Label for="monitor-webhook-url">Webhook URL</Label>
              <Input id="monitor-webhook-url" v-model="form.webhookUrl" placeholder="https://example.com/hook" autocomplete="off" />
            </div>

            <div class="space-y-2">
              <Label for="monitor-webhook-secret">Webhook Secret</Label>
              <Input id="monitor-webhook-secret" v-model="form.webhookSecret" type="password" placeholder="留空沿用已保存密钥" autocomplete="off" />
            </div>

            <Separator />

            <div class="space-y-2">
              <Label for="monitor-history-retention">历史保留天数</Label>
              <Input id="monitor-history-retention" v-model.number="form.historyRetentionDays" type="number" min="1" max="30" />
            </div>
          </CardContent>
        </Card>

        <Button type="submit" class="w-full" :disabled="store.saving">
          <Save class="size-4" />
          保存监控设置
        </Button>
      </form>
    </DialogContent>
  </DialogRoot>
</template>
