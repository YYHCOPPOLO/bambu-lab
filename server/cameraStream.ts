import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { connect as connectTcp, isIP } from 'node:net'
import { connect as connectTls, type TLSSocket } from 'node:tls'
import type { AppSettings, PrinterConfig, PrinterStatus } from './types.js'

const STREAM_BOUNDARY = 'bambu'
const CAMERA_READY_TIMEOUT_MS = 20_000
const RTSP_IO_TIMEOUT_US = 15_000_000
const RTSP_PORT = 322
const BAMBU_JPEG_PORT = 6000
const PORT_PROBE_TIMEOUT_MS = 1_500
const FORCE_KILL_DELAY_MS = 1_000
const MAX_DIAGNOSTIC_LENGTH = 2_000
const MAX_JPEG_BUFFER_LENGTH = 4 * 1024 * 1024
const JPEG_START_MARKER = Buffer.from([0xFF, 0xD8])
const JPEG_END_MARKER = Buffer.from([0xFF, 0xD9])
const require = createRequire(import.meta.url)
const ffmpegStaticPath = require('ffmpeg-static') as string | null

export type CameraTransport = 'external' | 'rtsps' | 'bambu-jpeg'
export type PortReachabilityProbe = (host: string, port: number) => Promise<boolean>

export interface CameraCheckResult {
  ok: true
  transport: CameraTransport
  port?: number
}

export type ResolvedCameraTransport =
  | { kind: 'ffmpeg', transport: 'external' | 'rtsps', sourceUrl: string, port?: number }
  | { kind: 'bambu-jpeg', transport: 'bambu-jpeg', host: string, port: number, accessCode: string }

export class CameraStreamError extends Error {
  readonly status: 409 | 503

  constructor(message: string, status: 409 | 503 = 409) {
    super(message)
    this.status = status
  }
}

export async function createCameraStream(
  config: PrinterConfig,
  settings: AppSettings,
  status: PrinterStatus | null = null,
): Promise<Response> {
  ensureCameraEnabled(settings)

  const transport = await resolveCameraTransport(config, settings, status)
  const cameraStream = createCameraStreamHandle(transport)

  try {
    await waitForFirstFrame(cameraStream.ready, createReadyTimeoutMessage(transport))
  }
  catch (error) {
    cameraStream.close()
    throw error
  }

  return new Response(cameraStream.stream, {
    headers: {
      'Cache-Control': 'no-store',
      'Connection': 'close',
      'Content-Type': `multipart/x-mixed-replace; boundary=${STREAM_BOUNDARY}`,
      'X-Accel-Buffering': 'no',
    },
  })
}

export async function checkCameraStream(
  config: PrinterConfig,
  settings: AppSettings,
  status: PrinterStatus | null = null,
): Promise<CameraCheckResult> {
  ensureCameraEnabled(settings)

  const transport = await resolveCameraTransport(config, settings, status)
  const cameraStream = createCameraStreamHandle(transport)

  try {
    await waitForFirstFrame(cameraStream.ready, createReadyTimeoutMessage(transport))
    return createCheckResult(transport)
  }
  finally {
    cameraStream.close()
  }
}

export async function resolveCameraTransport(
  config: PrinterConfig,
  settings: AppSettings,
  status: PrinterStatus | null = null,
  isPortReachable: PortReachabilityProbe = isTcpPortReachable,
): Promise<ResolvedCameraTransport> {
  const externalUrl = settings.camera.externalUrl.trim()

  if (settings.camera.source === 'external') {
    if (!externalUrl)
      throw new CameraStreamError('外部视频 URL 未配置')

    return {
      kind: 'ffmpeg',
      transport: 'external',
      sourceUrl: externalUrl,
    }
  }

  const rtspSource = resolveBambuRtspSource(config, status)
  const rtspPort = resolveUrlPort(rtspSource, RTSP_PORT)

  if (await isPortReachable(config.host, rtspPort)) {
    return {
      kind: 'ffmpeg',
      transport: 'rtsps',
      sourceUrl: rtspSource,
      port: rtspPort,
    }
  }

  if (await isPortReachable(config.host, BAMBU_JPEG_PORT)) {
    return {
      kind: 'bambu-jpeg',
      transport: 'bambu-jpeg',
      host: config.host,
      port: BAMBU_JPEG_PORT,
      accessCode: config.accessCode,
    }
  }

  throw new CameraStreamError(
    `内置相机端口不可达：${config.host}:${rtspPort} (RTSPS) 与 ${config.host}:${BAMBU_JPEG_PORT} 均无法连接。请在打印机上启用 LAN Liveview/视频开关，确认本机与打印机在同一网络，并检查防火墙或路由器是否放行 322/6000。`,
    503,
  )
}

