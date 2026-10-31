/**
 * Core micro-benchmarks (no renderer). Run: `bun run bench` (or `bun ./bench/core.ts`).
 */
import { Flow } from '../src/core/flow'

function build(n: number) {
  const flow = new Flow()
  const ids = flow.addNodes(
    Array.from({ length: n }, (_, i) => ({
      position: { x: (i % 100) * 2, y: ((i / 10000) | 0) * 2, z: (((i / 100) | 0) % 100) * 2 },
    })),
    { history: false },
  )
  flow.addEdges(
    ids.slice(1).map((id, i) => ({ source: ids[i], target: id })),
    { history: false },
  )
  return { flow, ids }
}

function bench(name: string, fn: () => void, budgetMs = 500): void {
  for (let i = 0; i < 5; i++) fn() // warm up JIT
  let n = 0
  const t0 = performance.now()
  while (performance.now() - t0 < budgetMs) {
    fn()
    n++
  }
  const ms = (performance.now() - t0) / n
  const pretty = ms < 1 ? `${(ms * 1000).toFixed(1)} µs` : `${ms.toFixed(2)} ms`
  console.log(`${name.padEnd(44)} ${pretty.padStart(10)} / op   (${n} runs)`)
}

const N = 100_000
const { flow, ids } = build(N)
const selection = ids.slice(0, 1000)
const I = [0.05, 0, 0, 0, 0, 0.05, 0, 0, 0, 0, 0.05, 0, -1, -1, 0, 1]

console.log(`\ncore @ ${N.toLocaleString()} nodes / ${flow.edgeCount.toLocaleString()} edges\n`)
bench('pickRay (full scan, hover/click)', () => {
  flow.store.pickRay(-10, 1, -10, 0.577, 0.577, 0.577)
})
bench('drag 1k selected nodes (one frame)', () => {
  const s = flow.beginMove(selection)
  s.update(Math.random(), 0, Math.random())
  s.cancel()
})
bench('queryRect (box select)', () => {
  flow.store.queryRect(I, -0.5, -0.5, 0.5, 0.5)
})
bench('add 10k nodes + edges (batched, no history)', () => {
  build(10_000)
})
