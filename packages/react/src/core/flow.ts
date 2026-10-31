import { GraphStore } from './graph-store'
import {
  EdgeUpdateCommand,
  History,
  MoveCommand,
  PatchCommand,
  RotateCommand,
  type Command,
  type EdgeState,
} from './history'
import { quatMultiply, toQuat } from './quat'
import { createId } from './id'
import type { EdgeRecord, NodeRecord } from './storage'
import type {
  Connection,
  EdgeId,
  EdgeInput,
  EdgeShape,
  EdgeSnapshot,
  GraphJSON,
  HexColor,
  NodeId,
  NodeInput,
  NodeSnapshot,
  Quat,
  RotationInput,
  SelectMode,
  Vec3,
} from './types'

export interface FlowOptions {
  /** Grid step for dragging (0 = off). */
  snap?: number
  historyLimit?: number
  defaultNodeType?: string
  defaultNodeColor?: HexColor
  defaultEdgeColor?: HexColor
  allowSelfLoops?: boolean
  allowMultiEdges?: boolean
  isValidConnection?: (connection: Connection, flow: Flow) => boolean
  initial?: GraphJSON
}

export interface MutationOptions {
  /** Record in undo history (default `true`). Use `false` for bulk loads. */
  history?: boolean
}

/**
 * - `change`: graph content committed (add/remove/move/connect/undo/redo/load)
 * - `selection`: selection changed
 * - `history`: undo/redo availability changed
 */
export type FlowEvent = 'change' | 'selection' | 'history'

export interface FitViewOptions {
  /** Fit only these nodes (default: all). */
  nodes?: NodeId[]
  /** Extra space around the bounds, as a fraction (default 0.2). */
  padding?: number
}

/** Implemented by the renderer (`<Flow3D>`), which owns the camera. */
export interface ViewApi {
  fitView(options?: FitViewOptions): void
}

const ZERO: Vec3 = { x: 0, y: 0, z: 0 }

/**
 * The editor controller. Every edit goes through here: undo/redo, events and
 * validation come for free. Hand the same instance to `<Flow3D flow={flow} />`
 * and to your DOM UI.
 */
export class Flow {
  readonly store: GraphStore
  readonly history: History
  snap: number

  readonly options: FlowOptions
  private readonly listeners: Record<FlowEvent, Set<() => void>> = {
    change: new Set(),
    selection: new Set(),
    history: new Set(),
  }
  private clipboard: { nodes: NodeSnapshot[]; edges: EdgeSnapshot[] } | null = null
  private view: ViewApi | null = null

  constructor(options: FlowOptions = {}) {
    this.options = options
    this.snap = options.snap ?? 0
    this.store = new GraphStore({
      defaultNodeType: options.defaultNodeType,
      defaultNodeColor: options.defaultNodeColor,
      defaultEdgeColor: options.defaultEdgeColor,
    })
    this.history = new History(options.historyLimit ?? 200, () => this.emit('history'))
    this.store.on('selection', () => this.emit('selection'))
    if (options.initial) this.fromJSON(options.initial)
  }

  // ---------------------------------------------------------------- events

  on(event: FlowEvent, fn: () => void): () => void {
    this.listeners[event].add(fn)
    return () => {
      this.listeners[event].delete(fn)
    }
  }

  private emit(event: FlowEvent): void {
    for (const fn of Array.from(this.listeners[event])) fn()
  }

  /** @internal */
  _emitChange(): void {
    this.emit('change')
  }

  // ---------------------------------------------------------------- reads

  get nodeCount(): number {
    return this.store.nodeCount
  }

  get edgeCount(): number {
    return this.store.edgeCount
  }

  hasNode(id: NodeId): boolean {
    return this.store.nodes.has(id)
  }

  getNode<D = unknown>(id: NodeId): NodeSnapshot<D> | undefined {
    const r = this.store.getNode(id)
    return r && this.store.snapshotNode<D>(r)
  }

  getEdge<D = unknown>(id: EdgeId): EdgeSnapshot<D> | undefined {
    const r = this.store.getEdge(id)
    return r && this.store.snapshotEdge<D>(r)
  }

