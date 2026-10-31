import { useFrame } from '@react-three/fiber'
import { memo, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, type Group } from 'three'
import type { GraphStore } from '../core/graph-store'
import { NODE_HOVERED, NODE_SELECTED, type NodeBucket, type NodeRecord } from '../core/storage'
import { useFlowContext } from './context'
import type { CustomNodeType, InstancedNodeType } from './node-types'
import type { ResolvedTheme } from './theme'

function useStoreValue<T>(store: GraphStore, events: ('structure' | 'selection' | 'hover' | 'data')[], get: () => T): T {
  const subscribe = useCallback(
    (cb: () => void) => {
      const offs = events.map((e) => store.on(e, cb))
      return () => offs.forEach((off) => off())
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, events.join()],
  )
  return useSyncExternalStore(subscribe, get, get)
}

/** Renders one bucket per node type. Re-renders only when a new type appears. */
export function NodesLayer() {
  const { flow, nodeTypes } = useFlowContext()
  const store = flow.store
  useStoreValue(store, ['structure'], () => store.bucketListVersion)
  return (
    <>
      {store.buckets.map((bucket) => {
        const def = nodeTypes[bucket.type] ?? nodeTypes.default
        if (!def) return null
        return def.kind === 'custom' ? (
          <CustomBucket key={bucket.type} bucket={bucket} def={def} />
        ) : (
          <InstancedBucket key={bucket.type} bucket={bucket} def={def} />
        )
      })}
    </>
  )
}

// ------------------------------------------------------------------ instanced

const InstancedBucket = memo(function InstancedBucket({
  bucket,
  def,
}: {
  bucket: NodeBucket
  def: InstancedNodeType
}) {
  const { flow, theme } = useFlowContext()
  // Re-create the mesh only when typed arrays were reallocated (amortized, ×2 growth).
  const capacityVersion = useStoreValue(flow.store, ['structure'], () => bucket.capacityVersion)

  const mesh = useMemo(() => {
    const cap = bucket.capacity
    const m = new InstancedMesh(def.geometry, def.material, cap)
    m.instanceMatrix.setUsage(DynamicDrawUsage)
    m.instanceColor = new InstancedBufferAttribute(new Float32Array(cap * 3), 3)
    m.instanceColor.setUsage(DynamicDrawUsage)
    m.count = 0
    m.frustumCulled = false // per-instance bounds would cost O(n) per moved frame
    m.matrixAutoUpdate = false
    m.name = `xyzflow:${bucket.type}`
    m.raycast = () => {} // picking is analytic on the store, never three's raycaster
    bucket.dirty.markAll()
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket, def, capacityVersion])

  useEffect(() => () => {
    mesh.dispose()
  }, [mesh]) // frees instance buffers; geometry/material are shared

  useFrame(() => flushBucket(bucket, mesh, theme))

  return <primitive object={mesh} />
})

/**
 * Uploads only dirty slots. Matrices are written by hand (rotation quaternion +
 * uniform scale + translation), so no Object3D/Matrix4 work. One contiguous GPU sub-upload per frame.
 */
