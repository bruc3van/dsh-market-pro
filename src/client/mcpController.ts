/**
 * The MCP page's I/O: one store over the three official Remotes and this
 * market's own Host read.
 *
 * - `remote.mcpManager.watch` streams the live server list; `restart` and
 *   `probe` are its recovery verbs. It has no write method by design.
 * - `remote.settings` reads and writes the manager's `servers` namespace —
 *   the only write path, validated by the manager and revision-checked.
 * - `remote.credentials` describes and stores `${credential:REF}` values;
 *   no read path ever returns a value.
 * - `remote.dshMarketPro.inspectMcp` names the manager's namespace and lists
 *   static rows and live tools the manager cannot see.
 *
 * The stream runs only while a page is attached, so a closed market holds no
 * Host stream open.
 * @module dsh-market-pro/client/mcpController
 */
import type { McpAdoptResult, McpHostContext, McpProbeResult } from '../contract.ts'
import {
  buildRows, canProbe, entryRefs, newDraftPlaintext, pendingToStore, saveOps, serversOf,
  type McpCredentialInfo, type McpDraft, type McpRow, type McpServerView, type McpSettingsOp, type McpSettingsView, type McpStatus,
} from './mcpModel.ts'

type Reply<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

/** `ctx.remote.mcpManager`, structurally. */
export interface McpManagerFace {
  watch(signal?: AbortSignal): AsyncIterable<readonly McpServerView[]> & { dispose?(): void }
  restart(name: string): Promise<Reply<void>>
}

/** `ctx.remote.settings`, structurally (the subset this page uses). */
export interface McpSettingsFace {
  describe(): Promise<Reply<{ writable: boolean; hasDocument?: boolean; namespaces: readonly McpSettingsView[] }>>
  mutate(ns: string, ops: McpSettingsOp[], expectedRevision?: number): Promise<Reply<McpSettingsView>>
  /** Open the provider-held Settings document in the Host's native text editor. */
  openSettingsDocument?(signal?: AbortSignal): Promise<Reply<{ opened: true }>>
}

/** `ctx.remote.credentials`, structurally. */
export interface McpCredentialsFace {
  describe(refs: string[]): Promise<Reply<Record<string, McpCredentialInfo>>>
  set(ref: string, value: string): Promise<Reply<void>>
  /** Remove a stored value; an environment fallback then applies again. */
  unset?(ref: string): Promise<Reply<void>>
}

/** One row of the official plugin manager's `listPlugins` (the subset this page reads). */
export interface McpPluginRow {
  readonly entryId: string
  readonly moduleName: string
  readonly enabled: boolean
  readonly readOnlyReason?: 'management-required' | 'unaddressable'
}

/** The official plugin manager's entry-level outcome (the subset this page reads). */
export interface McpPluginChange {
  readonly changed: boolean
  readonly application: 'failed' | 'cancelled' | 'applied' | 'restart-required' | 'overridden'
  readonly error?: { readonly code: string; readonly diagnostic?: string }
}

/**
 * `ctx.remote.pluginManager`, structurally: the official way to switch one
 * profile Loader entry. It owns the patch-layer rules (edit the last matching
 * override, drop an override equal to the composition) and the live reload,
 * so this page never writes the profile itself.
 */
export interface McpPluginsFace {
  listPlugins(): Promise<Reply<readonly McpPluginRow[]>>
  setPluginEnabled(id: string, enabled: boolean): Promise<Reply<McpPluginChange>>
}

/** End-to-end outcome for a newly added MCP server (config save + initial startup/handshake). */
export interface McpInstallOutcome {
  readonly draft: McpDraft
  readonly ok: boolean
  readonly stage: 'install' | 'connect'
  readonly message: string
  readonly reason?: string
  readonly timedOut?: boolean
}