  /** Allocates snapshots: fine for UI/serialization, avoid per frame. */
  getNodes(): NodeSnapshot[] {
    const out: NodeSnapshot[] = []
    for (const r of this.store.nodes.values()) out.push(this.store.snapshotNode(r))
    return out
  }

  getEdges(): EdgeSnapshot[] {
    const out: EdgeSnapshot[] = []
    for (const r of this.store.edges.values()) out.push(this.store.snapshotEdge(r))
    return out
  }

  getPosition(id: NodeId): Vec3 | undefined {
    const r = this.store.getNode(id)
    return r && this.store.getPosition(r)
  }

  getRotation(id: NodeId): Quat | undefined {
    const r = this.store.getNode(id)
    return r && this.store.getRotation(r)
  }

  getSelectedNodeIds(): NodeId[] {
    return Array.from(this.store.selectedNodes, (n) => n.id)
  }

  getSelectedEdgeIds(): EdgeId[] {
    return Array.from(this.store.selectedEdges, (e) => e.id)
  }

  // ---------------------------------------------------------------- add

  addNode<D>(input: NodeInput<D>, options?: MutationOptions): NodeId {
    return this.addNodes([input], options)[0]
  }

  addNodes<D>(inputs: NodeInput<D>[], options?: MutationOptions): NodeId[] {
    const nodes = inputs.map((n) => this.normalizeNode(n))
    this.commit(new PatchCommand({ addNodes: nodes }, 'add-nodes'), options)
    return nodes.map((n) => n.id)
  }

  /** Validated connect. Returns the new edge id, or `null` if rejected. */
  connect<D>(input: EdgeInput<D>, options?: MutationOptions): EdgeId | null {
    if (!this.canConnect(input)) return null
    const edge = this.normalizeEdge(input)
    this.commit(new PatchCommand({ addEdges: [edge] }, 'connect'), options)
    return edge.id
  }

  /** Bulk add, skipping invalid edges. */
  addEdges<D>(inputs: EdgeInput<D>[], options?: MutationOptions): EdgeId[] {
    const edges = inputs.filter((e) => this.canConnect(e)).map((e) => this.normalizeEdge(e))
    if (edges.length) this.commit(new PatchCommand({ addEdges: edges }, 'add-edges'), options)
    return edges.map((e) => e.id)
  }

  canConnect({ source, target, sourceHandle, targetHandle }: Connection): boolean {
    const s = this.store.getNode(source)
    const t = this.store.getNode(target)
    if (!s || !t) return false
    if (source === target && !this.options.allowSelfLoops) return false
    if (!this.store.hasHandle(s, sourceHandle) || !this.store.hasHandle(t, targetHandle)) return false
    if (
      !this.options.allowMultiEdges &&
      this.store.findEdge(source, target, sourceHandle, targetHandle)
    ) {
      return false
    }
    return (
      this.options.isValidConnection?.({ source, target, sourceHandle, targetHandle }, this) ?? true
    )
  }

  // ---------------------------------------------------------------- remove

  /** Removes nodes and every connected edge (restored together on undo). */
  removeNodes(ids: Iterable<NodeId>, options?: MutationOptions): void {
    const store = this.store
    const nodes: NodeSnapshot[] = []
    const edgeSet = new Set<EdgeRecord>()
    for (const id of ids) {
      const r = store.getNode(id)
      if (!r) continue
      nodes.push(store.snapshotNode(r))
      for (const e of r.edges) edgeSet.add(e)
    }
    if (!nodes.length) return
    const edges = Array.from(edgeSet, (e) => store.snapshotEdge(e))
    this.commit(new PatchCommand({ removeNodes: nodes, removeEdges: edges }, 'remove'), options)
  }

  removeNode(id: NodeId, options?: MutationOptions): void {
    this.removeNodes([id], options)
  }

  removeEdges(ids: Iterable<EdgeId>, options?: MutationOptions): void {
    const edges: EdgeSnapshot[] = []
    for (const id of ids) {
      const r = this.store.getEdge(id)
      if (r) edges.push(this.store.snapshotEdge(r))
    }
    if (edges.length) this.commit(new PatchCommand({ removeEdges: edges }, 'remove-edges'), options)
  }

