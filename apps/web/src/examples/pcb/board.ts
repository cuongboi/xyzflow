import type { EdgeShape, EdgeSnapshot, GraphJSON, NodeJSON, RotationInput } from 'xyzflow'
import { PART_LIFT, type PartData, type PartType } from './components'

/** Nets and their trace colors. */
export const NETS = {
  VBUS: 0xf56565,
  '3V3': 0xf6ad55,
  GND: 0x8a93a6,
  SDA: 0x4f8cff,
  SCL: 0x4fd1c5,
  GPIO: 0x68d391,
  USB_D: 0xb794f4,
} as const
export type NetName = keyof typeof NETS

/** Copper width per net (power nets are wider). */
export const NET_WIDTH: Record<NetName, number> = {
  VBUS: 0.2, '3V3': 0.16, GND: 0.22, SDA: 0.1, SCL: 0.1, GPIO: 0.1, USB_D: 0.12,
}
export const TRACE_HEIGHT = 0.03

/** Unique, readable trace id (includes pads so parallel traces are allowed). */
export const traceId = (net: string, s: string, sh: string | undefined, t: string, th: string | undefined) =>
  `${net}:${s}${sh ? `.${sh}` : ''}-${t}${th ? `.${th}` : ''}`

export interface NetData {
  net: NetName
}

/** Boards: [name, center x, center z, width, depth, surface height]. */
export const BOARDS = [
  { name: 'MAIN v1.0', x: 0, z: 0, w: 16, d: 10, y: 0 },
  { name: 'SENSOR', x: 4.5, z: 0.5, w: 5, d: 3.5, y: 3 },
] as const
export const BOARD_THICKNESS = 0.16
export const surface = (b: (typeof BOARDS)[number]) => b.y + BOARD_THICKNESS

/** Small ESP32 IoT board with a stacked sensor daughter-board. */
export function demoBoard(): GraphJSON {
  const top = surface(BOARDS[0])
  const top2 = surface(BOARDS[1])
  const yaw = (deg: number): RotationInput => [0, (deg * Math.PI) / 180, 0]
  const p = (
    id: string, type: PartType, x: number, z: number, data: PartData, y = top, rotation?: RotationInput,
  ): NodeJSON<PartData> => ({
    id, type, position: { x, y: y + PART_LIFT[type], z }, rotation, color: 0x8da2c0, data,
  })
  const nodes: NodeJSON[] = [
    p('J1', 'usb', -7.2, 0, { ref: 'J1', value: 'USB-C', footprint: 'USB-C-16P' }),
    p('U2', 'chip', -4.2, -1.6, { ref: 'U2', value: 'AMS1117-3.3', footprint: 'SOT-223', pins: 2 }),
    p('C1', 'capacitor', -5.6, -3.4, { ref: 'C1', value: '10uF', footprint: '0805' }, top, yaw(90)),
    p('C2', 'capacitor', -2.8, -3.4, { ref: 'C2', value: '10uF', footprint: '0805' }, top, yaw(90)),
    p('U1', 'mcu', 0, 0, { ref: 'U1', value: 'ESP32-S3', footprint: 'QFN-56', pins: 8 }),
    p('C3', 'capacitor', -2, 2.2, { ref: 'C3', value: '100nF', footprint: '0402' }, top, yaw(90)),
    p('R1', 'resistor', 2.6, -2.8, { ref: 'R1', value: '330R', footprint: '0805' }),
    p('D1', 'led', 4.2, -2.8, { ref: 'D1', value: 'Green', footprint: '0805', led: 0x48ff7a }),
    p('R2', 'resistor', 2.6, 2.2, { ref: 'R2', value: '4k7', footprint: '0805' }),
    p('R3', 'resistor', 2.6, 3.2, { ref: 'R3', value: '4k7', footprint: '0805' }),
    p('J2', 'connector', 4.5, 1.5, { ref: 'J2', value: 'I2C', footprint: '1x04 2.54mm', pins: 4 }, top, yaw(90)),
    p('TP1', 'via', -4.2, 3.8, { ref: 'TP1', value: 'GND', footprint: 'TP' }),
    p('TP2', 'via', -2.8, 3.8, { ref: 'TP2', value: '3V3', footprint: 'TP' }),
    // daughter board, stacked above; its header is offset so the wires curve
    p('J3', 'connector', 6, 1, { ref: 'J3', value: 'I2C', footprint: '1x04 2.54mm', pins: 4 }, top2),
    p('U3', 'chip', 4, -0.3, { ref: 'U3', value: 'BME280', footprint: 'LGA-8', pins: 2 }, top2),
    p('C4', 'capacitor', 6, -0.8, { ref: 'C4', value: '100nF', footprint: '0402' }, top2),
  ]
  for (const n of nodes) if (n.type === 'via') n.color = 0xd8b04a

  /** `source.pad -> target.pad` copper trace (straight, flat, width from net). */
  const e = (
    source: string, sh: string, target: string, th: string, net: NetName, shape: EdgeShape = {},
  ): EdgeSnapshot<NetData> => ({
    id: traceId(net, source, sh, target, th),
    source, sourceHandle: sh, target, targetHandle: th,
    color: NETS[net], data: { net },
    width: NET_WIDTH[net], height: TRACE_HEIGHT,
    ...shape,
  })
  /** Board-to-board wire: round, curved through space. */
  const wire: EdgeShape = { path: 'bezier', render: 'tube', width: 0.07, height: 0.07 }

  const edges: EdgeSnapshot[] = [
    e('J1', 'vbus', 'U2', 'w1', 'VBUS'), e('J1', 'vbus', 'C1', 'a', 'VBUS'),
    e('U2', 'e1', 'C2', 'b', '3V3'), e('U2', 'e2', 'U1', 'w1', '3V3'), e('U1', 'w2', 'C3', 'b', '3V3'),
    e('U2', 's2', 'TP2', 'top', '3V3'),
    e('U1', 'e2', 'R2', 'a', '3V3'), e('U1', 's2', 'R3', 'a', '3V3'),
    e('J1', 'gnd', 'TP1', 'top', 'GND'), e('C1', 'b', 'TP1', 'top', 'GND'), e('C2', 'a', 'TP1', 'top', 'GND'),
    e('C3', 'a', 'TP1', 'top', 'GND'),
    e('J1', 'dp', 'U1', 'n1', 'USB_D'),
    e('U1', 'n2', 'R1', 'a', 'GPIO'), e('R1', 'b', 'D1', 'a', 'GPIO'),
    e('R2', 'b', 'J2', 'b1', 'SDA'), e('R3', 'b', 'J2', 'b2', 'SCL'),
    // board-to-board through the stacking header
    e('J2', 'p1', 'J3', 'b1', 'SDA', wire), e('J2', 'p2', 'J3', 'b2', 'SCL', wire),
    e('J2', 'p3', 'J3', 'b3', '3V3', wire), e('J2', 'p4', 'J3', 'b4', 'GND', wire),
    // on the sensor board
    e('J3', 'p1', 'U3', 'e1', 'SDA', { path: 'bezier' }), e('J3', 'p2', 'U3', 'e2', 'SCL', { path: 'bezier' }),
    e('J3', 'p3', 'C4', 'b', '3V3', { path: 'bezier' }), e('C4', 'a', 'U3', 'n2', 'GND'),
  ]
  return { version: 2, nodes, edges }
}
