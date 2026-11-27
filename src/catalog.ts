/**
 * Read the full catalog and published subscription (or a legacy v2 feed).
 * Remote metadata is validated before entering the client wire contract.
 */
import { readCategoryTable, resolveCompleteCatalogLists } from './catalogHydration.ts'
import {
  errorText,
  fetchFollowing,
  isAllowedTarballUrl,
  isStaleMirrorSnapshot,
  MAX_CATALOG_BYTES,
  readJson,
  runMirrorRace,
} from './catalogTransport.ts'
import { parseInstallInfo } from './installInfo.ts'
import type { MarketCatalog, MarketCategory, MarketFeatured, MarketFeaturedEntry, MarketPlugin } from './contract.ts'
import {
  clipCatalogText,
  hydrateCatalogWithSelectionMeta,
  isSidecarVersionSkewed,
  parseSelectionMeta,
  repositorySlug,
  selectionMetaUrlOf,
  sidecarFreshnessStampOf,
  type ParsedSelectionMeta,
} from './selectionMeta.ts'
import { FEATURED_CATEGORY, SUBSCRIPTION_CATEGORY, isMarketIcon, isSafeBranchName } from './shapes.ts'
import { categoriesOf } from './subscription.ts'
import { extractFilesFromTgzResponse } from './tarball.ts'

/** Default feed and mirrors (including China-reachable npmmirror tarball) serve the same npm package dataset. */
export const DEFAULT_CATALOG_BASE = 'https://cdn.jsdelivr.net/npm/awesome-dsh-plugin-feed@latest/data/market-catalog-v4.json'
export const CN_MIRROR_CATALOG_BASE = 'https://registry.npmmirror.com/awesome-dsh-plugin-feed/latest'
export const MIRROR_CATALOG_BASE = 'https://unpkg.com/awesome-dsh-plugin-feed@latest/data/market-catalog-v4.json'

const OFFICIAL_CATALOG_BASES = new Set([
  DEFAULT_CATALOG_BASE,
  CN_MIRROR_CATALOG_BASE,
  MIRROR_CATALOG_BASE,
])

/** Whether `base` points to an official public catalog source (never a custom/private feed). */
export function isOfficialCatalogBase(base: string): boolean {
  return OFFICIAL_CATALOG_BASES.has(base.trim())
}

const LEGACY_CN_MIRROR_FILES_PREFIX = 'https://registry.npmmirror.com/awesome-dsh-plugin-feed/latest/files/data/'
export const TARBALL_SELECTION_META_PATH = 'package/data/plugin-selection-meta.json'
const TARBALL_PRIMARY_CATALOG_PATHS = ['package/data/market-catalog-v4.json', 'package/data/market-catalog.json'] as const
const NPMMIRROR_ETAG_PREFIX = 'npmmirror:'

/** Start the next mirror concurrently if the leading source has not returned headers within this window. */
const DEFAULT_HEDGE_DELAY_MS = 1_500

/** Once valid response headers arrive, wait this long before hedging a stalled body download. */
const DEFAULT_BODY_HEDGE_DELAY_MS = 8_000

/** The market is refreshed daily upstream; asking more often than this is noise. */
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1_000

/** Back off automatic background revalidation briefly after a failure so offline reads stay quiet. */
const BACKGROUND_RETRY_MS = 60 * 1_000

/** A description longer than this is a README pasted into the field, not a summary. */
const DESCRIPTION_LIMIT = 300

/** A card title is a name, not a sentence — the publisher caps it at 60. */
const TITLE_LIMIT = 60

const SCHEMA_VERSION = 2

/**
 * The shape {@link deriveMarket} produces. A stored catalog records the
 * format it was derived under, and the cache gate refuses any other: a
 * revalidation only asks whether the FEED changed, so after an upgrade that
 * changes the parse a 304 would keep serving the old build's reduction
 * forever. Bump this whenever the derived catalog gains or changes a field.
 * 1 — before the editorial picks; 2 — `featured`; 3 — inline pick descriptions;
 * 4 — v2-only feeds; 5 — complete catalogs and package-identified subscriptions;
 * 6 — up to 100 editorial picks with their own category totals;
 * 7 — schema-4 compact feed support, subscription icon/keyword hydration, and npmmirror failover.
 * 8 — the editorial pick cap grows from 100 to 1000.
 * 9 — `publishedAt`, the feed's own publish stamp used for cross-mirror freshness comparison.
 * 10 — DSH runtime compatibility target selection (`dshEngine`, `compatFallback`) hydrated across subscription and repository cards.
 * 11 — `plugin-selection-meta.json` sidecar keywords and weak-description Chinese summary hydration.
 */
export const CATALOG_FORMAT = 11

/** The editorial list is capped. Published subscription packages are not. */
const FEATURED_LIMIT = 1000

/** A pick's reason is one sentence, not a second description. */
const REASON_LIMIT = 200

