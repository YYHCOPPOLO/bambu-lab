import type {
  AmsUnit,
  FilamentTray,
  HmsMessage,
  PrinterFan,
  PrinterCameraStatus,
  PrinterLight,
  PrinterStatus,
} from './types.js'

type JsonRecord = Record<string, unknown>

export function deepMerge(target: JsonRecord, source: JsonRecord): JsonRecord {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key]

    if (isPlainRecord(current) && isPlainRecord(value)) {
      deepMerge(current, value)
      continue
    }

    target[key] = value
  }

  return target
}

export function normalizePrinterStatus(rawState: JsonRecord, updatedAt = new Date()): PrinterStatus {
  const print = getRecord(rawState.print) ?? rawState
  const amsRoot = getRecord(print.ams)
  const trayNow = toStringValue(amsRoot?.tray_now)
  const activeTray = parseActiveTray(trayNow)
  const units = normalizeAmsUnits(amsRoot, activeTray)
  const externalSpool = normalizeExternalSpool(print, activeTray)
  const remainingMinutes = toNumber(print.mc_remaining_time)

  return {
    updatedAt: updatedAt.toISOString(),
    state: {
      gcodeState: toStringValue(print.gcode_state) ?? 'UNKNOWN',
      printName: toStringValue(print.subtask_name) ?? toStringValue(print.gcode_file) ?? '',
      progress: clampPercent(toNumber(print.mc_percent) ?? toNumber(print.gcode_file_prepare_percent) ?? 0),
      currentLayer: toNumber(print.layer_num),
      totalLayers: toNumber(print.total_layer_num),
      remainingMinutes,
      stage: toStringValue(print.stg_cur) ?? toStringValue(print.print_type) ?? '',
      speedLevel: toStringValue(print.spd_lvl) ?? toStringValue(print.spd_mag),
    },
    temperatures: {
      nozzle: {
        current: toNumber(print.nozzle_temper),
        target: toNumber(print.nozzle_target_temper),
      },
      bed: {
        current: toNumber(print.bed_temper),
        target: toNumber(print.bed_target_temper),
      },
      chamber: toNumber(print.chamber_temper),
    },
    fans: normalizeFans(print),
    lights: normalizeLights(print.lights_report),
    camera: normalizeCamera(print.ipcam),
    network: {
      wifiSignal: toStringValue(print.wifi_signal),
    },
    jobTiming: {
      startedAt: normalizeUnixDate(print.gcode_start_time),
      estimatedDoneAt: normalizeEstimatedDoneAt(updatedAt, remainingMinutes),
    },
    errorCode: normalizeErrorCode(print),
    ams: {
      trayNow,
      activeTrayId: activeTray ? `${activeTray.amsId}-${activeTray.slotId}` : null,
      units,
      externalSpool,
    },
    hms: normalizeHms(print.hms),
    rawKeys: Object.keys(print).sort(),
  }
}

function normalizeLights(value: unknown): PrinterLight[] {
  if (!Array.isArray(value))
    return []

  return value
    .map((item) => {
      const raw = getRecord(item) ?? {}
      const node = toStringValue(raw.node)
      const mode = toStringValue(raw.mode)

      if (!node || !mode)
        return null

      return { node, mode }
    })
    .filter((light): light is PrinterLight => Boolean(light))
}

function normalizeCamera(value: unknown): PrinterCameraStatus {
  const raw = getRecord(value) ?? {}

  return {
    enabled: toStringValue(raw.ipcam_dev) === '1' || toBoolean(raw.ipcam_dev) === true,
    recordEnabled: toStringValue(raw.ipcam_record) === 'enable',
    timelapseEnabled: toStringValue(raw.timelapse) === 'enable',
    resolution: toStringValue(raw.resolution),
    rtspUrl: toStringValue(raw.rtsp_url),
  }
}

function normalizeAmsUnits(
  amsRoot: JsonRecord | undefined,
  activeTray: { amsId: number, slotId: number } | null,
): AmsUnit[] {
  const rawUnits = Array.isArray(amsRoot?.ams) ? amsRoot.ams : []

  return rawUnits.map((unit, index) => {
    const rawUnit = getRecord(unit) ?? {}
    const unitId = toStringValue(rawUnit.id) ?? String(index)
    const amsId = Number.parseInt(unitId, 10)
    const trays = Array.isArray(rawUnit.tray) ? rawUnit.tray : []

    return {
      id: unitId,
      humidity: toNumber(rawUnit.humidity),
      temperature: toNumber(rawUnit.temp),
      trays: trays.map((tray, slotIndex) => normalizeTray(
        getRecord(tray) ?? {},
        Number.isFinite(amsId) ? amsId : index,
        slotIndex,
        activeTray,
      )),
    }
  })
}

function normalizeExternalSpool(
  print: JsonRecord,
  activeTray: { amsId: number, slotId: number } | null,
): FilamentTray | null {
  const vtTray = getRecord(print.vt_tray)

  if (!vtTray)
    return null

  const tray = normalizeTray(vtTray, 255, 255, activeTray)
  return tray.exists ? tray : null
}

