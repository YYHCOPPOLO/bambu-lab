import { describe, expect, it } from 'vitest'
import { normalizePrinterStatus } from '../server/normalizer.js'
import { createHistorySample, pruneRuntimeData } from '../server/runtimeStore.js'

describe('runtime store helpers', () => {
  it('creates compact history samples from normalized printer status', () => {
    const status = normalizePrinterStatus({
      print: {
        gcode_state: 'RUNNING',
        subtask_name: 'benchy.3mf',
        mc_percent: 50,
        nozzle_temper: 220,
        bed_temper: 60,
        hms: [{ code: '0300', msg: 'watch me' }],
      },
    }, new Date('2026-05-20T02:00:00.000Z'))

    expect(createHistorySample(status)).toMatchObject({
      at: '2026-05-20T02:00:00.000Z',
      gcodeState: 'RUNNING',
      printName: 'benchy.3mf',
      progress: 50,
      nozzleTemperature: 220,
      bedTemperature: 60,
      hmsCount: 1,
    })
  })

  it('prunes history and events outside the retention window', () => {
    const data = pruneRuntimeData({
      history: [
        sample('2026-05-01T00:00:00.000Z'),
        sample('2026-05-19T00:00:00.000Z'),
      ],
      events: [
        event('2026-05-01T00:00:00.000Z'),
        event('2026-05-19T00:00:00.000Z'),
      ],
    }, 7, new Date('2026-05-20T00:00:00.000Z'))

    expect(data.history).toHaveLength(1)
    expect(data.events).toHaveLength(1)
    expect(data.history[0]?.at).toBe('2026-05-19T00:00:00.000Z')
    expect(data.events[0]?.at).toBe('2026-05-19T00:00:00.000Z')
  })
})

function sample(at: string) {
  return {
    at,
    gcodeState: 'IDLE',
    printName: '',
    progress: 0,
    nozzleTemperature: null,
    nozzleTarget: null,
    bedTemperature: null,
    bedTarget: null,
    chamberTemperature: null,
    speedLevel: null,
    hmsCount: 0,
  }
}

function event(at: string) {
  return {
    id: at,
    at,
    kind: 'error' as const,
    level: 'error' as const,
    message: 'error',
  }
}