function flushBucket(bucket: NodeBucket, mesh: InstancedMesh, theme: ResolvedTheme): void {
  if (mesh.count !== bucket.count) mesh.count = bucket.count
  const dirty = bucket.dirty
  if (dirty.isEmpty) return
  const count = bucket.count
  const M = mesh.instanceMatrix.array as Float32Array
  const C = mesh.instanceColor!.array as Float32Array
  const P = bucket.positions
  const Q = bucket.rotations
  const BC = bucket.colors
  const F = bucket.flags
  const sel = theme.linear.selected
  const mix = theme.hoverMix
  const hoverScale = theme.hoverScale

  const write = (i: number) => {
    const f = F[i]
    const s = f & NODE_HOVERED ? hoverScale : 1
    const m = i * 16
    const p = i * 3
    const q = i * 4
    const x = Q[q], y = Q[q + 1], z = Q[q + 2], w = Q[q + 3]
    const x2 = x + x, y2 = y + y, z2 = z + z
    const xx = x * x2, xy = x * y2, xz = x * z2
    const yy = y * y2, yz = y * z2, zz = z * z2
    const wx = w * x2, wy = w * y2, wz = w * z2
    M[m] = (1 - (yy + zz)) * s; M[m + 1] = (xy + wz) * s; M[m + 2] = (xz - wy) * s; M[m + 3] = 0
    M[m + 4] = (xy - wz) * s; M[m + 5] = (1 - (xx + zz)) * s; M[m + 6] = (yz + wx) * s; M[m + 7] = 0
    M[m + 8] = (xz + wy) * s; M[m + 9] = (yz - wx) * s; M[m + 10] = (1 - (xx + yy)) * s; M[m + 11] = 0
    M[m + 12] = P[p]; M[m + 13] = P[p + 1]; M[m + 14] = P[p + 2]; M[m + 15] = 1
    let r: number, g: number, b: number
    if (f & NODE_SELECTED) {
      r = sel[0]; g = sel[1]; b = sel[2]
    } else {
      r = BC[p]; g = BC[p + 1]; b = BC[p + 2]
    }
    if (f & NODE_HOVERED) {
      r += (1 - r) * mix; g += (1 - g) * mix; b += (1 - b) * mix
    }
    C[p] = r; C[p + 1] = g; C[p + 2] = b
  }

  const im = mesh.instanceMatrix
  const ic = mesh.instanceColor!
  im.clearUpdateRanges()
  ic.clearUpdateRanges()

  if (dirty.all) {
    for (let i = 0; i < count; i++) write(i)
  } else {
    let min = Infinity
    let max = -1
    const list = dirty.list
    for (let k = 0; k < dirty.size; k++) {
      const i = list[k]
      if (i >= count) continue // slot freed by a swap-remove: nothing to draw
      write(i)
      if (i < min) min = i
      if (i > max) max = i
    }
    if (max >= 0) {
      im.addUpdateRange(min * 16, (max - min + 1) * 16)
      ic.addUpdateRange(min * 3, (max - min + 1) * 3)
    }
  }
  im.needsUpdate = true
  ic.needsUpdate = true
  dirty.clear()
}

// ------------------------------------------------------------------ custom

const CustomBucket = memo(function CustomBucket({
  bucket,
  def,
}: {
  bucket: NodeBucket
  def: CustomNodeType
}) {
  const { flow } = useFlowContext()
  const version = useStoreValue(flow.store, ['structure'], () => bucket.version)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const records = useMemo(() => bucket.records.slice(0, bucket.count), [bucket, version])
  return (
    <>
      {records.map((record) => (
        <CustomNodeHost key={record.id} record={record} def={def} />
      ))}
    </>
  )
})

const CustomNodeHost = memo(function CustomNodeHost({
  record,
  def,
}: {
  record: NodeRecord
  def: CustomNodeType
}) {
  const { flow } = useFlowContext()
  const store = flow.store
  const ref = useRef<Group>(null)
  const flags = useStoreValue(store, ['selection', 'hover'], () =>
    record.slot >= 0 ? record.bucket.flags[record.slot] : 0,
  )
  const data = useStoreValue(store, ['data'], () => record.data)

  // Transform is copied from the typed arrays each frame: zero React work while dragging.
  useFrame(() => {
    const g = ref.current
    if (!g || record.slot < 0) return
    const P = record.bucket.positions
    const o = record.slot * 3
    if (g.position.x !== P[o] || g.position.y !== P[o + 1] || g.position.z !== P[o + 2]) {
      g.position.set(P[o], P[o + 1], P[o + 2])
    }
    const Q = record.bucket.rotations
    const q = record.slot * 4
    const gq = g.quaternion
    if (gq.x !== Q[q] || gq.y !== Q[q + 1] || gq.z !== Q[q + 2] || gq.w !== Q[q + 3]) {
      gq.set(Q[q], Q[q + 1], Q[q + 2], Q[q + 3])
    }
  })

  const Component = def.component
  return (
    <group ref={ref}>
      <Component
        id={record.id}
        data={data}
        selected={(flags & NODE_SELECTED) !== 0}
        hovered={(flags & NODE_HOVERED) !== 0}
      />
    </group>
  )
})