  /** Deletes selected nodes and selected edges as one undo step. */
  removeSelected(): void {
    const store = this.store
    if (!store.selectedNodes.size && !store.selectedEdges.size) return
    const edgeSet = new Set<EdgeRecord>(store.selectedEdges)
    const nodes: NodeSnapshot[] = []
    for (const n of store.selectedNodes) {
      nodes.push(store.snapshotNode(n))
      for (const e of n.edges) edgeSet.add(e)
    }
    const edges = Array.from(edgeSet, (e) => store.snapshotEdge(e))
    this.commit(new PatchCommand({ removeNodes: nodes, removeEdges: edges }, 'remove'))
  }

  /** Removes everything (undoable unless `history: false`). */
  clear(options?: MutationOptions): void {
    if (options?.history === false) {
      this.store.clear()
      this._emitChange()
      return
    }
    this.commit(
      new PatchCommand({ removeNodes: this.getNodes(), removeEdges: this.getEdges() }, 'clear'),
    )
  }

  // ---------------------------------------------------------------- move

  moveNode(id: NodeId, position: Vec3, options?: MutationOptions): void {
    this.moveNodes([id], [position], options)
  }

  moveNodes(ids: NodeId[], positions: Vec3[], options?: MutationOptions): void {
    const valid: NodeId[] = []
    const from: number[] = []
    const to: number[] = []
    ids.forEach((id, i) => {
      const r = this.store.getNode(id)
      if (!r) return
      const p = this.store.getPosition(r)
      valid.push(id)
      from.push(p.x, p.y, p.z)
      to.push(positions[i].x, positions[i].y, positions[i].z)
    })
    if (!valid.length) return
    this.commit(new MoveCommand(valid, new Float32Array(from), new Float32Array(to)), options)
  }

  moveBy(ids: Iterable<NodeId>, delta: Vec3, options?: MutationOptions): void {
    const list = Array.from(ids)
    const positions = list.map((id) => {
      const p = this.getPosition(id) ?? ZERO
      return { x: p.x + delta.x, y: p.y + delta.y, z: p.z + delta.z }
    })
    this.moveNodes(list, positions, options)
  }

  /**
   * Interactive move (drag). Updates write straight into typed arrays; one
   * undo entry is recorded on `commit()`. `anchor` is the node snapped to grid.
   */
  beginMove(ids: Iterable<NodeId>, anchor?: NodeId): MoveSession {
    return new MoveSession(this, Array.from(ids), anchor)
  }

  // ---------------------------------------------------------------- rotate

  /** Sets absolute orientations (quaternion or XYZ Euler radians). One undo step. */
  setRotations(ids: NodeId[], rotations: RotationInput[], options?: MutationOptions): void {
    const valid: NodeId[] = []
    const from: number[] = []
    const to: number[] = []
    ids.forEach((id, i) => {
      const r = this.store.getNode(id)
      if (!r || !rotations[i]) return
      const a = this.store.getRotation(r)
      const b = toQuat(rotations[i])
      valid.push(id)
      from.push(a.x, a.y, a.z, a.w)
      to.push(b.x, b.y, b.z, b.w)
    })
    if (!valid.length) return
    this.commit(new RotateCommand(valid, new Float32Array(from), new Float32Array(to)), options)
  }

  setRotation(id: NodeId, rotation: RotationInput, options?: MutationOptions): void {
    this.setRotations([id], [rotation], options)
  }

  /** Rotates each node about its own center by a world-space `delta`. */
  rotateBy(ids: Iterable<NodeId>, delta: RotationInput, options?: MutationOptions): void {
    const d = toQuat(delta)
    const list = Array.from(ids).filter((id) => this.store.nodes.has(id))
    this.setRotations(
      list,
      list.map((id) => quatMultiply(d, this.getRotation(id)!)),
      options,
    )
  }

