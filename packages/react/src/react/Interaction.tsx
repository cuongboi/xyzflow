import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Matrix4, Plane, Raycaster, Vector2, Vector3, type Camera, type Ray } from 'three'
import type { Flow, MoveSession, RotateSession } from '../core/flow'
import { quatFromAxisAngle } from '../core/quat'
import { writeAnchor, type NodeRecord } from '../core/storage'
import type { NodeId, Vec3 } from '../core/types'
import { useFlowContext } from './context'

export interface InteractionOptions {
  /** Keyboard shortcuts (Delete, Ctrl+Z/Y/D/C/V/A, arrows, F, Esc). Default `true`. */
  keyboard?: boolean
  /** Shift+drag on empty space draws a selection box. Default `true`. */
  boxSelect?: boolean
  /** Drag from a connection point (or Alt+drag from a node) creates an edge. Default `true`. */
  connect?: boolean
  /** Hold R and drag a node to rotate the selection (horizontal = yaw, Shift = pitch). Default `true`. */
  rotate?: boolean
  /** Radians per dragged pixel when rotating. Default `0.01`. */
  rotateSpeed?: number
  /** Pixels before a press becomes a drag. Default `4`. */
  dragThreshold?: number
  /** World-space tolerance for clicking edges. Default `0.15`. */
  edgePickThreshold?: number
  /** Arrow-key nudge step (default: `flow.snap || 0.5`; ×5 with Shift). */
  nudgeStep?: number
  /** Ground plane height for double-click placement. Default `0`. */
  groundY?: number
  /** Default: adds a `default` node at the clicked ground point. Return `false` to do nothing. */
  onPaneDoubleClick?: (point: Vec3, flow: Flow) => void | false
  onNodeDoubleClick?: (id: NodeId, flow: Flow) => void
  onNodeClick?: (id: NodeId, flow: Flow) => void
  onEdgeClick?: (id: string, flow: Flow) => void
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'press-pane'; x: number; y: number }
  | {
      kind: 'press-node'
      node: NodeRecord
      additive: boolean
      plane: Plane
      start: Vector3
      vertical: boolean
      x: number
      y: number
    }
  | { kind: 'drag'; session: MoveSession; plane: Plane; start: Vector3; vertical: boolean }
  | { kind: 'connect'; from: NodeRecord; fromHandle: string | undefined }
  | { kind: 'rotate'; session: RotateSession; x: number; y: number; pitch: boolean; moved: boolean }
  | { kind: 'box'; x: number; y: number; additive: boolean; div: HTMLDivElement }

// module-level scratch objects: zero allocation in pointer handlers
const _ndc = new Vector2()
const _raycaster = new Raycaster()
const _hit = new Vector3()
const _tmp = new Vector3()
const _vp = new Matrix4()
const _ground = new Plane(new Vector3(0, 1, 0), 0)
const UP = new Vector3(0, 1, 0)
const _anchor = new Float64Array(6)
const _from = new Vector3()
const _fromDir = new Vector3()
const _toDir = new Vector3()
const _right = new Vector3()

interface HandleHit {
  node: NodeRecord
  handle: string
  distance: number
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'
}

/**
 * All pointer/keyboard handling, attached directly to the canvas element.
 * Bypasses R3F's event system (which would raycast scene objects) and uses
 * the store's analytic picking instead.
 */
