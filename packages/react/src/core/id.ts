const SESSION = Math.random().toString(36).slice(2, 7)
let seq = 0

/** Fast, collision-safe-per-session id. Much cheaper than `crypto.randomUUID()` for 100k inserts. */
export function createId(prefix: string): string {
  return `${prefix}-${SESSION}-${(++seq).toString(36)}`
}
