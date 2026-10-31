import type { EdgeInput, Flow, GraphJSON, NodeInput } from 'xyzflow'
import { palette } from './nodes'

/** A small 3D pipeline: sources → processors → sinks, spread across x / y / z. */
export function demoGraph(): GraphJSON {
  const n = (id: string, type: string, x: number, y: number, z: number, color = 0x8da2c0, data: unknown = {}) => ({
    id, type, position: { x, y, z }, color, data,
  })
  const nodes = [
    n('in-a', 'card', -6, 1, -3, 0, { label: 'Camera' }),
    n('in-b', 'card', -6, 1, 0, 0, { label: 'Lidar' }),
    n('in-c', 'card', -6, 1, 3, 0, { label: 'IMU' }),
    n('p1', 'default', -2, 0.5, -2, palette[0]),
    n('p2', 'default', -2, 2, 1.5, palette[0]),
    n('p3', 'sphere', 1.5, 1, -1, palette[1]),
    n('p4', 'sphere', 1.5, 3, 2, palette[1]),
    n('p5', 'gem', 4.5, 1.5, 0, palette[2]),
    n('out', 'card', 8, 1.5, 0, 0, { label: 'Planner' }),
  ]
  const e = (source: string, target: string) => ({ id: `${source}->${target}`, source, target, color: 0x55637a, data: {} })
  const edges = [
    e('in-a', 'p1'), e('in-b', 'p1'), e('in-b', 'p2'), e('in-c', 'p2'),
    e('p1', 'p3'), e('p2', 'p3'), e('p2', 'p4'), e('p3', 'p5'), e('p4', 'p5'), e('p5', 'out'),
  ]
  return { version: 1, nodes, edges }
}

/**
 * Adds `count` instanced nodes in a 3D lattice with ~1.5 edges per node.
 * Bulk path: one batched store update, no history.
 */
export function addStress(flow: Flow, count: number): void {
  const side = Math.ceil(Math.cbrt(count))
  const spacing = 1.6
  const off = (side * spacing) / 2
  const types = ['default', 'sphere', 'gem']
  const base = flow.nodeCount
  const nodes: NodeInput[] = []
  for (let i = 0; i < count; i++) {
    const x = i % side
    const z = Math.floor(i / side) % side
    const y = Math.floor(i / (side * side))
    nodes.push({
      type: types[i % 3],
      position: { x: x * spacing - off + 14, y: y * spacing + 0.5, z: z * spacing - off },
      color: palette[(x + y + z) % palette.length],
    })
  }
  const ids = flow.addNodes(nodes, { history: false })
  const edges: EdgeInput[] = []
  for (let i = 0; i < ids.length; i++) {
    if (i % side !== side - 1) edges.push({ source: ids[i], target: ids[i + 1] })
    if (i % 2 === 0 && i + side < ids.length) edges.push({ source: ids[i], target: ids[i + side] })
  }
  flow.addEdges(edges, { history: false })
  console.info(`[stress] +${count} nodes (+${edges.length} edges), total ${base + count}`)
}
