/** Update discovery and replacement use the official Host's package identities and decisions. */
import {
  classifyIncompatibleItems,
  classifyRequirementRecord,
  formatRequirementsText,
  type CompatibilityDirection,
} from '../compatibility.ts'
import type {
  BundleInfo, MarketIndexSummary, MarketQuery, MarketSearchResult, PluginInstallRequestId,
  PluginUpdateProgress, PluginUpdateResult, PluginVersionList, Registry,
} from '@deepseek-ai/dsh-api-remotes/client'
import { blocksHotUpdates, selectionWasRestored, updateKeepingSelection, type SelectionRestore } from '../pluginUpdateRecovery.ts'
import {
  isUpdateIgnored,
  readIgnoredUpdates,
  shouldClearIgnoredVersion,
  withIgnoredAllUpdates,
  withIgnoredVersion,
  withoutIgnoredUpdate,
  writeIgnoredUpdates,
  type IgnoredUpdatesMap,
} from './updateIgnore.ts'
export { blocksHotUpdates, isBundleInUse } from '../pluginUpdateRecovery.ts'

type Reply<T> = { ok: true; value: T } | { ok: false; error: { message: string } }
export interface UpdateHost {
  listBundles(): Promise<Reply<readonly (Pick<BundleInfo, 'name' | 'version' | 'installed' | 'update'> & Partial<Pick<BundleInfo, 'enabled'>> & { readonly updatable?: boolean })[]>>
  listVersions(name: string, options: object): Promise<Reply<PluginVersionList>>
  updateBundle(name: string, version: string, options: { registry?: Registry; spec?: string; requestId: PluginInstallRequestId }): Promise<Reply<PluginUpdateResult>>
  /** Used only to put back a selection the Host dropped during a refused removal. */
  setBundleEnabled?(name: string, enabled: boolean): Promise<Reply<{ readonly application: string }>>
}

function bundleUpdateKind(bundle: { readonly update?: 'registry' | 'git'; readonly updatable?: boolean } | undefined): 'registry' | 'git' | undefined {
  if (!bundle) return undefined
  return bundle.update ?? (bundle.updatable === true ? 'registry' : undefined)
}

async function updateHostBundle(
  api: UpdateHost,
  name: string,
  version: string,
  options: { registry?: Registry; spec?: string; requestId: PluginInstallRequestId },
) {
  return updateKeepingSelection(
    async () => {
      const listed = await api.listBundles()
      return listed.ok ? listed.value.find(item => item.name === name && item.installed)?.enabled : undefined
    },
    () => api.updateBundle(name, version, options),
    answer => answer.ok ? answer.value : undefined,
    api.setBundleEnabled && (async () => {
      const restored = await api.setBundleEnabled!(name, true)
      return restored.ok && selectionWasRestored(restored.value.application)
    }),
  )
}
export interface UpdateMarketHost {
  listIndexes(): Promise<Reply<readonly MarketIndexSummary[]>>
  search(url: string, query: MarketQuery): Promise<Reply<MarketSearchResult>>
}
export interface UpdateChoice {
  version: string
  prerelease: boolean
  deprecated?: string
  blocked?: string
  blockedKind?: CompatibilityDirection
  source: { registry: Registry } | { spec: string; index: string }
}
export interface AvailableUpdate {
  readonly packageName: string
  readonly installed: string
  readonly version: string
  readonly kind: 'registry' | 'git'
  readonly source: UpdateChoice['source']
}
export type BatchItemStatus =
  | 'pending'
  | 'running'
  | 'applied'
  | 'restart-required'
  | 'overridden'
  | 'cancelled'
  | 'failed'
  | 'unknown'
  | 'skipped'
