import { IconInfoOutlineRegular, Switch, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { MarketButton } from './MarketButton.tsx'
import type { DirectInstaller } from './directInstall.ts'
import { loadingProgressOf } from './catalogCache.ts'
import { MarketSelector } from './InstallModeSelector.tsx'
import { DirectInstallPanel } from './DirectInstallPanel.tsx'
import { ManualInstallPanel } from './ManualInstallPanel.tsx'
import { officialBundleDisplay, type HostBundleInfo, type OfficialBundlesController } from './officialBundles.ts'
import type { DirectoryBrowserController } from './directoryBrowser.ts'
import { DirectoryBrowserPanel } from './DirectoryBrowserPanel.tsx'
import type { PluginUpdater } from './pluginUpdates.ts'
import { PluginUpdatePanel } from './PluginUpdatePanel.tsx'
import { BatchUpdatePanel } from './BatchUpdatePanel.tsx'
import type { SkillsSessionSource } from './skillsSubscription.ts'
/**
 * The shared Marketplace surface, with Plugins and Skills pages.
 *
 * **Plugins** offers editorial picks and the full repository catalog by
 * default. The host configuration can disable catalog access. Cards use
 * official Host installation, with optional read-only review of installed artifacts.
 *
 * **Skills** is what this deployment can already resolve. It needs neither the
 * switch nor the network.
 *
 * Each host supplies a close callback to reveal the conversation after staging.
 */
import {
  useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent, type ReactElement,
} from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type {
  DeleteInstalledSkillRequest,
  DeleteInstalledSkillResult,
  FeaturedSkillInstallScope,
  InstallFeaturedSkillRequest,
  InstallFeaturedSkillResult,
  MarketCatalog,
  MarketInstalledPackage,
  MarketInstalledResult,
  MarketPlugin,
  MarketSkillsResult,
  SafeMarketSettings,
  SafeMarketSettingsUpdate,
} from '../contract.ts'
import { FEATURED_CATEGORY, PACKAGE_NAME, SUBSCRIPTION_CATEGORY, isSafeVersion } from '../shapes.ts'
import type { MarketLocale } from './copy.ts'
import { catalogIndexForInstalled, hasRemainingTargets, ownedBy, ownedIndexOf, shortName } from './owned.ts'
import {
  INSTALLED_FILTER, OFFICIAL_EXPERIMENTAL_FILTER, SELF_CARD_KEY, allCatalogMatchCount, featuredRows, installedReviewCardKey, marketKey, marketRows, matches, pageOf, sortMarketRows, starCount, stateOf, type MarketSort,
} from './rows.ts'
import { SkillsView } from './SkillsView.tsx'
import type { FeaturedSkill } from '../skillsFeatured.ts'
import { McpView, type McpToolbarActions } from './McpView.tsx'
import { SettingsView } from './SettingsView.tsx'
import type { McpController } from './mcpController.ts'
import { BackToTop, scrollResultsContainerToTop } from './BackToTop.tsx'
import { StarPromptCard } from './StarPromptCard.tsx'
import {
  STAR_PROMPT_STORAGE_KEY,
  STAR_REPOSITORY_URL,
  STAR_SETTLED_EVENT,
  recordMarketOpen,
  settleStarPrompt,
  starPromptPending,
} from './starPrompt.ts'
import { PluginLogo } from './PluginLogo.tsx'
import { buildInstallPrompt, buildReviewPrompt, type ReviewTarget } from './reviewPrompt.ts'
import { useSearchDock } from './useSearchDock.ts'

/** The live snapshot the section renders from: the switch plus the deployment facts. */
export interface SafeMarketSnapshot {
  readonly value: SafeMarketSettings
  /** Wait for the host's persisted catalog preference before loading. */
  readonly settingsReady: boolean
  /** Current instance profile; reviews stay disabled until the Host confirms it. */
  readonly profile: string | null
  /** The market's own version, from the same `describe`; '' until it answers. */
  readonly version: string
  /** True when Host/process environment variables suppress telemetry. */
  readonly telemetrySuppressedByEnv?: boolean
}
export type SafeMarketSource = ObservableSnapshot<SafeMarketSnapshot>

/** What the review hand-off reports back to the card that asked for it. */
export type InstallOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'not-ready' }
  | { readonly ok: false; readonly reason: 'no-workspace' }
  | { readonly ok: false; readonly reason: 'draft-exists' }
  | { readonly ok: false; readonly reason: 'cancelled' }
  | { readonly ok: false; readonly reason: 'failed'; readonly message: string }

/** What registering a directory as a Workspace reports back. */
export type ChooseWorkspaceOutcome =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: 'cancelled' }
  | { readonly ok: false; readonly reason: 'failed'; readonly message: string }

/**
 * Whether this deployment has a Workspace for an AI review.
 *
 * `pending` is its own answer rather than a flavour of `none`: for the first
 * moments of a boot the list mirror is legitimately empty, and telling someone
 * with a dozen workspaces that they have none is worse than saying nothing.
 */
export type WorkspaceReadiness = 'pending' | 'none' | 'present'

/** Injected business face: the live source and the section's verbs. */
export interface MarketSectionInjected {
  directInstaller?: DirectInstaller
  officialBundles?: OfficialBundlesController
  pluginUpdater?: PluginUpdater
  hooks: { scope: SafeMarketSource }
  /** Persist one marketplace setting field and return the updated snapshot. */
  updateSettings?: (update: SafeMarketSettingsUpdate) => Promise<SafeMarketSettings>
  /** Read the reduced catalog; `force` bypasses the refresh interval. */
  loadCatalog: (force: boolean) => Promise<{ catalog: MarketCatalog | null; stale: boolean; error: string }>
  /** Synchronously read the last cached catalog in this client, if any. */
  peekCatalog?: () => { catalog: MarketCatalog | null; stale: boolean; error: string } | null
  /** Read the skills this deployment resolves. */
  listSkills: () => Promise<MarketSkillsResult>
  skillsSession: SkillsSessionSource
  /** Directly install one allowlisted curated Agent Skill on the Host. */
  installFeaturedSkill?: (request: InstallFeaturedSkillRequest, signal?: AbortSignal) => Promise<InstallFeaturedSkillResult>
  /** Safely delete one locally installed user/project Agent Skill directory on the Host. */
  deleteInstalledSkill?: (request: DeleteInstalledSkillRequest) => Promise<DeleteInstalledSkillResult>
  /** Whether the Host can open a folder on its desktop at all. */
  canOpenFolder: () => Promise<boolean>
  /** Open one skill's directory in the Host's file manager. */
  openFolder: (path: string) => Promise<void>
  /** Open a session in the current or most recent workspace and stage the given prompt. */
  install: (prompt: string) => Promise<InstallOutcome>
  /**
   * The same hand-off for someone who has no workspace yet: pick a directory
   * through the Host's own picker, register it, then stage the prompt in it.
   */
  installIntoNewWorkspace: (
    prompt: string,
    options?: { readonly preferDefault?: boolean; readonly ownerId?: string },
  ) => Promise<InstallOutcome>
  /** Pick a directory and register it as a Workspace, installing nothing. */
  chooseWorkspace: (ownerId?: string) => Promise<ChooseWorkspaceOutcome>
  /** In-app directory browser controller used when the Host serves `"browse"` (e.g. DSH-go). */
  directoryBrowser?: DirectoryBrowserController
  /** Live answer to "is there a workspace for review?". */
  workspaceReadiness: {
    getSnapshot: () => WorkspaceReadiness
    subscribe: (fn: () => void) => () => void
  }
  /** Read the plugins installed into this profile, with live enable state. */
  listInstalled: () => Promise<MarketInstalledResult>
  subscribeInstalledChanges?: (listener: () => void) => () => void
  /** Enable or disable one installed package (durable and immediate). */
  setInstalledEnabled: (packageName: string, enabled: boolean) => Promise<MarketInstalledResult>
  /** Uninstall one installed package (stops now, finishes on restart). */
  uninstallInstalled: (packageName: string) => Promise<MarketInstalledResult>
  /** The MCP page's store; absent where the client cannot mount it. */
  mcp?: McpController
}

/** Full section props: runtime share + injected face + locale seat. */
export type MarketSectionProps =
  { close: () => void }
  & InjectFace<MarketSectionInjected>
  & PropsLocale<'settings.dshMarketPro'>

type CatalogState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly catalog: MarketCatalog; readonly stale: boolean }
  | { readonly status: 'error'; readonly message: string }

type CardState =
  | { readonly status: 'busy' }
  /** The Host's directory picker is open for this card. */
  | { readonly status: 'picking' }
  /** The review is one directory choice away; the card offers to make it. */
  | { readonly status: 'needs-workspace'; readonly message: string }
  | { readonly status: 'staged' }
  | { readonly status: 'error'; readonly message: string }

type Page = 'plugins' | 'skills' | 'mcp' | 'settings'
type RefreshPage = 'plugins' | 'skills' | 'mcp'
const AI_PICK_CARD_KEY = 'dsh:ai-pick'

/** Page-owned refresh button hoisted into the shared section header. */
export interface HeaderRefreshAction {
  readonly label: string
  readonly busy: boolean
  readonly disabled: boolean
  readonly onClick: () => void
}

type InstalledState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly result: MarketInstalledResult }
  | { readonly status: 'error'; readonly message: string }

type InstalledActionState =
  | { readonly status: 'idle' }
  | { readonly status: 'confirming-uninstall'; readonly packageName: string }
  | { readonly status: 'toggling'; readonly packageName: string }
  | { readonly status: 'uninstalling'; readonly packageName: string }

type InstalledFeedback =
  | { readonly status: 'none' }
  | { readonly status: 'notice'; readonly message: string }
  | { readonly status: 'error'; readonly message: string }

type WorkspacePickState =
  | { readonly status: 'idle' }
  | { readonly status: 'picking' }
  | { readonly status: 'error'; readonly message: string }

type MarketOverlay =
  | { readonly kind: 'none' }
  | { readonly kind: 'direct-install'; readonly item: MarketPlugin }
  | { readonly kind: 'manual-install' }
  | { readonly kind: 'update' }
  | { readonly kind: 'batch-update' }

/**
 * The installed set's own state and verbs: the plugins installed into this
 * profile, with enable/disable and uninstall. It is local profile facts all
 * the way down — reading them reaches nothing outside this machine, so this
 * answers with the market off too.
 *
 * A hook rather than a panel because the count belongs to the filter chip and
 * the rows belong to the same card grid the catalog uses: one list of cards,
 * one of whose filters happens to be "the ones I already have".
 */
