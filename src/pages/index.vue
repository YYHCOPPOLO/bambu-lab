<script setup lang="ts">
import {
  Activity,
  AlertTriangle,
  Bell,
  Cable,
  Camera,
  CheckCircle2,
  Clock,
  Database,
  Fan,
  Gauge,
  History,
  Layers,
  Lightbulb,
  Package,
  Pause,
  Play,
  RefreshCw,
  Settings,
  Square,
  Thermometer,
  Unplug,
  Video,
  Wifi,
  WifiOff,
} from 'lucide-vue-next'
import { computed, onMounted, ref, watch } from 'vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { usePrinterStore } from '@/stores/printer'
import ConnectionConfigDialog from '@/components/ConnectionConfigDialog.vue'
import MonitorSettingsDialog from '@/components/MonitorSettingsDialog.vue'
import type { EventLogEntry, FilamentTray, HmsMessage, PrinterCommand, PrinterFan, TemperatureReading } from '@/types/printer'

const store = usePrinterStore()
const connectionDialogOpen = ref(false)
const monitorDialogOpen = ref(false)
const cameraNonce = ref(Date.now())
const cameraFailed = ref(false)
const cameraErrorMessage = ref<string | null>(null)
const notice = ref<string | null>(null)
const lastNotifiedEventId = ref<string | null>(null)
let cameraCheckId = 0

const speedOptions = [
  { level: 1 as const, label: '静音' },
  { level: 2 as const, label: '标准' },
  { level: 3 as const, label: '运动' },
  { level: 4 as const, label: '狂暴' },
]

const connectionMeta = computed(() => {
  switch (store.connection.status) {
    case 'connected':
      return { label: '已连接', className: 'border-emerald-300 bg-emerald-50 text-emerald-700', icon: Wifi }
    case 'connecting':
      return { label: '连接中', className: 'border-sky-300 bg-sky-50 text-sky-700', icon: Cable }
    case 'reconnecting':
      return { label: '重连中', className: 'border-amber-300 bg-amber-50 text-amber-700', icon: RefreshCw }
    case 'error':
      return { label: '连接错误', className: 'border-red-300 bg-red-50 text-red-700', icon: WifiOff }
    case 'disconnected':
      return { label: '未连接', className: 'border-neutral-300 bg-neutral-50 text-neutral-700', icon: Unplug }
    default:
      return { label: '未配置', className: 'border-neutral-300 bg-neutral-50 text-neutral-700', icon: Settings }
  }
})

const activeTray = computed<FilamentTray | null>(() => {
  if (store.status?.ams.trayNow === '254' && store.status.ams.externalSpool)
    return store.status.ams.externalSpool

  for (const unit of store.status?.ams.units ?? []) {
    const match = unit.trays.find(tray => tray.active)
    if (match)
      return match
  }

  return null
})

const filledTrayCount = computed(() => {
  return (store.status?.ams.units ?? [])
    .flatMap(unit => unit.trays)
    .filter(tray => tray.exists)
    .length
})

const stateText = computed(() => store.status?.state.gcodeState.toUpperCase() ?? 'UNKNOWN')
const isPaused = computed(() => ['PAUSE', 'PAUSED'].includes(stateText.value))
const hasActivePrint = computed(() => !['IDLE', 'FINISH', 'FINISHED', 'FAILED', 'UNKNOWN'].includes(stateText.value))
const canPause = computed(() => store.connected && hasActivePrint.value && !isPaused.value)
const canResume = computed(() => store.connected && isPaused.value)
const canStop = computed(() => store.connected && hasActivePrint.value)
const canSetSpeed = computed(() => store.connected && hasActivePrint.value)
const chamberLight = computed(() => store.status?.lights.find(light => light.node === 'chamber_light'))
const cameraStreamUrl = computed(() => `/api/printer/camera/stream?ts=${cameraNonce.value}`)
const recentHistory = computed(() => store.history.slice(-40))
const recentEvents = computed(() => store.eventsLog.slice(-8).reverse())
const latestCriticalEvent = computed(() => [...store.eventsLog].reverse().find((event: EventLogEntry) => event.level !== 'info'))
const canShowCameraStream = computed(() => {
  const camera = store.config.settings.camera
  return store.config.configured
    && camera.enabled
    && !cameraFailed.value
    && (camera.source !== 'external' || Boolean(camera.externalUrl))
})
const cameraUnavailableMessage = computed(() => {
  const camera = store.config.settings.camera

  if (!camera.enabled)
    return '实时视频未启用'

  if (!store.config.configured)
    return '请先完成连接配置'

  if (camera.source === 'external' && !camera.externalUrl)
    return '请先填写外部视频 URL'

  if (cameraFailed.value)
    return cameraErrorMessage.value ?? '视频连接失败，请检查 LAN Liveview/视频开关、访问码、相机端口 322/6000 或刷新视频'

  return '视频不可用'
})

