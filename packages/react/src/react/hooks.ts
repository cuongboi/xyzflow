import { useCallback, useRef, useState, useSyncExternalStore } from 'react'
import { Flow, type FlowOptions } from '../core/flow'

/** Creates one `Flow` for the component's lifetime. */
export function useCreateFlow(options?: FlowOptions): Flow {
  const [flow] = useState(() => new Flow(options))
  return flow
}

export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  for (const k of ka) {
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
  }
  return true
}

/**
 * Subscribe DOM UI to the flow (works inside or outside the canvas).
 * Re-renders only when the selected value changes (shallow compare by default).
 * Not called during drags, since moves commit once on pointer-up.
 *
 * @example const { nodes, canUndo } = useFlowState(flow, f => ({ nodes: f.nodeCount, canUndo: f.canUndo }))
 */
export function useFlowState<T>(
  flow: Flow,
  selector: (flow: Flow) => T,
  isEqual: (a: T, b: T) => boolean = shallowEqual,
): T {
  const cache = useRef<{ value: T } | null>(null)
  const subscribe = useCallback(
    (cb: () => void) => {
      const offs = [flow.on('change', cb), flow.on('selection', cb), flow.on('history', cb)]
      return () => offs.forEach((off) => off())
    },
    [flow],
  )
  const getSnapshot = (): T => {
    const next = selector(flow)
    const prev = cache.current
    if (prev && isEqual(prev.value, next)) return prev.value
    cache.current = { value: next }
    return next
  }
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
