import mqtt, { type IClientPublishOptions, type MqttClient } from 'mqtt'
import { deepMerge, normalizePrinterStatus } from './normalizer.js'
import { assertPrinterCommandAllowed, buildPrinterCommandPayload } from './printerCommands.js'
import type {
  PrinterCommand,
  PrinterCommandResult,
  PrinterConfig,
  PrinterConnectionState,
  PrinterStatus,
  RuntimeEvent,
} from './types.js'

type JsonRecord = Record<string, unknown>
type RuntimeListener = (event: RuntimeEvent) => void

export class BambuClient {
  private client: MqttClient | null = null
  private config: PrinterConfig | null = null
  private rawState: JsonRecord = {}
  private status: PrinterStatus | null = null
  private listeners = new Set<RuntimeListener>()
  private connectionState: PrinterConnectionState = {
    configured: false,
    status: 'idle',
  }

  getConfig(): PrinterConfig | null {
    return this.config
  }

  getState(configured = Boolean(this.config)): PrinterConnectionState {
    return {
      ...this.connectionState,
      configured,
    }
  }

  getStatus(): PrinterStatus | null {
    return this.status
  }

  subscribe(listener: RuntimeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  connect(config: PrinterConfig): PrinterConnectionState {
    this.disconnect(false)
    this.config = config
    this.rawState = {}
    this.status = null
    this.setConnectionState({
      configured: true,
      status: 'connecting',
      message: `正在连接 ${config.host}:${config.port}`,
    })

    const client = mqtt.connect(`mqtts://${config.host}:${config.port}`, {
      username: 'bblp',
      password: config.accessCode,
      clientId: config.serial,
      clean: true,
      connectTimeout: 10_000,
      reconnectPeriod: 5_000,
      rejectUnauthorized: false,
    })

    this.client = client

    client.on('connect', () => {
      const topic = this.reportTopic()
      client.subscribe(topic, { qos: 0 }, (error) => {
        if (error) {
          this.reportError(`订阅拓竹状态失败：${error.message}`)
          return
        }

        this.setConnectionState({
          configured: true,
          status: 'connected',
          message: '已连接',
          connectedAt: new Date().toISOString(),
          lastReportAt: this.connectionState.lastReportAt,
        })
        this.refresh()
      })
    })

    client.on('reconnect', () => {
      this.setConnectionState({
        ...this.connectionState,
        configured: true,
        status: 'reconnecting',
        message: '正在重连',
      })
    })

    client.on('close', () => {
      if (this.connectionState.status !== 'disconnected') {
        this.setConnectionState({
          ...this.connectionState,
          configured: true,
          status: 'disconnected',
          message: '连接已断开',
        })
      }
    })

    client.on('error', (error) => {
      this.reportError(`拓竹 MQTT 连接错误：${error.message}`)
    })

    client.on('message', (_topic, payload) => {
      this.handleMessage(payload)
    })

    return this.getState(true)
  }

  disconnect(emit = true): PrinterConnectionState {
    if (this.client) {
      this.client.removeAllListeners()
      this.client.end(true)
      this.client = null
    }

    this.setConnectionState({
      configured: Boolean(this.config),
      status: 'disconnected',
      message: '未连接',
      lastReportAt: this.connectionState.lastReportAt,
    }, emit)

    return this.getState(Boolean(this.config))
  }

  clearConfig(): void {
    this.disconnect(false)
    this.config = null
    this.rawState = {}
    this.status = null
    this.setConnectionState({
      configured: false,
      status: 'idle',
    })
  }

  refresh(): void {
    if (!this.client || !this.config || !this.client.connected)
      throw new Error('打印机尚未连接')

    this.client.publish(this.requestTopic(), JSON.stringify({
      pushing: {
        sequence_id: String(Date.now()),
        command: 'pushall',
        version: 1,
        push_target: 1,
      },
    }), { qos: 0 })
  }

  async sendCommand(command: PrinterCommand): Promise<PrinterCommandResult> {
    if (!this.client || !this.config || !this.client.connected)
      throw new Error('打印机尚未连接')

    assertPrinterCommandAllowed(command, this.status)

    const sequenceId = String(Date.now())
    const envelope = buildPrinterCommandPayload(command, sequenceId)
    await this.publish(this.requestTopic(), JSON.stringify(envelope.payload), { qos: envelope.qos })

    try {
      this.refresh()
    }
    catch {
      // Command delivery succeeded; refresh is best-effort.
    }

    return {
      ok: true,
      sequenceId,
      command,
      publishedAt: new Date().toISOString(),
    }
  }

  private async publish(topic: string, payload: string, options: IClientPublishOptions): Promise<void> {
    const client = this.client

    if (!client)
      throw new Error('打印机尚未连接')

    await new Promise<void>((resolve, reject) => {
      client.publish(topic, payload, options, (error) => {
        if (error)
          reject(error)
        else
          resolve()
      })
    })
  }

  private handleMessage(payload: Buffer): void {
    try {
      const parsed = JSON.parse(payload.toString('utf8')) as JsonRecord
      deepMerge(this.rawState, parsed)

      const lastReportAt = new Date().toISOString()
      this.status = normalizePrinterStatus(this.rawState, new Date(lastReportAt))
      this.setConnectionState({
        ...this.connectionState,
        configured: true,
        status: 'connected',
        message: '已连接',
        lastReportAt,
      })
      this.emit({ type: 'status', data: this.status })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : '无法解析打印机状态'
      this.reportError(`解析拓竹状态失败：${message}`)
    }
  }

  private reportTopic(): string {
    return `device/${this.config?.serial}/report`
  }

  private requestTopic(): string {
    return `device/${this.config?.serial}/request`
  }

  private reportError(message: string): void {
    this.setConnectionState({
      ...this.connectionState,
      configured: Boolean(this.config),
      status: 'error',
      message,
    })
    this.emit({ type: 'printer-error', data: { message } })
  }

  private setConnectionState(state: PrinterConnectionState, emit = true): void {
    this.connectionState = state

    if (emit)
      this.emit({ type: 'connection', data: state })
  }

  private emit(event: RuntimeEvent): void {
    for (const listener of this.listeners)
      listener(event)
  }
}

export const bambuClient = new BambuClient()
