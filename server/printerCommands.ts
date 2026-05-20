import { z } from 'zod'
import type { PrinterCommand, PrinterStatus } from './types.js'

export interface CommandEnvelope {
  payload: Record<string, unknown>
  qos: 0 | 1
}

export const printerCommandSchema: z.ZodType<PrinterCommand> = z.discriminatedUnion('type', [
  z.object({
    type: z.enum(['pause', 'resume', 'stop']),
  }),
  z.object({
    type: z.literal('speed'),
    level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  }),
  z.object({
    type: z.literal('light'),
    node: z.enum(['chamber_light', 'work_light']),
    mode: z.enum(['on', 'off', 'flashing']),
  }),
  z.object({
    type: z.enum(['camera-record', 'camera-timelapse']),
    enabled: z.boolean(),
  }),
])

export function buildPrinterCommandPayload(command: PrinterCommand, sequenceId: string): CommandEnvelope {
  switch (command.type) {
    case 'pause':
    case 'resume':
    case 'stop':
      return {
        qos: 1,
        payload: {
          print: {
            sequence_id: sequenceId,
            command: command.type,
            param: '',
          },
        },
      }

    case 'speed':
      return {
        qos: 0,
        payload: {
          print: {
            sequence_id: sequenceId,
            command: 'print_speed',
            param: String(command.level),
          },
        },
      }

    case 'light':
      return {
        qos: 0,
        payload: {
          system: {
            sequence_id: sequenceId,
            command: 'ledctrl',
            led_node: command.node,
            led_mode: command.mode,
            led_on_time: 500,
            led_off_time: 500,
            loop_times: command.mode === 'flashing' ? 1 : 0,
            interval_time: 1000,
          },
        },
      }

    case 'camera-record':
      return {
        qos: 0,
        payload: {
          camera: {
            sequence_id: sequenceId,
            command: 'ipcam_record_set',
            control: command.enabled ? 'enable' : 'disable',
          },
        },
      }

    case 'camera-timelapse':
      return {
        qos: 0,
        payload: {
          camera: {
            sequence_id: sequenceId,
            command: 'ipcam_timelapse',
            control: command.enabled ? 'enable' : 'disable',
          },
        },
      }
  }
}

export function assertPrinterCommandAllowed(command: PrinterCommand, status: PrinterStatus | null): void {
  if (!status)
    return

  const state = status.state.gcodeState.toUpperCase()
  const hasActivePrint = !['IDLE', 'FINISH', 'FINISHED', 'FAILED', 'UNKNOWN'].includes(state)
  const isPaused = ['PAUSE', 'PAUSED'].includes(state)
  const isRunning = ['RUNNING', 'PREPARE', 'SLICING'].includes(state) || hasActivePrint && !isPaused

  if (command.type === 'pause' && !isRunning)
    throw new Error('当前状态不允许暂停打印')

  if (command.type === 'resume' && !isPaused)
    throw new Error('当前状态不允许继续打印')

  if ((command.type === 'stop' || command.type === 'speed') && !hasActivePrint)
    throw new Error('当前没有可控制的打印任务')
}
