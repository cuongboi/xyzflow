import { describe, expect, it } from 'bun:test'
import { Flow } from '../src/core/flow'

const at = (x: number, y = 0, z = 0) => ({ x, y, z })

function chain(flow: Flow, n: number) {
  const ids = flow.addNodes(Array.from({ length: n }, (_, i) => ({ id: `n${i}`, position: at(i) })))
  flow.addEdges(ids.slice(1).map((id, i) => ({ source: ids[i], target: id })))
  return ids
}

describe('Flow', () => {
  it('add / remove / undo / redo round-trips nodes and edges', () => {
    const flow = new Flow()
    chain(flow, 3)
    expect(flow.nodeCount).toBe(3)
    expect(flow.edgeCount).toBe(2)

    flow.removeNodes(['n1'])
    expect(flow.nodeCount).toBe(2)
    expect(flow.edgeCount).toBe(0)

    flow.undo()
    expect(flow.nodeCount).toBe(3)
    expect(flow.edgeCount).toBe(2)
    expect(flow.getPosition('n1')).toEqual(at(1))

    flow.redo()
    expect(flow.edgeCount).toBe(0)
  })

  it('rejects self loops and duplicate edges by default', () => {
    const flow = new Flow()
    chain(flow, 2)
    expect(flow.connect({ source: 'n0', target: 'n0' })).toBeNull()
    expect(flow.connect({ source: 'n0', target: 'n1' })).toBeNull()
    expect(flow.connect({ source: 'n1', target: 'n0' })).not.toBeNull()
  })

  it('custom isValidConnection', () => {
    const flow = new Flow({ isValidConnection: (c) => c.target !== 'n1' })
    chain(flow, 1)
    flow.addNode({ id: 'n1', position: at(1) })
    expect(flow.connect({ source: 'n0', target: 'n1' })).toBeNull()
  })

  it('move session writes live and records one undo step', () => {
    const flow = new Flow()
    chain(flow, 3)
    let changes = 0
    flow.on('change', () => changes++)
    const session = flow.beginMove(['n0', 'n1'])
    for (let i = 1; i <= 10; i++) session.update(i * 0.1, 0, 0)
    expect(changes).toBe(0) // no change events mid-drag
    expect(flow.getPosition('n0')!.x).toBeCloseTo(1)
    session.commit()
    expect(changes).toBe(1)
    flow.undo()
    expect(flow.getPosition('n0')!.x).toBeCloseTo(0)
    expect(flow.getPosition('n1')!.x).toBeCloseTo(1)
  })

  it('snaps the anchor to the grid while preserving relative offsets', () => {
    const flow = new Flow({ snap: 1 })
    flow.addNode({ id: 'a', position: at(0.3) })
    flow.addNode({ id: 'b', position: at(2.3) })
    const s = flow.beginMove(['b', 'a'], 'a')
    s.update(0.9, 0, 0)
    s.commit()
    expect(flow.getPosition('a')!.x).toBeCloseTo(1)
    expect(flow.getPosition('b')!.x).toBeCloseTo(3)
  })

  it('cancel restores positions without history', () => {
    const flow = new Flow()
    chain(flow, 1)
    const s = flow.beginMove(['n0'])
    s.update(5, 5, 5)
    s.cancel()
    expect(flow.getPosition('n0')).toEqual(at(0))
    expect(flow.canUndo).toBe(true) // only the initial add
    flow.undo()
    expect(flow.canUndo).toBe(false)
  })

  it('duplicate copies internal edges and selects the copies', () => {
    const flow = new Flow()
    chain(flow, 3)
    flow.select(['n0', 'n1'])
    const ids = flow.duplicate()
    expect(ids).toHaveLength(2)
    expect(flow.nodeCount).toBe(5)
    expect(flow.edgeCount).toBe(3) // 2 original + 1 internal copy
    expect(flow.getSelectedNodeIds().sort()).toEqual([...ids].sort())
    flow.undo()
    expect(flow.nodeCount).toBe(3)
  })

  it('removeSelected removes nodes + selected edges in one step', () => {
    const flow = new Flow()
    chain(flow, 4)
    flow.select(['n0'])
    const e = flow.getEdges().find((x) => x.source === 'n2')!.id
    flow.selectEdges([e], 'add')
    flow.removeSelected()
    expect(flow.nodeCount).toBe(3)
    expect(flow.edgeCount).toBe(1)
    flow.undo()
    expect(flow.edgeCount).toBe(3)
  })

  it('toJSON / fromJSON round-trip', () => {
    const a = new Flow()
    chain(a, 10)
    const json = JSON.parse(JSON.stringify(a.toJSON()))
    const b = new Flow({ initial: json })
    expect(b.nodeCount).toBe(10)
    expect(b.edgeCount).toBe(9)
    expect(b.getPosition('n7')).toEqual(at(7))
    expect(b.canUndo).toBe(false)
  })

  it('bulk load without history', () => {
    const flow = new Flow()
    flow.addNodes(
      Array.from({ length: 5000 }, (_, i) => ({ position: at(i) })),
      { history: false },
    )
    expect(flow.nodeCount).toBe(5000)
    expect(flow.canUndo).toBe(false)
  })
})
