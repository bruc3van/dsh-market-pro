/**
 * Two-edge fallback for jsDelivr plugin icons (`cdn` -> `fastly`), tailored
 * for direct China network environments where `cdn.jsdelivr.net` may stall or
 * drop packets while the official Fastly edge remains reachable.
 *
 * Non-jsDelivr URLs (data URIs, other HTTPS hosts) are passed straight through
 * untouched. Keeping the fallback chain to two official edges caps wasted
 * requests on 404 icons (e.g. renamed repositories), and requiring consecutive
 * verified failovers before promoting an edge avoids switching the whole
 * session on a single transient hiccup.
 */

export const JSDELIVR_HOSTS = [
  'cdn.jsdelivr.net',
  'fastly.jsdelivr.net',
] as const

export type JsDelivrHost = (typeof JSDELIVR_HOSTS)[number]

/** Consecutive failover loads required before promoting an alternate jsDelivr edge for the session. */
export const JSDELIVR_PROMOTE_THRESHOLD = 2

const JSDELIVR_HOST_SET = new Set<string>(JSDELIVR_HOSTS)

/** Session-scoped preferred jsDelivr edge learned after consecutive verified failovers. */
let preferredJsDelivrHost: JsDelivrHost | null = null
let pendingPromoteHost: JsDelivrHost | null = null
let pendingPromoteCount = 0

/** Inspect the session-preferred jsDelivr edge (used by tests). */
export function getPreferredJsDelivrHost(): JsDelivrHost | null {
  return preferredJsDelivrHost
}

/** Reset the session-preferred jsDelivr edge and failover counters (used by tests). */
export function resetPreferredJsDelivrHost(): void {
  preferredJsDelivrHost = null
  pendingPromoteHost = null
  pendingPromoteCount = 0
}

function parseJsDelivrUrl(raw: string): URL | null {
  if (!raw.startsWith('https://')) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null
    if (!JSDELIVR_HOST_SET.has(url.hostname)) return null
    return url
  } catch {
    return null
  }
}

/**
 * Expand a single icon `src` into an ordered candidate list:
 * - Data URIs and non-jsDelivr URLs return `[src]` unchanged.
 * - jsDelivr URLs expand to at most two official edges (`cdn`, `fastly`).
 *   If earlier icons already proved the alternate edge works after repeated
 *   failures, that edge is placed first.
 */
export function iconCandidatesOf(src: string | undefined): string[] {
  const trimmed = typeof src === 'string' ? src.trim() : ''
  if (trimmed === '') return []
  const parsed = parseJsDelivrUrl(trimmed)
  if (parsed === null) return [trimmed]

  const originHost = parsed.hostname as JsDelivrHost
  const hostOrder: JsDelivrHost[] = []
  const pushHost = (host: JsDelivrHost) => {
    if (!hostOrder.includes(host)) hostOrder.push(host)
  }
  if (preferredJsDelivrHost !== null) pushHost(preferredJsDelivrHost)
  pushHost(originHost)
  for (const host of JSDELIVR_HOSTS) pushHost(host)

  return hostOrder.map(host => {
    if (host === originHost) return trimmed
    const next = new URL(parsed.href)
    next.hostname = host
    return next.href
  })
}

/**
 * Record a completed image load for a jsDelivr icon:
 * - A first-try load (`failedBeforeLoad === false`) resets any pending failover streak.
 * - A fallback load (`failedBeforeLoad === true`) increments the streak for that
 *   edge and promotes it once {@link JSDELIVR_PROMOTE_THRESHOLD} consecutive
 *   failovers succeed, preventing a single transient error from flipping the session.
 */
export function noteIconLoaded(originalSrc: string | undefined, loadedUrl: string, failedBeforeLoad: boolean): void {
  if (typeof originalSrc !== 'string' || parseJsDelivrUrl(originalSrc.trim()) === null) return
  const loaded = parseJsDelivrUrl(loadedUrl)
  if (loaded === null) return
  const host = loaded.hostname as JsDelivrHost
  if (!failedBeforeLoad) {
    pendingPromoteHost = null
    pendingPromoteCount = 0
    return
  }
  if (host === preferredJsDelivrHost) {
    pendingPromoteHost = null
    pendingPromoteCount = 0
    return
  }
  if (pendingPromoteHost === host) {
    pendingPromoteCount += 1
  } else {
    pendingPromoteHost = host
    pendingPromoteCount = 1
  }
  if (pendingPromoteCount >= JSDELIVR_PROMOTE_THRESHOLD) {
    preferredJsDelivrHost = host
    pendingPromoteHost = null
    pendingPromoteCount = 0
  }
}