/** Where the controller finds each Remote; every getter may answer undefined. */
export interface McpHosts {
  manager(): McpManagerFace | undefined
  settings(): McpSettingsFace | undefined
  credentials(): McpCredentialsFace | undefined
  plugins?(): McpPluginsFace | undefined
  inspect(): Promise<McpHostContext>
  probe(name: string): Promise<Reply<McpProbeResult>>
  /** This market's Host adoption verb (`dshMarketPro.adoptMcp`); throws on refusal. */
  adopt?(loaderId: string): Promise<McpAdoptResult>
  /** Optional anonymous install feedback observer for newly added MCP servers (save-only). */
  onSaveOutcome?(outcome: { readonly draft: McpDraft; readonly original: string | undefined; readonly ok: boolean; readonly message: string }): void
  /** Optional end-to-end outcome observer covering both config save and initial startup/connection. */
  onInstallOutcome?(outcome: McpInstallOutcome): void
}

/** Whether, and why not, one static row can be switched through the plugin manager. */
export type McpStaticToggle =
  | { readonly available: true }
  | { readonly available: false; readonly reason: 'management-required' | 'unaddressable' | 'unlisted' }

/** One card's in-flight probe. */
export type McpProbeState =
  | { readonly status: 'running' }
  | { readonly status: 'done'; readonly result: McpProbeResult }
  | { readonly status: 'error'; readonly message: string }

/**
 * What the page can do here.
 * - `full`: manager present, Settings writable.
 * - `readonly`: manager present, writes refused (a non-owner peer, a read-only profile, no Settings namespace).
 * - `legacy`: this runtime has no manager; only static rows can be shown.
 * - `error`: the Host read itself failed — not a verdict on the runtime's version.
 */
export type McpMode = 'loading' | 'error' | 'full' | 'readonly' | 'legacy'

/** The page's whole state. */
export interface McpSnapshot {
  readonly mode: McpMode
  readonly host: McpHostContext | null
  readonly hostError: string
  readonly views: readonly McpServerView[] | null
  readonly watchError: string
  readonly settings: McpSettingsView | null
  readonly settingsError: string
  /** Whether Settings reports a local document the Host can open. */
  readonly hasSettingsDocument: boolean
  readonly rows: readonly McpRow[]
  readonly credentials: Readonly<Record<string, McpCredentialInfo>>
  /** Row name → the verb in flight. */
  readonly busy: Readonly<Record<string, string>>
  /** Row name → the last verb's failure. */
  readonly errors: Readonly<Record<string, string>>
  readonly probes: Readonly<Record<string, McpProbeState>>
  /** Row key → a non-failure outcome worth saying (`restart-required`). */
  readonly notices: Readonly<Record<string, string>>
  /**
   * Static row Loader id → its plugin-manager switch; null while unread or
   * when this Host exposes no plugin manager.
   */
  readonly staticToggles: Readonly<Record<string, McpStaticToggle>> | null
  /** Managed row name → what moving it from a static row did, until the page reloads. */
  readonly adopted: Readonly<Record<string, McpAdoptNote>>
}

/**
 * The outcome of one adoption, as its managed card reports it.
 * - `enabled`: the static row stopped and the managed entry took over.
 * - `kept-off`: the static row was already off, so the entry stays off too.
 * - `restart`: the static row stops only after a DSH restart; enable the entry then.
 * - `disable-failed` / `enable-failed`: the entry exists, switched off; `error` says why.
 */
export interface McpAdoptNote {
  readonly state: 'enabled' | 'kept-off' | 'restart' | 'disable-failed' | 'enable-failed'
  readonly stored: readonly string[]
  readonly reused: readonly string[]
  readonly dropped: readonly string[]
  readonly error?: string
}

/** What a save reports back to the editor. */
export type McpSaveOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string; readonly conflict: boolean }