function useInstalled({ t, active, listInstalled, subscribeInstalledChanges, setInstalledEnabled, uninstallInstalled }: {
  t: MarketLocale
  /**
   * Whether the panel is on screen at all. The read is local and cheap, but
   * with the market off there is nothing rendering it — and a read fired for
   * a panel nobody is looking at would report its failures into a page whose
   * only job is to explain the switch.
   */
  active: boolean
  listInstalled: MarketSectionInjected['listInstalled']
  subscribeInstalledChanges?: MarketSectionInjected['subscribeInstalledChanges']
  setInstalledEnabled: MarketSectionInjected['setInstalledEnabled']
  uninstallInstalled: MarketSectionInjected['uninstallInstalled']
}): {
  state: InstalledState
  action: InstalledActionState
  feedback: InstalledFeedback
  count: number
  reload: () => void
  refresh: () => void
  toggle: (item: MarketInstalledPackage) => void
  uninstall: (item: MarketInstalledPackage) => void
  requestUninstall: (name: string) => void
  cancelUninstall: () => void
} {
  const [state, setState] = useState<InstalledState>({ status: 'loading' })
  const [action, setAction] = useState<InstalledActionState>({ status: 'idle' })
  const [feedback, setFeedback] = useState<InstalledFeedback>({ status: 'none' })
  const mounted = useRef(true)
  // Set on mount as well as cleared on unmount: React 18 StrictMode runs the
  // cleanup once immediately after the first mount, and a ref that is only
  // ever cleared would stay false for the rest of the component's life —
  // every async answer below would then be silently dropped.
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  // The read's generation. `mounted` answers "is this component still here?";
  // this answers the separate "is this still the read whose answer we want?".
  // StrictMode dispatches the mount read twice, and a verb below can land a
  // fresher list while an earlier read is still in flight — without a token
  // the older answer resolves last and overwrites the newer one. Each read
  // captures the value it bumped to; a verb that writes fresh state advances
  // it too, retiring any read that has not yet returned.
  const readSeq = useRef(0)

  const load = useCallback((): void => {
    if (!active) return
    const seq = (readSeq.current += 1)
    setState(previous => (previous.status === 'ready' ? previous : { status: 'loading' }))
    void listInstalled().then((result) => {
      if (!mounted.current || seq !== readSeq.current) return
      setState({ status: 'ready', result })
    }, (error: unknown) => {
      if (!mounted.current || seq !== readSeq.current) return
      setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    })
  }, [active, listInstalled])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (active) return subscribeInstalledChanges?.(load)
  }, [active, load, subscribeInstalledChanges])

  const describe = (error: unknown): string => error instanceof Error ? error.message : String(error)

  const toggle = (item: MarketInstalledPackage): void => {
    setAction({ status: 'toggling', packageName: item.packageName })
    // A new action retires the last outcome line, whatever it said.
    setFeedback({ status: 'none' })
    void setInstalledEnabled(item.packageName, !item.enabled).then((result) => {
      if (!mounted.current) return
      // This verb's own list is the fresh one; retire any read still in flight.
      readSeq.current += 1
      setAction({ status: 'idle' })
      setState({ status: 'ready', result })
      if (result.restartRequired) setFeedback({ status: 'notice', message: t('installed.restartRequired') })
    }, (error: unknown) => {
      if (!mounted.current) return
      setAction({ status: 'idle' })
      setFeedback({ status: 'error', message: t('installed.actionFailed', { reason: describe(error) }) })
      // The durable half may have landed even when the live half reports a
      // failure — refresh in place without blanking the rendered cards.
      load()
    })
  }

  const uninstall = (item: MarketInstalledPackage): void => {
    setAction({ status: 'uninstalling', packageName: item.packageName })
    setFeedback({ status: 'none' })
    void uninstallInstalled(item.packageName).then((result) => {
      if (!mounted.current) return
      // This verb's own list is the fresh one; retire any read still in flight.
      readSeq.current += 1
      setAction({ status: 'idle' })
      // The host may have an outcome line of its own (e.g. the in-session
      // stop failed and the plugin runs until the next restart) — prefer it
      // over the default success copy.
      const faults = result.notice ?? ''
      const message = result.restartRequired
        ? t('installed.restartRequired') + (faults === '' ? '' : ` ${faults}`)
        : faults === ''
          ? t('installed.uninstalled', { name: item.packageName })
          : t(
              result.noticeKind === 'may-run' ? 'installed.uninstalledMayRun' : 'installed.uninstalledWithFaults',
              { name: item.packageName, faults },
            )
      setFeedback({ status: 'notice', message })
      setState({ status: 'ready', result })
    }, (error: unknown) => {
      if (!mounted.current) return
      setAction({ status: 'idle' })
      setFeedback({ status: 'error', message: t('installed.actionFailed', { reason: describe(error) }) })
      load()
    })
  }

  const requestUninstall = useCallback((packageName: string): void => {
    setAction(previous => (previous.status === 'toggling' || previous.status === 'uninstalling'
      ? previous
      : { status: 'confirming-uninstall', packageName }))
  }, [])

  const cancelUninstall = useCallback((): void => {
    setAction(previous => (previous.status === 'confirming-uninstall' ? { status: 'idle' } : previous))
  }, [])

  const reload = useCallback((): void => {
    setState({ status: 'loading' })
    setAction(previous => (previous.status === 'confirming-uninstall' ? { status: 'idle' } : previous))
    setFeedback({ status: 'none' })
    load()
  }, [load])

  const count = state.status === 'ready' && state.result.error === '' ? state.result.packages.length : 0
  return { state, action, feedback, count, reload, refresh: load, toggle, uninstall, requestUninstall, cancelUninstall }
}

function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!active) { setSeconds(0); return }
    const startedAt = Date.now()
    setSeconds(0)
    const timer = window.setInterval(() => {
      setSeconds(Math.max(1, Math.floor((Date.now() - startedAt) / 1000)))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [active])
  return seconds
}

function UninstallProgressFooter({ t, name, onRefresh }: {
  t: MarketLocale
  name: string
  onRefresh: () => void
}): ReactElement {
  const elapsed = useElapsedSeconds(true)
  return (
    <>
      <span className="dsh_market_cardNotice" aria-live="polite">
        {elapsed >= 15 ? t('installed.uninstallingSlow') : t('installed.uninstallingHint', { name })}
      </span>
      {elapsed >= 30 && (
        <MarketButton intent="secondary" onClick={onRefresh}>
          {t('installed.refreshStatus')}
        </MarketButton>
      )}
      <MarketButton intent="danger" disabled aria-busy="true">
        <span className="dsh_market_inlineSpinner" aria-hidden="true" />
        {elapsed >= 3 ? `${t('installed.uninstalling')} ${elapsed}s` : t('installed.uninstalling')}
      </MarketButton>
    </>
  )
}

/**
 * One installed package, in the same card the catalog rows use — so the grid
 * stays one grid and the eye does not have to re-learn the layout when the
 * filter changes.
 */
function InstalledCard({ t, english, item, matched, installed, snapshot, card, installBusy, readiness, onReview, onCheckUpdate, availableVersion }: {
  t: MarketLocale
  english: boolean
  item: MarketInstalledPackage
  matched?: MarketPlugin
  installed: ReturnType<typeof useInstalled>
  snapshot: SafeMarketSnapshot
  card: CardState | undefined
  installBusy: boolean
  readiness: WorkspaceReadiness
  onReview: (item: MarketInstalledPackage, viaNewWorkspace: boolean) => void
  onCheckUpdate?: (packageName: string) => void
  availableVersion?: string
}): ReactElement {
  const { action, refresh, requestUninstall, cancelUninstall, toggle, uninstall } = installed
  const anyBusy = action.status === 'toggling' || action.status === 'uninstalling'
  const toggling = action.status === 'toggling' && action.packageName === item.packageName
  const uninstalling = action.status === 'uninstalling' && action.packageName === item.packageName
  const busyRow = toggling || uninstalling
  const confirmRow = (action.status === 'confirming-uninstall' && action.packageName === item.packageName) || uninstalling
  const reviewNeedsWorkspace = card?.status === 'needs-workspace' || (readiness === 'none' && card === undefined)
  const reviewDisabled = anyBusy || installBusy || snapshot.profile === null

  const reviewTitle = snapshot.profile === null ? t('install.profilePending') : undefined
  const stateLabels: Record<ReturnType<typeof stateOf>, string> = {
    running: t('installed.running'),
    disabled: t('installed.disabled'),
    failed: t('installed.failedState'),
    readFailed: t('installed.readFailedState'),
    installed: t('installed.installedState'),
    unregistered: t('installed.unregisteredState'),
  }
  const localTitle = english ? item.titleEn : item.titleZh
  const localDesc = english ? item.descriptionEn : item.descriptionZh
  const displayName = localTitle || (english ? matched?.titleEn : matched?.titleZh) || shortName(item.packageName)
  const repoSlug = item.repository || matched?.fullName || ''
  const categoryLabel = matched !== undefined ? (english ? matched.categoryEn : matched.categoryZh) : ''
  const catalogDesc = matched === undefined ? '' : (english ? matched.descriptionEn || matched.description : matched.description)
  const description = localDesc || catalogDesc || item.description
  return (
    <li className="dsh_market_card dsh_market_installedCard" data-confirming={confirmRow ? 'true' : undefined}>
      <div className="dsh_market_head">
        <PluginLogo src={item.icon ?? matched?.icon} name={displayName} fullName={repoSlug || undefined} />
        <div className="dsh_market_identity">
          <span className="dsh_market_name" title={displayName}>{displayName}</span>
          <span className="dsh_market_packageName" title={item.packageName}>{item.packageName}</span>
        </div>
        <span className="dsh_market_installedState" data-state={stateOf(item)}>{stateLabels[stateOf(item)]}</span>
      </div>
      <div className="dsh_market_meta dsh_market_skillBadges">
        {categoryLabel !== '' && <span className="dsh_market_categoryTag">{categoryLabel}</span>}
        {item.version !== '' && <span className="dsh_market_categoryTag">{`v${item.version}`}</span>}
        {item.self && <span className="dsh_market_categoryTag">{t('installed.self')}</span>}
        {item.inBox && (
          <span className="dsh_market_categoryTag">
            {t('installed.inBox')}
            <Tooltip label={t('installed.inBoxNotice')} side="top" portal openOnClick maxWidth={280}>
              <span className="dsh_market_hint" tabIndex={0} aria-label={t('installed.inBoxNotice')}>
                <IconInfoOutlineRegular size={13} />
              </span>
            </Tooltip>
          </span>
        )}
        {item.unregistered && (
          <span className="dsh_market_categoryTag">
            {t('installed.unregistered')}
            <Tooltip label={t('installed.unregisteredNotice')} side="top" portal openOnClick maxWidth={280}>
              <span className="dsh_market_hint" tabIndex={0} aria-label={t('installed.unregisteredNotice')}>
                <IconInfoOutlineRegular size={13} />
              </span>
            </Tooltip>
          </span>
        )}
        {/* The repository identity has already been reduced to owner/name by
            the Host. Keep the link at the right end of the badge row instead
            of spending a full action-button seat on it. */}
        {repoSlug !== '' && (
          <Tooltip label={`${t('repo')}: ${repoSlug}`} side="top" portal>
            <a
              className="dsh_market_repoIcon"
              href={`https://github.com/${repoSlug}`}
              target="_blank"
              rel="noreferrer"
              aria-label={`${t('repo')}: ${repoSlug}`}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.77 2.72 1.26 3.38.96.1-.75.4-1.26.74-1.55-2.57-.29-5.27-1.28-5.27-5.68 0-1.26.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.16 1.18A10.98 10.98 0 0 1 12 6.16c.98 0 1.94.13 2.86.38 2.2-1.49 3.16-1.18 3.16-1.18.63 1.58.23 2.75.11 3.04.74.8 1.19 1.82 1.19 3.08 0 4.41-2.71 5.38-5.29 5.67.42.36.79 1.06.79 2.14v3.26c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
              </svg>
            </a>
          </Tooltip>
        )}
      </div>
      {description !== '' && <p className="dsh_market_desc" title={description}>{description}</p>}
      {item.error !== '' && <p className="dsh_market_cardError">{t('installed.readFailed', { reason: item.error })}</p>}
      {item.heldDown && item.entries.length > 0
        && <p className="dsh_market_cardNotice">{t('installed.heldDown')}</p>}
      {card?.status === 'error' && <p className="dsh_market_cardError">{card.message}</p>}
      {card?.status === 'needs-workspace' && <p className="dsh_market_cardNotice">{card.message}</p>}
      <div className="dsh_market_foot">
        {uninstalling
          ? <UninstallProgressFooter t={t} name={shortName(item.packageName)} onRefresh={refresh} />
          : confirmRow
            ? (
              <>
                <span className="dsh_market_cardNotice" aria-live="polite">
                  {t('installed.confirmUninstall', { name: shortName(item.packageName) })}
                </span>
                <MarketButton
                  intent="danger"
                  disabled={busyRow}
                  onClick={() => { uninstall(item) }}
                >
                  {t('installed.confirm')}
                </MarketButton>
                <MarketButton
                  intent="secondary"
                  disabled={busyRow}
                  onClick={cancelUninstall}
                >
                  {t('installed.cancel')}
                </MarketButton>
              </>
              )
          : (
            <>
              {onCheckUpdate && <MarketButton intent={availableVersion ? 'primary' : 'secondary'}
                disabled={anyBusy || installBusy || item.error !== ''}
                onClick={() => onCheckUpdate(item.packageName)}>
                {availableVersion ? t('update.to', { version: availableVersion }) : t('update.check')}
              </MarketButton>}
              <MarketButton
                intent="secondary"
                disabled={reviewDisabled}
                title={reviewTitle}
                onClick={() => { onReview(item, reviewNeedsWorkspace) }}
              >
                {card?.status === 'picking'
                  ? t('install.picking')
                  : card?.status === 'busy'
                    ? t('installing')
                    : reviewNeedsWorkspace ? t('installed.pickAndReview') : t('installed.review')}
              </MarketButton>
              {!item.self && !item.unregistered && (
                <MarketButton
                  intent="secondary"
                  disabled={busyRow || anyBusy || installBusy || (item.error !== ''
                    // An unreadable package can still be switched off by the Host, never on.
                    ? item.bundleEnabled !== true
                    : item.bundleEnabled === undefined && item.entries.length === 0)}
                  onClick={() => { toggle(item) }}
                >
                  {toggling
                    ? (item.enabled ? t('installed.disabling') : t('installed.enabling'))
                    : (item.enabled ? t('installed.disable') : t('installed.enable'))}
                </MarketButton>
              )}
              <MarketButton
                intent="danger"
                disabled={busyRow || anyBusy || installBusy}
                onClick={() => { requestUninstall(item.packageName) }}
              >
                {t('installed.uninstall')}
              </MarketButton>
            </>
            )}
      </div>
    </li>
  )
}

