import { isInstallSpec, type InstallInfo } from '../installInfo.ts'
import type { MarketInstalledPackage } from '../contract.ts'
import { ownedByTarget } from './owned.ts'

// Structural boundary for the optional host service. Do not rely on ambient
// plugin-manager declarations contributed by unrelated development packages.
type Reply<T> = { ok: true; value: T } | { ok: false; error: { message: string } }
type RequestId = string | undefined
interface InstallResult {
  application: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled'
  pendingBuilds?: string[]
  warnings?: string[]
  error?: { code: string; diagnostic?: string; incompatible?: {
    name: string; version: string
    requirements?: Record<string, string>
    /** Before DSH 0.2.1-alpha.4. */
    peers?: Record<string, string>
  }[] }
  packageResult?: { output?: string; kind?: string; timedOut?: boolean }
}
export interface PluginRegistriesSnapshot {
  readonly registry: string | null
  readonly fallbackRegistries: readonly string[]
  readonly resolved: string | null
}
export interface InstallHost {
  inspect(spec: string, options: { registry?: string | null }): Promise<Reply<
    {
      status: 'accepted'
      registry: string | null
      kind?: string
      name?: string
      version?: string
      description?: string
      bundle?: boolean | null
      host?: string
    } |
    { status: 'refused'; problem: string; reason: string; registries?: readonly (string | null)[] }
  >>
  installBundle(spec: string, options?: {
    requestId?: string
    registry?: string | null
    enabled?: boolean
    saveExact?: boolean
    approvedBuilds?: string[]
  }): Promise<Reply<InstallResult>>
  cancelInstall(requestId: string): Promise<Reply<{ status: string }>>
  waitForInstall(requestId: string): Promise<Reply<InstallResult | null>>
  registries?(): Promise<Reply<PluginRegistriesSnapshot>>
}
export interface InspectRefusal {
  readonly problem: string
  readonly reason: string
  readonly registries?: readonly (string | null)[]
}
export interface DirectState {
  phase: 'idle' | 'checking' | 'installing' | 'cancelling' | 'unknown' | 'unavailable' | 'done' | 'failed'
  origin: 'catalog' | 'manual'
  spec: string
  manualTitle?: string
  registry?: string | null
  message: string
  inspectError?: InspectRefusal
  application?: string
  pendingBuilds: string[]
  /** True while `recover()` is polling the Host for an interrupted install's outcome. */
  recovering: boolean
  queue: { spec: string; phase: DirectState['phase']; application?: string; message: string }[]
}
const IDLE_DIRECT_STATE: DirectState = {
  phase: 'idle',
  origin: 'catalog',
  spec: '',
  manualTitle: undefined,
  registry: undefined,
  message: '',
  inspectError: undefined,
  application: undefined,
  pendingBuilds: [],
  recovering: false,
  queue: [],
}
export interface DirectInstallOutcome {
  readonly spec: string
  readonly result: 'ok' | 'failed'
  readonly message: string
  readonly manual?: boolean
  readonly inspectProblem?: string
  readonly errorCode?: string
  readonly packageKind?: string
  readonly timedOut?: boolean
}

export interface ManualInstallOptions {
  readonly registry?: string | null
  readonly saveExact?: boolean
  readonly enabled?: boolean
  readonly title?: string
}

interface RunOptions {
  readonly origin: 'catalog' | 'manual'
  readonly registry?: string | null
  readonly saveExact?: boolean
  readonly enabled: boolean
  readonly manualTitle?: string
}

const DEFAULT_RUN_OPTIONS: RunOptions = { origin: 'catalog', enabled: true }

/** Basic sanity check for user-entered package names, Git URLs, tarballs, or local directories. */
export function isManualInstallInputValid(raw: string): boolean {
  const trimmed = raw.trim()
  return trimmed !== '' && trimmed.length <= 2048 && !/[\u0000-\u001f]/.test(trimmed)
}

/** Validate a user-entered custom npm registry URL (`http://` or `https://`). */
export function isValidCustomRegistryUrl(raw: string): boolean {
  const trimmed = raw.trim()
  if (!/^https?:\/\/[^/\s]+/i.test(trimmed)) return false
  try {
    const parsed = new URL(trimmed)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host !== ''
  } catch {
    return false
  }
}

