import './styles.css'
import { GizmoHelper, GizmoViewport, OrbitControls, Text } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import {
  Flow3D,
  useCreateFlow,
  useFlowState,
  type EdgeRender,
  type EdgeSnapshot,
  type Flow,
  type GraphJSON,
  type Quat,
  type Vec3,
} from 'z-flow'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BOARDS,
  BOARD_THICKNESS,
  NETS,
  NET_WIDTH,
  TRACE_HEIGHT,
  demoBoard,
  surface,
  traceId,
  type NetData,
  type NetName,
} from './board'
import { PART_DEFAULTS, PART_LIFT, nodeTypes, type PartData, type PartType } from './components'

const STORAGE_KEY = 'xyzflow:pcb'
const PART_TYPES = Object.keys(PART_DEFAULTS) as PartType[]
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`

/** Yaw (degrees, -180..180) of a quaternion, i.e. rotation about the board normal. */
const yawDeg = (q: Quat) =>
  Math.round((Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x)) * 180) / Math.PI)
const yaw = (deg: number): [number, number, number] => [0, (deg * Math.PI) / 180, 0]
const pinLabel = (ref: string | undefined, pad: string | undefined) => `${ref ?? '?'}${pad ? `.${pad}` : ''}`

export default function Example() {
  // Pad-drag / Alt+drag connections go through isValidConnection: we reject the
  // plain edge and re-issue it tagged with the active net (color, width, data).
  const netRef = useRef<NetName>('GPIO')
  const bypass = useRef(false)
  const flow = useCreateFlow({
    snap: 0.25,
    initial: demoBoard(),
    isValidConnection: (c, f) => {
      if (bypass.current) return true
      queueMicrotask(() => {
        bypass.current = true
        const net = netRef.current
        f.connect<NetData>({
          ...c,
          id: traceId(net, c.source, c.sourceHandle, c.target, c.targetHandle),
          color: NETS[net],
          width: NET_WIDTH[net],
          height: TRACE_HEIGHT,
          data: { net },
        })
        bypass.current = false
      })
      return false
    },
  })
  const [net, setNet] = useState<NetName>('GPIO')
  const [part, setPart] = useState<PartType>('resistor')
  const [traces, setTraces] = useState<EdgeRender>('tube')
  const [showPads, setShowPads] = useState(false)
  netRef.current = net

  const place = (p: Vec3) => {
    const def = PART_DEFAULTS[part]
    const id = flow.addNode<PartData>({
      type: part,
      position: { ...p, y: p.y + PART_LIFT[part] },
      color: part === 'via' ? 0xd8b04a : 0x8da2c0,
      data: { ...def.data, ref: nextRef(flow, def.prefix) },
    })
    flow.select([id])
  }

  return (
    <div className="ex-pcb app">
      <Toolbar flow={flow} part={part} setPart={setPart} net={net} setNet={setNet}
        traces={traces} setTraces={setTraces} showPads={showPads} setShowPads={setShowPads}
        onAdd={() => place({ x: 0, y: surface(BOARDS[0]), z: 4 })} />
      <Canvas frameloop="demand" dpr={[1, 2]} camera={{ position: [0, 14, 12], fov: 45 }}>
        <color attach="background" args={['#0b0e13']} />
        <hemisphereLight args={['#dfe6ff', '#141820', 1.2]} />
        <directionalLight position={[6, 16, 8]} intensity={1.6} />
        {BOARDS.map((b) => <Board key={b.name} {...b} />)}
        <OrbitControls makeDefault />
        <Flow3D
          flow={flow}
          nodeTypes={nodeTypes}
          edgeStyle="straight"
          edgeRender={traces}
          tubeShape="rect"
          edgeWidth={0.12}
          edgeHeight={TRACE_HEIGHT}
          showHandles={showPads}
          groundY={surface(BOARDS[0])}
          onPaneDoubleClick={(p) => place(p)}
        />
        <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
          <GizmoViewport labelColor="white" axisHeadScale={0.9} />
        </GizmoHelper>
      </Canvas>
      <Panel flow={flow} />
      <aside className="help">
        <b>Place</b> double-click board · <b>Move</b> drag (Shift = up/down) · <b>Rotate</b> R+drag (Shift = tilt)
        · <b>Route</b> drag from a pad → pad (Alt+drag part → part picks nearest pads; uses active net) · <b>Delete</b> Del
        · <b>Undo</b> Ctrl+Z
      </aside>
    </div>
  )
}

function nextRef(flow: Flow, prefix: string): string {
  let max = 0
  for (const n of flow.getNodes()) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec((n.data as PartData).ref ?? '')
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `${prefix}${max + 1}`
}

/** FR-4 board with copper-pour tint, mounting holes and silkscreen name. */
function Board({ name, x, z, w, d, y }: (typeof BOARDS)[number]) {
  return (
    <group position={[x, y + BOARD_THICKNESS / 2, z]}>
      <mesh>
        <boxGeometry args={[w, BOARD_THICKNESS, d]} />
        <meshStandardMaterial color="#1e5b3a" roughness={0.55} metalness={0.1} />
      </mesh>
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => (
        <mesh key={`${sx}${sz}`} position={[sx * (w / 2 - 0.4), BOARD_THICKNESS / 2 + 0.001, sz * (d / 2 - 0.4)]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.12, 0.22, 24]} />
          <meshStandardMaterial color="#d8b04a" metalness={0.9} roughness={0.3} />
        </mesh>
      ))}
      <Text position={[-w / 2 + 0.6, BOARD_THICKNESS / 2 + 0.002, d / 2 - 0.35]} rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.3} color="#f2f2ea" anchorX="left">
        {name}
      </Text>
    </group>
  )
}

function Toolbar(props: {
  flow: Flow
  part: PartType
  setPart: (t: PartType) => void
  net: NetName
  setNet: (n: NetName) => void
  traces: EdgeRender
  setTraces: (r: EdgeRender) => void
  showPads: boolean
  setShowPads: (v: boolean) => void
  onAdd: () => void
}) {
  const { flow } = props
  const s = useFlowState(flow, (f) => ({
    nodes: f.nodeCount,
    edges: f.edgeCount,
    sel: f.store.selectedNodes.size + f.store.selectedEdges.size,
    canUndo: f.canUndo,
    canRedo: f.canRedo,
  }))
  const exportJson = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(flow.toJSON(), null, 2)], { type: 'application/json' }))
    a.download = 'board.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }
  return (
    <header className="toolbar">
      <strong className="brand">xyzflow · PCB</strong>
      <div className="group">
        <select value={props.part} onChange={(e) => props.setPart(e.target.value as PartType)}>
          {PART_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button onClick={props.onAdd}>+ Part</button>
        <button onClick={() => flow.removeSelected()} disabled={!s.sel}>Delete</button>
      </div>
      <div className="group">
        <label>
          Net
          <span className="dot" style={{ background: hex(NETS[props.net]) }} />
          <select value={props.net} onChange={(e) => props.setNet(e.target.value as NetName)}>
            {(Object.keys(NETS) as NetName[]).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      <div className="group">
        <label>
          Traces
          <select value={props.traces} onChange={(e) => props.setTraces(e.target.value as EdgeRender)}>
            <option value="tube">copper</option>
            <option value="line">line</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={props.showPads} onChange={(e) => props.setShowPads(e.target.checked)} />
          Pads
        </label>
      </div>
      <div className="group">
        <button onClick={() => flow.undo()} disabled={!s.canUndo}>Undo</button>
        <button onClick={() => flow.redo()} disabled={!s.canRedo}>Redo</button>
        <button onClick={() => flow.fitView()}>Fit</button>
      </div>
      <div className="group">
        <button onClick={() => localStorage.setItem(STORAGE_KEY, JSON.stringify(flow.toJSON()))}>Save</button>
        <button onClick={() => {
          const raw = localStorage.getItem(STORAGE_KEY)
          if (raw) flow.fromJSON(JSON.parse(raw) as GraphJSON)
        }}>Load</button>
        <button onClick={() => flow.fromJSON(demoBoard())}>Reset</button>
        <button onClick={exportJson}>Export</button>
      </div>
      <span className="counts">{s.nodes} parts · {s.edges} traces{s.sel > 0 && ` · ${s.sel} selected`}</span>
    </header>
  )
}

/** Re-renders on every graph change (fine at PCB scale: tens–hundreds of parts). */
function useRevision(flow: Flow): number {
  const [rev, setRev] = useState(0)
  useEffect(() => {
    const bump = () => setRev((r) => r + 1)
    const offs = [flow.on('change', bump), flow.on('selection', bump)]
    return () => offs.forEach((off) => off())
  }, [flow])
  return rev
}

function Panel({ flow }: { flow: Flow }) {
  const rev = useRevision(flow)
  const [tab, setTab] = useState<'part' | 'bom' | 'nets'>('part')
  const { nodes, edges } = useMemo(() => ({ nodes: flow.getNodes(), edges: flow.getEdges() }), [flow, rev])
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n.data as PartData])), [nodes])
  const selIds = flow.getSelectedNodeIds()
  const selId = selIds.length === 1 ? selIds[0] : null
  const sel = selId ? flow.getNode<PartData>(selId) : undefined
  const edgeIds = flow.getSelectedEdgeIds()
  const selEdge = !selIds.length && edgeIds.length === 1 ? flow.getEdge<NetData>(edgeIds[0]) : undefined

  const bom = useMemo(() => {
    const rows = new Map<string, { value: string; footprint: string; refs: string[] }>()
    for (const n of nodes) {
      const d = n.data as PartData
      const key = `${n.type}|${d.value}|${d.footprint ?? ''}`
      const row = rows.get(key) ?? { value: d.value, footprint: d.footprint ?? '', refs: [] }
      row.refs.push(d.ref)
      rows.set(key, row)
    }
    return [...rows.values()].sort((a, b) => a.refs[0].localeCompare(b.refs[0]))
  }, [nodes])

  const netlist = useMemo(() => {
    const nets = new Map<string, Set<string>>()
    for (const e of edges) {
      const net = (e.data as Partial<NetData>)?.net ?? '(unassigned)'
      const set = nets.get(net) ?? new Set<string>()
      set.add(byId.get(e.source)?.ref ?? e.source).add(byId.get(e.target)?.ref ?? e.target)
      nets.set(net, set)
    }
    return [...nets.entries()]
  }, [edges, byId])

  const edit = (field: keyof PartData, value: string) => {
    if (!sel) return
    flow.updateNode(sel.id, { data: { ...sel.data, [field]: value } })
  }

  return (
    <aside className="panel">
      <div className="tabs">
        {(['part', 'bom', 'nets'] as const).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'part' ? 'Part' : t === 'bom' ? 'BOM' : 'Netlist'}
          </button>
        ))}
      </div>
      {tab === 'part' && selEdge && <TracePanel flow={flow} edge={selEdge} byId={byId} />}
      {tab === 'part' && !selEdge && (sel ? (
        <div className="fields" key={sel.id}>
          <div className="title">{sel.type} <code>{sel.id}</code></div>
          {(['ref', 'value', 'footprint'] as const).map((f) => (
            <label key={f}>
              {f}
              <input defaultValue={String(sel.data[f] ?? '')} onBlur={(e) => edit(f, e.currentTarget.value)}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
            </label>
          ))}
          <div className="row">
            <span>rotation</span>
            <button onClick={() => flow.rotateBy([sel.id], yaw(90))}>⟲ 90°</button>
            <button onClick={() => flow.rotateBy([sel.id], yaw(-90))}>⟳ 90°</button>
            <input key={yawDeg(sel.rotation)} type="number" step={15} defaultValue={yawDeg(sel.rotation)}
              onBlur={(e) => flow.setRotation(sel.id, yaw(Number(e.currentTarget.value) || 0))}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />°
          </div>
          <div className="muted">
            Connected: {edges.filter((e) => e.source === sel.id || e.target === sel.id)
              .map((e) => {
                const out = e.source === sel.id
                const mine = out ? e.sourceHandle : e.targetHandle
                const other = out ? e.target : e.source
                const otherPad = out ? e.targetHandle : e.sourceHandle
                return `${(e.data as NetData)?.net ?? '?'} ${pinLabel(sel.data.ref, mine)}→${pinLabel(byId.get(other)?.ref, otherPad)}`
              })
              .join(', ') || 'none'}
          </div>
        </div>
      ) : <div className="muted">Select a part or a trace to edit it.</div>)}
      {tab === 'bom' && (
        <table>
          <thead><tr><th>Qty</th><th>Value</th><th>Footprint</th><th>Refs</th></tr></thead>
          <tbody>
            {bom.map((r) => (
              <tr key={r.refs.join()}><td>{r.refs.length}</td><td>{r.value}</td><td>{r.footprint}</td><td>{r.refs.join(', ')}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      {tab === 'nets' && (
        <ul className="nets">
          {netlist.map(([net, refs]) => (
            <li key={net}>
              <span className="dot" style={{ background: hex(NETS[net as NetName] ?? 0x55637a) }} />
              <b>{net}</b> {[...refs].join(', ')}
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}

/** Selected trace: pads, path, rendering and copper size (all undoable via `updateEdge`). */
function TracePanel({ flow, edge, byId }: { flow: Flow; edge: EdgeSnapshot<NetData>; byId: Map<string, PartData> }) {
  const net = edge.data?.net
  const render = edge.render ?? 'default'
  const num = (v: string) => (v === '' ? undefined : Math.max(0.005, Number(v)))
  return (
    <div className="fields" key={edge.id}>
      <div className="title">
        trace <span className="dot" style={{ background: hex(edge.color) }} /> <b>{net ?? '?'}</b>
      </div>
      <div className="muted">
        {pinLabel(byId.get(edge.source)?.ref, edge.sourceHandle)} → {pinLabel(byId.get(edge.target)?.ref, edge.targetHandle)}
      </div>
      <label>
        path
        <select value={edge.path ?? 'straight'}
          onChange={(e) => flow.updateEdge(edge.id, { path: e.target.value as 'straight' | 'bezier' })}>
          <option value="straight">straight</option>
          <option value="bezier">curve (bezier)</option>
        </select>
      </label>
      <label>
        render
        <select value={render}
          onChange={(e) => flow.updateEdge(edge.id, {
            render: e.target.value === 'default' ? undefined : (e.target.value as EdgeRender),
          })}>
          <option value="default">toolbar default</option>
          <option value="tube">mesh (tube)</option>
          <option value="line">line</option>
        </select>
      </label>
      {(['width', 'height'] as const).map((f) => (
        <label key={f + edge[f]}>
          {f}
          <input type="number" step={0.01} min={0.005} defaultValue={edge[f] ?? ''} placeholder="default"
            onBlur={(e) => flow.updateEdge(edge.id, { [f]: num(e.currentTarget.value) })}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
        </label>
      ))}
      <div className="muted">Width/height apply to mesh traces. Ctrl+Z undoes edits.</div>
    </div>
  )
}