export interface BatchUpdateItem {
  readonly packageName: string
  readonly from: string
  readonly to: string
  readonly kind: 'registry' | 'git'
  readonly source: UpdateChoice['source']
  readonly self: boolean
  readonly status: BatchItemStatus
  readonly step?: PluginUpdateProgress['step']
  readonly message?: string
  readonly restoreApplication?: 'applied' | 'restart-required' | 'overridden' | 'cancelled' | 'failed'
  readonly result?: PluginUpdateResult
  readonly selectionRestore?: SelectionRestore
  /** Set on a skipped item the batch held back because an earlier update left the process needing a restart. */
  readonly deferred?: 'restart'
}
export interface BatchUpdateState {
  readonly phase: 'idle' | 'running' | 'done'
  readonly items: readonly BatchUpdateItem[]
  readonly currentIndex: number
  readonly stopRequested: boolean
}
export interface UpdateState {
  phase: 'idle' | 'checking' | 'ready' | 'updating' | 'done' | 'error' | 'unknown'
  packageName: string
  installed: string
  kind?: 'registry' | 'git'
  choices: readonly UpdateChoice[]
  selected: string
  message: string
  warnings: readonly string[]
  omitted: number
  step?: PluginUpdateProgress['step']
  result?: PluginUpdateResult
  selectionRestore?: SelectionRestore
  /** Every settled update invalidates installed facts, including a failed update with restoration. */
  revision: number
  /** Newest compatible stable version detected per installed package name (filtered by ignore rules). */
  available: Readonly<Record<string, string>>
  /** Resolved update targets for one-click batch updates without a second lookup (filtered by ignore rules). */
  availableDetails: Readonly<Record<string, AvailableUpdate>>
  /** Per-package update ignore rules ("ignore version" or "mute all"). */
  ignored: IgnoredUpdatesMap
  /** Sequential batch update queue (skips failures, orders self last). */
  batch: BatchUpdateState
}

const IDLE_BATCH: BatchUpdateState = { phase: 'idle', items: [], currentIndex: -1, stopRequested: false }

const IDLE_SINGLE_UPDATE: Pick<
  UpdateState,
  'phase' | 'packageName' | 'installed' | 'kind' | 'choices' | 'selected' | 'message' | 'warnings' | 'omitted' | 'step' | 'result' | 'selectionRestore'
> = {
  phase: 'idle',
  packageName: '',
  installed: '',
  kind: undefined,
  choices: [],
  selected: '',
  message: '',
  warnings: [],
  omitted: 0,
  step: undefined,
  result: undefined,
  selectionRestore: undefined,
}

type ActiveUpdateRequest =
  | { readonly kind: 'none' }
  | { readonly kind: 'single'; readonly requestId: PluginInstallRequestId }
  | { readonly kind: 'batch'; readonly requestId: PluginInstallRequestId; readonly index: number }

/** Keep caller order while always placing the marketplace itself last so a self-reload cannot interrupt earlier updates. */
export function orderBatchTargets<T extends { readonly packageName: string }>(
  items: readonly T[],
  selfName: string,
): T[] {
  if (selfName === '') return [...items]
  const others: T[] = []
  const selfItems: T[] = []
  for (const item of items) {
    if (item.packageName === selfName) selfItems.push(item)
    else others.push(item)
  }
  return [...others, ...selfItems]
}

function defaultCandidate(choices: readonly UpdateChoice[]): string {
  return choices.find(version => !version.blocked && !version.prerelease && version.deprecated === undefined)?.version ?? ''
}