function registryCompareKey(registry: string | null, resolved: string | null): string {
  const url = registry ?? resolved
  if (url === null) return ''
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '').toLowerCase()
  } catch {
    return url.trim().replace(/\/+$/, '').toLowerCase()
  }
}

/** Deduplicated list of registries offered by the Host (primary, fallbacks, and pnpm default). */
export function offeredInstallRegistries(registries: PluginRegistriesSnapshot | null): readonly (string | null)[] {
  const offered: (string | null)[] = []
  const keys = new Set<string>()
  const resolved = registries?.resolved ?? null
  for (const candidate of [...(registries === null ? [] : [registries.registry, ...registries.fallbackRegistries]), null]) {
    const key = registryCompareKey(candidate, resolved)
    if (keys.has(key)) continue
    keys.add(key)
    offered.push(candidate)
  }
  return offered
}

/** Classify a registry URL into a user-facing label key + hostname. */
export function installRegistryLabel(
  registry: string | null,
  resolved: string | null,
): { readonly kind: 'default' | 'official' | 'npmmirror' | 'host'; readonly host: string } {
  const url = registry ?? resolved
  if (url === null) return { kind: 'default', host: 'registry.npmjs.org' }
  let host = url
  try {
    host = new URL(url).host || url
  } catch {
    /* keep raw url as host */
  }
  if (host === 'registry.npmjs.org') return { kind: 'official', host }
  if (host === 'registry.npmmirror.com') return { kind: 'npmmirror', host }
  return { kind: 'host', host }
}

