/**
 * Client-side in-memory catalog cache shared across all market surfaces
 * (left navigation, right sidebar, Plugins tab).
 *
 * Avoids re-fetching and re-parsing the multi-megabyte catalog over RPC every
 * time the user leaves and re-enters the marketplace, while still re-syncing
 * with the Host after reconnects, explicit refreshes, or when the Host may
 * have finished a background stale-while-revalidate refresh.
 */
import type { MarketCatalogResult } from '../contract.ts'

/** How long a fresh client copy is reused without re-asking the Host. */
export const CLIENT_CATALOG_TTL_MS = 5 * 60 * 1_000

/** Shorter sync window when the cached copy is past the Host's refresh interval (SWR in progress). */
const HOST_STALE_WINDOW_MS = 6 * 60 * 60 * 1_000
const CLIENT_SWR_SYNC_MS = 15 * 1_000

/** Milestones shown in the cold-load progress state before the first catalog arrives. */
export type CatalogLoadingStage = 'connect' | 'download' | 'index' | 'slow'

/**
 * Compute a smooth, monotonic progress percentage and stage label from elapsed
 * cold-load time. Approaches 94% asymptotically so the bar keeps moving gently
 * on slow networks without ever faking completion before the catalog lands.
 */
export function loadingProgressOf(elapsedMs: number): { readonly percent: number; readonly stage: CatalogLoadingStage } {
  const t = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0
  if (t < 1_500) {
    return { percent: Math.round(6 + (t / 1_500) * 22), stage: 'connect' }
  }
  if (t < 5_000) {
    return { percent: Math.round(28 + ((t - 1_500) / 3_500) * 36), stage: 'download' }
  }
  if (t < 9_500) {
    return { percent: Math.round(64 + ((t - 5_000) / 4_500) * 20), stage: 'index' }
  }
  const extra = 10 * (1 - Math.exp(-(t - 9_500) / 14_000))
  return { percent: Math.min(94, Math.round(84 + extra)), stage: 'slow' }
}

export interface ClientCatalogCache {
  /** Synchronously return the last successful catalog, if any. */
  peek: () => MarketCatalogResult | null
  /** Read the catalog, reusing memory cache and coalescing concurrent requests. */
  load: (force: boolean) => Promise<MarketCatalogResult>
  /** Mark the cached copy for re-sync on the next read without blanking the UI. */
  invalidate: () => void
}

type CacheSlot =
  | { readonly status: 'empty' }
  | { readonly status: 'fresh'; readonly result: MarketCatalogResult; readonly cachedAt: number }
  | { readonly status: 'invalidated'; readonly result: MarketCatalogResult }

type FlightSlot =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly force: boolean; readonly seq: number; readonly promise: Promise<MarketCatalogResult> }

export function createClientCatalogCache(
  fetchCatalog: (force: boolean) => Promise<MarketCatalogResult>,
  now: () => number = () => Date.now(),
): ClientCatalogCache {
  let cache: CacheSlot = { status: 'empty' }
  let flight: FlightSlot = { status: 'idle' }
  let generation = 0

  const currentCached = (): MarketCatalogResult | null =>
    cache.status === 'empty' ? null : cache.result

  const isFresh = (): boolean => {
    if (cache.status !== 'fresh') return false
    const { result, cachedAt } = cache
    if (result.catalog === null || result.stale) return false
    const age = now() - cachedAt
    const refreshedMs = Date.parse(result.catalog.refreshedAt)
    const hostFresh = Number.isFinite(refreshedMs) && now() - refreshedMs < HOST_STALE_WINDOW_MS
    const ttl = hostFresh ? CLIENT_CATALOG_TTL_MS : CLIENT_SWR_SYNC_MS
    return age >= 0 && age < ttl
  }

  return {
    peek: currentCached,
    invalidate: () => {
      generation += 1
      if (cache.status === 'fresh') {
        cache = { status: 'invalidated', result: cache.result }
      }
      flight = { status: 'idle' }
    },
    load: async (force) => {
      if (!force && isFresh() && cache.status === 'fresh') return cache.result
      if (flight.status === 'loading' && (!force || flight.force)) return await flight.promise
      const seq = ++generation
      const promise = (async (): Promise<MarketCatalogResult> => {
        try {
          const result = await fetchCatalog(force)
          if (seq === generation && result.catalog !== null) {
            cache = { status: 'fresh', result, cachedAt: now() }
          }
          return result
        } catch (error) {
          const fallback = currentCached()
          if (fallback !== null && fallback.catalog !== null) {
            const message = error instanceof Error ? error.message : String(error)
            return { catalog: fallback.catalog, stale: true, error: message }
          }
          throw error
        } finally {
          if (flight.status === 'loading' && flight.seq === seq) {
            flight = { status: 'idle' }
          }
        }
      })()
      flight = { status: 'loading', force, seq, promise }
      return await promise
    },
  }
}