const progressPolyline = computed(() => buildPolyline(recentHistory.value.map(sample => sample.progress), 0, 100))
const nozzlePolyline = computed(() => buildPolyline(recentHistory.value.map(sample => sample.nozzleTemperature ?? 0), 0, 300))
const bedPolyline = computed(() => buildPolyline(recentHistory.value.map(sample => sample.bedTemperature ?? 0), 0, 120))

onMounted(() => {
  void store.initialize()
})

watch(
  () => store.eventsLog[store.eventsLog.length - 1],
  (event) => {
    if (!event || event.id === lastNotifiedEventId.value || event.level === 'info')
      return

    lastNotifiedEventId.value = event.id
    if ('Notification' in window && Notification.permission === 'granted')
      new Notification('Bambu Lab Monitor', { body: event.message })
  },
)

watch(
  [
    () => store.config.configured,
    () => store.config.settings.camera.enabled,
    () => store.config.settings.camera.source,
    () => store.config.settings.camera.externalUrl,
    () => store.status?.camera.rtspUrl ?? null,
  ],
  refreshCamera,
)

async function runCommand(label: string, command: PrinterCommand, confirmMessage?: string): Promise<void> {
  if (confirmMessage && !window.confirm(confirmMessage))
    return

  try {
    await store.command(command)
    showNotice(`${label}已发送`)
  }
  catch {
    // Store owns the user-facing error message.
  }
}

async function enableNotifications(): Promise<void> {
  if (!('Notification' in window)) {
    showNotice('当前浏览器不支持系统通知')
    return
  }

  const permission = await Notification.requestPermission()
  showNotice(permission === 'granted' ? '浏览器通知已启用' : '浏览器通知未启用')
}

function refreshCamera(): void {
  cameraCheckId += 1
  cameraFailed.value = false
  cameraErrorMessage.value = null
  cameraNonce.value = Date.now()
}

function handleCameraLoad(): void {
  cameraCheckId += 1
  cameraFailed.value = false
  cameraErrorMessage.value = null
}

async function handleCameraError(): Promise<void> {
  const checkId = ++cameraCheckId
  cameraFailed.value = true
  cameraErrorMessage.value = '正在检查视频连接...'

  try {
    const result = await api.checkCamera()

    if (checkId !== cameraCheckId)
      return

    cameraErrorMessage.value = `视频代理可用（${formatCameraCheckResult(result)}），但浏览器未能渲染视频流，请刷新视频`
  }
  catch (error) {
    if (checkId !== cameraCheckId)
      return

    cameraErrorMessage.value = error instanceof Error
      ? error.message
      : '视频连接失败，请检查 LAN Liveview/视频开关、访问码、相机端口 322/6000 或刷新视频'
  }
}

function formatCameraCheckResult(result: { transport: string, port?: number }): string {
  if (result.transport === 'rtsps')
    return `RTSPS${result.port ? `:${result.port}` : ''}`

  if (result.transport === 'bambu-jpeg')
    return `Bambu 6000 JPEG${result.port ? `:${result.port}` : ''}`

  return '外部视频源'
}

function showNotice(message: string): void {
  notice.value = message
  window.setTimeout(() => {
    if (notice.value === message)
      notice.value = null
  }, 2800)
}

