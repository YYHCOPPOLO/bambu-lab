import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Context } from 'hono'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ZodError } from 'zod'
import { bambuClient, type BambuClient } from './bambuClient.js'
import { CameraStreamError, checkCameraStream, createCameraStream } from './cameraStream.js'
import {
  deleteConfig,
  loadConfig,
  loadSettings,
  saveConfig,
  toPublicConfig,
  updateSettings,
} from './configStore.js'
import { printerCommandSchema } from './printerCommands.js'
import {
  appendStatusSample,
  getEventsLog,
  getHistory,
  recordEvent,
} from './runtimeStore.js'
import type { AppSettings, EventLogEntry, PrinterStatus, RuntimeEvent } from './types.js'
import { sendWebhook } from './webhook.js'

const distRoot = path.resolve(process.cwd(), 'dist')

interface CameraRouteHandlers {
  createCameraStream: typeof createCameraStream
  checkCameraStream: typeof checkCameraStream
}

const defaultCameraRouteHandlers = {
  createCameraStream,
  checkCameraStream,
} satisfies CameraRouteHandlers

export function createApp(
  client: BambuClient = bambuClient,
  cameraHandlers: CameraRouteHandlers = defaultCameraRouteHandlers,
): Hono {
  const app = new Hono()

  app.use('/api/*', cors({
    allowHeaders: ['Content-Type'],
    allowMethods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'PATCH', 'OPTIONS'],
    maxAge: 600,
    origin: '*',
  }))

  app.get('/api/config', async (c) => {
    const [config, settings] = await Promise.all([loadConfig(), loadSettings()])
    return c.json(toPublicConfig(config, settings))
  })

  app.put('/api/config', async (c) => {
    try {
      const body = await c.req.json()
      const config = await saveConfig(body)
      const settings = await loadSettings()
      return c.json(toPublicConfig(config, settings))
    }
    catch (error) {
      return jsonError(c, error)
    }
  })

  app.delete('/api/config', async (c) => {
    await deleteConfig()
    client.clearConfig()
    return c.json({ ok: true })
  })

  app.get('/api/settings', async (c) => {
    const settings = await loadSettings()
    return c.json(toPublicConfig(null, settings).settings)
  })

  app.put('/api/settings', async (c) => {
    try {
      const body = await c.req.json()
      const settings = await updateSettings(body)
      return c.json(toPublicConfig(null, settings).settings)
    }
    catch (error) {
      return jsonError(c, error)
    }
  })

  app.post('/api/printer/connect', async (c) => {
    const config = await loadConfig()

    if (!config)
      return c.json({ message: '尚未配置打印机' }, 409)

    const state = client.connect(config)
    return c.json(state)
  })

  app.post('/api/printer/disconnect', (c) => {
    return c.json(client.disconnect())
  })

  app.post('/api/printer/refresh', (c) => {
    try {
      client.refresh()
      return c.json({ ok: true })
    }
    catch (error) {
      return jsonError(c, error, 409)
    }
  })

  app.post('/api/printer/command', async (c) => {
    try {
      const command = printerCommandSchema.parse(await c.req.json())
      const result = await client.sendCommand(command)
      const settings = await loadSettings()
      const event = await recordEvent({
        kind: 'command',
        level: command.type === 'stop' ? 'warning' : 'info',
        message: commandLabel(command.type),
        metadata: { command, sequenceId: result.sequenceId },
      }, settings.historyRetentionDays)

      queueWebhook(event, settings)
      return c.json(result)
    }
    catch (error) {
      return jsonError(c, error, 409)
    }
  })

  app.get('/api/printer/status', (c) => {
    return c.json({
      connection: client.getState(),
      status: client.getStatus(),
    })
  })

  app.get('/api/printer/history', async (c) => {
    const settings = await loadSettings()
    return c.json(await getHistory(settings.historyRetentionDays))
  })

  app.get('/api/printer/events-log', async (c) => {
    const settings = await loadSettings()
    return c.json(await getEventsLog(settings.historyRetentionDays))
  })

  app.get('/api/printer/camera/stream', async (c) => {
    try {
      const [config, settings] = await Promise.all([loadConfig(), loadSettings()])

      if (!config)
        return c.json({ message: '尚未配置打印机' }, 409)

      return await cameraHandlers.createCameraStream(config, settings, client.getStatus())
    }
    catch (error) {
      return jsonError(c, error, error instanceof CameraStreamError ? error.status : 409)
    }
  })

  app.get('/api/printer/camera/check', async (c) => {
    try {
      const [config, settings] = await Promise.all([loadConfig(), loadSettings()])

      if (!config)
        return c.json({ message: '尚未配置打印机' }, 409)

      const result = await cameraHandlers.checkCameraStream(config, settings, client.getStatus())
      return c.json(result)
    }
    catch (error) {
      return jsonError(c, error, error instanceof CameraStreamError ? error.status : 409)
    }
  })

  app.get('/api/printer/events', () => {
    const encoder = new TextEncoder()
    let unsubscribe: (() => void) | null = null
    let heartbeat: ReturnType<typeof setInterval> | null = null

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: RuntimeEvent) => {
          controller.enqueue(encoder.encode(`event: ${event.type}\n`))
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event.data)}\n\n`))
        }

        send({ type: 'connection', data: client.getState() })

        const status = client.getStatus()
        if (status)
          send({ type: 'status', data: status })

        unsubscribe = client.subscribe(send)
        heartbeat = setInterval(() => {
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
        }, 25_000)
      },
      cancel() {
        unsubscribe?.()

        if (heartbeat)
          clearInterval(heartbeat)
      },
    })

    return new Response(stream, {
      headers: {
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Content-Type': 'text/event-stream',
        'X-Accel-Buffering': 'no',
      },
    })
  })

  app.use('/assets/*', serveStatic({ root: distRoot }))
  app.use('/favicon.ico', serveStatic({ path: `${distRoot}/favicon.ico` }))
  app.use('*', serveStatic({ root: distRoot }))
  app.get('*', serveStatic({ path: `${distRoot}/index.html` }))

  return app
}

export const app = createApp()

let previousJobState: string | null = null
let lastTemperatureAlertAt = 0

export function startRuntimeObserver(client: BambuClient = bambuClient): () => void {
  return client.subscribe((event) => {
    void handleRuntimeEvent(event)
  })
}

function startServer(): ReturnType<typeof serve> {
  const port = Number(process.env.PORT ?? 8787)
  const hostname = process.env.HOST ?? '127.0.0.1'

  const server = serve({
    fetch: app.fetch,
    hostname,
    port,
  }, (info) => {
    console.log(`Bambu Lab monitor API listening on http://${info.address}:${info.port}`)
  })

  startRuntimeObserver()

  loadConfig()
    .then((config) => {
      if (config)
        bambuClient.connect(config)
    })
    .catch((error) => {
      console.error(error)
    })

  return server
}

