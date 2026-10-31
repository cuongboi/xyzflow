import type { Quat, RotationInput } from './types'

export const IDENTITY: Readonly<Quat> = Object.freeze({ x: 0, y: 0, z: 0, w: 1 })

/** XYZ-order Euler (radians) to quaternion, matching three's `Quaternion.setFromEuler`. */
export function quatFromEuler(x: number, y: number, z: number): Quat {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2)
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2)
  return {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 + s1 * s2 * c3,
    w: c1 * c2 * c3 - s1 * s2 * s3,
  }
}

export function quatFromAxisAngle(ax: number, ay: number, az: number, angle: number): Quat {
  const len = Math.hypot(ax, ay, az) || 1
  const s = Math.sin(angle / 2) / len
  return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(angle / 2) }
}

/** Normalized quaternion from either input form. */
export function toQuat(r: RotationInput | undefined): Quat {
  if (!r) return { x: 0, y: 0, z: 0, w: 1 }
  const q = Array.isArray(r) ? quatFromEuler(r[0], r[1], r[2]) : { x: r.x, y: r.y, z: r.z, w: r.w }
  const len = Math.hypot(q.x, q.y, q.z, q.w)
  if (len < 1e-12) return { x: 0, y: 0, z: 0, w: 1 }
  q.x /= len
  q.y /= len
  q.z /= len
  q.w /= len
  return q
}

/** `a * b` (apply `b` first, then `a`). */
export function quatMultiply(a: Quat, b: Quat): Quat {
  return {
    x: a.x * b.w + a.w * b.x + a.y * b.z - a.z * b.y,
    y: a.y * b.w + a.w * b.y + a.z * b.x - a.x * b.z,
    z: a.z * b.w + a.w * b.z + a.x * b.y - a.y * b.x,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  }
}

/**
 * Rotates the vector at `v[o..o+2]` by the quaternion stored at `q[qo..qo+3]`,
 * writing to `out[oo..oo+2]`. Allocation-free (used in per-frame edge code).
 */
export function rotateVec(
  q: ArrayLike<number>,
  qo: number,
  vx: number,
  vy: number,
  vz: number,
  out: Float32Array | Float64Array | number[],
  oo: number,
): void {
  const qx = q[qo], qy = q[qo + 1], qz = q[qo + 2], qw = q[qo + 3]
  // t = 2 * cross(q.xyz, v); v' = v + w*t + cross(q.xyz, t)
  const tx = 2 * (qy * vz - qz * vy)
  const ty = 2 * (qz * vx - qx * vz)
  const tz = 2 * (qx * vy - qy * vx)
  out[oo] = vx + qw * tx + (qy * tz - qz * ty)
  out[oo + 1] = vy + qw * ty + (qz * tx - qx * tz)
  out[oo + 2] = vz + qw * tz + (qx * ty - qy * tx)
}
