/** Seeded Mersenne Twister PRNG for deterministic layout generation. */
const N = 624
const M = 397
const MATRIX_A = 0x9908b0df
const UPPER_MASK = 0x80000000
const LOWER_MASK = 0x7fffffff

function initGenrand(state: Uint32Array, seed: number) {
  state[0] = seed >>> 0
  for (let mti = 1; mti < N; mti++) {
    const prev = state[mti - 1]! ^ (state[mti - 1]! >>> 30)
    state[mti] = (Math.imul(1812433253, prev) + mti) >>> 0
  }
}

function initByArray(seed: number) {
  const state = new Uint32Array(N)
  initGenrand(state, 19650218)
  const initKey = [seed >>> 0]
  let i = 1
  let j = 0
  let k = Math.max(N, initKey.length)
  for (; k; k--) {
    state[i] =
      (state[i]! ^ ((state[i - 1]! ^ (state[i - 1]! >>> 30)) * 1664525) + initKey[j]! + j) >>> 0
    i++
    j++
    if (i >= N) {
      state[0] = state[N - 1]!
      i = 1
    }
    if (j >= initKey.length) j = 0
  }
  for (k = N - 1; k; k--) {
    state[i] = (state[i]! ^ ((state[i - 1]! ^ (state[i - 1]! >>> 30)) * 1566083941) - i) >>> 0
    i++
    if (i >= N) {
      state[0] = state[N - 1]!
      i = 1
    }
  }
  state[0] = 0x80000000
  return state
}

export class PythonRandom {
  private state: Uint32Array
  private index = N

  constructor(seed: number) {
    this.state = initByArray(seed)
  }

  private genrandUint32() {
    const mag01 = [0, MATRIX_A]
    if (this.index >= N) {
      let kk = 0
      for (; kk < N - M; kk++) {
        const y = (this.state[kk]! & UPPER_MASK) | (this.state[kk + 1]! & LOWER_MASK)
        this.state[kk] = this.state[kk + M]! ^ (y >>> 1) ^ mag01[y & 1]!
      }
      for (; kk < N - 1; kk++) {
        const y = (this.state[kk]! & UPPER_MASK) | (this.state[kk + 1]! & LOWER_MASK)
        this.state[kk] = this.state[kk + (M - N)]! ^ (y >>> 1) ^ mag01[y & 1]!
      }
      const y = (this.state[N - 1]! & UPPER_MASK) | (this.state[0]! & LOWER_MASK)
      this.state[N - 1] = this.state[M - 1]! ^ (y >>> 1) ^ mag01[y & 1]!
      this.index = 0
    }
    let y = this.state[this.index]!
    this.index++
    y ^= y >>> 11
    y ^= (y << 7) & 0x9d2c5680
    y ^= (y << 15) & 0xefc60000
    y ^= y >>> 18
    return y >>> 0
  }

  random() {
    const a = this.genrandUint32() >>> 5
    const b = this.genrandUint32() >>> 6
    return (a * 67108864 + b) / 9007199254740992
  }

  private randbelow(n: number) {
    if (n <= 0) throw new Error("n must be positive")
    const k = 32 - Math.clz32(n - 1)
    let r = this.genrandUint32()
    if (k < 32) r >>>= 32 - k
    while (r >= n) {
      r = this.genrandUint32()
      if (k < 32) r >>>= 32 - k
    }
    return r
  }

  randint(a: number, b: number) {
    return this.randbelow(b - a + 1) + a
  }

  choice<T>(items: T[]) {
    return items[this.randbelow(items.length)]!
  }

  shuffle<T>(items: T[]) {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.randbelow(i + 1)
      const tmp = items[i]!
      items[i] = items[j]!
      items[j] = tmp
    }
  }
}
