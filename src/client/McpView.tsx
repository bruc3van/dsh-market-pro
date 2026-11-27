/**
 * The MCP page: every MCP server this Host runs, one card each.
 *
 * Managed servers come from the official `dsh-mcp-manager` (status streamed
 * live, configuration written through Settings, secrets kept in the
 * credential store). Static `dsh-mcp-client` rows the manager cannot govern
 * are listed below them, read-only, so the page never claims "no servers" on
 * a machine that runs several. All state and I/O live in ./mcpController.ts;
 * the rules this view renders from live in ./mcpModel.ts.
 */
import {
  IconChevronRightOutlineMedium, IconCloseOutlineRegular, IconInfoOutlineRegular, Modal, StateDot, TextShimmer, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { MarketSelector } from './InstallModeSelector.tsx'
import { MarketButton } from './MarketButton.tsx'
import { PluginLogo } from './PluginLogo.tsx'
import { MarketDescription } from './MarketDescription.tsx'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type MutableRefObject, type ReactElement } from 'react'
import type { McpToolGroup, McpUnmanagedServer } from '../contract.ts'
import { isMcpStarting } from '../mcpShapes.ts'
import type { MarketLocale } from './copy.ts'
import type { HeaderRefreshAction } from './MarketSection.tsx'
import { staticKey, type McpAdoptNote, type McpController, type McpProbeState, type McpSnapshot } from './mcpController.ts'
import {
  deleteMcpDescription, getMcpDescription, getMcpDescriptions, saveMcpDescription, subscribeMcpDescriptions,
  type McpDescriptionMap,
} from './mcpDescriptions.ts'
import {
  FEATURED_MCP_CATEGORIES, FEATURED_MCP_SERVERS, draftFromFeatured, featuredMcpSearchTexts, featuredRuntimeBadge,
  featuredTargetPreview, featuredForServer, findInstalledFeatured, hasRequiredInputs, hasSecretInputs,
  matchesFeaturedMcp, matchesFeaturedRuntime, pickAvailableServerName, resolveFeaturedInstallOutcome,
  validateFeaturedValues,
  type FeaturedMcpCategory, type FeaturedMcpMatch, type FeaturedMcpRuntimeFilter, type FeaturedMcpServer,
} from './mcpFeatured.ts'
import {
  canProbe, canRestart, commandLine, commandRisks, convertToCredential, draftFromEntry, draftPlaintext, emptyDraft,
  hasCustomMcpTiming, hasDraftContent, isConfigured, isDraftDirty, isEnabled, matchesMcpSearch, newDraftPlaintext, parseMcpJsonSnippet, pendingToStore, serversOf,
  splitCommandLine, statusError, statusKind, suggestRef, summarize, targetOf,
  DEFAULT_CLOSE_MS, RECONNECT_DEFAULTS, transportOf, validateDraft,
  type McpDraft, type McpDraftError, type McpPair, type McpRow, type McpStatus, type ParsedMcpSnippet,
} from './mcpModel.ts'

type Filter = 'all' | 'connected' | 'issue' | 'disabled'
type McpSubTab = 'featured' | 'configured'

/** Translate the controller's fixed reason tokens; pass Host text through. */
function reasonText(t: MarketLocale, raw: string): string {
  switch (raw) {
    case 'plaintext-secrets': return t('mcp.field.secretsRequired')
    case 'settings-unavailable': return t('mcp.reason.settings')
    case 'settings-readonly': return t('mcp.reason.settingsReadonly')
    case 'namespace-missing': return t('mcp.reason.namespace')
    case 'manager-unavailable': return t('mcp.reason.manager')
    case 'credentials-unavailable': return t('mcp.reason.credentials')
    case 'plugins-unavailable': return t('mcp.reason.plugins')
    case 'name-conflict': return t('mcp.reason.nameConflict')
    case 'adopt-unavailable': return t('mcp.reason.adopt')
    case 'overridden': return t('mcp.static.overridden')
    case 'gave-up': return t('mcp.state.gaveUp')
    case 'reconnect-disabled': return t('mcp.state.reconnectDisabled')
    case 'load': return t('mcp.state.load')
    case 'unclosed-generation':
    case 'cleanup': return t('mcp.state.locked')
    case 'disabled': return t('mcp.state.disabled')
    default:
      // Host refusals arrive wrapped (`<code>: <message>`); name the ones this page raises.
      if (/\bsettings-unavailable\b/.test(raw)) return t('mcp.reason.settings')
      if (/\bsettings-readonly\b/.test(raw)) return t('mcp.reason.settingsReadonly')
      if (/\bmanager-unavailable\b/.test(raw)) return t('mcp.reason.manager')
      if (/\bcredentials-unavailable\b/.test(raw)) return t('mcp.reason.credentials')
      if (/\bname-taken\b/.test(raw)) return t('mcp.reason.nameTaken')
      if (/\bnot-found\b/.test(raw)) return t('mcp.reason.notFound')
      if (/\bblocked-expression\b/.test(raw)) return t('mcp.adopt.blocked.expression')
      if (/\bblocked-name\b/.test(raw)) return t('mcp.adopt.blocked.name')
      if (/\bblocked-transport\b/.test(raw)) return t('mcp.adopt.blocked.transport')
      return raw
  }
}

function statusLabel(t: MarketLocale, status: McpStatus | undefined): string {
  if (status === undefined) return t('mcp.state.unknown')
  switch (status.state) {
    case 'connected': return t('mcp.state.connected', { count: String(status.toolCount) })
    case 'connecting': return t('mcp.state.connecting')
    case 'reconnecting': return t('mcp.state.reconnecting', { attempt: String(status.attempt), max: String(status.maxAttempts) })
    case 'waiting-credentials': return t('mcp.state.waiting')
    case 'waiting-authorization': return t('mcp.state.waitingAuthorization')
    case 'disabled': return t('mcp.state.disabled')
    case 'closed': return statusKind(status) === 'locked' ? t('mcp.state.locked') : t('mcp.state.closed')
    case 'failed':
      switch (status.reason) {
        case 'gave-up': return t('mcp.state.gaveUp')
        case 'reconnect-disabled': return t('mcp.state.reconnectDisabled')
        case 'load': return t('mcp.state.load')
        default: return t('mcp.state.locked')
      }
  }
}

function transportLabel(t: MarketLocale, transport: string): string {
  return transport === 'stdio' ? t('mcp.transport.stdio')
    : transport === 'streamable-http' ? t('mcp.transport.http') : t('mcp.transport.unknown')
}

function matchesFilter(row: McpRow, filter: Filter): boolean {
  const kind = statusKind(row.status)
  switch (filter) {
    case 'all': return true
    case 'connected': return kind === 'connected'
    case 'issue': return kind === 'issue' || kind === 'locked'
    case 'disabled': return kind === 'disabled'
  }
}

/** The page's single active modal: curated quick-add, full editor, or connection probe. */
type McpModalState =
  | { readonly kind: 'closed' }
  | { readonly kind: 'featured'; readonly item: FeaturedMcpServer }
  | { readonly kind: 'editor'; readonly row: McpRow | null; readonly revision?: number; readonly initialDraft?: McpDraft }
  | { readonly kind: 'probe'; readonly name: string }

/** MCP-owned actions hoisted into the shared tab toolbar alongside the AI assistant button. */
export interface McpToolbarActions {
  readonly canOpenDocument: boolean
  readonly openingDocument: boolean
  readonly onOpenDocument: () => void
  readonly canAdd: boolean
  readonly onAdd: () => void
}

type DocumentOpenState =
  | { readonly status: 'idle' }
  | { readonly status: 'opening' }
  | { readonly status: 'error'; readonly message: string }

type FeaturedSubmitState =
  | { readonly status: 'idle' }
  | { readonly status: 'saving' }
  | { readonly status: 'error'; readonly message: string }

/** Shared post-save startup & handshake tracker used by both curated quick-add and manual add modals. */
type McpInstallPhase =
  | { readonly status: 'none' }
  | {
    readonly status: 'installing'
    readonly serverName: string
    readonly startedAt: number
    readonly isStdio: boolean
    readonly preview: string
    readonly budgetMs: number
    readonly timedOut?: boolean
    readonly awaitingRetryTransition?: boolean
  }
  | { readonly status: 'saved-disabled'; readonly serverName: string; readonly preview: string }
  | { readonly status: 'connected'; readonly serverName: string; readonly preview: string; readonly toolCount: number; readonly elapsedSec: number }
  | { readonly status: 'failed'; readonly serverName: string; readonly preview: string; readonly reason: string }
  | { readonly status: 'waiting'; readonly serverName: string; readonly preview: string }

function useMcpInstallTracker(
  snapshot: McpSnapshot,
  controller: McpController,
  mounted: MutableRefObject<boolean>,
) {
  const [phase, setPhase] = useState<McpInstallPhase>({ status: 'none' })
  const [elapsedSec, setElapsedSec] = useState(0)
  const fallbackProbedRef = useRef(false)
  const retryAttemptRef = useRef(0)

  const savedName = phase.status === 'none' ? '' : phase.serverName
  const liveRow = savedName === '' ? undefined : snapshot.rows.find(row => row.name === savedName)
  const liveProbe = savedName === '' ? undefined : snapshot.probes[savedName]

  useEffect(() => {
    if (phase.status !== 'installing') return
    if (phase.awaitingRetryTransition && liveRow?.status !== undefined && isMcpStarting(liveRow.status.state)) {
      setPhase(current => (
        current.status === 'installing' && current.awaitingRetryTransition
          ? { ...current, awaitingRetryTransition: false }
          : current
      ))
      return
    }
    const outcome = resolveFeaturedInstallOutcome(liveRow?.status, liveProbe, {
      awaitingRetryTransition: phase.awaitingRetryTransition,
    })
    if (outcome === null) return
    const seconds = Math.max(1, Math.round((Date.now() - phase.startedAt) / 1000))
    if (outcome.kind === 'connected') {
      setPhase({ status: 'connected', serverName: phase.serverName, preview: phase.preview, toolCount: outcome.toolCount, elapsedSec: seconds })
    } else if (outcome.kind === 'failed') {
      setPhase({ status: 'failed', serverName: phase.serverName, preview: phase.preview, reason: outcome.reason })
    } else {
      setPhase({ status: 'waiting', serverName: phase.serverName, preview: phase.preview })
    }
  }, [phase, liveRow?.status, liveProbe])

  useEffect(() => {
    if (phase.status !== 'installing') return
    const update = () => {
      const elapsedMs = Date.now() - phase.startedAt
      setElapsedSec(Math.floor(elapsedMs / 1000))
      const readyForFallbackProbe = (snapshot.watchError !== '' && elapsedMs >= 4_000) || elapsedMs >= phase.budgetMs
      if (!fallbackProbedRef.current && readyForFallbackProbe && liveRow !== undefined && liveRow.status === undefined && canProbe(liveRow)) {
        fallbackProbedRef.current = true
        void controller.probe(phase.serverName)
      }
      if (!phase.timedOut && elapsedMs >= phase.budgetMs) {
        setPhase(current => (current.status === 'installing' ? { ...current, timedOut: true } : current))
      }
    }
    update()
    const timer = setInterval(update, 1_000)
    return () => clearInterval(timer)
  }, [phase, liveRow, snapshot.watchError, controller])

  const startInstalling = (options: { serverName: string; isStdio: boolean; preview: string; budgetMs: number }) => {
    fallbackProbedRef.current = false
    setElapsedSec(0)
    setPhase({ status: 'installing', startedAt: Date.now(), ...options })
  }

  const markSavedDisabled = (serverName: string, preview: string) => {
    setPhase({ status: 'saved-disabled', serverName, preview })
  }

  const canRetry = liveRow !== undefined && (canRestart(liveRow) || canProbe(liveRow))
  const retry = async (options: { isStdio: boolean; budgetMs: number }) => {
    if (savedName === '' || phase.status === 'none') return
    const currentRow = controller.getSnapshot().rows.find(row => row.name === savedName)
    const willRestart = currentRow !== undefined && canRestart(currentRow)
    const willProbe = !willRestart && currentRow !== undefined && canProbe(currentRow)
    if (!willRestart && !willProbe) return
    fallbackProbedRef.current = false
    setElapsedSec(0)
    const attemptId = ++retryAttemptRef.current
    const preRetryFailed = currentRow.status !== undefined
      && (currentRow.status.state === 'failed'
        || (currentRow.status.state === 'closed' && statusError(currentRow.status) !== ''))
    setPhase({
      status: 'installing',
      serverName: savedName,
      startedAt: Date.now(),
      isStdio: options.isStdio,
      preview: phase.preview,
      budgetMs: options.budgetMs,
      ...(preRetryFailed || willRestart ? { awaitingRetryTransition: true } : {}),
    })
    if (willRestart) {
      await controller.restart(savedName)
      if (!mounted.current || retryAttemptRef.current !== attemptId) return
      const restartError = controller.getSnapshot().errors[savedName]
      if (restartError) {
        setPhase({ status: 'failed', serverName: savedName, preview: phase.preview, reason: restartError })
      }
    } else if (willProbe) {
      await controller.probe(savedName)
    }
  }

  return { phase, elapsedSec, savedName, liveRow, canRetry, startInstalling, markSavedDisabled, retry }
}

