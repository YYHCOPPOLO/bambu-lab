import { describe, expect, it } from 'vitest'
import { normalizePrinterStatus } from '../server/normalizer.js'
import { assertPrinterCommandAllowed, buildPrinterCommandPayload } from '../server/printerCommands.js'

describe('printer commands', () => {
  it('builds pause, speed, light, and camera payloads', () => {
    expect(buildPrinterCommandPayload({ type: 'pause' }, '1')).toEqual({
      qos: 1,
      payload: {
        print: {
          sequence_id: '1',
          command: 'pause',
          param: '',
        },
      },
    })

    expect(buildPrinterCommandPayload({ type: 'speed', level: 3 }, '2').payload).toEqual({
      print: {
        sequence_id: '2',
        command: 'print_speed',
        param: '3',
      },
    })

    expect(buildPrinterCommandPayload({ type: 'light', node: 'chamber_light', mode: 'off' }, '3').payload).toMatchObject({
      system: {
        sequence_id: '3',
        command: 'ledctrl',
        led_node: 'chamber_light',
        led_mode: 'off',
      },
    })

    expect(buildPrinterCommandPayload({ type: 'camera-timelapse', enabled: true }, '4').payload).toEqual({
      camera: {
        sequence_id: '4',
        command: 'ipcam_timelapse',
        control: 'enable',
      },
    })
  })

  it('blocks dangerous commands when no print is active', () => {
    const idleStatus = normalizePrinterStatus({
      print: {
        gcode_state: 'IDLE',
      },
    })

    expect(() => assertPrinterCommandAllowed({ type: 'stop' }, idleStatus)).toThrow('当前没有可控制的打印任务')
    expect(() => assertPrinterCommandAllowed({ type: 'pause' }, idleStatus)).toThrow('当前状态不允许暂停打印')
  })
})
