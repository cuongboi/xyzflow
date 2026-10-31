import { GizmoHelper, GizmoViewport, Grid, OrbitControls, Stats } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Flow3D, useCreateFlow, useFlowState, type Flow, type GraphJSON } from 'z-flow'
import { useState } from 'react'
import { addStress, demoGraph } from './demo'
import './styles.css'
import { nodeTypes, palette } from './nodes'

const STORAGE_KEY = 'xyzflow:playground'
const TYPES = ['default', 'sphere', 'gem', 'card'] as const
type AddType = (typeof TYPES)[number]

export default function Example() {
  const flow = useCreateFlow({ snap: 0.5, initial: demoGraph() })
  const [addType, setAddType] = useState<AddType>('default')
  const [edgeStyle, setEdgeStyle] = useState<'bezier' | 'straight'>('bezier')

  const addAt = (position: { x: number; y: number; z: number }) => {
    const id = flow.addNode({
      type: addType,
      position: addType === 'card' ? { ...position, y: position.y + 1 } : { ...position, y: position.y + 0.5 },
      color: palette[Math.floor(Math.random() * palette.length)],
      data: addType === 'card' ? { label: `Node ${flow.nodeCount + 1}` } : {},
    })
    flow.select([id])
  }

  return (
    <div className="ex-playground app">
      <Toolbar flow={flow} addType={addType} setAddType={setAddType} edgeStyle={edgeStyle} setEdgeStyle={setEdgeStyle} onAdd={() => addAt(randomGround(flow.snap))} />
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        camera={{ position: [10, 10, 14], fov: 50, near: 0.1, far: 2000 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
      >
        <color attach="background" args={['#0d1016']} />
        <hemisphereLight args={['#c8d6ff', '#1a1d26', 1.1]} />
        <directionalLight position={[8, 14, 6]} intensity={1.4} />
        <Grid
          infiniteGrid
          cellSize={0.5}
          sectionSize={2.5}
          cellColor="#1c2230"
          sectionColor="#2b3550"
          fadeDistance={90}
          position={[0, -0.001, 0]}
        />
        <OrbitControls makeDefault />
        <Flow3D
          flow={flow}
          nodeTypes={nodeTypes}
          edgeStyle={edgeStyle}
          onPaneDoubleClick={(p) => addAt(p)}
          onNodeDoubleClick={(id, f) => {
            const n = f.getNode<{ label?: string }>(id)
            if (n?.type !== 'card') return
            const label = prompt('Label', n.data.label ?? '')
            if (label != null) f.updateNode(id, { data: { ...n.data, label } })
          }}
        />
        <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
          <GizmoViewport labelColor="white" axisHeadScale={0.9} />
        </GizmoHelper>
        <Stats className="stats" />
      </Canvas>
      <Inspector flow={flow} />
      <Help />
    </div>
  )
}

function randomGround(snap: number) {
  const r = () => Math.round(((Math.random() - 0.5) * 12) / snap) * snap
  return { x: r(), y: 0, z: r() }
}

function Toolbar(props: {
  flow: Flow
  addType: AddType
  setAddType: (t: AddType) => void
  edgeStyle: 'bezier' | 'straight'
  setEdgeStyle: (s: 'bezier' | 'straight') => void
  onAdd: () => void
}) {
  const { flow } = props
  const s = useFlowState(flow, (f) => ({
    nodes: f.nodeCount,
    edges: f.edgeCount,
    selN: f.store.selectedNodes.size,
    selE: f.store.selectedEdges.size,
    canUndo: f.canUndo,
    canRedo: f.canRedo,
  }))
  const [snap, setSnap] = useState(flow.snap)

  const stress = (n: number) => {
    addStress(flow, n)
    flow.fitView()
  }
  const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(flow.toJSON()))
  const load = () => {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) flow.fromJSON(JSON.parse(raw) as GraphJSON)
  }
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(flow.toJSON(), null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'flow.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <header className="toolbar">
      <strong className="brand">xyzflow</strong>

      <div className="group">
        <select value={props.addType} onChange={(e) => props.setAddType(e.target.value as AddType)}>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button onClick={props.onAdd}>+ Add</button>
        <button onClick={() => flow.removeSelected()} disabled={!s.selN && !s.selE}>Delete</button>
        <button onClick={() => flow.duplicate()} disabled={!s.selN}>Duplicate</button>
      </div>

      <div className="group">
        <button onClick={() => flow.undo()} disabled={!s.canUndo}>Undo</button>
        <button onClick={() => flow.redo()} disabled={!s.canRedo}>Redo</button>
      </div>

      <div className="group">
        <button onClick={() => flow.fitView()}>Fit</button>
        <label>
          Snap
          <select value={snap} onChange={(e) => { flow.snap = Number(e.target.value); setSnap(flow.snap) }}>
            <option value={0}>off</option>
            <option value={0.25}>0.25</option>
            <option value={0.5}>0.5</option>
            <option value={1}>1</option>
          </select>
        </label>
        <label>
          Edges
          <select value={props.edgeStyle} onChange={(e) => props.setEdgeStyle(e.target.value as 'bezier' | 'straight')}>
            <option value="bezier">bezier</option>
            <option value="straight">straight</option>
          </select>
        </label>
      </div>

      <div className="group">
        <button onClick={() => stress(1_000)}>+1k</button>
        <button onClick={() => stress(10_000)}>+10k</button>
        <button onClick={() => stress(50_000)}>+50k</button>
        <button onClick={() => flow.clear()}>Clear</button>
      </div>

      <div className="group">
        <button onClick={save}>Save</button>
        <button onClick={load}>Load</button>
        <button onClick={exportJson}>Export</button>
      </div>

      <span className="counts">
        {s.nodes.toLocaleString()} nodes · {s.edges.toLocaleString()} edges
        {s.selN + s.selE > 0 && ` · ${s.selN + s.selE} selected`}
      </span>
    </header>
  )
}

