type CacheEntry<T> = {
  key: string
  at: number
  data: T
}

type InFlightEntry<T> = {
  key: string
  promise: Promise<T>
}

export type PortalDataCache<T> = {
  get: (key: string, loader: () => Promise<T>) => Promise<T>
  clear: () => void
}

export function createPortalDataCache<T>(options: { ttlMs: number }): PortalDataCache<T> {
  let entry: CacheEntry<T> | undefined
  let inFlight: InFlightEntry<T> | undefined

  return {
    async get(key, loader) {
      const now = Date.now()
      if (entry && entry.key === key && now - entry.at < options.ttlMs) {
        return entry.data
      }

      if (inFlight?.key === key) return inFlight.promise

      const promise = loader()
        .then((data) => {
          if (inFlight?.key === key && inFlight.promise === promise) inFlight = undefined
          entry = { key, at: Date.now(), data }
          return data
        })
        .catch((error) => {
          if (inFlight?.key === key && inFlight.promise === promise) inFlight = undefined
          throw error
        })

      inFlight = { key, promise }
      return promise
    },
    clear() {
      entry = undefined
      inFlight = undefined
    },
  }
}

export function officeRevisionCacheControl(revision: string | undefined | null) {
  return revision?.trim() ? "public, max-age=31536000, immutable" : "no-store"
}
