/**
 * The dshMarketPro wire contract, shared verbatim by the host manifest
 * (`ctx.typert.register` in typert.ts) and the client contribution
 * (`ctx.remote.$mount` in client/remote.ts). The service exposes the reduced
 * community catalog and the plugin's own durable settings.
 *
 * Everything that crosses this boundary is remote text from a public
 * snapshot. It is reduced and sanitized on the Host — the repository link in
 * particular is rebuilt from `owner/name` rather than carried over from the
 * snapshot — so the browser half only ever renders values this contract has
 * already fixed the shape of.
 */
import { z } from 'zod'
import { isInstallSpec, MAX_REPO_DIRECTORY_LENGTH, normalizeRepoDirectory, type InstallInfo } from './installInfo.ts'
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'
// The dependency-free shapes live in their own module so `./index.ts` and
// `./catalog.ts` can reach them without evaluating every codec below.
import { isMarketIcon, isSafeBranchName, PACKAGE_NAME_PATTERN, REPOSITORY_SLUG_PATTERN, TELEMETRY_ERROR_DETAIL_PATTERN } from './shapes.ts'
export { TELEMETRY_ERROR_DETAIL_PATTERN }
import { SERVER_NAME_PATTERN } from './mcpShapes.ts'

/** One row of the market: a community plugin the catalog kept. */
export interface MarketPlugin {
  readonly icon?: string
  /** Present for subscription packages; repository cards retain fullName as their identity. */
  readonly packageName?: string
  readonly titleZh?: string
  readonly titleEn?: string
  readonly descriptionEn?: string
  /**
   * The publisher's installability signal for this row: a paste-ready
   * `command` target, a hand-written `manual` note, or `none` (catalog-only —
   * the repository reaches the market but has no install target yet). Absent
   * on legacy schema-2 feeds, where {@link MarketPlugin.installInfo} is the
   * only source of truth.
   */
  readonly installStatus?: 'command' | 'manual' | 'none'
  readonly keywords?: readonly string[]
  readonly archived?: boolean
  readonly disabled?: boolean
  readonly installInfo?: InstallInfo
  /** Repository slug; empty for a subscription package without a repository. */
  readonly fullName: string
  readonly owner: string
  readonly name: string
  /** Host-validated GitHub/Gitee repository or npm package page. */
  readonly url: string
  readonly description: string
  readonly stars: number
  readonly language: string
  readonly license: string
  /** ISO date of the last push, for the "still maintained" read. */
  readonly pushedAt: string
  /** The repository's default branch — the install command's fallback ref. */
  readonly defaultBranch: string
  readonly category: string
  readonly categoryZh: string
  readonly categoryEn: string
}

/** One category filter, with how many of the kept rows fall under it. */
export interface MarketCategory {
  readonly key: string
  readonly zh: string
  readonly en: string
  readonly count: number
}

/** One editorial pick: a complete card plus the editor's one-line reason. */
export interface MarketFeaturedEntry {
  /**
   * The catalog row the pick names, or — for a pick the shortlist does not
   * carry — a card the Host synthesized from the pick's own `packages` block.
   */
  readonly item: MarketPlugin
  readonly reason: string
}

/** The feed's editorial picks, resolved on the Host in the publisher's order. */
export interface MarketFeatured {
  readonly categories?: readonly MarketCategory[]
  readonly titleZh: string
  readonly titleEn: string
  readonly updatedAt: string
  /** The publisher's own count (`featured_count`), else how many picks resolved. */
  readonly count: number
  readonly entries: readonly MarketFeaturedEntry[]
}

/** The reduced catalog the browser renders. */
export interface MarketCatalog {
  readonly items: readonly MarketPlugin[]
  readonly categories: readonly MarketCategory[]
  /**
   * Absent when the feed carries no picks (or none survived the wire pass),
   * and in every catalog cached before the feed had them.
   */
  readonly featured?: MarketFeatured
  /**
   * The published subscription (all verified plugins) supplied alongside the
   * editorial list. On older schema-3 feeds, `featured` carries the subscription.
   */
  readonly subscription?: MarketFeatured
  /** When the upstream crawl ran (the snapshot's own timestamp). */
  readonly fetchedAt: string
  /**
   * When the feed package itself was published (`published_at` in the feed
   * envelope). Absent on feeds published before the stamp existed — and
   * unlike `fetchedAt` it moves on every publish, so two publishes sharing
   * one crawl snapshot still order correctly when mirrors are compared.
   */
  readonly publishedAt?: string
  /** When this Host last read the snapshot. */
  readonly refreshedAt: string
  /** How many repositories the crawl saw, before curation and the top cut. */
  readonly scanned: number
}

/** A catalog read: the answer, plus whether it is the last good one. */
export interface MarketCatalogResult {
  readonly catalog: MarketCatalog | null
  /** The catalog is a cached one; this read did not reach the snapshot. */
  readonly stale: boolean
  /** Why the read did not reach the snapshot, when it did not. */
  readonly error: string
}

