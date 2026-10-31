import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Color, DynamicDrawUsage, Group, IcosahedronGeometry, InstancedMesh, MeshBasicMaterial } from 'three'
import { rotateVec } from '../core/quat'
import type { NodeRecord } from '../core/storage'
import { useFlowContext } from './context'

/** Currently highlighted connection point (set by the interaction layer). */
export interface ActiveHandle {
  node: NodeRecord | null
  handle: string | null
}

const _active = new Color()
const _base = new Color()
const _local = new Float64Array(3)

/**
 * Connection points as small instanced spheres, in one draw call. Shows the
 * handles of hovered/selected nodes (plus the connect source/target), or of
 * every node with `<Flow3D showHandles>`. Rewritten only on store `render` events.
 */
export function HandlesLayer() {
  const ctx = useFlowContext()
  const { flow, theme, showHandles } = ctx
  const store = flow.store
  const dirty = useRef(true)
  const capacity = useRef(64)

  const geometry = useMemo(() => new IcosahedronGeometry(1, 1), [])
  const material = useMemo(
    () => new MeshBasicMaterial({ color: 0xffffff, toneMapped: false, depthTest: true }),
    [],
  )
  const meshRef = useRef<InstancedMesh | null>(null)
  const group = useMemo(() => {
    const g = new Group()
    g.name = 'xyzflow:handles'
    return g
  }, [])

  const ensure = (n: number): InstancedMesh => {
    let mesh = meshRef.current
    if (!mesh || n > capacity.current) {
      while (capacity.current < n) capacity.current *= 2
      const next = new InstancedMesh(geometry, material, capacity.current)
      next.instanceMatrix.setUsage(DynamicDrawUsage)
      next.setColorAt(0, _base) // allocates instanceColor
      next.frustumCulled = false
      next.matrixAutoUpdate = false
      next.renderOrder = 5
      next.name = 'xyzflow:handles'
      next.raycast = () => {}
      if (mesh) {
        group.remove(mesh)
        mesh.dispose()
      }
      group.add(next)
      meshRef.current = next
      mesh = next
    }
    return mesh
  }

  useEffect(() => {
    const mark = () => {
      dirty.current = true
    }
    mark()
    const off = store.on('render', mark)
    ctx.onActiveHandleChange = mark
    return () => {
      off()
      if (ctx.onActiveHandleChange === mark) ctx.onActiveHandleChange = null
    }
  }, [ctx, store, showHandles, theme])

  useEffect(
    () => () => {
      meshRef.current?.dispose()
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  useFrame(() => {
    if (!dirty.current) return
    dirty.current = false

    // which nodes show their handles
    const nodes: NodeRecord[] = []
    if (showHandles) {
      for (const b of store.buckets) {
        if (!b.handles) continue
        for (let i = 0; i < b.count; i++) nodes.push(b.records[i])
      }
    } else {
      const seen = new Set<NodeRecord>()
      const add = (n: NodeRecord | null | undefined) => {
        if (n && n.slot >= 0 && n.bucket.handles && !seen.has(n)) {
          seen.add(n)
          nodes.push(n)
        }
      }
      add(store.hovered)
      for (const n of store.selectedNodes) add(n)
      add(ctx.activeHandle.node)
    }

    let total = 0
    for (const n of nodes) total += n.bucket.handles!.ids.length
    const mesh = ensure(Math.max(1, total))
    const M = mesh.instanceMatrix.array as Float32Array
    const C = mesh.instanceColor!.array as Float32Array
    _base.setHex(theme.handleColor)
    _active.setHex(theme.handleActiveColor)
    const active = ctx.activeHandle

    let k = 0
    for (const n of nodes) {
      const table = n.bucket.handles!
      const P = n.bucket.positions
      const R = n.bucket.rotations
      for (let h = 0; h < table.ids.length; h++) {
        // world position = node pos + q * local
        const lx = table.positions[h * 3], ly = table.positions[h * 3 + 1], lz = table.positions[h * 3 + 2]
        rotateVec(R, n.slot * 4, lx, ly, lz, _local, 0)
        const r = table.radii[h]
        const m = k * 16
        M[m] = r; M[m + 1] = 0; M[m + 2] = 0; M[m + 3] = 0
        M[m + 4] = 0; M[m + 5] = r; M[m + 6] = 0; M[m + 7] = 0
        M[m + 8] = 0; M[m + 9] = 0; M[m + 10] = r; M[m + 11] = 0
        M[m + 12] = P[n.slot * 3] + _local[0]
        M[m + 13] = P[n.slot * 3 + 1] + _local[1]
        M[m + 14] = P[n.slot * 3 + 2] + _local[2]
        M[m + 15] = 1
        const c = active.node === n && active.handle === table.ids[h] ? _active : _base
        C[k * 3] = c.r; C[k * 3 + 1] = c.g; C[k * 3 + 2] = c.b
        k++
      }
    }
    mesh.count = k
    mesh.instanceMatrix.needsUpdate = true
    mesh.instanceColor!.needsUpdate = true
  })

  return <primitive object={group} />
}
