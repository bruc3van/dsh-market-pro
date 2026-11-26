import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  STAR_PROMPT_OPEN_THRESHOLD,
  STAR_PROMPT_STORAGE_KEY,
  recordMarketOpen,
  settleStarPrompt,
  starPromptPending,
} from '../src/client/starPrompt.ts'

/** In-memory Storage shim — the module only ever touches getItem/setItem. */
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: (key) => { map.delete(key) },
    clear: () => { map.clear() },
    key: index => [...map.keys()][index] ?? null,
    get length() { return map.size },
  } as Storage
}

test('the star nudge stays silent before the threshold and arms at it', () => {
  const storage = memoryStorage()
  for (let open = 1; open < STAR_PROMPT_OPEN_THRESHOLD; open += 1) {
    assert.equal(recordMarketOpen(storage), false, `open ${String(open)} must not arm the nudge`)
  }
  assert.equal(recordMarketOpen(storage), true)
  // Once armed it keeps showing on later openings until answered either way.
  assert.equal(recordMarketOpen(storage), true)
})

test('answering the star nudge — starred or dismissed — is terminal', () => {
  for (const outcome of ['starred', 'dismissed'] as const) {
    const storage = memoryStorage()
    for (let open = 0; open < STAR_PROMPT_OPEN_THRESHOLD; open += 1) recordMarketOpen(storage)
    settleStarPrompt(outcome, storage)
    assert.equal(starPromptPending(storage), false)
    assert.equal(recordMarketOpen(storage), false)
  }
})

test('a corrupted or unparsable record reads as a fresh count rather than throwing', () => {
  const storage = memoryStorage()
  storage.setItem(STAR_PROMPT_STORAGE_KEY, 'not json at all')
  assert.equal(recordMarketOpen(storage), false)
  storage.setItem(STAR_PROMPT_STORAGE_KEY, JSON.stringify({ opens: 'many', status: 'weird' }))
  assert.equal(recordMarketOpen(storage), false)
  // A surviving terminal answer is still honored after the rewrite.
  storage.setItem(STAR_PROMPT_STORAGE_KEY, JSON.stringify({ opens: 99, status: 'starred' }))
  assert.equal(recordMarketOpen(storage), false)
})

test('without storage the counting is a no-op that never arms', () => {
  assert.equal(recordMarketOpen(null), false)
  assert.equal(starPromptPending(null), true)
  settleStarPrompt('dismissed', null)
})
