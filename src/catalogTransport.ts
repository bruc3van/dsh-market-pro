/**
 * HTTP redirect/decompression transport and hedged mirror racing shared by
 * the catalog feed and its sidecar metadata reader.
 */
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib'

/** One attempt against one base; a chain of three costs at most three times this. */
export const FETCH_TIMEOUT_MS = 20_000

/** Bound both the response stream and decompression. The compact v4 feed is ~11.6 MiB. */
export const MAX_CATALOG_BYTES = 64 * 1024 * 1024

/** unpkg and npmmirror answer every `@latest` path with a 302; a few more hops is already a loop. */
export const MAX_REDIRECTS = 5

/**
 * Maximum backward drift treated as a lagging `@latest` mirror cache across
 * different hosts. Larger backward jumps (e.g. an upstream rollback or a prior
 * clock-skewed future timestamp) are accepted so the cache can never lock up.
 */
export const STALE_MIRROR_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message === '' ? 'unknown error' : error.message
  const value = String(error)
  return value === '' ? 'unknown error' : value
}

/** A short host label for an error that names failed mirror attempts. */
export function baseLabel(base: string): string {
  try { return new URL(base).host } catch { return base }
}

/**
 * Fetch one URL, following redirects by hand. The DSH host's sandboxed fetch
 * does not follow them itself, and unpkg answers every `@latest` path with a
 * 302 to the pinned version. The whole chain shares one timeout; a hop that
 * leaves the origin drops the ETag (it certifies the first server's content
 * only), and a hop down from https to http is refused.
 */
export async function fetchFollowing(
  url: string,
  etag: string,
  abortSignal?: AbortSignal,
  acceptEncoding = 'gzip',
): Promise<Response> {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS)
  const signal = abortSignal === undefined ? timeout : AbortSignal.any([timeout, abortSignal])
  const origin = new URL(url).origin
  let current = url
  for (let hop = 0; ; hop += 1) {
    const sameOrigin = new URL(current).origin === origin
    const response = await fetch(current, {
      signal,
      // A cold catalog read is ~15–19 MB of JSON; asking for gzip turns that
      // into ~4–6 MB over the wire. gzip specifically (not br): its magic
      // number lets `readJson` decode the body even when the host fetch
      // wrapper hands compressed bytes through with an unexpected header shape.
      // Passing `'identity'` (used for `.tgz` downloads) skips redundant wire
      // compression.
      headers: etag !== '' && sameOrigin
        ? { 'accept-encoding': acceptEncoding, 'if-none-match': etag }
        : { 'accept-encoding': acceptEncoding },
    })
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    const location = response.headers.get('location')
    if (location === null || location === '') throw new Error(`catalog HTTP ${String(response.status)} without a location`)
    if (hop + 1 > MAX_REDIRECTS) throw new Error('catalog redirected too many times')
    const next = new URL(location, current)
    if (next.protocol !== 'https:' && !(next.protocol === 'http:' && new URL(current).protocol === 'http:')) {
      throw new Error(`catalog redirected to an unsupported URL (${next.protocol})`)
    }
    // Drain the redirect body so the connection can be reused.
    await response.body?.cancel().catch(() => undefined)
    current = next.href
  }
}

/**
 * Parse a JSON body that may arrive still compressed. A body that starts
 * (after whitespace) with `{` or `[` is already plain text whatever
 * `content-encoding` claims; anything else is decoded before parsing.
 */
export async function readJson(response: Response): Promise<unknown> {
  const tooLarge = 'catalog exceeds the 64 MiB size limit'
  if (Number(response.headers.get('content-length')) > MAX_CATALOG_BYTES) {
    void response.body?.cancel().catch(() => undefined)
    throw new Error(tooLarge)
  }
  if (response.body === null) throw new Error('catalog response is empty')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_CATALOG_BYTES) {
        void reader.cancel().catch(() => undefined)
        throw new Error(tooLarge)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  let bytes = chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks, length)
  let start = 0
  while (start < bytes.length && (bytes[start] === 0x20 || bytes[start] === 0x09 || bytes[start] === 0x0a || bytes[start] === 0x0d)) start += 1
  const plain = bytes[start] === 0x7b || bytes[start] === 0x5b || (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
  if (!plain) {
    const encoding = (response.headers.get('content-encoding') ?? '').trim().toLowerCase()
    const options = { maxOutputLength: MAX_CATALOG_BYTES }
    try {
      if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes, options)
      else if (encoding === 'br') bytes = brotliDecompressSync(bytes, options)
      else if (encoding === 'deflate') bytes = inflateSync(bytes, options)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') throw new Error(tooLarge)
      throw error
    }
  }
  return JSON.parse(new TextDecoder().decode(bytes))
}

export function isAllowedTarballUrl(metadataUrl: string, tarballUrl: string): boolean {
  try {
    const meta = new URL(metadataUrl)
    const target = new URL(tarballUrl)
    if (target.protocol !== 'https:' && !(target.protocol === 'http:' && meta.protocol === 'http:')) return false
    if (target.host === meta.host) return true
    return meta.host === 'registry.npmmirror.com'
      && target.port === ''
      && (target.hostname === 'cdn.npmmirror.com' || target.hostname.endsWith('.npmmirror.com'))
  } catch {
    return false
  }
}

export function parseSnapshotTime(value: string): number {
  if (value === '') return Number.NaN
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : Number.NaN
}