  /** Interactive rotation (e.g. a drag); one undo entry on `commit()`. */
  beginRotate(ids: Iterable<NodeId>): RotateSession {
    return new RotateSession(this, Array.from(ids))
  }

  // ---------------------------------------------------------------- update

  /** Updates color/data in place (not recorded in history). */
  updateNode<D>(id: NodeId, patch: { color?: HexColor; data?: D }): void {
    const r = this.store.getNode(id)
    if (!r) return
    this.store.batch(() => {
      if (patch.color !== undefined) this.store.setNodeColor(r, patch.color)
      if (patch.data !== undefined) this.store.setNodeData(r, patch.data)
    })
    this._emitChange()
  }

  /**
   * Edits a connector in place: connection points, `path` (straight/bezier),
   * `render` (line/tube), `width`/`height`, `color`. Undoable; `data` is not.
   * Set a key to `undefined` to reset it to the renderer default.
   */
  updateEdge<D>(
    id: EdgeId,
    patch: EdgeShape & { color?: HexColor; data?: D },
    options?: MutationOptions,
  ): boolean {
    const r = this.store.getEdge(id)
    if (!r) return false
    const { data, ...rest } = patch
    if ('sourceHandle' in rest && !this.store.hasHandle(r.source, rest.sourceHandle)) return false
    if ('targetHandle' in rest && !this.store.hasHandle(r.target, rest.targetHandle)) return false
    if (data !== undefined) this.store.setEdgeData(r, data)
    const keys = Object.keys(rest) as (keyof EdgeState)[]
    if (!keys.length) {
      if (data !== undefined) this._emitChange()
      return true
    }
    const from: EdgeState = {}
    const current = r as unknown as Record<keyof EdgeState, unknown>
    for (const k of keys) (from as Record<string, unknown>)[k] = current[k]
    this.commit(new EdgeUpdateCommand(id, from, rest), options)
    return true
  }

  // ---------------------------------------------------------------- selection

  select(ids: Iterable<NodeId>, mode: SelectMode = 'replace'): void {
    const recs: NodeRecord[] = []
    for (const id of ids) {
      const r = this.store.getNode(id)
      if (r) recs.push(r)
    }
    this.store.setSelection(recs, [], mode)
  }

  selectEdges(ids: Iterable<EdgeId>, mode: SelectMode = 'replace'): void {
    const recs: EdgeRecord[] = []
    for (const id of ids) {
      const r = this.store.getEdge(id)
      if (r) recs.push(r)
    }
    this.store.setSelection([], recs, mode)
  }

  selectAll(): void {
    this.store.setSelection(this.store.nodes.values(), this.store.edges.values(), 'replace')
  }

  clearSelection(): void {
    if (this.store.selectedNodes.size || this.store.selectedEdges.size) {
      this.store.setSelection([], [], 'replace')
    }
  }

  // ---------------------------------------------------------------- clipboard

  copy(): number {
    const store = this.store
    const nodes = Array.from(store.selectedNodes, (n) => store.snapshotNode(n))
    const edges: EdgeSnapshot[] = []
    for (const n of store.selectedNodes) {
      for (const e of n.edges) {
        // only internal edges, each once (from its source side)
        if (e.source === n && store.selectedNodes.has(e.target)) edges.push(store.snapshotEdge(e))
      }
    }
    this.clipboard = nodes.length ? { nodes, edges } : null
    return nodes.length
  }

  paste(offset?: Vec3): NodeId[] {
    const clip = this.clipboard
    if (!clip) return []
    const step = this.snap || 1
    const d = offset ?? { x: step, y: 0, z: step }
    const map = new Map<NodeId, NodeId>()
    const nodes = clip.nodes.map((n) => {
      const id = createId('n')
      map.set(n.id, id)
      return {
        ...n,
        id,
        data: structuredCloneSafe(n.data),
        position: { x: n.position.x + d.x, y: n.position.y + d.y, z: n.position.z + d.z },
      }
    })
    const edges = clip.edges.map((e) => ({
      ...e,
      id: createId('e'),
      source: map.get(e.source)!,
      target: map.get(e.target)!,
      data: structuredCloneSafe(e.data),
    }))
    this.commit(new PatchCommand({ addNodes: nodes, addEdges: edges }, 'paste'))
    const ids = nodes.map((n) => n.id)
    this.select(ids)
    // shift clipboard so repeated pastes cascade instead of stacking
    this.clipboard = {
      nodes: nodes.map((n) => ({ ...n })),
      edges: edges.map((e) => ({ ...e })),
    }
    return ids
  }

