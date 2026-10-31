import { writeAnchor, type EdgeRecord } from '../core/storage'
import type { EdgePath, EdgeRender } from '../core/types'

/** @deprecated alias of `EdgePath`, kept for `<Flow3D edgeStyle>`. */
export type EdgeStyle = EdgePath

/** Cross-section of tube connectors. */
export type TubeShape = 'round' | 'rect'

/** Renderer defaults for every edge field an edge does not set itself. */
export interface EdgeDefaults {
  path: EdgePath
  render: EdgeRender
  width: number
  height: number
  curvature: number
}

/**
 * Precomputed cubic Bernstein weights for `segments + 1` samples, so per-edge
 * evaluation is 12 multiply-adds per point with no `Math.pow`.
 */
export function createBezierBasis(segments: number): Float32Array {
  const basis = new Float32Array((segments + 1) * 4)
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const u = 1 - t
    basis[i * 4] = u * u * u
    basis[i * 4 + 1] = 3 * u * u * t
    basis[i * 4 + 2] = 3 * u * t * t
    basis[i * 4 + 3] = t * t * t
  }
  return basis
}

/**
 * Samples `segments + 1` points (xyz) of a connector into `out`.
 * `bezier`: control points leave each endpoint along its outward direction
 * (`ad*`, `bd*`), tangent length scaled by `curvature`.
 * `straight`: evenly spaced points on the segment, so every edge keeps a
 * fixed-size vertex block regardless of path.
 */
export function sampleCurve(
  out: Float32Array,
  basis: Float32Array,
  segments: number,
  path: EdgePath,
  curvature: number,
  ax: number, ay: number, az: number,
  adx: number, ady: number, adz: number,
  bx: number, by: number, bz: number,
  bdx: number, bdy: number, bdz: number,
): void {
  const dx = bx - ax
  const dy = by - ay
  const dz = bz - az
  if (path === 'straight') {
    for (let i = 0; i <= segments; i++) {
      const t = i / segments
      out[i * 3] = ax + dx * t
      out[i * 3 + 1] = ay + dy * t
      out[i * 3 + 2] = az + dz * t
    }
    return
  }
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
  const ka = Math.max(Math.abs(dx * adx + dy * ady + dz * adz), dist * 0.25) * curvature
  const kb = Math.max(Math.abs(dx * bdx + dy * bdy + dz * bdz), dist * 0.25) * curvature
  const c1x = ax + adx * ka, c1y = ay + ady * ka, c1z = az + adz * ka
  const c2x = bx + bdx * kb, c2y = by + bdy * kb, c2z = bz + bdz * kb
  for (let i = 0; i <= segments; i++) {
    const b = i * 4
    const w0 = basis[b], w1 = basis[b + 1], w2 = basis[b + 2], w3 = basis[b + 3]
    out[i * 3] = w0 * ax + w1 * c1x + w2 * c2x + w3 * bx
    out[i * 3 + 1] = w0 * ay + w1 * c1y + w2 * c2y + w3 * by
    out[i * 3 + 2] = w0 * az + w1 * c1z + w2 * c2z + w3 * bz
  }
}

const _anchor = new Float64Array(12)

/**
 * Samples an edge from the store: endpoints are its connection points (handles,
 * rotated with their nodes), or node centers leaving along the node's ±X.
 */
export function sampleEdge(
  e: EdgeRecord,
  defaults: EdgeDefaults,
  basis: Float32Array,
  segments: number,
  out: Float32Array,
): void {
  writeAnchor(e.source, e.sourceHandle, 1, _anchor, 0)
  writeAnchor(e.target, e.targetHandle, -1, _anchor, 6)
  const A = _anchor
  sampleCurve(
    out, basis, segments, e.path ?? defaults.path, defaults.curvature,
    A[0], A[1], A[2], A[3], A[4], A[5],
    A[6], A[7], A[8], A[9], A[10], A[11],
  )
}

/** Writes sampled points as `segments` line segments (2 vertices each). */
export function writeLineFromSamples(
  out: Float32Array,
  offset: number,
  samples: Float32Array,
  segments: number,
): void {
  let o = offset
  for (let i = 0; i < segments; i++) {
    const s = i * 3
    out[o] = samples[s]
    out[o + 1] = samples[s + 1]
    out[o + 2] = samples[s + 2]
    out[o + 3] = samples[s + 3]
    out[o + 4] = samples[s + 4]
    out[o + 5] = samples[s + 5]
    o += 6
  }
}

/**
 * Back-compat helper: one edge as `segments` line segments, leaving along ±X
 * like React Flow's left→right handles.
 */
export function writeEdgeCurve(
  out: Float32Array,
  offset: number,
  basis: Float32Array,
  segments: number,
  curvature: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  path: EdgePath = 'bezier',
): void {
  const samples = scratchSamples(segments)
  sampleCurve(samples, basis, segments, path, curvature, ax, ay, az, 1, 0, 0, bx, by, bz, -1, 0, 0)
  writeLineFromSamples(out, offset, samples, segments)
}

