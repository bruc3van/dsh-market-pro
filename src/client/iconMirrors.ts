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

/** Ordered deduplicated candidate chain for one plugin logo, plus the identity key that resets failure state when it changes. */
export interface LogoSourceChain {
  readonly sources: readonly string[]
  readonly sourceKey: string
}

/**
 * Expand a plugin's icon into the full failover chain `PluginLogo` walks:
 * jsDelivr edges (or the single non-jsDelivr source) followed by the owner
 * avatar, deduplicated so an icon already pointing at the avatar is not tried twice.
 */
export function logoSourceChainOf(src: string | undefined, avatar: string | undefined): LogoSourceChain {
  const primarySources = iconCandidatesOf(src)
  const combined = [...primarySources, avatar].filter(
    (value, index, all): value is string => typeof value === 'string' && value !== '' && all.indexOf(value) === index,
  )
  return {
    sources: combined,
    sourceKey: `${typeof src === 'string' ? src.trim() : ''}\0${avatar ?? ''}`,
  }
}

/** Failure-chain position; `key` ties the count to one source identity so switching plugins starts over. */
export interface IconFailureState {
  readonly key: string
  readonly step: number
}

/** Advance the failover chain one step; a failure belonging to a different source identity restarts at step 1. */
export function advanceIconFailure(previous: IconFailureState, sourceKey: string): IconFailureState {
  return {
    key: sourceKey,
    step: (previous.key === sourceKey ? previous.step : 0) + 1,
  }
}

/** Chain position for rendering: failures recorded against a different source identity do not apply. */
export function currentIconStep(failure: IconFailureState, sourceKey: string): number {
  return failure.key === sourceKey ? failure.step : 0
}

/** First letter of the built-in placeholder tile, preferring the package part over the npm scope. */
export function logoPlaceholderLetter(name: string): string {
  const safeName = typeof name === 'string' ? name : ''
  return [...safeName.replace(/^@[^/]+\//, '').trim()][0]?.toLocaleUpperCase() || 'P'
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
