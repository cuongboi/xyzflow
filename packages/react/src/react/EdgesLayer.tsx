import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
} from 'three'
import { NODE_SELECTED, EDGE_SELECTED, type EdgeRecord, type EdgeTable } from '../core/storage'
import type { Vec3 } from '../core/types'
import { useFlowContext } from './context'
import {
  createBezierBasis,
  createTubeIndex,
  createTubeProfile,
  sampleCurve,
  sampleEdge,
  scratchSamples,
  writeLineFromSamples,
  writeTube,
  type EdgeDefaults,
  type TubeProfile,
} from './curve'
import type { ResolvedTheme } from './theme'

function useEdgeTable() {
  const { flow } = useFlowContext()
  const store = flow.store
  const table = store.edgeTable
  const subscribe = useCallback((cb: () => void) => store.on('structure', cb), [store])
  const capacityVersion = useSyncExternalStore(
    subscribe,
    () => table.capacityVersion,
    () => table.capacityVersion,
  )
  return { store, table, capacityVersion }
}

/** Resolved color of edge slot `i` (selection > endpoint selected > own color). */
function edgeColor(table: EdgeTable, e: EdgeRecord, i: number, theme: ResolvedTheme, out: number[]): void {
  if (table.flags[i] & EDGE_SELECTED) {
    const c = theme.linear.edgeSelected
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2]
  } else if (
    (e.source.bucket.flags[e.source.slot] & NODE_SELECTED) !== 0 ||
    (e.target.bucket.flags[e.target.slot] & NODE_SELECTED) !== 0
  ) {
    const c = theme.linear.edgeActive
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2]
  } else {
    const C = table.colors
    out[0] = C[i * 3]; out[1] = C[i * 3 + 1]; out[2] = C[i * 3 + 2]
  }
}

const _rgb = [0, 0, 0]

/**
 * Walks dirty edge slots, calling `write(i)` for each, and returns the
 * touched slot range (or `null`). Shared by the line and tube layers, which
 * read the same dirty set, so only the last flush of a frame clears it.
 */
function forDirty(table: EdgeTable, write: (i: number) => void): [number, number] | null {
  const dirty = table.dirty
  const count = table.count
  if (dirty.all) {
    for (let i = 0; i < count; i++) write(i)
    return count ? [0, count - 1] : null
  }
  let min = Infinity
  let max = -1
  for (let k = 0; k < dirty.size; k++) {
    const i = dirty.list[k]
    if (i >= count) continue
    write(i)
    if (i < min) min = i
    if (i > max) max = i
  }
  return max >= 0 ? [min, max] : null
}

// ------------------------------------------------------------------ lines

/**
 * Every line edge in ONE `LineSegments` draw call. Each edge owns a fixed block
 * of `segments * 2` vertices; tube edges collapse their block to a point.
 * A moved node rewrites only its adjacent edges and uploads one sub-range.
 */
export function EdgesLayer({ tubes }: { tubes: boolean }) {
  const ctx = useFlowContext()
  const { theme, edgeDefaults } = ctx
  const { table, capacityVersion } = useEdgeTable()
  const segments = Math.max(1, ctx.edgeSegments | 0)

  const basis = useMemo(() => createBezierBasis(segments), [segments])

  const lines = useMemo(() => {
    const verts = table.capacity * segments * 2
    const geometry = new BufferGeometry()
    const position = new BufferAttribute(new Float32Array(verts * 3), 3)
    position.setUsage(DynamicDrawUsage)
    const color = new BufferAttribute(new Float32Array(verts * 3), 3)
    color.setUsage(DynamicDrawUsage)
    geometry.setAttribute('position', position)
    geometry.setAttribute('color', color)
    geometry.setDrawRange(0, 0)
    const material = new LineBasicMaterial({ vertexColors: true, toneMapped: false })
    const obj = new LineSegments(geometry, material)
    obj.frustumCulled = false
    obj.matrixAutoUpdate = false
    obj.name = 'xyzflow:edges'
    table.dirty.markAll()
    return obj
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, segments, capacityVersion])

  useEffect(() => {
    ctx.edgeObject = lines
    return () => {
      if (ctx.edgeObject === lines) ctx.edgeObject = null
      lines.geometry.dispose()
      ;(lines.material as LineBasicMaterial).dispose()
    }
  }, [ctx, lines])

  // force full rewrite when curve settings change
  useEffect(() => table.dirty.markAll(), [table, edgeDefaults, segments])

  // when the tube layer is mounted it flushes after us and clears the dirty set
  useFrame(() => flushLines(table, lines, basis, segments, edgeDefaults, theme, !tubes))

  return <primitive object={lines} />
}