function McpInstallStatusPanel({ t, phase, liveStatus, elapsedSec }: {
  t: MarketLocale
  phase: Exclude<McpInstallPhase, { readonly status: 'none' }>
  liveStatus: McpStatus | undefined
  elapsedSec: number
}): ReactElement {
  return (
    <div
      className="dsh_market_mcpInstallPanel"
      data-tone={phase.status === 'connected' ? 'success' : phase.status === 'failed' ? 'error' : undefined}
    >
      <div className="dsh_market_mcpInstallStatusRow">
        {phase.status === 'installing' && !phase.timedOut && (
          <StateDot state="ongoing" className="dsh_market_stateDot" />
        )}
        {phase.status === 'connected' && (
          <StateDot state="done" appearance="step" size={16} className="dsh_market_stateDot" />
        )}
        {phase.status === 'failed' && (
          <StateDot state="error" size={14} className="dsh_market_stateDot" />
        )}
        {(phase.status === 'waiting' || phase.status === 'saved-disabled' || (phase.status === 'installing' && phase.timedOut)) && (
          <StateDot state="warning" size={14} className="dsh_market_stateDot" />
        )}
        <div>
          {phase.status === 'installing' && !phase.timedOut && (
            <>
              <p role="status">
                <TextShimmer active>
                  {phase.isStdio ? t('mcp.featured.installingStdio') : t('mcp.featured.installingHttp')}
                </TextShimmer>
              </p>
              <p className="dsh_market_meta">
                {liveStatus !== undefined ? `${statusLabel(t, liveStatus)} · ` : ''}
                {t('mcp.featured.elapsed', { seconds: String(elapsedSec) })}
              </p>
            </>
          )}
          {phase.status === 'installing' && phase.timedOut && (
            <p role="status">{t('mcp.featured.installTimeout')}</p>
          )}
          {phase.status === 'connected' && (
            <p role="status">{t('mcp.featured.installDone', { count: String(phase.toolCount), seconds: String(phase.elapsedSec) })}</p>
          )}
          {phase.status === 'saved-disabled' && (
            <p role="status">{t('mcp.featured.installSavedDisabled', { name: phase.serverName })}</p>
          )}
          {phase.status === 'waiting' && (
            <p role="status">{t('mcp.featured.installWaiting')}</p>
          )}
          {phase.status === 'failed' && (
            <p role="status" className="dsh_market_cardError">{t('mcp.featured.installFailed', { reason: reasonText(t, phase.reason) })}</p>
          )}
        </div>
      </div>
      {phase.preview !== '' && <pre className="dsh_market_directMessage">{phase.preview}</pre>}
    </div>
  )
}

type FeaturedBannerNotice =
  | { readonly kind: 'none' }
  | { readonly kind: 'added'; readonly name: string }
  | { readonly kind: 'background'; readonly name: string }

type CredentialFlowState =
  | { readonly status: 'idle'; readonly error?: string }
  | { readonly status: 'editing'; readonly ref: string; readonly value: string; readonly error?: string }
  | { readonly status: 'saving'; readonly ref: string; readonly value: string }
  | { readonly status: 'confirming-clear'; readonly ref: string; readonly error?: string }
  | { readonly status: 'clearing'; readonly ref: string }

type EditorSubmitState =
  | { readonly status: 'idle' }
  | { readonly status: 'saving' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'conflict' }

type EditorIdleSubmitState = Exclude<EditorSubmitState, { readonly status: 'saving' }>

type EditorStatus =
  | EditorSubmitState
  | { readonly status: 'confirm-discard'; readonly previous: EditorIdleSubmitState }

