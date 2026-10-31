import { writeHexLinear } from './color'
import { createId } from './id'
import {
  EDGE_SELECTED,
  EdgeTable,
  NODE_HOVERED,
  NODE_SELECTED,
  NodeBucket,
  type EdgeRecord,
  type HandleTable,
  type NodeRecord,
} from './storage'
import { toQuat } from './quat'
import type {
  Bounds,
  EdgeId,
  EdgeInput,
  EdgeShape,
  EdgeSnapshot,
  HexColor,
  NodeId,
  NodeInput,
  NodeSnapshot,
  Quat,
  SelectMode,
  Vec3,
} from './types'

/**
 * - `structure`: nodes/edges added or removed, buffers reallocated, node type added.
 * - `render`: anything visible changed -> renderer should draw a frame.
 * - `selection`: selection set changed.
 * - `hover`: hovered node changed.
 * - `data`: a node's `data` / `color` changed.
 */
export type StoreEvent = 'structure' | 'render' | 'selection' | 'hover' | 'data'

const MASK: Record<StoreEvent, number> = {
  structure: 1,
  render: 2,
  selection: 4,
  hover: 8,
  data: 16,
}
const ALL_BITS = [1, 2, 4, 8, 16] as const

export interface PickResult {
  node: NodeRecord
  distance: number
}

export interface GraphStoreOptions {
  defaultNodeType?: string
  defaultNodeColor?: HexColor
  defaultEdgeColor?: HexColor
  defaultRadius?: number
}

/**
 * Low-level graph storage. Positions live in per-type `Float32Array`s, never in
 * React state. All mutations are synchronous and emit coalesced events
 * (use `batch` to group many mutations into one notification).
 *
 * This class has no history; use `Flow` for undoable edits.
 */
export class GraphStore {
  readonly nodes = new Map<NodeId, NodeRecord>()
  readonly edges = new Map<EdgeId, EdgeRecord>()
  readonly buckets: NodeBucket[] = []
  readonly edgeTable = new EdgeTable()
  readonly selectedNodes = new Set<NodeRecord>()
  readonly selectedEdges = new Set<EdgeRecord>()
  hovered: NodeRecord | null = null

  /** Number of edges whose own `render` is `'tube'` (lets renderers skip the tube mesh entirely). */
  tubeEdgeCount = 0
  /** Number of edges whose own `path` is `'bezier'`. */
  bezierEdgeCount = 0

  /** Bumps whenever a bucket (node type) is created. */
  bucketListVersion = 0
  structureVersion = 0
  selectionVersion = 0

  defaultNodeType: string
  defaultNodeColor: HexColor
  defaultEdgeColor: HexColor
  defaultRadius: number

  private bucketByType = new Map<string, NodeBucket>()
  private radii = new Map<string, number>()
  private handleTables = new Map<string, HandleTable | null>()
  private listeners = new Map<number, Set<() => void>>()
  private batchDepth = 0
  private pending = 0

  constructor(options: GraphStoreOptions = {}) {
    this.defaultNodeType = options.defaultNodeType ?? 'default'
    this.defaultNodeColor = options.defaultNodeColor ?? 0x8da2c0
    this.defaultEdgeColor = options.defaultEdgeColor ?? 0x55637a
    this.defaultRadius = options.defaultRadius ?? 0.5
  }

  // ---------------------------------------------------------------- events

  on(event: StoreEvent, fn: () => void): () => void {
    const bit = MASK[event]
    let set = this.listeners.get(bit)
    if (!set) this.listeners.set(bit, (set = new Set()))
    set.add(fn)
    return () => {
      set.delete(fn)
    }
  }

  /** Runs `fn` and emits one coalesced notification at the end (nestable). */
  batch<T>(fn: () => T): T {
    this.batchDepth++
    try {
      return fn()
    } finally {
      if (--this.batchDepth === 0 && this.pending !== 0) {
        const mask = this.pending
        this.pending = 0
        this.dispatch(mask)
      }
    }
  }

  private emit(mask: number): void {
    if (this.batchDepth > 0) this.pending |= mask
    else this.dispatch(mask)
  }

  private dispatch(mask: number): void {
    for (const bit of ALL_BITS) {
      if ((mask & bit) === 0) continue
      const set = this.listeners.get(bit)
      if (!set || set.size === 0) continue
      for (const fn of Array.from(set)) fn()
    }
  }

