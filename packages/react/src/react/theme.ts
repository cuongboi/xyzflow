import { hexToLinear } from '../core/color'
import type { HexColor } from '../core/types'

export interface Flow3DTheme {
  selectedColor: HexColor
  /** 0..1: how far hovered nodes are mixed toward white. */
  hoverMix: number
  /** Scale of the hovered node (instanced types). */
  hoverScale: number
  edgeSelectedColor: HexColor
  /** Edges touching a selected node. */
  edgeActiveColor: HexColor
  previewColor: HexColor
  /** Connection point markers. */
  handleColor: HexColor
  /** Connection point under the cursor. */
  handleActiveColor: HexColor
  selectionBoxStyle: Partial<CSSStyleDeclaration>
}

export const defaultTheme: Flow3DTheme = {
  selectedColor: 0xffb020,
  hoverMix: 0.35,
  hoverScale: 1.12,
  edgeSelectedColor: 0xffb020,
  edgeActiveColor: 0x9db4ff,
  previewColor: 0x9db4ff,
  handleColor: 0xe6ecf5,
  handleActiveColor: 0x5ad1ff,
  selectionBoxStyle: {
    border: '1px solid rgba(157,180,255,.9)',
    background: 'rgba(157,180,255,.12)',
    borderRadius: '2px',
  },
}

/** Theme with colors pre-converted to linear floats (done once, not per slot). */
export interface ResolvedTheme extends Flow3DTheme {
  linear: {
    selected: Float32Array
    edgeSelected: Float32Array
    edgeActive: Float32Array
    preview: Float32Array
  }
}

export function resolveTheme(theme?: Partial<Flow3DTheme>): ResolvedTheme {
  const t = { ...defaultTheme, ...theme }
  return {
    ...t,
    linear: {
      selected: hexToLinear(t.selectedColor),
      edgeSelected: hexToLinear(t.edgeSelectedColor),
      edgeActive: hexToLinear(t.edgeActiveColor),
      preview: hexToLinear(t.previewColor),
    },
  }
}
