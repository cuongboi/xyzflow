# xyzflow

A 3D node editor for **React Three Fiber**, built for performance. It works like React Flow (nodes, edges, connect, select, undo), but positions are `{ x, y, z }` and nodes are three.js objects.

Monorepo: **Bun workspaces + Turborepo**.

```
bun install
bun dev          # playground at http://localhost:5173 (uses library source, HMR)
bun run build    # turbo: z-flow (tsdown) → playground (vite), cached
bun run test     # turbo: bun test (core unit tests)
bun run typecheck
bun run bench    # core benchmarks @ 100k nodes
bun run check    # typecheck + test + build in one turbo graph
```

Shared versions live in the root `workspaces.catalog` (`"react": "catalog:"`), so React, three and R3F resolve to exactly one copy, which R3F requires.

## Quick start

```tsx
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Flow3D, useCreateFlow } from 'z-flow'

export function Editor() {
  const flow = useCreateFlow({ snap: 0.5 })
  return (
    <>
      <button onClick={() => flow.addNode({ position: { x: 0, y: 0.5, z: 0 } })}>Add</button>
      <Canvas frameloop="demand" camera={{ position: [8, 8, 8] }}>
        <ambientLight /> <directionalLight position={[5, 10, 5]} />
        <OrbitControls makeDefault />
        <Flow3D flow={flow} />
      </Canvas>
    </>
  )
}
```

## API: add / move / remove

```ts
// add
const id = flow.addNode({ type: 'sphere', position: { x: 1, y: 0, z: 2 }, color: 0x6c8cff, data: {} })
flow.addNodes(bigArray, { history: false })        // bulk load: one batched update, no undo entry
flow.connect({ source: a, target: b })             // validated (no self-loop / duplicate / isValidConnection)

// move
flow.moveNode(id, { x: 3, y: 1, z: 0 })
flow.moveBy(flow.getSelectedNodeIds(), { x: 0, y: 1, z: 0 })
const drag = flow.beginMove(ids, anchorId)         // live: drag.update(dx,dy,dz) … drag.commit() / drag.cancel()

// remove (connected edges go too, and come back together on undo)
flow.removeNodes([id]); flow.removeEdges([edgeId]); flow.removeSelected(); flow.clear()

// everything else
flow.undo(); flow.redo(); flow.duplicate(); flow.copy(); flow.paste()
flow.select(ids, 'replace' | 'add' | 'toggle' | 'remove'); flow.selectAll(); flow.clearSelection()
flow.updateNode(id, { color, data }); flow.fitView({ nodes?, padding? })
flow.toJSON(); flow.fromJSON(json)
flow.on('change' | 'selection' | 'history', fn)
```

DOM UI subscribes with `useFlowState(flow, f => ({ n: f.nodeCount, canUndo: f.canUndo }))`. It is shallow-compared and re-renders only when the selected values change.

## Built-in interactions

| Gesture | Action |
|---|---|
| Double-click ground | Add node (override with `onPaneDoubleClick`) |
| Drag node | Move on XZ plane (snap to grid) |
| Shift + drag node | Move on Y axis |
| Alt + drag node → node | Connect |
| Click / Ctrl+click | Select / toggle |
| Shift + drag empty | Box select |
| Click edge | Select edge |
| Delete / Backspace | Remove selection |
| Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) | Undo / redo |
| Ctrl+D, Ctrl+C / V, Ctrl+A | Duplicate, copy/paste, select all |
| Arrows, PgUp/PgDn (Shift ×5) | Nudge (camera-relative) |
| F / Esc | Fit view (selection or all) / clear |

## Node types

```ts
const nodeTypes = {
  // GPU-instanced: one draw call per type. Use for the bulk (10k–100k+).
  box: instancedNode({ geometry: new BoxGeometry(1, 1, 1), radius: 0.7 }),
  // Any R3F component (GLTF, Text, Html…). Rendered per node: use for hundreds, not 100k.
  card: customNode(({ data, selected, hovered }) => <MyCard {...data} active={selected} />, { radius: 1 }),
}
<Flow3D flow={flow} nodeTypes={nodeTypes} />   // keep nodeTypes stable (module scope)
```

`radius` is the bounding sphere used for picking.

## Performance design

| Technique | Why |
|---|---|
| **Struct-of-arrays store**: positions/colors/flags in `Float32Array` per node type | No objects per frame, cache-friendly loops, no GC churn |
| **Dense slots + swap-remove** | Remove is O(1); slots map 1:1 to `InstancedMesh.count`, with no gaps to skip |
| **React only renders structure** | Add/remove re-renders one bucket. Moving never touches React |
| **Dirty sets → one sub-range GPU upload** (`addUpdateRange`) | Dragging 1 node in 100k uploads 64 bytes, not 6.4 MB |
| **Hand-written instance matrices** | Translation + uniform scale written straight into the buffer, with no `Object3D`/`Matrix4` |
| **All edges in one `LineSegments`** with fixed vertex blocks + adjacency sets | Moving a node rewrites only its own edges (O(degree)); 1 draw call |
| **Precomputed Bernstein basis** | Bezier sampling is 12 multiply-adds per point |
| **Analytic picking** (ray vs sphere over typed arrays) | about 0.5 ms for 100k nodes, versus three's per-triangle `InstancedMesh.raycast`; hover is throttled to rAF |
| **Box select by projection loop** | No scene traversal |
| **`frameloop="demand"` + store-driven `invalidate()`** | Idle editor uses no GPU |
| **Batched events** (`store.batch`) | 50k inserts = 1 notification |
| **History stores packed `Float32Array` deltas** | A 10k-node move is 2 allocations |

Measured core numbers (Bun 1.x, single thread, `bun run bench`):

| Operation @ 100k nodes | Time |
|---|---|
| `pickRay` full scan (hover/click) | ~0.4 ms |
| Drag 1,000 selected nodes, one frame | ~0.5 ms |
| Box-select query | ~0.9 ms |
| Add 10k nodes + 10k edges (batched) | ~15 ms |

### Scaling further
- **> 250k nodes**: add a uniform grid / BVH over slots for `pickRay` and `queryRect` (the store API stays the same).
- **Thick edges**: swap `LineSegments` for `LineSegments2` (three/examples `fat lines`) using the same buffer layout.
- **Labels at scale**: troika `BatchedText`, or show custom nodes only within a distance (LOD).
- **Huge graphs**: run layout in a worker using `z-flow/core` (no React/three dependency).

## Layout

```
turbo.json               task graph: build (^build, dist/** cached), typecheck, test, dev, bench
package.json             bun workspaces + version catalog
apps/
  playground/            Vite app: demo graph, toolbar, inspector, 1k/10k/50k stress
packages/
  react/                 z-flow (tsdown → dist/index.js + dist/core.js)
    src/core/            framework-agnostic: GraphStore, Flow, History, MoveSession
    src/react/           Flow3D, NodesLayer (instanced/custom), EdgesLayer, Interaction
    test/                bun test unit tests
    bench/               core micro-benchmarks
  tsconfig/              @xyzflow/tsconfig shared base config
```

Add a package: create `packages/<name>/package.json` with `build`/`typecheck`/`test` scripts, then depend on it with `"workspace:*"`. Turbo picks up the order from the dependency graph.