/** One published entry (schema 2/3 full keys or schema 4 compact keys), before the wire pass. */
interface RawEntry {
  icon?: unknown
  keywords?: unknown
  archived?: unknown
  disabled?: unknown
  packages?: unknown
  install_status?: unknown
  title_zh?: unknown
  title_en?: unknown
  description_en?: unknown
  full_name?: unknown
  description?: unknown
  stargazers_count?: unknown
  language?: unknown
  license?: unknown
  pushed_at?: unknown
  default_branch?: unknown
  category?: unknown
  category_zh?: unknown
  category_en?: unknown
  // Schema 4 compact keys
  n?: unknown
  d?: unknown
  s?: unknown
  c?: unknown
  p?: unknown
  l?: unknown
  lic?: unknown
  b?: unknown
  is?: unknown
  pkg?: unknown
  tz?: unknown
  te?: unknown
  de?: unknown
  ar?: unknown
  di?: unknown
}

/** The envelope's editorial section, before the wire pass. */
interface RawFeatured {
  title_zh?: unknown
  title_en?: unknown
  updated_at?: unknown
  entries?: unknown
}

/** One editorial pick. `packages` is present only for a pick the shortlist lacks. */
interface RawFeaturedEntry {
  full_name?: unknown
  description?: unknown
  reason?: unknown
  packages?: unknown
}

/** Where a parsed catalog survives a restart. */
export interface CatalogCache {
  read: () => { catalog: MarketCatalog | null; marketEtag: string; activeBase: string }
  write: (next: { catalog: MarketCatalog; marketEtag: string; activeBase: string }) => void
  ready?: Promise<void>
}

/** Deployment-varying knobs the plugin config owns. */
export interface CatalogOptions {
  readonly base: string
  readonly marketSize: number
  readonly cache?: CatalogCache
  readonly disposeSignal?: AbortSignal
  readonly hedgeDelayMs?: number
  readonly bodyHedgeDelayMs?: number
  readonly dshVersion?: string
}

/**
 * Drop the redundant `subscription` payload when an editorial `featured` list
 * is already present.
 */
export function stripUnusedSubscription(catalog: MarketCatalog): MarketCatalog {
  if (catalog.featured === undefined || catalog.subscription === undefined) return catalog
  const { subscription: _unused, ...rest } = catalog
  return {
    ...rest,
    categories: catalog.categories.filter(entry => entry.key !== SUBSCRIPTION_CATEGORY),
  }
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

function branchName(value: unknown): string {
  if (typeof value !== 'string') return 'main'
  const trimmed = clipCatalogText(value, 100)
  return trimmed !== '' && isSafeBranchName(trimmed) ? trimmed : 'main'
}

function deriveFeatured(value: unknown, declared: unknown, rows: ReadonlyMap<string, MarketPlugin>, copy = new Map<string, string>()): MarketFeatured | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as RawFeatured
  if (!Array.isArray(raw.entries)) return undefined
  const titleZh = clipCatalogText(raw.title_zh, 60) || '编辑精选'
  const titleEn = clipCatalogText(raw.title_en, 60) || "Editor's Picks"
  const entries: MarketFeaturedEntry[] = []
  const seen = new Set<string>()
  for (const candidate of raw.entries.slice(0, FEATURED_LIMIT) as unknown[]) {
    if (candidate === null || typeof candidate !== 'object') continue
    const pick = candidate as RawFeaturedEntry
    const fullName = repositorySlug(pick.full_name)
    if (fullName === null) continue
    const key = fullName.toLowerCase()
    if (seen.has(key)) continue
    const reason = clipCatalogText(pick.reason, REASON_LIMIT)
    const known = rows.get(key)
    if (known !== undefined) {
      seen.add(key)
      const description = copy.get(key) ?? ''
      entries.push({ item: description === '' ? known : { ...known, description }, reason })
      continue
    }
    const installInfo = pick.packages === undefined ? undefined : parseInstallInfo(pick.packages)
    if (installInfo === undefined) continue
    seen.add(key)
    const slash = fullName.indexOf('/')
    entries.push({
      item: {
        installInfo,
        fullName,
        owner: fullName.slice(0, slash),
        name: fullName.slice(slash + 1),
        url: `https://github.com/${fullName}`,
        description: clipCatalogText(pick.description, DESCRIPTION_LIMIT) || reason,
        stars: 0,
        language: '',
        license: '',
        pushedAt: '',
        defaultBranch: 'main',
        category: FEATURED_CATEGORY,
        categoryZh: titleZh,
        categoryEn: titleEn,
      },
      reason,
    })
  }
  if (entries.length === 0) return undefined
  return {
    titleZh, titleEn, updatedAt: clipCatalogText(raw.updated_at, 30), count: count(declared) || entries.length, entries,
    categories: categoriesOf(entries.map(entry => entry.item)),
  }
}

function readFeedEnvelopeMeta(body: unknown): { readonly feedVersion: string; readonly publishedAt: string } {
  const envelope = body !== null && typeof body === 'object'
    ? body as { feed_version?: unknown; published_at?: unknown }
    : {}
  return {
    feedVersion: clipCatalogText(envelope.feed_version, 40),
    publishedAt: clipCatalogText(envelope.published_at, 40),
  }
}