export function createDirectInstaller(
  host: () => InstallHost | undefined,
  onOutcome?: (outcome: DirectInstallOutcome) => void,
) {
  let state: DirectState = IDLE_DIRECT_STATE
  let requestId: RequestId
  let stopped = false
  let runOptions: RunOptions = DEFAULT_RUN_OPTIONS
  const listeners = new Set<() => void>()
  const set = (patch: Partial<DirectState>) => {
    const next = { ...state, ...patch }
    state = {
      ...next,
      queue: next.queue.map(entry => entry.spec === next.spec
        ? { spec: next.spec, phase: next.phase, application: next.application, message: next.message }
        : entry),
    }
    for (const fn of listeners) fn()
  }
  const manager = () => { const value = host(); if (!value) throw new Error('Plugin installation is unavailable in this host.'); return value }
  const cancelling = () => state.phase === 'cancelling'
  const busy = () => ['checking', 'installing', 'cancelling', 'unknown'].includes(state.phase)
  const settle = async (result: Awaited<ReturnType<InstallHost['installBundle']>>) => {
    if (!result.ok) { set({ phase: 'unknown', recovering: false, message: result.error.message }); return }
    const value = result.value
    const summary = [value.error?.code, value.error?.diagnostic, ...(value.warnings ?? []),
      ...(value.error?.incompatible ?? []).map(p => `${p.name}@${p.version}: ${JSON.stringify(p.requirements ?? p.peers ?? {})}`),
      value.application === 'failed' ? value.packageResult?.output : undefined,
    ].filter(Boolean).join('\n').slice(-8000)
    const spec = state.spec
    const manual = runOptions.origin === 'manual'
    set({ phase: value.application === 'failed' ? 'failed' : 'done', application: value.application,
      recovering: false,
      pendingBuilds: value.pendingBuilds ?? [],
      message: summary })
    if (value.application === 'applied' || value.application === 'restart-required') {
      onOutcome?.({ spec, result: 'ok', message: '', ...(manual ? { manual: true } : {}) })
    } else if (value.application === 'failed' && (value.pendingBuilds?.length ?? 0) === 0) {
      onOutcome?.({
        spec,
        result: 'failed',
        message: summary,
        ...(manual ? { manual: true } : {}),
        ...(value.error?.code !== undefined ? { errorCode: value.error.code } : {}),
        ...(value.packageResult?.kind !== undefined ? { packageKind: value.packageResult.kind } : {}),
        ...(value.packageResult?.timedOut !== undefined ? { timedOut: value.packageResult.timedOut } : {}),
      })
    }
    if (!stopped && (value.application === 'applied' || value.application === 'restart-required')) {
      const next = state.queue.find(entry => entry.phase === 'idle')
      if (next) await run(next.spec, [], undefined, runOptions)
    }
  }
  const run = async (
    spec: string,
    builds: string[] = [],
    initialQueue?: DirectState['queue'],
    options: RunOptions = DEFAULT_RUN_OPTIONS,
  ) => {
    if (busy()) return
    runOptions = options
    const manual = options.origin === 'manual'
    const valid = manual ? isManualInstallInputValid(spec) : isInstallSpec(spec)
    if (!valid) {
      set({
        phase: 'failed',
        origin: options.origin,
        spec,
        manualTitle: options.manualTitle,
        registry: options.registry,
        message: 'Invalid install target',
        inspectError: { problem: 'invalid-spec', reason: 'Invalid install target' },
        application: undefined,
        pendingBuilds: [],
        recovering: false,
        ...(initialQueue !== undefined ? { queue: initialQueue } : {}),
      })
      return
    }
    requestId = undefined
    set({
      phase: 'checking',
      origin: options.origin,
      spec,
      manualTitle: options.manualTitle,
      registry: options.registry,
      message: '',
      inspectError: undefined,
      application: undefined,
      pendingBuilds: [],
      recovering: false,
      ...(initialQueue !== undefined ? { queue: initialQueue } : {}),
    })
    let inspectError: InspectRefusal | undefined
    try {
      const api = manager()
      // The strict Remote counts every business parameter, even optional ones.
      const inspection = await api.inspect(spec, options.registry !== undefined ? { registry: options.registry } : {})
      if (!inspection.ok) {
        inspectError = { problem: 'unknown', reason: inspection.error.message }
        throw new Error(inspection.error.message)
      }
      if (inspection.value.status === 'refused') {
        inspectError = {
          problem: inspection.value.problem,
          reason: inspection.value.reason,
          ...(inspection.value.registries !== undefined ? { registries: inspection.value.registries } : {}),
        }
        throw new Error(`${inspection.value.problem}: ${inspection.value.reason}`)
      }
      requestId = globalThis.crypto.randomUUID() as RequestId
      set({ phase: 'installing', inspectError: undefined })
      try {
        await settle(await api.installBundle(spec, {
          requestId,
          registry: inspection.value.registry,
          enabled: options.enabled,
          ...(options.saveExact ? { saveExact: true } : {}),
          ...(builds.length ? { approvedBuilds: builds } : {}),
        }))
      } catch (error) { set({ phase: 'unknown', recovering: false, message: String(error) }) }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      const resolvedInspectError = inspectError ?? { problem: 'unknown', reason: errMsg }
      set({ phase: 'failed', recovering: false, message: errMsg, inspectError: resolvedInspectError })
      onOutcome?.({
        spec,
        result: 'failed',
        message: errMsg,
        ...(manual ? { manual: true } : {}),
        ...(inspectError !== undefined && inspectError.problem !== 'unknown' ? { inspectProblem: inspectError.problem } : {}),
      })
    }
  }
  return {
    getSnapshot: () => state,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    async start(input: string | string[]) {
      if (busy()) return
      const specs = [...new Set(typeof input === 'string' ? [input] : input)]
      if (!specs.length || specs.some(spec => !isInstallSpec(spec))) return
      stopped = false
      const queue = specs.map(spec => ({ spec, phase: 'idle' as const, message: '' }))
      await run(specs[0]!, [], queue, { origin: 'catalog', enabled: true })
    },
    async startManual(rawSpec: string, options: ManualInstallOptions = {}) {
      if (busy()) return
      const trimmed = rawSpec.trim()
      stopped = false
      const opts: RunOptions = {
        origin: 'manual',
        registry: options.registry,
        saveExact: options.saveExact,
        enabled: options.enabled ?? true,
        manualTitle: options.title,
      }
      if (!isManualInstallInputValid(trimmed)) {
        await run(trimmed, [], undefined, opts)
        return
      }
      const queue = [{ spec: trimmed, phase: 'idle' as const, message: '' }]
      await run(trimmed, [], queue, opts)
    },
    async listRegistries(): Promise<PluginRegistriesSnapshot | null> {
      try {
        const fn = host()?.registries
        if (typeof fn !== 'function') return null
        const result = await fn()
        return result.ok ? result.value : null
      } catch {
        return null
      }
    },
    // The Host writes each approval into allowBuilds and refuses a name that is
    // no longer pending ('stale-approval'): a retry carries no approvals, and an
    // approval names only what the failed run left pending.
    async retry() {
      if (state.phase === 'failed' && !state.pendingBuilds.length) await run(state.spec, [], undefined, runOptions)
    },
    reset() {
      if (!busy()) {
        requestId = undefined
        stopped = false
        runOptions = DEFAULT_RUN_OPTIONS
        set(IDLE_DIRECT_STATE)
      }
    },
    approve: async () => {
      if (state.phase === 'failed' && state.pendingBuilds.length) await run(state.spec, [...state.pendingBuilds], undefined, runOptions)
    },
    async cancel() {
      if (!requestId || state.phase !== 'installing') return
      stopped = true
      const cancellingRequest = requestId
      set({ phase: 'cancelling' })
      try {
        const result = await manager().cancelInstall(cancellingRequest)
        if (requestId !== cancellingRequest || !cancelling()) return
        if (!result.ok) {
          stopped = false
          set({ phase: 'installing', message: result.error.message })
        } else if (cancelling() && result.value.status !== 'cancelled') {
          stopped = false
          set({ phase: 'installing', message: result.value.status })
        }
      } catch (e) {
        if (requestId === cancellingRequest && cancelling()) {
          stopped = false
          set({ phase: 'installing', message: String(e) })
        }
      }
    },
    async recover() {
      if (!requestId || state.phase !== 'unknown' || state.recovering) return
      const targetRequest = requestId
      set({ recovering: true })
      try {
        const result = await manager().waitForInstall(targetRequest)
        if (requestId !== targetRequest) return
        if (!result.ok) set({ recovering: false, message: result.error.message })
        else if (result.value !== null) await settle({ ok: true, value: result.value })
        else set({ phase: 'unavailable', recovering: false })
      } catch (e) {
        if (requestId === targetRequest) set({ recovering: false, message: String(e) })
      }
    },
  }
}
export type DirectInstaller = ReturnType<typeof createDirectInstaller>