async function handleRuntimeEvent(event: RuntimeEvent): Promise<void> {
  const settings = await loadSettings()

  if (event.type === 'status') {
    const createdEvents = await appendStatusSample(event.data, settings.historyRetentionDays)
    const jobEvent = await maybeRecordJobEvent(event.data.state.gcodeState, settings)
    const temperatureEvent = await maybeRecordTemperatureEvent(event.data, settings)

    for (const entry of [...createdEvents, jobEvent, temperatureEvent].filter(Boolean))
      queueWebhook(entry as EventLogEntry, settings)
  }

  if (event.type === 'printer-error') {
    const entry = await recordEvent({
      kind: 'error',
      level: 'error',
      message: event.data.message,
    }, settings.historyRetentionDays)
    queueWebhook(entry, settings)
  }

  if (event.type === 'connection' && event.data.status === 'error') {
    const entry = await recordEvent({
      kind: 'connection',
      level: 'error',
      message: event.data.message ?? '连接错误',
      metadata: { status: event.data.status },
    }, settings.historyRetentionDays)
    queueWebhook(entry, settings)
  }
}

async function maybeRecordJobEvent(state: string, settings: AppSettings): Promise<EventLogEntry | null> {
  const normalized = state.toUpperCase()
  const previous = previousJobState
  previousJobState = normalized

  if (previous === normalized)
    return null

  if (normalized === 'FINISH' || normalized === 'FINISHED') {
    return recordEvent({
      kind: 'job',
      level: 'info',
      message: '打印任务已完成',
      metadata: { state },
    }, settings.historyRetentionDays)
  }

  if (normalized === 'FAILED') {
    return recordEvent({
      kind: 'job',
      level: 'error',
      message: '打印任务失败',
      metadata: { state },
    }, settings.historyRetentionDays)
  }

  return null
}

async function maybeRecordTemperatureEvent(
  status: PrinterStatus,
  settings: AppSettings,
): Promise<EventLogEntry | null> {
  const now = Date.now()
  if (now - lastTemperatureAlertAt < 10 * 60 * 1000)
    return null

  const nozzle = status.temperatures.nozzle
  const bed = status.temperatures.bed
  const nozzleOverTarget = nozzle.current !== null && nozzle.target !== null && nozzle.current > nozzle.target + 20
  const bedOverTarget = bed.current !== null && bed.target !== null && bed.current > bed.target + 15

  if (!nozzleOverTarget && !bedOverTarget)
    return null

  lastTemperatureAlertAt = now
  return recordEvent({
    kind: 'temperature',
    level: 'warning',
    message: '检测到温度明显高于目标值',
    metadata: {
      nozzle,
      bed,
    },
  }, settings.historyRetentionDays)
}

function queueWebhook(event: EventLogEntry, settings: AppSettings): void {
  void sendWebhook(event, settings).catch(async (error) => {
    await recordEvent({
      kind: 'error',
      level: 'warning',
      message: `Webhook 推送失败：${error instanceof Error ? error.message : '未知错误'}`,
      metadata: { sourceEventId: event.id },
    }, settings.historyRetentionDays)
  })
}

function commandLabel(type: string): string {
  const labels: Record<string, string> = {
    pause: '暂停打印命令已发送',
    resume: '继续打印命令已发送',
    stop: '停止打印命令已发送',
    speed: '速度档位命令已发送',
    light: '灯光命令已发送',
    'camera-record': '录像设置命令已发送',
    'camera-timelapse': '延时摄影设置命令已发送',
  }

  return labels[type] ?? '打印机命令已发送'
}

function jsonError(c: Context, error: unknown, status: 400 | 409 | 503 = 400) {
  if (error instanceof ZodError) {
    return c.json({
      message: '配置格式不正确',
      issues: error.issues.map(issue => issue.message),
    }, status)
  }

  const message = error instanceof Error ? error.message : '请求处理失败'
  return c.json({ message }, status)
}

if (isMainModule()) {
  const server = startServer()

  process.on('SIGINT', () => shutdown(server))
  process.on('SIGTERM', () => shutdown(server))
}

function shutdown(server: ReturnType<typeof serve>): void {
  bambuClient.disconnect(false)
  server.close(() => process.exit(0))
}

function isMainModule(): boolean {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
}
