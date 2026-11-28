/** Pure formatting helpers for the Refresh button's data-source tooltip. */
import type { MarketLocale } from './copy.ts'

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * Format an ISO timestamp (or `YYYY-MM-DD` date) into a compact local
 * `YYYY-MM-DD HH:mm` string for hover tooltips, or `''` when absent/invalid.
 */
export function formatRefreshTimestamp(iso: string | undefined): string {
  if (typeof iso !== 'string') return ''
  const trimmed = iso.trim()
  if (trimmed === '') return ''
  if (DATE_ONLY_PATTERN.test(trimmed)) return trimmed
  const parsed = Date.parse(trimmed)
  if (!Number.isFinite(parsed)) return ''
  const date = new Date(parsed)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/** Normalize a version string with a single leading `v`, or `''` when empty. */
export function formatVersionTag(version: string | undefined): string {
  if (typeof version !== 'string') return ''
  const trimmed = version.trim()
  if (trimmed === '') return ''
  return /^[vV]/.test(trimmed) ? `v${trimmed.slice(1)}` : `v${trimmed}`
}

/** Join non-empty tooltip segments with a middle dot, or `undefined` when empty. */
export function joinRefreshTooltip(parts: readonly (string | undefined | null)[]): string | undefined {
  const clean = parts.map(part => (typeof part === 'string' ? part.trim() : '')).filter(Boolean)
  return clean.length > 0 ? clean.join(' · ') : undefined
}

export interface RefreshTooltipOptions {
  readonly source: string
  readonly version?: string
  readonly extra?: string
  readonly timestamp?: string
  readonly timestampKind?: 'read' | 'updated'
}

/** Build a localized single-line refresh tooltip (`<source> [vX] · [extra] · <updated/read time>`). */
export function buildRefreshTooltip(t: MarketLocale, options: RefreshTooltipOptions): string | undefined {
  const versionTag = formatVersionTag(options.version)
  const head = [options.source.trim(), versionTag].filter(Boolean).join(' ')
  const formattedTime = formatRefreshTimestamp(options.timestamp)
  const timeLabel = formattedTime !== ''
    ? t(options.timestampKind === 'updated' ? 'refresh.updatedAt' : 'refresh.readAt', { time: formattedTime })
    : ''
  return joinRefreshTooltip([head, options.extra, timeLabel])
}
