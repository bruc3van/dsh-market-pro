/**
 * Parsing, validation, and catalog hydration for `plugin-selection-meta.json`
 * sidecar metadata (bilingual search keywords and fallback Chinese summaries).
 */
import type { MarketCatalog, MarketFeatured, MarketPlugin } from './contract.ts'
import { REPOSITORY_SLUG_PATTERN } from './shapes.ts'
import { parseSnapshotTime, STALE_MIRROR_WINDOW_MS } from './catalogTransport.ts'

export interface ParsedSelectionMetaEntry {
  readonly summary: string
  readonly keywords: readonly string[]
}

export interface ParsedSelectionMeta {
  readonly feedVersion: string
  readonly publishedAt: string
  readonly sourceFetchedAt: string
  readonly entries: ReadonlyMap<string, ParsedSelectionMetaEntry>
}

const SELECTION_META_SUMMARY_LIMIT = 200
const SELECTION_META_KEYWORD_LIMIT = 50
const SELECTION_META_MAX_KEYWORDS = 15

const URL_ONLY_PATTERN = /^https?:\/\/\S+$/i
const HAS_TEXT_LETTER_PATTERN = /[\p{L}\p{Script=Han}]/u
const HAS_CJK_PATTERN = /\p{Script=Han}/u
const PLACEHOLDER_EN_PATTERN = /^(?:(?:a|an|my|the|simple|personal)\s+)?(?:(?:dsh|deepseek\s+harness)\s+)?(?:plugin|extension|skill|tool|repo|repository|project|bundle|package)\.?$/i
const GENERIC_TOKEN_PATTERN = /^(?:test|testing|demo|example|sample|template|wip|todo|tbd|none|null|n\/a|na)\.?$/i
const PLACEHOLDER_ZH_PATTERN = /^(?:(?:一个|我的|自用|个人)\s*)?(?:(?:dsh|deepseek\s+harness)\s*)?(?:插件|扩展|技能|工具)[。.]?$/i
const GENERIC_ZH_PATTERN = /^(?:测试|示例|演示|模板|暂无|无|待补充|待完善)[。.]?$/
const HYPE_SLOGAN_PATTERN = /(?:主打一个|最强|终极|神器|革命性|颠覆性|超强|全能|极致体验|非常好用|很好用|超级好用|必备插件|解放双手|让.*飞起来|\bbest\s+ever\b|\bultimate\b|\brevolutionary\b|\bgame[- ]?changer\b|\ball[- ]?in[- ]?one\b|\bmust[- ]?have\b|\bsuper\s+awesome\b|\bnext[- ]?gen(?:eration)?\s+(?:ai\s+)?(?:plugin|tool|experience)\b)/i
const UNINFORMATIVE_SUMMARY_PATTERN = /(?:无功能信息可查|按最中性类目归档|公开信息不足以判断|现有元数据中不充分|无从查证|具体工具范围不明|仓库无可用信息)/

/** Normalize and code-point-truncate untrusted catalog text without splitting surrogate pairs. */
export function clipCatalogText(value: unknown, limit: number): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.replace(/\s+/g, ' ').trim()
  const points = [...trimmed]
  return points.length > limit ? `${points.slice(0, limit - 1).join('')}…` : trimmed
}

/** `owner/name` with nothing else in it — the only shape a repository link is built from. */
export function repositorySlug(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return REPOSITORY_SLUG_PATTERN.test(value) ? value : null
}

/** Merge unique non-empty keywords case-insensitively while preserving existing order. */
export function mergeUniqueKeywords(
  existing: readonly string[] | undefined,
  extra: Iterable<string>,
  limit = 200,
): readonly string[] | undefined {
  const out: string[] = []
  const seen = new Set<string>()
  for (const word of existing ?? []) {
    const trimmed = word.trim()
    if (trimmed === '') continue
    const lower = trimmed.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)
    out.push(trimmed)
    if (out.length >= limit) break
  }
  let added = false
  for (const word of extra) {
    if (out.length >= limit) break
    const trimmed = word.trim()
    if (trimmed === '') continue
    const lower = trimmed.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)
    out.push(trimmed)
    added = true
  }
  if (!added) return existing
  return out
}