/** Whether `candidateFetchedAt` is within the cross-mirror stale-cache window behind `currentFetchedAt`. */
export function isStaleMirrorSnapshot(candidateFetchedAt: string, currentFetchedAt: string): boolean {
  const candidateMs = parseSnapshotTime(candidateFetchedAt)
  const currentMs = parseSnapshotTime(currentFetchedAt)
  if (!Number.isFinite(candidateMs) || !Number.isFinite(currentMs)) return false
  const lagMs = currentMs - candidateMs
  return lagMs > 0 && lagMs <= STALE_MIRROR_WINDOW_MS
}

type HedgedRaceState =
  | { readonly status: 'racing'; readonly nextIndex: number; readonly active: number; readonly hedgeTimer?: ReturnType<typeof setTimeout> }
  | { readonly status: 'settled' }

export interface MirrorRaceOptions<T> {
  readonly targets: readonly string[]
  readonly hedgeDelayMs: number
  readonly bodyHedgeDelayMs: number
  readonly disposeSignal?: AbortSignal
  readonly attempt: (target: string, abortSignal: AbortSignal | undefined, onHeaders?: () => void) => Promise<T>
  readonly evaluate: (outcome: T) => { readonly accept: true; readonly value: T } | { readonly accept: false }
  readonly onExhausted: (sawRejected: boolean, failures: readonly (string | undefined)[]) => T | Promise<T>
}

/**
 * Execute a single-source attempt or a TTFB/body-grace hedged race across ordered mirrors.
 */
export async function runMirrorRace<T>(options: MirrorRaceOptions<T>): Promise<T> {
  const { targets, hedgeDelayMs, bodyHedgeDelayMs, disposeSignal, attempt, evaluate, onExhausted } = options
  if (targets.length === 0) {
    return await onExhausted(false, [])
  }
  if (targets.length === 1) {
    const outcome = await attempt(targets[0]!, disposeSignal)
    const verdict = evaluate(outcome)
    if (verdict.accept) return verdict.value
    return await onExhausted(true, [])
  }

  return await new Promise<T>((resolve, reject) => {
    const raceController = new AbortController()
    const combinedSignal = disposeSignal === undefined
      ? raceController.signal
      : AbortSignal.any([raceController.signal, disposeSignal])
    const failures: Array<string | undefined> = Array.from({ length: targets.length }, () => undefined)
    let race: HedgedRaceState = { status: 'racing', nextIndex: 0, active: 0 }
    let sawRejected = false

    const clearHedgeTimer = (): void => {
      if (race.status === 'racing' && race.hedgeTimer !== undefined) {
        clearTimeout(race.hedgeTimer)
        race = { status: 'racing', nextIndex: race.nextIndex, active: race.active }
      }
    }

    const settle = (onSettled: () => void): void => {
      if (race.status === 'settled') return
      if (race.hedgeTimer !== undefined) clearTimeout(race.hedgeTimer)
      race = { status: 'settled' }
      raceController.abort()
      onSettled()
    }

    const scheduleHedge = (delayMs: number): void => {
      clearHedgeTimer()
      if (race.status !== 'racing' || race.nextIndex >= targets.length) return
      const hedgeTimer = setTimeout(() => {
        if (race.status !== 'racing') return
        race = { status: 'racing', nextIndex: race.nextIndex, active: race.active }
        launchNext()
      }, delayMs)
      race = { ...race, hedgeTimer }
    }

    const finishExhausted = (): void => {
      settle(() => {
        Promise.resolve()
          .then(() => onExhausted(sawRejected, failures))
          .then(resolve, reject)
      })
    }

    const launchNext = (): void => {
      if (race.status !== 'racing' || race.nextIndex >= targets.length) return
      const idx = race.nextIndex
      const target = targets[idx]!
      let attemptExtended = false
      race = { ...race, nextIndex: idx + 1, active: race.active + 1 }
      scheduleHedge(hedgeDelayMs)
      void attempt(target, combinedSignal, () => {
        // Valid response headers arrived for the latest launched attempt:
        // switch its tight TTFB hedge to the body-transfer grace period once
        // so healthy downloads avoid redundant mirrors while stalled streams still fail over.
        if (
          race.status === 'racing'
          && !attemptExtended
          && idx === race.nextIndex - 1
          && race.nextIndex < targets.length
        ) {
          attemptExtended = true
          scheduleHedge(bodyHedgeDelayMs)
        }
      }).then(
        (outcome) => {
          if (race.status === 'settled') return
          let verdict: ReturnType<typeof evaluate>
          try {
            verdict = evaluate(outcome)
          } catch (error) {
            settle(() => reject(error))
            return
          }
          if (!verdict.accept) {
            sawRejected = true
            race = { ...race, active: race.active - 1 }
            if (race.nextIndex < targets.length && race.active === 0) {
              clearHedgeTimer()
              launchNext()
              return
            }
            if (race.active === 0 && race.nextIndex >= targets.length) {
              finishExhausted()
            }
            return
          }
          settle(() => resolve(verdict.value))
        },
        (error: unknown) => {
          if (race.status === 'settled') return
          race = { ...race, active: race.active - 1 }
          if (disposeSignal?.aborted) {
            settle(() => reject(error))
            return
          }
          failures[idx] = `${baseLabel(target)}: ${errorText(error)}`
          if (race.nextIndex < targets.length && race.active === 0) {
            clearHedgeTimer()
            launchNext()
            return
          }
          if (race.active === 0 && race.nextIndex >= targets.length) {
            finishExhausted()
          }
        },
      )
    }

    launchNext()
  })
}
