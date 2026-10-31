import { describe, expect, it } from 'bun:test'
import { Flow } from '../src/core/flow'
import { GraphStore } from '../src/core/graph-store'
import { quatFromAxisAngle, quatFromEuler } from '../src/core/quat'
import { createHandleTable, writeAnchor } from '../src/core/storage'
import {
  createBezierBasis,
  createTubeIndex,
  createTubeProfile,
  sampleCurve,
  sampleEdge,
  writeTube,
  type EdgeDefaults,
} from '../src/react/curve'

const at = (x: number, y = 0, z = 0) => ({ x, y, z })
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-5)
const handles = createHandleTable([
  { id: 'in', position: at(-0.5) },
  { id: 'out', position: at(0.5) },
  { id: 'top', position: at(0, 0.5) },
])
const defaults: EdgeDefaults = { path: 'bezier', render: 'line', width: 0.1, height: 0.1, curvature: 0.5 }

describe('node rotation', () => {
  it('stores rotation, survives swap-remove, and is undoable', () => {
    const flow = new Flow()
    flow.addNodes([
      { id: 'a', position: at(0) },
      { id: 'b', position: at(1), rotation: [0, Math.PI / 2, 0] },
      { id: 'c', position: at(2), rotation: quatFromAxisAngle(0, 0, 1, Math.PI) },
    ])
    const qb = flow.getRotation('b')!
    close(qb.y, Math.sin(Math.PI / 4))
    flow.removeNode('a') // c swaps into a's slot
    close(flow.getRotation('c')!.z, 1)
    close(flow.getRotation('b')!.y, Math.sin(Math.PI / 4))

    flow.setRotation('b', [0, 0, 0])
    close(flow.getRotation('b')!.w, 1)
    flow.undo()
    close(flow.getRotation('b')!.y, Math.sin(Math.PI / 4))
    flow.redo()
    close(flow.getRotation('b')!.w, 1)
  })

  it('rotateBy composes in world space and RotateSession commits one step', () => {
    const flow = new Flow()
    flow.addNode({ id: 'a', position: at(0) }, { history: false })
    flow.rotateBy(['a'], [0, Math.PI / 2, 0])
    flow.rotateBy(['a'], [0, Math.PI / 2, 0])
    close(Math.abs(flow.getRotation('a')!.y), 1) // 180° about Y
    const s = flow.beginRotate(['a'])
    s.update(quatFromAxisAngle(1, 0, 0, 0.3))
    s.update(quatFromAxisAngle(1, 0, 0, 0.6))
    s.commit()
    flow.undo()
    close(Math.abs(flow.getRotation('a')!.y), 1)
  })

  it('serializes rotation and edge shape (json v2) and loads v1', () => {
    const flow = new Flow()
    flow.addNodes([
      { id: 'a', position: at(0), rotation: [0.1, 0.2, 0.3] },
      { id: 'b', position: at(3) },
    ])
    flow.connect({ source: 'a', target: 'b', render: 'tube', width: 0.2, height: 0.05, path: 'straight' })
    const json = flow.toJSON()
    expect(json.version).toBe(2)
    const copy = new Flow({ initial: json })
    const q = quatFromEuler(0.1, 0.2, 0.3)
    close(copy.getRotation('a')!.x, q.x)
    const e = copy.getEdges()[0]
    expect(e).toMatchObject({ render: 'tube', width: 0.2, height: 0.05, path: 'straight' })

    const v1 = new Flow({
      initial: {
        version: 1,
        nodes: [{ id: 'x', type: 'default', position: at(0), color: 0, data: {} } as never],
        edges: [],
      },
    })
    close(v1.getRotation('x')!.w, 1)
  })
})