export function resolveCameraSource(
  config: PrinterConfig,
  settings: AppSettings,
  status: PrinterStatus | null = null,
): string {
  const externalUrl = settings.camera.externalUrl.trim()

  if (settings.camera.source === 'external') {
    if (!externalUrl)
      throw new CameraStreamError('外部视频 URL 未配置')

    return externalUrl
  }

  return resolveBambuRtspSource(config, status)
}

export function resolveBambuRtspSource(
  config: PrinterConfig,
  status: PrinterStatus | null = null,
): string {
  const reportedUrl = status?.camera.rtspUrl?.trim()
  let protocol = 'rtsps:'
  let port = String(RTSP_PORT)
  let pathname = '/streaming/live/1'
  let search = ''

  if (reportedUrl && isRtspSource(reportedUrl)) {
    try {
      const url = new URL(reportedUrl)
      protocol = url.protocol
      port = url.port || String(RTSP_PORT)
      pathname = url.pathname || pathname
      search = url.search
    }
    catch {
      // Keep the stable default source below.
    }
  }

  const sourceUrl = new URL(`${protocol}//${config.host}`)
  sourceUrl.port = port
  sourceUrl.pathname = pathname
  sourceUrl.search = search

  return withBambuCredentials(sourceUrl.toString(), config.accessCode)
}

export function buildFfmpegArgs(sourceUrl: string): string[] {
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
  ]

  if (isRtspSource(sourceUrl)) {
    args.push(
      '-rtsp_transport',
      'tcp',
      '-timeout',
      String(RTSP_IO_TIMEOUT_US),
    )
  }

  args.push(
    '-i',
    sourceUrl,
    '-an',
    '-f',
    'mpjpeg',
    '-q:v',
    '5',
    '-r',
    '8',
    '-boundary_tag',
    STREAM_BOUNDARY,
    'pipe:1',
  )

  return args
}

export function resolveFfmpegPath(): string | null {
  const candidates = [
    process.env.FFMPEG_PATH,
    ffmpegStaticPath,
  ]

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate))
      return candidate
  }

  return null
}