  duplicate(offset?: Vec3): NodeId[] {
    const saved = this.clipboard
    if (!this.copy()) return []
    const ids = this.paste(offset)
    this.clipboard = saved
    return ids
  }

  // ---------------------------------------------------------------- history

  get canUndo(): boolean {
    return this.history.canUndo
  }

  get canRedo(): boolean {
    return this.history.canRedo
  }

  undo(): boolean {
    const ok = this.history.undo(this.store)
    if (ok) this._emitChange()
    return ok
  }

  redo(): boolean {
    const ok = this.history.redo(this.store)
    if (ok) this._emitChange()
    return ok
  }

  // ---------------------------------------------------------------- io

  toJSON(): GraphJSON {
    return { version: 2, nodes: this.getNodes(), edges: this.getEdges() }
  }

  /** Replaces the graph. Resets history. */
  fromJSON(json: GraphJSON): void {
    const store = this.store
    store.batch(() => {
      store.clear()
      for (const n of json.nodes) store.addNode(n)
      for (const e of json.edges) store.addEdge(e)
    })
    this.history.clear()
    this._emitChange()
  }

  // ---------------------------------------------------------------- view

  fitView(options?: FitViewOptions): void {
    this.view?.fitView(options)
  }

  /** @internal Called by the renderer. */
  _attachView(view: ViewApi): () => void {
    this.view = view
    return () => {
      if (this.view === view) this.view = null
    }
  }

  // ---------------------------------------------------------------- internals

  private commit(command: Command, options?: MutationOptions): void {
    if (options?.history === false) command.apply(this.store)
    else this.history.execute(command, this.store)
    this._emitChange()
  }

  private normalizeNode<D>(n: NodeInput<D>): NodeSnapshot<D> {
    return {
      id: n.id ?? createId('n'),
      type: n.type ?? this.store.defaultNodeType,
      position: { x: n.position.x, y: n.position.y, z: n.position.z },
      rotation: toQuat(n.rotation),
      color: n.color ?? this.store.defaultNodeColor,
      data: (n.data ?? {}) as D,
    }
  }

  private normalizeEdge<D>(e: EdgeInput<D>): EdgeSnapshot<D> {
    const out: EdgeSnapshot<D> = {
      id: e.id ?? createId('e'),
      source: e.source,
      target: e.target,
      color: e.color ?? this.store.defaultEdgeColor,
      data: (e.data ?? {}) as D,
    }
    if (e.sourceHandle !== undefined) out.sourceHandle = e.sourceHandle
    if (e.targetHandle !== undefined) out.targetHandle = e.targetHandle
    if (e.path !== undefined) out.path = e.path
    if (e.render !== undefined) out.render = e.render
    if (e.width !== undefined) out.width = e.width
    if (e.height !== undefined) out.height = e.height
    return out
  }
}

function structuredCloneSafe<T>(v: T): T {
  try {
    return structuredClone(v)
  } catch {
    return v
  }
}

/**
 * A live drag. Positions are written to typed arrays on every `update`, with
 * no history entries and no React work, then a single `MoveCommand` on `commit`.
 */
export class MoveSession {
  private readonly records: NodeRecord[]
  private readonly start: Float32Array
  private dx = 0
  private dy = 0
  private dz = 0
  private done = false

  constructor(
    private readonly flow: Flow,
    ids: NodeId[],
    anchor?: NodeId,
  ) {
    const store = flow.store
    const recs: NodeRecord[] = []
    for (const id of ids) {
      const r = store.getNode(id)
      if (r) recs.push(r)
    }
    // anchor first: it is the node aligned to the grid
    const a = anchor ? recs.findIndex((r) => r.id === anchor) : -1
    if (a > 0) recs.unshift(recs.splice(a, 1)[0])
    this.records = recs
    this.start = new Float32Array(recs.length * 3)
    recs.forEach((r, i) => {
      const P = r.bucket.positions
      this.start.set(P.subarray(r.slot * 3, r.slot * 3 + 3), i * 3)
    })
  }