interface DerivedMarketResult {
  readonly catalog: MarketCatalog
  readonly protectedRepos: ReadonlySet<string>
  readonly schemaVersion: number
  readonly feedVersion: string
  readonly publishedAt: string
}

function deriveMarketInternal(
  body: unknown,
  marketSize: number,
  dshVersion?: string,
  selectionMeta?: ParsedSelectionMeta,
): DerivedMarketResult {
  const envelope = body as {
    schema_version?: unknown; entries?: unknown; category_table?: unknown; source_fetched_at?: unknown; source_repo_count?: unknown; featured?: unknown; featured_count?: unknown
    subscription?: unknown; subscription_updated_at?: unknown; published_at?: unknown; feed_version?: unknown
  }
  const schema = envelope.schema_version
  if (schema !== SCHEMA_VERSION && schema !== 3 && schema !== 4) {
    const version = schema === undefined ? 'absent' : String(schema)
    throw new Error(`unsupported market schema version ${version}; expected 2, 3, or 4`)
  }
  const isCompact = schema === 4
  const isCompleteCatalog = schema === 3 || schema === 4
  const categoryTable = isCompact ? readCategoryTable(envelope.category_table) : []
  const rows = Array.isArray(envelope.entries) ? envelope.entries as RawEntry[] : []
  if (rows.length === 0) throw new Error('the published market carried no entries')

  const items: MarketPlugin[] = []
  const knownNames = new Set<string>()
  for (const row of rows) {
    const rawFullName = isCompact ? (row.n ?? row.full_name) : row.full_name
    const fullName = repositorySlug(rawFullName)
    if (fullName === null || knownNames.has(fullName)) continue
    knownNames.add(fullName)
    const catTuple = isCompact && typeof row.c === 'number' && Number.isInteger(row.c)
      ? categoryTable[row.c]
      : undefined
    const category = catTuple ? catTuple[0] : clipCatalogText(row.category, 60)
    if (category === '') continue
    const categoryZh = catTuple ? catTuple[1] : (clipCatalogText(row.category_zh, 60) || category)
    const categoryEn = catTuple ? catTuple[2] : (clipCatalogText(row.category_en, 60) || category)
    const slash = fullName.indexOf('/')
    const titleZh = clipCatalogText(isCompact ? (row.tz ?? row.title_zh) : row.title_zh, TITLE_LIMIT)
    const titleEn = clipCatalogText(isCompact ? (row.te ?? row.title_en) : row.title_en, TITLE_LIMIT)
    const descriptionEn = clipCatalogText(isCompact ? (row.de ?? row.description_en) : row.description_en, DESCRIPTION_LIMIT)
    const rawPackages = isCompact ? (row.pkg ?? row.packages) : row.packages
    const rawStatus = isCompact ? (row.is ?? row.install_status ?? 'none') : row.install_status
    const archived = isCompact ? (row.ar === 1 || row.ar === true || row.archived === true) : row.archived === true
    const disabled = isCompact ? (row.di === 1 || row.di === true || row.disabled === true) : row.disabled === true
    items.push({
      ...(typeof row.icon === 'string' && isMarketIcon(row.icon) ? { icon: row.icon } : {}),
      ...(Array.isArray(row.keywords) ? { keywords: row.keywords.filter((word): word is string => typeof word === 'string').slice(0, 200).map(word => clipCatalogText(word, 100)) } : {}),
      ...(archived ? { archived: true } : {}),
      ...(disabled ? { disabled: true } : {}),
      ...(rawPackages === undefined ? {} : { installInfo: parseInstallInfo(rawPackages) }),
      ...(rawStatus === 'command' || rawStatus === 'manual' || rawStatus === 'none' ? { installStatus: rawStatus } : {}),
      ...(titleZh === '' ? {} : { titleZh }),
      ...(titleEn === '' ? {} : { titleEn }),
      ...(descriptionEn === '' ? {} : { descriptionEn }),
      fullName,
      owner: fullName.slice(0, slash),
      name: fullName.slice(slash + 1),
      url: `https://github.com/${fullName}`,
      description: clipCatalogText(isCompact ? (row.d ?? row.description) : row.description, DESCRIPTION_LIMIT),
      stars: count(isCompact ? (row.s ?? row.stargazers_count) : row.stargazers_count),
      language: clipCatalogText(isCompact ? (row.l ?? row.language) : row.language, 40),
      license: clipCatalogText(isCompact ? (row.lic ?? row.license) : row.license, 40),
      pushedAt: clipCatalogText(isCompact ? (row.p ?? row.pushed_at) : row.pushed_at, 30),
      defaultBranch: branchName(isCompact ? (row.b ?? row.default_branch) : row.default_branch),
      category,
      categoryZh,
      categoryEn,
    })
  }

  if (items.length === 0) throw new Error('the published market carried no valid entries')

  const cut = isCompleteCatalog ? items : items.slice(0, marketSize)
  const categories: MarketCategory[] = categoriesOf(cut)

  const byName = new Map<string, MarketPlugin>()
  for (const item of items) if (!byName.has(item.fullName.toLowerCase())) byName.set(item.fullName.toLowerCase(), item)
  let featured: MarketFeatured | undefined
  let subscription: MarketFeatured | undefined
  let protectedRepos: ReadonlySet<string> = new Set()
  if (isCompleteCatalog) {
    ;({ featured, subscription, protectedRepos } = resolveCompleteCatalogLists({
      rawSubscription: envelope.subscription,
      rawEditorial: envelope.featured,
      subscriptionUpdatedAt: clipCatalogText(envelope.subscription_updated_at, 40),
      items,
      byName,
      dshVersion,
      descriptionLimit: DESCRIPTION_LIMIT,
      deriveFeatured,
    }))
  } else {
    featured = deriveFeatured(envelope.featured, envelope.featured_count, byName)
  }
  if (featured !== undefined) {
    categories.unshift({ key: FEATURED_CATEGORY, zh: featured.titleZh, en: featured.titleEn, count: featured.count })
  }
  if (subscription !== undefined) {
    categories.unshift({ key: SUBSCRIPTION_CATEGORY, zh: subscription.titleZh, en: subscription.titleEn, count: subscription.count })
  }

  const { feedVersion, publishedAt } = readFeedEnvelopeMeta(body)
  let catalog: MarketCatalog = {
    items: cut,
    categories,
    ...(featured === undefined ? {} : { featured }),
    ...(subscription === undefined ? {} : { subscription }),
    fetchedAt: clipCatalogText(envelope.source_fetched_at, 40),
    ...(publishedAt === '' ? {} : { publishedAt }),
    refreshedAt: new Date().toISOString(),
    scanned: count(envelope.source_repo_count) || rows.length,
  }
  if (selectionMeta !== undefined) {
    catalog = hydrateCatalogWithSelectionMeta(catalog, selectionMeta, protectedRepos)
  }
  return {
    catalog,
    protectedRepos,
    schemaVersion: schema,
    feedVersion,
    publishedAt,
  }
}