export async function isTcpPortReachable(
  host: string,
  port: number,
  timeoutMs = PORT_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connectTcp({ host, port })
    let settled = false

    const finish = (reachable: boolean) => {
      if (settled)
        return

      settled = true
      socket.removeAllListeners()
      socket.destroy()
      resolve(reachable)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

export function buildBambuCameraAuthPacket(username: string, accessCode: string): Buffer {
  const packet = Buffer.alloc(80)
  packet.writeUInt32LE(0x40, 0)
  packet.writeUInt32LE(0x3000, 4)
  writeFixedAscii(packet, username, 16, 32)
  writeFixedAscii(packet, accessCode, 48, 32)
  return packet
}

export function extractJpegFrame(buffer: Buffer): { frame: Buffer | null, rest: Buffer } {
  const start = buffer.indexOf(JPEG_START_MARKER)

  if (start === -1) {
    return {
      frame: null,
      rest: buffer.subarray(Math.max(0, buffer.length - (JPEG_START_MARKER.length - 1))),
    }
  }

  const end = buffer.indexOf(JPEG_END_MARKER, start + JPEG_START_MARKER.length)

  if (end === -1)
    return { frame: null, rest: buffer.subarray(start) }

  return {
    frame: buffer.subarray(start, end + JPEG_END_MARKER.length),
    rest: buffer.subarray(end + JPEG_END_MARKER.length),
  }
}

export function sanitizeDiagnostic(value: string): string {
  return value
    .replace(/(rtsps?:\/\/[^:\s/@]+:)[^@\s/]+@/gi, '$1********@')
    .replace(/((?:pass|password|passwd)=)[^&\s]+/gi, '$1********')
}

interface CameraStreamHandle {
  stream: ReadableStream<Uint8Array>
  ready: Promise<void>
  close: () => void
}

function ensureCameraEnabled(settings: AppSettings): void {
  if (!settings.camera.enabled)
    throw new CameraStreamError('实时视频未启用')
}

function createCameraStreamHandle(transport: ResolvedCameraTransport): CameraStreamHandle {
  if (transport.kind === 'bambu-jpeg')
    return createBambuJpegStream(transport.host, transport.port, transport.accessCode)

  const ffmpegPath = resolveFfmpegPath()
  if (!ffmpegPath)
    throw new CameraStreamError('未找到可用的 ffmpeg，可运行 pnpm approve-builds 后重新安装 ffmpeg-static，或设置 FFMPEG_PATH', 503)

  return createFfmpegStream(ffmpegPath, buildFfmpegArgs(transport.sourceUrl))
}

function createFfmpegStream(ffmpegPath: string, args: string[]): CameraStreamHandle {
  let ffmpeg: ReturnType<typeof spawn> | null = null
  let closed = false
  let diagnostic = ''
  let readySettled = false
  let resolveReady: () => void = () => {}
  let rejectReady: (error: CameraStreamError) => void = () => {}

  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = () => {
      readySettled = true
      resolve()
    }
    rejectReady = (error) => {
      readySettled = true
      reject(error)
    }
  })

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const child = spawn(ffmpegPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      ffmpeg = child

      child.stdout.on('data', (chunk: Buffer) => {
        if (closed)
          return

        controller.enqueue(chunk)

        if (!readySettled)
          resolveReady()
      })

      child.stderr.on('data', (chunk: Buffer) => {
        diagnostic = appendDiagnostic(diagnostic, chunk.toString('utf8'))
      })

      child.on('error', (error) => {
        const streamError = new CameraStreamError(`无法启动视频代理：${error.message}`, 503)

        if (!readySettled)
          rejectReady(streamError)

        if (!closed) {
          closed = true
          controller.error(streamError)
        }
      })

      child.on('close', (code, signal) => {
        if (closed)
          return

        closed = true

        if (!readySettled) {
          rejectReady(new CameraStreamError(createExitDiagnostic(code, signal, diagnostic), 503))
          return
        }

        controller.close()
      })
    },
    cancel() {
      closed = true
      stopFfmpeg()
    },
  })

  function stopFfmpeg(): void {
    const child = ffmpeg

    if (!child || !isFfmpegRunning(child))
      return

    child.kill('SIGTERM')

    const forceKill = setTimeout(() => {
      if (!isFfmpegRunning(child))
        return

      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
          stdio: 'ignore',
          windowsHide: true,
        })
        killer.on('error', () => {})
        return
      }

      child.kill('SIGKILL')
    }, FORCE_KILL_DELAY_MS)

    forceKill.unref()
  }

  return {
    stream,
    ready,
    close() {
      closed = true
      stopFfmpeg()
    },
  }
}

function createBambuJpegStream(host: string, port: number, accessCode: string): CameraStreamHandle {
  const encoder = new TextEncoder()
  let socket: TLSSocket | null = null
  let closed = false
  let buffer: Buffer = Buffer.alloc(0)
  let readySettled = false
  let resolveReady: () => void = () => {}
  let rejectReady: (error: CameraStreamError) => void = () => {}

  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = () => {
      readySettled = true
      resolve()
    }
    rejectReady = (error) => {
      readySettled = true
      reject(error)
    }
  })

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const child = connectTls({
        host,
        port,
        rejectUnauthorized: false,
        servername: isIP(host) ? undefined : host,
      })
      socket = child
      child.setTimeout(CAMERA_READY_TIMEOUT_MS)

      child.once('secureConnect', () => {
        if (!closed)
          child.write(buildBambuCameraAuthPacket('bblp', accessCode))
      })

      child.on('data', (chunk: Buffer) => {
        if (closed)
          return

        buffer = Buffer.concat([buffer, chunk])
        if (buffer.length > MAX_JPEG_BUFFER_LENGTH)
          buffer = buffer.subarray(-MAX_JPEG_BUFFER_LENGTH)

        while (!closed) {
          const result = extractJpegFrame(buffer)
          buffer = result.rest

          if (!result.frame)
            return

          enqueueJpegFrame(controller, encoder, result.frame)

          if (!readySettled)
            resolveReady()
        }
      })

      child.on('timeout', () => {
        failBambuJpegStream(
          controller,
          new CameraStreamError(
            `Bambu 6000 相机连接超时：未在 ${CAMERA_READY_TIMEOUT_MS / 1000} 秒内收到图像帧，请检查访问码、打印机视频开关或是否已有其他客户端占用相机。`,
            503,
          ),
        )
      })

      child.on('error', (error) => {
        failBambuJpegStream(
          controller,
          new CameraStreamError(`Bambu 6000 相机连接失败：${sanitizeDiagnostic(error.message)}`, 503),
        )
      })

      child.on('close', () => {
        if (closed)
          return

        closed = true

        if (!readySettled) {
          rejectReady(new CameraStreamError(
            'Bambu 6000 相机连接已关闭：未收到图像帧，请检查访问码、打印机视频开关或相机是否被其他客户端占用。',
            503,
          ))
          return
        }

        controller.close()
      })

      function failBambuJpegStream(controller: ReadableStreamDefaultController<Uint8Array>, error: CameraStreamError): void {
        if (!readySettled)
          rejectReady(error)

        if (!closed) {
          closed = true
          controller.error(error)
        }

        child.destroy()
      }
    },
    cancel() {
      closed = true
      socket?.destroy()
    },
  })

  return {
    stream,
    ready,
    close() {
      closed = true
      socket?.destroy()
    },
  }
}