  // ---------------------------------------------------------------- types

  /** Picking radius for a node type (renderers call this when registering node types). */
  setTypeRadius(type: string, radius: number): void {
    this.radii.set(type, radius)
    const bucket = this.bucketByType.get(type)
    if (bucket) bucket.radius = radius
  }

  /** Connection points for a node type (renderers call this from `nodeTypes`). */
  setTypeHandles(type: string, table: HandleTable | null): void {
    this.handleTables.set(type, table)
    const bucket = this.bucketByType.get(type)
    if (bucket && bucket.handles !== table) {
      bucket.handles = table
      this.edgeTable.dirty.markAll()
      this.emit(MASK.render)
    }
  }

  getTypeHandles(type: string): HandleTable | null {
    return this.handleTables.get(type) ?? null
  }

  /** `true` when `handle` is unset, or exists on the node's type (unknown types accept anything). */
  hasHandle(node: NodeRecord, handle: string | undefined): boolean {
    if (handle === undefined) return true
    if (!this.handleTables.has(node.type)) return true
    return this.handleTables.get(node.type)?.index.has(handle) ?? false
  }

  getBucket(type: string): NodeBucket | undefined {
    return this.bucketByType.get(type)
  }

  private bucketFor(type: string): NodeBucket {
    let bucket = this.bucketByType.get(type)
    if (!bucket) {
      bucket = new NodeBucket(type, this.radii.get(type) ?? this.defaultRadius)
      bucket.handles = this.handleTables.get(type) ?? null
      this.bucketByType.set(type, bucket)
      this.buckets.push(bucket)
      this.bucketListVersion++
    }
    return bucket
  }

  // ---------------------------------------------------------------- nodes

  get nodeCount(): number {
    return this.nodes.size
  }

  get edgeCount(): number {
    return this.edges.size
  }

  addNode<D>(input: NodeInput<D>): NodeRecord<D> {
    const id = input.id ?? createId('n')
    if (this.nodes.has(id)) throw new Error(`[xyzflow] duplicate node id "${id}"`)
    const bucket = this.bucketFor(input.type ?? this.defaultNodeType)
    const record: NodeRecord<D> = {
      id,
      type: bucket.type,
      data: input.data as D,
      color: input.color ?? this.defaultNodeColor,
      bucket,
      slot: -1,
      edges: new Set(),
    }
    const p = input.position
    const q = toQuat(input.rotation)
    bucket.push(record as NodeRecord, p.x, p.y, p.z, q.x, q.y, q.z, q.w)
    this.nodes.set(id, record as NodeRecord)
    this.structureVersion++
    this.emit(MASK.structure | MASK.render)
    return record
  }

  removeNode(id: NodeId): boolean {
    const record = this.nodes.get(id)
    if (!record) return false
    this.batch(() => {
      for (const edge of Array.from(record.edges)) this.removeEdge(edge.id)
      this.selectedNodes.delete(record)
      if (this.hovered === record) this.hovered = null
      record.bucket.removeAt(record.slot)
      this.nodes.delete(id)
      this.structureVersion++
      this.emit(MASK.structure | MASK.render | MASK.selection)
    })
    return true
  }

  getNode(id: NodeId): NodeRecord | undefined {
    return this.nodes.get(id)
  }

  /** Hot path: no allocation, no React. Marks node + adjacent edges dirty. */
  setPosition(record: NodeRecord, x: number, y: number, z: number): void {
    const slot = record.slot
    if (slot < 0) return
    const bucket = record.bucket
    const P = bucket.positions
    const o = slot * 3
    P[o] = x
    P[o + 1] = y
    P[o + 2] = z
    bucket.dirty.add(slot)
    if (record.edges.size !== 0) {
      const dirty = this.edgeTable.dirty
      for (const edge of record.edges) dirty.add(edge.slot)
    }
    this.emit(MASK.render)
  }

  getPosition(record: NodeRecord, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
    const P = record.bucket.positions
    const o = record.slot * 3
    out.x = P[o]
    out.y = P[o + 1]
    out.z = P[o + 2]
    return out
  }