function MarketEmptyState({ icon, badge, title, description, primaryAction, secondaryAction }: {
  icon: 'scope' | 'search' | 'installed' | 'error'
  badge?: string
  title: string
  description: string
  primaryAction?: { label: string; count?: number; arrow?: boolean; onClick: () => void }
  secondaryAction?: { label: string; onClick: () => void }
}): ReactElement {
  return (
    <div className="dsh_market_empty" role="status" aria-live="polite">
      <div className="dsh_market_emptyIcon" aria-hidden="true">
        {icon === 'scope' && (
          <svg viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m20 20-4.2-4.2" />
            <path d="M11 8.5v5M8.5 11h5" />
          </svg>
        )}
        {icon === 'search' && (
          <svg viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m20 20-4.2-4.2" />
            <path d="M8.8 11h4.4" />
          </svg>
        )}
        {icon === 'installed' && (
          <svg viewBox="0 0 24 24">
            <path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z" />
            <path d="M4 7.5 12 12l8-4.5M12 12v9" />
          </svg>
        )}
        {icon === 'error' && (
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 8.2v4.6M12 16h.01" />
          </svg>
        )}
      </div>
      {badge !== undefined && <span className="dsh_market_emptyBadge">{badge}</span>}
      <h3 className="dsh_market_emptyTitle">{title}</h3>
      <p className="dsh_market_emptyDesc">{description}</p>
      {(primaryAction !== undefined || secondaryAction !== undefined) && (
        <div className="dsh_market_emptyActions">
          {primaryAction !== undefined && (
            <MarketButton intent="primary" size="md" className="dsh_market_emptyAction" onClick={primaryAction.onClick}>
              <span>{primaryAction.label}</span>
              {primaryAction.count !== undefined && <span className="dsh_market_emptyCount">{primaryAction.count}</span>}
              {primaryAction.arrow && (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 12h14m-5-5 5 5-5 5" />
                </svg>
              )}
            </MarketButton>
          )}
          {secondaryAction !== undefined && (
            <MarketButton intent="secondary" size="md" className="dsh_market_emptyAction" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </MarketButton>
          )}
        </div>
      )}
    </div>
  )
}

