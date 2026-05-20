import { describe, expect, it } from 'vitest'
import {
  buildBambuCameraAuthPacket,
  buildFfmpegArgs,
  extractJpegFrame,
  resolveCameraSource,
  resolveCameraTransport,
  sanitizeDiagnostic,
} from '../server/cameraStream.js'
import { defaultSettings } from '../server/configStore.js'
import { normalizePrinterStatus } from '../server/normalizer.js'
import type { AppSettings, PrinterConfig } from '../server/types.js'

const config: PrinterConfig = {
  name: 'P1S',
  host: '192.168.1.88',
  port: 8883,
  serial: '01P00A123456789',
  accessCode: 'LAN-CODE',
}

describe('camera stream helpers', () => {
  it('uses the reported Bambu RTSPS URL and injects LAN credentials', () => {
    const status = normalizePrinterStatus({
      print: {
        ipcam: {
          rtsp_url: 'rtsps://192.168.1.88/streaming/live/1',
        },
      },
    })

    expect(resolveCameraSource(config, bambuSettings(), status)).toBe(
      'rtsps://bblp:LAN-CODE@192.168.1.88:322/streaming/live/1',
    )
  })

  it('keeps the configured printer host when the reported camera URL points elsewhere', () => {
    const status = normalizePrinterStatus({
      print: {
        ipcam: {
          rtsp_url: 'rtsps://192.168.234.100/streaming/live/1?profile=main',
        },
      },
    })

    expect(resolveCameraSource(config, bambuSettings(), status)).toBe(
      'rtsps://bblp:LAN-CODE@192.168.1.88:322/streaming/live/1?profile=main',
    )
  })

  it('falls back to the printer host when no camera URL is reported', () => {
    expect(resolveCameraSource(config, bambuSettings())).toBe(
      'rtsps://bblp:LAN-CODE@192.168.1.88:322/streaming/live/1',
    )
  })

  it('uses the configured external source without injecting credentials', () => {
    expect(resolveCameraSource(config, {
      ...defaultSettings,
      camera: {
        enabled: true,
        source: 'external',
        externalUrl: 'http://camera.local/mjpeg',
      },
    })).toBe('http://camera.local/mjpeg')
  })

  it('adds RTSP transport arguments only for RTSP-like sources', () => {
    const rtspArgs = buildFfmpegArgs('rtsps://bblp:LAN-CODE@192.168.1.88:322/streaming/live/1')
    const httpArgs = buildFfmpegArgs('http://camera.local/mjpeg')

    expect(rtspArgs.slice(3, 5)).toEqual(['-rtsp_transport', 'tcp'])
    expect(rtspArgs).toContain('-timeout')
    expect(httpArgs).not.toContain('-rtsp_transport')
    expect(httpArgs).not.toContain('-timeout')
    expect(httpArgs).toContain('mpjpeg')
  })

  it('chooses RTSPS when port 322 is reachable', async () => {
    const transport = await resolveCameraTransport(config, bambuSettings(), null, async (_host, port) => {
      return port === 322
    })

    expect(transport).toMatchObject({
      kind: 'ffmpeg',
      transport: 'rtsps',
      port: 322,
      sourceUrl: 'rtsps://bblp:LAN-CODE@192.168.1.88:322/streaming/live/1',
    })
  })

  it('falls back to the Bambu 6000 JPEG transport when RTSPS is not reachable', async () => {
    const transport = await resolveCameraTransport(config, bambuSettings(), null, async (_host, port) => {
      return port === 6000
    })

    expect(transport).toMatchObject({
      kind: 'bambu-jpeg',
      transport: 'bambu-jpeg',
      host: '192.168.1.88',
      port: 6000,
    })
  })

  it('builds the Bambu 6000 camera authentication packet', () => {
    const packet = buildBambuCameraAuthPacket('bblp', 'LAN-CODE')

    expect(packet).toHaveLength(80)
    expect(packet.readUInt32LE(0)).toBe(0x40)
    expect(packet.readUInt32LE(4)).toBe(0x3000)
    expect(packet.subarray(16, 20).toString('ascii')).toBe('bblp')
    expect(packet.subarray(20, 48).every(byte => byte === 0)).toBe(true)
    expect(packet.subarray(48, 56).toString('ascii')).toBe('LAN-CODE')
    expect(packet.subarray(56).every(byte => byte === 0)).toBe(true)
  })

  it('extracts JPEG frames from split stream chunks', () => {
    const jpeg = Buffer.from([0xFF, 0xD8, 0x01, 0x02, 0xFF, 0xD9])
    let result = extractJpegFrame(Buffer.from([0x00, 0xFF]))

    expect(result.frame).toBeNull()
    expect(result.rest).toEqual(Buffer.from([0xFF]))

    result = extractJpegFrame(Buffer.concat([result.rest, Buffer.from([0xD8, 0x01, 0x02, 0xFF])]))
    expect(result.frame).toBeNull()
    expect(result.rest).toEqual(Buffer.from([0xFF, 0xD8, 0x01, 0x02, 0xFF]))

    result = extractJpegFrame(Buffer.concat([result.rest, Buffer.from([0xD9, 0x09])]))
    expect(result.frame).toEqual(jpeg)
    expect(result.rest).toEqual(Buffer.from([0x09]))
  })

  it('redacts camera credentials from diagnostics', () => {
    const diagnostic = sanitizeDiagnostic(
      'failed rtsps://bblp:LAN-CODE@192.168.1.88:322/streaming/live/1?passwd=LAN-CODE',
    )

    expect(diagnostic).not.toContain('LAN-CODE')
    expect(diagnostic).toContain('********')
  })
})

function bambuSettings(): AppSettings {
  return {
    ...defaultSettings,
    camera: {
      enabled: true,
      source: 'bambu',
      externalUrl: '',
    },
  }
}