/** Map a direct v4 catalog JSON URL to its sibling `plugin-selection-meta.json` URL. */
export function selectionMetaUrlOf(base: string): string | null {
  try {
    const parsed = new URL(base.trim())
    if (!parsed.pathname.endsWith('/market-catalog-v4.json')) return null
    parsed.pathname = `${parsed.pathname.slice(0, -'market-catalog-v4.json'.length)}plugin-selection-meta.json`
    return parsed.href
  } catch {
    return null
  }
}

function parseFeedVersionDateMs(version: string): number {
  const match = /^0\.(\d{4})(\d{2})(\d{2})(?:\.\d+)?$/.exec(version.trim())
  if (match === null) return Number.NaN
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const ms = Date.UTC(year, month - 1, day)
  const date = new Date(ms)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return Number.NaN
  }
  return ms
}

/**
 * Whether a fetched sidecar drifts beyond the acceptable cross-mirror TTL window
 * from the catalog it is about to hydrate. Minor same-window drift (e.g. per-file
 * CDN edge caches differing by minutes or a few publishes) is tolerated; larger
 * divergence degrades gracefully by skipping sidecar hydration.
 */
export function isSidecarVersionSkewed(
  catalog: { readonly feedVersion: string; readonly publishedAt: string },
  sidecar: Pick<ParsedSelectionMeta, 'feedVersion' | 'publishedAt'>,
): boolean {
  const catPubMs = parseSnapshotTime(catalog.publishedAt)
  const sidePubMs = parseSnapshotTime(sidecar.publishedAt)
  if (Number.isFinite(catPubMs) && Number.isFinite(sidePubMs)) {
    return Math.abs(sidePubMs - catPubMs) > STALE_MIRROR_WINDOW_MS
  }
  const catVerMs = parseFeedVersionDateMs(catalog.feedVersion)
  const sideVerMs = parseFeedVersionDateMs(sidecar.feedVersion)
  if (Number.isFinite(catVerMs) && Number.isFinite(sideVerMs)) {
    return Math.abs(sideVerMs - catVerMs) > STALE_MIRROR_WINDOW_MS
  }
  return false
}

export function sidecarFreshnessStampOf(meta: ParsedSelectionMeta): string {
  return meta.publishedAt || meta.sourceFetchedAt
}

function* clippedKeywords(raw: readonly unknown[], scanLimit = 200): Iterable<string> {
  const limit = Math.min(raw.length, scanLimit)
  for (let i = 0; i < limit; i += 1) {
    const word = raw[i]
    if (typeof word === 'string') {
      yield clipCatalogText(word, SELECTION_META_KEYWORD_LIMIT)
    }
  }
}

/** Parse and bound the `plugin-selection-meta.json` sidecar envelope. */
export function parseSelectionMeta(raw: unknown): ParsedSelectionMeta | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const envelope = raw as {
    feed_version?: unknown
    published_at?: unknown
    source_fetched_at?: unknown
    meta?: unknown
  }
  if (envelope.meta === null || typeof envelope.meta !== 'object' || Array.isArray(envelope.meta)) {
    return undefined
  }
  const entries = new Map<string, ParsedSelectionMetaEntry>()
  for (const [rawKey, rawValue] of Object.entries(envelope.meta as Record<string, unknown>)) {
    const slug = repositorySlug(rawKey)
    if (slug === null || rawValue === null || typeof rawValue !== 'object' || Array.isArray(rawValue)) continue
    const rec = rawValue as { s?: unknown; k?: unknown }
    const summary = clipCatalogText(rec.s, SELECTION_META_SUMMARY_LIMIT)
    const keywords = Array.isArray(rec.k)
      ? (mergeUniqueKeywords(undefined, clippedKeywords(rec.k), SELECTION_META_MAX_KEYWORDS) ?? [])
      : []
    if (summary === '' && keywords.length === 0) continue
    entries.set(slug.toLowerCase(), { summary, keywords })
  }
  if (entries.size === 0) return undefined
  return {
    feedVersion: clipCatalogText(envelope.feed_version, 40),
    publishedAt: clipCatalogText(envelope.published_at, 40),
    sourceFetchedAt: clipCatalogText(envelope.source_fetched_at, 40),
    entries,
  }
}

