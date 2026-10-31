import type { ComponentType } from 'react'
import {
  BoxGeometry,
  IcosahedronGeometry,
  MeshStandardMaterial,
  type BufferGeometry,
  type Material,
} from 'three'
import { createHandleTable, type HandleSpec, type HandleTable } from '../core/storage'
import type { NodeId } from '../core/types'

/**
 * A connection point on a node, in node-local space (it follows the node's
 * rotation). `direction` is the outward normal a curved connector leaves along
 * (default: from the center through `position`).
 */
export type HandleDef = HandleSpec

interface WithHandles {
  /** Connection points. Omit for a single center connection point. */
  handles?: HandleDef[]
  /** @internal compiled from `handles` */
  handleTable?: HandleTable | null
}

/**
 * GPU-instanced node type: one draw call for every node of this type.
 * Use for anything that can share a geometry + material (10k–100k+ nodes).
 */
export interface InstancedNodeType extends WithHandles {
  kind: 'instanced'
  geometry: BufferGeometry
  /** Material color is multiplied by the per-node color, so keep it white. */
  material: Material
  /** Bounding-sphere radius used for picking. */
  radius: number
}

export interface CustomNodeProps<D = any> {
  id: NodeId
  data: D
  selected: boolean
  hovered: boolean
}

/**
 * Arbitrary R3F component per node (GLTF, text, rich UI). One React subtree
 * per node, so keep these to hundreds rather than tens of thousands.
 */
export interface CustomNodeType<D = any> extends WithHandles {
  kind: 'custom'
  component: ComponentType<CustomNodeProps<D>>
  radius: number
}

export type NodeType = InstancedNodeType | CustomNodeType
export type NodeTypes = Record<string, NodeType>

export function instancedNode(options: {
  geometry: BufferGeometry
  material?: Material
  radius?: number
  handles?: HandleDef[]
}): InstancedNodeType {
  const geometry = options.geometry
  const radius: number = options.radius ?? boundingRadius(geometry)
  return {
    kind: 'instanced',
    geometry,
    material:
      options.material ?? new MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.05 }),
    radius,
    handles: options.handles,
    handleTable: options.handles?.length ? createHandleTable(options.handles) : null,
  }
}

/** Compiled handle table of a node type (cached on the definition). */
export function getHandleTable(def: NodeType): HandleTable | null {
  if (def.handleTable === undefined) {
    def.handleTable = def.handles?.length ? createHandleTable(def.handles) : null
  }
  return def.handleTable
}

/** One handle at the center of each face of a `w × h × d` box: `+x -x +y -y +z -z`. */
export function boxHandles(w: number, h = w, d = w, radius?: number): HandleDef[] {
  const x = w / 2, y = h / 2, z = d / 2
  return [
    { id: '+x', position: { x, y: 0, z: 0 }, radius },
    { id: '-x', position: { x: -x, y: 0, z: 0 }, radius },
    { id: '+y', position: { x: 0, y, z: 0 }, radius },
    { id: '-y', position: { x: 0, y: -y, z: 0 }, radius },
    { id: '+z', position: { x: 0, y: 0, z }, radius },
    { id: '-z', position: { x: 0, y: 0, z: -z }, radius },
  ]
}

function boundingRadius(geometry: BufferGeometry): number {
  if (!geometry.boundingSphere) geometry.computeBoundingSphere()
  return geometry.boundingSphere?.radius ?? 0.5
}

export function customNode<D = any>(
  component: ComponentType<CustomNodeProps<D>>,
  options: { radius?: number; handles?: HandleDef[] } = {},
): CustomNodeType<D> {
  return {
    kind: 'custom',
    component,
    radius: options.radius ?? 0.5,
    handles: options.handles,
    handleTable: options.handles?.length ? createHandleTable(options.handles) : null,
  }
}

let defaults: NodeTypes | null = null

/**
 * Built-in types, created lazily and shared:
 * `default` (box, handles on the 6 faces `+x -x +y -y +z -z`) and
 * `sphere` (handles `in` on -X, `out` on +X).
 * Edges without handles still attach to the node center.
 */
export function getDefaultNodeTypes(): NodeTypes {
  if (!defaults) {
    defaults = {
      default: instancedNode({
        geometry: new BoxGeometry(0.8, 0.8, 0.8),
        radius: 0.55,
        handles: boxHandles(0.8),
      }),
      sphere: instancedNode({
        geometry: new IcosahedronGeometry(0.45, 2),
        radius: 0.45,
        handles: [
          { id: 'in', position: { x: -0.45, y: 0, z: 0 } },
          { id: 'out', position: { x: 0.45, y: 0, z: 0 } },
        ],
      }),
    }
  }
  return defaults
}