function enqueueJpegFrame(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  frame: Buffer,
): void {
  controller.enqueue(encoder.encode(
    `--${STREAM_BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`,
  ))
  controller.enqueue(frame)
  controller.enqueue(encoder.encode('\r\n'))
}

function isFfmpegRunning(child: ReturnType<typeof spawn>): boolean {
  return child.exitCode === null && child.signalCode === null
}

async function waitForFirstFrame(ready: Promise<void>, timeoutMessage: string): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | null = null

  try {
    await Promise.race([
      ready,
      new Promise<void>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new CameraStreamError(timeoutMessage, 503))
        }, CAMERA_READY_TIMEOUT_MS)
      }),
    ])
  }
  finally {
    if (timeout)
      clearTimeout(timeout)
  }
}

function createReadyTimeoutMessage(transport: ResolvedCameraTransport): string {
  if (transport.kind === 'bambu-jpeg') {
    return `视频连接超时：Bambu 6000 相机未在 ${CAMERA_READY_TIMEOUT_MS / 1000} 秒内输出首帧，请检查访问码、打印机视频开关或是否已有其他客户端占用相机。`
  }

  return `视频连接超时：ffmpeg 未在 ${CAMERA_READY_TIMEOUT_MS / 1000} 秒内输出首帧`
}

function createCheckResult(transport: ResolvedCameraTransport): CameraCheckResult {
  return {
    ok: true,
    transport: transport.transport,
    ...(transport.port ? { port: transport.port } : {}),
  }
}

function withBambuCredentials(sourceUrl: string, accessCode: string): string {
  try {
    const url = new URL(sourceUrl)

    if (!isRtspSource(sourceUrl))
      return sourceUrl

    if (!url.username)
      url.username = 'bblp'

    if (!url.password)
      url.password = accessCode

    return url.toString()
  }
  catch {
    return sourceUrl
  }
}

function isRtspSource(sourceUrl: string): boolean {
  return /^rtsps?:\/\//i.test(sourceUrl)
}

function resolveUrlPort(sourceUrl: string, fallback: number): number {
  try {
    const url = new URL(sourceUrl)
    const port = Number(url.port)
    return Number.isInteger(port) && port > 0 ? port : fallback
  }
  catch {
    return fallback
  }
}

function writeFixedAscii(buffer: Buffer, value: string, offset: number, length: number): void {
  buffer.write(value.slice(0, length), offset, length, 'ascii')
}

function appendDiagnostic(current: string, next: string): string {
  return `${current}${next}`.slice(-MAX_DIAGNOSTIC_LENGTH)
}

function createExitDiagnostic(code: number | null, signal: NodeJS.Signals | null, diagnostic: string): string {
  const cleaned = sanitizeDiagnostic(diagnostic.trim())

  if (cleaned)
    return `视频连接失败：${cleaned}`

  const exitReason = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`
  return `视频连接失败：ffmpeg 退出（${exitReason}）`
}
