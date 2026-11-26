import { isMarketIcon } from '../shapes.ts'
import { shortName } from './owned.ts'

type Reply<T> = { ok: true; value: T } | { ok: false; error: { message: string } }

export type HostBundleLocalizedText = string | Readonly<Record<string, string>>

export interface HostBundleRow {
  readonly rowId: string
  readonly moduleName: string
  readonly entryId?: string
}

export interface HostBundleError {
  readonly code: string
  readonly diagnostic?: string
  readonly incompatible?: readonly {
    readonly name: string
    readonly version: string
    readonly runtimeVersion?: string
    readonly requirements?: Readonly<Record<string, string>>
  }[]
}

export interface HostBundleInfo {
  readonly name: string
  readonly official: boolean
  readonly availability: 'installation' | 'profile' | 'missing'
  readonly installTarget?: { readonly spec: string; readonly version: string }
  readonly version?: string
  readonly description?: string
  readonly meta?: {
    readonly title?: HostBundleLocalizedText
    readonly description?: HostBundleLocalizedText
    readonly icon?: string
    readonly error?: string
  }
  readonly listedByDefault?: boolean
  readonly installed: boolean
  readonly source?: string
  readonly optional: boolean
  readonly removable: boolean
  readonly enabled: boolean
  readonly readOnlyReason?: 'management-required' | 'unaddressable'
  readonly error?: HostBundleError
  readonly rows: readonly HostBundleRow[]
}

export interface HostBundleChangeResult {
  readonly application: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled'
  readonly restartReason?: string
  readonly error?: { readonly code: string; readonly diagnostic?: string }
}

export interface OfficialBundleHost {
  listBundles(): Promise<Reply<readonly HostBundleInfo[]>>
  setBundleEnabled(name: string, enabled: boolean): Promise<Reply<HostBundleChangeResult>>
  removeBundle?(name: string): Promise<Reply<HostBundleChangeResult>>
}

/** Core profile bundles and headless tools excluded from official plugin management UI. */
export const HIDDEN_OFFICIAL_BUNDLES = new Set([
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-headless',
  '@deepseek-ai/dsh-sdk-app',
  '@deepseek-ai/dsh-acp-app',
  '@deepseek-ai/dsh-sdk-minimal',
  '@deepseek-ai/dsh-experimental-terminal-bundle',
  '@deepseek-ai/dsh-experimental-tool-worktree',
])

const OFFICIAL_LEADING_ORDER: readonly string[] = [
  '@deepseek-ai/dsh-experimental-voice-input-bundle',
  '@deepseek-ai/dsh-experimental-plugin-market-bundle',
  '@deepseek-ai/dsh-experimental-auto-review',
]

const OFFICIAL_TRAILING_ORDER: readonly string[] = [
  '@deepseek-ai/dsh-personalized-recommendations',
  '@deepseek-ai/dsh-experimental-inspector-profile',
  '@deepseek-ai/dsh-cua-bundle',
  '@deepseek-ai/dsh-experimental-cot-translation-bundle',
  '@deepseek-ai/dsh-experimental-session-search',
  '@deepseek-ai/dsh-experimental-session-titles-bundle',
  '@deepseek-ai/dsh-experimental-badge-skill-bundle',
  '@deepseek-ai/dsh-experimental-ralph-bundle',
  '@deepseek-ai/dsh-deepseek-chat-import',
  '@deepseek-ai/dsh-subagent-codex',
  '@deepseek-ai/dsh-subagent-claude-code',
]

/** Whether one Host bundle belongs in the Official / Experimental management view. */
export function isListedOfficialBundle(bundle: HostBundleInfo): boolean {
  if (bundle.official !== true || HIDDEN_OFFICIAL_BUNDLES.has(bundle.name)) return false
  if (!bundle.optional && bundle.installTarget === undefined && !bundle.installed) return false
  return bundle.listedByDefault !== false
    || bundle.enabled === true
    || bundle.installed === true
    || bundle.rows.some(row => row.entryId !== undefined)
}

/** Whether the Host marks or names this official bundle as experimental. */
export function isExperimentalOfficialBundle(bundle: HostBundleInfo): boolean {
  return bundle.optional === true || bundle.name.includes('-experimental-')
}