function normalizeTray(
  rawTray: JsonRecord,
  amsId: number,
  slotId: number,
  activeTray: { amsId: number, slotId: number } | null,
): FilamentTray {
  const id = toStringValue(rawTray.id) ?? String(slotId)
  const type = toStringValue(rawTray.tray_type) ?? undefined
  const subBrand = toStringValue(rawTray.tray_sub_brands) ?? undefined
  const color = normalizeColor(toStringValue(rawTray.tray_color))
  const trayInfoIdx = toStringValue(rawTray.tray_info_idx) ?? undefined
  const exists = Boolean(type || subBrand || color || trayInfoIdx || toStringValue(rawTray.tray_uuid))
  const label = exists ? [subBrand, type].filter(Boolean).join(' ') || 'Filament' : '空槽位'

  return {
    id,
    amsId,
    slotId,
    label,
    exists,
    active: Boolean(activeTray && activeTray.amsId === amsId && activeTray.slotId === slotId),
    type,
    subBrand,
    color,
    trayInfoIdx,
    nozzleTempMin: toNumber(rawTray.nozzle_temp_min),
    nozzleTempMax: toNumber(rawTray.nozzle_temp_max),
    bedTemp: toNumber(rawTray.bed_temp),
    weight: toNumber(rawTray.tray_weight),
  }
}

function normalizeFans(print: JsonRecord): PrinterFan[] {
  return [
    {
      key: 'cooling',
      label: '部件风扇',
      speed: toNumber(print.cooling_fan_speed),
    },
    {
      key: 'aux',
      label: '辅助风扇',
      speed: toNumber(print.big_fan1_speed),
      installed: toBoolean(print.aux_part_fan),
    },
    {
      key: 'chamber',
      label: '腔体风扇',
      speed: toNumber(print.big_fan2_speed),
    },
    {
      key: 'heatbreak',
      label: '热端风扇',
      speed: toNumber(print.heatbreak_fan_speed),
    },
  ]
}

function normalizeHms(value: unknown): HmsMessage[] {
  if (!Array.isArray(value))
    return []

  return value.map((item, index) => {
    const raw = getRecord(item) ?? {}
    const code = toStringValue(raw.code) ?? toStringValue(raw.hms_id) ?? `HMS-${index + 1}`
    const level = inferHmsLevel(code, raw)

    return {
      code,
      level,
      message: toStringValue(raw.msg)
        ?? toStringValue(raw.message)
        ?? toStringValue(raw.title)
        ?? '打印机报告了一条 HMS 信息',
    }
  })
}

function normalizeUnixDate(value: unknown): string | null {
  const numeric = toNumber(value)

  if (!numeric)
    return null

  const milliseconds = numeric > 1_000_000_000_000 ? numeric : numeric * 1000
  const date = new Date(milliseconds)

  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function normalizeEstimatedDoneAt(updatedAt: Date, remainingMinutes: number | null): string | null {
  if (remainingMinutes === null || remainingMinutes <= 0)
    return null

  return new Date(updatedAt.getTime() + remainingMinutes * 60_000).toISOString()
}

function normalizeErrorCode(print: JsonRecord): string | null {
  const candidates = [
    toStringValue(print.mc_print_error_code),
    toStringValue(print.print_error),
    toStringValue(print.fail_reason),
  ]

  return candidates.find(value => Boolean(value && value !== '0')) ?? null
}

function inferHmsLevel(code: string, raw: JsonRecord): HmsMessage['level'] {
  const level = toStringValue(raw.level)?.toLowerCase()

  if (level === 'error' || level === 'warning' || level === 'info')
    return level

  return code.includes('0300') || code.includes('0500') ? 'warning' : 'info'
}

function parseActiveTray(trayNow: string | null): { amsId: number, slotId: number } | null {
  if (!trayNow)
    return null

  const numeric = Number.parseInt(trayNow, 10)

  if (!Number.isFinite(numeric) || numeric < 0 || numeric >= 254)
    return null

  return {
    amsId: Math.floor(numeric / 4),
    slotId: numeric % 4,
  }
}

function normalizeColor(value: string | null): string | undefined {
  if (!value)
    return undefined

  const hex = value.replace('#', '').trim()
  if (!/^[\da-f]{6,8}$/i.test(hex))
    return undefined

  return `#${hex.slice(0, 6).toUpperCase()}`
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function toStringValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim())
    return value.trim()

  if (typeof value === 'number' && Number.isFinite(value))
    return String(value)

  return null
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value))
    return value

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean')
    return value

  if (typeof value === 'number')
    return value !== 0

  if (typeof value === 'string')
    return value === '1' || value.toLowerCase() === 'true'

  return undefined
}

function getRecord(value: unknown): JsonRecord | undefined {
  return isPlainRecord(value) ? value : undefined
}

function isPlainRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
