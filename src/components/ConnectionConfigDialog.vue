<script setup lang="ts">
import { Cable, Save, Trash2 } from 'lucide-vue-next'
import { reactive, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DialogContent, DialogDescription, DialogHeader, DialogRoot, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { usePrinterStore } from '@/stores/printer'

const store = usePrinterStore()
const open = defineModel<boolean>('open', { required: true })

const connectAfterSave = ref(true)
const notice = ref<string | null>(null)

const form = reactive({
  name: 'Bambu Lab',
  host: '',
  port: 8883,
  serial: '',
  accessCode: '',
})

watch(
  () => store.config,
  (config) => {
    if (!config.configured)
      return

    form.name = config.name
    form.host = config.host
    form.port = config.port
    form.serial = config.serial
  },
  { immediate: true },
)

async function handleSubmit(): Promise<void> {
  try {
    await store.savePrinterConfig({
      ...form,
      port: Number(form.port) || 8883,
      accessCode: form.accessCode || undefined,
    }, connectAfterSave.value)
    form.accessCode = ''
    showNotice('连接配置已保存')
  }
  catch {
    // Store owns the user-facing error message.
  }
}

async function handleDelete(): Promise<void> {
  if (!window.confirm('确认删除当前打印机配置？'))
    return

  await store.deletePrinterConfig()
  form.name = 'Bambu Lab'
  form.host = ''
  form.port = 8883
  form.serial = ''
  form.accessCode = ''
  showNotice('连接配置已删除')
}

function showNotice(message: string): void {
  notice.value = message
  window.setTimeout(() => {
    if (notice.value === message)
      notice.value = null
  }, 2800)
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogContent class="max-h-[85vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2 text-lg">
          <Cable class="size-5" />
          连接配置
        </DialogTitle>
        <DialogDescription>打印机局域网凭据与连接参数</DialogDescription>
      </DialogHeader>

      <div v-if="notice" class="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
        {{ notice }}
      </div>

      <div v-if="store.error" class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
        {{ store.error }}
      </div>

      <Card>
        <CardHeader>
          <CardTitle class="text-base">
            打印机连接
          </CardTitle>
          <CardDescription>保存到后端本地配置文件</CardDescription>
        </CardHeader>
        <CardContent>
          <form class="space-y-4" @submit.prevent="handleSubmit">
            <div class="space-y-2">
              <Label for="connection-printer-name">名称</Label>
              <Input id="connection-printer-name" v-model="form.name" autocomplete="off" />
            </div>

            <div class="grid gap-3 sm:grid-cols-[1fr_96px]">
              <div class="space-y-2">
                <Label for="connection-printer-host">IP / Host</Label>
                <Input id="connection-printer-host" v-model="form.host" placeholder="192.168.1.100" autocomplete="off" />
              </div>
              <div class="space-y-2">
                <Label for="connection-printer-port">端口</Label>
                <Input id="connection-printer-port" v-model.number="form.port" type="number" min="1" max="65535" />
              </div>
            </div>

            <div class="space-y-2">
              <Label for="connection-printer-serial">序列号</Label>
              <Input id="connection-printer-serial" v-model="form.serial" autocomplete="off" />
            </div>

            <div class="space-y-2">
              <Label for="connection-access-code">访问码</Label>
              <Input id="connection-access-code" v-model="form.accessCode" type="password" autocomplete="off" placeholder="留空沿用已保存访问码" />
            </div>

            <div class="flex items-center justify-between rounded-md border px-3 py-2">
              <Label for="connection-connect-after-save" class="text-sm font-medium">保存后连接</Label>
              <Switch id="connection-connect-after-save" v-model="connectAfterSave" />
            </div>

            <div class="flex gap-2">
              <Button type="submit" class="flex-1" :disabled="store.saving">
                <Save class="size-4" />
                保存
              </Button>
              <Button type="button" variant="outline" size="icon" :disabled="!store.configured || store.saving" @click="handleDelete">
                <Trash2 class="size-4" />
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </DialogContent>
  </DialogRoot>
</template>