/** The controller's face. */
export interface McpController {
  getSnapshot(): McpSnapshot
  subscribe(listener: () => void): () => void
  /** Start the stream and the reads for one visible page; the disposer stops them when the last page leaves. */
  attach(): () => void
  refresh(): Promise<void>
  /** Restart the stream after a carrier reset. */
  reset(): void
  setEnabled(name: string, enabled: boolean): Promise<void>
  /** Drop the user-layer entry: removes a user server, restores an inherited one. */
  remove(name: string): Promise<void>
  restart(name: string): Promise<void>
  probe(name: string): Promise<void>
  save(draft: McpDraft, edit: { readonly name: string; readonly revision: number } | undefined): Promise<McpSaveOutcome>
  /** Store one credential value; resolves to an error message, or '' on success. */
  setCredential(ref: string, value: string): Promise<string>
  /** Remove one stored credential; resolves to an error message, or '' on success. */
  clearCredential(ref: string): Promise<string>
  /** Switch one static `dsh-mcp-client` row through the official plugin manager. */
  setStaticEnabled(loaderId: string, enabled: boolean): Promise<void>
  /**
   * Move one static row under the manager: the Host stores its secrets and
   * writes the entry switched off, the static row is switched off through
   * the plugin manager, and the entry is switched on once it has stopped.
   */
  adopt(loaderId: string): Promise<void>
  /** Open the Host's Settings document in its native editor; resolves to an error message, or ''. */
  openSettingsDocument(): Promise<string>
  /** Which optional Host verbs this runtime offers. */
  supports(feature: 'adopt' | 'unsetCredential' | 'openDocument'): boolean
  /** Re-read the Host facts after a plugin change elsewhere; a no-op while no page is attached. */
  invalidate(): void
  /** A Settings document changed elsewhere (`settings/document-updated`). */
  settingsChanged(): void
  /** A credential reference changed (`credentials/reference-updated`). */
  credentialsChanged(): void
}

/** The busy/error/notice key of one static row. */
export const staticKey = (loaderId: string): string => `static:${loaderId}`

const initial: McpSnapshot = {
  mode: 'loading', host: null, hostError: '', views: null, watchError: '', settings: null, settingsError: '',
  hasSettingsDocument: false, rows: [], credentials: {}, busy: {}, errors: {}, probes: {}, notices: {}, staticToggles: null, adopted: {},
}

/** Credential descriptions travel in batches of at most this many references. */
const CREDENTIAL_BATCH = 64

const message = (error: unknown): string => error instanceof Error ? error.message : String(error)
const failure = (reply: { error: { code: string; message: string } }): string => `${reply.error.code}: ${reply.error.message}`

const statusErrorOf = (status: McpStatus): string => {
  switch (status.state) {
    case 'failed':
      return status.reason === 'cleanup' ? (status.result.cleanupError ?? '') : (status.lastError ?? '')
    case 'reconnecting':
    case 'waiting-credentials':
    case 'waiting-authorization':
      return status.lastError
    case 'closed':
      return status.result.cleanupError ?? ''
    default:
      return ''
  }
}

/** Optional timer seams, for tests. */
export interface McpControllerOptions {
  readonly wait?: (ms: number) => Promise<void>
  readonly debounceMs?: number
  readonly installTimeoutMs?: number
}

type WatchStreamState =
  | { readonly status: 'stopped'; readonly generation: number }
  | { readonly status: 'running'; readonly generation: number; readonly abort?: AbortController }