function flushLines(
  table: EdgeTable,
  lines: LineSegments,
  basis: Float32Array,
  segments: number,
  defaults: EdgeDefaults,
  theme: ResolvedTheme,
  clear: boolean,
): void {
  const geometry = lines.geometry
  const vpe = segments * 2 // vertices per edge
  geometry.drawRange.count = table.count * vpe
  const dirty = table.dirty
  if (dirty.isEmpty) return

  const posAttr = geometry.getAttribute('position') as BufferAttribute
  const colAttr = geometry.getAttribute('color') as BufferAttribute
  const POS = posAttr.array as Float32Array
  const COL = colAttr.array as Float32Array
  const samples = scratchSamples(segments)

  const write = (i: number) => {
    const e = table.records[i]
    sampleEdge(e, defaults, basis, segments, samples)
    const o0 = i * vpe * 3
    if ((e.render ?? defaults.render) === 'tube') {
      // collapse to the start point: invisible, and only pickable where the tube is
      for (let v = 0, o = o0; v < vpe; v++, o += 3) {
        POS[o] = samples[0]; POS[o + 1] = samples[1]; POS[o + 2] = samples[2]
      }
    } else {
      writeLineFromSamples(POS, o0, samples, segments)
    }
    edgeColor(table, e, i, theme, _rgb)
    for (let v = 0, o = o0; v < vpe; v++, o += 3) {
      COL[o] = _rgb[0]; COL[o + 1] = _rgb[1]; COL[o + 2] = _rgb[2]
    }
  }

  posAttr.clearUpdateRanges()
  colAttr.clearUpdateRanges()
  const range = forDirty(table, write)
  if (range && !dirty.all) {
    const start = range[0] * vpe * 3
    const len = (range[1] - range[0] + 1) * vpe * 3
    posAttr.addUpdateRange(start, len)
    colAttr.addUpdateRange(start, len)
  }
  posAttr.needsUpdate = true
  colAttr.needsUpdate = true
  geometry.boundingSphere = null // recomputed lazily, only if an edge is click-picked
  if (clear) dirty.clear()
}

// ------------------------------------------------------------------ tubes

/**
 * Every tube edge in ONE indexed mesh draw call. Each edge owns
 * `(segments + 1) × radial` vertices (line edges collapse to a point), swept
 * with an elliptical/rectangular `width × height` cross-section.
 * Mounted by `<Flow3D>` only when some edge renders as a tube.
 */
export function EdgeTubesLayer() {
  const ctx = useFlowContext()
  const { theme, edgeDefaults, tubeShape, tubeRadialSegments } = ctx
  const { table, capacityVersion } = useEdgeTable()
  const segments = Math.max(1, ctx.edgeSegments | 0)

  const basis = useMemo(() => createBezierBasis(segments), [segments])
  const profile = useMemo(
    () => createTubeProfile(tubeShape, tubeRadialSegments),
    [tubeShape, tubeRadialSegments],
  )

  const material = useMemo(
    () => new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.1 }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])

  const mesh = useMemo(() => {
    const vpe = (segments + 1) * profile.radial
    const verts = table.capacity * vpe
    const geometry = new BufferGeometry()
    for (const name of ['position', 'normal', 'color']) {
      const attr = new BufferAttribute(new Float32Array(verts * 3), 3)
      attr.setUsage(DynamicDrawUsage)
      geometry.setAttribute(name, attr)
    }
    geometry.setIndex(new BufferAttribute(createTubeIndex(table.capacity, segments, profile.radial), 1))
    geometry.setDrawRange(0, 0)
    const obj = new Mesh(geometry, material)
    obj.frustumCulled = false
    obj.matrixAutoUpdate = false
    obj.name = 'xyzflow:edge-tubes'
    obj.userData.radial = profile.radial // for face -> edge lookup when picking
    table.dirty.markAll()
    return obj
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, segments, profile, material, capacityVersion])

  useEffect(() => {
    ctx.tubeObject = mesh
    return () => {
      if (ctx.tubeObject === mesh) ctx.tubeObject = null
      mesh.geometry.dispose()
    }
  }, [ctx, mesh])

  useEffect(() => table.dirty.markAll(), [table, edgeDefaults, segments, profile])

  // runs after EdgesLayer's flush (mounted later), so it owns clearing the dirty set
  useFrame(() => flushTubes(table, mesh, basis, segments, profile, edgeDefaults, theme))

  return <primitive object={mesh} />
}