function MarketLoadingState({ t, mode, installedCount = 0, onViewInstalled }: {
  t: MarketLocale
  mode: 'settings' | 'catalog'
  installedCount?: number
  onViewInstalled?: () => void
}): ReactElement {
  const [elapsedMs, setElapsedMs] = useState(0)
  useEffect(() => {
    const startedAt = Date.now()
    setElapsedMs(0)
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt)
    }, 250)
    return () => window.clearInterval(timer)
  }, [mode])
  const progress = mode === 'settings'
    ? { percent: Math.min(24, Math.round(10 + (elapsedMs / 1_500) * 14)), stage: 'connect' as const }
    : loadingProgressOf(elapsedMs)
  const stageLabel = mode === 'settings'
    ? t('loading.stage.settings')
    : t(`loading.stage.${progress.stage}`)
  return (
    <div className="dsh_market_loading" aria-busy="true">
      {/* Lists load as skeletons (host rule); the stage line keeps the first sync's progress legible. */}
      <div className="dsh_market_loadingLine">
        <span className="dsh_market_progressStage" role="status" aria-live="polite">
          {mode === 'settings' ? t('loading.settingsTitle') : t('loading.title')}
          {' · '}
          {stageLabel}
        </span>
        <span
          className="dsh_market_progressPercent"
          role="progressbar"
          aria-label={t('loading.progressAria')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent}
          aria-valuetext={`${stageLabel} ${String(progress.percent)}%`}
        >{`${String(progress.percent)}%`}</span>
        {mode === 'catalog' && installedCount > 0 && onViewInstalled !== undefined && (
          <MarketButton intent="secondary" className="dsh_market_loadingAction" onClick={onViewInstalled}>
            <span>{t('loading.viewInstalled')}</span>
            <span className="dsh_market_emptyCount">{installedCount}</span>
          </MarketButton>
        )}
      </div>
      <ul className="dsh_market_cards" aria-hidden="true">
        {[0, 1, 2, 3].map(index => (
          <li key={index} className="dsh_market_card dsh_market_catalogCard dsh_market_skeletonCard">
            <div className="dsh_market_head">
              <span className="dsh_market_skeleton dsh_market_skeletonLogo" />
              <span className="dsh_market_identity">
                <span className="dsh_market_skeleton dsh_market_skeletonTitle" />
                <span className="dsh_market_skeleton dsh_market_skeletonSub" />
              </span>
            </div>
            <span className="dsh_market_skeleton dsh_market_skeletonText" />
            <span className="dsh_market_skeleton dsh_market_skeletonTextShort" />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The installed set as a card grid, with its own status lines above it. */
function InstalledCards({ t, installed, needle, installedFilter, updatableCount, catalog, catalogEnabled = true, english, snapshot, cards, installBusy, readiness, onReview, onCheckUpdate, availableUpdates, onSwitchToAll, onSwitchToFeatured, onOpenSettings, onShowAllInstalled, onClearFilters }: {
  t: MarketLocale
  installed: ReturnType<typeof useInstalled>
  needle: string
  installedFilter: 'all' | 'updatable'
  updatableCount: number
  catalog: MarketCatalog | null
  catalogEnabled?: boolean
  english: boolean
  snapshot: SafeMarketSnapshot
  cards: Readonly<Record<string, CardState>>
  installBusy: boolean
  readiness: WorkspaceReadiness
  onReview: (item: MarketInstalledPackage, viaNewWorkspace: boolean) => void
  onCheckUpdate?: (packageName: string) => void
  availableUpdates?: Readonly<Record<string, string>>
  onSwitchToAll: (focusSearch?: boolean, clearQuery?: boolean) => void
  onSwitchToFeatured?: () => void
  onOpenSettings?: () => void
  onShowAllInstalled: () => void
  onClearFilters: () => void
}): ReactElement {
  const { state, feedback, reload } = installed
  const installedPackages = state.status === 'ready' && state.result.error === '' ? state.result.packages : []
  const catalogByPackage = useMemo(() => {
    if (catalog === null) return new Map<string, MarketPlugin>()
    const candidates = [
      ...catalog.items,
      ...(catalog.featured?.entries.map(entry => entry.item) ?? []),
      ...(catalog.subscription?.entries.map(entry => entry.item) ?? []),
    ]
    return catalogIndexForInstalled(installedPackages, candidates)
  }, [installedPackages, catalog])
  const scoped = installedFilter === 'updatable'
    ? installedPackages.filter(item => Boolean(availableUpdates?.[item.packageName]))
    : installedPackages
  const shown = needle === ''
    ? scoped
    : scoped.filter(item => {
      const matched = catalogByPackage.get(item.packageName)
      return [
        item.packageName,
        shortName(item.packageName),
        item.titleZh ?? '',
        item.titleEn ?? '',
        item.description,
        item.descriptionZh ?? '',
        item.descriptionEn ?? '',
        item.repository,
        matched?.titleZh ?? '',
        matched?.titleEn ?? '',
        matched?.description ?? '',
        matched?.descriptionEn ?? '',
        matched?.categoryZh ?? '',
        matched?.categoryEn ?? '',
      ].some(text => text.toLocaleLowerCase().includes(needle))
    })
  const allMatchCount = useMemo(() => {
    if (catalog === null || shown.length > 0 || needle === '') return 0
    return allCatalogMatchCount(catalog.items, catalog.featured, needle, english)
  }, [catalog, shown.length, needle, english])
  return (
    <>
      {feedback.status === 'notice' && <p className="dsh_market_installedNotice">{feedback.message}</p>}
      {feedback.status === 'error' && <p className="dsh_market_status" data-error="true">{feedback.message}</p>}
      {state.status === 'loading' && (
        <div className="dsh_market_notice" aria-busy="true" aria-live="polite">
          <p className="dsh_market_noticeBody">{t('installed.loading')}</p>
        </div>
      )}
      {state.status === 'error' && (
        <p className="dsh_market_status" data-error="true">
          {t('installed.failed', { reason: state.message })}
          <MarketButton intent="secondary" onClick={reload}>{t('retry')}</MarketButton>
        </p>
      )}
      {state.status === 'ready' && state.result.error !== '' && (
        <p className="dsh_market_status" data-error="true">{t('installed.failed', { reason: state.result.error })}</p>
      )}
      {state.status === 'ready' && state.result.error === '' && state.result.packages.length === 0 && (
        <MarketEmptyState
          icon="installed"
          title={t('empty.installedTitle')}
          description={t('empty.installedHint')}
          primaryAction={catalogEnabled
            ? {
                label: t('empty.switchToAll'),
                count: catalog?.items.length,
                arrow: true,
                onClick: () => onSwitchToAll(false, true),
              }
            : onOpenSettings
              ? { label: t('intro.openSettings'), onClick: onOpenSettings }
              : undefined}
          secondaryAction={catalogEnabled && onSwitchToFeatured ? { label: t('empty.browseFeatured'), onClick: onSwitchToFeatured } : undefined}
        />
      )}
      {state.status === 'ready' && state.result.error === '' && state.result.packages.length > 0 && shown.length === 0 && (
        installedFilter === 'updatable' && updatableCount === 0
          ? (
            <MarketEmptyState
              icon="installed"
              title={t('empty.updatableTitle')}
              description={t('empty.updatableHint')}
              primaryAction={{ label: t('empty.showAllInstalled'), count: state.result.packages.length, onClick: onShowAllInstalled }}
            />
            )
          : installedFilter === 'updatable'
            ? (
              <MarketEmptyState
                icon="search"
                title={t('empty.updatableSearchTitle')}
                description={t('empty.updatableSearchHint')}
                primaryAction={{ label: t('empty.showAllInstalled'), count: state.result.packages.length, onClick: onShowAllInstalled }}
                secondaryAction={{ label: t('filter.clear'), onClick: onClearFilters }}
              />
              )
            : (
              <MarketEmptyState
                icon="scope"
                badge={allMatchCount > 0 ? t('empty.allFound', { count: String(allMatchCount) }) : undefined}
                title={t('empty.installedSearchTitle')}
                description={allMatchCount > 0
                  ? t('empty.installedHasAll', { installed: String(state.result.packages.length), count: String(allMatchCount) })
                  : t('empty.installedNoAll')}
                primaryAction={catalog !== null
                  ? {
                      label: t('empty.switchToAll'),
                      count: allMatchCount > 0 ? allMatchCount : undefined,
                      arrow: true,
                      onClick: () => onSwitchToAll(allMatchCount === 0),
                    }
                  : { label: t('filter.clear'), onClick: onClearFilters }}
                secondaryAction={catalog !== null ? { label: t('filter.clear'), onClick: onClearFilters } : undefined}
              />
              )
      )}
      {shown.length > 0 && (
        <ul className="dsh_market_cards dsh_market_cardsUniform">
          {shown.map(item => (
            <InstalledCard
              key={item.packageName}
              t={t}
              english={english}
              item={item}
              matched={catalogByPackage.get(item.packageName)}
              installed={installed}
              snapshot={snapshot}
              card={cards[installedReviewCardKey(item.packageName)]}
              installBusy={installBusy}
              readiness={readiness}
              onReview={onReview}
              onCheckUpdate={onCheckUpdate}
              availableVersion={availableUpdates?.[item.packageName]}
            />
          ))}
        </ul>
      )}
    </>
  )
}

function OfficialExperimentalCards({
  t,
  english,
  officialBundles,
  needle,
  officialFilter,
  installDisabled = false,
  onInstallOnDemand,
  onClearFilters,
  onShowAllOfficial,
}: {
  readonly t: MarketLocale
  readonly english: boolean
  readonly officialBundles: OfficialBundlesController
  readonly needle: string
  readonly officialFilter: 'all' | 'enabled' | 'disabled'
  readonly installDisabled?: boolean
  readonly onInstallOnDemand: (bundle: HostBundleInfo, enabled: boolean) => void
  readonly onClearFilters: () => void
  readonly onShowAllOfficial: () => void
}): ReactElement {
  const state = useSyncExternalStore(officialBundles.subscribe, officialBundles.getSnapshot)
  const scoped = state.bundles.filter((bundle) => {
    if (officialFilter === 'enabled') return bundle.enabled
    if (officialFilter === 'disabled') return !bundle.enabled
    return true
  })
  const shown = needle === ''
    ? scoped
    : scoped.filter((bundle) => {
        const display = officialBundleDisplay(bundle, english)
        return [bundle.name, shortName(bundle.name), display.title, display.description]
          .some(text => text.toLocaleLowerCase().includes(needle))
      })

  const noticeText = state.notice === null
    ? ''
    : state.notice.kind === 'restart'
      ? t('official.notice.restart', { name: shortName(state.notice.packageName) })
      : state.notice.kind === 'overridden'
        ? t('official.notice.overridden', { name: shortName(state.notice.packageName) })
        : state.notice.kind === 'removed'
          ? t('official.notice.removed', { name: shortName(state.notice.packageName) })
          : t('official.notice.error', { name: shortName(state.notice.packageName), reason: state.notice.message })

  return (
    <>
      {state.notice !== null && (
        <div className="dsh_market_notice" role="status">
          <p className="dsh_market_noticeBody" data-error={state.notice.kind === 'error' ? 'true' : undefined}>{noticeText}</p>
          <MarketButton intent="secondary" onClick={() => officialBundles.dismissNotice()}>
            {t('official.dismiss')}
          </MarketButton>
        </div>
      )}
      {state.status === 'loading' && (
        <div className="dsh_market_notice" aria-busy="true" aria-live="polite">
          <p className="dsh_market_noticeBody">{t('official.loading')}</p>
        </div>
      )}
      {state.status === 'error' && (
        <p className="dsh_market_status" data-error="true">
          {t('official.failed', { reason: state.error })}
          <MarketButton intent="secondary" onClick={() => { void officialBundles.refresh() }}>{t('retry')}</MarketButton>
        </p>
      )}
      {state.status === 'ready' && state.bundles.length === 0 && (
        <MarketEmptyState
          icon="installed"
          title={t('official.emptyTitle')}
          description={t('official.emptyHint')}
        />
      )}
      {state.status === 'ready' && state.bundles.length > 0 && shown.length === 0 && (
        <MarketEmptyState
          icon="search"
          title={t('official.emptySearchTitle')}
          description={t('official.emptySearchHint')}
          primaryAction={officialFilter !== 'all'
            ? { label: t('official.showAll'), count: state.bundles.length, onClick: onShowAllOfficial }
            : { label: t('filter.clear'), onClick: onClearFilters }}
          secondaryAction={officialFilter !== 'all' && needle !== '' ? { label: t('filter.clear'), onClick: onClearFilters } : undefined}
        />
      )}
      {shown.length > 0 && (
        <ul className="dsh_market_cards dsh_market_cardsUniform">
          {shown.map((bundle) => {
            const display = officialBundleDisplay(bundle, english)
            const isBusy = state.busy.includes(bundle.name)
            const isUninstalling = state.uninstalling.includes(bundle.name)
            const confirming = state.confirmingUninstall === bundle.name
            const showInstallButton = display.notInstalled && bundle.installTarget !== undefined
            const showUninstall = bundle.installed && bundle.removable
            const hasActions = showInstallButton || display.updatable || showUninstall || isUninstalling
            return (
              <li
                key={bundle.name}
                className="dsh_market_card dsh_market_installedCard dsh_market_officialCard"
                data-confirming={confirming || isUninstalling ? 'true' : undefined}
              >
                <div className="dsh_market_head">
                  <PluginLogo src={display.icon} name={display.title} />
                  <div className="dsh_market_identity">
                    <span className="dsh_market_name" title={display.title}>{display.title}</span>
                    <span className="dsh_market_packageName" title={bundle.name}>{bundle.name}</span>
                  </div>
                  <div className="dsh_market_officialToggle">
                    <Switch
                      checked={bundle.enabled}
                      label={t('official.toggleAria', { name: display.title })}
                      disabled={isBusy || display.switchDisabled || (display.notInstalled && installDisabled)}
                      title={bundle.readOnlyReason ? t('official.readOnly') : undefined}
                      onChange={next => { void officialBundles.toggle(bundle, next, onInstallOnDemand) }}
                    />
                  </div>
                </div>
                <div className="dsh_market_meta dsh_market_skillBadges">
                  <span className="dsh_market_categoryTag dsh_market_officialBadge">
                    {t(display.experimental ? 'official.badge.experimental' : 'official.badge.official')}
                  </span>
                  {bundle.version !== undefined && bundle.version !== '' && (
                    <span className="dsh_market_categoryTag">{`v${bundle.version}`}</span>
                  )}
                  {display.notInstalled && (
                    <span className="dsh_market_categoryTag">{t('official.badge.notInstalled')}</span>
                  )}
                  {display.updatable && (
                    <span className="dsh_market_categoryTag dsh_market_officialUpdatable">{t('official.badge.updatable')}</span>
                  )}
                  {display.status === 'not-running' && (
                    <span className="dsh_market_installedState" data-state="failed">{t('official.status.notRunning')}</span>
                  )}
                  {display.status === 'problem' && (
                    <span className="dsh_market_installedState" data-state="readFailed">{t('official.status.problem')}</span>
                  )}
                </div>
                {display.description !== '' && (
                  <p className="dsh_market_desc" title={display.description}>{display.description}</p>
                )}
                {bundle.error !== undefined && (
                  <p className="dsh_market_cardError">
                    {bundle.error.diagnostic || bundle.error.code}
                  </p>
                )}
                {bundle.readOnlyReason !== undefined && bundle.error === undefined && (
                  <p className="dsh_market_cardNotice">{t('official.readOnly')}</p>
                )}
                {hasActions && (
                  <div className="dsh_market_foot">
                    {isUninstalling ? (
                      <UninstallProgressFooter t={t} name={display.title} onRefresh={() => { void officialBundles.refresh() }} />
                    ) : confirming ? (
                      <>
                        <span className="dsh_market_cardNotice" aria-live="polite">
                          {t('installed.confirmUninstall', { name: display.title })}
                        </span>
                        <MarketButton
                          intent="danger"
                          disabled={isBusy}
                          onClick={() => { void officialBundles.confirmUninstallNow(bundle.name) }}
                        >
                          {t('installed.confirm')}
                        </MarketButton>
                        <MarketButton
                          intent="secondary"
                          disabled={isBusy}
                          onClick={() => officialBundles.cancelUninstall()}
                        >
                          {t('installed.cancel')}
                        </MarketButton>
                      </>
                    ) : (
                      <>
                        {showInstallButton && (
                          <MarketButton
                            intent="primary"
                            disabled={isBusy || installDisabled}
                            onClick={() => onInstallOnDemand(bundle, true)}
                          >
                            {t('official.installAndEnable')}
                          </MarketButton>
                        )}
                        {display.updatable && (
                          <MarketButton
                            intent="primary"
                            disabled={isBusy || installDisabled}
                            onClick={() => { void officialBundles.update(bundle, onInstallOnDemand, () => !installDisabled) }}
                          >
                            {t('official.update')}
                          </MarketButton>
                        )}
                        {showUninstall && (
                          <MarketButton
                            intent="danger"
                            disabled={isBusy}
                            onClick={() => officialBundles.requestUninstall(bundle.name)}
                          >
                            {t('installed.uninstall')}
                          </MarketButton>
                        )}
                      </>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

/** The Plugins page. */
function PluginsPage({ t, english, snapshot, loadCatalog, peekCatalog, listInstalled, subscribeInstalledChanges, setInstalledEnabled, uninstallInstalled, officialBundles, onInstallOfficialBundle, chooseWorkspace, workspaceReadiness, cards, installBusy, onReviewDraft, onOpenSettings, directInstaller, setDirectItem, installedRevision, appliedUpdateRevision, onCheckUpdate, onOpenBatchUpdate, availableUpdates, onProbeUpdates, onRegisterRefresh, onOwnedIndexChange }: {
  setDirectItem: (item: MarketPlugin) => void
  installedRevision: number
  appliedUpdateRevision: number
  onCheckUpdate?: (packageName: string) => void
  onOpenBatchUpdate?: () => void
  availableUpdates?: Readonly<Record<string, string>>
  onProbeUpdates?: (packageNames: readonly string[]) => void
  onRegisterRefresh?: (action: HeaderRefreshAction | null) => void
  onOwnedIndexChange?: (index: ReadonlyMap<string, MarketInstalledPackage>) => void
  t: MarketLocale
  english: boolean
  snapshot: SafeMarketSnapshot
  loadCatalog: MarketSectionInjected['loadCatalog']
  peekCatalog?: MarketSectionInjected['peekCatalog']
  listInstalled: MarketSectionInjected['listInstalled']
  subscribeInstalledChanges?: MarketSectionInjected['subscribeInstalledChanges']
  setInstalledEnabled: MarketSectionInjected['setInstalledEnabled']
  uninstallInstalled: MarketSectionInjected['uninstallInstalled']
  officialBundles?: OfficialBundlesController
  onInstallOfficialBundle?: (bundle: HostBundleInfo, enabled: boolean) => void
  chooseWorkspace: MarketSectionInjected['chooseWorkspace']
  workspaceReadiness: MarketSectionInjected['workspaceReadiness']
  directInstaller?: DirectInstaller
  cards: Readonly<Record<string, CardState>>
  installBusy: boolean
  onReviewDraft: (cardKey: string, prompt: string, viaNewWorkspace: boolean) => void
  onOpenSettings: () => void
}): ReactElement {
  const enabled = snapshot.settingsReady && snapshot.value.enabled
  const [state, setState] = useState<CatalogState>(() => {
    if (!enabled) return { status: 'idle' }
    const cached = peekCatalog?.()
    if (cached?.catalog) return { status: 'ready', catalog: cached.catalog, stale: cached.stale }
    return { status: 'loading' }
  })
  // A force refresh from `ready` keeps showing the catalog, so the busy
  // answer is a separate flag rather than the `loading` status.
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  // The editor's picks are the first view when the online catalog is enabled;
  // when the community catalog is disabled, land directly on installed plugins
  // so local management stays immediately accessible.
  const [category, setCategory] = useState(() => (snapshot.settingsReady && !enabled ? INSTALLED_FILTER : FEATURED_CATEGORY))
  const [installedFilter, setInstalledFilter] = useState<'all' | 'updatable'>('all')
  const [officialFilter, setOfficialFilter] = useState<'all' | 'enabled' | 'disabled'>('all')
  const [filterCategory, setFilterCategory] = useState('')
  const [sort, setSort] = useState<MarketSort>('active')
  const [page, setPage] = useState(0)
  const resultsRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const scrollResultsToTop = (behavior?: ScrollBehavior) => {
    scrollResultsContainerToTop(resultsRef.current, behavior)
  }
  const installed = useInstalled({ t, active: snapshot.settingsReady, listInstalled, subscribeInstalledChanges, setInstalledEnabled, uninstallInstalled })
  const officialState = useSyncExternalStore(
    officialBundles?.subscribe ?? (() => () => {}),
    officialBundles?.getSnapshot ?? (() => null),
  )
  const directState = useSyncExternalStore(
    directInstaller?.subscribe ?? (() => () => {}),
    directInstaller?.getSnapshot ?? (() => null),
  )
  const directBusy = directState !== null && ['checking', 'installing', 'cancelling', 'unknown'].includes(directState.phase)
  useEffect(() => {
    if (snapshot.settingsReady) void officialBundles?.load()
  }, [snapshot.settingsReady, officialBundles])
  useEffect(() => {
    if (snapshot.settingsReady && !enabled && category !== INSTALLED_FILTER && category !== OFFICIAL_EXPERIMENTAL_FILTER) {
      setCategory(INSTALLED_FILTER)
    }
  }, [snapshot.settingsReady, enabled, category])
  useEffect(() => { if (installedRevision > 0) installed.refresh() }, [installedRevision, installed.refresh])
  useLayoutEffect(() => {
    if (appliedUpdateRevision > 0) scrollResultsToTop('instant')
  }, [appliedUpdateRevision])
  useEffect(() => {
    if (installed.state.status === 'ready') {
      const names = installed.state.result.error === ''
        ? [...new Set([...installed.state.result.packages.map(pkg => pkg.packageName), PACKAGE_NAME])]
        : [PACKAGE_NAME]
      onProbeUpdates?.(names)
    } else if (installed.state.status === 'error') {
      onProbeUpdates?.([PACKAGE_NAME])
    }
  }, [installed.state, onProbeUpdates])
  const installedSelected = category === INSTALLED_FILTER
  const officialSelected = category === OFFICIAL_EXPERIMENTAL_FILTER
  const showOfficialChip = officialState !== null
    && (officialState.status === 'loading'
      || officialState.status === 'error'
      || (officialState.status === 'ready' && officialState.bundles.length > 0))
  const installedUpdatableCount = installed.state.status === 'ready' && installed.state.result.error === ''
    ? installed.state.result.packages.filter(item => Boolean(availableUpdates?.[item.packageName])).length
    : 0
  const batchUpdatableCount = Math.max(installedUpdatableCount, Object.keys(availableUpdates ?? {}).length)
  // Rebuilt only when the installed set itself changes — every enable,
  // disable and uninstall answers with the whole list, so the catalog's
  // "already installed" marks follow those verbs without a second read.
  // Above the market-off early return, where the rules of hooks need it.
  const ownedIndex = useMemo(
    () => ownedIndexOf(installed.state.status === 'ready' ? installed.state.result.packages : []),
    [installed.state],
  )
  useEffect(() => { onOwnedIndexChange?.(ownedIndex) }, [ownedIndex, onOwnedIndexChange])
  // The notice's own state, kept apart from the cards': it can be answered
  // before any card has been clicked.
  const [workspacePick, setWorkspacePick] = useState<WorkspacePickState>({ status: 'idle' })
  // Read from the workspace domain's own store, so the notice clears itself
  // whether the workspace arrived from this button or from the sidebar.
  const readiness = useSyncExternalStore(workspaceReadiness.subscribe, workspaceReadiness.getSnapshot)
  useEffect(() => {
    if (readiness === 'present') setWorkspacePick({ status: 'idle' })
  }, [readiness])
  // The section keeps this page mounted across tab switches (see
  // MarketSection), but the settings shell can still unmount the whole
  // section mid-read — the guard stops the late answer from touching state.
  const mounted = useRef(true)
  // Set on mount as well as cleared on unmount: React 18 StrictMode runs the
  // cleanup once immediately after the first mount, and a ref that is only
  // ever cleared would stay false for the rest of the component's life —
  // every async answer below would then be silently dropped.
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  // The read's generation, distinct from `mounted`: StrictMode dispatches the
  // first read twice and a force-refresh can overlap the background read, so
  // two `loadCatalog` calls may be in flight at once. Each captures the value
  // it bumped to, and only the latest is allowed to land — otherwise the
  // slower, older answer resolves last and overwrites the newer catalog.
  const readSeq = useRef(0)

  const load = useCallback((force: boolean) => {
    const seq = (readSeq.current += 1)
    setState((previous) => {
      if (previous.status === 'ready') return previous
      const cached = peekCatalog?.()
      if (cached?.catalog) return { status: 'ready', catalog: cached.catalog, stale: cached.stale }
      return { status: 'loading' }
    })
    if (force) setRefreshing(true)
    void loadCatalog(force).then((result) => {
      if (!mounted.current || seq !== readSeq.current) return
      setRefreshing(false)
      const nextCatalog = result.catalog
      if (nextCatalog === null) {
        setState({ status: 'error', message: result.error })
        return
      }
      setState(previous => (
        previous.status === 'ready' && previous.catalog === nextCatalog && previous.stale === result.stale
          ? previous
          : { status: 'ready', catalog: nextCatalog, stale: result.stale }
      ))
    }, (error: unknown) => {
      if (!mounted.current || seq !== readSeq.current) return
      setRefreshing(false)
      setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    })
  }, [loadCatalog, peekCatalog])

  // The host resolves the persisted preference before catalog access begins.
  useEffect(() => {
    if (!enabled) {
      readSeq.current += 1
      setRefreshing(false)
      setState({ status: 'idle' })
      return
    }
    load(false)
  }, [enabled, load])

  const catalog = state.status === 'ready' ? state.catalog : null
  const needle = query.trim().toLocaleLowerCase()
  const showFeatured = catalog === null || catalog.featured !== undefined
  useEffect(() => {
    if (officialSelected && !showOfficialChip) {
      setCategory(enabled ? (showFeatured ? FEATURED_CATEGORY : '') : INSTALLED_FILTER)
    }
  }, [officialSelected, showOfficialChip, enabled, showFeatured])
  const featuredSelected = category === FEATURED_CATEGORY && catalog?.featured !== undefined
  const featuredChipPressed = category === FEATURED_CATEGORY && showFeatured
  const allSelected = !installedSelected && !officialSelected && !featuredChipPressed
  const filterCategories = featuredSelected
    ? catalog.featured?.categories ?? []
    : catalog?.categories.filter(entry => entry.key !== FEATURED_CATEGORY && entry.key !== SUBSCRIPTION_CATEGORY) ?? []
  const scope = filterCategories.some(entry => entry.key === filterCategory) ? filterCategory : ''
  const shown = useMemo<readonly { item: MarketPlugin; reason?: string }[]>(() => catalog === null || installedSelected || officialSelected
    ? []
    : featuredSelected
      ? featuredRows(catalog.featured, needle, english, scope)
      : sortMarketRows(
        marketRows(catalog.items, catalog.featured, needle).filter(item => matches(item, needle, scope, english)),
        sort,
        catalog.fetchedAt,
      ).map(item => ({ item })), [catalog, installedSelected, officialSelected, featuredSelected, needle, english, scope, sort])
  const allMatchCount = useMemo(() => {
    if (catalog === null || installedSelected || officialSelected || shown.length > 0) return 0
    if (!featuredSelected && scope === '') return 0
    return allCatalogMatchCount(catalog.items, catalog.featured, needle, english)
  }, [catalog, installedSelected, officialSelected, shown.length, featuredSelected, scope, needle, english])
  const paged = pageOf(shown, page)
  useLayoutEffect(() => {
    scrollResultsToTop('instant')
  }, [paged.current])
  useEffect(() => {
    setPage(0)
    scrollResultsToTop()
  }, [catalog, category, filterCategory, sort, query, english])

  const canRefresh = snapshot.settingsReady && (enabled || installedSelected || officialSelected)
  const refreshBusy = enabled
    ? refreshing
    : officialSelected
      ? officialState?.status === 'loading'
      : installed.state.status === 'loading'
  const refreshDisabled = enabled
    ? (state.status === 'loading' || refreshing)
    : officialSelected
      ? officialState?.status === 'loading'
      : installed.state.status === 'loading'
  const refreshLabel = refreshBusy ? t('refreshing') : t('refresh')
  const triggerRefresh = () => {
    if (enabled) load(true)
    if (officialSelected) {
      void officialBundles?.refresh()
    } else if (installedSelected) {
      installed.reload()
    } else {
      const names = installed.state.status === 'ready' && installed.state.result.error === ''
        ? [...new Set([...installed.state.result.packages.map(pkg => pkg.packageName), PACKAGE_NAME])]
        : [PACKAGE_NAME]
      onProbeUpdates?.(names)
    }
  }
  const triggerRefreshRef = useRef(triggerRefresh)
  triggerRefreshRef.current = triggerRefresh
  useEffect(() => {
    if (!onRegisterRefresh) return
    onRegisterRefresh(canRefresh ? {
      label: refreshLabel,
      busy: refreshBusy,
      disabled: refreshDisabled,
      onClick: () => triggerRefreshRef.current(),
    } : null)
  }, [onRegisterRefresh, canRefresh, refreshLabel, refreshBusy, refreshDisabled])
  useEffect(() => () => { onRegisterRefresh?.(null) }, [onRegisterRefresh])

  if (!snapshot.settingsReady) {
    return (
      <div className="dsh_market_page">
        <MarketLoadingState t={t} mode="settings" />
      </div>
    )
  }

  const pickWorkspace = (): void => {
    if (workspacePick.status === 'picking') return
    setWorkspacePick({ status: 'picking' })
    void chooseWorkspace().then((outcome) => {
      if (!mounted.current) return
      // A cancelled picker leaves the notice exactly as it was: the user
      // declined, and there is nothing to report about it.
      if (!outcome.ok && outcome.reason === 'failed') {
        setWorkspacePick({ status: 'error', message: t('workspace.failed', { reason: outcome.message }) })
        return
      }
      setWorkspacePick({ status: 'idle' })
    }, (error: unknown) => {
      if (!mounted.current) return
      setWorkspacePick({ status: 'error', message: t('workspace.failed', { reason: error instanceof Error ? error.message : String(error) }) })
    })
  }

  const reviewInstalledPackage = (item: MarketInstalledPackage, viaNewWorkspace: boolean): void => {
    const profile = snapshot.profile
    if (profile === null) return
    onReviewDraft(installedReviewCardKey(item.packageName), buildReviewPrompt(t, {
      profile, targets: [{ packageName: item.packageName, version: item.version }],
    }), viaNewWorkspace)
  }

  const clearFilters = (): void => {
    setQuery('')
    setFilterCategory('')
  }

  const switchToAll = (focusSearch = false, clearQuery = false): void => {
    if (clearQuery) setQuery('')
    setFilterCategory('')
    setCategory('')
    if (focusSearch) {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }
  }

  const switchToFeatured = (): void => {
    setQuery('')
    setFilterCategory('')
    setCategory(FEATURED_CATEGORY)
  }

  const hasFilters = query.trim() !== '' || scope !== ''

  return (
    <div className="dsh_market_page dsh_market_fixedPage">
      <div className="dsh_market_controls">
      {/* Says the prerequisite out loud before a click runs into it, and
          offers the same one action the cards do. It does not block browsing:
          the shortlist is worth reading without a workspace. */}
      {installedSelected && readiness === 'none' && (
        <div className="dsh_market_notice">
          <p className="dsh_market_noticeBody">{t('workspace.needed')}</p>
          {workspacePick.status === 'error' && <p className="dsh_market_status" data-error="true">{workspacePick.message}</p>}
          <MarketButton
            intent="primary"
            disabled={workspacePick.status === 'picking' || installBusy}
            onClick={pickWorkspace}
          >
            {workspacePick.status === 'picking' ? t('workspace.choosing') : t('workspace.choose')}
          </MarketButton>
        </div>
      )}
        {!onRegisterRefresh && canRefresh && (
          <button
            type="button"
            className="dsh_market_headerAction dsh_market_refreshMarket"
            disabled={refreshDisabled}
            aria-busy={refreshBusy}
            onClick={triggerRefresh}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 4v6h-6M20 10a8 8 0 1 0-1.7 7" />
            </svg>
            {refreshLabel}
          </button>
        )}

      <div className="dsh_market_filterBar">
        <div className="dsh_market_scope" role="group" aria-label={t('filter.scope')}>
          {showFeatured && (
            <button type="button" className="dsh_market_scopeButton" aria-pressed={featuredChipPressed}
              onClick={switchToFeatured}>
              {t('featured.chip')} {catalog?.featured !== undefined && <span>{catalog.featured.count}</span>}
            </button>
          )}
          {showOfficialChip && (
            <button type="button" className="dsh_market_scopeButton" aria-pressed={officialSelected}
              onClick={() => setCategory(OFFICIAL_EXPERIMENTAL_FILTER)}>
              {t('official.chip')} {officialState?.status === 'ready' && <span>{officialState.bundles.length}</span>}
            </button>
          )}
          <button type="button" className="dsh_market_scopeButton" aria-pressed={allSelected}
            onClick={() => switchToAll(false)}>
            {t('all')} {catalog !== null && <span>{catalog.items.length}</span>}
          </button>
          <button type="button" className="dsh_market_scopeButton" aria-pressed={installedSelected}
            onClick={() => setCategory(INSTALLED_FILTER)}>
            {t('installed.chip')} <span>{installed.count}</span>
          </button>
        </div>
        {(enabled || installedSelected || officialSelected) && (
          <div className="dsh_market_filterActions">
            <input
              ref={searchInputRef}
              className="dsh_market_search dsh_market_filterSearch"
              type="search"
              spellCheck={false}
              aria-label={t('search')}
              placeholder={t('search')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {installedSelected && (
              <MarketSelector
                value={installedFilter}
                onChange={setInstalledFilter}
                label={t('installed.filter.aria')}
                className="dsh_market_sort"
                options={[
                  { value: 'all', label: t('installed.filter.all'), count: installed.count },
                  { value: 'updatable', label: t('installed.filter.updatable'), count: installedUpdatableCount },
                ]}
              />
            )}
            {officialSelected && officialState?.status === 'ready' && (
              <MarketSelector
                value={officialFilter}
                onChange={setOfficialFilter}
                label={t('official.filter.aria')}
                className="dsh_market_sort"
                options={[
                  { value: 'all', label: t('official.filter.all'), count: officialState.bundles.length },
                  { value: 'enabled', label: t('official.filter.enabled'), count: officialState.bundles.filter(b => b.enabled).length },
                  { value: 'disabled', label: t('official.filter.disabled'), count: officialState.bundles.filter(b => !b.enabled).length },
                ]}
              />
            )}
            {installedSelected && onOpenBatchUpdate && batchUpdatableCount > 0 && (
              <MarketButton
                intent="primary"
                className="dsh_market_batchUpdateButton"
                disabled={installBusy}
                onClick={onOpenBatchUpdate}
                icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 16V4m-5 5 5-5 5 5M5 20h14" />
                </svg>}
              >
                {`${t('installed.updateAll')} (${String(batchUpdatableCount)})`}
              </MarketButton>
            )}
            {!installedSelected && !officialSelected && filterCategories.length > 0 && <MarketSelector
              value={scope} onChange={setFilterCategory} label={t('filter.category')} className="dsh_market_category"
              options={[{ value: '', label: t('filter.allCategories') }, ...filterCategories
                .map(entry => ({ value: entry.key, label: english ? entry.en : entry.zh, count: entry.count }))]} />}
            {allSelected && catalog !== null && <MarketSelector
              value={sort} onChange={setSort} label={t('filter.sort')} className="dsh_market_sort"
              options={[
                { value: 'active', label: t('filter.sort.active') },
                { value: 'stars', label: t('filter.sort.stars') },
                { value: 'updated', label: t('filter.sort.updated') },
              ]} />}
          </div>
        )}

      </div>

      </div>
      <div className="dsh_market_results" ref={resultsRef}>
      {officialSelected && officialBundles
        ? (
          <OfficialExperimentalCards
            t={t}
            english={english}
            officialBundles={officialBundles}
            needle={needle}
            officialFilter={officialFilter}
            installDisabled={directBusy}
            onInstallOnDemand={onInstallOfficialBundle ?? (() => {})}
            onClearFilters={clearFilters}
            onShowAllOfficial={() => { setOfficialFilter('all'); setQuery('') }}
          />
          )
        : installedSelected
        ? (
          <InstalledCards
            t={t}
            installed={installed}
            needle={needle}
            installedFilter={installedFilter}
            updatableCount={installedUpdatableCount}
            catalog={catalog}
            catalogEnabled={enabled}
            english={english}
            snapshot={snapshot}
            cards={cards}
            installBusy={installBusy}
            readiness={readiness}
            onReview={reviewInstalledPackage}
            onCheckUpdate={onCheckUpdate}
            availableUpdates={availableUpdates}
            onSwitchToAll={switchToAll}
            onSwitchToFeatured={catalog?.featured !== undefined ? switchToFeatured : undefined}
            onOpenSettings={onOpenSettings}
            onShowAllInstalled={() => { setInstalledFilter('all'); setQuery('') }}
            onClearFilters={clearFilters}
          />
          )
        : !enabled
          ? (
            <div className="dsh_market_intro">
              <p className="dsh_market_introTitle">{t('intro.title')}</p>
              <p className="dsh_market_introBody">{t('intro.disabled')}</p>
              <div className="dsh_market_introActions">
                <MarketButton intent="primary" onClick={onOpenSettings}>
                  {t('intro.openSettings')}
                </MarketButton>
              </div>
            </div>
            )
        : state.status === 'error'
          ? (
            <MarketEmptyState
              icon="error"
              title={t('loading.errorTitle')}
              description={t('failed', { reason: state.message })}
              primaryAction={{ label: t('loading.retry'), onClick: () => { load(true) } }}
              secondaryAction={installed.count > 0 ? { label: t('loading.viewInstalled'), onClick: () => setCategory(INSTALLED_FILTER) } : undefined}
            />
            )
          : catalog === null
            ? (
              <MarketLoadingState
                t={t}
                mode="catalog"
                installedCount={installed.count}
                onViewInstalled={() => setCategory(INSTALLED_FILTER)}
              />
              )
            : (
              <>
                {(refreshing || (hasFilters && shown.length > 0)) && (
                  <p className="dsh_market_status" aria-busy={refreshing ? 'true' : undefined} aria-live="polite">
                    {refreshing
                      ? t('refreshing')
                      : t('filter.results', { shown: String(shown.length) })}
                    {!refreshing && hasFilters && shown.length > 0 && <button type="button" className="dsh_market_clearFilters"
                      onClick={clearFilters}>{t('filter.clear')}</button>}
                  </p>
                )}
                {shown.length === 0 && (
                  featuredSelected
                    ? (
                      <MarketEmptyState
                        icon="scope"
                        badge={needle !== '' && allMatchCount > 0 ? t('empty.allFound', { count: String(allMatchCount) }) : undefined}
                        title={t('empty.featuredTitle')}
                        description={needle === ''
                          ? t('empty.featuredScope', { total: String(catalog.items.length) })
                          : allMatchCount > 0
                            ? t('empty.featuredHasAll', { featured: String(catalog.featured?.count ?? 0), count: String(allMatchCount) })
                            : t('empty.featuredNoAll', { featured: String(catalog.featured?.count ?? 0), total: String(catalog.items.length) })}
                        primaryAction={{
                          label: t('empty.switchToAll'),
                          count: needle === '' ? catalog.items.length : allMatchCount > 0 ? allMatchCount : undefined,
                          arrow: true,
                          onClick: () => switchToAll(needle !== '' && allMatchCount === 0),
                        }}
                        secondaryAction={hasFilters ? { label: t('filter.clear'), onClick: clearFilters } : undefined}
                      />
                      )
                    : scope !== '' && allMatchCount > 0
                      ? (
                        <MarketEmptyState
                          icon="scope"
                          badge={t('empty.allCategoriesFound', { count: String(allMatchCount) })}
                          title={t('empty.allTitle')}
                          description={t('empty.allCategoryHint', { count: String(allMatchCount) })}
                          primaryAction={{
                            label: t('empty.allCategories'),
                            count: allMatchCount,
                            arrow: true,
                            onClick: () => setFilterCategory(''),
                          }}
                          secondaryAction={{ label: t('filter.clear'), onClick: clearFilters }}
                        />
                        )
                      : (
                        <MarketEmptyState
                          icon="search"
                          title={t('empty.allTitle')}
                          description={t('empty.allHint', { total: String(catalog.items.length) })}
                          primaryAction={hasFilters ? { label: t('filter.clear'), onClick: clearFilters } : undefined}
                        />
                        )
                )}
              </>
              )}

      {!installedSelected && !officialSelected && shown.length > 0 && (
        <ul className="dsh_market_cards dsh_market_cardsUniform">
          {paged.items.map(({ item, reason }) => {
            const owned = ownedBy(ownedIndex, item)
            const moreTargets = owned !== undefined && hasRemainingTargets(ownedIndex, item)
            return (
              <li key={marketKey(item)} className="dsh_market_card dsh_market_catalogCard">
                <div className="dsh_market_head">
                  <PluginLogo src={item.icon ?? owned?.icon} name={item.name} fullName={item.fullName} />
                  <div className="dsh_market_identity">
                    <span className="dsh_market_name" title={(english ? item.titleEn : item.titleZh) || item.name}>{(english ? item.titleEn : item.titleZh) || item.name}</span>
                    <span className="dsh_market_packageName" title={item.packageName || item.fullName}>{item.packageName || item.fullName}</span>
                  </div>
                  {/* Says "you already have this" where the eye lands first,
                      so the card's verb below is read as the upgrade it is.
                      The version is shown only in a shape that cannot carry a
                      line of its own into the layout. */}
                  {owned !== undefined && (
                    <span className="dsh_market_owned" title={owned.packageName}>
                      {isSafeVersion(owned.version)
                        ? t('installedHere', { version: owned.version })
                        : t('installedHereUnknown')}
                    </span>
                  )}
                  {/* The picks are ordered by the editor, not by stars, so
                      their cards do not show a count that suggests a ranking;
                      a card built from a pick's install block (found by a
                      search in All) has no count to show at all. */}
                  {reason === undefined && item.category !== FEATURED_CATEGORY && item.category !== SUBSCRIPTION_CATEGORY && (
                    <span className="dsh_market_stars" title={`${String(item.stars)} ${t('stars')}`}>
                      {`★ ${starCount(item.stars)}`}
                    </span>
                  )}
                </div>
                <p className="dsh_market_meta">
                  <span className="dsh_market_categoryTag">{english ? item.categoryEn : item.categoryZh}</span>
                  <span>{[
                    item.owner,
                    item.pushedAt.slice(0, 10),
                    item.archived ? t('repository.archived') : '',
                    item.disabled ? t('repository.disabled') : '',
                  ].filter(part => part !== '').join(' · ')}</span>
                </p>
                {item.description !== '' && <p className="dsh_market_desc">{english ? item.descriptionEn || item.description : item.description}</p>}
                <div className="dsh_market_foot">
                  <a className="dsh_market_link" href={item.url} target="_blank" rel="noreferrer">{t(item.fullName ? 'repo' : 'package.page')}</a>
                  {/* Manage updates using the installed package's exact identity. */}
                  {owned !== undefined
                    ? (
                      <>
                        <MarketButton intent={moreTargets ? 'secondary' : 'primary'}
                          onClick={() => {
                            scrollResultsToTop()
                            setCategory(INSTALLED_FILTER)
                          }}>{t('direct.manage')}</MarketButton>
                        {moreTargets && (
                          <MarketButton intent="primary" disabled={!directInstaller || installBusy}
                            onClick={() => setDirectItem(item)}>{t('direct.install')}</MarketButton>
                        )}
                      </>
                      )
                    : (
                      <MarketButton intent="primary" disabled={!directInstaller || installBusy}
                        onClick={() => setDirectItem(item)}>{t('direct.install')}</MarketButton>
                      )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {catalog !== null && !installedSelected && (
        <p className="dsh_market_note">
          {t('snapshot', { date: catalog.fetchedAt.slice(0, 10), scanned: String(catalog.scanned) })}
          {' · '}
          <a href="https://github.com/bruc3van/awesome-dsh-plugin-pro" target="_blank" rel="noreferrer">{t('source')}</a>
          {state.status === 'ready' && state.stale ? ` · ${t('stale')}` : ''}
        </p>
      )}
      </div>
      {!installedSelected && !officialSelected && shown.length > 0 && <nav className="dsh_market_pagination" aria-label={t('pagination.label')}>
        <span className="dsh_market_pageRange">{t('pagination.range', { start: String(paged.start), end: String(paged.end), total: String(paged.total) })}</span>
        <div className="dsh_market_pager">
          <Tooltip label={t('pagination.previous')} side="top" portal disabled={paged.current === 0}>
            <button type="button" className="dsh_market_pageButton" disabled={paged.current === 0} aria-label={t('pagination.previous')}
              onClick={() => setPage(paged.current - 1)}>
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
            </button>
          </Tooltip>
          <span className="dsh_market_pageNumber" aria-live="polite">{t('pagination.page', { page: String(paged.current + 1), pages: String(paged.pages) })}</span>
          <Tooltip label={t('pagination.next')} side="top" portal disabled={paged.current + 1 === paged.pages}>
            <button type="button" className="dsh_market_pageButton" disabled={paged.current + 1 === paged.pages} aria-label={t('pagination.next')}
              onClick={() => setPage(paged.current + 1)}>
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
            </button>
          </Tooltip>
        </div>
      </nav>}
    </div>
  )
}

/** The Marketplace section. */
export function MarketSection({
  useScope, updateSettings, loadCatalog, peekCatalog, listSkills, skillsSession, installFeaturedSkill, deleteInstalledSkill, canOpenFolder, openFolder, install, installIntoNewWorkspace, chooseWorkspace, directoryBrowser, workspaceReadiness,
  listInstalled, subscribeInstalledChanges, setInstalledEnabled, uninstallInstalled, directInstaller, officialBundles, pluginUpdater, mcp, close, t,
}: MarketSectionProps): ReactElement {
  const snapshot = useScope(value => value)
  // The slot props carry a translate function, not a locale tag; the
  // dictionary names its own language so the category labels and the staged
  // prompt follow the same setting the rest of the copy does.
  const english = t('lang') === 'en'
  const [page, setPage] = useState<Page>('plugins')
  const [overlay, setOverlay] = useState<MarketOverlay>({ kind: 'none' })
  const directItem = overlay.kind === 'direct-install' ? overlay.item : null
  const updateOpen = overlay.kind === 'update'
  const batchUpdateOpen = overlay.kind === 'batch-update'
  const openDirectItem = useCallback((item: MarketPlugin) => {
    setOverlay({ kind: 'direct-install', item })
  }, [])
  const installOfficialBundle = useCallback((bundle: HostBundleInfo, enabled: boolean) => {
    if (!directInstaller || bundle.installTarget === undefined) return
    if (['checking', 'installing', 'cancelling', 'unknown'].includes(directInstaller.getSnapshot().phase)) return
    const { title } = officialBundleDisplay(bundle, english)
    setOverlay({ kind: 'manual-install' })
    void directInstaller.startManual(bundle.installTarget.spec, {
      saveExact: !bundle.installTarget.spec.startsWith('link:'),
      enabled,
      title,
    })
  }, [directInstaller, english])
  const updateState = useSyncExternalStore(pluginUpdater?.subscribe ?? (() => () => {}), pluginUpdater?.getSnapshot ?? (() => null))
  const [installedRevision, setInstalledRevision] = useState(0)
  const [ownedIndex, setOwnedIndex] = useState<ReadonlyMap<string, MarketInstalledPackage>>(() => new Map())
  const refreshInstalled = useCallback(() => setInstalledRevision(value => value + 1), [])
  const handleManualInstalled = useCallback(() => {
    refreshInstalled()
    void officialBundles?.refresh()
  }, [refreshInstalled, officialBundles])
  const closeManualPanel = useCallback(() => {
    setOverlay(current => (current.kind === 'manual-install' ? { kind: 'none' } : current))
  }, [])
  useEffect(() => { if (updateState?.revision) refreshInstalled() }, [updateState?.revision, refreshInstalled])
  const application = updateState?.result?.result.application
  const appliedUpdateRevision = updateState?.phase === 'done' && (application === 'applied' || application === 'restart-required')
    ? updateState.revision : 0
  const checkUpdate = pluginUpdater ? (packageName: string) => {
    const snap = pluginUpdater.getSnapshot()
    if (snap.phase === 'updating' || snap.batch.phase === 'running') return
    void pluginUpdater.check(packageName)
    setOverlay({ kind: 'update' })
  } : undefined
  const openBatchUpdate = pluginUpdater ? () => {
    if (pluginUpdater.getSnapshot().phase === 'updating') return
    setOverlay({ kind: 'batch-update' })
  } : undefined
  const probeUpdates = useCallback((packageNames: readonly string[]) => {
    void pluginUpdater?.probe(packageNames)
  }, [pluginUpdater])
  const [refreshByPage, setRefreshByPage] = useState<Partial<Record<RefreshPage, Omit<HeaderRefreshAction, 'onClick'>>>>({})
  const refreshHandlers = useRef<Partial<Record<RefreshPage, () => void>>>({})
  const registerRefresh = useCallback((target: RefreshPage, action: HeaderRefreshAction | null) => {
    if (action === null) {
      delete refreshHandlers.current[target]
      setRefreshByPage(prev => (prev[target] === undefined ? prev : { ...prev, [target]: undefined }))
      return
    }
    refreshHandlers.current[target] = action.onClick
    setRefreshByPage(prev => {
      const current = prev[target]
      if (current && current.label === action.label && current.busy === action.busy && current.disabled === action.disabled) {
        return prev
      }
      return { ...prev, [target]: { label: action.label, busy: action.busy, disabled: action.disabled } }
    })
  }, [])
  const onRegisterPluginsRefresh = useCallback((action: HeaderRefreshAction | null) => registerRefresh('plugins', action), [registerRefresh])
  const onRegisterSkillsRefresh = useCallback((action: HeaderRefreshAction | null) => registerRefresh('skills', action), [registerRefresh])
  const onRegisterMcpRefresh = useCallback((action: HeaderRefreshAction | null) => registerRefresh('mcp', action), [registerRefresh])
  const [mcpToolbar, setMcpToolbar] = useState<Pick<McpToolbarActions, 'canOpenDocument' | 'openingDocument' | 'canAdd'> | null>(null)
  const mcpToolbarHandlers = useRef<{ onOpenDocument?: () => void; onAdd?: () => void }>({})
  const onRegisterMcpToolbar = useCallback((actions: McpToolbarActions | null) => {
    if (actions === null) {
      mcpToolbarHandlers.current = {}
      setMcpToolbar(null)
      return
    }
    mcpToolbarHandlers.current = { onOpenDocument: actions.onOpenDocument, onAdd: actions.onAdd }
    setMcpToolbar(prev => (
      prev && prev.canOpenDocument === actions.canOpenDocument
        && prev.openingDocument === actions.openingDocument
        && prev.canAdd === actions.canAdd
        ? prev
        : { canOpenDocument: actions.canOpenDocument, openingDocument: actions.openingDocument, canAdd: actions.canAdd }
    ))
  }, [])
  const activeRefresh = page === 'settings' ? undefined : refreshByPage[page]
  const rawSelfUpdate = updateState?.available[PACKAGE_NAME] ?? ''
  const selfUpdateVersion = isSafeVersion(rawSelfUpdate) ? rawSelfUpdate : ''
  // The background probe fills `available` on entry, long before anyone opens
  // the installed filter: surfacing the count in the header is what makes
  // those updates visible without the tab switch. When more than the market
  // itself is updatable the header offers the batch panel instead of the
  // single self-update shortcut — the batch already queues the market last.
  const totalUpdatableCount = Object.keys(updateState?.available ?? {}).length
  // Count non-self rows by key, not through the version-safety gate: a self row
  // whose probed version fails the check still must not masquerade as a
  // third-party update and summon the batch entry on its own.
  const nonSelfUpdatableCount = Object.keys(updateState?.available ?? {}).filter(name => name !== PACKAGE_NAME).length
  const showBatchUpdateEntry = nonSelfUpdatableCount > 0 && openBatchUpdate !== undefined
  const searchDock = useSearchDock(page)
  const [cards, setCards] = useState<Readonly<Record<string, CardState>>>({})
  const [aiSkillFeedbackId, setAiSkillFeedbackId] = useState<string | null>(null)
  const tabsId = useId()
  // Mirror of the card states for same-tick guards (the rendered copy lags a
  // frame behind), and a live flag so a hand-off that resolves after the
  // section unmounted stops touching state.
  const cardsRef = useRef<Readonly<Record<string, CardState>>>({})
  const mounted = useRef(true)
  // Set on mount as well as cleared on unmount: React 18 StrictMode runs the
  // cleanup once immediately after the first mount, and a ref that is only
  // ever cleared would stay false for the rest of the component's life —
  // every async answer below would then be silently dropped.
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  // Count this opening once — the ref survives StrictMode's replayed effect,
  // so a mount is one open no matter how many times the effect re-runs. From
  // the third open on the star nudge is armed; answering it either way is
  // terminal, so this is the only effect that ever re-shows it.
  const [starPromptVisible, setStarPromptVisible] = useState(false)
  const starCounted = useRef(false)
  useEffect(() => {
    if (starCounted.current) return
    starCounted.current = true
    if (recordMarketOpen()) setStarPromptVisible(true)
  }, [])
  const settleStar = useCallback((outcome: 'dismissed' | 'starred') => {
    settleStarPrompt(outcome)
    // Peers (main view, sidebar, plugin tab) hide their copy immediately; the
    // origin tag keeps this instance's own listener out of the way, because a
    // starred settle here delays its unmount until the navigation commits.
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent(STAR_SETTLED_EVENT, { detail: tabsId }))
    }
    if (outcome === 'starred') {
      // Let the browser commit the target=_blank navigation before the anchor
      // unmounts — detaching the node in the same click task can cancel it.
      window.setTimeout(() => { if (mounted.current) setStarPromptVisible(false) }, 400)
    } else {
      setStarPromptVisible(false)
    }
  }, [tabsId])
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
    const onPeerSettled = (event: Event) => {
      if ((event as CustomEvent).detail === tabsId) return
      setStarPromptVisible(false)
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === STAR_PROMPT_STORAGE_KEY && !starPromptPending()) setStarPromptVisible(false)
    }
    window.addEventListener(STAR_SETTLED_EVENT, onPeerSettled)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(STAR_SETTLED_EVENT, onPeerSettled)
      window.removeEventListener('storage', onStorage)
    }
  }, [tabsId])
  // One review hand-off at a time: two cards clicked back to back must not
  // open two sessions and stage two drafts.
  const aiDraftBusy = Object.values(cards).some(card => card.status === 'busy' || card.status === 'picking')
  const installBusy = updateState?.phase === 'updating'
    || updateState?.batch.phase === 'running'
    || aiDraftBusy

  const report = (fullName: string, next: CardState): void => {
    cardsRef.current = { ...cardsRef.current, [fullName]: next }
    if (mounted.current) setCards(cardsRef.current)
  }

  const closeInstallPanel = (): void => {
    // This review belongs to the dismissed installation, not the next panel.
    const { [SELF_CARD_KEY]: _dismissedReview, ...remaining } = cardsRef.current
    cardsRef.current = remaining
    if (mounted.current) {
      setCards(remaining)
      setOverlay(current => (current.kind === 'direct-install' ? { kind: 'none' } : current))
    }
  }

  const runReview = async (cardKey: string, prompt: string, viaNewWorkspace: boolean, preferDefault = true): Promise<boolean> => {
    if (Object.values(cardsRef.current).some(card => card.status === 'busy' || card.status === 'picking')) return false
    report(cardKey, { status: viaNewWorkspace ? 'picking' : 'busy' })
    try {
      const outcome = viaNewWorkspace
        ? await installIntoNewWorkspace(prompt, { ...(preferDefault ? { preferDefault: true } : {}), ownerId: tabsId })
        : await install(prompt)
      if (outcome.ok) {
        report(cardKey, { status: 'staged' })
        close()
        return true
      }
      if (outcome.reason === 'no-workspace' || outcome.reason === 'cancelled') {
        report(cardKey, {
          status: 'needs-workspace',
          message: outcome.reason === 'cancelled' ? t('install.cancelled') : t('install.noWorkspace'),
        })
      } else {
        report(cardKey, { status: 'error', message: outcome.reason === 'not-ready'
          ? t('install.notReady') : outcome.reason === 'draft-exists'
            ? t('install.draftExists') : t('install.failed', { reason: outcome.message }) })
      }
    } catch (error) {
      report(cardKey, { status: 'error', message: t('install.failed', { reason: error instanceof Error ? error.message : String(error) }) })
    }
    return false
  }

  const pages: readonly { id: Page; label: string }[] = [
    { id: 'plugins', label: t('tab.plugins') },
    { id: 'skills', label: t('tab.skills') },
    ...(mcp ? [{ id: 'mcp' as const, label: t('tab.mcp') }] : []),
    { id: 'settings', label: t('tab.settings') },
  ]

  const onTabKey = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number): void => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    const next = step !== 0
      ? (index + step + pages.length) % pages.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? pages.length - 1 : -1
    if (next < 0) return
    event.preventDefault()
    setPage(pages[next]!.id)
    document.getElementById(`${tabsId}-tab-${pages[next]!.id}`)?.focus()
  }

  const reviewResult = cards[SELF_CARD_KEY]
  const reviewInstalled = (targets: ReviewTarget[]): Promise<boolean> => {
    const profile = snapshot.profile
    if (profile === null) return Promise.resolve(false)
    return runReview(SELF_CARD_KEY, buildReviewPrompt(t, { profile, targets }),
      workspaceReadiness.getSnapshot() === 'none')
  }
  /**
   * A catalog repository with no recorded install target is handed to the
   * agent instead of dead-ending the card: the prompt asks it to verify the
   * repository, resolve a package or subdirectory, then install through the
   * official manager. Staged as a draft the user sends.
   */
  const agentInstall = (item: MarketPlugin): void => {
    const profile = snapshot.profile
    if (profile === null || !item.fullName) return
    void runReview(SELF_CARD_KEY, buildInstallPrompt(t, { profile, repo: item.fullName, name: item.name }),
      workspaceReadiness.getSnapshot() === 'none').then(ok => { if (ok) closeInstallPanel() })
  }
  const aiPickCard = cards[AI_PICK_CARD_KEY]
  const tryAiAssistant = (): void => {
    setAiSkillFeedbackId(null)
    const prompt = page === 'mcp'
      ? t('ai.pickMcpPrompt')
      : page === 'skills'
        ? t('ai.pickSkillsPrompt')
        : t('ai.pickPrompt')
    void runReview(AI_PICK_CARD_KEY, prompt, workspaceReadiness.getSnapshot() === 'none')
  }
  const askAiInstallSkill = async (
    item: FeaturedSkill,
    target?: { readonly scope: FeaturedSkillInstallScope; readonly projectDir?: string },
  ): Promise<boolean> => {
    setAiSkillFeedbackId(item.id)
    const targetPath = target?.scope === 'user-agents'
      ? `~/.agents/skills/${item.name}`
      : target?.scope === 'project-dsh'
        ? `${target.projectDir?.trim() ? target.projectDir.trim().replace(/[\\/]+$/, '') : '<project>'}/.dsh/skills/${item.name}`
        : `~/.dsh/skills/${item.name}`
    const prompt = t('skills.featured.installPrompt', {
      id: item.id,
      name: item.name,
      source: item.source,
      path: item.path === '' ? t('skills.featured.pathRoot') : item.path,
      scope: target?.scope ?? 'user-dsh',
      target: targetPath,
    })
    return await runReview(AI_PICK_CARD_KEY, prompt, workspaceReadiness.getSnapshot() === 'none')
  }

  return (
    <div className="dsh_market_section" ref={searchDock.root} data-search-compact={searchDock.compact ? 'true' : undefined}>
      {/* The market's own version, where it is legible without scrolling. The
          installed panel does carry a row for the in-box seat now, but that
          row is one card among many and only exists while the seat is listed
          — the header states which market this is, always. */}
      <div className="dsh_market_headingRow">
        <h2 className="dsh_market_heading">
          {t('nav')}
          {isSafeVersion(snapshot.version) && <span className="dsh_market_selfVersion">{`v${snapshot.version}`}</span>}
        </h2>
        <div className="dsh_market_headerActions">
          {showBatchUpdateEntry && (
            <MarketButton
              intent="primary"
              className="dsh_market_selfUpdate"
              disabled={installBusy}
              title={t('batchUpdate.title')}
              onClick={() => { openBatchUpdate?.() }}
              icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 16V4m-5 5 5-5 5 5M5 20h14" />
              </svg>}
            >
              {`${t('installed.updateAll')} (${String(totalUpdatableCount)})`}
            </MarketButton>
          )}
          {!showBatchUpdateEntry && selfUpdateVersion !== '' && checkUpdate && (
            <MarketButton
              intent="primary"
              className="dsh_market_selfUpdate"
              disabled={installBusy}
              title={`${t('nav')} · ${t('update.to', { version: selfUpdateVersion })}`}
              onClick={() => checkUpdate(PACKAGE_NAME)}
              icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 16V4m-5 5 5-5 5 5M5 20h14" />
              </svg>}
            >
              {t('update.to', { version: selfUpdateVersion })}
            </MarketButton>
          )}
          {activeRefresh && page !== 'settings' && (
            <button
              type="button"
              className="dsh_market_headerAction"
              disabled={activeRefresh.disabled}
              aria-busy={activeRefresh.busy}
              onClick={() => refreshHandlers.current[page]?.()}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20 4v6h-6M20 10a8 8 0 1 0-1.7 7" />
              </svg>
              {activeRefresh.label}
            </button>
          )}
          <a
            className="dsh_market_headerAction"
            href={STAR_REPOSITORY_URL}
            target="_blank"
            rel="noreferrer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 19c-4.3 1.3-4.3-2.2-6-2.7M15 22v-3.8a3.3 3.3 0 0 0-.9-2.5c3-.3 6.2-1.5 6.2-6.9a5.4 5.4 0 0 0-1.5-3.8 5 5 0 0 0-.1-3.8s-1.2-.4-3.9 1.4a13.4 13.4 0 0 0-7 0C5.1.8 3.9 1.2 3.9 1.2A5 5 0 0 0 3.8 5a5.4 5.4 0 0 0-1.5 3.8c0 5.4 3.2 6.6 6.2 6.9a3.3 3.3 0 0 0-.9 2.5V22" />
            </svg>
            {t('header.repository')}
          </a>
        </div>
      </div>
      <p className="dsh_market_subtitle">{t('intro.slogan')}</p>
      {updateState && updateState.phase !== 'idle' && !updateOpen && (
        <button type="button" className="dsh_market_headerAction" onClick={() => setOverlay({ kind: 'update' })}>
          {t('update.resume')} · {updateState.packageName}
        </button>
      )}
      {updateState && updateState.batch.phase !== 'idle' && !batchUpdateOpen && (
        <button type="button" className="dsh_market_headerAction" onClick={() => setOverlay({ kind: 'batch-update' })}>
          {t('batchUpdate.resume')}
        </button>
      )}
      {directInstaller && <DirectInstallPanel item={directItem} installer={directInstaller} ownedIndex={ownedIndex} t={t}
        onClose={closeInstallPanel} onInstalled={refreshInstalled}
        onReview={reviewInstalled} onAgentInstall={directItem ? () => agentInstall(directItem) : undefined}
        reviewBusy={installBusy} reviewAvailable={snapshot.profile !== null}
        reviewMessage={reviewResult?.status === 'error' || reviewResult?.status === 'needs-workspace' ? reviewResult.message : ''} />}
      {directInstaller && <ManualInstallPanel open={overlay.kind === 'manual-install'} installer={directInstaller} t={t}
        onClose={closeManualPanel}
        onInstalled={handleManualInstalled}
        onReview={reviewInstalled} reviewBusy={installBusy} reviewAvailable={snapshot.profile !== null}
        reviewMessage={reviewResult?.status === 'error' || reviewResult?.status === 'needs-workspace' ? reviewResult.message : ''} />}
      {pluginUpdater && updateState && <PluginUpdatePanel open={updateOpen} state={updateState} updater={pluginUpdater} t={t}
        onClose={() => setOverlay(current => (current.kind === 'update' ? { kind: 'none' } : current))} />}
      {pluginUpdater && updateState && <BatchUpdatePanel open={batchUpdateOpen} state={updateState} updater={pluginUpdater} t={t}
        onClose={() => setOverlay(current => (current.kind === 'batch-update' ? { kind: 'none' } : current))} />}
      <div className="dsh_market_tabToolbar">
      <div className="dsh_market_tabs" role="tablist" aria-label={t('tabs.aria')}>
        {pages.map((entry, index) => (
          <button
            key={entry.id}
            id={`${tabsId}-tab-${entry.id}`}
            type="button"
            role="tab"
            className="dsh_market_tab"
            aria-selected={page === entry.id}
            aria-controls={`${tabsId}-panel-${entry.id}`}
            data-active={page === entry.id ? 'true' : undefined}
            tabIndex={page === entry.id ? 0 : -1}
            onClick={() => { setPage(entry.id) }}
            onKeyDown={(event) => { onTabKey(event, index) }}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {((page === 'plugins' && directInstaller !== undefined)
        || (page === 'mcp' && mcpToolbar && (mcpToolbar.canOpenDocument || mcpToolbar.canAdd))
        || (snapshot.settingsReady && snapshot.value.aiAssistantEnabled)) && (
        <div className="dsh_market_tabToolbarActions">
          {page === 'mcp' && mcpToolbar?.canOpenDocument && (
            <MarketButton
              intent="secondary"
              title={t('mcp.openDocument.hint')}
              disabled={mcpToolbar.openingDocument}
              onClick={() => mcpToolbarHandlers.current.onOpenDocument?.()}
              icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
              </svg>}
            >
              {t('mcp.openDocument')}
            </MarketButton>
          )}
          {snapshot.settingsReady && snapshot.value.aiAssistantEnabled && (
            <MarketButton
              intent="secondary"
              className="dsh_market_aiPick"
              disabled={installBusy}
              onClick={tryAiAssistant}
              icon={<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3 14.3 9.7 21 12 14.3 14.3 12 21 9.7 14.3 3 12 9.7 9.7Z" />
              </svg>}
            >
              {page === 'mcp' ? t('ai.pickMcp') : page === 'skills' ? t('ai.pickSkills') : t('ai.pick')}
            </MarketButton>
          )}
          {page === 'plugins' && directInstaller && (
            <MarketButton
              intent="primary"
              disabled={installBusy}
              onClick={() => setOverlay({ kind: 'manual-install' })}
              icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>}
            >
              {t('manual.open')}
            </MarketButton>
          )}
          {page === 'mcp' && mcpToolbar?.canAdd && (
            <MarketButton
              intent="primary"
              onClick={() => mcpToolbarHandlers.current.onAdd?.()}
            >
              {t('mcp.add')}
            </MarketButton>
          )}
        </div>
      )}
      </div>
      {aiPickCard && (aiPickCard.status === 'error' || aiPickCard.status === 'needs-workspace') && page !== 'settings' && (
        <p className="dsh_market_status" data-error={aiPickCard.status === 'error' ? 'true' : undefined} role="status">
          {aiPickCard.message}
        </p>
      )}
      {starPromptVisible && page !== 'settings' && <StarPromptCard t={t} onSettle={settleStar} />}
      {/* The Plugins panel stays mounted across tab switches: unmounting it
          would drop the search/filter state and re-pull the catalog on every
          return. The Skills panel remounts per visit, so each visit re-reads
          the live skill list. */}
      <div
        id={`${tabsId}-panel-plugins`}
        className="dsh_market_scroll"
        role="tabpanel"
        aria-labelledby={`${tabsId}-tab-plugins`}
        hidden={page !== 'plugins'}
      >
        <PluginsPage
          setDirectItem={openDirectItem}
          installedRevision={installedRevision}
          appliedUpdateRevision={appliedUpdateRevision}
          onCheckUpdate={checkUpdate}
          onOpenBatchUpdate={showBatchUpdateEntry ? undefined : openBatchUpdate}
          availableUpdates={updateState?.available}
          onProbeUpdates={probeUpdates}
          onRegisterRefresh={onRegisterPluginsRefresh}
          onOwnedIndexChange={setOwnedIndex}
          t={t}
          english={english}
          snapshot={snapshot}
          loadCatalog={loadCatalog}
          peekCatalog={peekCatalog}
          listInstalled={listInstalled}
          subscribeInstalledChanges={subscribeInstalledChanges}
          setInstalledEnabled={setInstalledEnabled}
          uninstallInstalled={uninstallInstalled}
          officialBundles={officialBundles}
          onInstallOfficialBundle={installOfficialBundle}
          chooseWorkspace={() => chooseWorkspace(tabsId)}
          workspaceReadiness={workspaceReadiness}
          cards={cards}
          installBusy={installBusy}
          onReviewDraft={runReview}
          onOpenSettings={() => { setPage('settings') }}
          directInstaller={directInstaller}
        />
      </div>
      {page === 'skills' && (
        <div
          id={`${tabsId}-panel-skills`}
          className="dsh_market_scroll"
          role="tabpanel"
          aria-labelledby={`${tabsId}-tab-skills`}
        >
          <SkillsView
            t={t}
            listSkills={listSkills}
            skillsSession={skillsSession}
            installFeaturedSkill={installFeaturedSkill}
            deleteInstalledSkill={deleteInstalledSkill}
            pickProjectDir={directoryBrowser ? () => directoryBrowser.pick(tabsId) : undefined}
            canOpenFolder={canOpenFolder}
            openFolder={openFolder}
            onRegisterRefresh={onRegisterSkillsRefresh}
            onAskAiInstall={askAiInstallSkill}
            aiInstallBusy={aiDraftBusy}
            aiInstallFeedback={aiSkillFeedbackId !== null && (aiPickCard?.status === 'error' || aiPickCard?.status === 'needs-workspace')
              ? { skillId: aiSkillFeedbackId, status: aiPickCard.status, message: aiPickCard.message }
              : null}
          />
        </div>
      )}
      {page === 'mcp' && mcp && (
        <div
          id={`${tabsId}-panel-mcp`}
          className="dsh_market_scroll"
          role="tabpanel"
          aria-labelledby={`${tabsId}-tab-mcp`}
        >
          <McpView
            t={t}
            controller={mcp}
            onBrowsePlugins={() => { setPage('plugins') }}
            onRegisterRefresh={onRegisterMcpRefresh}
            onRegisterToolbarActions={onRegisterMcpToolbar}
          />
        </div>
      )}
      {page === 'settings' && (
        <div
          id={`${tabsId}-panel-settings`}
          className="dsh_market_scroll"
          role="tabpanel"
          aria-labelledby={`${tabsId}-tab-settings`}
        >
          <SettingsView
            t={t}
            settings={snapshot.value}
            settingsReady={snapshot.settingsReady}
            telemetrySuppressedByEnv={snapshot.telemetrySuppressedByEnv === true}
            updateSettings={updateSettings}
            onTryAssistant={tryAiAssistant}
            tryBusy={installBusy}
            tryMessage={aiPickCard?.status === 'error' || aiPickCard?.status === 'needs-workspace' ? aiPickCard.message : ''}
            onStarred={() => settleStar('starred')}
          />
        </div>
      )}
      {directoryBrowser && <DirectoryBrowserPanel controller={directoryBrowser} ownerId={tabsId} t={t} />}
      <BackToTop root={searchDock.root} page={page} label={t('backToTop')} />
    </div>
  )
}
