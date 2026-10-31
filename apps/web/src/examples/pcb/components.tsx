import { RoundedBox, Text } from '@react-three/drei'
import { customNode, instancedNode, type CustomNodeProps, type HandleDef, type NodeTypes } from 'xyzflow'
import { CylinderGeometry } from 'three'

/** Data stored on every part node. */
export interface PartData {
  /** Reference designator, e.g. U1, R3, J2. */
  ref: string
  /** Value / part number, e.g. "ESP32-S3", "10k", "100nF". */
  value: string
  footprint?: string
  /** chip / connector: pins per side (chip) or total (connector). */
  pins?: number
  /** @deprecated chip body size now comes from the type (`chip` / `mcu`). */
  w?: number
  d?: number
  /** led: hex color */
  led?: number
}

const PIN = '#c9ccd2'
const SEL = '#ffb020'
const HOV = '#5b78c7'

function outline(selected: boolean, hovered: boolean) {
  return selected ? SEL : hovered ? HOV : undefined
}

/** Label printed on top of a part (lies flat, readable from above). */
function Silk({ text, y, size = 0.18, color = '#e8ecf3' }: { text: string; y: number; size?: number; color?: string }) {
  return (
    <Text position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={size} color={color} anchorX="center" anchorY="middle">
      {text}
    </Text>
  )
}

/** QFP-style IC: black body with gull-wing pins on four sides. Body size is fixed per type (`size`). */
function chipNode(size: number) {
  return function Chip(props: CustomNodeProps<PartData>) {
    return <ChipNode {...props} w={size} d={size} />
  }
}

function ChipNode({ data, selected, hovered, w, d }: CustomNodeProps<PartData> & { w: number; d: number }) {
  const n = data.pins ?? 6
  const h = 0.22
  const hl = outline(selected, hovered)
  const pins: [number, number, number, number][] = [] // x, z, sx, sz
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n - 0.5
    pins.push([t * w * 0.85, d / 2 + 0.08, 0.06, 0.18], [t * w * 0.85, -d / 2 - 0.08, 0.06, 0.18])
    pins.push([w / 2 + 0.08, t * d * 0.85, 0.18, 0.06], [-w / 2 - 0.08, t * d * 0.85, 0.18, 0.06])
  }
  return (
    <group>
      <RoundedBox args={[w, h, d]} radius={0.03} smoothness={2}>
        <meshStandardMaterial color={hl ?? '#15171c'} roughness={0.7} />
      </RoundedBox>
      {pins.map(([x, z, sx, sz], i) => (
        <mesh key={i} position={[x, -h / 2 + 0.02, z]}>
          <boxGeometry args={[sx, 0.04, sz]} />
          <meshStandardMaterial color={PIN} metalness={0.8} roughness={0.3} />
        </mesh>
      ))}
      <mesh position={[-w / 2 + 0.18, h / 2 + 0.001, -d / 2 + 0.18]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.06, 16]} />
        <meshBasicMaterial color="#444" />
      </mesh>
      <Silk text={data.ref} y={h / 2 + 0.002} size={0.2} />
      <Text position={[0, h / 2 + 0.002, 0.28]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.13} color="#8a93a6" anchorX="center">
        {data.value}
      </Text>
    </group>
  )
}

/** 0805-style passive: body + two metal end caps. */
function passive(body: string) {
  return function PassiveNode({ data, selected, hovered }: CustomNodeProps<PartData>) {
    const hl = outline(selected, hovered)
    return (
      <group>
        <mesh>
          <boxGeometry args={[0.5, 0.16, 0.3]} />
          <meshStandardMaterial color={hl ?? body} roughness={0.6} />
        </mesh>
        {[-0.29, 0.29].map((x) => (
          <mesh key={x} position={[x, 0, 0]}>
            <boxGeometry args={[0.1, 0.17, 0.31]} />
            <meshStandardMaterial color={PIN} metalness={0.8} roughness={0.3} />
          </mesh>
        ))}
        <Text position={[0, 0.1, -0.35]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.14} color="#e8ecf3" anchorX="center">
          {`${data.ref} ${data.value}`}
        </Text>
      </group>
    )
  }
}

function LedNode({ data, selected, hovered }: CustomNodeProps<PartData>) {
  const c = `#${(data.led ?? 0x48ff7a).toString(16).padStart(6, '0')}`
  const hl = outline(selected, hovered)
  return (
    <group>
      <mesh>
        <boxGeometry args={[0.5, 0.12, 0.3]} />
        <meshStandardMaterial color={hl ?? '#e9e4d6'} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.1, 0]}>
        <sphereGeometry args={[0.12, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={c} emissive={c} emissiveIntensity={1.6} transparent opacity={0.9} />
      </mesh>
      <Text position={[0, 0.1, -0.35]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.14} color="#e8ecf3" anchorX="center">
        {data.ref}
      </Text>
    </group>
  )
}

/** Pin header / connector: plastic housing with a row of gold pins. */
function ConnectorNode({ data, selected, hovered }: CustomNodeProps<PartData>) {
  const n = data.pins ?? 4
  const pitch = 0.25
  const w = n * pitch + 0.1
  const hl = outline(selected, hovered)
  return (
    <group>
      <mesh>
        <boxGeometry args={[w, 0.25, 0.32]} />
        <meshStandardMaterial color={hl ?? '#202226'} roughness={0.8} />
      </mesh>
      {Array.from({ length: n }, (_, i) => (
        <mesh key={i} position={[(i - (n - 1) / 2) * pitch, 0.25, 0]}>
          <boxGeometry args={[0.06, 0.3, 0.06]} />
          <meshStandardMaterial color="#d8b04a" metalness={0.9} roughness={0.25} />
        </mesh>
      ))}
      <Text position={[0, 0.13, -0.4]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.16} color="#e8ecf3" anchorX="center">
        {`${data.ref} ${data.value}`}
      </Text>
    </group>
  )
}