/** Edits the single selected node. Selector returns primitives so it stays referentially stable. */
function Inspector({ flow }: { flow: Flow }) {
  const sel = useFlowState(flow, (f) => {
    if (f.store.selectedNodes.size !== 1) return null
    const [rec] = f.store.selectedNodes
    const p = f.store.getPosition(rec)
    return { id: rec.id, type: rec.type, color: rec.color, x: p.x, y: p.y, z: p.z }
  })
  if (!sel) return null

  const set = (axis: 'x' | 'y' | 'z', value: number) => {
    if (Number.isNaN(value)) return
    flow.moveNode(sel.id, { x: sel.x, y: sel.y, z: sel.z, [axis]: value })
  }

  return (
    <aside className="inspector">
      <div className="title">{sel.type} <code>{sel.id}</code></div>
      {(['x', 'y', 'z'] as const).map((axis) => (
        <label key={`${sel.id}-${axis}-${sel[axis]}`}>
          {axis}
          <input
            type="number"
            step={flow.snap || 0.1}
            defaultValue={+sel[axis].toFixed(3)}
            onBlur={(e) => set(axis, e.currentTarget.valueAsNumber)}
            onKeyDown={(e) => e.key === 'Enter' && set(axis, e.currentTarget.valueAsNumber)}
          />
        </label>
      ))}
      <div className="swatches">
        {palette.map((c) => (
          <button
            key={c}
            className={c === sel.color ? 'on' : ''}
            style={{ background: `#${c.toString(16).padStart(6, '0')}` }}
            onClick={() => flow.updateNode(sel.id, { color: c })}
          />
        ))}
      </div>
    </aside>
  )
}

function Help() {
  const [open, setOpen] = useState(true)
  if (!open) return <button className="help-toggle" onClick={() => setOpen(true)}>?</button>
  return (
    <aside className="help" onClick={() => setOpen(false)}>
      <b>Add</b> double-click ground · toolbar <b>+ Add</b> · Ctrl+D duplicate · Ctrl+C / V<br />
      <b>Move</b> drag node (XZ) · Shift+drag (Y) · arrows / PgUp / PgDn nudge<br />
      <b>Connect</b> Alt+drag node → node<br />
      <b>Select</b> click · Ctrl+click toggle · Shift+drag box · Ctrl+A · click edge<br />
      <b>Remove</b> Delete / Backspace · <b>Undo</b> Ctrl+Z / Ctrl+Y · <b>Fit</b> F
      <span className="muted"> (click to hide)</span>
    </aside>
  )
}
