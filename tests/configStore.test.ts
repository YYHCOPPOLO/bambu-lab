import { describe, expect, it } from 'vitest'
import { defaultSettings, normalizeSettings, printerConfigSchema, toPublicConfig } from '../server/configStore.js'

describe('printer config masking', () => {
  it('does not expose the access code in the public config', () => {
    const config = printerConfigSchema.parse({
      name: 'P1S',
      host: '192.168.1.88',
      serial: '01P00A123456789',
      accessCode: 'LAN-CODE',
    })

    expect(toPublicConfig(config, defaultSettings)).toEqual({
      configured: true,
      name: 'P1S',
      host: '192.168.1.88',
      port: 8883,
      serial: '01P00A123456789',
      settings: defaultSettings,
    })
    expect(JSON.stringify(toPublicConfig(config, defaultSettings))).not.toContain('LAN-CODE')
  })

  it('reports an unconfigured state when no config exists', () => {
    expect(toPublicConfig(null, defaultSettings)).toEqual({ configured: false, settings: defaultSettings })
  })

  it('redacts webhook secrets from the public config', () => {
    const settings = normalizeSettings({
      webhook: {
        enabled: true,
        url: 'https://example.com/hook',
        secret: 'SECRET',
      },
    })

    expect(toPublicConfig(null, settings).settings.webhook.secret).toBe('********')
  })
})