  /** Hot path like `setPosition`: writes the quaternion (assumed normalized), marks node + edges dirty. */
  setRotation(record: NodeRecord, x: number, y: number, z: number, w: number): void {
    const slot = record.slot
    if (slot < 0) return
    const bucket = record.bucket
    const R = bucket.rotations
    const o = slot * 4
    R[o] = x
    R[o + 1] = y
    R[o + 2] = z
    R[o + 3] = w
    bucket.dirty.add(slot)
    if (record.edges.size !== 0) {
      const dirty = this.edgeTable.dirty
      for (const edge of record.edges) dirty.add(edge.slot)
    }
    this.emit(MASK.render)
  }

  getRotation(record: NodeRecord, out: Quat = { x: 0, y: 0, z: 0, w: 1 }): Quat {
    const R = record.bucket.rotations
    const o = record.slot * 4
    out.x = R[o]
    out.y = R[o + 1]
    out.z = R[o + 2]
    out.w = R[o + 3]
    return out
  }

  setNodeColor(record: NodeRecord, color: HexColor): void {
    if (record.slot < 0) return
    record.color = color
    writeHexLinear(color, record.bucket.colors, record.slot * 3)
    record.bucket.dirty.add(record.slot)
    this.emit(MASK.render | MASK.data)
  }

  setNodeData<D>(record: NodeRecord<D>, data: D): void {
    record.data = data
    this.emit(MASK.render | MASK.data)
  }

  // ---------------------------------------------------------------- edges

  /** Returns `null` if an endpoint does not exist. */
  addEdge<D>(input: EdgeInput<D>): EdgeRecord<D> | null {
    const source = this.nodes.get(input.source)
    const target = this.nodes.get(input.target)
    if (!source || !target) return null
    const id = input.id ?? createId('e')
    if (this.edges.has(id)) throw new Error(`[xyzflow] duplicate edge id "${id}"`)
    const record: EdgeRecord<D> = {
      id,
      source,
      target,
      data: input.data as D,
      color: input.color ?? this.defaultEdgeColor,
      sourceHandle: input.sourceHandle,
      targetHandle: input.targetHandle,
      path: input.path,
      render: input.render,
      width: input.width,
      height: input.height,
      slot: -1,
    }
    if (record.render === 'tube') this.tubeEdgeCount++
    if (record.path === 'bezier') this.bezierEdgeCount++
    this.edgeTable.push(record as EdgeRecord)
    source.edges.add(record as EdgeRecord)
    target.edges.add(record as EdgeRecord)
    this.edges.set(id, record as EdgeRecord)
    this.structureVersion++
    this.emit(MASK.structure | MASK.render)
    return record
  }

  removeEdge(id: EdgeId): boolean {
    const record = this.edges.get(id)
    if (!record) return false
    record.source.edges.delete(record)
    record.target.edges.delete(record)
    const wasSelected = this.selectedEdges.delete(record)
    if (record.render === 'tube') this.tubeEdgeCount--
    if (record.path === 'bezier') this.bezierEdgeCount--
    this.edgeTable.removeAt(record.slot)
    this.edges.delete(id)
    this.structureVersion++
    this.emit(MASK.structure | MASK.render | (wasSelected ? MASK.selection : 0))
    return true
  }

  /**
   * Changes an edge's connection points / shape in place (slot unchanged).
   * Keys present in `shape` are applied, including explicit `undefined` (= reset to default).
   */
  setEdgeShape(record: EdgeRecord, shape: EdgeShape): void {
    if (record.slot < 0) return
    const wasTube = record.render === 'tube'
    const wasBezier = record.path === 'bezier'
    if ('sourceHandle' in shape) record.sourceHandle = shape.sourceHandle
    if ('targetHandle' in shape) record.targetHandle = shape.targetHandle
    if ('path' in shape) record.path = shape.path
    if ('render' in shape) record.render = shape.render
    if ('width' in shape) record.width = shape.width
    if ('height' in shape) record.height = shape.height
    const isTube = record.render === 'tube'
    const isBezier = record.path === 'bezier'
    let mask = MASK.render | MASK.data
    if (wasTube !== isTube) {
      this.tubeEdgeCount += isTube ? 1 : -1
      mask |= MASK.structure
    }
    if (wasBezier !== isBezier) {
      this.bezierEdgeCount += isBezier ? 1 : -1
      mask |= MASK.structure
    }
    this.edgeTable.dirty.add(record.slot)
    this.emit(mask)
  }