/**
 * Parse the published market into the catalog the browser renders. The
 * publisher's file order is preserved. Only legacy schema-2 feeds are
 * truncated to marketSize; schema 3/4 carry the complete reviewed catalog.
 */
export function deriveMarket(
  body: unknown,
  marketSize: number,
  dshVersion?: string,
  selectionMeta?: ParsedSelectionMeta,
): MarketCatalog {
  return deriveMarketInternal(body, marketSize, dshVersion, selectionMeta).catalog
}

/** The catalog reader: memory first, then the network. */
export interface CatalogSource {
  read: (force: boolean, signal?: AbortSignal) => Promise<{ catalog: MarketCatalog | null; stale: boolean; error: string }>
  warmup: () => void
}

function freshnessStampOf(catalog: MarketCatalog): string {
  return catalog.publishedAt || catalog.fetchedAt
}

interface PackageManifest {
  readonly schema_version?: unknown
  readonly version?: unknown
  readonly dist?: { readonly tarball?: unknown; readonly integrity?: unknown }
}

function npmmirrorVersionTag(manifest: PackageManifest): string {
  const version = typeof manifest.version === 'string' ? manifest.version : ''
  const integrity = typeof manifest.dist?.integrity === 'string' ? manifest.dist.integrity : ''
  if (integrity !== '') return `${NPMMIRROR_ETAG_PREFIX}${version}:${integrity}`
  return version !== '' ? `${NPMMIRROR_ETAG_PREFIX}${version}` : ''
}

interface SidecarPayload {
  readonly meta: ParsedSelectionMeta
  readonly etag: string
  readonly activeBase: string
}

type AttemptOutcome =
  | { readonly kind: 'not-modified'; readonly activeBase: string }
  | {
    readonly kind: 'fresh'
    readonly catalog: MarketCatalog
    readonly marketEtag: string
    readonly activeBase: string
    readonly needsSidecar: boolean
    readonly feedVersion: string
    readonly publishedAt: string
    readonly protectedRepos: ReadonlySet<string>
    readonly sidecar?: SidecarPayload
  }

type SidecarFetchResult =
  | { readonly kind: 'loaded'; readonly payload: SidecarPayload }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unavailable' }

class SidecarHttpError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`sidecar HTTP ${String(status)}`)
    this.status = status
  }
}

/**
 * Build the catalog reader.
 * @param options - the base URL, the market size, and the durable seat.
 * @returns the reader.
 */