/** One skill this deployment can currently resolve. */
export interface MarketSkill {
  readonly name: string
  readonly description: string
  readonly whenToUse: string
  /** The provider that owns the skill body (`filesystem`, `runtime`, …). */
  readonly provider: string
  /** Discovery source reported by the winning provider. */
  readonly source?: string
  /** Instruction file reported by the provider, when it has a file preview. */
  readonly instructionPath?: string
  /** Actual resource directory, relative to the workspace or home when possible. */
  readonly sourceDirectory?: string
  /**
   * The same directory as an absolute Host path, for the folder action. The
   * Host's own path opener re-verifies it before handing it to the desktop.
   */
  readonly sourcePath?: string
  /** Verified curated catalog id (`owner/repo/skillId`) when provenance matches a featured skill. */
  readonly featuredId?: string
  /** Whether the model may invoke it on its own. */
  readonly modelInvocable: boolean
  /** Whether the user may invoke it with `/name`. */
  readonly userInvocable: boolean
}

/** Wire codec: one session identity (branded string on the wire). */
export const sessionIdSchema = z.string().min(1)

/** A skills read: the answer, or the reason there is none. */
export interface MarketSkillsResult {
  readonly skills: readonly MarketSkill[]
  readonly cwd?: string
  readonly preset?: string
  /** False when a provider failed or reported incomplete discovery. */
  readonly complete: boolean
  readonly error: string
}

/** Target location for installing one curated Agent Skill. */
export type FeaturedSkillInstallScope = 'user-dsh' | 'user-agents' | 'project-dsh'

/** Wire request for Host-side direct installation of one curated Agent Skill. */
export interface InstallFeaturedSkillRequest {
  readonly id: string
  readonly scope: FeaturedSkillInstallScope
  readonly projectDir?: string
  readonly overwrite?: boolean
}

/** Structured outcome of installing one curated Agent Skill on the Host. */
export interface InstallFeaturedSkillResult {
  readonly ok: boolean
  readonly id: string
  readonly name: string
  readonly scope: FeaturedSkillInstallScope
  readonly targetPath: string
  readonly fileCount: number
  readonly hasScripts: boolean
  readonly code?: 'not-found' | 'already-exists' | 'invalid-project-dir' | 'download-failed' | 'invalid-skill' | 'write-failed' | 'cancelled'
  readonly error: string
}

/** Request to delete one locally installed Agent Skill directory from disk. */
export interface DeleteInstalledSkillRequest {
  readonly name: string
  readonly sourcePath: string
}

/** Outcome of deleting one locally installed Agent Skill directory on the Host. */
export interface DeleteInstalledSkillResult {
  readonly ok: boolean
  readonly name: string
  readonly targetPath: string
  readonly code?: 'not-found' | 'not-deletable' | 'delete-failed'
  readonly error: string
}

/**
 * What the browser needs to name the install command. The profile is a
 * deployment fact (the Host is the only side that knows which profile it
 * boots), and the command is the official one — this plugin never runs it.
 */
export interface MarketEnvironment {
  /** The profile whose plugins an install would change. */
  readonly profile: string
  /**
   * The market's own version, for the section header.
   *
   * The installed panel also carries a row for a marked in-box seat, so this
   * is no longer the only place the version can appear — but that row exists
   * only while the seat is listed, and it is one card among many. The header
   * states which market is running regardless. '' when the manifest could
   * not be read.
   */
  readonly version: string
  /** Running DSH Host semantic version, when readable. */
  readonly dshVersion?: string
  /** True when Host/process environment variables suppress telemetry. */
  readonly telemetrySuppressedByEnv?: boolean
}

/** The marketplace's live configuration fields exposed to the browser. */
export interface SafeMarketSettings {
  /**
   * Whether the market is on. Default false: the tab explains itself and
   * asks first, because turning it on is what starts reaching GitHub.
   */
  readonly enabled: boolean
  /**
   * Whether the built-in AI assistant (the unified `market-pro` skill and
   * the `dsh_market_pro`, `dsh_mcp_pro`, and `dsh_skills_pro` tools) is active
   * for conversations.
   */
  readonly aiAssistantEnabled: boolean
  /**
   * Whether anonymous usage & install feedback telemetry is enabled (opt-out).
   */
  readonly telemetryEnabled: boolean
}

/** One field update sent through the plugin-owned settings Remote. */
export type SafeMarketSettingsUpdate =
  | { readonly field: 'enabled'; readonly value: boolean }
  | { readonly field: 'aiAssistantEnabled'; readonly value: boolean }
  | { readonly field: 'telemetryEnabled'; readonly value: boolean }

export type TelemetryHostKind = 'desktop' | 'web' | 'other'
export type TelemetryOs = 'darwin' | 'win32' | 'linux' | 'other'
export type TelemetryLocale = 'zh' | 'en' | 'other'
export type TelemetryErrorCode =
  | 'compat'
  | 'unsupported_platform'
  | 'not_bundle'
  | 'already_installed'
  | 'not_found'
  | 'pnpm_missing'
  | 'runtime_missing'
  | 'build_blocked'
  | 'build_failed'
  | 'git_failed'
  | 'tls_error'
  | 'auth_failed'
  | 'rate_limited'
  | 'fs_locked'
  | 'permission'
  | 'disk_full'
  | 'integrity'
  | 'invalid_spec'
  | 'network'
  | 'timeout'
  | 'refused'
  | 'cancelled'
  | 'write_failed'
  | 'operation_error'
  | 'unknown'