  setEdgeColor(record: EdgeRecord, color: HexColor): void {
    if (record.slot < 0) return
    record.color = color
    writeHexLinear(color, this.edgeTable.colors, record.slot * 3)
    this.edgeTable.dirty.add(record.slot)
    this.emit(MASK.render | MASK.data)
  }

  setEdgeData<D>(record: EdgeRecord<D>, data: D): void {
    record.data = data
    this.emit(MASK.data)
  }

  getEdge(id: EdgeId): EdgeRecord | undefined {
    return this.edges.get(id)
  }

  /**
   * O(degree) duplicate check. When handles are given, only an edge between the
   * same two connection points counts as a duplicate.
   */
  findEdge(
    source: NodeId,
    target: NodeId,
    sourceHandle?: string,
    targetHandle?: string,
  ): EdgeRecord | undefined {
    const s = this.nodes.get(source)
    if (!s) return undefined
    for (const e of s.edges) {
      if (e.source.id !== source || e.target.id !== target) continue
      if (e.sourceHandle === sourceHandle && e.targetHandle === targetHandle) return e
    }
    return undefined
  }

  // ---------------------------------------------------------------- selection & hover

  setSelection(
    nodes: Iterable<NodeRecord>,
    edges: Iterable<EdgeRecord>,
    mode: SelectMode = 'replace',
  ): void {
    if (mode === 'replace') {
      for (const n of this.selectedNodes) this.flagNode(n, NODE_SELECTED, false)
      for (const e of this.selectedEdges) this.flagEdge(e, false)
      this.selectedNodes.clear()
      this.selectedEdges.clear()
    }
    for (const n of nodes) {
      if (n.slot < 0) continue
      const off = mode === 'remove' || (mode === 'toggle' && this.selectedNodes.has(n))
      if (off) this.selectedNodes.delete(n)
      else this.selectedNodes.add(n)
      this.flagNode(n, NODE_SELECTED, !off)
    }
    for (const e of edges) {
      if (e.slot < 0) continue
      const off = mode === 'remove' || (mode === 'toggle' && this.selectedEdges.has(e))
      if (off) this.selectedEdges.delete(e)
      else this.selectedEdges.add(e)
      this.flagEdge(e, !off)
    }
    this.selectionVersion++
    this.emit(MASK.selection | MASK.render)
  }

  setHovered(record: NodeRecord | null): void {
    if (this.hovered === record) return
    if (this.hovered && this.hovered.slot >= 0) this.flagNode(this.hovered, NODE_HOVERED, false)
    this.hovered = record
    if (record) this.flagNode(record, NODE_HOVERED, true)
    this.emit(MASK.hover | MASK.render)
  }

  private flagNode(n: NodeRecord, flag: number, on: boolean): void {
    if (n.slot < 0) return
    const F = n.bucket.flags
    F[n.slot] = on ? F[n.slot] | flag : F[n.slot] & ~flag
    n.bucket.dirty.add(n.slot)
    // edges recolor when an endpoint is selected
    if (flag === NODE_SELECTED) for (const e of n.edges) this.edgeTable.dirty.add(e.slot)
  }

  private flagEdge(e: EdgeRecord, on: boolean): void {
    if (e.slot < 0) return
    this.edgeTable.flags[e.slot] = on ? EDGE_SELECTED : 0
    this.edgeTable.dirty.add(e.slot)
  }

  // ---------------------------------------------------------------- spatial queries

  /**
   * Analytic ray vs bounding-sphere test over the raw typed arrays.
   * ~O(n) tight loop with zero allocations: 100k nodes in well under 1 ms,
   * versus three's per-instance triangle raycast which is orders of magnitude slower.
   * `dx, dy, dz` must be normalized.
   */
  pickRay(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    exclude?: NodeRecord | null,
  ): PickResult | null {
    let best: NodeRecord | null = null
    let bestT = Infinity
    for (const b of this.buckets) {
      const n = b.count
      if (n === 0) continue
      const r2 = b.radius * b.radius
      const P = b.positions
      for (let i = 0; i < n; i++) {
        const o = i * 3
        const cx = P[o] - ox
        const cy = P[o + 1] - oy
        const cz = P[o + 2] - oz
        const t = cx * dx + cy * dy + cz * dz
        if (t < 0) continue
        const d2 = cx * cx + cy * cy + cz * cz - t * t
        if (d2 > r2) continue
        const hit = t - Math.sqrt(r2 - d2)
        if (hit < bestT) {
          const rec = b.records[i]
          if (rec === exclude) continue
          bestT = hit
          best = rec
        }
      }
    }
    return best ? { node: best, distance: bestT } : null
  }

