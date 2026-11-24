/**
 * Local per-server description notes for custom MCP servers.
 *
 * `dsh-mcp-manager` Settings does not carry a `description` field on server
 * entries, so `dsh-market-pro` persists optional user descriptions locally in
 * `localStorage` and surfaces them on MCP cards and in the editor.
 * @module dsh-market-pro/client/mcpDescriptions
 */

const STORAGE_KEY = 'dsh-market-pro:mcp-descriptions:v1'
export const MCP_DESCRIPTION_MAX_LENGTH = 300
const MAX_ENTRIES = 200

export type McpDescriptionMap = Readonly<Record<string, string>>

const listeners = new Set<() => void>()
let cachedRaw: string | null | undefined
let cachedMap: McpDescriptionMap = {}
let memoryOverride = false
let storageListenerAttached = false

function browserStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    return null
  }
}

/** Collapse whitespace, trim, and bound one local MCP description to {@link MCP_DESCRIPTION_MAX_LENGTH}. */
export function normalizeMcpDescription(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, MCP_DESCRIPTION_MAX_LENGTH)
}

function parseMap(raw: string | null): McpDescriptionMap {
  if (raw === null || raw === '') return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    let count = 0
    for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
      if (count >= MAX_ENTRIES) break
      if (typeof val !== 'string') continue
      const name = key.trim()
      const text = normalizeMcpDescription(val)
      if (name === '' || text === '') continue
      out[name] = text
      count += 1
    }
    return out
  } catch {
    return {}
  }
}

function notify(): void {
  for (const listener of listeners) listener()
}

function ensureStorageListener(): void {
  if (storageListenerAttached || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
  storageListenerAttached = true
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      cachedRaw = undefined
      memoryOverride = false
      notify()
    }
  })
}

/** Read the current local MCP description map (stable reference for `useSyncExternalStore`). */
export function getMcpDescriptions(storage: Storage | null = browserStorage()): McpDescriptionMap {
  if (storage === null || memoryOverride) return cachedMap
  let raw: string | null = null
  try {
    raw = storage.getItem(STORAGE_KEY)
  } catch {
    return cachedMap
  }
  if (raw === cachedRaw) return cachedMap
  cachedRaw = raw
  cachedMap = parseMap(raw)
  return cachedMap
}

/** Read one server's saved local description, or `''` when unset. */
export function getMcpDescription(name: string, storage: Storage | null = browserStorage()): string {
  return getMcpDescriptions(storage)[name.trim()] ?? ''
}

function writeMap(next: Record<string, string>, storage: Storage | null): void {
  const keys = Object.keys(next)
  const bounded: Record<string, string> = keys.length <= MAX_ENTRIES
    ? next
    : Object.fromEntries(keys.slice(-MAX_ENTRIES).map(key => [key, next[key]!]))
  const serialized = Object.keys(bounded).length === 0 ? '' : JSON.stringify(bounded)
  let persisted = false
  if (storage !== null) {
    try {
      if (serialized === '') storage.removeItem(STORAGE_KEY)
      else storage.setItem(STORAGE_KEY, serialized)
      persisted = true
    } catch {
      // Ignore quota / private-mode storage errors; keep in-memory cache authoritative.
    }
  }
  memoryOverride = storage !== null && !persisted
  cachedRaw = serialized === '' ? null : serialized
  cachedMap = bounded
  notify()
}

/** Save, update, clear, or rename a server's local description. */
export function saveMcpDescription(
  name: string,
  description: string,
  previousName?: string,
  storage: Storage | null = browserStorage(),
): void {
  const trimmedName = name.trim()
  const prev = previousName?.trim()
  const text = normalizeMcpDescription(description)
  const current = getMcpDescriptions(storage)
  const next: Record<string, string> = { ...current }
  if (prev && prev !== trimmedName) delete next[prev]
  if (trimmedName !== '') {
    delete next[trimmedName]
    if (text !== '') next[trimmedName] = text
  }
  writeMap(next, storage)
}

/** Remove a deleted server's local description, if any. */
export function deleteMcpDescription(name: string, storage: Storage | null = browserStorage()): void {
  const trimmedName = name.trim()
  if (trimmedName === '') return
  const current = getMcpDescriptions(storage)
  if (!Object.hasOwn(current, trimmedName)) return
  const next: Record<string, string> = { ...current }
  delete next[trimmedName]
  writeMap(next, storage)
}

/** Subscribe to local MCP description changes (compatible with `useSyncExternalStore`). */
export function subscribeMcpDescriptions(listener: () => void): () => void {
  ensureStorageListener()
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
