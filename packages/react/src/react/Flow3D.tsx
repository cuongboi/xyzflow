import { useThree, type RootState } from '@react-three/fiber'
import { useCallback, useEffect, useLayoutEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { Vector3, type OrthographicCamera, type PerspectiveCamera } from 'three'
import type { FitViewOptions, Flow } from '../core/flow'
import type { NodeRecord } from '../core/storage'
import { FlowContext, type FlowRenderContext } from './context'
import type { EdgeRender } from '../core/types'
import type { EdgeDefaults, EdgeStyle, TubeShape } from './curve'
import { ConnectionPreview, EdgesLayer, EdgeTubesLayer } from './EdgesLayer'
import { HandlesLayer } from './HandlesLayer'
import { Interaction, type InteractionOptions } from './Interaction'
import { getDefaultNodeTypes, getHandleTable, type NodeTypes } from './node-types'
import { NodesLayer } from './NodesLayer'
import { resolveTheme, type Flow3DTheme } from './theme'

export interface Flow3DProps extends InteractionOptions {
  flow: Flow
  /** Merged over the built-ins (`default` box, `sphere`). Keep the object stable (module scope / useMemo). */
  nodeTypes?: NodeTypes
  /** Default connector path: `bezier` (curved, default) or `straight`. Per-edge `path` overrides it. */
  edgeStyle?: EdgeStyle
  /** Default connector rendering: `line` (default) or `tube` (3D mesh). Per-edge `render` overrides it. */
  edgeRender?: EdgeRender
  /** Default tube width (default 0.06). Per-edge `width` overrides it. */
  edgeWidth?: number
  /** Default tube height (default = `edgeWidth`). Per-edge `height` overrides it. */
  edgeHeight?: number
  /** Tube cross-section: `round` (ellipse, default) or `rect`. */
  tubeShape?: TubeShape
  /** Vertices around a round tube (default 8). */
  tubeRadialSegments?: number
  /** Samples per bezier edge (default 16). */
  edgeSegments?: number
  /** Bezier tangent length factor (default 0.5). */
  edgeCurvature?: number
  /** Always show every node's connection points (default: only on hovered/selected nodes). */
  showHandles?: boolean
  theme?: Partial<Flow3DTheme>
  /** Disable all built-in pointer/keyboard interaction (render only). */
  readOnly?: boolean
  children?: ReactNode
}

/**
 * Renders a `Flow` inside an R3F `<Canvas>`. You own the canvas, camera,
 * lights and controls; use `<OrbitControls makeDefault />` so drags can pause it.
 *
 * Tip: `<Canvas frameloop="demand">`. The graph invalidates only when something changes.
 */
export function Flow3D({
  flow,
  nodeTypes,
  edgeStyle = 'bezier',
  edgeRender = 'line',
  edgeWidth = 0.06,
  edgeHeight,
  tubeShape = 'round',
  tubeRadialSegments = 8,
  edgeSegments = 16,
  edgeCurvature = 0.5,
  showHandles = false,
  theme,
  readOnly,
  children,
  ...interaction
}: Flow3DProps) {
  const invalidate = useThree((s) => s.invalidate)
  const get = useThree((s) => s.get)

  const types = useMemo(() => ({ ...getDefaultNodeTypes(), ...nodeTypes }), [nodeTypes])
  const resolvedTheme = useMemo(() => resolveTheme(theme), [theme])

  // Mount the tube mesh only when some edge needs it, and keep straight-only
  // graphs at 1 segment per edge (both are big memory wins at 100k edges).
  const store = flow.store
  const subscribe = useCallback((cb: () => void) => store.on('structure', cb), [store])
  const anyTube = useSyncExternalStore(subscribe, () => store.tubeEdgeCount > 0, () => false)
  const anyBezier = useSyncExternalStore(subscribe, () => store.bezierEdgeCount > 0, () => false)
  const tubes = edgeRender === 'tube' || anyTube
  const segments = edgeStyle === 'straight' && !anyBezier ? 1 : Math.max(1, edgeSegments | 0)

  const edgeDefaults = useMemo<EdgeDefaults>(
    () => ({
      path: edgeStyle,
      render: edgeRender,
      width: edgeWidth,
      height: edgeHeight ?? edgeWidth,
      curvature: edgeCurvature,
    }),
    [edgeStyle, edgeRender, edgeWidth, edgeHeight, edgeCurvature],
  )

  // Stable mutable context: layers write edgeObject/tubeObject/preview into it.
  const ctx = useMemo<FlowRenderContext>(
    () => ({
      flow,
      nodeTypes: types,
      theme: resolvedTheme,
      edgeSegments: segments,
      edgeCurvature,
      edgeStyle,
      edgeDefaults,
      tubeShape,
      tubeRadialSegments,
      showHandles,
      activeHandle: { node: null, handle: null },
      onActiveHandleChange: null,
      edgeObject: null,
      tubeObject: null,
      preview: null,
    }),
    [flow, types, resolvedTheme, segments, edgeCurvature, edgeStyle, edgeDefaults, tubeShape, tubeRadialSegments, showHandles],
  )

  // picking radii and connection points come from the renderer's node type definitions
  useLayoutEffect(() => {
    for (const [type, def] of Object.entries(types)) {
      flow.store.setTypeRadius(type, def.radius)
      flow.store.setTypeHandles(type, getHandleTable(def))
    }
  }, [flow, types])

  // demand-driven rendering: draw a frame only when the store says something changed
  useEffect(() => flow.store.on('render', () => invalidate()), [flow, invalidate])

  // theme changes recolor everything
  useEffect(() => {
    for (const b of flow.store.buckets) b.dirty.markAll()
    flow.store.edgeTable.dirty.markAll()
    invalidate()
  }, [flow, resolvedTheme, invalidate])

  useEffect(
    () =>
      flow._attachView({
        fitView: (options?: FitViewOptions) => fitCamera(flow, get, options),
      }),
    [flow, get],
  )

  return (
    <FlowContext.Provider value={ctx}>
      <NodesLayer />
      <EdgesLayer tubes={tubes} />
      {tubes && <EdgeTubesLayer />}
      <HandlesLayer />
      <ConnectionPreview />
      {!readOnly && <Interaction {...interaction} />}
      {children}
    </FlowContext.Provider>
  )
}

const _center = new Vector3()
const _dir = new Vector3()

function fitCamera(
  flow: Flow,
  get: () => RootState,
  options?: FitViewOptions,
): void {
  const store = flow.store
  let nodes: NodeRecord[] | undefined
  if (options?.nodes) {
    nodes = options.nodes.map((id) => store.getNode(id)).filter((n): n is NodeRecord => !!n)
  }
  const b = store.bounds(nodes)
  if (!b) return
  const { camera, controls, size, invalidate } = get()
  _center.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2)
  const radius =
    Math.max(
      0.5,
      Math.hypot(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) / 2,
    ) * (1 + (options?.padding ?? 0.2))

  const target = (controls as unknown as { target?: Vector3; update?: () => void } | null) ?? null
  _dir.copy(camera.position).sub(target?.target ?? _center)
  if (_dir.lengthSq() < 1e-8) _dir.set(1, 1, 1)
  _dir.normalize()

  if ((camera as PerspectiveCamera).isPerspectiveCamera) {
    const cam = camera as PerspectiveCamera
    const vFov = (cam.fov * Math.PI) / 180
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * cam.aspect)
    const dist = Math.max(radius / Math.sin(vFov / 2), radius / Math.sin(hFov / 2))
    cam.position.copy(_center).addScaledVector(_dir, dist)
    if (cam.far < dist + radius * 2) cam.far = (dist + radius) * 4
    cam.updateProjectionMatrix()
  } else {
    const cam = camera as OrthographicCamera
    cam.position.copy(_center).addScaledVector(_dir, radius * 4)
    cam.zoom = Math.min(size.width, size.height) / (radius * 2)
    cam.updateProjectionMatrix()
  }
  camera.lookAt(_center)
  if (target?.target) {
    target.target.copy(_center)
    target.update?.()
  }
  invalidate()
}
