/**
 * The one-time GitHub star nudge.
 *
 * Counts market openings in `localStorage` and, from the third open on,
 * offers a small dismissible card asking for a star — the moment a returning
 * user has demonstrably found the market useful. Clicking through or
 * dismissing is terminal: the card never nags again, and because the state
 * is per-browser it never leaves the machine either.
 * @module dsh-market-pro/client/starPrompt
 */

export const STAR_PROMPT_STORAGE_KEY = 'dsh-market-pro:star-prompt:v1'
/** The open count at which the nudge first appears. */
export const STAR_PROMPT_OPEN_THRESHOLD = 3
export const STAR_REPOSITORY_URL = 'https://github.com/bruc3van/dsh-market-pro'
/** Broadcast on `window` when any mounted market instance settles the nudge, so peers hide theirs too. */
export const STAR_SETTLED_EVENT = 'dsh-market-pro:star-settled'

type StarPromptStatus = 'counting' | 'dismissed' | 'starred'

interface StarPromptRecord {
  readonly opens: number
  readonly status: StarPromptStatus
}

const EMPTY: StarPromptRecord = { opens: 0, status: 'counting' }

function browserStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    return null
  }
}

function readRecord(storage: Storage | null): StarPromptRecord {
  if (storage === null) return EMPTY
  let raw: string | null = null
  try {
    raw = storage.getItem(STAR_PROMPT_STORAGE_KEY)
  } catch {
    return EMPTY
  }
  if (raw === null || raw === '') return EMPTY
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return EMPTY
    const opens = (parsed as { opens?: unknown }).opens
    const status = (parsed as { status?: unknown }).status
    return {
      opens: typeof opens === 'number' && Number.isFinite(opens) && opens >= 0 ? Math.floor(opens) : 0,
      status: status === 'dismissed' || status === 'starred' ? status : 'counting',
    }
  } catch {
    return EMPTY
  }
}

function writeRecord(record: StarPromptRecord, storage: Storage | null): void {
  if (storage === null) return
  try {
    storage.setItem(STAR_PROMPT_STORAGE_KEY, JSON.stringify(record))
  } catch {
    // A full or blocked storage simply never remembers — the nudge re-arms instead of crashing.
  }
}

/**
 * Count one market opening and answer whether the nudge should show now:
 * the threshold reached, and neither the star click nor a dismissal recorded.
 */
export function recordMarketOpen(storage: Storage | null = browserStorage()): boolean {
  const record = readRecord(storage)
  if (record.status !== 'counting') return false
  const next: StarPromptRecord = { opens: record.opens + 1, status: 'counting' }
  writeRecord(next, storage)
  return next.opens >= STAR_PROMPT_OPEN_THRESHOLD
}

/** Whether the nudge is still armed for a later open (exported for tests). */
export function starPromptPending(storage: Storage | null = browserStorage()): boolean {
  return readRecord(storage).status === 'counting'
}

/** Terminal answer to the nudge: the user clicked through or closed it — never ask again. */
export function settleStarPrompt(outcome: 'dismissed' | 'starred', storage: Storage | null = browserStorage()): void {
  const record = readRecord(storage)
  writeRecord({ opens: record.opens, status: outcome }, storage)
}
