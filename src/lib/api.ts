import type {
  AppSettings,
  AppSettingsPatch,
  CameraCheckResponse,
  EventLogEntry,
  HistorySample,
  PrinterCommand,
  PrinterCommandResult,
  PrinterConnectionState,
  PrinterStatusResponse,
  PublicPrinterConfig,
  SavePrinterConfig,
} from '@/types/printer'

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export const api = {
  getConfig: () => requestJson<PublicPrinterConfig>('/api/config'),
  saveConfig: (payload: SavePrinterConfig) => requestJson<PublicPrinterConfig>('/api/config', {
    method: 'PUT',
    body: JSON.stringify(payload),
  }),
  deleteConfig: () => requestJson<{ ok: true }>('/api/config', { method: 'DELETE' }),
  getSettings: () => requestJson<AppSettings>('/api/settings'),
  saveSettings: (payload: AppSettingsPatch) => requestJson<AppSettings>('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(payload),
  }),
  connect: () => requestJson<PrinterConnectionState>('/api/printer/connect', { method: 'POST' }),
  disconnect: () => requestJson<PrinterConnectionState>('/api/printer/disconnect', { method: 'POST' }),
  refresh: () => requestJson<{ ok: true }>('/api/printer/refresh', { method: 'POST' }),
  sendCommand: (payload: PrinterCommand) => requestJson<PrinterCommandResult>('/api/printer/command', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  getStatus: () => requestJson<PrinterStatusResponse>('/api/printer/status'),
  getHistory: () => requestJson<HistorySample[]>('/api/printer/history'),
  getEventsLog: () => requestJson<EventLogEntry[]>('/api/printer/events-log'),
  checkCamera: () => requestJson<CameraCheckResponse>('/api/printer/camera/check'),
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })

  const payload = await response.json().catch(() => null) as { message?: string } | null

  if (!response.ok)
    throw new ApiError(payload?.message ?? `请求失败：${response.status}`, response.status)

  if (!payload)
    throw new ApiError(`请求返回了无效 JSON：${response.status}`, response.status)

  return payload as T
}