describe('connection points', () => {
  it('validates handles once a type registers them, and allows parallel edges on different handles', () => {
    const flow = new Flow()
    flow.store.setTypeHandles('default', handles)
    flow.addNodes([{ id: 'a', position: at(0) }, { id: 'b', position: at(3) }])
    expect(flow.connect({ source: 'a', target: 'b', sourceHandle: 'nope' })).toBeNull()
    expect(flow.connect({ source: 'a', sourceHandle: 'out', target: 'b', targetHandle: 'in' })).not.toBeNull()
    expect(flow.connect({ source: 'a', sourceHandle: 'out', target: 'b', targetHandle: 'in' })).toBeNull()
    expect(flow.connect({ source: 'a', sourceHandle: 'top', target: 'b', targetHandle: 'in' })).not.toBeNull()
    expect(flow.edgeCount).toBe(2)
  })

  it('handle anchors follow node position and rotation', () => {
    const s = new GraphStore()
    s.setTypeHandles('default', handles)
    const n = s.addNode({ id: 'a', position: at(10), rotation: quatFromAxisAngle(0, 0, 1, Math.PI / 2) })
    const out = new Float64Array(6)
    writeAnchor(n, 'out', 1, out, 0) // local +X rotated 90° about Z -> world +Y
    close(out[0], 10)
    close(out[1], 0.5)
    close(out[4], 1)
    writeAnchor(n, undefined, -1, out, 0) // center, fallback -X rotated -> -Y
    close(out[0], 10)
    close(out[1], 0)
    close(out[4], -1)
  })

  it('updateEdge changes handles/shape in place and undoes', () => {
    const flow = new Flow()
    flow.store.setTypeHandles('default', handles)
    flow.addNodes([{ id: 'a', position: at(0) }, { id: 'b', position: at(3) }])
    const id = flow.connect({ source: 'a', target: 'b' })!
    const slot = flow.store.getEdge(id)!.slot
    expect(flow.updateEdge(id, { sourceHandle: 'bad' })).toBe(false)
    flow.updateEdge(id, { sourceHandle: 'top', render: 'tube', width: 0.3, height: 0.1 })
    expect(flow.getEdge(id)).toMatchObject({ sourceHandle: 'top', render: 'tube', width: 0.3, height: 0.1 })
    expect(flow.store.getEdge(id)!.slot).toBe(slot)
    expect(flow.store.tubeEdgeCount).toBe(1)
    flow.undo()
    const e = flow.getEdge(id)!
    expect(e.sourceHandle).toBeUndefined()
    expect(e.render).toBeUndefined()
    expect(flow.store.tubeEdgeCount).toBe(0)
  })
})

describe('connector geometry', () => {
  it('straight path is a line; bezier leaves along the handle direction', () => {
    const segs = 4
    const basis = createBezierBasis(segs)
    const out = new Float32Array((segs + 1) * 3)
    sampleCurve(out, basis, segs, 'straight', 0.5, 0, 0, 0, 0, 1, 0, 4, 0, 0, 0, 1, 0)
    for (let i = 0; i <= segs; i++) {
      close(out[i * 3], i)
      close(out[i * 3 + 1], 0)
    }
    sampleCurve(out, basis, segs, 'bezier', 0.5, 0, 0, 0, 0, 1, 0, 4, 0, 0, 0, 1, 0)
    expect(out[4]).toBeGreaterThan(0) // bows up toward +Y (both ends point up)
    close(out[12], 4)
  })

  it('sampleEdge starts and ends at the connection points', () => {
    const s = new GraphStore()
    s.setTypeHandles('default', handles)
    s.addNode({ id: 'a', position: at(0) })
    s.addNode({ id: 'b', position: at(0, 5) })
    const e = s.addEdge({ source: 'a', sourceHandle: 'top', target: 'b', targetHandle: 'in' })!
    const segs = 8
    const out = new Float32Array((segs + 1) * 3)
    sampleEdge(e, defaults, createBezierBasis(segs), segs, out)
    close(out[1], 0.5)
    close(out[segs * 3], -0.5)
    close(out[segs * 3 + 1], 5)
  })

  it('tube cross-section has the requested width and height', () => {
    const segs = 1
    const samples = new Float32Array([0, 0, 0, 0, 0, 2]) // along +Z
    const profile = createTubeProfile('rect', 0)
    const vpe = (segs + 1) * profile.radial
    const pos = new Float32Array(vpe * 3)
    const nrm = new Float32Array(vpe * 3)
    writeTube(pos, nrm, 0, samples, segs, profile, 0.4, 0.1)
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (let v = 0; v < profile.radial; v++) {
      minX = Math.min(minX, pos[v * 3]); maxX = Math.max(maxX, pos[v * 3])
      minY = Math.min(minY, pos[v * 3 + 1]); maxY = Math.max(maxY, pos[v * 3 + 1])
      close(Math.hypot(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]), 1)
    }
    close(maxX - minX, 0.4) // width is horizontal
    close(maxY - minY, 0.1) // height follows world up
    expect(createTubeIndex(3, 4, 8).length).toBe(3 * 4 * 8 * 6)
  })
})