function flushTubes(
  table: EdgeTable,
  mesh: Mesh,
  basis: Float32Array,
  segments: number,
  profile: TubeProfile,
  defaults: EdgeDefaults,
  theme: ResolvedTheme,
): void {
  const geometry = mesh.geometry
  const vpe = (segments + 1) * profile.radial
  geometry.drawRange.count = table.count * segments * profile.radial * 6
  const dirty = table.dirty
  if (dirty.isEmpty) return

  const posAttr = geometry.getAttribute('position') as BufferAttribute
  const nrmAttr = geometry.getAttribute('normal') as BufferAttribute
  const colAttr = geometry.getAttribute('color') as BufferAttribute
  const POS = posAttr.array as Float32Array
  const NRM = nrmAttr.array as Float32Array
  const COL = colAttr.array as Float32Array
  const samples = scratchSamples(segments)

  const write = (i: number) => {
    const e = table.records[i]
    sampleEdge(e, defaults, basis, segments, samples)
    const v0 = i * vpe
    if ((e.render ?? defaults.render) === 'tube') {
      const w = e.width ?? defaults.width
      const h = e.height ?? e.width ?? defaults.height
      writeTube(POS, NRM, v0, samples, segments, profile, w, h)
    } else {
      // zero-area triangles: not drawn, never hit by the raycaster
      for (let v = 0, o = v0 * 3; v < vpe; v++, o += 3) {
        POS[o] = samples[0]; POS[o + 1] = samples[1]; POS[o + 2] = samples[2]
        NRM[o] = 0; NRM[o + 1] = 1; NRM[o + 2] = 0
      }
    }
    edgeColor(table, e, i, theme, _rgb)
    for (let v = 0, o = v0 * 3; v < vpe; v++, o += 3) {
      COL[o] = _rgb[0]; COL[o + 1] = _rgb[1]; COL[o + 2] = _rgb[2]
    }
  }

  posAttr.clearUpdateRanges()
  nrmAttr.clearUpdateRanges()
  colAttr.clearUpdateRanges()
  const range = forDirty(table, write)
  if (range && !dirty.all) {
    const start = range[0] * vpe * 3
    const len = (range[1] - range[0] + 1) * vpe * 3
    posAttr.addUpdateRange(start, len)
    nrmAttr.addUpdateRange(start, len)
    colAttr.addUpdateRange(start, len)
  }
  posAttr.needsUpdate = true
  nrmAttr.needsUpdate = true
  colAttr.needsUpdate = true
  geometry.boundingSphere = null
  geometry.boundingBox = null
  dirty.clear()
}

// ------------------------------------------------------------------ preview

/** Temporary curve shown while dragging a new connection. */
export function ConnectionPreview() {
  const ctx = useFlowContext()
  const invalidate = useThree((s) => s.invalidate)
  const segments = Math.max(1, ctx.edgeSegments | 0)

  const { lines, basis } = useMemo(() => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(segments * 6), 3))
    const material = new LineBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.9 })
    material.color.setHex(ctx.theme.previewColor)
    const obj = new LineSegments(geometry, material)
    obj.visible = false
    obj.frustumCulled = false
    obj.renderOrder = 10
    return { lines: obj, basis: createBezierBasis(segments) }
  }, [segments, ctx.theme])

  useEffect(() => {
    ctx.preview = {
      show(a: Vec3, b: Vec3, ad?: Vec3, bd?: Vec3) {
        const attr = lines.geometry.getAttribute('position') as BufferAttribute
        const samples = scratchSamples(segments)
        const d = ctx.edgeDefaults
        sampleCurve(
          samples, basis, segments, d.path, d.curvature,
          a.x, a.y, a.z, ad?.x ?? 1, ad?.y ?? 0, ad?.z ?? 0,
          b.x, b.y, b.z, bd?.x ?? -1, bd?.y ?? 0, bd?.z ?? 0,
        )
        writeLineFromSamples(attr.array as Float32Array, 0, samples, segments)
        attr.needsUpdate = true
        lines.visible = true
        invalidate()
      },
      hide() {
        lines.visible = false
        invalidate()
      },
    }
    return () => {
      ctx.preview = null
      lines.geometry.dispose()
      ;(lines.material as LineBasicMaterial).dispose()
    }
  }, [ctx, lines, basis, segments, invalidate])

  return <primitive object={lines} />
}