export type TelemetryClientEvent =
  | {
    readonly kind: 'client_hello'
    readonly hostKind: TelemetryHostKind
    readonly locale: TelemetryLocale
  }
  | {
    readonly kind: 'plugin_install'
    readonly target: string
    readonly mode: 'direct' | 'ai'
    readonly result: 'ok' | 'failed'
    readonly errorCode?: TelemetryErrorCode
    readonly errorDetail?: string
  }
  | {
    readonly kind: 'mcp_install'
    readonly target: string
    readonly mode: 'featured' | 'custom'
    readonly result: 'ok' | 'failed'
    readonly errorCode?: TelemetryErrorCode
    readonly errorDetail?: string
  }
  | {
    readonly kind: 'skill_install'
    readonly target: string
    readonly mode: 'featured' | 'ai'
    readonly result: 'ok' | 'failed'
    readonly errorCode?: TelemetryErrorCode
    readonly errorDetail?: string
  }

/** Live state of one loader entry an installed bundle introduces. */
export interface MarketInstalledEntry {
  /** The patch-addressable entry id (no `include:` prefix). */
  readonly id: string
  /** The module specifier the entry imports. */
  readonly name: string
  /** Whether the entry exists in the live Loader tree. */
  readonly present: boolean
  /** Effective enablement (a disabled ancestor group included). */
  readonly enabled: boolean
  /** The entry's fiber phase, or null while no fiber exists. */
  readonly phase: 'pending' | 'loading' | 'active' | 'failed' | 'disposed' | 'unloading' | null
}

/** One package whose declared DSH requirements reject the running DSH version. */
export interface MarketIncompatiblePlugin {
  readonly name: string
  readonly version: string
  readonly runtimeVersion?: string
  readonly requirements?: Readonly<Record<string, string>>
  readonly peers?: Readonly<Record<string, string>>
}

/** Structured management/load refusal reported by the Host pluginManager for an installed bundle. */
export interface MarketHostError {
  readonly code: string
  readonly diagnostic?: string
  readonly incompatible?: readonly MarketIncompatiblePlugin[]
}

/** One user-installed plugin package, with the live state of its entries. */
export interface MarketInstalledPackage {
  readonly packageName: string
  readonly icon?: string
  readonly version: string
  readonly titleZh?: string
  readonly titleEn?: string
  readonly description: string
  readonly descriptionZh?: string
  readonly descriptionEn?: string
  /**
   * The `owner/name` this package's manifest points its `repository` field
   * at, when that field names a GitHub repository in a shape matching
   * {@link REPOSITORY_SLUG_PATTERN}; '' otherwise.
   *
   * This is what joins an installed package to a catalog row: the catalog is
   * keyed by repository (it is a crawl of GitHub) while an install is keyed by
   * package name, and the two are only sometimes spelled alike.
   */
  readonly repository: string
  /** Normalized subdirectory within `repository` (e.g. `packages/dsh-plugin`), when installed from a subfolder. */
  readonly repositoryDirectory?: string
  /** The market's own row: listed, but the panel must not disable it. */
  readonly self: boolean
  /**
   * Seated by the desktop client rather than installed as a dependency: the
   * client copied it in and wrote its ownership marker. Listed so it can be
   * removed at all — the official CLI will not touch a name that is not a
   * dependency, and the client that seated it may be uninstalled by now.
   */
  readonly inBox: boolean
  /**
   * Installed outside the bundle stack on a legacy Host that cannot enable
   * it from this panel. The package remains available for uninstall.
   */
  readonly unregistered: boolean
  /** Host bundle selection when native package-level management is available. */
  readonly bundleEnabled?: boolean
  /** Effective package switch, including legacy entry-level stops. */
  readonly enabled: boolean
  readonly entries: readonly MarketInstalledEntry[]
  /** Why the bundle could not be read (uninstall stays available); '' when read. */
  readonly error: string
  /** Host-reported compatibility/platform/load refusal for this bundle, when any. */
  readonly hostError?: MarketHostError
  /**
   * A same-session uninstall of this package left stop rows in the profile's
   * patch layer that are still holding its entries down: the sweep record is
   * consumed only at the next boot, and the package came back before that —
   * a mid-session reinstall. The panel explains the disabled state, and the
   * ordinary Enable verb clears the rows.
   */
  readonly heldDown: boolean
}

/** The installed-panel read: the packages, or the reason the profile read failed. */
export interface MarketInstalledResult {
  readonly packages: readonly MarketInstalledPackage[]
  /** The profile the list describes (the panel names it in its explainer). */
  readonly profile: string
  readonly error: string
  /** The Host saved the change and requires a restart to apply it. */
  readonly restartRequired?: boolean
  /**
   * Fault details a verb wants the panel to wrap in localized copy. Absent
   * (or empty) means the default success line. The wrapping sentence is
   * chosen by {@link MarketInstalledResult.noticeKind}.
   */
  readonly notice?: string
  /**
   * How the panel should phrase a non-empty {@link MarketInstalledResult.notice}.
   * `may-run` means the package is off the profile but may keep running until
   * the next restart; `faults` means it is off the profile and the details
   * are the leftover work that did not finish.
   */
  readonly noticeKind?: 'faults' | 'may-run'
}

/** One enable/disable request for an installed package. */
export interface SetInstalledEnabledUpdate {
  readonly packageName: string
  readonly enabled: boolean
}

/** One uninstall request for an installed package. */
export interface UninstallInstalledUpdate {
  readonly packageName: string
}

const compatFallbackSchema = z.object({
  selectedVersion: z.string().max(80),
  latestVersion: z.string().max(80),
  latestEngine: z.string().max(400).optional(),
}).readonly()

