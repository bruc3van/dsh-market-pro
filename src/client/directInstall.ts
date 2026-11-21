import { isInstallSpec } from '../installInfo.ts'

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
  packageResult?: { output?: string }
}
export interface InstallHost {
  inspect(spec: string, options: { registry?: string | null }): Promise<Reply<
    { status: 'accepted'; registry: string | null } |
    { status: 'refused'; problem: string; reason: string }
  >>
  installBundle(spec: string, options?: { requestId?: string; registry?: string | null; enabled?: boolean; approvedBuilds?: string[] }): Promise<Reply<InstallResult>>
  cancelInstall(requestId: string): Promise<Reply<{ status: string }>>
  waitForInstall(requestId: string): Promise<Reply<InstallResult | null>>
}
export interface DirectState {
  phase: 'idle' | 'checking' | 'installing' | 'cancelling' | 'unknown' | 'unavailable' | 'done' | 'failed'
  spec: string
  message: string
  application?: string
  pendingBuilds: string[]
  /** True while `recover()` is polling the Host for an interrupted install's outcome. */
  recovering: boolean
  queue: { spec: string; phase: DirectState['phase']; application?: string; message: string }[]
}
const IDLE_DIRECT_STATE: DirectState = {
  phase: 'idle',
  spec: '',
  message: '',
  application: undefined,
  pendingBuilds: [],
  recovering: false,
  queue: [],
}
export function createDirectInstaller(host: () => InstallHost | undefined) {
  let state: DirectState = IDLE_DIRECT_STATE
  let requestId: RequestId
  let stopped = false
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
    set({ phase: value.application === 'failed' ? 'failed' : 'done', application: value.application,
      recovering: false,
      pendingBuilds: value.pendingBuilds ?? [],
      message: [value.error?.code, value.error?.diagnostic, ...(value.warnings ?? []),
        ...(value.error?.incompatible ?? []).map(p => `${p.name}@${p.version}: ${JSON.stringify(p.requirements ?? p.peers ?? {})}`),
        value.application === 'failed' ? value.packageResult?.output : undefined,
      ].filter(Boolean).join('\n').slice(-8000) })
    if (!stopped && (value.application === 'applied' || value.application === 'restart-required')) {
      const next = state.queue.find(entry => entry.phase === 'idle')
      if (next) await run(next.spec)
    }
  }
  const run = async (spec: string, builds: string[] = [], initialQueue?: DirectState['queue']) => {
    if (busy()) return
    if (!isInstallSpec(spec)) {
      set({
        phase: 'failed',
        spec,
        message: 'Invalid install target',
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
      spec,
      message: '',
      application: undefined,
      pendingBuilds: [],
      recovering: false,
      ...(initialQueue !== undefined ? { queue: initialQueue } : {}),
    })
    try {
      const api = manager()
      // The strict Remote counts every business parameter, even optional ones.
      const inspection = await api.inspect(spec, {})
      if (!inspection.ok) throw new Error(inspection.error.message)
      if (inspection.value.status === 'refused') throw new Error(`${inspection.value.problem}: ${inspection.value.reason}`)
      requestId = globalThis.crypto.randomUUID() as RequestId
      set({ phase: 'installing' })
      try {
        await settle(await api.installBundle(spec, { requestId, registry: inspection.value.registry, enabled: true, ...(builds.length ? { approvedBuilds: builds } : {}) }))
      } catch (error) { set({ phase: 'unknown', recovering: false, message: String(error) }) }
    } catch (error) { set({ phase: 'failed', recovering: false, message: error instanceof Error ? error.message : String(error) }) }
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
      await run(specs[0]!, [], queue)
    },
    // The Host writes each approval into allowBuilds and refuses a name that is
    // no longer pending ('stale-approval'): a retry carries no approvals, and an
    // approval names only what the failed run left pending.
    async retry() {
      if (state.phase === 'failed' && !state.pendingBuilds.length) await run(state.spec)
    },
    reset() {
      if (!busy()) {
        requestId = undefined
        stopped = false
        set(IDLE_DIRECT_STATE)
      }
    },
    approve: async () => { if (state.phase === 'failed' && state.pendingBuilds.length) await run(state.spec, [...state.pendingBuilds]) },
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