/**
 * Keep checkbox selection aligned with live `ownedIndex` updates before submission:
 * drop any target that is now installed, and if the user has not manually edited
 * selection yet, automatically advance to the first uninstalled target.
 */
export function reconcileSelectedTargets(
  targets: readonly InstallInfo['targets'][number][],
  selected: readonly number[],
  ownedIndex: ReadonlyMap<string, MarketInstalledPackage> | undefined,
  userTouched: boolean,
): number[] {
  const isInstalled = (index: number): boolean =>
    ownedIndex !== undefined && ownedByTarget(ownedIndex, targets[index]!.install) !== undefined
  const remaining = selected.filter(index => index >= 0 && index < targets.length && !isInstalled(index))
  let next = remaining
  if (!userTouched && next.length === 0) {
    const firstUninstalled = targets.findIndex((_, index) => !isInstalled(index))
    next = firstUninstalled >= 0 ? [firstUninstalled] : []
  }
  if (next.length === selected.length && next.every((value, index) => value === selected[index])) {
    return selected as number[]
  }
  return next
}

/**
 * Whether a settled direct-install snapshot warrants re-reading the profile's
 * installed list. Avoids redundant reloads on `inspect` refusals or script
 * approval prompts while still reconciling partial batches and already-installed
 * errors.
 */
export function shouldRefreshInstalledAfterDirect(
  state: Pick<DirectState, 'phase' | 'queue' | 'message'>,
): boolean {
  if (state.phase === 'done' || state.phase === 'unavailable') return true
  if (state.phase !== 'failed') return false
  if (state.queue.some(entry => entry.phase === 'done')) return true
  const code = state.message.split('\n', 1)[0]?.trim()
  return code === 'already-installed' || code === 'ambiguous-install'
}