const installInfoSchema = z.object({
  mode: z.enum(['command', 'manual']),
  targets: z.array(z.object({
    install: z.string().refine(isInstallSpec),
    profile: z.string().max(2000),
    note: z.string().max(2000),
    dshEngine: z.string().max(400).optional(),
    compatFallback: compatFallbackSchema.optional(),
  })).max(30),
  tasks: z.array(z.string().max(2000)).max(30),
  requirements: z.array(z.string().max(2000)).max(30),
  note: z.string().max(2000), manual: z.string().max(2000),
})

/** Strict wire codec for one market row. */
export const marketPluginSchema = z.object({
  icon: z.string().refine(isMarketIcon).optional(),
  packageName: z.string().regex(PACKAGE_NAME_PATTERN).optional(),
  titleZh: z.string().optional(), titleEn: z.string().optional(), descriptionEn: z.string().optional(),
  installStatus: z.enum(['command', 'manual', 'none']).optional(),
  keywords: z.array(z.string()).readonly().optional(),
  archived: z.boolean().optional(), disabled: z.boolean().optional(),
  installInfo: installInfoSchema.optional(),
  fullName: z.union([z.string().regex(REPOSITORY_SLUG_PATTERN), z.literal('')]),
  owner: z.string().min(1),
  name: z.string().min(1),
  // The Host rebuilds this from fullName; the codec makes the invariant
  // machine-checked, so no renderer needs to trust a caller's href.
  url: z.string().regex(/^(?:https:\/\/(?:github\.com|gitee\.com)\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+|https:\/\/www\.npmjs\.com\/package\/(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*)$/),
  description: z.string(),
  stars: z.number().int().min(0),
  language: z.string(),
  license: z.string(),
  pushedAt: z.string(),
  defaultBranch: z.string().refine(isSafeBranchName),
  category: z.string().min(1),
  categoryZh: z.string(),
  categoryEn: z.string(),
}).readonly()

/** Strict wire codec for one category filter. */
export const marketCategorySchema = z.object({
  key: z.string().min(1),
  zh: z.string(),
  en: z.string(),
  count: z.number().int().min(0),
}).readonly()

/** Strict wire codec for the editorial picks. */
export const marketFeaturedSchema = z.object({
  categories: z.array(marketCategorySchema).readonly().optional(),
  titleZh: z.string(),
  titleEn: z.string(),
  updatedAt: z.string(),
  count: z.number().int().min(0),
  entries: z.array(z.object({ item: marketPluginSchema, reason: z.string() }).readonly()).readonly(),
}).readonly()

/** Strict wire codec for the reduced catalog. */
export const marketCatalogSchema = z.object({
  items: z.array(marketPluginSchema).readonly(),
  categories: z.array(marketCategorySchema).readonly(),
  featured: marketFeaturedSchema.optional(),
  subscription: marketFeaturedSchema.optional(),
  fetchedAt: z.string(),
  publishedAt: z.string().optional(),
  refreshedAt: z.string(),
  scanned: z.number().int().min(0),
}).readonly()

/** Strict wire codec for one catalog read. */
export const marketCatalogResultSchema = z.object({
  catalog: z.union([marketCatalogSchema, z.null()]),
  stale: z.boolean(),
  error: z.string(),
}).readonly()

/** Strict wire codec for one resolvable skill. */
export const marketSkillSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  whenToUse: z.string(),
  provider: z.string(),
  source: z.string().optional(),
  instructionPath: z.string().min(1).max(4096).optional(),
  sourceDirectory: z.string().optional(),
  sourcePath: z.string().min(1).max(4096).optional(),
  featuredId: z.string().min(1).max(160).optional(),
  modelInvocable: z.boolean(),
  userInvocable: z.boolean(),
}).readonly()

/** Strict wire codec for one skills read. */
export const marketSkillsResultSchema = z.object({
  skills: z.array(marketSkillSchema).readonly(),
  cwd: z.string().optional(),
  preset: z.string().optional(),
  complete: z.boolean(),
  error: z.string(),
}).readonly()

export const DSH_VERSION_MAX_LENGTH = 80

/** Strict wire codec for the deployment facts the browser needs. */
export const marketEnvironmentSchema = z.object({
  profile: z.string(),
  version: z.string(),
  dshVersion: z.string().max(DSH_VERSION_MAX_LENGTH).optional(),
  telemetrySuppressedByEnv: z.boolean().optional(),
}).readonly()

/** Strict wire codec for the resolved settings section. */
export const safeMarketSettingsSchema = z.object({
  enabled: z.boolean(),
  aiAssistantEnabled: z.boolean(),
  telemetryEnabled: z.boolean(),
}).readonly()

/** Strict wire codec for one field update. */
export const safeMarketSettingsUpdateSchema = z.discriminatedUnion('field', [
  z.object({ field: z.literal('enabled'), value: z.boolean() }).readonly(),
  z.object({ field: z.literal('aiAssistantEnabled'), value: z.boolean() }).readonly(),
  z.object({ field: z.literal('telemetryEnabled'), value: z.boolean() }).readonly(),
])

const telemetryErrorCodeSchema = z.enum([
  'compat',
  'unsupported_platform',
  'not_bundle',
  'already_installed',
  'not_found',
  'pnpm_missing',
  'runtime_missing',
  'build_blocked',
  'build_failed',
  'git_failed',
  'tls_error',
  'auth_failed',
  'rate_limited',
  'fs_locked',
  'permission',
  'disk_full',
  'integrity',
  'invalid_spec',
  'network',
  'timeout',
  'refused',
  'cancelled',
  'write_failed',
  'operation_error',
  'unknown',
])

const telemetryErrorDetailSchema = z.string().regex(TELEMETRY_ERROR_DETAIL_PATTERN)