let _samples = new Float32Array(0)
/** Shared scratch buffer for `segments + 1` points. */
export function scratchSamples(segments: number): Float32Array {
  const n = (segments + 1) * 3
  if (_samples.length < n) _samples = new Float32Array(n)
  return _samples
}

// ------------------------------------------------------------------ tubes

/** Unit cross-section: per radial vertex, offset (x = width axis, y = height axis). */
export interface TubeProfile {
  radial: number
  x: Float32Array
  y: Float32Array
}

export function createTubeProfile(shape: TubeShape, radialSegments: number): TubeProfile {
  if (shape === 'rect') {
    // 4 corners; smooth (diagonal) normals keep it to one vertex per corner
    return {
      radial: 4,
      x: new Float32Array([1, -1, -1, 1]),
      y: new Float32Array([1, 1, -1, -1]),
    }
  }
  const radial = Math.max(3, radialSegments | 0)
  const x = new Float32Array(radial)
  const y = new Float32Array(radial)
  for (let j = 0; j < radial; j++) {
    const a = (j / radial) * Math.PI * 2
    x[j] = Math.cos(a)
    y[j] = Math.sin(a)
  }
  return { radial, x, y }
}

/** Index buffer for `capacity` tubes of `segments` × `radial` quads (static per capacity). */
export function createTubeIndex(capacity: number, segments: number, radial: number): Uint32Array {
  const perEdge = segments * radial * 6
  const vpe = (segments + 1) * radial
  const index = new Uint32Array(capacity * perEdge)
  let o = 0
  for (let e = 0; e < capacity; e++) {
    const base = e * vpe
    for (let s = 0; s < segments; s++) {
      const r0 = base + s * radial
      const r1 = r0 + radial
      for (let j = 0; j < radial; j++) {
        const j1 = (j + 1) % radial
        index[o++] = r0 + j
        index[o++] = r1 + j
        index[o++] = r0 + j1
        index[o++] = r0 + j1
        index[o++] = r1 + j
        index[o++] = r1 + j1
      }
    }
  }
  return index
}

/**
 * Sweeps the profile along the sampled curve. The frame starts with its
 * "height" axis as close to world +Y as possible and is carried along by
 * projection (cheap parallel transport), so tubes don't twist.
 * Writes `(segments + 1) * radial` positions and normals at vertex `vOffset`.
 */
export function writeTube(
  pos: Float32Array,
  nrm: Float32Array,
  vOffset: number,
  samples: Float32Array,
  segments: number,
  profile: TubeProfile,
  width: number,
  height: number,
): void {
  const R = profile.radial
  const PX = profile.x
  const PY = profile.y
  const hw = width / 2
  const hh = height / 2
  let nx = 0, ny = 1, nz = 0 // height axis
  let o = vOffset * 3
  for (let i = 0; i <= segments; i++) {
    // tangent by central/one-sided difference
    const i0 = i === 0 ? 0 : i - 1
    const i1 = i === segments ? segments : i + 1
    let tx = samples[i1 * 3] - samples[i0 * 3]
    let ty = samples[i1 * 3 + 1] - samples[i0 * 3 + 1]
    let tz = samples[i1 * 3 + 2] - samples[i0 * 3 + 2]
    let tl = Math.sqrt(tx * tx + ty * ty + tz * tz)
    if (tl < 1e-9) {
      tx = 1; ty = 0; tz = 0; tl = 1
    }
    tx /= tl; ty /= tl; tz /= tl
    if (i === 0) {
      nx = 0; ny = 1; nz = 0
    }
    // project previous normal onto the plane orthogonal to the tangent
    let d = nx * tx + ny * ty + nz * tz
    let px = nx - tx * d, py = ny - ty * d, pz = nz - tz * d
    let pl = Math.sqrt(px * px + py * py + pz * pz)
    if (pl < 1e-4) {
      // tangent parallel to the normal: fall back to world X
      d = tx
      px = 1 - tx * d; py = -ty * d; pz = -tz * d
      pl = Math.sqrt(px * px + py * py + pz * pz) || 1
    }
    nx = px / pl; ny = py / pl; nz = pz / pl
    // binormal (width axis) = t × n
    const bx = ty * nz - tz * ny
    const by = tz * nx - tx * nz
    const bz = tx * ny - ty * nx
    const cx = samples[i * 3], cy = samples[i * 3 + 1], cz = samples[i * 3 + 2]
    for (let j = 0; j < R; j++) {
      const u = PX[j], v = PY[j]
      pos[o] = cx + bx * u * hw + nx * v * hh
      pos[o + 1] = cy + by * u * hw + ny * v * hh
      pos[o + 2] = cz + bz * u * hw + nz * v * hh
      // ellipse normal ∝ (u / hw, v / hh)
      const a = u * hh, b = v * hw
      let qx = bx * a + nx * b, qy = by * a + ny * b, qz = bz * a + nz * b
      const ql = Math.sqrt(qx * qx + qy * qy + qz * qz) || 1
      nrm[o] = qx / ql
      nrm[o + 1] = qy / ql
      nrm[o + 2] = qz / ql
      o += 3
    }
  }
}
