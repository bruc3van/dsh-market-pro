/**
 * Per-browser persistence for ignored plugin updates ("ignore this version" or
 * "mute all updates for this plugin").
 *
 * Stored in `localStorage` so the choice survives restarts and never leaves
 * the machine. Corrupt or blocked storage safely degrades to an empty map.
 * @module dsh-market-pro/client/updateIgnore
 */
import { compareSemverStrings } from '../compatibility.ts'

export const IGNORED_UPDATES_STORAGE_KEY = 'dsh-market-pro:ignored-updates:v1'

export type IgnoredUpdateRule =
  | { readonly mode: 'version'; readonly version: string }
  | { readonly mode: 'all' }

export type IgnoredUpdatesMap = Readonly<Record<string, IgnoredUpdateRule>>

function browserStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    return null
  }
}

/** Normalize version strings (`v1.2.3` -> `1.2.3`) so probes and UI labels compare uniformly. */
export function normalizeIgnoredVersion(version: string): string {
  return version.trim().replace(/^v/i, '')
}

/** Return true when updating to `targetVersion` reaches or surpasses a version-specific ignore rule. */
export function shouldClearIgnoredVersion(rule: IgnoredUpdateRule | undefined, targetVersion: string): boolean {
  if (rule?.mode !== 'version') return false
  const target = normalizeIgnoredVersion(targetVersion)
  if (target === '') return false
  if (target === rule.version) return true
  const cmp = compareSemverStrings(target, rule.version)
  return cmp !== null && cmp >= 0
}

/** Return true when `version` is suppressed by `rule`. */
export function isUpdateIgnored(rule: IgnoredUpdateRule | undefined, version: string): boolean {
  if (rule === undefined) return false
  if (rule.mode === 'all') return true
  const normalized = normalizeIgnoredVersion(version)
  return normalized !== '' && normalized === rule.version
}

/** Read and validate persisted ignore rules from `storage`. */
export function readIgnoredUpdates(storage: Storage | null = browserStorage()): IgnoredUpdatesMap {
  if (storage === null) return {}
  let raw: string | null = null
  try {
    raw = storage.getItem(IGNORED_UPDATES_STORAGE_KEY)
  } catch {
    return {}
  }
  if (raw === null || raw === '') return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, IgnoredUpdateRule> = {}
    for (const [packageName, entry] of Object.entries(parsed)) {
      if (packageName.trim() === '' || entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
      const mode = (entry as { mode?: unknown }).mode
      if (mode === 'all') {
        out[packageName] = { mode: 'all' }
      } else if (mode === 'version') {
        const rawVersion = (entry as { version?: unknown }).version
        if (typeof rawVersion !== 'string') continue
        const clean = normalizeIgnoredVersion(rawVersion)
        if (clean !== '') out[packageName] = { mode: 'version', version: clean }
      }
    }
    return out
  } catch {
    return {}
  }
}

/** Persist ignore rules to `storage` (deleting the key when empty). */
export function writeIgnoredUpdates(rules: IgnoredUpdatesMap, storage: Storage | null = browserStorage()): void {
  if (storage === null) return
  try {
    if (Object.keys(rules).length === 0) {
      storage.removeItem(IGNORED_UPDATES_STORAGE_KEY)
    } else {
      storage.setItem(IGNORED_UPDATES_STORAGE_KEY, JSON.stringify(rules))
    }
  } catch {
    // Full or restricted storage degrades gracefully without disrupting update flows.
  }
}

/** Ignore a specific target version for `packageName`. */
export function withIgnoredVersion(
  rules: IgnoredUpdatesMap,
  packageName: string,
  version: string,
): IgnoredUpdatesMap {
  const clean = normalizeIgnoredVersion(version)
  if (packageName.trim() === '' || clean === '') return rules
  const current = rules[packageName]
  if (current?.mode === 'version' && current.version === clean) return rules
  return { ...rules, [packageName]: { mode: 'version', version: clean } }
}

/** Mute all future update prompts for `packageName`. */
export function withIgnoredAllUpdates(
  rules: IgnoredUpdatesMap,
  packageName: string,
): IgnoredUpdatesMap {
  if (packageName.trim() === '') return rules
  if (rules[packageName]?.mode === 'all') return rules
  return { ...rules, [packageName]: { mode: 'all' } }
}

/** Remove any ignore rule for `packageName`. */
export function withoutIgnoredUpdate(
  rules: IgnoredUpdatesMap,
  packageName: string,
): IgnoredUpdatesMap {
  if (!(packageName in rules)) return rules
  const { [packageName]: _removed, ...rest } = rules
  return rest
}