/** USB-C receptacle: metal shell. */
function UsbNode({ data, selected, hovered }: CustomNodeProps<PartData>) {
  const hl = outline(selected, hovered)
  return (
    <group>
      <RoundedBox args={[0.9, 0.32, 0.75]} radius={0.12} smoothness={3}>
        <meshStandardMaterial color={hl ?? '#b9bec7'} metalness={0.9} roughness={0.25} />
      </RoundedBox>
      <Text position={[0, 0.17, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.16} color="#22252b" anchorX="center">
        {data.ref}
      </Text>
    </group>
  )
}

export type PartType = 'chip' | 'mcu' | 'resistor' | 'capacitor' | 'led' | 'connector' | 'usb' | 'via'

/** Height of each part's center above the board surface. */
export const PART_LIFT: Record<PartType, number> = {
  chip: 0.15, mcu: 0.15, resistor: 0.1, capacitor: 0.1, led: 0.08, connector: 0.15, usb: 0.18, via: 0.03,
}

/** Chip body sizes per type (handles sit on the pins, so the body can't vary per part). */
const CHIP_SIZE = { chip: 1.4, mcu: 2.4 } as const

// ------------------------------------------------------------------ pads
// Handles are node-local and rotate with the part. Pads sit just above the
// board surface (y = -lift) so copper traces lie flat on the board.

const PAD_R = 0.07
const pad = (id: string, x: number, y: number, z: number, dir?: { x: number; y: number; z: number }): HandleDef => ({
  id, position: { x, y, z }, direction: dir ?? { x: Math.sign(x), y: 0, z: Math.sign(z) }, radius: PAD_R,
})
const surfaceY = (t: PartType) => -PART_LIFT[t] + 0.02

/** Two pads per side: n1 n2 (−z), s1 s2 (+z), e1 e2 (+x), w1 w2 (−x). */
function chipPads(t: 'chip' | 'mcu'): HandleDef[] {
  const half = CHIP_SIZE[t] / 2 + 0.08
  const o = CHIP_SIZE[t] * 0.22
  const y = surfaceY(t)
  return [
    pad('n1', -o, y, -half), pad('n2', o, y, -half),
    pad('s1', -o, y, half), pad('s2', o, y, half),
    pad('e1', half, y, -o), pad('e2', half, y, o),
    pad('w1', -half, y, -o), pad('w2', -half, y, o),
  ]
}

const twoPads = (t: PartType, a: string, b: string): HandleDef[] => [
  pad(a, -0.29, surfaceY(t), 0),
  pad(b, 0.29, surfaceY(t), 0),
]

/** Stacking header: `p1..p4` on the pin tips (up), `b1..b4` underneath (down). */
const UP = { x: 0, y: 1, z: 0 }
const DOWN = { x: 0, y: -1, z: 0 }
const headerPads: HandleDef[] = [1, 2, 3, 4].flatMap((i) => {
  const x = (i - 2.5) * 0.25
  return [pad(`p${i}`, x, 0.4, 0, UP), pad(`b${i}`, x, -PART_LIFT.connector + 0.02, 0, DOWN)]
})

/** Module scope: node types must be referentially stable. */
export const nodeTypes: NodeTypes = {
  chip: customNode<PartData>(chipNode(CHIP_SIZE.chip), { radius: 0.85, handles: chipPads('chip') }),
  mcu: customNode<PartData>(chipNode(CHIP_SIZE.mcu), { radius: 1.4, handles: chipPads('mcu') }),
  resistor: customNode<PartData>(passive('#1b1b1b'), { radius: 0.35, handles: twoPads('resistor', 'a', 'b') }),
  capacitor: customNode<PartData>(passive('#9a7a52'), { radius: 0.35, handles: twoPads('capacitor', 'a', 'b') }),
  led: customNode<PartData>(LedNode, { radius: 0.35, handles: twoPads('led', 'a', 'k') }),
  connector: customNode<PartData>(ConnectorNode, { radius: 0.6, handles: headerPads }),
  usb: customNode<PartData>(UsbNode, {
    radius: 0.55,
    handles: [
      pad('vbus', 0.5, surfaceY('usb'), -0.22),
      pad('dp', 0.5, surfaceY('usb'), 0),
      pad('gnd', 0.5, surfaceY('usb'), 0.22),
    ],
  }),
  // instanced: one draw call for every via / test point
  via: instancedNode({
    geometry: new CylinderGeometry(0.09, 0.09, 0.05, 16),
    radius: 0.15,
    handles: [pad('top', 0, 0.03, 0, UP)],
  }),
}

/** Defaults when placing a new part from the toolbar. */
export const PART_DEFAULTS: Record<PartType, { prefix: string; data: Omit<PartData, 'ref'> }> = {
  chip: { prefix: 'U', data: { value: 'IC', footprint: 'QFN-24', pins: 4 } },
  mcu: { prefix: 'U', data: { value: 'MCU', footprint: 'QFN-56', pins: 8 } },
  resistor: { prefix: 'R', data: { value: '10k', footprint: '0805' } },
  capacitor: { prefix: 'C', data: { value: '100nF', footprint: '0805' } },
  led: { prefix: 'D', data: { value: 'LED', footprint: '0805', led: 0x48ff7a } },
  connector: { prefix: 'J', data: { value: 'HDR', footprint: '1x04 2.54mm', pins: 4 } },
  usb: { prefix: 'J', data: { value: 'USB-C', footprint: 'USB-C-16P' } },
  via: { prefix: 'TP', data: { value: 'via', footprint: '0.3mm' } },
}
