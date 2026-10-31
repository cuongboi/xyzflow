import type { GraphStore } from './graph-store'
import type { EdgeId, EdgeShape, EdgeSnapshot, HexColor, NodeId, NodeSnapshot } from './types'

export interface Command {
  readonly label: string
  apply(store: GraphStore): void
  revert(store: GraphStore): void
}

/** A reversible structural diff. Add/remove/paste/duplicate/clear are all patches. */
export interface GraphPatch {
  addNodes?: NodeSnapshot[]
  addEdges?: EdgeSnapshot[]
  removeNodes?: NodeSnapshot[]
  removeEdges?: EdgeSnapshot[]
}

const EMPTY: never[] = []

function run(
  store: GraphStore,
  removeEdges: EdgeSnapshot[],
  removeNodes: NodeSnapshot[],
  addNodes: NodeSnapshot[],
  addEdges: EdgeSnapshot[],
): void {
  store.batch(() => {
    for (const e of removeEdges) store.removeEdge(e.id)
    for (const n of removeNodes) store.removeNode(n.id)
    for (const n of addNodes) store.addNode(n)
    for (const e of addEdges) store.addEdge(e)
  })
}

export class PatchCommand implements Command {
  constructor(
    readonly patch: GraphPatch,
    readonly label = 'patch',
  ) {}

  apply(store: GraphStore): void {
    const p = this.patch
    run(store, p.removeEdges ?? EMPTY, p.removeNodes ?? EMPTY, p.addNodes ?? EMPTY, p.addEdges ?? EMPTY)
  }

  revert(store: GraphStore): void {
    const p = this.patch
    run(store, p.addEdges ?? EMPTY, p.addNodes ?? EMPTY, p.removeNodes ?? EMPTY, p.removeEdges ?? EMPTY)
  }
}

/** Positions packed as xyz triplets: one allocation per move regardless of node count. */
export class MoveCommand implements Command {
  readonly label = 'move'

  constructor(
    readonly ids: NodeId[],
    readonly from: Float32Array,
    readonly to: Float32Array,
  ) {}

  apply(store: GraphStore): void {
    this.write(store, this.to)
  }

  revert(store: GraphStore): void {
    this.write(store, this.from)
  }

  private write(store: GraphStore, src: Float32Array): void {
    store.batch(() => {
      for (let i = 0; i < this.ids.length; i++) {
        const rec = store.getNode(this.ids[i])
        if (rec) store.setPosition(rec, src[i * 3], src[i * 3 + 1], src[i * 3 + 2])
      }
    })
  }
}

/** Quaternions packed as xyzw quads: the rotation counterpart of `MoveCommand`. */
export class RotateCommand implements Command {
  readonly label = 'rotate'

  constructor(
    readonly ids: NodeId[],
    readonly from: Float32Array,
    readonly to: Float32Array,
  ) {}

  apply(store: GraphStore): void {
    this.write(store, this.to)
  }

  revert(store: GraphStore): void {
    this.write(store, this.from)
  }

  private write(store: GraphStore, src: Float32Array): void {
    store.batch(() => {
      for (let i = 0; i < this.ids.length; i++) {
        const rec = store.getNode(this.ids[i])
        const o = i * 4
        if (rec) store.setRotation(rec, src[o], src[o + 1], src[o + 2], src[o + 3])
      }
    })
  }
}

export interface EdgeState extends EdgeShape {
  color?: HexColor
}

/** In-place edge edit (handles, path, render, size, color). Keeps the edge's slot and selection. */
export class EdgeUpdateCommand implements Command {
  readonly label = 'update-edge'

  constructor(
    readonly id: EdgeId,
    readonly from: EdgeState,
    readonly to: EdgeState,
  ) {}

  apply(store: GraphStore): void {
    this.write(store, this.to)
  }

  revert(store: GraphStore): void {
    this.write(store, this.from)
  }

  private write(store: GraphStore, state: EdgeState): void {
    const rec = store.getEdge(this.id)
    if (!rec) return
    store.batch(() => {
      const { color, ...shape } = state
      if (color !== undefined) store.setEdgeColor(rec, color)
      if (Object.keys(shape).length) store.setEdgeShape(rec, shape)
    })
  }
}

export class History {
  private undoStack: Command[] = []
  private redoStack: Command[] = []

  constructor(
    public limit = 200,
    private onChange?: () => void,
  ) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  execute(command: Command, store: GraphStore): void {
    command.apply(store)
    this.push(command)
  }

  /** Records a command whose effect is already applied (e.g. a finished drag). */
  push(command: Command): void {
    this.undoStack.push(command)
    if (this.undoStack.length > this.limit) this.undoStack.shift()
    this.redoStack.length = 0
    this.onChange?.()
  }

  undo(store: GraphStore): boolean {
    const cmd = this.undoStack.pop()
    if (!cmd) return false
    cmd.revert(store)
    this.redoStack.push(cmd)
    this.onChange?.()
    return true
  }

  redo(store: GraphStore): boolean {
    const cmd = this.redoStack.pop()
    if (!cmd) return false
    cmd.apply(store)
    this.undoStack.push(cmd)
    this.onChange?.()
    return true
  }

  clear(): void {
    this.undoStack.length = 0
    this.redoStack.length = 0
    this.onChange?.()
  }
}
