export interface Vec3 {
  x: number
  y: number
  z: number
}

/** Unit quaternion (same layout as three's `Quaternion`). */
export interface Quat {
  x: number
  y: number
  z: number
  w: number
}

/** Euler angles in radians, XYZ order (same as three's default). */
export type EulerTuple = [x: number, y: number, z: number]

/** A rotation given either as a quaternion or as XYZ Euler angles (radians). */
export type RotationInput = Quat | EulerTuple

/** Path a connector follows between its two endpoints. */
export type EdgePath = 'straight' | 'bezier'

/** How a connector is drawn: a 1px line, or a 3D mesh tube with a width/height cross-section. */
export type EdgeRender = 'line' | 'tube'

export type NodeId = string
export type EdgeId = string

/** Hex color, e.g. `0xff8800`. Stored internally as linear-space floats. */
export type HexColor = number

export interface NodeInput<D = unknown> {
  id?: NodeId
  /** Node type key (matches a key of `nodeTypes`). Defaults to `"default"`. */
  type?: string
  position: Vec3
  /** Independent orientation of this node (default: identity). */
  rotation?: RotationInput
  color?: HexColor
  data?: D
}

/** Per-connector shape options. Unset fields fall back to `<Flow3D>` defaults. */
export interface EdgeShape {
  /** Connection point on the source node (a handle id of its node type). Omit for node center. */
  sourceHandle?: string
  /** Connection point on the target node. Omit for node center. */
  targetHandle?: string
  path?: EdgePath
  render?: EdgeRender
  /** Tube cross-section width (world units). */
  width?: number
  /** Tube cross-section height (world units, default = width). */
  height?: number
}

export interface EdgeInput<D = unknown> extends EdgeShape {
  id?: EdgeId
  source: NodeId
  target: NodeId
  color?: HexColor
  data?: D
}

/** Plain, serializable view of a node. */
export interface NodeSnapshot<D = unknown> {
  id: NodeId
  type: string
  position: Vec3
  rotation: Quat
  color: HexColor
  data: D
}

/** Plain, serializable view of an edge. */
export interface EdgeSnapshot<D = unknown> extends EdgeShape {
  id: EdgeId
  source: NodeId
  target: NodeId
  color: HexColor
  data: D
}

/** Node entry of `GraphJSON`: a snapshot whose `rotation` may be omitted (v1) or given as Euler. */
export type NodeJSON<D = unknown> = Omit<NodeSnapshot<D>, 'rotation'> & { rotation?: RotationInput }

export interface GraphJSON {
  /** `2` adds node rotation and edge handles/shape; `1` is still accepted by `fromJSON`. */
  version: 1 | 2
  nodes: NodeJSON[]
  edges: EdgeSnapshot[]
}

export interface Connection {
  source: NodeId
  target: NodeId
  sourceHandle?: string
  targetHandle?: string
}

export type SelectMode = 'replace' | 'add' | 'toggle' | 'remove'

export interface Bounds {
  min: Vec3
  max: Vec3
}
