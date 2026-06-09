interface Headers {
  entries(): IterableIterator<[string, string]>
}

declare module "bun:test" {
  type Expectation = {
    toBe(value: unknown): void
    toEqual(value: unknown): void
    toContain(value: unknown): void
    toHaveLength(value: number): void
    toMatchObject(value: unknown): void
    toMatch(value: RegExp | string): void
    toBeUndefined(): void
    toBeGreaterThanOrEqual(value: number): void
    toThrow(expected?: RegExp | string | Error): void
    not: Expectation
  }

  export function describe(name: string, fn: () => void): void
  export function test(name: string, fn: () => unknown | Promise<unknown>): void
  export const expect: ((value: unknown) => Expectation) & {
    stringContaining(value: string): unknown
  }
}