/** Strict wire codec for client-reported anonymous telemetry events. */
export const telemetryClientEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('client_hello'),
    hostKind: z.enum(['desktop', 'web', 'other']),
    locale: z.enum(['zh', 'en', 'other']),
  }).readonly(),
  z.object({
    kind: z.literal('plugin_install'),
    target: z.string().max(200),
    mode: z.enum(['direct', 'ai']),
    result: z.enum(['ok', 'failed']),
    errorCode: telemetryErrorCodeSchema.optional(),
    errorDetail: telemetryErrorDetailSchema.optional(),
  }).readonly(),
  z.object({
    kind: z.literal('mcp_install'),
    target: z.string().max(100),
    mode: z.enum(['featured', 'custom']),
    result: z.enum(['ok', 'failed']),
    errorCode: telemetryErrorCodeSchema.optional(),
    errorDetail: telemetryErrorDetailSchema.optional(),
  }).readonly(),
  z.object({
    kind: z.literal('skill_install'),
    target: z.string().max(200),
    mode: z.enum(['featured', 'ai']),
    result: z.enum(['ok', 'failed']),
    errorCode: telemetryErrorCodeSchema.optional(),
    errorDetail: telemetryErrorDetailSchema.optional(),
  }).readonly(),
])

/** Strict wire codec for an npm package name. */
export const packageNameSchema = z.string().regex(PACKAGE_NAME_PATTERN)

/** Strict wire codec for one installed entry's live state. */
export const marketInstalledEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  present: z.boolean(),
  enabled: z.boolean(),
  phase: z.union([
    z.enum(['pending', 'loading', 'active', 'failed', 'disposed', 'unloading']),
    z.null(),
  ]),
}).readonly()

const HOST_ERROR_LIMITS = {
  code: 80,
  diagnostic: 4000,
  maxIncompatible: 32,
  pluginName: 240,
  pluginVersion: 80,
  runtimeVersion: 80,
  reqKey: 200,
  reqValue: 400,
} as const

const marketIncompatiblePluginSchema = z.object({
  name: z.string().max(HOST_ERROR_LIMITS.pluginName),
  version: z.string().max(HOST_ERROR_LIMITS.pluginVersion),
  runtimeVersion: z.string().max(HOST_ERROR_LIMITS.runtimeVersion).optional(),
  requirements: z.record(z.string().max(HOST_ERROR_LIMITS.reqKey), z.string().max(HOST_ERROR_LIMITS.reqValue)).readonly().optional(),
  peers: z.record(z.string().max(HOST_ERROR_LIMITS.reqKey), z.string().max(HOST_ERROR_LIMITS.reqValue)).readonly().optional(),
}).readonly()

export const marketHostErrorSchema = z.object({
  code: z.string().max(HOST_ERROR_LIMITS.code),
  diagnostic: z.string().max(HOST_ERROR_LIMITS.diagnostic).optional(),
  incompatible: z.array(marketIncompatiblePluginSchema).max(HOST_ERROR_LIMITS.maxIncompatible).readonly().optional(),
}).readonly()

function sanitizeRequirementRecord(raw: unknown): Record<string, string> | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string') continue
    const k = key.slice(0, HOST_ERROR_LIMITS.reqKey)
    const v = value.slice(0, HOST_ERROR_LIMITS.reqValue)
    if (k !== '' && v !== '') out[k] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Normalize an arbitrary Host management error into the bounded wire shape. */
export function normalizeHostError(raw: unknown): MarketHostError | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const err = raw as {
    code?: unknown
    diagnostic?: unknown
    incompatible?: unknown
  }
  if (typeof err.code !== 'string' || err.code.trim() === '') return undefined
  const code = err.code.trim().slice(0, HOST_ERROR_LIMITS.code)
  const diagnostic = typeof err.diagnostic === 'string' && err.diagnostic.trim() !== ''
    ? err.diagnostic.trim().slice(0, HOST_ERROR_LIMITS.diagnostic)
    : undefined
  let incompatible: MarketIncompatiblePlugin[] | undefined
  if (Array.isArray(err.incompatible)) {
    const items: MarketIncompatiblePlugin[] = []
    for (const entry of err.incompatible.slice(0, HOST_ERROR_LIMITS.maxIncompatible)) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
      const rec = entry as {
        name?: unknown
        version?: unknown
        runtimeVersion?: unknown
        requirements?: unknown
        peers?: unknown
      }
      if (typeof rec.name !== 'string' || typeof rec.version !== 'string') continue
      const requirements = sanitizeRequirementRecord(rec.requirements)
      const peers = sanitizeRequirementRecord(rec.peers)
      items.push({
        name: rec.name.slice(0, HOST_ERROR_LIMITS.pluginName),
        version: rec.version.slice(0, HOST_ERROR_LIMITS.pluginVersion),
        ...(typeof rec.runtimeVersion === 'string' && rec.runtimeVersion.trim() !== ''
          ? { runtimeVersion: rec.runtimeVersion.trim().slice(0, HOST_ERROR_LIMITS.runtimeVersion) }
          : {}),
        ...(requirements !== undefined ? { requirements } : {}),
        ...(peers !== undefined ? { peers } : {}),
      })
    }
    if (items.length > 0) incompatible = items
  }
  return {
    code,
    ...(diagnostic !== undefined ? { diagnostic } : {}),
    ...(incompatible !== undefined ? { incompatible } : {}),
  }
}

