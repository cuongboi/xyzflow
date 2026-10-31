import { writeHexLinear } from './color'
import { DirtySet } from './dirty-set'
import { rotateVec } from './quat'
import type { EdgeId, EdgePath, EdgeRender, HexColor, NodeId } from './types'

export const NODE_SELECTED = 1
export const NODE_HOVERED = 2
export const EDGE_SELECTED = 1

export interface NodeRecord<D = unknown> {
  readonly id: NodeId
  readonly type: string
  data: D
  color: HexColor
  /** Owning bucket (one per node type). */
  readonly bucket: NodeBucket
  /** Index inside the bucket's typed arrays; `-1` once removed. */
  slot: number
  /** Adjacency: every edge touching this node. Makes "node moved -> dirty edges" O(degree). */
  readonly edges: Set<EdgeRecord>
}

export interface EdgeRecord<D = unknown> {
  readonly id: EdgeId
  readonly source: NodeRecord
  readonly target: NodeRecord
  data: D
  color: HexColor
  /** Handle ids on source/target (`undefined` = node center). */
  sourceHandle: string | undefined
  targetHandle: string | undefined
  /** Per-edge overrides; `undefined` = renderer default. */
  path: EdgePath | undefined
  render: EdgeRender | undefined
  width: number | undefined
  height: number | undefined
  /** Index inside the edge table; `-1` once removed. */
  slot: number
}

/**
 * Connection points of one node type, in node-local space.
 * `positions`/`directions` are xyz triplets; directions are unit outward normals.
 */
export interface HandleTable {
  readonly ids: readonly string[]
  readonly index: ReadonlyMap<string, number>
  readonly positions: Float32Array
  readonly directions: Float32Array
  /** Picking/visual radius per handle. */
  readonly radii: Float32Array
}

export interface HandleSpec {
  id: string
  position: { x: number; y: number; z: number }
  /** Outward direction (default: normalized position, or +X when at the center). */
  direction?: { x: number; y: number; z: number }
  radius?: number
}

export function createHandleTable(handles: readonly HandleSpec[], defaultRadius = 0.08): HandleTable {
  const n = handles.length
  const positions = new Float32Array(n * 3)
  const directions = new Float32Array(n * 3)
  const radii = new Float32Array(n)
  const index = new Map<string, number>()
  handles.forEach((h, i) => {
    if (index.has(h.id)) throw new Error(`[xyzflow] duplicate handle id "${h.id}"`)
    index.set(h.id, i)
    const p = h.position
    positions[i * 3] = p.x
    positions[i * 3 + 1] = p.y
    positions[i * 3 + 2] = p.z
    let d = h.direction ?? p
    let len = Math.hypot(d.x, d.y, d.z)
    if (len < 1e-9) {
      d = { x: 1, y: 0, z: 0 }
      len = 1
    }
    directions[i * 3] = d.x / len
    directions[i * 3 + 1] = d.y / len
    directions[i * 3 + 2] = d.z / len
    radii[i] = h.radius ?? defaultRadius
  })
  return { ids: handles.map((h) => h.id), index, positions, directions, radii }
}

/**
 * World-space position (out[o..o+2]) and outward direction (out[o+3..o+5]) of a
 * node's connection point. `handle` = `undefined` or unknown -> node center,
 * direction = `fallbackDir` rotated by the node. Allocation-free.
 */
export function writeAnchor(
  node: NodeRecord,
  handle: string | undefined,
  fallbackDir: number,
  out: Float32Array | Float64Array,
  o: number,
): void {
  const b = node.bucket
  const s = node.slot
  const P = b.positions
  const R = b.rotations
  const px = P[s * 3], py = P[s * 3 + 1], pz = P[s * 3 + 2]
  const table = b.handles
  const h = handle !== undefined && table ? table.index.get(handle) : undefined
  if (h === undefined) {
    out[o] = px
    out[o + 1] = py
    out[o + 2] = pz
    rotateVec(R, s * 4, fallbackDir, 0, 0, out, o + 3)
    return
  }
  const HP = table!.positions
  const HD = table!.directions
  rotateVec(R, s * 4, HP[h * 3], HP[h * 3 + 1], HP[h * 3 + 2], out, o)
  out[o] += px
  out[o + 1] += py
  out[o + 2] += pz
  rotateVec(R, s * 4, HD[h * 3], HD[h * 3 + 1], HD[h * 3 + 2], out, o + 3)
}

function nextCapacity(current: number, needed: number): number {
  let cap = Math.max(current, 16)
  while (cap < needed) cap *= 2
  return cap
}

/**
 * Struct-of-arrays storage for all nodes of one type.
 * Slots are dense `[0, count)`: removal swaps the last slot into the hole (O(1)),
 * which maps 1:1 onto `InstancedMesh.count` with no gaps to skip.
 */