export function createCatalogSource(options: CatalogOptions): CatalogSource {
  const migrateBuiltIn = (base: string): string => {
    for (const current of [DEFAULT_CATALOG_BASE, MIRROR_CATALOG_BASE]) {
      if (
        base === current.replace('market-catalog-v4.json', 'market-v2.json') ||
        base === current.replace('market-catalog-v4.json', 'market-catalog.json')
      ) return current
    }
    if (
      base === `${LEGACY_CN_MIRROR_FILES_PREFIX}market-v2.json` ||
      base === `${LEGACY_CN_MIRROR_FILES_PREFIX}market-catalog.json` ||
      base === `${LEGACY_CN_MIRROR_FILES_PREFIX}market-catalog-v4.json`
    ) return CN_MIRROR_CATALOG_BASE
    return base
  }
  const primary = migrateBuiltIn(options.base)
  const chain = primary === DEFAULT_CATALOG_BASE
    ? [primary, CN_MIRROR_CATALOG_BASE, MIRROR_CATALOG_BASE]
    : [primary]
  const hedgeDelayMs = options.hedgeDelayMs !== undefined && Number.isFinite(options.hedgeDelayMs) && options.hedgeDelayMs >= 0
    ? options.hedgeDelayMs
    : DEFAULT_HEDGE_DELAY_MS
  const bodyHedgeDelayMs = options.bodyHedgeDelayMs !== undefined && Number.isFinite(options.bodyHedgeDelayMs) && options.bodyHedgeDelayMs >= 0
    ? options.bodyHedgeDelayMs
    : Math.max(hedgeDelayMs * 4, DEFAULT_BODY_HEDGE_DELAY_MS)

  type CatalogSnapshotSlot =
    | { readonly status: 'empty' }
    | { readonly status: 'loaded'; readonly catalog: MarketCatalog; readonly marketEtag: string; readonly activeBase: string }

  type SidecarSnapshotSlot =
    | { readonly status: 'empty' }
    | { readonly status: 'loaded'; readonly meta: ParsedSelectionMeta; readonly etag: string; readonly activeBase: string }

  type RefreshFlightState =
    | { readonly status: 'idle'; readonly lastFailureAt: number }
    | { readonly status: 'refreshing'; readonly promise: Promise<{ catalog: MarketCatalog | null; stale: boolean; error: string }> }

  // The durable seat is NOT seeded at construction time. The plugin body
  // hands the source a cache port whose backing domain opens asynchronously
  // after this constructor returns, so reading it here would always see the
  // initial (empty) state and a restart would pay a full download instead of
  // a 304. The seed is instead pulled lazily, on the first read — by then
  // the domain is open, and the port answers from the state the effect
  // adopted. Reading it again whenever the closure is still empty also
  // covers a read that raced the domain open.
  let snapshot: CatalogSnapshotSlot = { status: 'empty' }
  let sidecarSnapshot: SidecarSnapshotSlot = { status: 'empty' }
  const seedFromCache = (): void => {
    if (snapshot.status === 'loaded') return
    const cached = options.cache?.read()
    if (cached === undefined || cached.catalog === null || cached.catalog.items.length === 0) return
    const migratedBase = cached.activeBase ? migrateBuiltIn(cached.activeBase) : ''
    if (migratedBase && !chain.includes(migratedBase)) return
    snapshot = {
      status: 'loaded',
      catalog: stripUnusedSubscription(cached.catalog),
      marketEtag: migratedBase === cached.activeBase ? cached.marketEtag : '',
      activeBase: migratedBase,
    }
  }
  let flight: RefreshFlightState = { status: 'idle', lastFailureAt: 0 }

  const raceWithSignal = async <T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> => {
    if (signal === undefined) return await pending
    if (signal.aborted) throw signal.reason ?? new Error('This operation was aborted')
    let abort: (() => void) | undefined
    const aborted = new Promise<never>((_, reject) => {
      abort = (): void => { reject(signal.reason ?? new Error('This operation was aborted')) }
      signal.addEventListener('abort', abort, { once: true })
    })
    try {
      return await Promise.race([pending, aborted])
    } finally {
      if (abort !== undefined) signal.removeEventListener('abort', abort)
    }
  }

  const waitForCache = async (signal?: AbortSignal): Promise<void> => {
    if (snapshot.status === 'loaded' || options.cache?.ready === undefined) return
    await raceWithSignal(options.cache.ready.catch(() => undefined), signal)
  }

  const fresh = (): boolean => {
    if (snapshot.status !== 'loaded') return false
    const at = Date.parse(snapshot.catalog.refreshedAt)
    return Number.isFinite(at) && Date.now() - at < REFRESH_INTERVAL_MS
  }

  const attempt = async (
    base: string,
    abortSignal?: AbortSignal,
    onHeaders?: () => void,
  ): Promise<AttemptOutcome> => {
    // The stored ETag certifies one server's content; a conditional request
    // only goes to the base that issued it. An unknown serving base (legacy
    // record) can only have been the primary.
    const current = snapshot.status === 'loaded' ? snapshot : null
    const conditional = current !== null && current.marketEtag !== ''
      && (current.activeBase === '' ? base === primary : current.activeBase === base)
    const wireEtag = conditional && !current.marketEtag.startsWith(NPMMIRROR_ETAG_PREFIX) ? current.marketEtag : ''
    // npmmirror's /latest answer sits behind a CDN edge cache that keeps
    // serving the previous version for one TTL after the origin syncs —
    // observed still stale 5 minutes after the sync task completed on
    // 2026-11-25. The manifest is a few kilobytes (the heavy tarball rides an
    // immutable per-version URL and is unaffected), so bypass the edge with
    // cnpmcore's own cache-bypass directive, the same one its sync worker uses.
    const probeUrl = base === CN_MIRROR_CATALOG_BASE ? `${base}?cache=0` : base
    const response = await fetchFollowing(probeUrl, wireEtag, abortSignal)
    if (response.status === 304) {
      if (current === null) throw new Error('catalog HTTP 304')
      onHeaders?.()
      return { kind: 'not-modified', activeBase: current.activeBase }
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined)
      throw new Error(`catalog HTTP ${String(response.status)}`)
    }
    if (base !== CN_MIRROR_CATALOG_BASE) onHeaders?.()
    const body = await readJson(response)
    const manifest = body !== null && typeof body === 'object' ? body as PackageManifest : null
    if (manifest !== null && manifest.schema_version === undefined && typeof manifest.dist?.tarball === 'string') {
      const versionTag = npmmirrorVersionTag(manifest)
      if (conditional && versionTag !== '' && current.marketEtag === versionTag) {
        onHeaders?.()
        return { kind: 'not-modified', activeBase: base }
      }
      const tarballUrl = manifest.dist.tarball
      if (!isAllowedTarballUrl(base, tarballUrl)) {
        throw new Error('catalog tarball URL is not on an allowed registry host')
      }
      const tarResponse = await fetchFollowing(tarballUrl, '', abortSignal, 'identity')
      if (!tarResponse.ok) {
        void tarResponse.body?.cancel().catch(() => undefined)
        throw new Error(`catalog tarball HTTP ${String(tarResponse.status)}`)
      }
      onHeaders?.()
      const extracted = await extractFilesFromTgzResponse(
        tarResponse,
        TARBALL_PRIMARY_CATALOG_PATHS,
        [TARBALL_SELECTION_META_PATH],
        MAX_CATALOG_BYTES,
        abortSignal,
      )
      const parsed = JSON.parse(extracted.primary.toString('utf8')) as unknown
      const envelopeMeta = readFeedEnvelopeMeta(parsed)
      let parsedSidecar: ParsedSelectionMeta | undefined
      const sidecarBytes = extracted.optional.get(TARBALL_SELECTION_META_PATH)
      if (sidecarBytes !== undefined) {
        try {
          const candidate = parseSelectionMeta(JSON.parse(sidecarBytes.toString('utf8')) as unknown)
          if (candidate !== undefined && !isSidecarVersionSkewed(envelopeMeta, candidate)) {
            parsedSidecar = candidate
          }
        } catch {
          // Malformed or incompatible sidecar inside a tarball must never fail catalog loading.
        }
      }
      const derived = deriveMarketInternal(parsed, options.marketSize, options.dshVersion, parsedSidecar)
      // If optional sidecar scanning was interrupted mid-tarball (e.g. stream blip or
      // 64 MiB limit), omit marketEtag so subsequent /latest checks can self-heal.
      const effectiveTag = extracted.optionalInterrupted && parsedSidecar === undefined ? '' : versionTag
      return {
        kind: 'fresh',
        catalog: derived.catalog,
        marketEtag: effectiveTag,
        activeBase: base,
        needsSidecar: false,
        feedVersion: derived.feedVersion,
        publishedAt: derived.publishedAt,
        protectedRepos: derived.protectedRepos,
        ...(parsedSidecar !== undefined ? { sidecar: { meta: parsedSidecar, etag: versionTag, activeBase: base } } : {}),
      }
    }
    const derived = deriveMarketInternal(body, options.marketSize, options.dshVersion)
    return {
      kind: 'fresh',
      catalog: derived.catalog,
      marketEtag: response.headers.get('etag') ?? '',
      activeBase: base,
      needsSidecar: derived.schemaVersion === 4 && selectionMetaUrlOf(base) !== null,
      feedVersion: derived.feedVersion,
      publishedAt: derived.publishedAt,
      protectedRepos: derived.protectedRepos,
    }
  }

  const commitOutcome = (outcome: AttemptOutcome): MarketCatalog => {
    if (outcome.kind === 'not-modified') {
      if (snapshot.status !== 'loaded') throw new Error('catalog HTTP 304')
      const nextCatalog = { ...snapshot.catalog, refreshedAt: new Date().toISOString() }
      snapshot = {
        status: 'loaded',
        catalog: nextCatalog,
        marketEtag: snapshot.marketEtag,
        activeBase: outcome.activeBase,
      }
      options.cache?.write({ catalog: snapshot.catalog, marketEtag: snapshot.marketEtag, activeBase: snapshot.activeBase })
      return snapshot.catalog
    }
    if (outcome.sidecar !== undefined) {
      sidecarSnapshot = {
        status: 'loaded',
        meta: outcome.sidecar.meta,
        etag: outcome.sidecar.etag,
        activeBase: outcome.sidecar.activeBase,
      }
    }
    snapshot = {
      status: 'loaded',
      catalog: outcome.catalog,
      marketEtag: outcome.marketEtag,
      activeBase: outcome.activeBase,
    }
    options.cache?.write({ catalog: snapshot.catalog, marketEtag: snapshot.marketEtag, activeBase: snapshot.activeBase })
    return snapshot.catalog
  }

  const orderedBases = (): string[] => {
    const base = snapshot.status === 'loaded' ? snapshot.activeBase : ''
    return base === '' || !chain.includes(base)
      ? chain
      : [base, ...chain.filter(candidate => candidate !== base)]
  }

  const attemptSidecar = async (
    sidecarUrl: string,
    catalogEnvelope: { readonly feedVersion: string; readonly publishedAt: string },
    abortSignal?: AbortSignal,
    onHeaders?: () => void,
  ): Promise<SidecarPayload> => {
    const current = sidecarSnapshot.status === 'loaded' ? sidecarSnapshot : null
    const wireEtag = current !== null && current.etag !== '' && current.activeBase === sidecarUrl
      ? current.etag
      : ''
    const response = await fetchFollowing(sidecarUrl, wireEtag, abortSignal)
    if (response.status === 304) {
      if (current === null) throw new Error('sidecar HTTP 304')
      if (isSidecarVersionSkewed(catalogEnvelope, current.meta)) throw new Error('sidecar version skewed')
      onHeaders?.()
      return { meta: current.meta, etag: current.etag, activeBase: current.activeBase }
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined)
      throw new SidecarHttpError(response.status)
    }
    onHeaders?.()
    const body = await readJson(response)
    const meta = parseSelectionMeta(body)
    if (meta === undefined) throw new Error('sidecar payload is empty or invalid')
    if (isSidecarVersionSkewed(catalogEnvelope, meta)) throw new Error('sidecar version skewed')
    return { meta, etag: response.headers.get('etag') ?? '', activeBase: sidecarUrl }
  }

  const fetchSelectionMeta = async (
    preferredCatalogBase: string,
    catalogEnvelope: { readonly feedVersion: string; readonly publishedAt: string },
  ): Promise<SidecarFetchResult> => {
    // Direct JSON sidecar race only targets lightweight JSON mirrors (never
    // falling back to downloading a 30+ MiB npmmirror tarball just for optional metadata).
    const sidecarTargets: string[] = []
    const pushTarget = (url: string | null): void => {
      if (url !== null && !sidecarTargets.includes(url)) sidecarTargets.push(url)
    }
    pushTarget(selectionMetaUrlOf(preferredCatalogBase))
    for (const candidate of chain) {
      pushTarget(selectionMetaUrlOf(candidate))
    }
    if (sidecarTargets.length === 0) return { kind: 'not-found' }

    const baselineStamp = sidecarSnapshot.status === 'loaded' ? sidecarFreshnessStampOf(sidecarSnapshot.meta) : ''
    const baselineActiveBase = sidecarSnapshot.status === 'loaded' ? sidecarSnapshot.activeBase : ''
    const failureKinds = new Map<string, '404' | 'other'>()

    try {
      const payload = await runMirrorRace<SidecarPayload>({
        targets: sidecarTargets,
        hedgeDelayMs,
        bodyHedgeDelayMs,
        disposeSignal: options.disposeSignal,
        attempt: async (target, abortSignal, onHeaders) => {
          try {
            return await attemptSidecar(target, catalogEnvelope, abortSignal, onHeaders)
          } catch (error) {
            failureKinds.set(target, error instanceof SidecarHttpError && error.status === 404 ? '404' : 'other')
            throw error
          }
        },
        evaluate: (candidate) => {
          if (
            baselineStamp !== ''
            && baselineActiveBase !== ''
            && candidate.activeBase !== baselineActiveBase
            && isStaleMirrorSnapshot(sidecarFreshnessStampOf(candidate.meta), baselineStamp)
          ) {
            failureKinds.set(candidate.activeBase, 'other')
            return { accept: false }
          }
          return { accept: true, value: candidate }
        },
        onExhausted: (sawOlderSnapshot) => {
          if (
            sawOlderSnapshot
            && sidecarSnapshot.status === 'loaded'
            && !isSidecarVersionSkewed(catalogEnvelope, sidecarSnapshot.meta)
          ) {
            return {
              meta: sidecarSnapshot.meta,
              etag: sidecarSnapshot.etag,
              activeBase: sidecarSnapshot.activeBase,
            }
          }
          throw new Error('sidecar unavailable')
        },
      })
      return { kind: 'loaded', payload }
    } catch {
      const all404 = sidecarTargets.every(target => failureKinds.get(target) === '404')
      return all404 ? { kind: 'not-found' } : { kind: 'unavailable' }
    }
  }

  const refresh = async (): Promise<MarketCatalog> => {
    const bases = orderedBases()
    const baselineStamp = snapshot.status === 'loaded' ? freshnessStampOf(snapshot.catalog) : ''
    const baselineActiveBase = snapshot.status === 'loaded' ? snapshot.activeBase : ''
    const baselineEffectiveBase = baselineActiveBase === '' ? primary : baselineActiveBase
    const outcome = await runMirrorRace<AttemptOutcome>({
      targets: bases,
      hedgeDelayMs,
      bodyHedgeDelayMs,
      disposeSignal: options.disposeSignal,
      attempt,
      evaluate: (candidate) => {
        // Only guard against lagging `@latest` caches when switching across
        // different mirrors within the drift window. Same-source responses
        // (or jumps beyond the window) are always accepted so upstream
        // rollbacks or prior future timestamps can never lock the cache.
        if (
          candidate.kind === 'fresh'
          && baselineStamp !== ''
          && candidate.activeBase !== baselineEffectiveBase
          && isStaleMirrorSnapshot(freshnessStampOf(candidate.catalog), baselineStamp)
        ) {
          return { accept: false }
        }
        return { accept: true, value: candidate }
      },
      onExhausted: (sawOlderSnapshot, failures) => {
        if (sawOlderSnapshot && snapshot.status === 'loaded') {
          // Every reachable mirror served an older `@latest` snapshot than our
          // current cache; preserve the newer local catalog and refresh its timestamp.
          return { kind: 'not-modified', activeBase: baselineActiveBase }
        }
        const summary = failures.filter((entry): entry is string => entry !== undefined).join('; ')
        throw new Error(summary)
      },
    })
    if (options.disposeSignal?.aborted) {
      throw options.disposeSignal.reason ?? new Error('This operation was aborted')
    }
    if (outcome.kind === 'fresh' && outcome.needsSidecar) {
      const sidecarResult = await fetchSelectionMeta(outcome.activeBase, {
        feedVersion: outcome.feedVersion,
        publishedAt: outcome.publishedAt,
      })
      if (options.disposeSignal?.aborted) {
        throw options.disposeSignal.reason ?? new Error('This operation was aborted')
      }
      if (sidecarResult.kind === 'loaded') {
        return commitOutcome({
          ...outcome,
          catalog: hydrateCatalogWithSelectionMeta(outcome.catalog, sidecarResult.payload.meta, outcome.protectedRepos),
          sidecar: sidecarResult.payload,
        })
      }
      if (sidecarResult.kind === 'unavailable') {
        // Transient sidecar failure/skew: reuse compatible in-memory sidecar if
        // available so keywords aren't wiped out, while omitting marketEtag so
        // future refreshes can self-heal instead of sticking on 304.
        const fallbackMeta = sidecarSnapshot.status === 'loaded'
          && !isSidecarVersionSkewed({ feedVersion: outcome.feedVersion, publishedAt: outcome.publishedAt }, sidecarSnapshot.meta)
          ? sidecarSnapshot.meta
          : undefined
        return commitOutcome({
          ...outcome,
          ...(fallbackMeta === undefined
            ? {}
            : { catalog: hydrateCatalogWithSelectionMeta(outcome.catalog, fallbackMeta, outcome.protectedRepos) }),
          marketEtag: '',
        })
      }
    }
    return commitOutcome(outcome)
  }

  const startRefresh = (): Promise<{ catalog: MarketCatalog | null; stale: boolean; error: string }> => {
    if (flight.status === 'refreshing') return flight.promise
    const promise = (async () => {
      try {
        const next = await refresh()
        flight = { status: 'idle', lastFailureAt: 0 }
        return { catalog: next, stale: false, error: '' }
      } catch (error) {
        flight = { status: 'idle', lastFailureAt: Date.now() }
        // A catalog already in memory still answers the question; the
        // browser is told the answer is old rather than shown a blank tab.
        const message = errorText(error)
        if (snapshot.status === 'loaded') return { catalog: snapshot.catalog, stale: true, error: message }
        return { catalog: null, stale: false, error: message }
      }
    })()
    flight = { status: 'refreshing', promise }
    return promise
  }

  const maybeRevalidateInBackground = (): void => {
    if (flight.status !== 'idle' || options.disposeSignal?.aborted) return
    if (Date.now() - flight.lastFailureAt < BACKGROUND_RETRY_MS) return
    void startRefresh()
  }

  return {
    read: async (force, signal) => {
      // A caller that arrives already aborted must not start the network
      // read its answer would have needed.
      if (signal?.aborted) throw signal.reason ?? new Error('This operation was aborted')
      if (snapshot.status === 'empty' && options.cache?.ready !== undefined) await waitForCache(signal)
      seedFromCache()
      if (signal?.aborted) throw signal.reason ?? new Error('This operation was aborted')
      if (!force && snapshot.status === 'loaded') {
        if (!fresh()) maybeRevalidateInBackground()
        return { catalog: snapshot.catalog, stale: false, error: '' }
      }
      // One network read at a time: the tab can be reopened while the first
      // is still running, and two downloads answer the same question. The
      // shared request is bound to the per-attempt fetch timeout only —
      // caller lifetimes never abort it, because the abort of one caller must
      // not hand every other caller a dead answer. A caller that aborts stops
      // waiting for its own copy of the result; the read itself finishes and
      // serves whoever is still listening. `force` against an already running
      // read merges into it (that read IS the fresh download force asked
      // for), so no force gesture is dropped or duplicated.
      return await raceWithSignal(startRefresh(), signal)
    },
    warmup: () => {
      if (options.disposeSignal?.aborted) return
      const run = (): void => {
        if (options.disposeSignal?.aborted) return
        seedFromCache()
        if (!fresh()) maybeRevalidateInBackground()
      }
      if (snapshot.status === 'empty' && options.cache?.ready !== undefined) {
        void options.cache.ready.then(run, run)
        return
      }
      run()
    },
  }
}