/** Strict wire codec for one installed package. */
export const marketInstalledPackageSchema = z.object({
  packageName: packageNameSchema,
  icon: z.string().refine(isMarketIcon).optional(),
  version: z.string(),
  titleZh: z.string().optional(),
  titleEn: z.string().optional(),
  description: z.string(),
  descriptionZh: z.string().optional(),
  descriptionEn: z.string().optional(),
  // Either a slug the Host already shape-checked, or nothing. A manifest
  // pointing somewhere unparseable must not fail the whole panel read, so the
  // Host reduces it to '' rather than passing the raw field on.
  repository: z.union([z.string().regex(REPOSITORY_SLUG_PATTERN), z.literal('')]),
  repositoryDirectory: z.string().max(MAX_REPO_DIRECTORY_LENGTH).refine(value => value === '' || normalizeRepoDirectory(value) === value).optional(),
  self: z.boolean(),
  inBox: z.boolean(),
  unregistered: z.boolean(),
  bundleEnabled: z.boolean().optional(),
  enabled: z.boolean(),
  entries: z.array(marketInstalledEntrySchema).readonly(),
  error: z.string(),
  hostError: marketHostErrorSchema.optional(),
  heldDown: z.boolean(),
}).readonly()

/** Strict wire codec for the installed-panel read. */
export const marketInstalledResultSchema = z.object({
  packages: z.array(marketInstalledPackageSchema).readonly(),
  profile: z.string(),
  error: z.string(),
  notice: z.string().optional(),
  noticeKind: z.enum(['faults', 'may-run']).optional(),
  restartRequired: z.boolean().optional(),
}).readonly()

/** Strict wire codec for one enable/disable request. */
export const setInstalledEnabledUpdateSchema = z.object({
  packageName: packageNameSchema,
  enabled: z.boolean(),
}).readonly()

/** Strict wire codec for one uninstall request. */
export const uninstallInstalledUpdateSchema = z.object({
  packageName: packageNameSchema,
}).readonly()

/** One `dsh-mcp-client` row composed straight into the profile, outside the manager. */
export interface McpUnmanagedServer {
  /** The Loader entry id (patch-addressable). */
  readonly entryId: string
  /** The Loader's full entry identity — what the official plugin manager's `listPlugins` names `entryId`. */
  readonly loaderId: string
  readonly serverName: string
  readonly transport: 'stdio' | 'streamable-http' | 'unknown'
  readonly command: string
  /** Arguments with secret-looking values masked on the Host. */
  readonly args: readonly string[]
  /** Environment variable NAMES only; values never leave the Host. */
  readonly envKeys: readonly string[]
  /** Endpoint with secret query values masked. */
  readonly url: string
  /** Header NAMES only. */
  readonly headerKeys: readonly string[]
  readonly enabled: boolean
  readonly phase: 'pending' | 'loading' | 'active' | 'failed' | 'disposed' | 'unloading' | null
  /** Config paths that hold a secret in the clear (`args[3]`, `env.API_KEY`, …). */
  readonly plaintextSecrets: readonly string[]
  /** Why the row cannot be moved under the manager as it stands, or `''`. */
  readonly adoptBlocker: McpAdoptBlocker
}

/**
 * Why a static row cannot become a managed entry: an unknown transport, a
 * server name the manager would refuse, or an `!!js` expression other than a
 * plain `process.env.NAME` read.
 */
export type McpAdoptBlocker = '' | 'transport' | 'name' | 'expression'

/** What moving one static row under the manager did. */
export interface McpAdoptResult {
  /** The managed entry's name (the static row's `serverName`). */
  readonly name: string
  /** Credential references written by this adoption. */
  readonly stored: readonly string[]
  /** References that already held the same value and were reused. */
  readonly reused: readonly string[]
  /** Config fields the manager does not accept, left behind. */
  readonly dropped: readonly string[]
}

/** Strict wire codec for one adoption request. */
export const mcpAdoptRequestSchema = z.object({
  loaderId: z.string().min(1).max(1024),
}).readonly()

/** Strict wire codec for one adoption result. */
export const mcpAdoptResultSchema = z.object({
  name: z.string(),
  stored: z.array(z.string()).readonly(),
  reused: z.array(z.string()).readonly(),
  dropped: z.array(z.string()).readonly(),
}).readonly()

/** One registered MCP tool, as the model sees its name. */
export interface McpTool {
  readonly name: string
  readonly description: string
}

/** The live tools one server namespace contributes to the global view. */
export interface McpToolGroup {
  readonly server: string
  readonly tools: readonly McpTool[]
}

/** The MCP facts only the Host can answer. */
export interface McpHostContext {
  /** The `dsh-mcp-manager` Loader entry id — its Settings namespace — or null when the runtime has none. */
  readonly managerEntry: string | null
  readonly managerActive: boolean
  readonly unmanaged: readonly McpUnmanagedServer[]
  readonly tools: readonly McpToolGroup[]
  /** Why the tool view could not be read, when it could not. */
  readonly toolsError: string
}

const fiberPhaseSchema = z.union([
  z.enum(['pending', 'loading', 'active', 'failed', 'disposed', 'unloading']),
  z.null(),
])