export class NodeBucket {
  records: NodeRecord[] = []
  count = 0
  capacity: number
  positions: Float32Array
  /** xyzw quaternion per slot. */
  rotations: Float32Array
  colors: Float32Array
  flags: Uint8Array
  readonly dirty: DirtySet
  /** Connection points of this node type (`null` = center only). */
  handles: HandleTable | null = null
  /** Bumps on add/remove (React re-render key for custom node types). */
  version = 0
  /** Bumps when typed arrays are reallocated (GPU buffers must be recreated). */
  capacityVersion = 0

  constructor(
    readonly type: string,
    public radius: number,
    initialCapacity = 64,
  ) {
    this.capacity = initialCapacity
    this.positions = new Float32Array(initialCapacity * 3)
    this.rotations = new Float32Array(initialCapacity * 4)
    this.colors = new Float32Array(initialCapacity * 3)
    this.flags = new Uint8Array(initialCapacity)
    this.dirty = new DirtySet(initialCapacity)
  }

  /** Ensures room for `n` slots. Returns `true` when storage was reallocated. */
  reserve(n: number): boolean {
    if (n <= this.capacity) return false
    const cap = nextCapacity(this.capacity, n)
    const positions = new Float32Array(cap * 3)
    positions.set(this.positions)
    const rotations = new Float32Array(cap * 4)
    rotations.set(this.rotations)
    const colors = new Float32Array(cap * 3)
    colors.set(this.colors)
    const flags = new Uint8Array(cap)
    flags.set(this.flags)
    this.positions = positions
    this.rotations = rotations
    this.colors = colors
    this.flags = flags
    this.capacity = cap
    this.capacityVersion++
    this.dirty.markAll()
    return true
  }

  push(
    record: NodeRecord,
    x: number,
    y: number,
    z: number,
    qx = 0,
    qy = 0,
    qz = 0,
    qw = 1,
  ): number {
    const slot = this.count
    this.reserve(slot + 1)
    const o = slot * 3
    this.positions[o] = x
    this.positions[o + 1] = y
    this.positions[o + 2] = z
    const r = slot * 4
    this.rotations[r] = qx
    this.rotations[r + 1] = qy
    this.rotations[r + 2] = qz
    this.rotations[r + 3] = qw
    writeHexLinear(record.color, this.colors, o)
    this.flags[slot] = 0
    this.records[slot] = record
    record.slot = slot
    this.count++
    this.version++
    this.dirty.add(slot)
    return slot
  }

  removeAt(slot: number): void {
    const last = this.count - 1
    const removed = this.records[slot]
    if (slot !== last) {
      const moved = this.records[last]
      this.records[slot] = moved
      moved.slot = slot
      const a = slot * 3
      const b = last * 3
      this.positions.copyWithin(a, b, b + 3)
      this.rotations.copyWithin(slot * 4, last * 4, last * 4 + 4)
      this.colors.copyWithin(a, b, b + 3)
      this.flags[slot] = this.flags[last]
      this.dirty.add(slot)
    }
    this.records.length = last
    this.flags[last] = 0
    this.count = last
    this.version++
    removed.slot = -1
  }

  reset(): void {
    for (let i = 0; i < this.count; i++) this.records[i].slot = -1
    this.records = []
    this.count = 0
    this.version++
    this.dirty.markAll()
  }
}

/** Dense slot storage for edges (same swap-remove scheme as nodes). */
export class EdgeTable {
  records: EdgeRecord[] = []
  count = 0
  capacity: number
  colors: Float32Array
  flags: Uint8Array
  readonly dirty: DirtySet
  version = 0
  capacityVersion = 0

  constructor(initialCapacity = 128) {
    this.capacity = initialCapacity
    this.colors = new Float32Array(initialCapacity * 3)
    this.flags = new Uint8Array(initialCapacity)
    this.dirty = new DirtySet(initialCapacity)
  }

  reserve(n: number): boolean {
    if (n <= this.capacity) return false
    const cap = nextCapacity(this.capacity, n)
    const colors = new Float32Array(cap * 3)
    colors.set(this.colors)
    const flags = new Uint8Array(cap)
    flags.set(this.flags)
    this.colors = colors
    this.flags = flags
    this.capacity = cap
    this.capacityVersion++
    this.dirty.markAll()
    return true
  }

  push(record: EdgeRecord): number {
    const slot = this.count
    this.reserve(slot + 1)
    writeHexLinear(record.color, this.colors, slot * 3)
    this.flags[slot] = 0
    this.records[slot] = record
    record.slot = slot
    this.count++
    this.version++
    this.dirty.add(slot)
    return slot
  }

  removeAt(slot: number): void {
    const last = this.count - 1
    const removed = this.records[slot]
    if (slot !== last) {
      const moved = this.records[last]
      this.records[slot] = moved
      moved.slot = slot
      this.colors.copyWithin(slot * 3, last * 3, last * 3 + 3)
      this.flags[slot] = this.flags[last]
      this.dirty.add(slot)
    }
    this.records.length = last
    this.flags[last] = 0
    this.count = last
    this.version++
    removed.slot = -1
  }

  reset(): void {
    for (let i = 0; i < this.count; i++) this.records[i].slot = -1
    this.records = []
    this.count = 0
    this.version++
    this.dirty.markAll()
  }
}