  /**
   * Nodes whose center projects inside an NDC rectangle.
   * `m` is a column-major view-projection matrix (e.g. three's `Matrix4.elements`).
   */
  queryRect(m: ArrayLike<number>, x0: number, y0: number, x1: number, y1: number): NodeRecord[] {
    const minX = Math.min(x0, x1)
    const maxX = Math.max(x0, x1)
    const minY = Math.min(y0, y1)
    const maxY = Math.max(y0, y1)
    const out: NodeRecord[] = []
    const m0 = m[0], m1 = m[1], m3 = m[3], m4 = m[4], m5 = m[5], m7 = m[7]
    const m8 = m[8], m9 = m[9], m11 = m[11], m12 = m[12], m13 = m[13], m15 = m[15]
    for (const b of this.buckets) {
      const P = b.positions
      for (let i = 0; i < b.count; i++) {
        const o = i * 3
        const x = P[o], y = P[o + 1], z = P[o + 2]
        const w = m3 * x + m7 * y + m11 * z + m15
        if (w <= 0) continue // behind camera
        const nx = (m0 * x + m4 * y + m8 * z + m12) / w
        if (nx < minX || nx > maxX) continue
        const ny = (m1 * x + m5 * y + m9 * z + m13) / w
        if (ny < minY || ny > maxY) continue
        out.push(b.records[i])
      }
    }
    return out
  }

  /** Axis-aligned bounds (including node radius) of the given nodes, or of all nodes. */
  bounds(nodes?: Iterable<NodeRecord>): Bounds | null {
    let minX = Infinity, minY = Infinity, minZ = Infinity
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    const visit = (P: Float32Array, i: number, r: number) => {
      const o = i * 3
      const x = P[o], y = P[o + 1], z = P[o + 2]
      if (x - r < minX) minX = x - r
      if (y - r < minY) minY = y - r
      if (z - r < minZ) minZ = z - r
      if (x + r > maxX) maxX = x + r
      if (y + r > maxY) maxY = y + r
      if (z + r > maxZ) maxZ = z + r
    }
    if (nodes) {
      for (const n of nodes) if (n.slot >= 0) visit(n.bucket.positions, n.slot, n.bucket.radius)
    } else {
      for (const b of this.buckets) for (let i = 0; i < b.count; i++) visit(b.positions, i, b.radius)
    }
    if (minX === Infinity) return null
    return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } }
  }

  // ---------------------------------------------------------------- snapshots

  snapshotNode<D = unknown>(record: NodeRecord): NodeSnapshot<D> {
    return {
      id: record.id,
      type: record.type,
      position: this.getPosition(record),
      rotation: this.getRotation(record),
      color: record.color,
      data: record.data as D,
    }
  }

  snapshotEdge<D = unknown>(record: EdgeRecord): EdgeSnapshot<D> {
    const snap: EdgeSnapshot<D> = {
      id: record.id,
      source: record.source.id,
      target: record.target.id,
      color: record.color,
      data: record.data as D,
    }
    // optional fields only when set, so v1-style snapshots stay identical
    if (record.sourceHandle !== undefined) snap.sourceHandle = record.sourceHandle
    if (record.targetHandle !== undefined) snap.targetHandle = record.targetHandle
    if (record.path !== undefined) snap.path = record.path
    if (record.render !== undefined) snap.render = record.render
    if (record.width !== undefined) snap.width = record.width
    if (record.height !== undefined) snap.height = record.height
    return snap
  }

  /** Removes everything (no per-node work beyond resetting slots). */
  clear(): void {
    for (const b of this.buckets) b.reset()
    this.edgeTable.reset()
    this.tubeEdgeCount = 0
    this.bezierEdgeCount = 0
    this.nodes.clear()
    this.edges.clear()
    this.selectedNodes.clear()
    this.selectedEdges.clear()
    this.hovered = null
    this.structureVersion++
    this.selectionVersion++
    this.emit(MASK.structure | MASK.render | MASK.selection | MASK.hover)
  }
}