async function gitUpdateChoices(
  indexes: UpdateMarketHost,
  sources: readonly MarketIndexSummary[],
  packageName: string,
  isCurrent: () => boolean,
  fallbackRuntimeVersion?: string,
): Promise<{ choices: UpdateChoice[]; warnings: string[] }> {
  const warnings: string[] = []
  let fallback: UpdateChoice[] = []
  for (const source of sources) {
    let offset: number | null = 0
    let fetchedAt: number | undefined
    while (offset !== null) {
      const answer = await indexes.search(source.url, { text: packageName, sort: { kind: 'index' }, offset, limit: 100,
        ...(fetchedAt === undefined ? { refresh: true } : { fetchedAt }) })
      if (!isCurrent()) return { choices: [], warnings: [] }
      if (!answer.ok) { warnings.push(`${source.url}: ${answer.error.message}`); break }
      const page = answer.value
      const entry = page.entries.find(item => item.name === packageName)
      if (entry) {
        const choices = entry.versions.filter(version => version.update).map((version) => {
          let blocked: string | undefined
          let blockedKind: CompatibilityDirection | undefined
          if (!version.compatibility.compatible && !version.compatibility.exempted) {
            const reqText = formatRequirementsText(version.compatibility.requirements)
            blocked = reqText || 'Incompatible with this DSH host.'
            const runtime = 'runtimeVersion' in version.compatibility
              && typeof version.compatibility.runtimeVersion === 'string'
              && version.compatibility.runtimeVersion.trim() !== ''
              ? version.compatibility.runtimeVersion
              : fallbackRuntimeVersion
            blockedKind = classifyRequirementRecord(version.compatibility.requirements, runtime)
          }
          return {
            version: version.version,
            prerelease: version.version.split('+')[0]!.includes('-'),
            ...(blocked !== undefined ? { blocked } : {}),
            ...(blockedKind !== undefined ? { blockedKind } : {}),
            source: { spec: version.install.spec, index: source.url },
          }
        })
        if (defaultCandidate(choices)) return { choices, warnings }
        // Keep the first compatible prerelease in source order, or the first
        // blocked list for diagnostics when no compatible version exists.
        if (choices.length && (!fallback.length ||
          (!fallback.some(choice => !choice.blocked) && choices.some(choice => !choice.blocked)))) {
          fallback = choices
        }
        break
      }
      offset = page.nextOffset
      fetchedAt = page.fetchedAt
    }
  }
  return { choices: fallback, warnings }
}

function withAvailable(current: Readonly<Record<string, string>>, packageName: string, version: string): Readonly<Record<string, string>> {
  const clean = version.replace(/^v/i, '')
  if (clean !== '') return current[packageName] === clean ? current : { ...current, [packageName]: clean }
  if (!(packageName in current)) return current
  const { [packageName]: _removed, ...rest } = current
  return rest
}

function withAvailableDetail(
  current: Readonly<Record<string, AvailableUpdate>>,
  packageName: string,
  detail: AvailableUpdate | null,
): Readonly<Record<string, AvailableUpdate>> {
  if (detail !== null) {
    const clean = detail.version.replace(/^v/i, '')
    if (clean !== '') return { ...current, [packageName]: { ...detail, version: clean } }
  }
  if (!(packageName in current)) return current
  const { [packageName]: _removed, ...rest } = current
  return rest
}

function deriveVisible(
  detectedAvailable: Readonly<Record<string, string>>,
  detectedDetails: Readonly<Record<string, AvailableUpdate>>,
  ignored: IgnoredUpdatesMap,
): { available: Readonly<Record<string, string>>; availableDetails: Readonly<Record<string, AvailableUpdate>> } {
  const available: Record<string, string> = {}
  for (const [name, version] of Object.entries(detectedAvailable)) {
    if (!isUpdateIgnored(ignored[name], version)) available[name] = version
  }
  const availableDetails: Record<string, AvailableUpdate> = {}
  for (const [name, detail] of Object.entries(detectedDetails)) {
    if (!isUpdateIgnored(ignored[name], detail.version)) availableDetails[name] = detail
  }
  return { available, availableDetails }
}

function sameIgnoredMap(a: IgnoredUpdatesMap, b: IgnoredUpdatesMap): boolean {
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  for (const key of keysA) {
    const ruleA = a[key]
    const ruleB = b[key]
    if (!ruleA || !ruleB || ruleA.mode !== ruleB.mode) return false
    if (ruleA.mode === 'version' && ruleB.mode === 'version' && ruleA.version !== ruleB.version) return false
  }
  return true
}

