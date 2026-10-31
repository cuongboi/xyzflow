import { describe, expect, it } from 'bun:test'
import { GraphStore } from '../src/core/graph-store'
import { DirtySet } from '../src/core/dirty-set'
import { NODE_SELECTED } from '../src/core/storage'

const at = (x: number, y = 0, z = 0) => ({ x, y, z })

describe('DirtySet', () => {
  it('dedupes, grows and clears', () => {
    const d = new DirtySet(2)
    d.add(1)
    d.add(1)
    d.add(40)
    expect(d.size).toBe(2)
    d.clear()
    expect(d.isEmpty).toBe(true)
    d.add(1)
    expect(d.size).toBe(1)
  })
})

describe('GraphStore', () => {
  it('adds nodes into dense per-type slots', () => {
    const s = new GraphStore()
    const a = s.addNode({ id: 'a', position: at(1, 2, 3) })
    const b = s.addNode({ id: 'b', position: at(4) })
    const c = s.addNode({ id: 'c', type: 'sphere', position: at(5) })
    expect(a.slot).toBe(0)
    expect(b.slot).toBe(1)
    expect(c.slot).toBe(0)
    expect(s.buckets).toHaveLength(2)
    expect(s.getPosition(a)).toEqual({ x: 1, y: 2, z: 3 })
  })

  it('swap-removes in O(1) keeping slots dense and positions correct', () => {
    const s = new GraphStore()
    for (let i = 0; i < 5; i++) s.addNode({ id: `n${i}`, position: at(i) })
    s.removeNode('n1')
    const bucket = s.buckets[0]
    expect(bucket.count).toBe(4)
    const moved = s.getNode('n4')!
    expect(moved.slot).toBe(1)
    expect(s.getPosition(moved).x).toBe(4)
    for (let i = 0; i < bucket.count; i++) expect(bucket.records[i].slot).toBe(i)
  })

  it('grows storage and reports reallocation', () => {
    const s = new GraphStore()
    for (let i = 0; i < 1000; i++) s.addNode({ position: at(i) })
    const b = s.buckets[0]
    expect(b.capacity).toBeGreaterThan(999)
    expect(b.capacityVersion).toBeGreaterThan(0)
    expect(b.positions[999 * 3]).toBe(999)
  })

  it('keeps adjacency and cascades edge removal', () => {
    const s = new GraphStore()
    s.addNode({ id: 'a', position: at(0) })
    s.addNode({ id: 'b', position: at(1) })
    s.addNode({ id: 'c', position: at(2) })
    s.addEdge({ id: 'ab', source: 'a', target: 'b' })
    s.addEdge({ id: 'bc', source: 'b', target: 'c' })
    expect(s.getNode('b')!.edges.size).toBe(2)
    s.removeNode('b')
    expect(s.edgeCount).toBe(0)
    expect(s.getNode('a')!.edges.size).toBe(0)
    expect(s.edgeTable.count).toBe(0)
  })

  it('marks only adjacent edges dirty on move', () => {
    const s = new GraphStore()
    s.addNode({ id: 'a', position: at(0) })
    s.addNode({ id: 'b', position: at(1) })
    s.addNode({ id: 'c', position: at(2) })
    s.addNode({ id: 'd', position: at(3) })
    s.addEdge({ id: 'ab', source: 'a', target: 'b' })
    s.addEdge({ id: 'cd', source: 'c', target: 'd' })
    s.edgeTable.dirty.clear()
    s.setPosition(s.getNode('a')!, 9, 9, 9)
    expect(s.edgeTable.dirty.size).toBe(1)
    expect(s.edgeTable.records[s.edgeTable.dirty.list[0]].id).toBe('ab')
  })

  it('coalesces events in batch', () => {
    const s = new GraphStore()
    let renders = 0
    s.on('render', () => renders++)
    s.batch(() => {
      for (let i = 0; i < 100; i++) s.addNode({ position: at(i) })
    })
    expect(renders).toBe(1)
  })

  it('picks the nearest node along a ray', () => {
    const s = new GraphStore({ defaultRadius: 0.5 })
    s.addNode({ id: 'near', position: at(0, 0, -5) })
    s.addNode({ id: 'far', position: at(0, 0, -10) })
    s.addNode({ id: 'off', position: at(3, 0, -2) })
    const hit = s.pickRay(0, 0, 0, 0, 0, -1)
    expect(hit?.node.id).toBe('near')
    expect(hit?.distance).toBeCloseTo(4.5)
    expect(s.pickRay(0, 0, 0, 0, 0, 1)).toBeNull()
  })

  it('queries a screen rectangle through a view-projection matrix', () => {
    const s = new GraphStore()
    s.addNode({ id: 'in', position: at(0.2, 0.2, 0) })
    s.addNode({ id: 'out', position: at(5, 5, 0) })
    // identity view-projection: NDC == world xy
    const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    const ids = s.queryRect(I, -1, -1, 1, 1).map((n) => n.id)
    expect(ids).toEqual(['in'])
  })

  it('tracks selection flags across swap-remove', () => {
    const s = new GraphStore()
    const a = s.addNode({ id: 'a', position: at(0) })
    s.addNode({ id: 'b', position: at(1) })
    const c = s.addNode({ id: 'c', position: at(2) })
    s.setSelection([c], [])
    s.removeNode('a')
    expect(c.slot).toBe(0)
    expect(c.bucket.flags[c.slot] & NODE_SELECTED).toBe(NODE_SELECTED)
    expect(a.slot).toBe(-1)
  })
})