  get size(): number {
    return this.records.length
  }

  update(dx: number, dy: number, dz: number): void {
    if (this.done || !this.records.length) return
    const snap = this.flow.snap
    if (snap > 0) {
      // snap the anchor's absolute position, shift everyone by the same delta
      const S = this.start
      dx = Math.round((S[0] + dx) / snap) * snap - S[0]
      dy = Math.round((S[1] + dy) / snap) * snap - S[1]
      dz = Math.round((S[2] + dz) / snap) * snap - S[2]
    }
    if (dx === this.dx && dy === this.dy && dz === this.dz) return
    this.dx = dx
    this.dy = dy
    this.dz = dz
    this.apply()
  }

  commit(): void {
    if (this.done) return
    this.done = true
    if (this.dx === 0 && this.dy === 0 && this.dz === 0) return
    const n = this.records.length
    const to = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      to[i * 3] = this.start[i * 3] + this.dx
      to[i * 3 + 1] = this.start[i * 3 + 1] + this.dy
      to[i * 3 + 2] = this.start[i * 3 + 2] + this.dz
    }
    const ids = this.records.map((r) => r.id)
    this.flow.history.push(new MoveCommand(ids, this.start, to))
    this.flow._emitChange()
  }

  cancel(): void {
    if (this.done) return
    this.dx = this.dy = this.dz = 0
    this.apply()
    this.done = true
  }

  private apply(): void {
    const store = this.flow.store
    const S = this.start
    const { dx, dy, dz } = this
    store.batch(() => {
      for (let i = 0; i < this.records.length; i++) {
        const o = i * 3
        store.setPosition(this.records[i], S[o] + dx, S[o + 1] + dy, S[o + 2] + dz)
      }
    })
  }
}

/**
 * A live rotation. `update(delta)` sets every node to `delta * start` (world-space
 * delta about each node's own center); one `RotateCommand` on `commit`.
 */
export class RotateSession {
  private readonly records: NodeRecord[]
  private readonly start: Float32Array
  private changed = false
  private done = false

  constructor(
    private readonly flow: Flow,
    ids: NodeId[],
  ) {
    const store = flow.store
    this.records = ids.map((id) => store.getNode(id)).filter((r): r is NodeRecord => !!r)
    this.start = new Float32Array(this.records.length * 4)
    this.records.forEach((r, i) => {
      this.start.set(r.bucket.rotations.subarray(r.slot * 4, r.slot * 4 + 4), i * 4)
    })
  }

  get size(): number {
    return this.records.length
  }

  update(delta: RotationInput): void {
    if (this.done) return
    const d = toQuat(delta)
    this.changed = true
    this.apply(d)
  }

  commit(): void {
    if (this.done) return
    this.done = true
    if (!this.changed) return
    const to = new Float32Array(this.records.length * 4)
    this.records.forEach((r, i) => {
      to.set(r.bucket.rotations.subarray(r.slot * 4, r.slot * 4 + 4), i * 4)
    })
    this.flow.history.push(new RotateCommand(this.records.map((r) => r.id), this.start, to))
    this.flow._emitChange()
  }

  cancel(): void {
    if (this.done) return
    this.apply(null)
    this.done = true
  }

  private apply(d: Quat | null): void {
    const store = this.flow.store
    const S = this.start
    store.batch(() => {
      for (let i = 0; i < this.records.length; i++) {
        const o = i * 4
        const q = { x: S[o], y: S[o + 1], z: S[o + 2], w: S[o + 3] }
        const r = d ? quatMultiply(d, q) : q
        store.setRotation(this.records[i], r.x, r.y, r.z, r.w)
      }
    })
  }
}

export function createFlow(options?: FlowOptions): Flow {
  return new Flow(options)
}

