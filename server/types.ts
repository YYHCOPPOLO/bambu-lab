export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error'

export type CameraSource = 'bambu' | 'external'
export type WebhookEventKind = 'connection' | 'hms' | 'command' | 'error' | 'job' | 'temperature'

export interface CameraSettings {
  enabled: boolean
  source: CameraSource
  externalUrl: string
}

export interface WebhookSettings {
  enabled: boolean
  url: string
  secret: string
}

export interface AppSettings {
  camera: CameraSettings
  webhook: WebhookSettings
  historyRetentionDays: number
}

export interface AppSettingsPatch {
  camera?: Partial<CameraSettings>
  webhook?: Partial<WebhookSettings>
  historyRetentionDays?: number
}

export interface PrinterConfig {
  name: string
  host: string
  port: number
  serial: string
  accessCode: string
}

export type PublicPrinterConfig =
  | ({ configured: false } & { settings: AppSettings })
  | ({
    configured: true
    name: string
    host: string
    port: number
    serial: string
  } & { settings: AppSettings })

export interface SavePrinterConfig {
  name: string
  host: string
  port: number
  serial: string
  accessCode?: string
  camera?: Partial<CameraSettings>
  webhook?: Partial<WebhookSettings>
}

export interface PrinterConnectionState {
  configured: boolean
  status: ConnectionStatus
  message?: string
  connectedAt?: string
  lastReportAt?: string
}

export interface TemperatureReading {
  current: number | null
  target: number | null
}

export interface PrinterFan {
  key: string
  label: string
  speed: number | null
  installed?: boolean
}

export interface HmsMessage {
  code: string
  level: 'info' | 'warning' | 'error'
  message: string
}

export interface FilamentTray {
  id: string
  amsId: number
  slotId: number
  label: string
  exists: boolean
  active: boolean
  type?: string
  subBrand?: string
  color?: string
  trayInfoIdx?: string
  nozzleTempMin?: number | null
  nozzleTempMax?: number | null
  bedTemp?: number | null
  weight?: number | null
}

export interface AmsUnit {
  id: string
  humidity: number | null
  temperature: number | null
  trays: FilamentTray[]
}

export interface PrinterLight {
  node: 'chamber_light' | 'work_light' | string
  mode: 'on' | 'off' | 'flashing' | string
}

export interface PrinterCameraStatus {
  enabled: boolean
  recordEnabled: boolean
  timelapseEnabled: boolean
  resolution: string | null
  rtspUrl: string | null
}

export interface PrinterNetworkStatus {
  wifiSignal: string | null
}

export interface PrinterJobTiming {
  startedAt: string | null
  estimatedDoneAt: string | null
}

export interface PrinterStatus {
  updatedAt: string
  state: {
    gcodeState: string
    printName: string
    progress: number
    currentLayer: number | null
    totalLayers: number | null
    remainingMinutes: number | null
    stage: string
    speedLevel: string | null
  }
  temperatures: {
    nozzle: TemperatureReading
    bed: TemperatureReading
    chamber: number | null
  }
  fans: PrinterFan[]
  lights: PrinterLight[]
  camera: PrinterCameraStatus
  network: PrinterNetworkStatus
  jobTiming: PrinterJobTiming
  errorCode: string | null
  ams: {
    trayNow: string | null
    activeTrayId: string | null
    units: AmsUnit[]
    externalSpool: FilamentTray | null
  }
  hms: HmsMessage[]
  rawKeys: string[]
}

export type PrinterCommand =
  | { type: 'pause' | 'resume' | 'stop' }
  | { type: 'speed', level: 1 | 2 | 3 | 4 }
  | { type: 'light', node: 'chamber_light' | 'work_light', mode: 'on' | 'off' | 'flashing' }
  | { type: 'camera-record' | 'camera-timelapse', enabled: boolean }

export interface PrinterCommandResult {
  ok: true
  sequenceId: string
  command: PrinterCommand
  publishedAt: string
}

export interface HistorySample {
  at: string
  gcodeState: string
  printName: string
  progress: number
  nozzleTemperature: number | null
  nozzleTarget: number | null
  bedTemperature: number | null
  bedTarget: number | null
  chamberTemperature: number | null
  speedLevel: string | null
  hmsCount: number
}

export interface EventLogEntry {
  id: string
  at: string
  kind: WebhookEventKind
  level: 'info' | 'warning' | 'error'
  message: string
  code?: string
  metadata?: Record<string, unknown>
}

export type RuntimeEvent =
  | { type: 'connection', data: PrinterConnectionState }
  | { type: 'status', data: PrinterStatus }
  | { type: 'printer-error', data: { message: string } }
