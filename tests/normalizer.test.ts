import { describe, expect, it } from 'vitest'
import { deepMerge, normalizePrinterStatus } from '../server/normalizer.js'

describe('bambu status normalization', () => {
  it('merges delta MQTT reports before normalizing status', () => {
    const raw = deepMerge({}, {
      print: {
        gcode_state: 'RUNNING',
        mc_percent: 42,
        nozzle_temper: 218,
        nozzle_target_temper: 220,
      },
    })

    deepMerge(raw, {
      print: {
        layer_num: 12,
        total_layer_num: 80,
        mc_remaining_time: 68,
      },
    })

    const status = normalizePrinterStatus(raw, new Date('2026-05-20T01:00:00.000Z'))

    expect(status.state.gcodeState).toBe('RUNNING')
    expect(status.state.progress).toBe(42)
    expect(status.state.currentLayer).toBe(12)
    expect(status.state.totalLayers).toBe(80)
    expect(status.temperatures.nozzle).toEqual({ current: 218, target: 220 })
  })

  it('normalizes AMS trays and marks the active tray', () => {
    const status = normalizePrinterStatus({
      print: {
        ams: {
          tray_now: '2',
          ams: [
            {
              id: '0',
              humidity: '4',
              temp: '22.7',
              tray: [
                { id: '0' },
                {
                  id: '1',
                  tray_type: 'PLA',
                  tray_sub_brands: 'Bambu PLA Basic',
                  tray_color: 'FF0000FF',
                  nozzle_temp_min: '190',
                  nozzle_temp_max: '230',
                },
                {
                  id: '2',
                  tray_type: 'PETG',
                  tray_color: '00FF00FF',
                },
              ],
            },
          ],
        },
      },
    })

    expect(status.ams.units).toHaveLength(1)
    expect(status.ams.units[0]?.humidity).toBe(4)
    expect(status.ams.units[0]?.temperature).toBe(22.7)
    expect(status.ams.units[0]?.trays[0]?.exists).toBe(false)
    expect(status.ams.units[0]?.trays[1]?.label).toBe('Bambu PLA Basic PLA')
    expect(status.ams.units[0]?.trays[1]?.color).toBe('#FF0000')
    expect(status.ams.units[0]?.trays[2]?.active).toBe(true)
    expect(status.ams.activeTrayId).toBe('0-2')
  })

  it('normalizes lights, camera, network, timing, and error metadata', () => {
    const status = normalizePrinterStatus({
      print: {
        gcode_state: 'RUNNING',
        mc_remaining_time: '30',
        gcode_start_time: '1779238800',
        mc_print_error_code: '123',
        wifi_signal: '-45dBm',
        lights_report: [
          { node: 'chamber_light', mode: 'on' },
          { node: 'work_light', mode: 'flashing' },
        ],
        ipcam: {
          ipcam_dev: '1',
          ipcam_record: 'enable',
          resolution: '1080p',
          rtsp_url: 'rtsps://printer/streaming/live/1',
          timelapse: 'disable',
        },
      },
    }, new Date('2026-05-20T02:00:00.000Z'))

    expect(status.lights).toEqual([
      { node: 'chamber_light', mode: 'on' },
      { node: 'work_light', mode: 'flashing' },
    ])
    expect(status.camera).toEqual({
      enabled: true,
      recordEnabled: true,
      timelapseEnabled: false,
      resolution: '1080p',
      rtspUrl: 'rtsps://printer/streaming/live/1',
    })
    expect(status.network.wifiSignal).toBe('-45dBm')
    expect(status.jobTiming.startedAt).toBe('2026-05-20T01:00:00.000Z')
    expect(status.jobTiming.estimatedDoneAt).toBe('2026-05-20T02:30:00.000Z')
    expect(status.errorCode).toBe('123')
  })
})