/** Whether a repository description is missing, placeholder, or too weak to inform selection. */
export function isWeakDescription(
  description: string,
  item: Pick<MarketPlugin, 'name' | 'fullName'>,
): boolean {
  const trimmed = description.trim()
  if (trimmed === '') return true
  if (URL_ONLY_PATTERN.test(trimmed) || !HAS_TEXT_LETTER_PATTERN.test(trimmed)) return true
  const normalizeIdentity = (value: string): string => value.toLowerCase().replace(/[\s._/-]+/g, '')
  const normDesc = normalizeIdentity(trimmed)
  if (normDesc === '' || normDesc === normalizeIdentity(item.name) || normDesc === normalizeIdentity(item.fullName)) {
    return true
  }
  if (
    GENERIC_TOKEN_PATTERN.test(trimmed)
    || PLACEHOLDER_EN_PATTERN.test(trimmed)
    || GENERIC_ZH_PATTERN.test(trimmed)
    || PLACEHOLDER_ZH_PATTERN.test(trimmed)
  ) {
    return true
  }
  const core = trimmed.replace(/[\s\p{P}\p{S}]+/gu, '')
  const coreLen = [...core].length
  const hasCjk = HAS_CJK_PATTERN.test(trimmed)
  if ((hasCjk && coreLen < 10) || (!hasCjk && coreLen < 16)) return true
  if ([...trimmed].length <= 25 && HYPE_SLOGAN_PATTERN.test(trimmed)) return true
  return false
}

export function isSubstantiveSelectionSummary(summary: string): boolean {
  return summary.trim() !== '' && !UNINFORMATIVE_SUMMARY_PATTERN.test(summary)
}

/**
 * Merge sidecar selection metadata (bilingual keywords and fallback Chinese summaries)
 * into a derived catalog without overwriting official subscription or editorial copy.
 */
export function hydrateCatalogWithSelectionMeta(
  catalog: MarketCatalog,
  selectionMeta: ParsedSelectionMeta,
  protectedRepos?: ReadonlySet<string>,
): MarketCatalog {
  const hydratePlugin = (item: MarketPlugin, allowSummaryReplace: boolean): MarketPlugin => {
    const key = item.fullName.toLowerCase()
    if (key === '') return item
    const meta = selectionMeta.entries.get(key)
    if (meta === undefined) return item
    const nextKeywords = meta.keywords.length > 0 ? mergeUniqueKeywords(item.keywords, meta.keywords) : item.keywords
    const substantiveSummary = isSubstantiveSelectionSummary(meta.summary)
    const shouldReplaceDescription = allowSummaryReplace
      ? (
          substantiveSummary
          && !protectedRepos?.has(key)
          && item.titleZh === undefined
          && item.titleEn === undefined
          && item.descriptionEn === undefined
          && (item.description.trim() === '' || isWeakDescription(item.description, item))
        )
      : (substantiveSummary && item.description.trim() === '')
    const nextDescription = shouldReplaceDescription ? meta.summary : item.description
    if (nextKeywords === item.keywords && nextDescription === item.description) return item
    return {
      ...item,
      ...(nextKeywords === undefined ? {} : { keywords: nextKeywords }),
      description: nextDescription,
    }
  }

  let itemsChanged = false
  const nextItems = catalog.items.map((item) => {
    const updated = hydratePlugin(item, true)
    if (updated !== item) itemsChanged = true
    return updated
  })

  const hydrateFeatured = (featured: MarketFeatured | undefined): MarketFeatured | undefined => {
    if (featured === undefined) return undefined
    let entriesChanged = false
    const nextEntries = featured.entries.map((entry) => {
      const updated = hydratePlugin(entry.item, false)
      if (updated === entry.item) return entry
      entriesChanged = true
      return { ...entry, item: updated }
    })
    return entriesChanged ? { ...featured, entries: nextEntries } : featured
  }

  const nextFeatured = hydrateFeatured(catalog.featured)
  const nextSubscription = hydrateFeatured(catalog.subscription)
  if (!itemsChanged && nextFeatured === catalog.featured && nextSubscription === catalog.subscription) {
    return catalog
  }
  return {
    ...catalog,
    ...(itemsChanged ? { items: nextItems } : {}),
    ...(nextFeatured !== catalog.featured && nextFeatured !== undefined ? { featured: nextFeatured } : {}),
    ...(nextSubscription !== catalog.subscription && nextSubscription !== undefined ? { subscription: nextSubscription } : {}),
  }
}