/** Strict wire codec for the MCP Host read. */
export const mcpHostContextSchema = z.object({
  managerEntry: z.union([z.string(), z.null()]),
  managerActive: z.boolean(),
  unmanaged: z.array(z.object({
    entryId: z.string(),
    loaderId: z.string(),
    serverName: z.string(),
    transport: z.enum(['stdio', 'streamable-http', 'unknown']),
    command: z.string(),
    args: z.array(z.string()).readonly(),
    envKeys: z.array(z.string()).readonly(),
    url: z.string(),
    headerKeys: z.array(z.string()).readonly(),
    enabled: z.boolean(),
    phase: fiberPhaseSchema,
    plaintextSecrets: z.array(z.string()).readonly(),
    adoptBlocker: z.enum(['', 'transport', 'name', 'expression']),
  }).readonly()).readonly(),
  tools: z.array(z.object({
    server: z.string(),
    tools: z.array(z.object({ name: z.string(), description: z.string() }).readonly()).readonly(),
  }).readonly()).readonly(),
  toolsError: z.string(),
}).readonly()

/** One independent DSH MCP connection check and its cleanup result. */
const mcpProbeFields = {
  durationMs: z.number(),
  closeConfirmed: z.boolean(),
  cleanupError: z.string().optional(),
}
export const mcpProbeResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    ...mcpProbeFields,
    serverInfo: z.object({ name: z.string(), version: z.string() }).readonly().optional(),
    toolNames: z.array(z.string()).readonly(),
    truncated: z.boolean(),
  }).readonly(),
  z.object({
    ok: z.literal(false),
    ...mcpProbeFields,
    stage: z.enum(['connect', 'list']),
    message: z.string(),
  }).readonly(),
])
export type McpProbeResult = z.infer<typeof mcpProbeResultSchema>

export const featuredSkillInstallScopeSchema = z.enum(['user-dsh', 'user-agents', 'project-dsh'])

export const installFeaturedSkillRequestSchema = z.object({
  id: z.string().min(1).max(200),
  scope: featuredSkillInstallScopeSchema,
  projectDir: z.string().max(4096).optional(),
  overwrite: z.boolean().optional(),
}).readonly()

export const installFeaturedSkillResultSchema = z.object({
  ok: z.boolean(),
  id: z.string(),
  name: z.string(),
  scope: featuredSkillInstallScopeSchema,
  targetPath: z.string(),
  fileCount: z.number().int().nonnegative(),
  hasScripts: z.boolean(),
  code: z.enum([
    'not-found',
    'already-exists',
    'invalid-project-dir',
    'download-failed',
    'invalid-skill',
    'write-failed',
    'cancelled',
  ]).optional(),
  error: z.string(),
}).readonly()

export const deleteInstalledSkillRequestSchema = z.object({
  name: z.string().min(1).max(160),
  sourcePath: z.string().min(1).max(4096),
}).readonly()

export const deleteInstalledSkillResultSchema = z.object({
  ok: z.boolean(),
  name: z.string(),
  targetPath: z.string(),
  code: z.enum(['not-found', 'not-deletable', 'delete-failed']).optional(),
  error: z.string(),
}).readonly()

