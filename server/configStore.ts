import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z, ZodError } from 'zod'
import type {
  AppSettings,
  AppSettingsPatch,
  PrinterConfig,
  PublicPrinterConfig,
  SavePrinterConfig,
} from './types.js'

const DATA_DIR = 'server/data'
const CONFIG_FILE = 'printer-config.json'
const SETTINGS_FILE = 'app-settings.json'

export const defaultSettings: AppSettings = {
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

export const printerConfigSchema = z.object({
  name: z.string().trim().min(1).default('Bambu Lab'),
  host: z.string().trim().min(1),
  port: z.coerce.number().int().min(1).max(65535).default(8883),
  serial: z.string().trim().min(6),
  accessCode: z.string().trim().min(1),
})

export const appSettingsSchema = z.object({
  camera: z.object({
    enabled: z.boolean().default(defaultSettings.camera.enabled),
    source: z.enum(['bambu', 'external']).default(defaultSettings.camera.source),
    externalUrl: z.string().trim().default(defaultSettings.camera.externalUrl),
  }).partial().default(defaultSettings.camera),
  webhook: z.object({
    enabled: z.boolean().default(defaultSettings.webhook.enabled),
    url: z.string().trim().default(defaultSettings.webhook.url),
    secret: z.string().trim().default(defaultSettings.webhook.secret),
  }).partial().default(defaultSettings.webhook),
  historyRetentionDays: z.coerce.number().int().min(1).max(30).default(defaultSettings.historyRetentionDays),
}).partial()

export function normalizeSettings(input: unknown): AppSettings {
  const parsed = appSettingsSchema.parse(input ?? {})

  return {
    camera: {
      ...defaultSettings.camera,
      ...parsed.camera,
    },
    webhook: {
      ...defaultSettings.webhook,
      ...parsed.webhook,
    },
    historyRetentionDays: parsed.historyRetentionDays ?? defaultSettings.historyRetentionDays,
  }
}

export function toPublicConfig(
  config: PrinterConfig | null,
  settings: AppSettings = defaultSettings,
): PublicPrinterConfig {
  if (!config)
    return { configured: false, settings: redactSettings(settings) }

  return {
    configured: true,
    name: config.name,
    host: config.host,
    port: config.port,
    serial: config.serial,
    settings: redactSettings(settings),
  }
}

export async function loadConfig(): Promise<PrinterConfig | null> {
  try {
    const raw = await readFile(dataPath(CONFIG_FILE), 'utf8')
    return printerConfigSchema.parse(JSON.parse(raw))
  }
  catch (error) {
    if (isFileMissingError(error) || error instanceof ZodError || error instanceof SyntaxError)
      return null

    throw error
  }
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await readFile(dataPath(SETTINGS_FILE), 'utf8')
    return normalizeSettings(JSON.parse(raw))
  }
  catch (error) {
    if (isFileMissingError(error) || error instanceof ZodError || error instanceof SyntaxError)
      return defaultSettings

    throw error
  }
}

export async function saveConfig(input: SavePrinterConfig): Promise<PrinterConfig> {
  const existing = await loadConfig()
  const merged = {
    ...input,
    accessCode: normalizeAccessCode(input.accessCode, existing),
  }
  const config = printerConfigSchema.parse(merged)

  await ensureDataDir()
  await writeFile(dataPath(CONFIG_FILE), `${JSON.stringify(config, null, 2)}\n`, 'utf8')

  if (input.camera || input.webhook) {
    await updateSettings({
      camera: input.camera,
      webhook: input.webhook,
    })
  }

  return config
}

export async function updateSettings(input: AppSettingsPatch): Promise<AppSettings> {
  const current = await loadSettings()
  const settings = normalizeSettings({
    ...current,
    ...input,
    camera: {
      ...current.camera,
      ...input.camera,
    },
    webhook: {
      ...current.webhook,
      ...input.webhook,
    },
  })

  await ensureDataDir()
  await writeFile(dataPath(SETTINGS_FILE), `${JSON.stringify(settings, null, 2)}\n`, 'utf8')

  return settings
}

export async function deleteConfig(): Promise<void> {
  await rm(dataPath(CONFIG_FILE), { force: true })
}

export function dataPath(file: string): string {
  const root = process.env.BAMBU_DATA_DIR
    ? path.resolve(process.env.BAMBU_DATA_DIR)
    : path.resolve(process.cwd(), DATA_DIR)

  return path.join(root, file)
}

function normalizeAccessCode(value: string | undefined, existing: PrinterConfig | null): string {
  const trimmed = value?.trim()

  if (trimmed)
    return trimmed

  return existing?.accessCode ?? ''
}

function redactSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    webhook: {
      ...settings.webhook,
      secret: settings.webhook.secret ? '********' : '',
    },
  }
}

async function ensureDataDir(): Promise<void> {
  await mkdir(path.dirname(dataPath(CONFIG_FILE)), { recursive: true })
}

function isFileMissingError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