/** Matches the official plugin manager's on-demand update eligibility rule. */
export function officialBundleUpdateAvailable(bundle: HostBundleInfo): boolean {
  const target = bundle.installTarget
  if (!bundle.installed || !bundle.removable || bundle.availability === 'installation' || target === undefined) {
    return false
  }
  return bundle.version !== target.version
    || ((target.spec.startsWith('link:') || bundle.source?.startsWith('link:') === true) && bundle.source !== target.spec)
}

/** Resolve localized Host bundle metadata text (`string` or locale map) cleanly. */
export function resolveOfficialLocalizedText(
  value: HostBundleLocalizedText | undefined,
  english: boolean,
): string {
  if (value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  const byLower = new Map<string, string>()
  for (const [key, candidate] of Object.entries(value)) {
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      const lower = key.toLowerCase()
      if (!byLower.has(lower)) byLower.set(lower, candidate.trim())
    }
  }
  const order = english
    ? ['en', 'en-us', 'zh', 'zh-cn', 'zh-hans']
    : ['zh', 'zh-cn', 'zh-hans', 'en', 'en-us']
  for (const key of order) {
    const found = byLower.get(key)
    if (found !== undefined) return found
  }
  const first = byLower.values().next()
  return first.done ? '' : first.value
}

function officialOrderRank(name: string): number {
  const lead = OFFICIAL_LEADING_ORDER.indexOf(name)
  if (lead >= 0) return lead
  const trail = OFFICIAL_TRAILING_ORDER.indexOf(name)
  return trail < 0 ? OFFICIAL_LEADING_ORDER.length : OFFICIAL_LEADING_ORDER.length + 1 + trail
}

/** Order official bundles matching DSH's experimental plugins view, with unknown bundles cleanly ranked between. */
export function orderOfficialBundles(bundles: readonly HostBundleInfo[]): HostBundleInfo[] {
  return [...bundles].sort((a, b) => {
    const rankDiff = officialOrderRank(a.name) - officialOrderRank(b.name)
    return rankDiff !== 0 ? rankDiff : a.name.localeCompare(b.name)
  })
}

export type OfficialBundleStatus = 'running' | 'disabled' | 'not-running' | 'problem'

export interface OfficialBundleDisplay {
  readonly title: string
  readonly description: string
  readonly icon?: string
  readonly experimental: boolean
  readonly notInstalled: boolean
  readonly updatable: boolean
  readonly status: OfficialBundleStatus
  readonly switchDisabled: boolean
  readonly errorCode?: string
}

/** Derive display metadata and control availability for one official bundle card. */
export function officialBundleDisplay(bundle: HostBundleInfo, english: boolean): OfficialBundleDisplay {
  const title = resolveOfficialLocalizedText(bundle.meta?.title, english) || shortName(bundle.name)
  const description = resolveOfficialLocalizedText(bundle.meta?.description, english) || bundle.description?.trim() || ''
  const rawIcon = bundle.meta?.icon
  const icon = typeof rawIcon === 'string' && rawIcon.length <= 400_000 && isMarketIcon(rawIcon)
    ? rawIcon
    : undefined
  const notInstalled = bundle.availability === 'missing'
  const updatable = officialBundleUpdateAvailable(bundle)
  let status: OfficialBundleStatus
  if (bundle.enabled && bundle.error !== undefined && bundle.rows.every(row => row.entryId === undefined)) {
    status = 'not-running'
  } else if (bundle.error !== undefined) {
    status = 'problem'
  } else {
    status = bundle.enabled ? 'running' : 'disabled'
  }
  const switchDisabled = bundle.readOnlyReason !== undefined
    || (!bundle.enabled
      && bundle.error !== undefined
      && (bundle.error.code === 'unsupported-platform'
        || !(bundle.availability === 'missing' && bundle.installTarget !== undefined)))
  return {
    title,
    description,
    ...(icon !== undefined ? { icon } : {}),
    experimental: isExperimentalOfficialBundle(bundle),
    notInstalled,
    updatable,
    status,
    switchDisabled,
    ...(bundle.error?.code !== undefined ? { errorCode: bundle.error.code } : {}),
  }
}

export type OfficialBundlesNotice =
  | { readonly kind: 'restart'; readonly packageName: string; readonly message: string }
  | { readonly kind: 'overridden'; readonly packageName: string; readonly message: string }
  | { readonly kind: 'removed'; readonly packageName: string; readonly message: string }
  | { readonly kind: 'error'; readonly packageName: string; readonly message: string }

