import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { dataPath } from './configStore.js'
import type {
  EventLogEntry,
  HistorySample,
  HmsMessage,
  PrinterStatus,
  WebhookEventKind,
} from './types.js'

const RUNTIME_FILE = 'runtime-log.json'
const MAX_EVENTS = 500
const MIN_SAMPLE_INTERVAL_MS = 30_000

interface RuntimeData {
  history: HistorySample[]
  events: EventLogEntry[]
}

interface EventInput {
  kind: WebhookEventKind
  level: EventLogEntry['level']
  message: string
  code?: string
  metadata?: Record<string, unknown>
  at?: string
}

const emptyRuntimeData: RuntimeData = {
  history: [],
  events: [],
}

let writeQueue = Promise.resolve()

export async function getHistory(retentionDays = 7): Promise<HistorySample[]> {
  const data = pruneRuntimeData(await loadRuntimeData(), retentionDays)
  return data.history
}

export async function getEventsLog(retentionDays = 7): Promise<EventLogEntry[]> {
  const data = pruneRuntimeData(await loadRuntimeData(), retentionDays)
  return data.events
}

export async function appendStatusSample(status: PrinterStatus, retentionDays = 7): Promise<EventLogEntry[]> {
  let createdEvents: EventLogEntry[] = []

  await withRuntimeData(async (data) => {
    const sample = createHistorySample(status)
    const previous = data.history.at(-1)

    if (previous && Date.parse(sample.at) - Date.parse(previous.at) < MIN_SAMPLE_INTERVAL_MS)
      data.history[data.history.length - 1] = sample
    else
      data.history.push(sample)

    createdEvents = appendHmsEvents(data, status.hms, sample.at)
    return pruneRuntimeData(data, retentionDays)
  })

  return createdEvents
}

export async function recordEvent(input: EventInput, retentionDays = 7): Promise<EventLogEntry> {
  const event = createEvent(input)

  await withRuntimeData(async (data) => {
    data.events.push(event)
    return pruneRuntimeData(data, retentionDays)
  })

  return event
}

export function createHistorySample(status: PrinterStatus): HistorySample {
  return {
    at: status.updatedAt,
    gcodeState: status.state.gcodeState,
    printName: status.state.printName,
    progress: status.state.progress,
    nozzleTemperature: status.temperatures.nozzle.current,
    nozzleTarget: status.temperatures.nozzle.target,
    bedTemperature: status.temperatures.bed.current,
    bedTarget: status.temperatures.bed.target,
    chamberTemperature: status.temperatures.chamber,
    speedLevel: status.state.speedLevel,
    hmsCount: status.hms.length,
  }
}

export function pruneRuntimeData(data: RuntimeData, retentionDays = 7, now = new Date()): RuntimeData {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000

  return {
    history: data.history.filter(sample => Date.parse(sample.at) >= cutoff),
    events: data.events
      .filter(event => Date.parse(event.at) >= cutoff)
      .slice(-MAX_EVENTS),
  }
}

async function withRuntimeData(update: (data: RuntimeData) => Promise<RuntimeData> | RuntimeData): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    const data = await loadRuntimeData()
    const updated = await update(data)
    await writeRuntimeData(updated)
  })

  await writeQueue
}

async function loadRuntimeData(): Promise<RuntimeData> {
  try {
    const raw = await readFile(dataPath(RUNTIME_FILE), 'utf8')
    const parsed = JSON.parse(raw) as Partial<RuntimeData>

    return {
      history: Array.isArray(parsed.history) ? parsed.history : [],
      events: Array.isArray(parsed.events) ? parsed.events : [],
    }
  }
  catch (error) {
    if (isReadableEmptyState(error))
      return { ...emptyRuntimeData }

    throw error
  }
}

async function writeRuntimeData(data: RuntimeData): Promise<void> {
  await mkdir(path.dirname(dataPath(RUNTIME_FILE)), { recursive: true })
  await writeFile(dataPath(RUNTIME_FILE), `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

function appendHmsEvents(data: RuntimeData, messages: HmsMessage[], at: string): EventLogEntry[] {
  const events: EventLogEntry[] = []

  for (const message of messages) {
    const alreadySeen = data.events.some((event) => {
      if (event.kind !== 'hms' || event.code !== message.code)
        return false

      return Date.parse(at) - Date.parse(event.at) < 10 * 60 * 1000
    })

    if (alreadySeen)
      continue

    const event = createEvent({
      kind: 'hms',
      level: message.level,
      code: message.code,
      message: message.message,
      at,
    })

    data.events.push(event)
    events.push(event)
  }

  return events
}

function createEvent(input: EventInput): EventLogEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: input.at ?? new Date().toISOString(),
    kind: input.kind,
    level: input.level,
    message: input.message,
    code: input.code,
    metadata: input.metadata,
  }
}

function isReadableEmptyState(error: unknown): boolean {
  if (error instanceof SyntaxError)
    return true

  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