export function Interaction(props: InteractionOptions) {
  const ctx = useFlowContext()
  const gl = useThree((s) => s.gl)
  const get = useThree((s) => s.get)
  const opts = useRef(props)
  opts.current = props

  useEffect(() => {
    const el = gl.domElement
    const { flow } = ctx
    const store = flow.store
    let mode: Mode = { kind: 'idle' }
    let hoverRaf = 0
    let lastHoverEvent: PointerEvent | null = null

    const o = () => opts.current
    const camera = (): Camera => get().camera

    const setRay = (e: { clientX: number; clientY: number }): Ray => {
      const r = el.getBoundingClientRect()
      _ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      _raycaster.setFromCamera(_ndc, camera())
      return _raycaster.ray
    }

    const pick = (e: { clientX: number; clientY: number }, exclude?: NodeRecord) => {
      const { origin: a, direction: d } = setRay(e)
      return store.pickRay(a.x, a.y, a.z, d.x, d.y, d.z, exclude)?.node ?? null
    }

    /** World anchor of a node's connection point into `_anchor` (pos xyz, dir xyz). */
    const anchorOf = (n: NodeRecord, handle: string | undefined, fallback: number) => {
      writeAnchor(n, handle, fallback, _anchor, 0)
      return _anchor
    }

    /**
     * Ray vs handle spheres of a few candidate nodes (the picked node, the
     * hovered node, the current connect target): handles may stick out of
     * the node's bounding sphere. Radius is padded for easier grabbing.
     */
    const pickHandle = (
      e: { clientX: number; clientY: number },
      candidates: (NodeRecord | null | undefined)[],
      exclude?: NodeRecord,
    ): HandleHit | null => {
      const { origin: a, direction: d } = setRay(e)
      let best: HandleHit | null = null
      for (const n of candidates) {
        if (!n || n === exclude || n.slot < 0) continue
        const table = n.bucket.handles
        if (!table) continue
        for (let h = 0; h < table.ids.length; h++) {
          const p = anchorOf(n, table.ids[h], 1)
          const cx = p[0] - a.x, cy = p[1] - a.y, cz = p[2] - a.z
          const t = cx * d.x + cy * d.y + cz * d.z
          if (t < 0) continue
          const r = table.radii[h] * 1.75
          const d2 = cx * cx + cy * cy + cz * cz - t * t
          if (d2 > r * r) continue
          if (!best || t < best.distance) best = { node: n, handle: table.ids[h], distance: t }
        }
      }
      return best
    }

    /** Handle of `n` closest to a world point (for drops on a node body). */
    const nearestHandle = (n: NodeRecord, x: number, y: number, z: number): string | undefined => {
      const table = n.bucket.handles
      if (!table) return undefined
      let best: string | undefined
      let bestD = Infinity
      for (const id of table.ids) {
        const p = anchorOf(n, id, 1)
        const d = (p[0] - x) ** 2 + (p[1] - y) ** 2 + (p[2] - z) ** 2
        if (d < bestD) {
          bestD = d
          best = id
        }
      }
      return best
    }

    const setActiveHandle = (node: NodeRecord | null, handle: string | null) => {
      const a = ctx.activeHandle
      if (a.node === node && a.handle === handle) return
      a.node = node
      a.handle = handle
      ctx.onActiveHandleChange?.()
      get().invalidate()
    }

    let rKey = false

    const setControls = (enabled: boolean) => {
      const c = get().controls as unknown as { enabled?: boolean } | null
      if (c && 'enabled' in c) c.enabled = enabled
    }

    const nodePos = (n: NodeRecord, out = new Vector3()) => {
      const P = n.bucket.positions
      return out.set(P[n.slot * 3], P[n.slot * 3 + 1], P[n.slot * 3 + 2])
    }

    /** Horizontal plane through the node, or a camera-facing vertical plane for Y moves. */
    const dragPlane = (n: NodeRecord, vertical: boolean): Plane => {
      const p = nodePos(n)
      if (!vertical) return new Plane().setFromNormalAndCoplanarPoint(UP, p)
      const normal = _tmp.copy(camera().position).sub(p)
      normal.y = 0
      if (normal.lengthSq() < 1e-8) normal.set(0, 0, 1)
      return new Plane().setFromNormalAndCoplanarPoint(normal.normalize(), p)
    }

    const finish = (e: PointerEvent) => {
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      setControls(true)
      el.style.cursor = ''
      mode = { kind: 'idle' }
    }

    // ---------------------------------------------------------- pointer down
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const node = pick(e)
      const handleHit =
        o().connect !== false ? pickHandle(e, [node, store.hovered, ctx.activeHandle.node]) : null
      if (handleHit && !e.altKey && !rKey) {
        // drag from a connection point: start a connector there
        e.stopImmediatePropagation()
        setControls(false)
        el.setPointerCapture(e.pointerId)
        mode = { kind: 'connect', from: handleHit.node, fromHandle: handleHit.handle }
        setActiveHandle(handleHit.node, handleHit.handle)
        el.style.cursor = 'crosshair'
        return
      }
      if (node) {
        // claim the gesture before OrbitControls sees it
        e.stopImmediatePropagation()
        setControls(false)
        el.setPointerCapture(e.pointerId)

        if (e.altKey && o().connect !== false) {
          mode = { kind: 'connect', from: node, fromHandle: undefined }
          el.style.cursor = 'crosshair'
          return
        }
        if (rKey && o().rotate !== false) {
          if (!store.selectedNodes.has(node)) flow.select([node.id])
          const session = flow.beginRotate(Array.from(store.selectedNodes, (n) => n.id))
          store.setHovered(null)
          el.style.cursor = 'ew-resize'
          mode = { kind: 'rotate', session, x: e.clientX, y: e.clientY, pitch: e.shiftKey, moved: false }
          return
        }
        const additive = e.ctrlKey || e.metaKey
        if (additive) flow.select([node.id], 'toggle')
        else if (!store.selectedNodes.has(node)) flow.select([node.id])

        const vertical = e.shiftKey
        const plane = dragPlane(node, vertical)
        const start = setRay(e).intersectPlane(plane, new Vector3())
        if (!start) {
          mode = { kind: 'idle' }
          return
        }
        mode = { kind: 'press-node', node, additive, plane, start, vertical, x: e.clientX, y: e.clientY }
        return
      }

      if (e.shiftKey && o().boxSelect !== false) {
        e.stopImmediatePropagation()
        setControls(false)
        el.setPointerCapture(e.pointerId)
        const div = document.createElement('div')
        Object.assign(div.style, {
          position: 'absolute',
          pointerEvents: 'none',
          zIndex: '10',
          ...ctx.theme.selectionBoxStyle,
        })
        ;(el.parentElement ?? document.body).appendChild(div)
        mode = { kind: 'box', x: e.clientX, y: e.clientY, additive: e.ctrlKey || e.metaKey, div }
        return
      }

      mode = { kind: 'press-pane', x: e.clientX, y: e.clientY }
    }

    // ---------------------------------------------------------- pointer move
    const updateHover = () => {
      hoverRaf = 0
      const e = lastHoverEvent
      if (!e || mode.kind !== 'idle') return
      const node = pick(e)
      const h = o().connect !== false ? pickHandle(e, [node, store.hovered]) : null
      store.setHovered(node ?? h?.node ?? null)
      setActiveHandle(h?.node ?? null, h?.handle ?? null)
      el.style.cursor = h ? 'crosshair' : node ? 'pointer' : ''
    }

    const applyDrag = (e: PointerEvent) => {
      if (mode.kind !== 'drag') return
      const p = setRay(e).intersectPlane(mode.plane, _hit)
      if (!p) return
      const s = mode.start
      if (mode.vertical) mode.session.update(0, p.y - s.y, 0)
      else mode.session.update(p.x - s.x, 0, p.z - s.z)
    }

    const onPointerMove = (e: PointerEvent) => {
      switch (mode.kind) {
        case 'idle':
          // hover picking at most once per animation frame
          lastHoverEvent = e
          if (!hoverRaf) hoverRaf = requestAnimationFrame(updateHover)
          return

        case 'press-pane':
          if (Math.hypot(e.clientX - mode.x, e.clientY - mode.y) > (o().dragThreshold ?? 4)) {
            mode = { kind: 'idle' } // user is orbiting
          }
          return

        case 'press-node': {
          if (Math.hypot(e.clientX - mode.x, e.clientY - mode.y) <= (o().dragThreshold ?? 4)) return
          if (!store.selectedNodes.has(mode.node)) {
            // ctrl-click toggled it off: nothing to drag
            mode = { kind: 'idle' }
            return
          }
          const ids = Array.from(store.selectedNodes, (n) => n.id)
          const session = flow.beginMove(ids, mode.node.id)
          store.setHovered(null)
          el.style.cursor = 'grabbing'
          mode = { kind: 'drag', session, plane: mode.plane, start: mode.start, vertical: mode.vertical }
          applyDrag(e)
          return
        }

        case 'drag':
          applyDrag(e)
          return

        case 'connect': {
          const exclude = flow.options.allowSelfLoops ? undefined : mode.from
          const target = pick(e, exclude)
          const th = pickHandle(e, [target, store.hovered], exclude)
          const targetNode = th?.node ?? target
          store.setHovered(targetNode)
          setActiveHandle(th?.node ?? null, th?.handle ?? null)
          const a = anchorOf(mode.from, mode.fromHandle, 1)
          _from.set(a[0], a[1], a[2])
          _fromDir.set(a[3], a[4], a[5])
          let to: Vector3 | null = null
          if (targetNode) {
            const handle = th?.handle ?? nearestHandle(targetNode, _from.x, _from.y, _from.z)
            const b = anchorOf(targetNode, handle, -1)
            to = _hit.set(b[0], b[1], b[2])
            _toDir.set(b[3], b[4], b[5])
          } else {
            to = setRay(e).intersectPlane(new Plane().setFromNormalAndCoplanarPoint(UP, _from), _hit)
            // free end: arrive facing back toward the source
            if (to) _toDir.copy(_from).sub(to).normalize()
          }
          if (to) ctx.preview?.show(_from, to, _fromDir, _toDir)
          return
        }

        case 'rotate': {
          const dx = e.clientX - mode.x
          const dy = e.clientY - mode.y
          if (!mode.moved && Math.hypot(dx, dy) <= (o().dragThreshold ?? 4)) return
          mode.moved = true
          const k = o().rotateSpeed ?? 0.01
          if (mode.pitch) {
            // tilt about the camera's horizontal right axis
            camera().getWorldDirection(_tmp)
            _right.crossVectors(_tmp, UP)
            if (_right.lengthSq() < 1e-8) _right.set(1, 0, 0)
            _right.normalize()
            mode.session.update(quatFromAxisAngle(_right.x, _right.y, _right.z, dy * k))
          } else {
            mode.session.update(quatFromAxisAngle(0, 1, 0, dx * k))
          }
          return
        }

        case 'box': {
          const r = el.getBoundingClientRect()
          const parent = (el.parentElement ?? document.body).getBoundingClientRect()
          const x0 = Math.max(Math.min(mode.x, e.clientX), r.left)
          const y0 = Math.max(Math.min(mode.y, e.clientY), r.top)
          const x1 = Math.min(Math.max(mode.x, e.clientX), r.right)
          const y1 = Math.min(Math.max(mode.y, e.clientY), r.bottom)
          Object.assign(mode.div.style, {
            left: `${x0 - parent.left}px`,
            top: `${y0 - parent.top}px`,
            width: `${x1 - x0}px`,
            height: `${y1 - y0}px`,
          })
          return
        }
      }
    }

    // ---------------------------------------------------------- pointer up
    const onPointerUp = (e: PointerEvent) => {
      switch (mode.kind) {
        case 'press-node':
          if (!mode.additive) flow.select([mode.node.id])
          o().onNodeClick?.(mode.node.id, flow)
          break

        case 'drag':
          mode.session.commit()
          break

        case 'connect': {
          const exclude = flow.options.allowSelfLoops ? undefined : mode.from
          const target = pick(e, exclude)
          const th = pickHandle(e, [target, store.hovered], exclude)
          const targetNode = th?.node ?? target
          ctx.preview?.hide()
          store.setHovered(null)
          setActiveHandle(null, null)
          if (targetNode) {
            const a = anchorOf(mode.from, mode.fromHandle, 1)
            // dropped on the node body: snap to its closest connection point
            const targetHandle = th?.handle ?? nearestHandle(targetNode, a[0], a[1], a[2])
            // Alt-drag from a body: use the source handle facing the target
            let sourceHandle = mode.fromHandle
            if (sourceHandle === undefined && targetNode.bucket.handles && mode.from.bucket.handles) {
              const b = anchorOf(targetNode, targetHandle, -1)
              sourceHandle = nearestHandle(mode.from, b[0], b[1], b[2])
            }
            flow.connect({
              source: mode.from.id,
              sourceHandle,
              target: targetNode.id,
              targetHandle,
            })
          }
          break
        }

        case 'rotate':
          if (mode.moved) mode.session.commit()
          else mode.session.cancel()
          break

        case 'box': {
          const r = el.getBoundingClientRect()
          const toNdc = (x: number, y: number) =>
            [((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1] as const
          const [ax, ay] = toNdc(mode.x, mode.y)
          const [bx, by] = toNdc(e.clientX, e.clientY)
          const cam = camera()
          cam.updateMatrixWorld()
          _vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
          const hits = store.queryRect(_vp.elements, ax, ay, bx, by)
          store.setSelection(hits, [], mode.additive ? 'add' : 'replace')
          mode.div.remove()
          break
        }

        case 'press-pane': {
          // click on empty space: try an edge, otherwise clear selection
          const edges = ctx.edgeObject
          const tubes = ctx.tubeObject
          let hitEdge: string | null = null
          let hitDist = Infinity
          if (store.edgeCount > 0) setRay(e)
          if (edges && store.edgeCount > 0) {
            _raycaster.params.Line = { threshold: o().edgePickThreshold ?? 0.15 }
            const hit = _raycaster.intersectObject(edges, false)[0]
            if (hit?.index !== undefined) {
              const vpe = ctx.edgeSegments * 2
              hitEdge = store.edgeTable.records[Math.floor(hit.index / vpe)]?.id ?? null
              hitDist = hit.distance
            }
          }
          if (tubes && store.edgeCount > 0) {
            const hit = _raycaster.intersectObject(tubes, false)[0]
            if (hit?.faceIndex != null && hit.distance < hitDist) {
              const radial = tubes.userData.radial as number
              const trisPerEdge = ctx.edgeSegments * radial * 2
              hitEdge = store.edgeTable.records[Math.floor(hit.faceIndex / trisPerEdge)]?.id ?? hitEdge
            }
          }
          if (hitEdge) {
            flow.selectEdges([hitEdge], e.ctrlKey || e.metaKey ? 'toggle' : 'replace')
            o().onEdgeClick?.(hitEdge, flow)
          } else if (!(e.ctrlKey || e.metaKey)) {
            flow.clearSelection()
          }
          break
        }
      }
      finish(e)
    }

    const onPointerCancel = (e: PointerEvent) => {
      if (mode.kind === 'drag') mode.session.cancel()
      if (mode.kind === 'box') mode.div.remove()
      if (mode.kind === 'rotate') mode.session.cancel()
      if (mode.kind === 'connect') {
        ctx.preview?.hide()
        setActiveHandle(null, null)
      }
      finish(e)
    }

    const onPointerLeave = () => {
      if (mode.kind === 'idle') {
        store.setHovered(null)
        setActiveHandle(null, null)
        el.style.cursor = ''
      }
    }

    // ---------------------------------------------------------- double click
    const onDoubleClick = (e: MouseEvent) => {
      const node = pick(e)
      if (node) {
        o().onNodeDoubleClick?.(node.id, flow)
        return
      }
      _ground.constant = -(o().groundY ?? 0)
      const p = setRay(e).intersectPlane(_ground, _hit)
      if (!p) return
      const s = flow.snap
      const point = s > 0
        ? { x: Math.round(p.x / s) * s, y: Math.round(p.y / s) * s, z: Math.round(p.z / s) * s }
        : { x: p.x, y: p.y, z: p.z }
      const handler = o().onPaneDoubleClick
      if (handler) {
        handler(point, flow)
      } else {
        const id = flow.addNode({ position: point })
        flow.select([id])
      }
    }

    // ---------------------------------------------------------- keyboard
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'r') rKey = false
    }
    const onBlur = () => {
      rKey = false
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (key === 'r' && !mod) {
        rKey = true // modifier for drag-rotate; not consumed
        return
      }
      if (o().keyboard === false) return
      let handled = true

      if (key === 'delete' || key === 'backspace') flow.removeSelected()
      else if (mod && key === 'z' && !e.shiftKey) flow.undo()
      else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) flow.redo()
      else if (mod && key === 'a') flow.selectAll()
      else if (mod && key === 'd') flow.duplicate()
      else if (mod && key === 'c') flow.copy()
      else if (mod && key === 'v') flow.paste()
      else if (key === 'escape') {
        if (mode.kind === 'drag' || mode.kind === 'rotate') mode.session.cancel()
        flow.clearSelection()
      } else if (!mod && key === 'f') {
        const sel = flow.getSelectedNodeIds()
        flow.fitView(sel.length ? { nodes: sel } : undefined)
      } else if (key.startsWith('arrow') || key === 'pageup' || key === 'pagedown') {
        const ids = flow.getSelectedNodeIds()
        if (!ids.length) return
        const step = (o().nudgeStep ?? (flow.snap || 0.5)) * (e.shiftKey ? 5 : 1)
        // camera-relative: "up" moves away from the viewer along the dominant ground axis
        camera().getWorldDirection(_tmp)
        _tmp.y = 0
        let fx = 0
        let fz = -1
        if (_tmp.lengthSq() > 1e-8) {
          if (Math.abs(_tmp.x) > Math.abs(_tmp.z)) { fx = Math.sign(_tmp.x); fz = 0 }
          else { fx = 0; fz = Math.sign(_tmp.z) }
        }
        const rx = -fz
        const rz = fx
        const d = { x: 0, y: 0, z: 0 }
        if (key === 'arrowup') { d.x = fx * step; d.z = fz * step }
        else if (key === 'arrowdown') { d.x = -fx * step; d.z = -fz * step }
        else if (key === 'arrowright') { d.x = rx * step; d.z = rz * step }
        else if (key === 'arrowleft') { d.x = -rx * step; d.z = -rz * step }
        else if (key === 'pageup') d.y = step
        else d.y = -step
        flow.moveBy(ids, d)
      } else handled = false

      if (handled) e.preventDefault()
    }

    el.addEventListener('pointerdown', onPointerDown, { capture: true })
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerCancel)
    el.addEventListener('pointerleave', onPointerLeave)
    el.addEventListener('dblclick', onDoubleClick)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      if (hoverRaf) cancelAnimationFrame(hoverRaf)
      if (mode.kind === 'box') mode.div.remove()
      el.removeEventListener('pointerdown', onPointerDown, { capture: true })
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerCancel)
      el.removeEventListener('pointerleave', onPointerLeave)
      el.removeEventListener('dblclick', onDoubleClick)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [ctx, gl, get])

  return null
}