/** Create the controller over the given Remotes. */
export function createMcpController(hosts: McpHosts, options: McpControllerOptions = {}): McpController {
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms) }))
  const debounceMs = options.debounceMs ?? 300
  let state = initial
  let writable = false
  const listeners = new Set<() => void>()
  let attached = 0
  let watch: WatchStreamState = { status: 'stopped', generation: 0 }
  let settingsTimer: ReturnType<typeof setTimeout> | undefined
  let inspectTimer: ReturnType<typeof setTimeout> | undefined
  let lastShape = ''
  let lastTools = ''
  // Read sequences: a response is applied only if no newer read or write
  // started after it, so a slow describe cannot roll back a fresh revision.
  let settingsSeq = 0
  let hostSeq = 0

  interface PendingMcpInstall {
    readonly draft: McpDraft
    lastReconnectingError: string
    readonly timer: ReturnType<typeof setTimeout>
  }
  const pendingInstalls = new Map<string, PendingMcpInstall>()

  const maybeStopWatchIfIdle = (): void => {
    if (attached === 0 && pendingInstalls.size === 0) {
      stopWatch()
    }
  }

  const cancelPendingInstall = (name: string): void => {
    const pending = pendingInstalls.get(name)
    if (pending === undefined) return
    clearTimeout(pending.timer)
    pendingInstalls.delete(name)
    maybeStopWatchIfIdle()
  }

  const cancelAllPendingInstalls = (): void => {
    for (const pending of pendingInstalls.values()) {
      clearTimeout(pending.timer)
    }
    pendingInstalls.clear()
    maybeStopWatchIfIdle()
  }

  const settlePendingInstall = (name: string, outcome: Omit<McpInstallOutcome, 'draft'>): void => {
    const pending = pendingInstalls.get(name)
    if (pending === undefined) return
    clearTimeout(pending.timer)
    pendingInstalls.delete(name)
    hosts.onInstallOutcome?.({ draft: pending.draft, ...outcome })
    maybeStopWatchIfIdle()
  }

  const checkPendingInstallStatus = (name: string, status: McpStatus | undefined): void => {
    const pending = pendingInstalls.get(name)
    if (pending === undefined || status === undefined) return
    if (
      status.state === 'connected'
      || status.state === 'waiting-credentials'
      || status.state === 'waiting-authorization'
    ) {
      settlePendingInstall(name, { ok: true, stage: 'connect', message: '' })
      return
    }
    if (status.state === 'reconnecting') {
      if (status.lastError !== '') pending.lastReconnectingError = status.lastError
      return
    }
    if (status.state === 'failed') {
      settlePendingInstall(name, {
        ok: false,
        stage: 'connect',
        message: statusErrorOf(status) || status.reason,
        reason: status.reason,
      })
      return
    }
    if (status.state === 'closed') {
      const err = statusErrorOf(status)
      if (err !== '') {
        settlePendingInstall(name, { ok: false, stage: 'connect', message: err, reason: 'closed' })
      }
      return
    }
    if (status.state === 'disabled') {
      cancelPendingInstall(name)
    }
  }

  const set = (patch: Partial<McpSnapshot>): void => {
    const next = { ...state, ...patch }
    const rows = 'views' in patch || 'settings' in patch ? buildRows(next.views, next.settings) : next.rows
    state = { ...next, rows, mode: modeOf(next) }
    for (const listener of [...listeners]) listener()
  }

  const modeOf = (next: McpSnapshot): McpMode => {
    if (next.host === null) return next.hostError === '' ? 'loading' : 'error'
    if (next.host.managerEntry === null) return 'legacy'
    return writable && next.settings !== null && hosts.settings() !== undefined ? 'full' : 'readonly'
  }

  const patchRecord = <K extends 'busy' | 'errors' | 'probes' | 'notices'>(key: K, name: string, value: McpSnapshot[K][string] | undefined): void => {
    const { [name]: _dropped, ...rest } = state[key] as Record<string, unknown>
    set({ [key]: value === undefined ? rest : { ...rest, [name]: value } } as Partial<McpSnapshot>)
  }

  const patchAdopted = (name: string, value: McpAdoptNote | undefined): void => {
    const { [name]: _dropped, ...rest } = state.adopted
    set({ adopted: value === undefined ? rest : { ...rest, [name]: value } })
  }

  const loadCredentials = async (): Promise<void> => {
    const remote = hosts.credentials()
    const refs = [...new Set(Object.values(serversOf(state.settings?.value)).flatMap(entryRefs))]
    if (remote === undefined || refs.length === 0) return
    const described: Record<string, McpCredentialInfo> = {}
    for (let start = 0; start < refs.length; start += CREDENTIAL_BATCH) {
      try {
        const reply = await remote.describe(refs.slice(start, start + CREDENTIAL_BATCH))
        if (reply.ok) Object.assign(described, reply.value)
      } catch {
        // A credential read is decoration on the card; the server list stands without it.
      }
    }
    set({ credentials: { ...state.credentials, ...described } })
  }

  const loadSettings = async (): Promise<void> => {
    const ns = state.host?.managerEntry
    const remote = hosts.settings()
    if (ns === null || ns === undefined) return
    if (remote === undefined) {
      writable = false
      set({ settingsError: 'settings-unavailable', hasSettingsDocument: false })
      return
    }
    const seq = ++settingsSeq
    try {
      const reply = await remote.describe()
      if (seq !== settingsSeq) return
      if (!reply.ok) {
        writable = false
        set({ settingsError: failure(reply), hasSettingsDocument: false })
        return
      }
      writable = reply.value.writable
      const view = reply.value.namespaces.find(candidate => candidate.ns === ns) ?? null
      set({ settings: view, settingsError: view === null ? 'namespace-missing' : '', hasSettingsDocument: reply.value.hasDocument !== false })
      await loadCredentials()
    } catch (error) {
      if (seq === settingsSeq) set({ settingsError: message(error), hasSettingsDocument: false })
    }
  }

  /** Which static rows the official plugin manager can address, and why not the rest. */
  const loadToggles = async (): Promise<void> => {
    const remote = hosts.plugins?.()
    const unmanaged = state.host?.unmanaged ?? []
    if (remote === undefined || unmanaged.length === 0) {
      set({ staticToggles: null })
      return
    }
    const seq = hostSeq
    try {
      const reply = await remote.listPlugins()
      if (seq !== hostSeq) return
      if (!reply.ok) {
        set({ staticToggles: null })
        return
      }
      const byId = new Map(reply.value.map(row => [row.entryId, row]))
      set({
        staticToggles: Object.fromEntries(unmanaged.map((server): [string, McpStaticToggle] => {
          const row = byId.get(server.loaderId)
          if (row === undefined) return [server.loaderId, { available: false, reason: 'unlisted' }]
          return [server.loaderId, row.readOnlyReason === undefined
            ? { available: true } : { available: false, reason: row.readOnlyReason }]
        })),
      })
    } catch {
      // The switch is an extra; without the plugin manager the row stays read-only.
      set({ staticToggles: null })
    }
  }

  const loadHost = async (): Promise<void> => {
    const seq = ++hostSeq
    try {
      const host = await hosts.inspect()
      if (seq !== hostSeq) return
      set({ host, hostError: '' })
    } catch (error) {
      if (seq === hostSeq) set({ hostError: message(error) })
      return
    }
    await loadToggles()
  }

  const schedule = (which: 'settings' | 'inspect'): void => {
    if (which === 'settings') {
      clearTimeout(settingsTimer)
      settingsTimer = setTimeout(() => { void loadSettings() }, debounceMs)
    } else {
      clearTimeout(inspectTimer)
      inspectTimer = setTimeout(() => { void loadHost() }, debounceMs * 2)
    }
  }

  /**
   * A watch frame. The stream pushes on every status change; Settings is
   * re-read only when the set of entries or their lifecycle shape moved (an
   * external edit shows up as exactly that), and the tool view only when the
   * connected tool counts changed.
   */
  const onViews = (views: readonly McpServerView[]): void => {
    set({ views, watchError: '' })
    const shape = views.map(view => `${view.name}:${String(view.configured)}:${view.status.state === 'disabled' ? 'off' : 'on'}`).join('|')
    if (shape !== lastShape) {
      if (attached > 0 && lastShape !== '') schedule('settings')
      lastShape = shape
    }
    const tools = JSON.stringify(views.flatMap(({ name, status }) =>
      status.state === 'connected' ? [[name, status.toolCount, status.connectedAt]] : []))
    if (tools !== lastTools) {
      // A first frame with connected servers re-inspects: a server may have
      // connected between attach's inspect and the stream opening.
      if (attached > 0 && (lastTools !== '' || tools !== '[]')) schedule('inspect')
      lastTools = tools
    }
    for (const view of views) {
      checkPendingInstallStatus(view.name, view.status)
    }
  }

  const runWatch = async (generation: number): Promise<void> => {
    try {
      await watchLoop(generation)
    } finally {
      if (watch.status === 'running' && watch.generation === generation) {
        watch = { status: 'stopped', generation }
      }
    }
  }

  const watchLoop = async (generation: number): Promise<void> => {
    let backoff = 1_000
    while ((attached > 0 || pendingInstalls.size > 0) && watch.status === 'running' && watch.generation === generation) {
      const manager = hosts.manager()
      if (manager === undefined) {
        set({ watchError: 'manager-unavailable' })
        return
      }
      const abort = new AbortController()
      watch = { status: 'running', generation, abort }
      try {
        for await (const views of manager.watch(abort.signal)) {
          if (watch.status !== 'running' || watch.generation !== generation) return
          onViews(views)
          backoff = 1_000
        }
      } catch (error) {
        if (abort.signal.aborted || watch.status !== 'running' || watch.generation !== generation) return
        set({ watchError: message(error) })
      }
      if (watch.status !== 'running' || watch.generation !== generation) return
      await wait(backoff)
      backoff = Math.min(backoff * 2, 15_000)
    }
  }

  const stopWatch = (): void => {
    const nextGeneration = watch.generation + 1
    if (watch.status === 'running') watch.abort?.abort()
    watch = { status: 'stopped', generation: nextGeneration }
  }

  const startWatch = (): void => {
    stopWatch()
    if (state.host?.managerEntry === null || state.host?.managerEntry === undefined) return
    lastShape = ''
    lastTools = ''
    const generation = watch.generation
    watch = { status: 'running', generation }
    void runWatch(generation)
  }

  /** Start the stream unless one is already running; safe to call after every read. */
  const ensureWatch = (): void => {
    if (attached > 0 && watch.status === 'stopped' && state.host !== null && state.host.managerEntry !== null) startWatch()
  }

  /**
   * Re-read everything, then make sure the stream runs: a first Host read
   * that failed (say, before this market's Remote mounted) recovers on the
   * next refresh instead of leaving the page without a live list.
   */
  const refresh = async (): Promise<void> => {
    await loadHost()
    await loadSettings()
    ensureWatch()
  }

  const mutate = async (ops: McpSettingsOp[], view = state.settings): Promise<McpSaveOutcome> => {
    const remote = hosts.settings()
    if (remote === undefined || view === null) return { ok: false, message: 'settings-unavailable', conflict: false }
    // A write supersedes any read in flight or scheduled: its reply is newer.
    clearTimeout(settingsTimer)
    const seq = ++settingsSeq
    const reply = await remote.mutate(view.ns, ops, view.revision)
    if (!reply.ok) {
      const conflict = /conflict/i.test(reply.error.code)
      if (conflict) await loadSettings()
      return { ok: false, message: failure(reply), conflict }
    }
    if (seq === settingsSeq) set({ settings: reply.value })
    void loadCredentials()
    return { ok: true }
  }

  /** Run one row verb with its busy flag and error seat. */
  const verb = async (name: string, label: string, run: () => Promise<string>): Promise<void> => {
    if (state.busy[name] !== undefined) return
    patchRecord('busy', name, label)
    patchRecord('errors', name, undefined)
    try {
      const error = await run()
      if (error !== '') patchRecord('errors', name, error)
    } catch (error) {
      patchRecord('errors', name, message(error))
    } finally {
      patchRecord('busy', name, undefined)
    }
  }

  const outcomeError = (outcome: McpSaveOutcome): string => outcome.ok ? '' : outcome.message

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    attach() {
      attached += 1
      if (attached === 1) void refresh()
      let live = true
      return () => {
        if (!live) return
        live = false
        attached -= 1
        if (attached === 0) {
          clearTimeout(settingsTimer)
          clearTimeout(inspectTimer)
          maybeStopWatchIfIdle()
        }
      }
    },
    refresh,
    reset() {
      if (attached === 0 && pendingInstalls.size === 0) return
      // The carrier was lost: the old stream is gone with it.
      stopWatch()
      cancelAllPendingInstalls()
      if (attached > 0) void refresh()
    },
    setEnabled: (name, enabled) => verb(name, enabled ? 'enable' : 'disable', async () => {
      if (!enabled) cancelPendingInstall(name)
      return outcomeError(await mutate([{ op: 'set', path: ['servers', name, 'enabled'], value: enabled }]))
    }),
    remove: name => verb(name, 'remove', async () => {
      cancelPendingInstall(name)
      const outcome = await mutate([{ op: 'unset', path: ['servers', name] }])
      if (outcome.ok && Object.hasOwn(state.adopted, name)) patchAdopted(name, undefined)
      return outcomeError(outcome)
    }),
    restart: name => verb(name, 'restart', async () => {
      if (Object.hasOwn(state.probes, name)) patchRecord('probes', name, undefined)
      const manager = hosts.manager()
      if (manager === undefined) return 'manager-unavailable'
      const reply = await manager.restart(name)
      return reply.ok ? '' : failure(reply)
    }),
    async probe(name) {
      const row = state.rows.find(item => item.name === name)
      if (row === undefined || !canProbe(row) || state.busy[name] !== undefined || state.probes[name]?.status === 'running') return
      patchRecord('probes', name, { status: 'running' })
      try {
        const reply = await hosts.probe(name)
        patchRecord('probes', name, reply.ok ? { status: 'done', result: reply.value } : { status: 'error', message: failure(reply) })
        if (reply.ok && reply.value.ok) {
          settlePendingInstall(name, { ok: true, stage: 'connect', message: '' })
        }
      } catch (error) {
        patchRecord('probes', name, { status: 'error', message: message(error) })
      }
    },
    async save(draft, edit) {
      const original = edit?.name
      const report = (outcome: McpSaveOutcome): McpSaveOutcome => {
        if (original === undefined) {
          hosts.onSaveOutcome?.({ draft, original, ok: outcome.ok, message: outcome.ok ? '' : outcome.message })
          if (!outcome.ok) {
            hosts.onInstallOutcome?.({ draft, ok: false, stage: 'install', message: outcome.message })
          } else if (!draft.enabled || hosts.manager() === undefined) {
            hosts.onInstallOutcome?.({ draft, ok: true, stage: 'install', message: '' })
          } else if (hosts.onInstallOutcome !== undefined) {
            const targetName = draft.name.trim()
            cancelPendingInstall(targetName)
            const rawTimeout = Number(draft.startupTimeoutMs)
            const budgetMs = options.installTimeoutMs
              ?? Math.max(45_000, (Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 30_000) + 15_000)
            const timer = setTimeout(() => {
              const current = pendingInstalls.get(targetName)
              if (current === undefined) return
              const msg = current.lastReconnectingError || 'MCP startup timed out'
              const timedOut = current.lastReconnectingError === ''
              settlePendingInstall(targetName, {
                ok: false,
                stage: 'connect',
                message: msg,
                reason: current.lastReconnectingError !== '' ? 'reconnecting-timeout' : 'startup-timeout',
                ...(timedOut ? { timedOut: true } : {}),
              })
            }, budgetMs)
            timer.unref?.()
            pendingInstalls.set(targetName, { draft, lastReconnectingError: '', timer })
            checkPendingInstallStatus(targetName, state.views?.find(view => view.name === targetName)?.status)
          }
        }
        return outcome
      }
      const view = state.settings
      if (view === null) return { ok: false, message: 'settings-unavailable', conflict: false }
      const current = serversOf(view.value)
      const name = draft.name.trim()
      if (edit !== undefined && (edit.revision !== view.revision || !Object.hasOwn(current, edit.name))) {
        return { ok: false, message: 'settings-conflict', conflict: true }
      }
      if (name !== original && (Object.hasOwn(current, name) || state.rows.some(row => row.name === name)
        || state.host?.unmanaged.some(server => server.serverName === name))) {
        return { ok: false, message: 'name-conflict', conflict: false }
      }
      const previous = name === original ? serversOf(view.user)[name] : undefined
      if (newDraftPlaintext(draft, previous).length > 0) {
        return { ok: false, message: 'plaintext-secrets', conflict: false }
      }
      // Secrets first: an entry that names a credential the store does not
      // hold would land straight in `waiting-credentials`. If a store fails,
      // nothing is written and the draft stays open.
      const secrets = pendingToStore(draft)
      if (secrets.length > 0) {
        const remote = hosts.credentials()
        if (remote === undefined) return { ok: false, message: 'credentials-unavailable', conflict: false }
        for (const secret of secrets) {
          try {
            const reply = await remote.set(secret.ref, secret.value)
            if (!reply.ok) return report({ ok: false, message: failure(reply), conflict: false })
          } catch (error) {
            return report({ ok: false, message: message(error), conflict: false })
          }
        }
      }
      try {
        const outcome = await mutate(saveOps(draft, original), view)
        if (outcome.ok) {
          if (Object.hasOwn(state.probes, draft.name)) patchRecord('probes', draft.name, undefined)
          if (original !== undefined && original !== draft.name && Object.hasOwn(state.probes, original)) {
            patchRecord('probes', original, undefined)
          }
        }
        return report(outcome)
      } catch (error) {
        return report({ ok: false, message: message(error), conflict: false })
      }
    },
    async setStaticEnabled(loaderId, enabled) {
      const key = staticKey(loaderId)
      const server = state.host?.unmanaged.find(item => item.loaderId === loaderId)
      await verb(key, enabled ? 'enable' : 'disable', async () => {
        const remote = hosts.plugins?.()
        if (remote === undefined || server === undefined) return 'plugins-unavailable'
        // Two servers with one name cannot both load: refuse to start a
        // static row over a managed entry that is switched on.
        if (enabled && state.rows.some(row => row.name === server.serverName && row.entry?.enabled !== false)) return 'name-conflict'
        patchRecord('notices', key, undefined)
        const reply = await remote.setPluginEnabled(loaderId, enabled)
        await loadHost()
        if (!reply.ok) return failure(reply)
        const outcome = reply.value
        switch (outcome.application) {
          case 'applied': return ''
          case 'restart-required':
            patchRecord('notices', key, 'restart-required')
            return ''
          case 'overridden': return 'overridden'
          default:
            return outcome.error === undefined ? outcome.application
              : `${outcome.error.code}${outcome.error.diagnostic === undefined ? '' : `: ${outcome.error.diagnostic}`}`
        }
      })
    },
    invalidate() {
      if (attached > 0) void refresh()
    },
    settingsChanged() {
      if (attached > 0) schedule('settings')
    },
    credentialsChanged() {
      if (attached > 0) void loadCredentials()
    },
    async setCredential(ref, value) {
      const remote = hosts.credentials()
      if (remote === undefined) return 'credentials-unavailable'
      try {
        const reply = await remote.set(ref, value)
        if (!reply.ok) return failure(reply)
        await loadCredentials()
        return ''
      } catch (error) {
        return message(error)
      }
    },
    async clearCredential(ref) {
      const remote = hosts.credentials()
      if (remote?.unset === undefined) return 'credentials-unavailable'
      try {
        const reply = await remote.unset(ref)
        if (!reply.ok) return failure(reply)
        await loadCredentials()
        return ''
      } catch (error) {
        return message(error)
      }
    },
    async adopt(loaderId) {
      const key = staticKey(loaderId)
      const server = state.host?.unmanaged.find(item => item.loaderId === loaderId)
      await verb(key, 'adopt', async () => {
        if (hosts.adopt === undefined || server === undefined) return 'adopt-unavailable'
        if (state.rows.some(row => row.name === server.serverName)) return 'name-taken'
        const plugins = hosts.plugins?.()
        if (server.enabled && (plugins === undefined || state.staticToggles?.[loaderId]?.available !== true)) return 'plugins-unavailable'
        const result = await hosts.adopt(loaderId)
        await loadSettings()
        const note = (state: McpAdoptNote['state'], error?: string): void => {
          patchAdopted(result.name, { state, stored: result.stored, reused: result.reused, dropped: result.dropped, ...(error === undefined ? {} : { error }) })
        }
        if (!server.enabled || plugins === undefined) {
          note('kept-off')
        } else {
          try {
            const reply = await plugins.setPluginEnabled(loaderId, false)
            if (!reply.ok) note('disable-failed', failure(reply))
            else if (reply.value.application === 'applied') {
              let outcome = await mutate([{ op: 'set', path: ['servers', result.name, 'enabled'], value: true }])
              if (!outcome.ok && outcome.conflict) {
                outcome = await mutate([{ op: 'set', path: ['servers', result.name, 'enabled'], value: true }])
              }
              if (outcome.ok) note('enabled')
              else note('enable-failed', outcome.message)
            } else if (reply.value.application === 'restart-required') {
              note('restart')
            } else {
              note('disable-failed', reply.value.error?.code ?? reply.value.application)
            }
          } catch (error) {
            note('disable-failed', message(error))
          }
        }
        await loadHost()
        return ''
      })
    },
    async openSettingsDocument() {
      const remote = hosts.settings()
      if (remote?.openSettingsDocument === undefined) return 'settings-unavailable'
      try {
        const reply = await remote.openSettingsDocument()
        return reply.ok ? '' : failure(reply)
      } catch (error) {
        return message(error)
      }
    },
    supports(feature) {
      switch (feature) {
        case 'adopt': return hosts.adopt !== undefined
        case 'unsetCredential': return typeof hosts.credentials()?.unset === 'function'
        case 'openDocument': return typeof hosts.settings()?.openSettingsDocument === 'function'
      }
    },
  }
}
