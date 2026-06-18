/** Minimal browser globals for running portal shell modules under Bun. */
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>()
  globalThis.localStorage = {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key: string) {
      return store.get(key) ?? null
    },
    key(index: number) {
      return [...store.keys()][index] ?? null
    },
    removeItem(key: string) {
      store.delete(key)
    },
    setItem(key: string, value: string) {
      store.set(key, value)
    },
  }
  globalThis.localStorage.setItem("gatehouse/portal-locale", "zh")
}

if (typeof globalThis.navigator === "undefined") {
  globalThis.navigator = { language: "zh-CN" } as Navigator
}
