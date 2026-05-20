import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api, ApiError } from '@/lib/api'
import type {
  AppSettings,
  AppSettingsPatch,
  EventLogEntry,
  HistorySample,
  PrinterCommand,
  PrinterCommandResult,
  PrinterConnectionState,
  PrinterStatus,
  PublicPrinterConfig,
  SavePrinterConfig,
} from '@/types/printer'

const defaultSettings: AppSettings = {
  camera: {
    enabled: true,
    source: 'bambu',
    externalUrl: '',
  },
  webhook: {
    enabled: false,
    url: '',
    secret: '',
  },
  historyRetentionDays: 7,
}

const idleConnection: PrinterConnectionState = {
  configured: false,
  status: 'idle',
}

export const usePrinterStore = defineStore('printer', () => {
  const config = ref<PublicPrinterConfig>({ configured: false, settings: defaultSettings })
  const connection = ref<PrinterConnectionState>(idleConnection)
  const status = ref<PrinterStatus | null>(null)
  const history = ref<HistorySample[]>([])
  const eventsLog = ref<EventLogEntry[]>([])
  const lastCommand = ref<PrinterCommandResult | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const commanding = ref(false)
  const error = ref<string | null>(null)
  let eventSource: EventSource | null = null

  const configured = computed(() => config.value.configured)
  const connected = computed(() => connection.value.status === 'connected')
  const hasStatus = computed(() => Boolean(status.value))
  const settings = computed(() => config.value.settings)

  async function initialize(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const [loadedConfig, response, loadedHistory, loadedEvents] = await Promise.all([
        api.getConfig(),
        api.getStatus(),
        api.getHistory(),
        api.getEventsLog(),
      ])

      config.value = loadedConfig
      connection.value = {
        ...response.connection,
        configured: loadedConfig.configured,
      }
      status.value = response.status
      history.value = loadedHistory
      eventsLog.value = loadedEvents
      openEvents()

      if (
        loadedConfig.configured
        && !['connected', 'connecting', 'reconnecting'].includes(response.connection.status)
      ) {
        try {
          connection.value = await api.connect()
          openEvents()
        }
        catch {
          // Auto-connect failure is non-fatal; user sees the disconnected state.
        }
      }
    }
    catch (caught) {
      error.value = getErrorMessage(caught)
    }
    finally {
      loading.value = false
    }
  }

  async function savePrinterConfig(payload: SavePrinterConfig, connectAfterSave: boolean): Promise<void> {
    saving.value = true
    error.value = null

    try {
      config.value = await api.saveConfig(payload)

      if (connectAfterSave)
        await connectPrinter()
    }
    catch (caught) {
      error.value = getErrorMessage(caught)
      throw caught
    }
    finally {
      saving.value = false
    }
  }

  async function saveSettings(payload: AppSettingsPatch): Promise<void> {
    saving.value = true
    error.value = null

    try {
      const nextSettings = await api.saveSettings(payload)
      config.value = {
        ...config.value,
        settings: nextSettings,
      } as PublicPrinterConfig
    }
    catch (caught) {
      error.value = getErrorMessage(caught)
      throw caught
    }
    finally {
      saving.value = false
    }
  }

  async function deletePrinterConfig(): Promise<void> {
    error.value = null

    try {
      await api.deleteConfig()
      closeEvents()
      config.value = { configured: false, settings: config.value.settings }
      connection.value = idleConnection
      status.value = null
      openEvents()
    }
    catch (caught) {
      error.value = getErrorMessage(caught)
    }
  }

  async function connectPrinter(): Promise<void> {
    error.value = null

    try {
      connection.value = await api.connect()
      openEvents()
    }
    catch (caught) {
      error.value = getErrorMessage(caught)
    }
  }

  async function disconnectPrinter(): Promise<void> {
    error.value = null

    try {
      connection.value = await api.disconnect()
    }
    catch (caught) {
      error.value = getErrorMessage(caught)
    }
  }

  async function refreshPrinter(): Promise<void> {
    error.value = null

    try {
      await api.refresh()
    }
    catch (caught) {
      error.value = getErrorMessage(caught)
    }
  }

  async function sendCommand(command: PrinterCommand): Promise<void> {
    commanding.value = true
    error.value = null

    try {
      lastCommand.value = await api.sendCommand(command)
      await refreshRuntimeLogs()
    }
    catch (caught) {
      error.value = getErrorMessage(caught)
      throw caught
    }
    finally {
      commanding.value = false
    }
  }

  async function refreshRuntimeLogs(): Promise<void> {
    try {
      const [loadedHistory, loadedEvents] = await Promise.all([
        api.getHistory(),
        api.getEventsLog(),
      ])
      history.value = loadedHistory
      eventsLog.value = loadedEvents
    }
    catch {
      // Runtime logs are non-critical; status errors remain owned by main requests.
    }
  }

  function openEvents(): void {
    if (eventSource)
      return

    eventSource = new EventSource('/api/printer/events')
    eventSource.addEventListener('connection', (event) => {
      connection.value = JSON.parse((event as MessageEvent).data) as PrinterConnectionState
    })
    eventSource.addEventListener('status', (event) => {
      status.value = JSON.parse((event as MessageEvent).data) as PrinterStatus
      void refreshRuntimeLogs()
    })
    eventSource.addEventListener('printer-error', (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { message: string }
      error.value = payload.message
      void refreshRuntimeLogs()
    })
    eventSource.onerror = () => {
      if (connection.value.status === 'connected')
        connection.value = { ...connection.value, status: 'reconnecting', message: '实时状态连接中断' }
    }
  }

  function closeEvents(): void {
    eventSource?.close()
    eventSource = null
  }

  return {
    command: sendCommand,
    commanding,
    config,
    configured,
    connected,
    connection,
    deletePrinterConfig,
    disconnectPrinter,
    error,
    eventsLog,
    hasStatus,
    history,
    initialize,
    lastCommand,
    loading,
    refreshPrinter,
    refreshRuntimeLogs,
    savePrinterConfig,
    saveSettings,
    saving,
    settings,
    status,
  }
})

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError)
    return error.message

  if (error instanceof Error)
    return error.message

  return '请求失败'
}
