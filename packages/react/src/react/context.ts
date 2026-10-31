import { createContext, useContext } from 'react'
import type { LineSegments, Mesh } from 'three'
import type { Flow } from '../core/flow'
import type { Vec3 } from '../core/types'
import type { EdgeDefaults, EdgeStyle, TubeShape } from './curve'
import type { ActiveHandle } from './HandlesLayer'
import type { NodeTypes } from './node-types'
import type { ResolvedTheme } from './theme'

export interface PreviewApi {
  /** `fromDir`/`toDir`: outward directions at the endpoints (default ±X). */
  show(from: Vec3, to: Vec3, fromDir?: Vec3, toDir?: Vec3): void
  hide(): void
}

/**
 * Renderer-wide context. `edgeObject` / `preview` are mutable slots filled by
 * layers so the interaction layer can reach them without re-rendering.
 */
export interface FlowRenderContext {
  flow: Flow
  nodeTypes: NodeTypes
  theme: ResolvedTheme
  edgeSegments: number
  edgeCurvature: number
  /** Default path (`bezier` / `straight`) of edges that don't set `path`. */
  edgeStyle: EdgeStyle
  /** Resolved per-edge defaults (path, render, width, height, curvature). */
  edgeDefaults: EdgeDefaults
  tubeShape: TubeShape
  tubeRadialSegments: number
  /** Show every node's connection points (otherwise only hovered/selected nodes). */
  showHandles: boolean
  /** Connection point under the cursor / being dragged (written by the interaction layer). */
  activeHandle: ActiveHandle
  /** @internal set by `HandlesLayer`; call after changing `activeHandle`. */
  onActiveHandleChange: (() => void) | null
  edgeObject: LineSegments | null
  tubeObject: Mesh | null
  preview: PreviewApi | null
}

export const FlowContext = createContext<FlowRenderContext | null>(null)

export function useFlowContext(): FlowRenderContext {
  const ctx = useContext(FlowContext)
  if (!ctx) throw new Error('[xyzflow] hook used outside <Flow3D>')
  return ctx
}

/** The `Flow` controller, from inside `<Flow3D>` (i.e. inside the R3F canvas). */
export function useFlow(): Flow {
  return useFlowContext().flow
}