function formatTemperature(reading: TemperatureReading): string {
  return `${formatNumber(reading.current)} / ${formatNumber(reading.target)} °C`
}

function formatNumber(value: number | null | undefined, fallback = '--'): string {
  return value === null || value === undefined ? fallback : String(value)
}

function formatMinutes(value: number | null | undefined): string {
  if (value === null || value === undefined)
    return '--'

  if (value < 60)
    return `${value} 分钟`

  const hours = Math.floor(value / 60)
  const minutes = value % 60
  return `${hours} 小时 ${minutes} 分钟`
}

function formatDateTime(value: string | null | undefined): string {
  if (!value)
    return '--'

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value))
}

function formatFan(fan: PrinterFan): string {
  if (fan.installed === false)
    return '未安装'

  return fan.speed === null ? '--' : String(fan.speed)
}

function formatLayer(current: number | null | undefined, total: number | null | undefined): string {
  if (current === null || current === undefined)
    return '--'

  return total === null || total === undefined ? String(current) : `${current} / ${total}`
}

function formatTrayTemperature(tray: FilamentTray): string {
  if (tray.nozzleTempMin === null || tray.nozzleTempMin === undefined)
    return '--'

  if (tray.nozzleTempMax === null || tray.nozzleTempMax === undefined)
    return `${tray.nozzleTempMin} °C`

  return `${tray.nozzleTempMin}-${tray.nozzleTempMax} °C`
}

function trayColor(tray: FilamentTray): string {
  return tray.color ?? '#D4D4D4'
}

function hmsVariant(message: HmsMessage): 'default' | 'destructive' {
  return message.level === 'error' ? 'destructive' : 'default'
}

function eventClass(event: EventLogEntry): string {
  if (event.level === 'error')
    return 'border-red-200 bg-red-50 text-red-900'

  if (event.level === 'warning')
    return 'border-amber-200 bg-amber-50 text-amber-900'

  return 'border-neutral-200 bg-card'
}