export interface OfficialBundlesState {
  readonly status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
  readonly bundles: readonly HostBundleInfo[]
  readonly busy: readonly string[]
  readonly uninstalling: readonly string[]
  readonly confirmingUninstall: string | null
  readonly notice: OfficialBundlesNotice | null
  readonly error: string
}

const INITIAL_STATE: OfficialBundlesState = {
  status: 'idle',
  bundles: [],
  busy: [],
  uninstalling: [],
  confirmingUninstall: null,
  notice: null,
  error: '',
}

export interface OfficialBundlesController {
  getSnapshot(): OfficialBundlesState
  subscribe(listener: () => void): () => void
  load(): Promise<void>
  refresh(): Promise<void>
  toggle(
    bundle: HostBundleInfo,
    enabled: boolean,
    onInstallOnDemand?: (bundle: HostBundleInfo, enabled: boolean) => void,
  ): Promise<void>
  update(
    bundle: HostBundleInfo,
    onInstallOnDemand?: (bundle: HostBundleInfo, enabled: boolean) => void,
    canInstall?: () => boolean,
  ): Promise<void>
  requestUninstall(packageName: string): void
  cancelUninstall(): void
  confirmUninstallNow(packageName: string): Promise<void>
  dismissNotice(): void
  dispose(): void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function changeFailureText(result: HostBundleChangeResult): string {
  return result.error?.diagnostic || result.error?.code || result.application
}

/**
 * Shared client controller that reads and mutates DSH's official / experimental
 * bundles directly via `remote.pluginManager`, staying in lockstep with DSH's
 * built-in Plugins view through `plugin-manager/changed`.
 */
export function createOfficialBundlesController(options: {
  readonly host: () => OfficialBundleHost | undefined
}): OfficialBundlesController {
  let state: OfficialBundlesState = INITIAL_STATE
  let inFlight: Promise<void> | undefined
  let rerun = false
  let generation = 0
  let disposed = false
  const listeners = new Set<() => void>()

  const publish = (patch: Partial<OfficialBundlesState>): void => {
    if (disposed) return
    state = { ...state, ...patch }
    for (const listener of [...listeners]) listener()
  }

  const readOnce = async (): Promise<void> => {
    try {
      do {
        rerun = false
        const gen = ++generation
        const api = options.host()
        if (api === undefined || typeof api.listBundles !== 'function') {
          publish({ status: 'unavailable', bundles: [], error: '' })
          continue
        }
        if (state.status === 'idle' || state.status === 'error') {
          publish({ status: 'loading', error: '' })
        }
        try {
          const reply = await api.listBundles()
          if (disposed || gen !== generation) return
          if (!reply.ok) {
            publish({ status: 'error', error: reply.error.message })
            continue
          }
          const filtered = orderOfficialBundles(reply.value.filter(isListedOfficialBundle))
          publish({ status: 'ready', bundles: filtered, error: '' })
        } catch (error) {
          if (disposed || gen !== generation) return
          publish({ status: 'error', error: errorMessage(error) })
        }
      } while (rerun && !disposed)
    } finally {
      inFlight = undefined
    }
  }

  const load = (): Promise<void> => {
    if (disposed) return Promise.resolve()
    if (inFlight !== undefined) {
      rerun = true
      return inFlight
    }
    inFlight = Promise.resolve().then(() => readOnce())
    return inFlight
  }

  const withBusy = async (
    packageName: string,
    task: () => Promise<void>,
    mode: 'default' | 'uninstall' = 'default',
  ): Promise<void> => {
    if (disposed || state.busy.includes(packageName)) return
    publish({
      busy: [...state.busy, packageName],
      ...(mode === 'uninstall' ? { uninstalling: [...state.uninstalling, packageName] } : {}),
      confirmingUninstall: state.confirmingUninstall === packageName ? null : state.confirmingUninstall,
      notice: null,
    })
    try {
      await task()
    } finally {
      if (!disposed) {
        publish({
          busy: state.busy.filter(name => name !== packageName),
          ...(mode === 'uninstall' ? { uninstalling: state.uninstalling.filter(name => name !== packageName) } : {}),
        })
      }
    }
    await load()
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    load,
    refresh: load,
    async toggle(bundle, enabled, onInstallOnDemand) {
      if (enabled && bundle.availability === 'missing' && bundle.installTarget !== undefined) {
        onInstallOnDemand?.(bundle, true)
        return
      }
      await withBusy(bundle.name, async () => {
        const api = options.host()
        if (api === undefined) {
          publish({ notice: { kind: 'error', packageName: bundle.name, message: 'pluginManager is unavailable' } })
          return
        }
        try {
          const reply = await api.setBundleEnabled(bundle.name, enabled)
          if (!reply.ok) {
            publish({ notice: { kind: 'error', packageName: bundle.name, message: reply.error.message } })
            return
          }
          const outcome = reply.value
          if (outcome.application === 'restart-required') {
            publish({ notice: { kind: 'restart', packageName: bundle.name, message: '' } })
          } else if (outcome.application === 'overridden') {
            publish({ notice: { kind: 'overridden', packageName: bundle.name, message: '' } })
          } else if (outcome.application === 'failed') {
            publish({ notice: { kind: 'error', packageName: bundle.name, message: changeFailureText(outcome) } })
          }
        } catch (error) {
          publish({ notice: { kind: 'error', packageName: bundle.name, message: errorMessage(error) } })
        }
      })
    },
    async update(bundle, onInstallOnDemand, canInstall) {
      if (bundle.installTarget === undefined || bundle.availability === 'installation') return
      if (canInstall !== undefined && !canInstall()) return
      if (!bundle.installed) {
        onInstallOnDemand?.(bundle, bundle.enabled)
        return
      }
      await withBusy(bundle.name, async () => {
        if (canInstall !== undefined && !canInstall()) return
        const api = options.host()
        if (api === undefined || typeof api.removeBundle !== 'function') {
          publish({ notice: { kind: 'error', packageName: bundle.name, message: 'removeBundle is unavailable' } })
          return
        }
        try {
          const removed = await api.removeBundle(bundle.name)
          if (!removed.ok) {
            publish({ notice: { kind: 'error', packageName: bundle.name, message: removed.error.message } })
            return
          }
          if (removed.value.application === 'failed' && removed.value.error?.code !== 'stop-profile') {
            publish({ notice: { kind: 'error', packageName: bundle.name, message: changeFailureText(removed.value) } })
            return
          }
          if (removed.value.application === 'overridden') {
            publish({ notice: { kind: 'overridden', packageName: bundle.name, message: '' } })
            return
          }
          if (removed.value.application === 'cancelled') {
            return
          }
          if (removed.value.application === 'restart-required') {
            publish({ notice: { kind: 'restart', packageName: bundle.name, message: '' } })
          }
          onInstallOnDemand?.(bundle, bundle.enabled)
        } catch (error) {
          publish({ notice: { kind: 'error', packageName: bundle.name, message: errorMessage(error) } })
        }
      })
    },
    requestUninstall(packageName) {
      if (state.busy.includes(packageName)) return
      publish({ confirmingUninstall: packageName, notice: null })
    },
    cancelUninstall() {
      if (state.confirmingUninstall !== null) publish({ confirmingUninstall: null })
    },
    async confirmUninstallNow(packageName) {
      await withBusy(packageName, async () => {
        const api = options.host()
        if (api === undefined || typeof api.removeBundle !== 'function') {
          publish({ notice: { kind: 'error', packageName, message: 'removeBundle is unavailable' } })
          return
        }
        try {
          const removed = await api.removeBundle(packageName)
          if (!removed.ok) {
            publish({ notice: { kind: 'error', packageName, message: removed.error.message } })
            return
          }
          if (removed.value.application === 'failed') {
            publish({ notice: { kind: 'error', packageName, message: changeFailureText(removed.value) } })
          } else if (removed.value.application === 'restart-required') {
            publish({ notice: { kind: 'restart', packageName, message: '' } })
          } else if (removed.value.application === 'applied') {
            publish({ notice: { kind: 'removed', packageName, message: '' } })
          }
        } catch (error) {
          publish({ notice: { kind: 'error', packageName, message: errorMessage(error) } })
        }
      }, 'uninstall')
    },
    dismissNotice() {
      if (state.notice !== null) publish({ notice: null })
    },
    dispose() {
      disposed = true
      generation += 1
      listeners.clear()
    },
  }
}