/** One shared operation survives switching between the market's three entry points. */
export function createPluginUpdater(
  host: () => UpdateHost | undefined,
  market: () => UpdateMarketHost | undefined,
  getDshVersion?: () => string,
  storage?: Storage | null,
) {
  const initialIgnored = readIgnoredUpdates(storage)
  let detectedAvailable: Readonly<Record<string, string>> = {}
  let detectedDetails: Readonly<Record<string, AvailableUpdate>> = {}
  let state: UpdateState = {
    ...IDLE_SINGLE_UPDATE,
    revision: 0, available: {}, availableDetails: {}, ignored: initialIgnored, batch: IDLE_BATCH,
  }
  let generation = 0
  let fullProbeSeq = 0
  const packageProbeSeq = new Map<string, number>()
  let activeRequest: ActiveUpdateRequest = { kind: 'none' }
  const listeners = new Set<() => void>()
  const set = (patch: Partial<UpdateState>) => {
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }
  const patchBatchItem = (index: number, patch: Partial<BatchUpdateItem>) => {
    const items = state.batch.items.map((entry, i) => (i === index ? { ...entry, ...patch } : entry))
    set({ batch: { ...state.batch, items } })
  }
  const updater = {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    async probe(packageNames?: readonly string[]) {
      const api = host()
      if (!api?.listVersions || !api.updateBundle) return
      const isFull = packageNames === undefined
      const currentFull = isFull ? ++fullProbeSeq : undefined
      const isFullAlive = (): boolean => currentFull === undefined || currentFull === fullProbeSeq
      try {
        const inventory = await api.listBundles()
        if (!isFullAlive() || !inventory.ok) return
        const eligible = new Set(
          inventory.value.filter(item => item.installed && bundleUpdateKind(item) !== undefined).map(item => item.name),
        )
        const wanted = packageNames === undefined ? undefined : new Set(packageNames)
        let pruned = false
        for (const name of Object.keys(detectedAvailable)) {
          if (!eligible.has(name)) {
            detectedAvailable = withAvailable(detectedAvailable, name, '')
            pruned = true
          }
        }
        for (const name of Object.keys(detectedDetails)) {
          if (!eligible.has(name)) {
            detectedDetails = withAvailableDetail(detectedDetails, name, null)
            pruned = true
          }
        }
        if (pruned) set(deriveVisible(detectedAvailable, detectedDetails, state.ignored))
        const targets = inventory.value.filter(item => item.installed && bundleUpdateKind(item) !== undefined && (wanted === undefined || wanted.has(item.name)))
        const targetSeqs = new Map<string, number>()
        for (const bundle of targets) {
          const seq = (packageProbeSeq.get(bundle.name) ?? 0) + 1
          packageProbeSeq.set(bundle.name, seq)
          targetSeqs.set(bundle.name, seq)
        }
        const indexes = market()
        let gitSources: readonly MarketIndexSummary[] | undefined
        for (const bundle of targets) {
          if (!isFullAlive()) return
          const isBundleAlive = (): boolean => isFullAlive() && packageProbeSeq.get(bundle.name) === targetSeqs.get(bundle.name)
          if (!isBundleAlive()) continue
          if (state.ignored[bundle.name]?.mode === 'all') continue
          const kind = bundleUpdateKind(bundle)
          if (kind === 'registry') {
            const answer = await api.listVersions(bundle.name, {})
            if (!isFullAlive()) return
            if (!isBundleAlive()) continue
            if (!answer.ok) continue
            if (answer.value.status === 'refused') {
              if (answer.value.problem === 'not-updatable' || answer.value.problem === 'not-found') {
                detectedAvailable = withAvailable(detectedAvailable, bundle.name, '')
                detectedDetails = withAvailableDetail(detectedDetails, bundle.name, null)
                set(deriveVisible(detectedAvailable, detectedDetails, state.ignored))
              }
              continue
            }
            const candidate = answer.value.versions.find(version =>
              version.bundle && version.incompatible === undefined && !version.prerelease && version.deprecated === undefined)
            const nextVersion = candidate?.version ?? ''
            const detail: AvailableUpdate | null = nextVersion !== '' ? {
              packageName: bundle.name,
              installed: answer.value.installed || bundle.version || '',
              version: nextVersion,
              kind: 'registry',
              source: { registry: answer.value.registry },
            } : null
            detectedAvailable = withAvailable(detectedAvailable, bundle.name, nextVersion)
            detectedDetails = withAvailableDetail(detectedDetails, bundle.name, detail)
            set(deriveVisible(detectedAvailable, detectedDetails, state.ignored))
          } else if (kind === 'git' && indexes) {
            if (gitSources === undefined) {
              const listed = await indexes.listIndexes()
              if (!isFullAlive()) return
              gitSources = listed.ok ? listed.value : []
            }
            const { choices } = await gitUpdateChoices(
              indexes,
              gitSources,
              bundle.name,
              isBundleAlive,
              getDshVersion?.(),
            )
            if (!isFullAlive()) return
            if (!isBundleAlive()) continue
            const nextVersion = defaultCandidate(choices)
            const chosen = nextVersion !== '' ? choices.find(choice => choice.version === nextVersion) : undefined
            const detail: AvailableUpdate | null = chosen ? {
              packageName: bundle.name,
              installed: bundle.version ?? '',
              version: chosen.version,
              kind: 'git',
              source: chosen.source,
            } : null
            detectedAvailable = withAvailable(detectedAvailable, bundle.name, nextVersion)
            detectedDetails = withAvailableDetail(detectedDetails, bundle.name, detail)
            set(deriveVisible(detectedAvailable, detectedDetails, state.ignored))
          }
        }
      } catch {
        // Silent background probe: errors surface only when the user opens the update dialog.
      }
    },
    async check(packageName: string) {
      if (state.phase === 'updating' || state.batch.phase === 'running') return
      const current = ++generation
      set({ ...IDLE_SINGLE_UPDATE, phase: 'checking', packageName })
      try {
        const api = host()
        if (!api?.listVersions || !api.updateBundle) throw new Error('The Host does not provide plugin updates. Upgrade DSH to 0.2.2-rc.1 or later.')
        const inventory = await api.listBundles()
        if (current !== generation) return
        if (!inventory.ok) throw new Error(inventory.error.message)
        const bundle = inventory.value.find(item => item.name === packageName && item.installed)
        const kind = bundleUpdateKind(bundle)
        if (!kind) throw new Error('The official manager does not allow this installation to be updated. Built-in, local and unpinned Git copies may require their original installer.')
        let installedVersion = bundle?.version ?? ''
        set({ installed: installedVersion, kind })
        let choices: UpdateChoice[] = []
        let warnings: string[] = []
        let omitted = 0
        if (kind === 'registry') {
          // Supply every business argument: the strict Remote does not omit optional options.
          const answer = await api.listVersions(packageName, {})
          if (current !== generation) return
          if (!answer.ok) throw new Error(answer.error.message)
          const list = answer.value
          if (list.status === 'refused') throw new Error(list.reason)
          installedVersion = list.installed
          set({ installed: installedVersion })
          omitted = list.omitted
          choices = list.versions.map((version) => {
            if (version.incompatible) {
              const info = classifyIncompatibleItems([version.incompatible], getDshVersion?.())
              return {
                version: version.version,
                prerelease: version.prerelease,
                ...(version.deprecated === undefined ? {} : { deprecated: version.deprecated }),
                blocked: formatRequirementsText(version.incompatible.requirements),
                blockedKind: info.direction,
                source: { registry: list.registry },
              }
            }
            return {
              version: version.version,
              prerelease: version.prerelease,
              ...(version.deprecated === undefined ? {} : { deprecated: version.deprecated }),
              ...(!version.bundle ? { blocked: 'This version does not declare dsh.bundle.' } : {}),
              source: { registry: list.registry },
            }
          })
        } else {
          const indexes = market()
          if (!indexes) throw new Error('Git update discovery requires the official Discover feature and a configured subscription index.')
          const sources = await indexes.listIndexes()
          if (current !== generation) return
          if (!sources.ok) throw new Error(sources.error.message)
          if (!sources.value.length) throw new Error('Add a subscription index in the official Discover page before checking Git updates.')
          const found = await gitUpdateChoices(indexes, sources.value, packageName, () => current === generation, getDshVersion?.())
          if (current !== generation) return
          choices = found.choices
          warnings = found.warnings
          if (!choices.length && warnings.length) throw new Error(warnings.join('\n'))
        }
        if (current !== generation) return
        const selected = defaultCandidate(choices)
        const chosen = selected !== '' ? choices.find(choice => choice.version === selected) : undefined
        const detail: AvailableUpdate | null = chosen ? {
          packageName,
          installed: installedVersion,
          version: chosen.version,
          kind,
          source: chosen.source,
        } : null
        detectedAvailable = withAvailable(detectedAvailable, packageName, selected)
        detectedDetails = withAvailableDetail(detectedDetails, packageName, detail)
        set({
          phase: 'ready',
          choices,
          selected,
          warnings,
          omitted,
          ...deriveVisible(detectedAvailable, detectedDetails, state.ignored),
        })
      } catch (error) {
        if (current === generation) set({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
      }
    },
    select(version: string) {
      if (state.phase === 'ready' && state.choices.some(choice => choice.version === version && !choice.blocked)) set({ selected: version })
    },
    async confirm() {
      if (state.phase !== 'ready' || state.batch.phase === 'running') return
      const choice = state.choices.find(version => version.version === state.selected && !version.blocked)
      if (!choice) return
      const requestId = globalThis.crypto.randomUUID() as PluginInstallRequestId
      activeRequest = { kind: 'single', requestId }
      set({ phase: 'updating', message: '', step: 'checking', selectionRestore: undefined })
      try {
        const api = host()
        if (!api) throw new Error('The plugin manager is unavailable.')
        const source = choice.source
        const { answer, selectionRestore } = await updateHostBundle(api, state.packageName, choice.version,
          { ...('registry' in source ? { registry: source.registry } : { spec: source.spec }), requestId })
        const applied = answer.ok && (answer.value.result.application === 'applied' || answer.value.result.application === 'restart-required')
        let nextIgnored = state.ignored
        if (applied) {
          detectedAvailable = withAvailable(detectedAvailable, state.packageName, '')
          detectedDetails = withAvailableDetail(detectedDetails, state.packageName, null)
          if (shouldClearIgnoredVersion(state.ignored[state.packageName], choice.version)) {
            nextIgnored = withoutIgnoredUpdate(state.ignored, state.packageName)
            writeIgnoredUpdates(nextIgnored, storage)
          }
        }
        set(answer.ok ? {
          phase: 'done',
          step: undefined,
          result: answer.value,
          selectionRestore,
          revision: state.revision + 1,
          ...(applied ? {
            ignored: nextIgnored,
            ...deriveVisible(detectedAvailable, detectedDetails, nextIgnored),
          } : {}),
        } : { phase: 'unknown', step: undefined, message: answer.error.message, revision: state.revision + 1 })
      } catch (error) {
        set({ phase: 'unknown', step: undefined, message: error instanceof Error ? error.message : String(error), revision: state.revision + 1 })
      } finally { activeRequest = { kind: 'none' } }
    },
    async startBatch(targets: readonly (string | AvailableUpdate)[], selfName = '') {
      if (state.phase === 'updating' || state.batch.phase === 'running') return
      const resolved: AvailableUpdate[] = []
      const seen = new Set<string>()
      for (const entry of targets) {
        const detail = typeof entry === 'string' ? state.availableDetails[entry] : entry
        if (!detail || seen.has(detail.packageName)) continue
        seen.add(detail.packageName)
        resolved.push(detail)
      }
      if (resolved.length === 0) return
      const ordered = orderBatchTargets(resolved, selfName)
      const queue: BatchUpdateItem[] = ordered.map(item => ({
        packageName: item.packageName,
        from: item.installed,
        to: item.version,
        kind: item.kind,
        source: item.source,
        self: selfName !== '' && item.packageName === selfName,
        status: 'pending',
      }))
      generation += 1
      set({
        ...IDLE_SINGLE_UPDATE,
        batch: { phase: 'running', items: queue, currentIndex: 0, stopRequested: false },
      })
      for (let index = 0; index < queue.length; index += 1) {
        if (state.batch.stopRequested) {
          const items = state.batch.items.map((entry, i) => (i >= index ? { ...entry, status: 'skipped' as const } : entry))
          set({ batch: { phase: 'done', items, currentIndex: -1, stopRequested: false } })
          return
        }
        const entry = queue[index]!
        set({
          batch: {
            ...state.batch,
            currentIndex: index,
            items: state.batch.items.map((item, i) => (i === index ? { ...item, status: 'running', step: 'checking' } : item)),
          },
        })
        const requestId = globalThis.crypto.randomUUID() as PluginInstallRequestId
        activeRequest = { kind: 'batch', requestId, index }
        try {
          const api = host()
          if (!api?.updateBundle) throw new Error('The plugin manager is unavailable.')
          const source = entry.source
          const { answer, selectionRestore } = await updateHostBundle(api, entry.packageName, entry.to, {
            ...('registry' in source ? { registry: source.registry } : { spec: source.spec }),
            requestId,
          })
          if (answer.ok) {
            const app = answer.value.result.application
            const applied = app === 'applied' || app === 'restart-required'
            const matchesCurrentAvailable = detectedAvailable[entry.packageName] === entry.to.replace(/^v/i, '')
            let nextIgnored = state.ignored
            if (applied && matchesCurrentAvailable) {
              detectedAvailable = withAvailable(detectedAvailable, entry.packageName, '')
              detectedDetails = withAvailableDetail(detectedDetails, entry.packageName, null)
            }
            if (applied && shouldClearIgnoredVersion(state.ignored[entry.packageName], entry.to)) {
              nextIgnored = withoutIgnoredUpdate(state.ignored, entry.packageName)
              writeIgnoredUpdates(nextIgnored, storage)
            }
            const nextItems = state.batch.items.map((item, i) => (i === index ? {
              ...item,
              status: app as BatchItemStatus,
              step: undefined,
              result: answer.value,
              restoreApplication: answer.value.restore?.application,
              selectionRestore,
            } : item))
            set({
              batch: { ...state.batch, items: nextItems },
              revision: state.revision + 1,
              ...(applied ? {
                ignored: nextIgnored,
                ...deriveVisible(detectedAvailable, detectedDetails, nextIgnored),
              } : {}),
            })
          } else {
            const nextItems = state.batch.items.map((item, i) => (i === index ? {
              ...item,
              status: 'unknown' as const,
              step: undefined,
              message: answer.error.message,
            } : item))
            set({ batch: { ...state.batch, items: nextItems }, revision: state.revision + 1 })
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const nextItems = state.batch.items.map((item, i) => (i === index ? {
            ...item,
            status: 'unknown' as const,
            step: undefined,
            message,
          } : item))
          set({ batch: { ...state.batch, items: nextItems }, revision: state.revision + 1 })
        } finally {
          activeRequest = { kind: 'none' }
        }
        if (index < queue.length - 1 && blocksHotUpdates(state.batch.items[index]?.result)) {
          const items = state.batch.items.map((entry, i) => (i > index ? { ...entry, status: 'skipped' as const, deferred: 'restart' as const } : entry))
          set({ batch: { phase: 'done', items, currentIndex: -1, stopRequested: false } })
          return
        }
      }
      set({ batch: { ...state.batch, phase: 'done', currentIndex: -1, stopRequested: false } })
    },
    requestStopBatch() {
      if (state.batch.phase === 'running' && !state.batch.stopRequested) {
        set({ batch: { ...state.batch, stopRequested: true } })
      }
    },
    resetBatch() {
      if (state.batch.phase === 'running') return
      set({ batch: IDLE_BATCH })
    },
    ignoreVersion(packageName: string, version: string) {
      const nextIgnored = withIgnoredVersion(state.ignored, packageName, version)
      if (nextIgnored === state.ignored) return
      writeIgnoredUpdates(nextIgnored, storage)
      set({ ignored: nextIgnored, ...deriveVisible(detectedAvailable, detectedDetails, nextIgnored) })
    },
    ignoreAllUpdates(packageName: string) {
      const nextIgnored = withIgnoredAllUpdates(state.ignored, packageName)
      if (nextIgnored === state.ignored) return
      writeIgnoredUpdates(nextIgnored, storage)
      set({ ignored: nextIgnored, ...deriveVisible(detectedAvailable, detectedDetails, nextIgnored) })
    },
    unignore(packageName: string) {
      const previousRule = state.ignored[packageName]
      const nextIgnored = withoutIgnoredUpdate(state.ignored, packageName)
      if (nextIgnored === state.ignored) return
      writeIgnoredUpdates(nextIgnored, storage)
      set({ ignored: nextIgnored, ...deriveVisible(detectedAvailable, detectedDetails, nextIgnored) })
      if (previousRule?.mode === 'all' && !(packageName in detectedAvailable)) {
        void updater.probe([packageName])
      }
    },
    clearPackageState(packageName: string) {
      const nextDetectedAvailable = withAvailable(detectedAvailable, packageName, '')
      const nextDetectedDetails = withAvailableDetail(detectedDetails, packageName, null)
      const nextIgnored = withoutIgnoredUpdate(state.ignored, packageName)
      const detectedChanged = nextDetectedAvailable !== detectedAvailable || nextDetectedDetails !== detectedDetails
      const ignoredChanged = nextIgnored !== state.ignored
      if (!detectedChanged && !ignoredChanged) return
      detectedAvailable = nextDetectedAvailable
      detectedDetails = nextDetectedDetails
      if (ignoredChanged) writeIgnoredUpdates(nextIgnored, storage)
      set({ ignored: nextIgnored, ...deriveVisible(detectedAvailable, detectedDetails, nextIgnored) })
    },
    syncIgnoredFromStorage() {
      const nextIgnored = readIgnoredUpdates(storage)
      if (sameIgnoredMap(state.ignored, nextIgnored)) return
      const toProbe = Object.entries(state.ignored)
        .filter(([pkg, rule]) => rule.mode === 'all' && nextIgnored[pkg]?.mode !== 'all' && !(pkg in detectedAvailable))
        .map(([pkg]) => pkg)
      set({ ignored: nextIgnored, ...deriveVisible(detectedAvailable, detectedDetails, nextIgnored) })
      if (toProbe.length > 0) void updater.probe(toProbe)
    },
    progress(event: PluginUpdateProgress) {
      if (activeRequest.kind === 'none' || event.requestId !== activeRequest.requestId) return
      if (activeRequest.kind === 'single' && state.phase === 'updating') {
        set({ step: event.step })
      } else if (activeRequest.kind === 'batch' && state.batch.phase === 'running' && activeRequest.index >= 0) {
        patchBatchItem(activeRequest.index, { step: event.step })
      }
    },
    close() {
      if (state.phase === 'updating') return
      generation += 1
      set(IDLE_SINGLE_UPDATE)
    },
  }
  return updater
}
export type PluginUpdater = ReturnType<typeof createPluginUpdater>
