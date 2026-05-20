import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BambuClient } from '../server/bambuClient.js'
import { app, createApp } from '../server/index.js'

describe('api routes', () => {
  let previousDataDir: string | undefined
  let dataDir: string

  beforeEach(async () => {
    previousDataDir = process.env.BAMBU_DATA_DIR
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'bambu-monitor-'))
    process.env.BAMBU_DATA_DIR = dataDir
  })

  afterEach(async () => {
    if (previousDataDir === undefined)
      delete process.env.BAMBU_DATA_DIR
    else
      process.env.BAMBU_DATA_DIR = previousDataDir

    await rm(dataDir, { recursive: true, force: true })
  })

  it('saves settings and redacts webhook secrets', async () => {
    const response = await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url: 'https://example.com/hook',
          secret: 'SECRET',
        },
      }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      webhook: {
        enabled: true,
        url: 'https://example.com/hook',
        secret: '********',
      },
    })
  })

  it('handles CORS preflight for camera stream requests', async () => {
    const response = await app.request('/api/printer/camera/stream', {
      method: 'OPTIONS',
      headers: {
        'Access-Control-Request-Headers': 'Content-Type',
        'Access-Control-Request-Method': 'GET',
        'Origin': 'http://127.0.0.1:5173',
      },
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type')
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('returns a clear camera error when no printer is configured', async () => {
    const response = await app.request('/api/printer/camera/stream', {
      headers: {
        Origin: 'http://127.0.0.1:5173',
      },
    })

    expect(response.status).toBe(409)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(await response.json()).toEqual({ message: '尚未配置打印机' })
  })

  it('returns a CORS-safe camera diagnostic error when no printer is configured', async () => {
    const response = await app.request('/api/printer/camera/check', {
      headers: {
        Origin: 'http://127.0.0.1:5173',
      },
    })

    expect(response.status).toBe(409)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(await response.json()).toHaveProperty('message')
  })

  it('returns camera transport details when the diagnostic check succeeds through Bambu 6000', async () => {
    const testApp = createApp({
      getStatus: () => null,
    } as unknown as BambuClient, {
      createCameraStream: async () => new Response(),
      checkCameraStream: async () => ({ ok: true, transport: 'bambu-jpeg', port: 6000 }),
    })

    await testApp.request('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'P1S',
        host: '192.168.1.88',
        serial: '01P00A123456789',
        accessCode: 'LAN-CODE',
      }),
    })

    const response = await testApp.request('/api/printer/camera/check')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, transport: 'bambu-jpeg', port: 6000 })
  })

  it('returns a clear camera error when video is disabled', async () => {
    await app.request('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'P1S',
        host: '192.168.1.88',
        serial: '01P00A123456789',
        accessCode: 'LAN-CODE',
      }),
    })

    await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        camera: {
          enabled: false,
        },
      }),
    })

    const response = await app.request('/api/printer/camera/stream')

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ message: '实时视频未启用' })
  })
})
