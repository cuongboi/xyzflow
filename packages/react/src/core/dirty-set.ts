/**
 * Allocation-free set of dirty slot indices.
 *
 * `add` is O(1) and de-duplicated through a flag array, iteration walks a dense
 * list, and `clear` only resets the touched flags. `markAll` short-circuits
 * everything for full re-uploads (e.g. after a buffer reallocation).
 */
export class DirtySet {
  private flags: Uint8Array
  /** Dense list of dirty indices; valid range is `[0, size)`. */
  list: Int32Array
  size = 0
  all = false

  constructor(capacity = 64) {
    this.flags = new Uint8Array(capacity)
    this.list = new Int32Array(capacity)
  }

  get isEmpty(): boolean {
    return !this.all && this.size === 0
  }

  add(index: number): void {
    if (this.all) return
    if (index >= this.flags.length) this.grow(index + 1)
    if (this.flags[index] === 0) {
      this.flags[index] = 1
      this.list[this.size++] = index
    }
  }

  markAll(): void {
    this.all = true
  }

  clear(): void {
    const { flags, list } = this
    for (let k = 0; k < this.size; k++) flags[list[k]] = 0
    this.size = 0
    this.all = false
  }

  private grow(min: number): void {
    let cap = Math.max(16, this.flags.length * 2)
    while (cap < min) cap *= 2
    const flags = new Uint8Array(cap)
    flags.set(this.flags)
    const list = new Int32Array(cap)
    list.set(this.list.subarray(0, this.size))
    this.flags = flags
    this.list = list
  }
}