function buildPolyline(values: number[], min: number, max: number): string {
  if (values.length < 2)
    return ''

  return values
    .map((value, index) => {
      const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 100
      const normalized = Math.max(0, Math.min(1, (value - min) / (max - min)))
      const y = 44 - normalized * 40
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}
</script>

<template>
  <TooltipProvider>
    <main class="min-h-screen bg-background">
      <div class="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <header class="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div class="min-w-0 space-y-2">
            <div class="flex flex-wrap items-center gap-2">
              <Badge variant="outline" class="rounded-md">
                LAN
              </Badge>
              <Badge variant="outline" :class="connectionMeta.className">
                <component :is="connectionMeta.icon" class="size-3.5" />
                {{ connectionMeta.label }}
              </Badge>
              <Badge v-if="store.status?.network.wifiSignal" variant="outline" class="rounded-md">
                {{ store.status.network.wifiSignal }}
              </Badge>
            </div>
            <div>
              <h1 class="text-2xl font-semibold tracking-normal sm:text-3xl">
                拓竹打印监控台
              </h1>
              <p class="mt-1 truncate text-sm text-muted-foreground">
                {{ store.config.configured ? `${store.config.name} · ${store.config.host}:${store.config.port}` : '等待配置打印机' }}
              </p>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <Tooltip>
              <TooltipTrigger as-child aria-label="连接配置">
                <Button type="button" variant="outline" size="icon" aria-label="连接配置" @click="connectionDialogOpen = true">
                  <Cable class="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>连接配置</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child aria-label="监控设置">
                <Button type="button" variant="outline" size="icon" aria-label="监控设置" @click="monitorDialogOpen = true">
                  <Settings class="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>监控设置</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button type="button" variant="outline" size="icon" :disabled="!store.connected" @click="store.refreshPrinter">
                  <RefreshCw class="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>刷新状态</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button type="button" variant="outline" size="icon" @click="enableNotifications">
                  <Bell class="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>启用浏览器通知</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button type="button" variant="outline" size="icon" :disabled="!store.configured" @click="store.disconnectPrinter">
                  <Unplug class="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>断开连接</TooltipContent>
            </Tooltip>
          </div>
        </header>

        <Alert v-if="store.error" variant="destructive">
          <AlertTriangle class="size-4" />
          <AlertTitle>请求失败</AlertTitle>
          <AlertDescription>{{ store.error }}</AlertDescription>
        </Alert>

        <Alert v-if="notice" class="border-emerald-200 bg-emerald-50 text-emerald-900">
          <CheckCircle2 class="size-4" />
          <AlertTitle>已更新</AlertTitle>
          <AlertDescription>{{ notice }}</AlertDescription>
        </Alert>

        <section class="space-y-4">
            <div v-if="store.loading" class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Skeleton v-for="index in 4" :key="index" class="h-32 rounded-lg" />
            </div>

            <template v-else>
              <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Card>
                  <CardHeader class="pb-2">
                    <CardTitle class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <Activity class="size-4" />
                      打印状态
                    </CardTitle>
                  </CardHeader>
                  <CardContent class="space-y-2">
                    <div class="text-2xl font-semibold">
                      {{ store.status?.state.gcodeState ?? '--' }}
                    </div>
                    <p class="truncate text-sm text-muted-foreground">
                      {{ store.status?.state.printName || '无任务' }}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader class="pb-2">
                    <CardTitle class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <Gauge class="size-4" />
                      进度
                    </CardTitle>
                  </CardHeader>
                  <CardContent class="space-y-3">
                    <div class="text-2xl font-semibold">
                      {{ store.status?.state.progress ?? 0 }}%
                    </div>
                    <Progress :model-value="store.status?.state.progress ?? 0" />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader class="pb-2">
                    <CardTitle class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <Thermometer class="size-4" />
                      喷嘴 / 热床
                    </CardTitle>
                  </CardHeader>
                  <CardContent class="space-y-1 text-sm">
                    <div class="flex justify-between gap-3">
                      <span class="text-muted-foreground">喷嘴</span>
                      <span class="font-medium">{{ store.status ? formatTemperature(store.status.temperatures.nozzle) : '--' }}</span>
                    </div>
                    <div class="flex justify-between gap-3">
                      <span class="text-muted-foreground">热床</span>
                      <span class="font-medium">{{ store.status ? formatTemperature(store.status.temperatures.bed) : '--' }}</span>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader class="pb-2">
                    <CardTitle class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <Package class="size-4" />
                      耗材
                    </CardTitle>
                  </CardHeader>
                  <CardContent class="space-y-1">
                    <div class="text-2xl font-semibold">
                      {{ filledTrayCount }}
                    </div>
                    <p class="truncate text-sm text-muted-foreground">
                      {{ activeTray?.label ?? '未选择槽位' }}
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Alert v-if="!store.hasStatus" class="border-dashed">
                <Database class="size-4" />
                <AlertTitle>暂无状态数据</AlertTitle>
                <AlertDescription class="flex items-center gap-2">
                  <span>{{ store.configured ? '打印机已配置，等待连接…' : '请先配置打印机连接信息。' }}</span>
                  <Button type="button" variant="outline" size="sm" @click="connectionDialogOpen = true">
                    <Cable class="size-3.5" />
                    连接配置
                  </Button>
                </AlertDescription>
              </Alert>

              <Card>
                <CardHeader>
                  <CardTitle class="flex items-center gap-2 text-base">
                    <Gauge class="size-4" />
                    远程控制
                  </CardTitle>
                  <CardDescription>{{ store.connected ? '命令会通过本地连接发送' : '连接后可用' }}</CardDescription>
                </CardHeader>
                <CardContent class="space-y-4">
                  <div class="grid gap-2 sm:grid-cols-3">
                    <Button type="button" variant="outline" :disabled="!canPause || store.commanding" @click="runCommand('暂停打印', { type: 'pause' })">
                      <Pause class="size-4" />
                      暂停
                    </Button>
                    <Button type="button" variant="outline" :disabled="!canResume || store.commanding" @click="runCommand('继续打印', { type: 'resume' })">
                      <Play class="size-4" />
                      继续
                    </Button>
                    <Button type="button" variant="destructive" :disabled="!canStop || store.commanding" @click="runCommand('停止打印', { type: 'stop' }, '停止打印不可撤销，确认发送停止命令？')">
                      <Square class="size-4" />
                      停止
                    </Button>
                  </div>

                  <div class="grid gap-2 sm:grid-cols-4">
                    <Button
                      v-for="option in speedOptions"
                      :key="option.level"
                      type="button"
                      variant="outline"
                      :disabled="!canSetSpeed || store.commanding"
                      :class="String(option.level) === store.status?.state.speedLevel ? 'border-primary' : ''"
                      @click="runCommand(`速度 ${option.label}`, { type: 'speed', level: option.level })"
                    >
                      {{ option.label }}
                    </Button>
                  </div>

                  <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <Button type="button" variant="outline" :disabled="!store.connected || store.commanding" @click="runCommand('灯光开关', { type: 'light', node: 'chamber_light', mode: chamberLight?.mode === 'on' ? 'off' : 'on' })">
                      <Lightbulb class="size-4" />
                      {{ chamberLight?.mode === 'on' ? '关灯' : '开灯' }}
                    </Button>
                    <Button type="button" variant="outline" :disabled="!store.connected || store.commanding" @click="runCommand('录像设置', { type: 'camera-record', enabled: !store.status?.camera.recordEnabled })">
                      <Camera class="size-4" />
                      {{ store.status?.camera.recordEnabled ? '停录像' : '录像' }}
                    </Button>
                    <Button type="button" variant="outline" :disabled="!store.connected || store.commanding" @click="runCommand('延时摄影设置', { type: 'camera-timelapse', enabled: !store.status?.camera.timelapseEnabled })">
                      <Video class="size-4" />
                      {{ store.status?.camera.timelapseEnabled ? '停延时' : '延时' }}
                    </Button>
                    <Button type="button" variant="outline" :disabled="!store.connected" @click="refreshCamera">
                      <RefreshCw class="size-4" />
                      视频
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Tabs v-if="store.hasStatus" default-value="overview" class="w-full">
                <TabsList class="grid h-auto w-full grid-cols-2 sm:grid-cols-5">
                  <TabsTrigger value="overview">概览</TabsTrigger>
                  <TabsTrigger value="video">视频</TabsTrigger>
                  <TabsTrigger value="trend">趋势</TabsTrigger>
                  <TabsTrigger value="filament">耗材</TabsTrigger>
                  <TabsTrigger value="events">事件</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" class="mt-4 grid gap-4 lg:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle class="flex items-center gap-2 text-base">
                        <Layers class="size-4" />
                        任务
                      </CardTitle>
                    </CardHeader>
                    <CardContent class="space-y-4 text-sm">
                      <div class="grid grid-cols-2 gap-3">
                        <div>
                          <p class="text-muted-foreground">层数</p>
                          <p class="font-medium">{{ formatLayer(store.status?.state.currentLayer, store.status?.state.totalLayers) }}</p>
                        </div>
                        <div>
                          <p class="text-muted-foreground">剩余时间</p>
                          <p class="font-medium">{{ formatMinutes(store.status?.state.remainingMinutes) }}</p>
                        </div>
                        <div>
                          <p class="text-muted-foreground">阶段</p>
                          <p class="font-medium">{{ store.status?.state.stage || '--' }}</p>
                        </div>
                        <div>
                          <p class="text-muted-foreground">预计完成</p>
                          <p class="font-medium">{{ formatDateTime(store.status?.jobTiming.estimatedDoneAt) }}</p>
                        </div>
                      </div>
                      <Separator />
                      <div class="flex items-center justify-between gap-3">
                        <span class="flex items-center gap-2 text-muted-foreground">
                          <Clock class="size-4" />
                          最后上报
                        </span>
                        <span class="font-medium">{{ formatDateTime(store.connection.lastReportAt) }}</span>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle class="flex items-center gap-2 text-base">
                        <Fan class="size-4" />
                        风扇与腔体
                      </CardTitle>
                    </CardHeader>
                    <CardContent class="space-y-4 text-sm">
                      <div class="flex items-center justify-between">
                        <span class="text-muted-foreground">腔体温度</span>
                        <span class="font-medium">{{ formatNumber(store.status?.temperatures.chamber) }} °C</span>
                      </div>
                      <Separator />
                      <div class="grid gap-3 sm:grid-cols-2">
                        <div v-for="fan in store.status?.fans ?? []" :key="fan.key" class="rounded-md border p-3">
                          <p class="text-muted-foreground">{{ fan.label }}</p>
                          <p class="mt-1 text-lg font-semibold">{{ formatFan(fan) }}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="video" class="mt-4">
                  <Card>
                    <CardHeader>
                      <CardTitle class="flex items-center gap-2 text-base">
                        <Video class="size-4" />
                        实时视频
                      </CardTitle>
                      <CardDescription>
                        {{ store.config.settings.camera.source === 'bambu' ? 'Bambu 内置相机 · 自动协议代理' : '外部相机 · ffmpeg 代理' }}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div class="aspect-video overflow-hidden rounded-md border bg-neutral-950">
                        <img
                          v-if="canShowCameraStream"
                          :src="cameraStreamUrl"
                          alt="Bambu Lab camera stream"
                          class="h-full w-full object-contain"
                          @load="handleCameraLoad"
                          @error="handleCameraError"
                        >
                        <div v-else class="flex h-full items-center justify-center p-6 text-center text-sm text-neutral-200">
                          {{ cameraUnavailableMessage }}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="trend" class="mt-4">
                  <Card>
                    <CardHeader>
                      <CardTitle class="flex items-center gap-2 text-base">
                        <History class="size-4" />
                        历史趋势
                      </CardTitle>
                      <CardDescription>最近 {{ recentHistory.length }} 个本地采样点</CardDescription>
                    </CardHeader>
                    <CardContent class="space-y-4">
                      <div class="h-56 rounded-md border p-3">
                        <svg viewBox="0 0 100 48" preserveAspectRatio="none" class="h-full w-full">
                          <polyline points="0,44 100,44" fill="none" stroke="currentColor" class="text-border" stroke-width="0.5" />
                          <polyline v-if="progressPolyline" :points="progressPolyline" fill="none" stroke="#2563eb" stroke-width="1.8" vector-effect="non-scaling-stroke" />
                          <polyline v-if="nozzlePolyline" :points="nozzlePolyline" fill="none" stroke="#dc2626" stroke-width="1.4" vector-effect="non-scaling-stroke" />
                          <polyline v-if="bedPolyline" :points="bedPolyline" fill="none" stroke="#16a34a" stroke-width="1.4" vector-effect="non-scaling-stroke" />
                        </svg>
                      </div>
                      <div class="grid gap-2 text-sm sm:grid-cols-3">
                        <div class="flex items-center gap-2"><span class="size-3 rounded-full bg-blue-600" />进度</div>
                        <div class="flex items-center gap-2"><span class="size-3 rounded-full bg-red-600" />喷嘴</div>
                        <div class="flex items-center gap-2"><span class="size-3 rounded-full bg-green-600" />热床</div>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="filament" class="mt-4 space-y-4">
                  <Alert v-if="!store.status?.ams.units.length && !store.status?.ams.externalSpool" class="border-dashed">
                    <Package class="size-4" />
                    <AlertTitle>未发现耗材数据</AlertTitle>
                    <AlertDescription>打印机尚未上报 AMS 或外置料架信息。</AlertDescription>
                  </Alert>

                  <div class="grid gap-4 xl:grid-cols-2">
                    <Card v-for="unit in store.status?.ams.units ?? []" :key="unit.id">
                      <CardHeader>
                        <CardTitle class="text-base">AMS {{ unit.id }}</CardTitle>
                        <CardDescription>
                          湿度 {{ formatNumber(unit.humidity) }} · 温度 {{ formatNumber(unit.temperature) }} °C
                        </CardDescription>
                      </CardHeader>
                      <CardContent class="grid gap-3 sm:grid-cols-2">
                        <div v-for="tray in unit.trays" :key="tray.id" class="rounded-md border p-3 transition-colors" :class="tray.active ? 'border-sky-300 bg-sky-50' : 'bg-card'">
                          <div class="flex items-start justify-between gap-3">
                            <div class="min-w-0">
                              <p class="font-medium">槽位 {{ tray.slotId + 1 }}</p>
                              <p class="truncate text-sm text-muted-foreground">{{ tray.label }}</p>
                            </div>
                            <span class="size-6 shrink-0 rounded-full border" :style="{ backgroundColor: trayColor(tray) }" />
                          </div>
                          <div class="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                            <span>类型 {{ tray.type ?? '--' }}</span>
                            <span>喷嘴 {{ formatTrayTemperature(tray) }}</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <Card v-if="store.status?.ams.externalSpool">
                      <CardHeader>
                        <CardTitle class="text-base">外置料架</CardTitle>
                        <CardDescription>{{ store.status.ams.trayNow === '254' ? '当前使用' : '已上报' }}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div class="rounded-md border p-3">
                          <div class="flex items-center justify-between gap-3">
                            <div>
                              <p class="font-medium">{{ store.status.ams.externalSpool.label }}</p>
                              <p class="text-sm text-muted-foreground">{{ store.status.ams.externalSpool.type ?? '--' }}</p>
                            </div>
                            <span class="size-6 rounded-full border" :style="{ backgroundColor: trayColor(store.status.ams.externalSpool) }" />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>

                <TabsContent value="events" class="mt-4 space-y-4">
                  <Alert v-if="latestCriticalEvent" :class="eventClass(latestCriticalEvent)">
                    <AlertTriangle class="size-4" />
                    <AlertTitle>{{ latestCriticalEvent.kind }}</AlertTitle>
                    <AlertDescription>{{ latestCriticalEvent.message }}</AlertDescription>
                  </Alert>

                  <div class="grid gap-4 lg:grid-cols-2">
                    <Card>
                      <CardHeader>
                        <CardTitle class="flex items-center gap-2 text-base">
                          <Activity class="size-4" />
                          HMS
                        </CardTitle>
                      </CardHeader>
                      <CardContent class="space-y-3">
                        <Alert v-if="!store.status?.hms.length" class="border-dashed">
                          <Activity class="size-4" />
                          <AlertTitle>无 HMS 信息</AlertTitle>
                          <AlertDescription>当前缓存状态中没有健康管理消息。</AlertDescription>
                        </Alert>
                        <Alert v-for="message in store.status?.hms ?? []" :key="message.code" :variant="hmsVariant(message)">
                          <AlertTriangle class="size-4" />
                          <AlertTitle>{{ message.code }}</AlertTitle>
                          <AlertDescription>{{ message.message }}</AlertDescription>
                        </Alert>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle class="flex items-center gap-2 text-base">
                          <History class="size-4" />
                          时间线
                        </CardTitle>
                      </CardHeader>
                      <CardContent class="space-y-3">
                        <Alert v-if="!recentEvents.length" class="border-dashed">
                          <Database class="size-4" />
                          <AlertTitle>暂无事件</AlertTitle>
                          <AlertDescription>命令、告警和任务变化会记录在这里。</AlertDescription>
                        </Alert>
                        <div v-for="event in recentEvents" :key="event.id" class="rounded-md border p-3 text-sm" :class="eventClass(event)">
                          <div class="flex items-start justify-between gap-3">
                            <p class="font-medium">{{ event.message }}</p>
                            <Badge variant="outline" class="shrink-0 rounded-md">{{ event.level }}</Badge>
                          </div>
                          <p class="mt-1 text-xs opacity-75">{{ formatDateTime(event.at) }} · {{ event.kind }}</p>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>
              </Tabs>
            </template>
        </section>

        <ConnectionConfigDialog v-model:open="connectionDialogOpen" />
        <MonitorSettingsDialog v-model:open="monitorDialogOpen" />
      </div>
    </main>
  </TooltipProvider>
</template>