/** The MCP page. */
export function McpView({ t, controller, onBrowsePlugins, onRegisterRefresh, onRegisterToolbarActions }: {
  t: MarketLocale
  controller: McpController
  onBrowsePlugins?: () => void
  onRegisterRefresh?: (action: HeaderRefreshAction | null) => void
  onRegisterToolbarActions?: (actions: McpToolbarActions | null) => void
}): ReactElement {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  useEffect(() => controller.attach(), [controller])
  const [subTab, setSubTab] = useState<McpSubTab>('featured')
  const [featuredCategory, setFeaturedCategory] = useState<FeaturedMcpCategory | 'all'>('all')
  const [featuredRuntime, setFeaturedRuntime] = useState<FeaturedMcpRuntimeFilter>('all')
  const [featuredQuery, setFeaturedQuery] = useState('')
  const [modal, setModal] = useState<McpModalState>({ kind: 'closed' })
  const [banner, setBanner] = useState<FeaturedBannerNotice>({ kind: 'none' })
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const descriptions = useSyncExternalStore<McpDescriptionMap>(subscribeMcpDescriptions, () => getMcpDescriptions(), () => ({}))
  const toolsOf = useMemo(() => new Map((snapshot.host?.tools ?? []).map(group => [group.server, group])), [snapshot.host])
  const unmanaged = snapshot.host?.unmanaged ?? []
  const managedNames = new Set(snapshot.rows.map(row => row.name))
  const search = (texts: readonly string[], tools?: McpToolGroup) =>
    matchesMcpSearch(texts, query, tools?.tools.map(tool => tool.name))
  const rows = snapshot.rows.filter((row) => {
    if (!matchesFilter(row, filter)) return false
    const featured = featuredForServer(row.entry, row.source === 'registered' ? row.name : '')
    const featuredTexts = featuredMcpSearchTexts(featured, featured ? t(`mcp.featured.category.${featured.category}`) : '')
    return search([row.name, targetOf(row.entry), descriptions[row.name] ?? '', ...featuredTexts], toolsOf.get(row.name))
  })
  const statics = unmanaged.filter((server) => {
    if (filter !== 'all') return false
    const featured = featuredForServer(server)
    const featuredTexts = featuredMcpSearchTexts(featured, featured ? t(`mcp.featured.category.${featured.category}`) : '')
    return search([server.serverName, server.command, ...server.args, server.url, ...featuredTexts], toolsOf.get(server.serverName))
  })
  const managed = summarize(snapshot.rows, unmanaged.length)
  // A static row's tools are its own only while it runs and no managed
  // server shares its namespace — otherwise the group belongs to the managed
  // card (already counted through its toolCount) or to nobody.
  const ownsTools = (server: McpUnmanagedServer) => server.enabled && server.phase === 'active' && !managedNames.has(server.serverName)
  const liveStatics = unmanaged.filter(ownsTools)
  const staticTools = liveStatics.reduce((sum, server) => sum + (toolsOf.get(server.serverName)?.tools.length ?? 0), 0)
  const counts = { servers: managed.servers, connected: managed.connected + liveStatics.length, tools: managed.tools + staticTools }
  const totalTools = counts.tools
  const writable = snapshot.mode === 'full'
  const loading = snapshot.mode === 'loading'
  const filterCount = (value: Filter) => snapshot.rows.filter(row => matchesFilter(row, value)).length
    + (value === 'all' ? unmanaged.length : 0)
  const rowsByName = useMemo(() => new Map(snapshot.rows.map(row => [row.name, row])), [snapshot.rows])
  const featuredMatches = useMemo(
    () => new Map(FEATURED_MCP_SERVERS.map(item => [item.id, findInstalledFeatured(item, snapshot.rows, unmanaged)])),
    [snapshot.rows, unmanaged],
  )
  const featuredBase = useMemo(
    () => FEATURED_MCP_SERVERS.filter(item => matchesFeaturedMcp(item, featuredQuery, featuredCategory)),
    [featuredQuery, featuredCategory],
  )
  const featuredItems = useMemo(
    () => featuredBase.filter(item => matchesFeaturedRuntime(item, featuredRuntime)),
    [featuredBase, featuredRuntime],
  )
  const featuredCategoryCount = (value: FeaturedMcpCategory | 'all') =>
    value === 'all' ? FEATURED_MCP_SERVERS.length : FEATURED_MCP_SERVERS.filter(item => item.category === value).length
  const featuredRuntimeCount = (value: FeaturedMcpRuntimeFilter) =>
    featuredBase.filter(item => matchesFeaturedRuntime(item, value)).length
  const viewConfigured = (name: string) => {
    setBanner({ kind: 'none' })
    setSubTab('configured')
    setFilter('all')
    setQuery(name)
  }
  const canOpenDocument = !loading && snapshot.mode !== 'legacy' && snapshot.mode !== 'error'
    && snapshot.hasSettingsDocument && controller.supports('openDocument')
  const [documentState, setDocumentState] = useState<DocumentOpenState>({ status: 'idle' })
  const [refreshing, setRefreshing] = useState(false)
  const refresh = async () => {
    setRefreshing(true)
    try {
      await controller.refresh()
    } finally {
      if (mounted.current) setRefreshing(false)
    }
  }
  const openDocument = async () => {
    if (documentState.status === 'opening') return
    setDocumentState({ status: 'opening' })
    const failure = await controller.openSettingsDocument()
    if (!mounted.current) return
    setDocumentState(failure === '' ? { status: 'idle' } : { status: 'error', message: failure })
  }

  const openDocumentRef = useRef(openDocument)
  openDocumentRef.current = openDocument
  const openEditModal = (row: McpRow) => {
    const current = controller.getSnapshot()
    const latest = current.rows.find(item => item.name === row.name)
    if (latest?.entry !== undefined && current.settings !== null) {
      setModal({ kind: 'editor', row: latest, revision: current.settings.revision })
    }
  }
  const openAddModalRef = useRef(() => setModal({ kind: 'editor', row: null }))
  const openingDocument = documentState.status === 'opening'
  useEffect(() => {
    if (!onRegisterToolbarActions) return
    onRegisterToolbarActions({
      canOpenDocument,
      openingDocument,
      onOpenDocument: () => { void openDocumentRef.current() },
      canAdd: writable,
      onAdd: () => openAddModalRef.current(),
    })
  }, [onRegisterToolbarActions, canOpenDocument, openingDocument, writable])
  useEffect(() => () => { onRegisterToolbarActions?.(null) }, [onRegisterToolbarActions])

  const openProbe = (name: string) => {
    setModal({ kind: 'probe', name })
    void controller.probe(name)
  }

  const showInlineToolbarActions = !onRegisterToolbarActions && (canOpenDocument || writable)
  const hasFeaturedFilterNotice = subTab === 'featured'
    && (featuredQuery.trim() !== '' || featuredCategory !== 'all' || featuredRuntime !== 'all')
    && featuredItems.length > 0
  const showConfiguredSummary = subTab === 'configured' && !loading
  const showSummaryBar = hasFeaturedFilterNotice || showConfiguredSummary || showInlineToolbarActions

  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  const refreshBusy = loading || refreshing
  const refreshLabel = refreshBusy ? t('refreshing') : t('mcp.refresh')
  useEffect(() => {
    if (!onRegisterRefresh) return
    onRegisterRefresh({
      label: refreshLabel,
      busy: refreshBusy,
      disabled: refreshBusy,
      onClick: () => { void refreshRef.current() },
    })
  }, [onRegisterRefresh, refreshLabel, refreshBusy])
  useEffect(() => () => { onRegisterRefresh?.(null) }, [onRegisterRefresh])

  return (
    <div className="dsh_market_page dsh_market_fixedPage">
      <div className="dsh_market_controls">
        {!onRegisterRefresh && (
          <button
            className="dsh_market_headerAction dsh_market_refreshMarket"
            type="button"
            disabled={refreshBusy}
            aria-busy={refreshBusy}
            onClick={() => { void refresh() }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 4v6h-6M20 10a8 8 0 1 0-1.7 7" /></svg>
            {refreshLabel}
          </button>
        )}
        <div className="dsh_market_filterBar">
          <div className="dsh_market_scope" role="group" aria-label={t('mcp.subtab.aria')}>
            <button
              type="button"
              className="dsh_market_scopeButton"
              aria-pressed={subTab === 'featured'}
              onClick={() => setSubTab('featured')}
            >
              {t('mcp.subtab.featured')} <span>{FEATURED_MCP_SERVERS.length}</span>
            </button>
            <button
              type="button"
              className="dsh_market_scopeButton"
              aria-pressed={subTab === 'configured'}
              onClick={() => setSubTab('configured')}
            >
              {t('mcp.subtab.configured')} {!loading && <span>{counts.servers}</span>}
            </button>
          </div>
          {subTab === 'featured'
            ? (
              <div className="dsh_market_filterActions">
                <input
                  className="dsh_market_search dsh_market_filterSearch"
                  type="search"
                  spellCheck={false}
                  value={featuredQuery}
                  aria-label={t('mcp.featured.search')}
                  placeholder={t('mcp.featured.search')}
                  onChange={event => setFeaturedQuery(event.target.value)}
                />
                <MarketSelector
                  value={featuredCategory}
                  onChange={setFeaturedCategory}
                  label={t('mcp.featured.category.aria')}
                  className="dsh_market_category"
                  options={[
                    { value: 'all', label: t('filter.allCategories'), count: FEATURED_MCP_SERVERS.filter(item => matchesFeaturedRuntime(item, featuredRuntime)).length },
                    ...FEATURED_MCP_CATEGORIES.map(value => ({
                      value,
                      label: t(`mcp.featured.category.${value}`),
                      count: featuredCategoryCount(value),
                    })),
                  ]}
                />
                <MarketSelector
                  value={featuredRuntime}
                  onChange={setFeaturedRuntime}
                  label={t('mcp.featured.runtime.aria')}
                  className="dsh_market_sort"
                  options={([
                    ['all', 'mcp.featured.runtime.allLabel'],
                    ['no-key', 'mcp.featured.runtime.noKey'],
                    ['http', 'mcp.featured.runtime.http'],
                    ['npx', 'mcp.featured.runtime.npx'],
                    ['uvx', 'mcp.featured.runtime.uvx'],
                  ] as const).map(([value, key]) => ({
                    value,
                    label: t(key),
                    count: featuredRuntimeCount(value),
                  }))}
                />
              </div>
              )
            : (!loading && (
              <div className="dsh_market_filterActions">
                <input
                  className="dsh_market_search dsh_market_filterSearch"
                  type="search"
                  spellCheck={false}
                  value={query}
                  aria-label={t('mcp.search')}
                  placeholder={t('mcp.search')}
                  onChange={event => setQuery(event.target.value)}
                />
                <MarketSelector
                  value={filter}
                  onChange={setFilter}
                  label={t('mcp.filter.aria')}
                  className="dsh_market_category"
                  options={(['all', 'connected', 'issue', 'disabled'] as const).map(value => ({
                    value,
                    label: value === 'all' ? t('mcp.filter.allLabel') : t(`mcp.filter.${value}`),
                    count: filterCount(value),
                  }))}
                />
              </div>
              ))}
        </div>
        {showSummaryBar && (
          <div className="dsh_market_mcpSummaryBar">
            {hasFeaturedFilterNotice && (
              <p className="dsh_market_status" aria-live="polite">
                {t('filter.results', { shown: String(featuredItems.length) })}
                <button
                  type="button"
                  className="dsh_market_clearFilters"
                  onClick={() => {
                    setFeaturedQuery('')
                    setFeaturedCategory('all')
                    setFeaturedRuntime('all')
                  }}
                >
                  {t('filter.clear')}
                </button>
              </p>
            )}
            {showConfiguredSummary && (
              <p className="dsh_market_meta">{t('mcp.summary', {
                servers: String(counts.servers), connected: String(counts.connected), tools: String(totalTools),
              })}</p>
            )}
            {showInlineToolbarActions && (
              <div className="dsh_market_headingActions">
                {canOpenDocument && (
                  <button className="dsh_market_headerAction" type="button" title={t('mcp.openDocument.hint')} disabled={documentState.status === 'opening'}
                    onClick={() => { void openDocument() }}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
                    {t('mcp.openDocument')}
                  </button>
                )}
                {writable && (
                  <MarketButton intent="primary" className="dsh_market_mcpAdd" onClick={() => setModal({ kind: 'editor', row: null })}>
                    {t('mcp.add')}
                  </MarketButton>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="dsh_market_results" aria-busy={subTab === 'configured' && loading}>
        {documentState.status === 'error' && (
          <p className="dsh_market_status" role="alert" data-error="true">{t('mcp.openDocument.failed', { reason: reasonText(t, documentState.message) })}</p>
        )}
        {subTab === 'featured'
          ? (
            <>
              {banner.kind !== 'none' && (
                <div className="dsh_market_mcpNoticeRow" role="status">
                  <p className="dsh_market_noticeBody">
                    {banner.kind === 'background'
                      ? t('mcp.featured.backgroundNotice', { name: banner.name })
                      : t('mcp.featured.addedNotice', { name: banner.name })}
                  </p>
                  <div className="dsh_market_mcpNoticeActions">
                    <MarketButton intent="secondary" onClick={() => viewConfigured(banner.name)}>
                      {t('mcp.featured.viewConfigured')}
                    </MarketButton>
                    <button type="button" className="dsh_market_directClose" aria-label={t('mcp.featured.close')} onClick={() => setBanner({ kind: 'none' })}>
                      <IconCloseOutlineRegular size={14} />
                    </button>
                  </div>
                </div>
              )}
              {!loading && !writable && (
                snapshot.mode === 'error' && snapshot.hostError !== ''
                  ? <p className="dsh_market_status" role="alert" data-error="true">{t('mcp.hostError', { reason: snapshot.hostError })}</p>
                  : (
                    <p className="dsh_market_status" role="status">
                      {snapshot.mode === 'legacy' ? t('mcp.legacy') : t('mcp.featured.readonlyHint')}
                    </p>
                    )
              )}
              {featuredItems.length === 0
                ? <p className="dsh_market_status">{t('mcp.featured.noMatch')}</p>
                : (
                  <ul className="dsh_market_cards dsh_market_cardsUniform">
                    {featuredItems.map(item => {
                      const match = featuredMatches.get(item.id) ?? null
                      const matchedRow = match?.source === 'managed' ? rowsByName.get(match.name) : undefined
                      return (
                        <FeaturedMcpCard
                          key={item.id}
                          t={t}
                          item={item}
                          match={match}
                          liveStatus={matchedRow?.status}
                          writable={writable}
                          onAdd={() => setModal({ kind: 'featured', item })}
                          onViewConfigured={viewConfigured}
                        />
                      )
                    })}
                  </ul>
                  )}
              <p className="dsh_market_note">
                {t('mcp.featured.sourceNote', { total: String(FEATURED_MCP_SERVERS.length) })}
              </p>
            </>
            )
          : (
            <>
              {loading && <p className="dsh_market_status" role="status">{t('mcp.loading')}</p>}
              <PageNotices t={t} snapshot={snapshot} />
              {!loading && snapshot.mode !== 'legacy' && snapshot.mode !== 'error' && snapshot.rows.length === 0 && unmanaged.length === 0 && (
                <div className="dsh_market_notice">
                  <p className="dsh_market_noticeBody">{t('mcp.empty')}</p>
                  <div className="dsh_market_mcpEmptyActions">
                    <MarketButton intent="primary" onClick={() => setSubTab('featured')}>{t('mcp.emptyFeatured')}</MarketButton>
                    {onBrowsePlugins && <MarketButton intent="secondary" onClick={onBrowsePlugins}>{t('mcp.emptyBrowse')}</MarketButton>}
                  </div>
                </div>
              )}
              {!loading && (snapshot.rows.length > 0 || unmanaged.length > 0) && rows.length === 0 && statics.length === 0 && (
                <p className="dsh_market_status">{t('mcp.noMatch')}</p>
              )}
              {rows.length > 0 && (
                <ul className="dsh_market_cards dsh_market_cardsUniform">
                  {rows.map(row => (
                    <McpCard key={row.name} t={t} row={row} customDescription={descriptions[row.name] ?? ''} snapshot={snapshot} controller={controller} writable={writable}
                      tools={toolsOf.get(row.name)} onEdit={() => openEditModal(row)}
                      onProbe={() => openProbe(row.name)} />
                  ))}
                </ul>
              )}
              {statics.length > 0 && (
                <section className="dsh_market_skillGroup" aria-label={t('mcp.static.title')}>
                  <h3>{t('mcp.static.title')}</h3>
                  <p className="dsh_market_meta">{t('mcp.static.hint')}</p>
                  <ul className="dsh_market_cards dsh_market_cardsUniform">
                    {statics.map(server => (
                      <StaticCard key={server.entryId} t={t} server={server} tools={ownsTools(server) ? toolsOf.get(server.serverName) : undefined}
                        conflict={managedNames.has(server.serverName)} snapshot={snapshot} controller={controller} writable={writable} />
                    ))}
                  </ul>
                </section>
              )}
            </>
            )}
      </div>
      {modal.kind === 'featured' && (
        <FeaturedMcpModal
          t={t}
          item={modal.item}
          snapshot={snapshot}
          controller={controller}
          toolsOf={toolsOf}
          onClose={() => setModal({ kind: 'closed' })}
          onAdded={(name, mode) => {
            setModal({ kind: 'closed' })
            setBanner({ kind: mode === 'background' ? 'background' : 'added', name })
          }}
          onViewConfigured={(name) => {
            setModal({ kind: 'closed' })
            viewConfigured(name)
          }}
          onEditSaved={openEditModal}
          onOpenAdvanced={(draft) => {
            setModal({ kind: 'editor', row: null, initialDraft: draft })
          }}
        />
      )}
      {modal.kind === 'editor' && (
        <McpEditor t={t} row={modal.row} revision={modal.revision} initialDraft={modal.initialDraft} snapshot={snapshot} controller={controller} onClose={() => setModal({ kind: 'closed' })} />
      )}
      {modal.kind === 'probe' && (
        <ProbeDialog
          t={t}
          name={modal.name}
          row={rowsByName.get(modal.name)}
          probe={snapshot.probes[modal.name]}
          busy={snapshot.busy[modal.name]}
          writable={writable}
          legacy={snapshot.mode === 'legacy'}
          onRetry={() => { void controller.probe(modal.name) }}
          onEdit={openEditModal}
          onClose={() => setModal({ kind: 'closed' })}
        />
      )}
    </div>
  )
}

function FeaturedMcpCard({ t, item, match, liveStatus, writable, onAdd, onViewConfigured }: {
  t: MarketLocale
  item: FeaturedMcpServer
  match: FeaturedMcpMatch | null
  liveStatus?: McpStatus
  writable: boolean
  onAdd: () => void
  onViewConfigured: (name: string) => void
}): ReactElement {
  const isZh = t('lang') === 'zh'
  const description = isZh ? item.descriptionZh : item.descriptionEn
  const needsSetup = hasRequiredInputs(item)
  const needsKey = item.inputs.some(input => input.required === true && input.secret === true)
  const badgeTitle = match === null ? undefined : t('mcp.featured.addedAs', { name: match.name })
  const liveKind = liveStatus === undefined ? undefined : statusKind(liveStatus)
  const badgeText = match === null
    ? ''
    : liveStatus !== undefined ? statusLabel(t, liveStatus) : t('mcp.featured.addedBadge')
  return (
    <li className="dsh_market_card dsh_market_catalogCard dsh_market_mcpFeaturedCard">
      <div className="dsh_market_head">
        <PluginLogo src={item.icon} name={item.title} fullName={item.repo} />
        <div className="dsh_market_identity">
          <span className="dsh_market_name" title={item.title}>{item.title}</span>
          <span className="dsh_market_packageName" title={item.publisher}>{item.publisher}</span>
        </div>
        {match !== null && (
          <span
            className={`dsh_market_owned${liveKind !== undefined ? ' dsh_market_mcpFeaturedBadgeLive' : ''}`}
            data-kind={liveKind}
            title={badgeTitle}
          >
            {badgeText}
          </span>
        )}
      </div>
      <div className="dsh_market_meta dsh_market_skillBadges">
        <span className="dsh_market_categoryTag">{t(`mcp.featured.category.${item.category}`)}</span>
        <span className="dsh_market_categoryTag">{featuredRuntimeBadge(item)}</span>
        {needsSetup && (
          <span className="dsh_market_categoryTag dsh_market_mcpFeaturedTagWarn">
            {needsKey ? t('mcp.featured.needsKey') : t('mcp.featured.needsConfig')}
          </span>
        )}
      </div>
      <MarketDescription text={description} />
      <div className="dsh_market_foot dsh_market_mcpFeaturedFooter">
        <a className="dsh_market_link" href={item.homepage} target="_blank" rel="noreferrer">
          {t('mcp.featured.homepage')}
        </a>
        <div className="dsh_market_mcpFeaturedFooterRight">
          {match !== null
            ? (
              <MarketButton intent="secondary" onClick={() => onViewConfigured(match.name)}>
                {t('mcp.featured.viewConfigured')}
              </MarketButton>
              )
            : (
              <MarketButton
                intent="primary"
                disabled={!writable}
                title={writable ? undefined : t('mcp.featured.readonlyHint')}
                onClick={onAdd}
              >
                {needsSetup ? t('mcp.featured.configureAdd') : t('mcp.featured.add')}
              </MarketButton>
              )}
        </div>
      </div>
    </li>
  )
}

function FeaturedMcpModal({ t, item, snapshot, controller, toolsOf, onClose, onAdded, onViewConfigured, onEditSaved, onOpenAdvanced }: {
  t: MarketLocale
  item: FeaturedMcpServer
  snapshot: McpSnapshot
  controller: McpController
  toolsOf: ReadonlyMap<string, McpToolGroup>
  onClose: () => void
  onAdded: (name: string, mode: 'done' | 'background') => void
  onViewConfigured: (name: string) => void
  onEditSaved: (row: McpRow) => void
  onOpenAdvanced: (draft: McpDraft) => void
}): ReactElement {
  const isZh = t('lang') === 'zh'
  const taken = useMemo(() => new Set([
    ...snapshot.rows.map(row => row.name),
    ...(snapshot.host?.unmanaged ?? []).map(server => server.serverName),
  ]), [snapshot.rows, snapshot.host])
  const [name, setName] = useState(() => pickAvailableServerName(item.id, taken))
  const [values, setValues] = useState<Record<string, string>>({})
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState(false)
  const [enabled, setEnabled] = useState(true)
  const [touched, setTouched] = useState(false)
  const [submitState, setSubmitState] = useState<FeaturedSubmitState>({ status: 'idle' })
  const [toolsOpen, setToolsOpen] = useState(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const tracker = useMcpInstallTracker(snapshot, controller, mounted)
  const clearSubmitError = () => {
    setSubmitState(current => (current.status === 'error' ? { status: 'idle' } : current))
  }
  const saving = submitState.status === 'saving'
  const installing = tracker.phase.status === 'installing'
  const inProgress = saving || installing
  const postSave = tracker.phase.status !== 'none'
  const { savedName, liveRow, canRetry } = tracker
  const liveTools = savedName === '' ? undefined : toolsOf.get(savedName)
  const installBudgetMs = Math.max(45_000, (item.startupTimeoutMs ?? 30_000) + 15_000)

  const errors = validateFeaturedValues(item, name, values, taken)
  const nameError = errors.find(error => error.field === 'name')
  const inputError = (key: string) => errors.find(error => error.field === 'input' && error.key === key)
  const buildDraft = () => draftFromFeatured(item, values, {
    name,
    enabled,
    takenRefs: new Set([
      ...Object.keys(snapshot.credentials),
      ...snapshot.rows.flatMap(row => row.refs),
    ]),
  })
  const previewDraft = item.transport === 'stdio' ? buildDraft() : null
  const preview = item.transport === 'stdio' ? commandLine(previewDraft!.command, previewDraft!.args) : featuredTargetPreview(item)
  const canSubmit = !inProgress

  const copyPreview = async () => {
    try {
      await navigator.clipboard.writeText(preview)
      if (!mounted.current) return
      setCopied(true)
      setTimeout(() => { if (mounted.current) setCopied(false) }, 1_800)
    } catch {
      // Clipboard API may be unavailable in restricted contexts.
    }
  }

  const submit = async () => {
    setTouched(true)
    if (errors.length > 0 || !canSubmit) return
    setSubmitState({ status: 'saving' })
    const draft = buildDraft()
    const outcome = await controller.save(draft, undefined)
    if (!mounted.current) return
    if (outcome.ok) {
      setSubmitState({ status: 'idle' })
      if (!draft.enabled) {
        tracker.markSavedDisabled(draft.name, preview)
      } else {
        tracker.startInstalling({
          serverName: draft.name,
          isStdio: item.transport === 'stdio',
          preview,
          budgetMs: installBudgetMs,
        })
      }
    } else {
      setSubmitState({
        status: 'error',
        message: outcome.conflict ? t('mcp.editor.conflict') : t('mcp.saveFailed', { reason: reasonText(t, outcome.message) }),
      })
    }
  }

  const retryConnect = () => tracker.retry({ isStdio: item.transport === 'stdio', budgetMs: installBudgetMs })

  const handleClose = () => {
    if (inProgress) return
    if (tracker.phase.status === 'connected' || tracker.phase.status === 'saved-disabled' || tracker.phase.status === 'waiting') {
      onAdded(tracker.phase.serverName, 'done')
      return
    }
    onClose()
  }

  const modalTitle = installing
    ? t('mcp.featured.installingTitle', { name: item.title })
    : t('mcp.featured.modalTitle', { name: item.title })

  return (
    <>
    <Modal open headless title={modalTitle} className="dsh_market_modal" onClose={handleClose}>
      <div className="dsh_market_directPanel dsh_market_mcpEditor">
        <div className="dsh_market_directHead">
          <PluginLogo src={item.icon} name={item.title} fullName={item.repo} />
          <div className="dsh_market_installHeading">
            <h3>{modalTitle}</h3>
            <small>{item.publisher} · {featuredRuntimeBadge(item)}</small>
          </div>
          <button type="button" className="dsh_market_directClose" aria-label={t('mcp.featured.close')} disabled={inProgress} onClick={handleClose}>
            <IconCloseOutlineRegular size={16} />
          </button>
        </div>
        <p className="dsh_market_installSummary">{isZh ? item.descriptionZh : item.descriptionEn}</p>
        {postSave && tracker.phase.status !== 'none'
          ? (
            <>
              <McpInstallStatusPanel t={t} phase={tracker.phase} liveStatus={liveRow?.status} elapsedSec={tracker.elapsedSec} />
              <div className="dsh_market_installFooter dsh_market_mcpModalFooter">
                {tracker.phase.status === 'installing'
                  ? (
                    <>
                      {tracker.phase.timedOut && canRetry
                        ? (
                          <MarketButton size="md" intent="secondary" onClick={() => { void retryConnect() }}>
                            {t('mcp.featured.retryConnect')}
                          </MarketButton>
                          )
                        : <span />}
                      <div className="dsh_market_mcpModalFooterRight">
                        <MarketButton size="md" intent="secondary" onClick={() => onViewConfigured(savedName)}>
                          {t('mcp.featured.viewConfigured')}
                        </MarketButton>
                        <MarketButton size="md" intent="primary" onClick={() => onAdded(savedName, 'background')}>
                          {t('mcp.featured.background')}
                        </MarketButton>
                      </div>
                    </>
                    )
                  : tracker.phase.status === 'failed'
                    ? (
                      <>
                        {liveRow !== undefined
                          ? (
                            <MarketButton size="md" intent="secondary" onClick={() => onEditSaved(liveRow)}>
                              {t('mcp.featured.editSaved')}
                            </MarketButton>
                            )
                          : <span />}
                        <div className="dsh_market_mcpModalFooterRight">
                          <MarketButton size="md" intent="secondary" onClick={onClose}>
                            {t('mcp.featured.close')}
                          </MarketButton>
                          {canRetry && (
                            <MarketButton size="md" intent="primary" onClick={() => { void retryConnect() }}>
                              {t('mcp.featured.retryConnect')}
                            </MarketButton>
                          )}
                        </div>
                      </>
                      )
                    : (
                      <>
                        {tracker.phase.status === 'connected' && liveTools !== undefined && liveTools.tools.length > 0
                          ? (
                            <MarketButton size="md" intent="secondary" onClick={() => setToolsOpen(true)}>
                              {t('mcp.featured.viewTools', { count: String(liveTools.tools.length) })}
                            </MarketButton>
                            )
                          : <span />}
                        <div className="dsh_market_mcpModalFooterRight">
                          <MarketButton size="md" intent="secondary" onClick={() => onViewConfigured(savedName)}>
                            {t('mcp.featured.viewConfigured')}
                          </MarketButton>
                          <MarketButton size="md" intent="primary" onClick={() => onAdded(savedName, 'done')}>
                            {t('mcp.featured.done')}
                          </MarketButton>
                        </div>
                      </>
                      )}
              </div>
            </>
            )
          : (
            <form className="dsh_market_mcpForm" onSubmit={(event) => { event.preventDefault(); void submit() }}>
              <div className="dsh_market_mcpField">
                <div className="dsh_market_mcpFieldHead">
                  <span>{t('mcp.featured.target')}</span>
                  <button type="button" className="dsh_market_mcpCopyBtn" onClick={() => { void copyPreview() }}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                    {copied ? t('mcp.featured.copied') : t('mcp.featured.copyCommand')}
                  </button>
                </div>
                <pre className="dsh_market_directMessage">{preview}</pre>
              </div>
              <label className="dsh_market_mcpField">
                <span>{t('mcp.field.name')}</span>
                <input value={name} spellCheck={false} maxLength={32} onChange={event => { clearSubmitError(); setName(event.target.value) }} />
                <small className="dsh_market_meta">{t('mcp.field.nameHint')}</small>
                {(touched || name !== '') && nameError !== undefined && (
                  <span className="dsh_market_cardError">{t(`mcp.error.name.${nameError.code}`)}</span>
                )}
              </label>
              {item.inputs.map((input) => {
                const label = isZh ? input.labelZh : input.labelEn
                const hint = isZh ? input.descriptionZh : input.descriptionEn
                const err = inputError(input.key)
                const showError = err !== undefined && (touched || err.code === 'malformed')
                const fieldId = `dsh-mcp-featured-${item.id}-${input.key}`
                const isRevealed = revealed[input.key] === true
                return (
                  <div key={input.key} className="dsh_market_mcpField">
                    <div className="dsh_market_mcpFieldHead">
                      <label htmlFor={fieldId}>
                        {label}
                        {!input.required && <span className="dsh_market_mcpOptional"> ({t('mcp.featured.optional')})</span>}
                      </label>
                      {input.helpUrl && (
                        <a
                          className="dsh_market_mcpHelpLink"
                          href={input.helpUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={t('mcp.featured.openHelpUrl', { label })}
                          aria-label={t('mcp.featured.openHelpUrl', { label })}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
                          </svg>
                          {t('mcp.featured.getKey')}
                        </a>
                      )}
                    </div>
                    {input.secret
                      ? (
                        <div className="dsh_market_mcpInputWrap">
                          <input
                            id={fieldId}
                            type={isRevealed ? 'text' : 'password'}
                            autoComplete="off"
                            spellCheck={false}
                            value={values[input.key] ?? ''}
                            placeholder={input.placeholder ?? input.key}
                            onChange={event => { clearSubmitError(); setValues(current => ({ ...current, [input.key]: event.target.value })) }}
                          />
                          <button
                            type="button"
                            className="dsh_market_mcpSecretToggle"
                            aria-label={isRevealed ? t('mcp.featured.hideSecret') : t('mcp.featured.showSecret')}
                            title={isRevealed ? t('mcp.featured.hideSecret') : t('mcp.featured.showSecret')}
                            onClick={() => setRevealed(current => ({ ...current, [input.key]: !current[input.key] }))}
                          >
                            {isRevealed
                              ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.8 21.8 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a21.8 21.8 0 0 1-3.17 4.49M1 1l22 22" /></svg>
                              : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" /><circle cx="12" cy="12" r="3" /></svg>}
                          </button>
                        </div>
                        )
                      : (
                        <input
                          id={fieldId}
                          type="text"
                          autoComplete="off"
                          spellCheck={false}
                          value={values[input.key] ?? ''}
                          placeholder={input.placeholder ?? input.key}
                          onChange={event => { clearSubmitError(); setValues(current => ({ ...current, [input.key]: event.target.value })) }}
                        />
                        )}
                    {hint && <small className="dsh_market_meta">{hint}</small>}
                    {showError && (
                      <span className="dsh_market_cardError">
                        {err.code === 'malformed'
                          ? t('mcp.error.template', { where: label })
                          : t('mcp.featured.inputRequired', { label })}
                      </span>
                    )}
                  </div>
                )
              })}
              {hasSecretInputs(item) && <p className="dsh_market_meta">{t('mcp.featured.secretHint')}</p>}
              <label className="dsh_market_mcpCheck">
                <input type="checkbox" checked={enabled} onChange={event => { clearSubmitError(); setEnabled(event.target.checked) }} />
                <span>{t('mcp.field.enabled')}</span>
              </label>
              {!enabled && <small className="dsh_market_meta">{t('mcp.field.enabledHint')}</small>}
              {submitState.status === 'error' && <p className="dsh_market_cardError" role="alert">{submitState.message}</p>}
              <div className="dsh_market_installFooter dsh_market_mcpModalFooter">
                <MarketButton size="md" intent="secondary" disabled={saving} onClick={() => onOpenAdvanced(buildDraft())}>
                  {t('mcp.featured.advancedEdit')}
                </MarketButton>
                <div className="dsh_market_mcpModalFooterRight">
                  <MarketButton size="md" intent="secondary" disabled={saving} onClick={onClose}>{t('mcp.cancel')}</MarketButton>
                  <MarketButton size="md" type="submit" intent="primary" disabled={!canSubmit}>
                    {saving ? t('mcp.saving') : t('mcp.featured.add')}
                  </MarketButton>
                </div>
              </div>
            </form>
            )}
      </div>
    </Modal>
    {toolsOpen && liveTools !== undefined && (
      <ToolsDialog t={t} name={savedName} tools={liveTools} onClose={() => setToolsOpen(false)} />
    )}
    </>
  )
}

function PageNotices({ t, snapshot }: { t: MarketLocale; snapshot: McpSnapshot }): ReactElement {
  return (
    <>
      {snapshot.mode === 'legacy' && <div className="dsh_market_notice"><p className="dsh_market_noticeBody">{t('mcp.legacy')}</p></div>}
      {snapshot.mode === 'readonly' && <p className="dsh_market_status" role="status">{t('mcp.readonly')}</p>}
      {snapshot.hostError !== '' && snapshot.mode !== 'legacy' && (
        <p className="dsh_market_status" role="alert" data-error="true">{t('mcp.hostError', { reason: snapshot.hostError })}</p>
      )}
      {snapshot.settingsError !== '' && (
        <p className="dsh_market_status" role="alert" data-error="true">
          {t('mcp.settingsError', { reason: reasonText(t, snapshot.settingsError) })}
        </p>
      )}
      {snapshot.watchError !== '' && (
        <p className="dsh_market_status" role="alert" data-error="true">
          {t('mcp.watchError', { reason: reasonText(t, snapshot.watchError) })}
        </p>
      )}
    </>
  )
}

/** Above this many tools the dialog offers a filter box. */
const TOOL_FILTER = 8

function ToolsDialog({ t, name, tools, onClose }: {
  t: MarketLocale; name: string; tools: McpToolGroup; onClose: () => void
}): ReactElement {
  const [query, setQuery] = useState('')
  const close = onClose
  const needle = query.trim().toLowerCase()
  const shown = needle === '' ? tools.tools
    : tools.tools.filter(tool => tool.name.toLowerCase().includes(needle) || tool.description.toLowerCase().includes(needle))
  return (
    <Modal open headless title={t('mcp.tools.title', { name })} className="dsh_market_modal" onClose={close}>
    <div className="dsh_market_directPanel dsh_market_mcpToolsDialog">
      <div className="dsh_market_directHead">
        <div className="dsh_market_installHeading">
          <h3>{t('mcp.tools.title', { name })}</h3>
          <small>{t('mcp.tools.count', { count: String(tools.tools.length) })}</small>
        </div>
        <button type="button" className="dsh_market_directClose" aria-label={t('mcp.tools.close')} onClick={close}>
          <IconCloseOutlineRegular size={16} />
        </button>
      </div>
      {tools.tools.length > TOOL_FILTER && (
        <input data-modal-autofocus className="dsh_market_search dsh_market_mcpToolsFilter" type="search" spellCheck={false} value={query}
          placeholder={t('mcp.tools.filter')} aria-label={t('mcp.tools.filter')} onChange={(event) => setQuery(event.target.value)} />
      )}
      {shown.length === 0
        ? <p className="dsh_market_mcpToolsEmpty">{t('mcp.tools.noMatch')}</p>
        : (
          <ol className="dsh_market_mcpToolList" tabIndex={0} data-modal-autofocus={tools.tools.length > TOOL_FILTER ? undefined : true} aria-label={t('mcp.tools.title', { name })}>
            {shown.map(tool => (
              <li key={tool.name}>
                <span className="dsh_market_mcpToolName">{tool.name}</span>
                <span className="dsh_market_mcpToolDesc" data-empty={tool.description === '' ? 'true' : undefined}>
                  {tool.description === '' ? t('mcp.tools.noDescription') : tool.description}
                </span>
              </li>
            ))}
          </ol>
          )}
    </div>
    </Modal>
  )
}

function ProbeDialog({ t, name, row, probe, busy, writable, legacy, onRetry, onEdit, onClose }: {
  t: MarketLocale
  name: string
  row: McpRow | undefined
  probe: McpProbeState | undefined
  busy: string | undefined
  writable: boolean
  legacy: boolean
  onRetry: () => void
  onEdit: (row: McpRow) => void
  onClose: () => void
}): ReactElement {
  const running = probe === undefined || probe.status === 'running'
  const [elapsedSec, setElapsedSec] = useState(0)
  useEffect(() => {
    if (!running) return
    const startedAt = Date.now()
    setElapsedSec(0)
    const timer = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1_000))
    }, 1_000)
    return () => clearInterval(timer)
  }, [running, name])

  const target = row?.entry ? targetOf(row.entry) : ''
  const transport = row?.entry ? transportLabel(t, transportOf(row.entry)) : ''
  const subtitleParts = [
    row ? t(`mcp.source.${row.source}`) : '',
    transport,
  ].filter(part => part !== '')
  const succeeded = probe?.status === 'done' && probe.result.ok
  const failed = probe?.status === 'error' || (probe?.status === 'done' && !probe.result.ok)
  const retryAllowed = row !== undefined && canProbe(row) && !running && busy === undefined && !legacy
  const editable = writable && row !== undefined && isConfigured(row)
  const modalTitle = t('mcp.probe.modalTitle', { name })

  return (
    <Modal open headless title={modalTitle} className="dsh_market_modal" onClose={onClose}>
      <div className="dsh_market_directPanel dsh_market_mcpEditor">
        <div className="dsh_market_directHead">
          <div className="dsh_market_installHeading">
            <h3>{modalTitle}</h3>
            {subtitleParts.length > 0 && <small>{subtitleParts.join(' · ')}</small>}
          </div>
          <button type="button" className="dsh_market_directClose" aria-label={t('mcp.featured.close')} onClick={onClose}>
            <IconCloseOutlineRegular size={16} />
          </button>
        </div>

        <div
          className="dsh_market_mcpInstallPanel"
          data-tone={succeeded ? 'success' : failed ? 'error' : undefined}
        >
          <div className="dsh_market_mcpInstallStatusRow">
            {running && <StateDot state="ongoing" className="dsh_market_stateDot" />}
            {succeeded && <StateDot state="done" appearance="step" size={16} className="dsh_market_stateDot" />}
            {failed && <StateDot state="error" size={14} className="dsh_market_stateDot" />}
            <div>
              {running && (
                <>
                  <p role="status">
                    <TextShimmer active>{t('mcp.probe.runningHint')}</TextShimmer>
                  </p>
                  <p className="dsh_market_meta">{t('mcp.featured.elapsed', { seconds: String(elapsedSec) })}</p>
                </>
              )}
              {probe?.status === 'error' && (
                <p role="alert" className="dsh_market_cardError">{t('mcp.probe.error', { reason: probe.message })}</p>
              )}
              {probe?.status === 'done' && probe.result.ok && (
                <>
                  <p role="status">
                    {t('mcp.probe.ok', {
                      duration: String(Math.round(probe.result.durationMs)),
                      count: String(probe.result.toolNames.length),
                    })}
                  </p>
                  {probe.result.serverInfo && (
                    <p className="dsh_market_meta">
                      {t('mcp.probe.server', { name: probe.result.serverInfo.name, version: probe.result.serverInfo.version })}
                    </p>
                  )}
                  {probe.result.toolNames.length === 0 && (
                    <p className="dsh_market_meta">{t('mcp.probe.noTools')}</p>
                  )}
                </>
              )}
              {probe?.status === 'done' && !probe.result.ok && (
                <p role="alert" className="dsh_market_cardError">
                  {t('mcp.probe.failed', {
                    stage: t(`mcp.probe.stage.${probe.result.stage}`),
                    duration: String(Math.round(probe.result.durationMs)),
                    reason: probe.result.message,
                  })}
                </p>
              )}
              {probe?.status === 'done' && (!probe.result.closeConfirmed || probe.result.cleanupError !== undefined) && (
                <p className="dsh_market_cardNotice" data-warning="true">
                  {t('mcp.probe.cleanup', { reason: probe.result.cleanupError ?? '—' })}
                </p>
              )}
            </div>
          </div>
          {target !== '' && <pre className="dsh_market_directMessage">{target}</pre>}
          {probe?.status === 'done' && probe.result.ok && probe.result.toolNames.length > 0 && (
            <div className="dsh_market_mcpProbeTools">
              <span className="dsh_market_meta">
                {t('mcp.probe.toolsLabel', { count: String(probe.result.toolNames.length) })}
              </span>
              <pre className="dsh_market_directMessage">{probe.result.toolNames.join(', ')}</pre>
              {probe.result.truncated && (
                <span className="dsh_market_meta">
                  {t('mcp.probe.truncated', { count: String(probe.result.toolNames.length) })}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="dsh_market_installFooter dsh_market_mcpModalFooter">
          {failed && editable
            ? (
              <MarketButton size="md" intent="secondary" onClick={() => onEdit(row)}>
                {t('mcp.featured.editSaved')}
              </MarketButton>
              )
            : <span />}
          <div className="dsh_market_mcpModalFooterRight">
            <MarketButton size="md" intent="secondary" disabled={!retryAllowed} onClick={onRetry}>
              {running ? t('mcp.probing') : t('mcp.probe.retry')}
            </MarketButton>
            <MarketButton size="md" intent="primary" onClick={onClose}>
              {t('mcp.featured.close')}
            </MarketButton>
          </div>
        </div>
      </div>
    </Modal>
  )
}

/** What moving this row from a static one did; shown until the page reloads. */
function adoptSummary(t: MarketLocale, note: McpAdoptNote): { failed: boolean; badge: string; tip: string } {
  const reason = reasonText(t, note.error ?? '')
  const refs = [...note.stored, ...note.reused]
  const failed = note.state === 'disable-failed' || note.state === 'enable-failed'
  const main = note.state === 'enabled' ? t('mcp.adopted.enabled')
    : note.state === 'kept-off' ? t('mcp.adopted.keptOff')
      : note.state === 'restart' ? t('mcp.adopted.restart')
        : note.state === 'disable-failed' ? t('mcp.adopted.disableFailed', { reason })
          : t('mcp.adopted.enableFailed', { reason })
  const tip = [
    main,
    refs.length > 0 ? t('mcp.adopted.stored', { refs: refs.join(', ') }) : '',
    note.dropped.length > 0 ? t('mcp.adopted.dropped', { fields: note.dropped.join(', ') }) : '',
  ].filter(Boolean).join('\n')
  return {
    failed,
    badge: note.state === 'restart' ? t('mcp.badge.restart') : t('mcp.badge.adopted'),
    tip,
  }
}

function BadgeHint({ label, tip, tone }: { label: string; tip: string; tone?: 'warn' }): ReactElement {
  return (
    <span className={tone === 'warn' ? 'dsh_market_categoryTag dsh_market_mcpFeaturedTagWarn' : 'dsh_market_categoryTag'}>
      {label}
      <Tooltip label={tip} side="top" portal openOnClick maxWidth={280}>
        <span className="dsh_market_hint" tabIndex={0} aria-label={tip}>
          <IconInfoOutlineRegular size={13} />
        </span>
      </Tooltip>
    </span>
  )
}

function AdoptErrors({ t, note }: { t: MarketLocale; note: McpAdoptNote | undefined }): ReactElement | null {
  if (note === undefined) return null
  const reason = reasonText(t, note.error ?? '')
  const failed = note.state === 'disable-failed' || note.state === 'enable-failed'
  if (!failed && note.dropped.length === 0) return null
  return (
    <>
      {failed && (
        <p className="dsh_market_cardError" role="status">
          {note.state === 'disable-failed'
            ? t('mcp.adopted.disableFailed', { reason })
            : t('mcp.adopted.enableFailed', { reason })}
        </p>
      )}
      {note.dropped.length > 0 && (
        <p className="dsh_market_cardNotice" data-warning="true">{t('mcp.adopted.dropped', { fields: note.dropped.join(', ') })}</p>
      )}
    </>
  )
}

/** Where a configured credential's value comes from, in the page's words. */
function sourceLabel(t: MarketLocale, source: string | undefined): string {
  if (source === 'file') return t('mcp.cred.source.file')
  if (source === 'env') return t('mcp.cred.source.env')
  return source ?? ''
}

function Credentials({ t, row, snapshot, controller }: {
  t: MarketLocale; row: McpRow; snapshot: McpSnapshot; controller: McpController
}): ReactElement | null {
  const [flow, setFlow] = useState<CredentialFlowState>({ status: 'idle' })
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  if (row.refs.length === 0) return null
  const canClear = controller.supports('unsetCredential')
  const busy = flow.status === 'saving' || flow.status === 'clearing'
  const editingRef = flow.status === 'editing' || flow.status === 'saving' ? flow.ref : null
  const clearingRef = flow.status === 'confirming-clear' || flow.status === 'clearing' ? flow.ref : null
  const error = 'error' in flow && flow.error !== undefined ? flow.error : ''

  const clear = async (ref: string) => {
    if (busy) return
    setFlow({ status: 'clearing', ref })
    const failure = await controller.clearCredential(ref)
    if (!mounted.current) return
    setFlow(failure === '' ? { status: 'idle' } : { status: 'idle', error: t('mcp.cred.clearFailed', { reason: reasonText(t, failure) }) })
  }
  const save = async (ref: string, value: string) => {
    if (value === '' || busy) return
    setFlow({ status: 'saving', ref, value })
    const failure = await controller.setCredential(ref, value)
    if (!mounted.current) return
    if (failure === '') {
      setFlow({ status: 'idle' })
    } else {
      setFlow({ status: 'editing', ref, value, error: t('mcp.cred.failed', { reason: reasonText(t, failure) }) })
    }
  }
  return (
    <div className="dsh_market_mcpCreds">
      <span className="dsh_market_meta">{t('mcp.cred.needed')}</span>
      <ul>
        {row.refs.map((ref) => {
          const info = snapshot.credentials[ref]
          const configured = info?.configured === true
          const source = configured ? sourceLabel(t, info?.source) : ''
          // An environment value is not the store's to remove; unset would leave it in force.
          const clearable = canClear && configured && info?.writable === true && info.source !== 'env'
          const editingThis = editingRef === ref
          const clearingThis = clearingRef === ref
          const currentValue = (flow.status === 'editing' || flow.status === 'saving') && flow.ref === ref ? flow.value : ''
          return (
            <li key={ref}>
              <code>{ref}</code>
              <span className="dsh_market_mcpCredState" data-configured={configured ? 'true' : 'false'}>
                {configured
                  ? [t('mcp.cred.configured'), source, info?.masked].filter(part => part !== undefined && part !== '').join(' · ')
                  : t('mcp.cred.missing')}
              </span>
              {info?.writable === true && !editingThis && !clearingThis && (
                <button type="button" className="dsh_market_chip" disabled={busy}
                  onClick={() => { setFlow({ status: 'editing', ref, value: '' }) }}>
                  {configured ? t('mcp.cred.update') : t('mcp.cred.set')}
                </button>
              )}
              {clearable && !editingThis && (clearingThis
                ? (
                  <>
                    <button type="button" className="dsh_market_chip dsh_market_mcpCredDanger" disabled={busy} onClick={() => { void clear(ref) }}>
                      {flow.status === 'clearing' ? t('mcp.cred.clearing') : t('mcp.cred.clearConfirm')}
                    </button>
                    <button type="button" className="dsh_market_chip" disabled={busy} onClick={() => setFlow({ status: 'idle' })}>
                      {t('mcp.cancel')}
                    </button>
                  </>
                  )
                : (
                  <button type="button" className="dsh_market_chip" disabled={busy} title={t('mcp.cred.clearHint')}
                    onClick={() => { setFlow({ status: 'confirming-clear', ref }) }}>
                    {t('mcp.cred.clear')}
                  </button>
                  ))}
              {info?.writable === false && <span className="dsh_market_meta">{t('mcp.cred.readonly')}</span>}
              {editingThis && (
                <form className="dsh_market_mcpCredForm" onSubmit={(event) => { event.preventDefault(); void save(ref, currentValue) }}>
                  <input type="password" autoComplete="off" spellCheck={false} value={currentValue} autoFocus
                    aria-label={t('mcp.cred.placeholder', { ref })} placeholder={t('mcp.cred.placeholder', { ref })}
                    onChange={event => setFlow({ status: 'editing', ref, value: event.target.value })} />
                  <MarketButton type="submit" intent="primary" disabled={currentValue === '' || busy}>
                    {flow.status === 'saving' ? t('mcp.cred.saving') : t('mcp.cred.save')}
                  </MarketButton>
                  <MarketButton intent="secondary" disabled={busy} onClick={() => { setFlow({ status: 'idle' }) }}>
                    {t('mcp.cancel')}
                  </MarketButton>
                </form>
              )}
            </li>
          )
        })}
      </ul>
      {error !== '' && <p className="dsh_market_cardError" role="alert">{error}</p>}
    </div>
  )
}

/** A configured server's face: the curated item it runs (icon, publisher) or a letter tile. */
function CardIdentity({ t, name, title, featured, subtitle, state, kind, tools }: {
  t: MarketLocale; name: string; title: string; featured: FeaturedMcpServer | undefined; subtitle: string; state: string; kind: string
  tools?: McpToolGroup
}): ReactElement {
  const [toolsOpen, setToolsOpen] = useState(false)
  const hasTools = tools !== undefined && tools.tools.length > 0
  useEffect(() => {
    if (!hasTools && toolsOpen) setToolsOpen(false)
  }, [hasTools, toolsOpen])
  return (
    <div className="dsh_market_head">
      <PluginLogo src={featured?.icon} name={featured?.title ?? name} fullName={featured?.repo} />
      <div className="dsh_market_identity">
        <span className="dsh_market_name" title={title}>{name}</span>
        {subtitle !== '' && <span className="dsh_market_packageName" title={subtitle}>{subtitle}</span>}
      </div>
      {hasTools
        ? (
          <>
            <Tooltip label={t('mcp.tools.show', { count: String(tools.tools.length) })} side="top" portal>
              <button
                type="button"
                className="dsh_market_mcpState dsh_market_mcpStateButton"
                data-kind={kind}
                aria-haspopup="dialog"
                aria-label={`${state} — ${t('mcp.tools.show', { count: String(tools.tools.length) })}`}
                onClick={() => setToolsOpen(true)}
              >
                <span>{state}</span>
                <IconChevronRightOutlineMedium size={12} />
              </button>
            </Tooltip>
            {toolsOpen && <ToolsDialog t={t} name={name} tools={tools} onClose={() => setToolsOpen(false)} />}
          </>
          )
        : <span className="dsh_market_mcpState" data-kind={kind}>{state}</span>}
    </div>
  )
}

function featuredDescription(t: MarketLocale, featured: FeaturedMcpServer | undefined): string {
  if (featured === undefined) return ''
  return t('lang') === 'zh' ? featured.descriptionZh : featured.descriptionEn
}

/** Credentials for a row whose editor is not offered (read-only page or a row Settings does not carry). */
function CredentialsButton({ t, row, snapshot, controller }: {
  t: MarketLocale; row: McpRow; snapshot: McpSnapshot; controller: McpController
}): ReactElement {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  return (
    <>
      <MarketButton intent="secondary" aria-haspopup="dialog" onClick={() => setOpen(true)}>{t('mcp.cred.manage')}</MarketButton>
      {open && (
        <Modal open headless title={t('mcp.cred.title', { name: row.name })} className="dsh_market_modal" onClose={close}>
          <div className="dsh_market_directPanel dsh_market_mcpEditor">
            <div className="dsh_market_directHead">
              <div className="dsh_market_installHeading">
                <h3>{t('mcp.cred.title', { name: row.name })}</h3>
              </div>
              <button type="button" className="dsh_market_directClose" aria-label={t('mcp.editor.close')} onClick={close}>
                <IconCloseOutlineRegular size={16} />
              </button>
            </div>
            <Credentials t={t} row={row} snapshot={snapshot} controller={controller} />
          </div>
        </Modal>
      )}
    </>
  )
}

function McpCard({ t, row, customDescription, snapshot, controller, writable, tools, onEdit, onProbe }: {
  t: MarketLocale; row: McpRow; customDescription: string; snapshot: McpSnapshot; controller: McpController; writable: boolean
  tools: McpToolGroup | undefined; onEdit: () => void; onProbe: () => void
}): ReactElement {
  const [confirming, setConfirming] = useState(false)
  const busy = snapshot.busy[row.name]
  const probe = snapshot.probes[row.name]
  const actionError = snapshot.errors[row.name]
  const kind = statusKind(row.status)
  const lastError = statusError(row.status)
  const configured = isConfigured(row)
  const enabled = isEnabled(row)
  const removable = row.source === 'user' || row.source === 'overridden'
  const editable = writable && configured
  useEffect(() => {
    if ((!writable || !configured || !removable) && confirming) setConfirming(false)
  }, [writable, configured, removable, confirming])
  const featured = featuredForServer(row.entry, row.source === 'registered' ? row.name : '')
  const transport = row.entry === undefined ? '' : transportLabel(t, transportOf(row.entry))
  // The launch target, environment and credentials live in the editor; the
  // card says what the server is and whether it needs attention.
  const sourceHint = row.source === 'registered' ? t('mcp.registeredHint') : row.source === 'retained' ? t('mcp.retainedHint') : ''
  const description = customDescription
    || featuredDescription(t, featured)
    || sourceHint
    || t(editable ? 'mcp.card.desc.custom' : 'mcp.card.desc.plain')
  const missing = row.refs.filter(ref => snapshot.credentials[ref]?.configured !== true).length
  // A missing credential is named by the notice below; its diagnostic would only repeat it.
  const showError = lastError !== '' && kind !== 'connected' && !(row.status?.state === 'waiting-credentials' && row.refs.length > 0)
  const adoptNote = snapshot.adopted[row.name]
  const adoptInfo = adoptNote === undefined ? null : adoptSummary(t, adoptNote)
  const plaintextTip = row.plaintext.length > 0
    ? t(editable ? 'mcp.plaintext' : 'mcp.plaintextReadonly', { fields: row.plaintext.join(', ') })
    : ''
  return (
    <li className="dsh_market_card dsh_market_mcpCard" data-confirming={confirming ? 'true' : undefined}>
      <CardIdentity t={t} name={row.name} title={row.name} featured={featured} kind={kind} state={statusLabel(t, row.status)}
        subtitle={featured !== undefined ? featured.publisher : transport} tools={kind === 'connected' ? tools : undefined} />
      <div className="dsh_market_meta dsh_market_skillBadges">
        {sourceHint !== '' && description !== sourceHint
          ? <BadgeHint label={t(`mcp.source.${row.source}`)} tip={sourceHint} />
          : <span className="dsh_market_categoryTag" title={sourceHint || undefined}>{t(`mcp.source.${row.source}`)}</span>}
        {featured !== undefined && <span className="dsh_market_categoryTag">{t(`mcp.featured.category.${featured.category}`)}</span>}
        {adoptInfo !== null && !adoptInfo.failed && <BadgeHint label={adoptInfo.badge} tip={adoptInfo.tip} />}
        {plaintextTip !== '' && <BadgeHint label={t('mcp.badge.plaintext')} tip={plaintextTip} tone="warn" />}
      </div>
      <MarketDescription text={description} />
      <div className="dsh_market_mcpBody">
        {kind === 'locked' && row.source !== 'retained' && <p className="dsh_market_cardError">{t('mcp.lockedHint')}</p>}
        {missing > 0 && (
          <p className="dsh_market_cardError">
            {t(editable ? 'mcp.cred.missingEdit' : 'mcp.cred.missingCount', { count: String(missing) })}
          </p>
        )}
        {showError && <p className="dsh_market_cardError">{t('mcp.lastError', { reason: lastError })}</p>}
        <AdoptErrors t={t} note={adoptNote} />
        {actionError !== undefined && (
          <p className="dsh_market_cardError" role="alert">
            {/conflict/i.test(actionError) ? t('mcp.conflict') : t('mcp.actionFailed', { reason: reasonText(t, actionError) })}
          </p>
        )}
      </div>
      <div className="dsh_market_foot">
        {confirming
          ? (
            <>
              <span className="dsh_market_cardNotice" aria-live="polite">
                {row.source === 'overridden' ? t('mcp.confirmRestore', { name: row.name }) : t('mcp.confirmRemove', { name: row.name })}
              </span>
              <MarketButton intent="danger" disabled={busy !== undefined}
                onClick={() => {
                  void controller.remove(row.name).then(() => {
                    if (row.source === 'user' && !controller.getSnapshot().rows.some(item => item.name === row.name)) {
                      deleteMcpDescription(row.name)
                    }
                    setConfirming(false)
                  })
                }}>
                {busy === 'remove' ? t('mcp.removing') : t('mcp.confirm')}
              </MarketButton>
              <MarketButton intent="secondary" disabled={busy !== undefined} onClick={() => setConfirming(false)}>
                {t('mcp.cancel')}
              </MarketButton>
            </>
            )
          : (
            <>
              {canProbe(row) && (
                <MarketButton intent="secondary" disabled={probe?.status === 'running' || busy !== undefined || snapshot.mode === 'legacy'}
                  onClick={onProbe}>
                  {probe?.status === 'running' ? t('mcp.probing') : t('mcp.probe')}
                </MarketButton>
              )}
              {canRestart(row) && (
                <MarketButton intent="secondary" disabled={busy !== undefined}
                  onClick={() => { void controller.restart(row.name) }}>
                  {busy === 'restart' ? t('mcp.restarting') : t('mcp.restart')}
                </MarketButton>
              )}
              {!editable && row.refs.length > 0 && <CredentialsButton t={t} row={row} snapshot={snapshot} controller={controller} />}
              {editable && (
                <>
                  <MarketButton intent="secondary" disabled={busy !== undefined}
                    onClick={() => { void controller.setEnabled(row.name, !enabled) }}>
                    {busy === 'enable' ? t('mcp.enabling') : busy === 'disable' ? t('mcp.disabling')
                      : enabled ? t('mcp.disable') : t('mcp.enable')}
                  </MarketButton>
                  <MarketButton intent="secondary" disabled={busy !== undefined} onClick={onEdit}>{t('mcp.edit')}</MarketButton>
                  {removable && (
                    <MarketButton intent="danger" disabled={busy !== undefined} onClick={() => setConfirming(true)}>
                      {row.source === 'overridden' ? t('mcp.restore') : t('mcp.remove')}
                    </MarketButton>
                  )}
                </>
              )}
            </>
            )}
      </div>
    </li>
  )
}

function StaticCard({ t, server, tools, conflict, snapshot, controller, writable }: {
  t: MarketLocale; server: McpUnmanagedServer; tools: McpToolGroup | undefined; conflict: boolean
  snapshot: McpSnapshot; controller: McpController; writable: boolean
}): ReactElement {
  const [confirmingAdopt, setConfirmingAdopt] = useState(false)
  const key = staticKey(server.loaderId)
  const toggle = snapshot.staticToggles?.[server.loaderId]
  const busy = snapshot.busy[key]
  const error = snapshot.errors[key]
  const notice = snapshot.notices[key]
  const adoptedNote = snapshot.adopted[server.serverName]
  const adoptedStopped = adoptedNote !== undefined && !server.enabled
    && (adoptedNote.state === 'enabled' || adoptedNote.state === 'kept-off')
  // Adoption switches a running row off through the plugin manager, so a
  // running row needs that switch; a stopped one only needs the Host verb.
  const adoptVisible = writable && controller.supports('adopt') && !conflict
  const toggleVisible = toggle?.available === true && snapshot.mode !== 'readonly'
  const showFoot = confirmingAdopt || adoptVisible || toggleVisible
  useEffect(() => {
    if (!adoptVisible && confirmingAdopt) setConfirmingAdopt(false)
  }, [adoptVisible, confirmingAdopt])
  const adoptBlocked = server.adoptBlocker !== '' ? t(`mcp.adopt.blocked.${server.adoptBlocker}`)
    : server.enabled && toggle?.available !== true ? t('mcp.adopt.locked') : ''
  // Starting a static row over an enabled managed server of the same name
  // would fail both; the controller refuses it too, this only explains why.
  const blocked = !server.enabled && snapshot.rows.some(row => row.name === server.serverName && row.entry?.enabled !== false)
  const state = !server.enabled ? 'disabled'
    : server.phase === 'active' ? 'connected'
      : server.phase === 'failed' ? 'issue'
        : server.phase === 'pending' || server.phase === 'loading' ? 'pending' : 'disabled'
  const toolCount = tools?.tools.length ?? 0
  const label = !server.enabled ? t('mcp.state.disabled')
    : server.phase === 'active'
      ? (toolCount > 0 ? t('mcp.static.runningTools', { count: String(toolCount) }) : t('mcp.static.running'))
      : server.phase === 'failed' ? t('mcp.static.failed')
        : server.phase === 'pending' || server.phase === 'loading' ? t('mcp.static.loading') : t('mcp.static.stopped')
  const target = server.transport === 'stdio' ? commandLine(server.command, server.args) : server.url
  const featured = featuredForServer(server)
  const description = featuredDescription(t, featured) || t('mcp.card.desc.static')
  const launchDetails = [
    target,
    server.envKeys.length > 0 ? t('mcp.static.env', { keys: server.envKeys.join(', ') }) : '',
    server.headerKeys.length > 0 ? t('mcp.static.headers', { keys: server.headerKeys.join(', ') }) : '',
  ].filter(part => part !== '').join('\n')
  return (
    <li className="dsh_market_card dsh_market_mcpCard" data-confirming={confirmingAdopt ? 'true' : undefined}>
      <CardIdentity t={t} name={server.serverName || server.entryId} title={server.entryId} featured={featured} kind={state} state={label}
        subtitle={featured !== undefined ? featured.publisher : transportLabel(t, server.transport)} tools={tools} />
      <div className="dsh_market_meta dsh_market_skillBadges">
        <BadgeHint label={t('mcp.source.static')} tip={t('mcp.static.hint')} />
        {launchDetails !== '' && <BadgeHint label={t('mcp.static.details')} tip={launchDetails} />}
        {featured !== undefined && <span className="dsh_market_categoryTag">{t(`mcp.featured.category.${featured.category}`)}</span>}
        {conflict && adoptedStopped && (
          <BadgeHint label={t('mcp.badge.adopted')} tip={t('mcp.static.adopted', { name: server.serverName })} />
        )}
        {notice === 'restart-required' && (
          <BadgeHint label={t('mcp.badge.restart')} tip={t('mcp.static.restartRequired')} />
        )}
        {toggle?.available === false && (
          <BadgeHint label={t('mcp.badge.readonly')} tip={t(`mcp.static.readonly.${toggle.reason}`)} />
        )}
        {server.plaintextSecrets.length > 0 && (
          <BadgeHint
            label={t('mcp.badge.plaintext')}
            tip={t('mcp.static.plaintext', { fields: server.plaintextSecrets.join(', ') })}
            tone="warn"
          />
        )}
      </div>
      <MarketDescription text={description} />
      <div className="dsh_market_mcpBody">
        {conflict && !adoptedStopped && <p className="dsh_market_cardError">{t('mcp.static.conflict', { name: server.serverName })}</p>}
        {error !== undefined && (
          <p className="dsh_market_cardError" role="alert">
            {error === 'overridden' ? t('mcp.static.overridden') : t('mcp.actionFailed', { reason: reasonText(t, error) })}
          </p>
        )}
      </div>
      {showFoot && (
        <div className="dsh_market_foot">
          {confirmingAdopt
            ? (
              <>
                <span className="dsh_market_cardNotice" aria-live="polite">{t('mcp.adopt.confirm')}</span>
                <MarketButton intent="secondary" disabled={busy !== undefined}
                  onClick={() => { void controller.adopt(server.loaderId).then(() => setConfirmingAdopt(false)) }}>
                  {busy === 'adopt' ? t('mcp.adopting') : t('mcp.confirm')}
                </MarketButton>
                <MarketButton intent="secondary" disabled={busy !== undefined} onClick={() => setConfirmingAdopt(false)}>
                  {t('mcp.cancel')}
                </MarketButton>
              </>
              )
            : (
              <>
                {adoptVisible && (
                  <MarketButton intent="secondary" disabled={busy !== undefined || adoptBlocked !== ''}
                    title={adoptBlocked !== '' ? adoptBlocked : t('mcp.adopt.hint')} onClick={() => setConfirmingAdopt(true)}>
                    {t('mcp.adopt')}
                  </MarketButton>
                )}
                {toggleVisible && (
                  <MarketButton intent="secondary" disabled={busy !== undefined || blocked}
                    title={blocked ? t('mcp.reason.nameConflict') : undefined}
                    onClick={() => { void controller.setStaticEnabled(server.loaderId, !server.enabled) }}>
                    {busy === 'enable' ? t('mcp.enabling') : busy === 'disable' ? t('mcp.disabling')
                      : server.enabled ? t('mcp.disable') : t('mcp.enable')}
                  </MarketButton>
                )}
              </>
              )}
        </div>
      )}
    </li>
  )
}

function errorText(t: MarketLocale, error: McpDraftError): string {
  switch (error.field) {
    case 'name': return t(`mcp.error.name.${error.code}`)
    case 'command': return t('mcp.error.command.required')
    case 'url': return t(`mcp.error.url.${error.code}`)
    case 'env':
    case 'headers': return t(`mcp.error.pairs.${error.code}`)
    case 'template': return t('mcp.error.template', { where: error.where })
    case 'maxDelayMs': return error.code === 'order' ? t('mcp.error.delayOrder') : t('mcp.error.number')
    case 'startupTimeoutMs':
    case 'toolCallTimeoutMs':
    case 'closeTimeoutMs':
    case 'initialDelayMs':
    case 'maxAttempts': return t('mcp.error.number')
  }
}

function PairsField({ t, label, hint, pairs, onChange, error }: {
  t: MarketLocale; label: string; hint?: string; pairs: readonly McpPair[]; onChange: (next: McpPair[]) => void; error?: string
}): ReactElement {
  const update = (index: number, patch: Partial<McpPair>) => onChange(pairs.map((pair, at) => at === index ? { ...pair, ...patch } : pair))
  return (
    <fieldset className="dsh_market_mcpField">
      <legend>{label}</legend>
      {hint && <small className="dsh_market_meta">{hint}</small>}
      {pairs.map((pair, index) => (
        <div key={index} className="dsh_market_mcpPair">
          <input value={pair.key} spellCheck={false} aria-label={`${label} ${t('mcp.field.key')}`} placeholder={t('mcp.field.key')}
            onChange={event => update(index, { key: event.target.value })} />
          <input value={pair.value} spellCheck={false} aria-label={`${label} ${t('mcp.field.value')}`} placeholder={t('mcp.field.value')}
            onChange={event => update(index, { value: event.target.value })} />
          <button type="button" className="dsh_market_chip" onClick={() => onChange(pairs.filter((_, at) => at !== index))}>
            {t('mcp.field.removePair')}
          </button>
        </div>
      ))}
      <button type="button" className="dsh_market_chip" onClick={() => onChange([...pairs, { key: '', value: '' }])}>{t('mcp.field.addPair')}</button>
      {error && <p className="dsh_market_cardError">{error}</p>}
    </fieldset>
  )
}

/** The credential name a plaintext field suggests: its env/header name, or the flag before an argument. */
function fieldLabel(draft: McpDraft, where: string): string {
  const arg = /^args\[(\d+)\]$/.exec(where)
  if (arg !== null) {
    const index = Number(arg[1])
    const own = draft.args[index] ?? ''
    const flag = own.startsWith('-') && own.includes('=') ? own.slice(0, own.indexOf('=')) : draft.args[index - 1] ?? ''
    return flag.startsWith('-') ? flag.replace(/^-+/, '') : 'TOKEN'
  }
  return where === 'url' ? 'URL_TOKEN' : where.slice(where.indexOf('.') + 1)
}

function McpEditor({ t, row, revision, initialDraft, snapshot, controller, onClose }: {
  t: MarketLocale; row: McpRow | null; revision?: number; initialDraft?: McpDraft; snapshot: McpSnapshot; controller: McpController; onClose: () => void
}): ReactElement {
  const [baseline, setBaseline] = useState<McpDraft>(() =>
    row?.entry !== undefined ? draftFromEntry(row.name, row.entry, getMcpDescription(row.name)) : (initialDraft ?? emptyDraft()))
  const [draft, setDraft] = useState<McpDraft>(() => baseline)
  const [editRevision, setEditRevision] = useState(revision)
  const [argsText, setArgsText] = useState(() => draft.args.join('\n'))
  const [pasteLine, setPasteLine] = useState('')
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState('')
  const [jsonNotice, setJsonNotice] = useState('')
  const [jsonUnsupported, setJsonUnsupported] = useState(false)
  const [jsonIgnored, setJsonIgnored] = useState<readonly string[]>([])
  const [jsonEntries, setJsonEntries] = useState<readonly ParsedMcpSnippet[]>([])
  // Trust is given to one exact command line; any edit to it asks again.
  const [trustedLine, setTrustedLine] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const [editorStatus, setEditorStatus] = useState<EditorStatus>({ status: 'idle' })
  const footerRef = useRef<HTMLDivElement>(null)
  const keepEditingRef = useRef<HTMLButtonElement>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const tracker = useMcpInstallTracker(snapshot, controller, mounted)
  const [advanced, setAdvanced] = useState(() => hasCustomMcpTiming(draft))
  const submitState: EditorSubmitState = editorStatus.status === 'confirm-discard' ? editorStatus.previous : editorStatus
  const saving = submitState.status === 'saving'
  const confirmDiscard = editorStatus.status === 'confirm-discard'
  const conflict = submitState.status === 'conflict'
  const liveRow = row === null ? undefined : snapshot.rows.find(item => item.name === row.name)
  const latest = liveRow?.entry
  const deleted = conflict && row !== null && snapshot.settings !== null && latest === undefined
  const saveError = conflict ? t(deleted ? 'mcp.editor.conflictDeleted' : 'mcp.editor.conflict')
    : submitState.status === 'error' ? submitState.message : ''
  const taken = new Set([
    ...snapshot.rows.map(item => item.name),
    ...(snapshot.host?.unmanaged ?? []).map(server => server.serverName),
  ])
  if (row !== null) taken.delete(row.name)
  const errors = validateDraft(draft, taken)
  const errorOf = (field: McpDraftError['field']) => {
    const found = errors.find(error => error.field === field)
    const live = field === 'name' && draft.name !== ''
    return (touched || live) && found !== undefined ? errorText(t, found) : undefined
  }
  const line = draft.transport === 'stdio' ? commandLine(draft.command, draft.args) : ''
  const commandChanged = draft.transport === 'stdio' && (row === null || line !== commandLine(baseline.command, baseline.args)
    || baseline.transport !== 'stdio')
  const risks = draft.transport === 'stdio' ? commandRisks(draft.command, draft.args) : []
  const plaintext = draftPlaintext(draft)
  const previous = row !== null && draft.name.trim() === row.name ? serversOf(snapshot.settings?.user)[row.name] : undefined
  const requiresCredentials = newDraftPlaintext(draft, previous).length > 0
  const refsTaken = new Set([...draft.pending.map(secret => secret.ref), ...Object.keys(snapshot.credentials)])
  const trusted = trustedLine === line
  const needsTrust = commandChanged && draft.command.trim() !== ''
  // An empty command is not gated here: the click runs validation, which
  // names the missing field instead of leaving a silently disabled button.
  const canSave = !saving && !deleted && (!needsTrust || trusted)
  const isFreshBlank = row === null && initialDraft === undefined
  const dirty = (isFreshBlank ? hasDraftContent(draft) : isDraftDirty(draft, baseline))
    || pasteLine.trim() !== ''
    || jsonText.trim() !== ''
  const resetTransientStatus = () => {
    setEditorStatus((current): EditorStatus => {
      if (current.status === 'confirm-discard') {
        return current.previous.status === 'conflict' ? current.previous : { status: 'idle' }
      }
      if (current.status === 'error') return { status: 'idle' }
      return current
    })
  }
  const keepEditing = () => {
    setEditorStatus(current => (current.status === 'confirm-discard' ? current.previous : current))
  }
  const set = (patch: Partial<McpDraft>) => {
    resetTransientStatus()
    setDraft(current => ({ ...current, ...patch }))
  }
  const setArgs = (text: string) => {
    setArgsText(text)
    set({ args: text.split('\n').filter(item => item !== '') })
  }
  const requestClose = () => {
    if (saving || tracker.phase.status === 'installing') return
    if (tracker.phase.status !== 'none') {
      onClose()
      return
    }
    if (dirty) {
      setEditorStatus((current): EditorStatus => {
        if (current.status === 'saving' || current.status === 'confirm-discard') return current
        return { status: 'confirm-discard', previous: current }
      })
      requestAnimationFrame(() => {
        footerRef.current?.scrollIntoView({ block: 'nearest' })
        keepEditingRef.current?.focus()
      })
      return
    }
    onClose()
  }
  const applyPaste = () => {
    const words = splitCommandLine(pasteLine)
    if (words.length === 0) return
    set({ command: words[0]!, args: words.slice(1) })
    setArgsText(words.slice(1).join('\n'))
    setPasteLine('')
  }
  const applyJsonEntry = (entry: ParsedMcpSnippet) => {
    resetTransientStatus()
    setDraft(current => ({
      ...current,
      ...(nameEditable && (entry.name !== '' || entry.rawName !== '') ? { name: entry.name } : {}),
      description: entry.description,
      transport: entry.transport,
      command: entry.transport === 'stdio' ? entry.command : '',
      args: entry.transport === 'stdio' ? [...entry.args] : [],
      cwd: entry.transport === 'stdio' ? entry.cwd : '',
      env: entry.transport === 'stdio' ? [...entry.env] : [],
      url: entry.transport === 'streamable-http' ? entry.url : '',
      headers: entry.transport === 'streamable-http' ? [...entry.headers] : [],
      enabled: entry.enabled ?? true,
      ...entry.timing,
      extra: {},
      pending: [],
    }))
    setArgsText(entry.transport === 'stdio' ? entry.args.join('\n') : '')
    if (hasCustomMcpTiming(entry.timing)) setAdvanced(true)
    setJsonNotice(t('mcp.field.jsonImportApplied', { name: entry.name || entry.rawName || t('mcp.field.jsonImportUnnamed') }))
    setJsonIgnored(entry.ignored)
  }
  const applyJsonImport = () => {
    const parsed = parseMcpJsonSnippet(jsonText)
    setJsonUnsupported('unsupported' in parsed && parsed.unsupported.length > 0)
    if (!parsed.ok) {
      setJsonEntries([])
      setJsonNotice('')
      setJsonIgnored([])
      setJsonError(
        parsed.code === 'empty'
          ? t('mcp.field.jsonImportEmpty')
          : parsed.code === 'invalid-json'
            ? t('mcp.field.jsonImportInvalid')
            : parsed.code === 'no-server' ? t('mcp.field.jsonImportNoServer') : '',
      )
      return
    }
    setJsonError('')
    setJsonEntries(parsed.entries)
    applyJsonEntry(parsed.entries[0]!)
    setJsonText('')
  }
  const convert = (where: string) => {
    const ref = suggestRef(draft.name || 'server', fieldLabel(draft, where), refsTaken)
    const next = convertToCredential(draft, where, ref)
    resetTransientStatus()
    setDraft(next)
    setArgsText(next.args.join('\n'))
  }
  const save = async () => {
    resetTransientStatus()
    setTouched(true)
    if (errors.length > 0) {
      if (errors.some(error => error.field === 'startupTimeoutMs' || error.field === 'toolCallTimeoutMs'
        || error.field === 'closeTimeoutMs' || error.field === 'initialDelayMs'
        || error.field === 'maxDelayMs' || error.field === 'maxAttempts')) {
        setAdvanced(true)
      }
      return
    }
    if (!canSave) return
    const trimmedName = draft.name.trim()
    // Editing only the local description does not need a Settings write or server restart.
    if (row !== null && !isDraftDirty({ ...draft, description: baseline.description }, baseline)) {
      saveMcpDescription(row.name, draft.description, row.name)
      onClose()
      return
    }
    if (requiresCredentials || (row !== null && editRevision === undefined)) return
    setEditorStatus({ status: 'saving' })
    const edit = row !== null && editRevision !== undefined ? { name: row.name, revision: editRevision } : undefined
    const outcome = await controller.save({ ...draft, name: trimmedName }, edit)
    if (outcome.ok) saveMcpDescription(trimmedName, draft.description, row?.name)
    if (!mounted.current) return
    if (outcome.ok) {
      setEditorStatus({ status: 'idle' })
      if (row === null && draft.enabled) {
        const preview = draft.transport === 'stdio'
          ? commandLine(draft.command, draft.args)
          : draft.url.trim()
        const customTimeout = Number(draft.startupTimeoutMs)
        const budgetMs = Math.max(45_000, (Number.isFinite(customTimeout) && customTimeout > 0 ? customTimeout : 30_000) + 15_000)
        tracker.startInstalling({
          serverName: trimmedName,
          isStdio: draft.transport === 'stdio',
          preview,
          budgetMs,
        })
      } else {
        onClose()
      }
    } else if (outcome.conflict) {
      setEditorStatus({ status: 'conflict' })
    } else {
      setEditorStatus({ status: 'error', message: t('mcp.saveFailed', { reason: reasonText(t, outcome.message) }) })
    }
  }
  const retryInstalled = () => {
    const customTimeout = Number(draft.startupTimeoutMs)
    const budgetMs = Math.max(45_000, (Number.isFinite(customTimeout) && customTimeout > 0 ? customTimeout : 30_000) + 15_000)
    return tracker.retry({ isStdio: draft.transport === 'stdio', budgetMs })
  }
  /** Replace the form with the latest entry at the user’s request. */
  const reloadLatest = () => {
    if (latest === undefined || row === null || snapshot.settings === null) return
    const next = draftFromEntry(row.name, latest, getMcpDescription(row.name))
    setBaseline(next)
    setEditRevision(snapshot.settings.revision)
    setDraft(next)
    if (hasCustomMcpTiming(next)) setAdvanced(true)
    setArgsText(next.args.join('\n'))
    setPasteLine('')
    setJsonText('')
    setJsonNotice('')
    setJsonError('')
    setJsonUnsupported(false)
    setJsonIgnored([])
    setJsonEntries([])
    setTrustedLine(null)
    setEditorStatus({ status: 'idle' })
  }
  const nameEditable = row === null || row.source === 'user'
  const modalTitle = tracker.phase.status === 'installing'
    ? t('mcp.featured.installingTitle', { name: tracker.phase.serverName })
    : row === null ? t('mcp.editor.add') : t('mcp.editor.edit', { name: row.name })
  return (
    <Modal open headless title={modalTitle} className="dsh_market_modal dsh_market_modalWide" onClose={requestClose}>
    <div className="dsh_market_directPanel dsh_market_mcpEditor">
      <div className="dsh_market_directHead">
        <div className="dsh_market_installHeading">
          <h3>{modalTitle}</h3>
          {tracker.phase.status !== 'none' && <small>{tracker.phase.serverName}</small>}
        </div>
        <button type="button" className="dsh_market_directClose" aria-label={t('mcp.editor.close')} disabled={saving || tracker.phase.status === 'installing'} onClick={requestClose}>
          <IconCloseOutlineRegular size={16} />
        </button>
      </div>
      {tracker.phase.status !== 'none'
        ? (
          <>
            <McpInstallStatusPanel t={t} phase={tracker.phase} liveStatus={tracker.liveRow?.status} elapsedSec={tracker.elapsedSec} />
            <div className="dsh_market_installFooter dsh_market_mcpModalFooter">
              {tracker.phase.status === 'installing'
                ? (
                  <>
                    {tracker.phase.timedOut && tracker.canRetry
                      ? (
                        <MarketButton size="md" intent="secondary" onClick={() => { void retryInstalled() }}>
                          {t('mcp.featured.retryConnect')}
                        </MarketButton>
                        )
                      : <span />}
                    <div className="dsh_market_mcpModalFooterRight">
                      <MarketButton size="md" intent="primary" onClick={onClose}>
                        {t('mcp.featured.background')}
                      </MarketButton>
                    </div>
                  </>
                  )
                : tracker.phase.status === 'failed'
                  ? (
                    <>
                      <span />
                      <div className="dsh_market_mcpModalFooterRight">
                        <MarketButton size="md" intent="secondary" onClick={onClose}>
                          {t('mcp.featured.close')}
                        </MarketButton>
                        {tracker.canRetry && (
                          <MarketButton size="md" intent="primary" onClick={() => { void retryInstalled() }}>
                            {t('mcp.featured.retryConnect')}
                          </MarketButton>
                        )}
                      </div>
                    </>
                    )
                  : (
                    <>
                      <span />
                      <div className="dsh_market_mcpModalFooterRight">
                        <MarketButton size="md" intent="primary" onClick={onClose}>
                          {t('mcp.featured.done')}
                        </MarketButton>
                      </div>
                    </>
                    )}
            </div>
          </>
          )
        : (
          <>
      {liveRow !== undefined && liveRow.refs.length > 0 && (
        <section className="dsh_market_mcpEditorCreds" aria-label={t('mcp.editor.credentials')}>
          <Credentials t={t} row={liveRow} snapshot={snapshot} controller={controller} />
          <small className="dsh_market_meta">{t('mcp.editor.credentialsHint')}</small>
        </section>
      )}
      <form className="dsh_market_mcpForm" onSubmit={(event) => { event.preventDefault(); void save() }}>
        {(row?.source === 'inherited' || row?.source === 'overridden') && <p className="dsh_market_cardNotice">{t('mcp.editor.inherited')}</p>}
        {row === null && (
          <div className="dsh_market_mcpField dsh_market_mcpJsonImport">
            <span>{t('mcp.field.jsonImport')}</span>
            <small className="dsh_market_meta">{t('mcp.field.jsonImportHint')}</small>
            <textarea
              rows={4}
              spellCheck={false}
              value={jsonText}
              aria-label={t('mcp.field.jsonImport')}
              placeholder={t('mcp.field.jsonImportPlaceholder')}
              onChange={event => {
                resetTransientStatus()
                setJsonError('')
                setJsonText(event.target.value)
              }}
            />
            <div className="dsh_market_mcpJsonActions">
              <button type="button" className="dsh_market_chip" disabled={jsonText.trim() === ''} onClick={applyJsonImport}>
                {t('mcp.field.jsonImportApply')}
              </button>
              {jsonNotice !== '' && <small className="dsh_market_meta">{jsonNotice}</small>}
            </div>
            {jsonError !== '' && <span className="dsh_market_cardError">{jsonError}</span>}
            {jsonUnsupported && <span className="dsh_market_cardNotice" role="status">{t('mcp.field.jsonImportUnsupported')}</span>}
            {jsonIgnored.length > 0 && <span className="dsh_market_cardNotice" role="status">{t('mcp.field.jsonImportIgnored', { fields: jsonIgnored.join(', ') })}</span>}
            {jsonEntries.length > 1 && (
              <div className="dsh_market_mcpJsonPick">
                <small className="dsh_market_meta">{t('mcp.field.jsonImportMulti', { count: String(jsonEntries.length) })}</small>
                <div className="dsh_market_skillBadges">
                  {jsonEntries.map((entry, index) => (
                    <button
                      key={`${entry.rawName}-${index}`}
                      type="button"
                      className="dsh_market_chip"
                      onClick={() => applyJsonEntry(entry)}
                    >
                      {entry.rawName || entry.name || `#${index + 1}`}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <label className="dsh_market_mcpField">
          <span>{t('mcp.field.name')}</span>
          <input value={draft.name} spellCheck={false} disabled={!nameEditable} maxLength={32}
            onChange={event => set({ name: event.target.value })} />
          <small className="dsh_market_meta">{t('mcp.field.nameHint')}</small>
          {errorOf('name') && <span className="dsh_market_cardError">{errorOf('name')}</span>}
        </label>
        <label className="dsh_market_mcpField">
          <span>{t('mcp.field.description')}</span>
          <input value={draft.description} maxLength={300} placeholder={t('mcp.field.descriptionPlaceholder')}
            onChange={event => set({ description: event.target.value })} />
          <small className="dsh_market_meta">{t('mcp.field.descriptionHint')}</small>
        </label>
        <div className="dsh_market_mcpField" role="radiogroup" aria-label={t('mcp.field.transport')}>
          <span>{t('mcp.field.transport')}</span>
          <div className="dsh_market_scope">
            {(['stdio', 'streamable-http'] as const).map(transport => (
              <button key={transport} type="button" className="dsh_market_scopeButton" role="radio"
                aria-checked={draft.transport === transport} aria-pressed={draft.transport === transport}
                onClick={() => set({ transport })}>
                {transportLabel(t, transport)}
              </button>
            ))}
          </div>
        </div>
        {draft.transport === 'stdio'
          ? (
            <>
              <div className="dsh_market_mcpField">
                <span>{t('mcp.field.paste')}</span>
                <div className="dsh_market_mcpPair">
                  <input value={pasteLine} spellCheck={false} placeholder="npx -y @modelcontextprotocol/server-everything"
                    aria-label={t('mcp.field.paste')} onChange={event => { resetTransientStatus(); setPasteLine(event.target.value) }} />
                  <button type="button" className="dsh_market_chip" disabled={pasteLine.trim() === ''} onClick={applyPaste}>
                    {t('mcp.field.pasteApply')}
                  </button>
                </div>
              </div>
              <label className="dsh_market_mcpField">
                <span>{t('mcp.field.command')}</span>
                <input value={draft.command} spellCheck={false} onChange={event => set({ command: event.target.value })} />
                {errorOf('command') && <span className="dsh_market_cardError">{errorOf('command')}</span>}
              </label>
              <label className="dsh_market_mcpField">
                <span>{t('mcp.field.args')}</span>
                <textarea rows={Math.min(8, Math.max(3, draft.args.length + 1))} spellCheck={false} value={argsText}
                  onChange={event => setArgs(event.target.value)} />
              </label>
              <label className="dsh_market_mcpField">
                <span>{t('mcp.field.cwd')}</span>
                <input value={draft.cwd} spellCheck={false} onChange={event => set({ cwd: event.target.value })} />
              </label>
              <PairsField t={t} label={t('mcp.field.env')} pairs={draft.env} onChange={env => set({ env })} error={errorOf('env')} />
            </>
            )
          : (
            <>
              <label className="dsh_market_mcpField">
                <span>{t('mcp.field.url')}</span>
                <input value={draft.url} spellCheck={false} placeholder="https://example.com/mcp" onChange={event => set({ url: event.target.value })} />
                {errorOf('url') && <span className="dsh_market_cardError">{errorOf('url')}</span>}
              </label>
              <PairsField t={t} label={t('mcp.field.headers')} hint={t('mcp.field.headersHint')} pairs={draft.headers} onChange={headers => set({ headers })} error={errorOf('headers')} />
            </>
            )}
        {plaintext.length > 0 && (
          <div className="dsh_market_mcpSecrets" role="status">
            <p>{t(requiresCredentials ? 'mcp.field.secretsRequired' : 'mcp.field.secrets')}</p>
            <ul>
              {plaintext.map(where => (
                <li key={where}>
                  <code>{where}</code>
                  <button type="button" className="dsh_market_chip" onClick={() => convert(where)}>{t('mcp.field.convert')}</button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {pendingToStore(draft).length > 0 && (
          <ul className="dsh_market_mcpPending">
            {pendingToStore(draft).map(secret => <li key={secret.ref} className="dsh_market_meta">{t('mcp.field.pending', { ref: secret.ref })}</li>)}
          </ul>
        )}
        {touched && errors.filter(error => error.field === 'template').map(error => (
          <p key={(error as { where: string }).where} className="dsh_market_cardError">{errorText(t, error)}</p>
        ))}
        <label className="dsh_market_mcpCheck">
          <input type="checkbox" checked={draft.enabled} onChange={event => set({ enabled: event.target.checked })} />
          <span>{t('mcp.field.enabled')}</span>
        </label>
        {!draft.enabled && <small className="dsh_market_meta">{t('mcp.field.enabledHint')}</small>}
        <details className="dsh_market_installDetails" open={advanced} onToggle={event => setAdvanced((event.target as HTMLDetailsElement).open)}>
          <summary>{t('mcp.field.advanced')}</summary>
          <div className="dsh_market_installDetailsBody dsh_market_mcpForm">
            <label className="dsh_market_mcpField">
              <span>{t('mcp.field.startup')}</span>
              <input inputMode="numeric" value={draft.startupTimeoutMs} onChange={event => set({ startupTimeoutMs: event.target.value })} />
              {errorOf('startupTimeoutMs') && <span className="dsh_market_cardError">{errorOf('startupTimeoutMs')}</span>}
            </label>
            <label className="dsh_market_mcpField">
              <span>{t('mcp.field.toolCall')}</span>
              <input inputMode="numeric" value={draft.toolCallTimeoutMs} onChange={event => set({ toolCallTimeoutMs: event.target.value })} />
              {errorOf('toolCallTimeoutMs') && <span className="dsh_market_cardError">{errorOf('toolCallTimeoutMs')}</span>}
            </label>
            <label className="dsh_market_mcpField">
              <span>{t('mcp.field.closeTimeout')}</span>
              <input inputMode="numeric" value={draft.closeTimeoutMs} placeholder={String(DEFAULT_CLOSE_MS)} onChange={event => set({ closeTimeoutMs: event.target.value })} />
              {errorOf('closeTimeoutMs') && <span className="dsh_market_cardError">{errorOf('closeTimeoutMs')}</span>}
            </label>
            <label className="dsh_market_mcpCheck">
              <input type="checkbox" checked={draft.reconnectEnabled} onChange={event => set({ reconnectEnabled: event.target.checked })} />
              <span>{t('mcp.field.reconnect')}</span>
            </label>
            {!draft.reconnectEnabled && <small className="dsh_market_meta">{t('mcp.field.reconnectOff')}</small>}
            <div className="dsh_market_mcpFieldRow">
              {([['initialDelayMs', 'mcp.field.initialDelay'], ['maxDelayMs', 'mcp.field.maxDelay'], ['maxAttempts', 'mcp.field.maxAttempts']] as const).map(([field, label]) => (
                <label key={field} className="dsh_market_mcpField">
                  <span>{t(label)}</span>
                  <input inputMode="numeric" value={draft[field]} disabled={!draft.reconnectEnabled}
                    placeholder={String(RECONNECT_DEFAULTS[field])} onChange={event => set({ [field]: event.target.value })} />
                  {errorOf(field) && <span className="dsh_market_cardError">{errorOf(field)}</span>}
                </label>
              ))}
            </div>
          </div>
        </details>
        {needsTrust && (
          <div className="dsh_market_mcpRisk" role="note">
            <p>{t('mcp.risk.title')}</p>
            <pre className="dsh_market_directMessage">{line}</pre>
            {risks.includes('fetch') && <p className="dsh_market_cardNotice" data-warning="true">{t('mcp.risk.fetch')}</p>}
            {risks.includes('shell') && <p className="dsh_market_cardNotice" data-warning="true">{t('mcp.risk.shell')}</p>}
            <label className="dsh_market_mcpCheck">
              <input type="checkbox" checked={trusted} onChange={event => { resetTransientStatus(); setTrustedLine(event.target.checked ? line : null) }} />
              <span>{t('mcp.risk.confirm')}</span>
            </label>
          </div>
        )}
        {row !== null && isEnabled(row) && draft.enabled && <p className="dsh_market_cardNotice">{t('mcp.rebuild')}</p>}
        {saveError !== '' && <p className="dsh_market_cardError" role="alert">{saveError}</p>}
        {conflict && latest !== undefined && (
          <MarketButton intent="secondary" className="dsh_market_mcpReload" disabled={saving} onClick={reloadLatest}>
            {t('mcp.editor.reload')}
          </MarketButton>
        )}
        <div className="dsh_market_installFooter" ref={footerRef}>
          {confirmDiscard
            ? (
              <>
                <span className="dsh_market_cardNotice" role="status">{t('mcp.editor.unsaved')}</span>
                <MarketButton ref={keepEditingRef} size="md" intent="secondary" disabled={saving} onClick={keepEditing}>
                  {t('mcp.editor.keepEditing')}
                </MarketButton>
                <MarketButton size="md" intent="danger" disabled={saving} onClick={onClose}>
                  {t('mcp.editor.discard')}
                </MarketButton>
              </>
              )
            : (
              <>
                <MarketButton size="md" intent="secondary" disabled={saving} onClick={requestClose}>{t('mcp.cancel')}</MarketButton>
                <MarketButton size="md" type="submit" intent="primary" disabled={!canSave || requiresCredentials}>{saving ? t('mcp.saving') : t('mcp.save')}</MarketButton>
              </>
              )}
        </div>
      </form>
          </>
          )}
    </div>
    </Modal>
  )
}
