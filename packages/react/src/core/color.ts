import type { HexColor } from './types'

/** sRGB byte -> linear float lookup table (256 entries, built once). */
const SRGB_TO_LINEAR = /* @__PURE__ */ (() => {
  const lut = new Float32Array(256)
  for (let i = 0; i < 256; i++) {
    const c = i / 255
    lut[i] = c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4)
  }
  return lut
})()

/** Writes a hex color as 3 linear floats (what three.js expects for instance/vertex colors). */
export function writeHexLinear(hex: HexColor, out: Float32Array, offset: number): void {
  out[offset] = SRGB_TO_LINEAR[(hex >> 16) & 255]
  out[offset + 1] = SRGB_TO_LINEAR[(hex >> 8) & 255]
  out[offset + 2] = SRGB_TO_LINEAR[hex & 255]
}

export function hexToLinear(hex: HexColor): Float32Array {
  const out = new Float32Array(3)
  writeHexLinear(hex, out, 0)
  return out
}