/** The dshMarketPro Remote namespace's strict invocation descriptors. */
export const SAFE_MARKET_INVOCATIONS: readonly InvocationDescriptor[] = [
  {
    id: 'dsh-market-pro#dshMarketPro/getCatalog',
    service: 'dshMarketPro',
    namespace: 'dshMarketPro',
    method: 'getCatalog',
    invocation: { kind: 'direct' },
    parameters: [
      {
        name: 'force',
        wire: 'force',
        source: 'json',
        codec: {
          mode: 'strict',
          typeSymbol: 'dsh-market-pro#ForceRefresh',
          create: () => z.boolean(),
        },
      },
    ],
    cancellation: { parameter: 'signal' },
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-market-pro#MarketCatalogResult',
      create: () => marketCatalogResultSchema,
    },
  },
  {
    id: 'dsh-market-pro#dshMarketPro/listSkills',
    service: 'dshMarketPro',
    namespace: 'dshMarketPro',
    method: 'listSkills',
    invocation: { kind: 'direct' },
    parameters: [
      {
        // A plain Session id, not an `agent` lookup: the lookup resumes a cold
        // Session (and refuses subagent ones), while the read only needs the
        // Session's projected directory and preset — the Host's own skill
        // catalog reads them the same way.
        name: 'sessionId',
        wire: 'sessionId',
        source: 'json',
        codec: { mode: 'strict', typeSymbol: 'dsh-market-pro#SessionId', create: () => sessionIdSchema },
      },
    ],
    cancellation: { parameter: 'signal' },
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-market-pro#MarketSkillsResult',
      create: () => marketSkillsResultSchema,
    },
  },
  {
    id: 'dsh-market-pro#dshMarketPro/describe',
    service: 'dshMarketPro',
    namespace: 'dshMarketPro',
    method: 'describe',
    invocation: { kind: 'direct' },
    parameters: [],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-market-pro#MarketEnvironment',
      create: () => marketEnvironmentSchema,
    },
  },
  {
    id: 'dsh-market-pro#dshMarketPro/getSettings',
    service: 'dshMarketPro',
    namespace: 'dshMarketPro',
    method: 'getSettings',
    invocation: { kind: 'direct' },
    parameters: [],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-market-pro#SafeMarketSettings',
      create: () => safeMarketSettingsSchema,
    },
  },
  {
    id: 'dsh-market-pro#dshMarketPro/updateSettings',
    service: 'dshMarketPro',
    namespace: 'dshMarketPro',
    method: 'updateSettings',
    invocation: { kind: 'direct' },
    parameters: [
      {
        name: 'update',
        wire: 'update',
        source: 'json',
        codec: {
          mode: 'strict',
          typeSymbol: 'dsh-market-pro#SafeMarketSettingsUpdate',
          create: () => safeMarketSettingsUpdateSchema,
        },
      },
    ],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-market-pro#SafeMarketSettings',
      create: () => safeMarketSettingsSchema,
    },
  },
  {
    id: 'dsh-market-pro#dshMarketPro/listInstalled',
    service: 'dshMarketPro',
    namespace: 'dshMarketPro',
    method: 'listInstalled',
    invocation: { kind: 'direct' },
    parameters: [],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-market-pro#MarketInstalledResult',
      create: () => marketInstalledResultSchema,
    },
  },
  {
    id: 'dsh-market-pro#dshMarketPro/setInstalledEnabled',
    service: 'dshMarketPro',
    namespace: 'dshMarketPro',
    method: 'setInstalledEnabled',
    invocation: { kind: 'direct' },
    parameters: [
      {
        name: 'update',
        wire: 'update',
        source: 'json',
        codec: {
          mode: 'strict',
          typeSymbol: 'dsh-market-pro#SetInstalledEnabledUpdate',
          create: () => setInstalledEnabledUpdateSchema,
        },
      },
    ],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-market-pro#MarketInstalledResult',
      create: () => marketInstalledResultSchema,
    },
  },
  {
    id: 'dsh-market-pro#dshMarketPro/uninstallInstalled',
    service: 'dshMarketPro',
    namespace: 'dshMarketPro',
    method: 'uninstallInstalled',
    invocation: { kind: 'direct' },
    parameters: [
      {
        name: 'update',
        wire: 'update',
        source: 'json',
        codec: {
          mode: 'strict',
          typeSymbol: 'dsh-market-pro#UninstallInstalledUpdate',
          create: () => uninstallInstalledUpdateSchema,
        },
      },
    ],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-market-pro#MarketInstalledResult',
      create: () => marketInstalledResultSchema,
    },
  },
  {
    id: 'dsh-market-pro#dshMarketPro/inspectMcp',
    service: 'dshMarketPro',
    namespace: 'dshMarketPro',
    method: 'inspectMcp',
    invocation: { kind: 'direct' },
    parameters: [],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-market-pro#McpHostContext',
      create: () => mcpHostContextSchema,
    },
  },
  {
    id: 'dsh-market-pro#dshMarketPro/probeMcp',
    service: 'dshMarketPro',
    namespace: 'dshMarketPro',
    method: 'probeMcp',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'name',
      wire: 'name',
      source: 'json',
      codec: { mode: 'strict', typeSymbol: 'dsh-market-pro#McpServerName', create: () => z.string().regex(SERVER_NAME_PATTERN) },
    }],
    cancellation: { parameter: 'signal' },
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-market-pro#McpProbeResult',
      create: () => mcpProbeResultSchema,
    },
  },
  {
    id: 'dsh-market-pro#dshMarketPro/adoptMcp',
    service: 'dshMarketPro',
    namespace: 'dshMarketPro',
    method: 'adoptMcp',
    invocation: { kind: 'direct' },
    parameters: [
      {
        name: 'request',
        wire: 'request',
        source: 'json',
        codec: {
          mode: 'strict',
          typeSymbol: 'dsh-market-pro#McpAdoptRequest',
          create: () => mcpAdoptRequestSchema,
        },
      },
    ],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-market-pro#McpAdoptResult',
      create: () => mcpAdoptResultSchema,
    },
  },
  {
    id: 'dsh-market-pro#dshMarketPro/installFeaturedSkill',
    service: 'dshMarketPro',
    namespace: 'dshMarketPro',
    method: 'installFeaturedSkill',
    invocation: { kind: 'direct' },
    parameters: [
      {
        name: 'request',
        wire: 'request',
        source: 'json',
        codec: {
          mode: 'strict',
          typeSymbol: 'dsh-market-pro#InstallFeaturedSkillRequest',
          create: () => installFeaturedSkillRequestSchema,
        },
      },
    ],
    cancellation: { parameter: 'signal' },
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-market-pro#InstallFeaturedSkillResult',
      create: () => installFeaturedSkillResultSchema,
    },
  },
  {
    id: 'dsh-market-pro#dshMarketPro/deleteInstalledSkill',
    service: 'dshMarketPro',
    namespace: 'dshMarketPro',
    method: 'deleteInstalledSkill',
    invocation: { kind: 'direct' },
    parameters: [
      {
        name: 'request',
        wire: 'request',
        source: 'json',
        codec: {
          mode: 'strict',
          typeSymbol: 'dsh-market-pro#DeleteInstalledSkillRequest',
          create: () => deleteInstalledSkillRequestSchema,
        },
      },
    ],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-market-pro#DeleteInstalledSkillResult',
      create: () => deleteInstalledSkillResultSchema,
    },
  },
  {
    id: 'dsh-market-pro#dshMarketPro/reportTelemetry',
    service: 'dshMarketPro',
    namespace: 'dshMarketPro',
    method: 'reportTelemetry',
    invocation: { kind: 'direct' },
    parameters: [
      {
        name: 'event',
        wire: 'event',
        source: 'json',
        codec: {
          mode: 'strict',
          typeSymbol: 'dsh-market-pro#TelemetryClientEvent',
          create: () => telemetryClientEventSchema,
        },
      },
    ],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-market-pro#TelemetryAck',
      create: () => z.object({ ok: z.boolean() }).readonly(),
    },
  },
]
