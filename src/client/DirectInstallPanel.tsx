import { MarketButton } from './MarketButton.tsx'
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { IconCloseOutlineRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { evaluateTargetsCompatibility } from '../compatibility.ts'
import type { MarketInstalledPackage, MarketPlugin } from '../contract.ts'
import { isSafeVersion } from '../shapes.ts'
import type { MarketLocale } from './copy.ts'
import {
  compatBadgeText,
  formatFallbackNoticeText,
  formatInstallIncompatHeading,
  formatPreInstallCompatText,
} from './compatCopy.ts'
import { InstallStatusBanner } from './InstallStatusBanner.tsx'
import { installChoices, installLabel } from './installTargets.ts'
import { ownedByTarget } from './owned.ts'
import {
  reconcileSelectedTargets,
  shouldRefreshInstalledAfterDirect,
  type DirectInstaller,
} from './directInstall.ts'
import { installedReviewTargets, type ReviewTarget } from './reviewPrompt.ts'
import { PluginLogo } from './PluginLogo.tsx'

/** One shared installation remains observable if the recommendation page remounts. */
export function DirectInstallPanel({ item, installer, ownedIndex, dshVersion, t, onClose, onInstalled, onReview, onAgentInstall, reviewBusy, reviewAvailable, reviewMessage }: {
  item: MarketPlugin | null; installer: DirectInstaller
  ownedIndex?: ReadonlyMap<string, MarketInstalledPackage>
  dshVersion?: string
  t: MarketLocale
  onClose: () => void; onInstalled: () => void
  onReview: (targets: ReviewTarget[]) => Promise<boolean>
  onAgentInstall?: () => void
  reviewBusy: boolean; reviewAvailable: boolean; reviewMessage: string
}) {
  const state = useSyncExternalStore(installer.subscribe, installer.getSnapshot)
  const [selected, setSelected] = useState<number[]>([0])
  const [submitted, setSubmitted] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const ownedIndexRef = useRef(ownedIndex)
  ownedIndexRef.current = ownedIndex
  const dshVersionRef = useRef(dshVersion)
  dshVersionRef.current = dshVersion
  const userTouchedRef = useRef(false)
  const id = useId()
  const open = !dismissed && (item !== null || (state.phase !== 'idle' && state.origin !== 'manual'))
  const busy = ['checking', 'installing', 'cancelling', 'unknown'].includes(state.phase)
  const visibleItem = busy && !submitted ? null : item
  const dismiss = () => { setDismissed(true); installer.reset(); onClose() }
  const info = visibleItem?.installInfo
  const targets = installChoices(info?.targets ?? [])
  const showResult = submitted || busy || state.phase === 'unavailable' || !item
  useEffect(() => {
    userTouchedRef.current = false
    const initialTargets = installChoices(item?.installInfo?.targets ?? [])
    setSelected(reconcileSelectedTargets(initialTargets, [], ownedIndexRef.current, false, dshVersionRef.current, item?.installInfo?.requirements))
    setSubmitted(false)
    if (item) setDismissed(false)
  }, [item])
  useEffect(() => {
    if (showResult || !item) return
    const itemTargets = installChoices(item.installInfo?.targets ?? [])
    setSelected(previous => reconcileSelectedTargets(itemTargets, previous, ownedIndex, userTouchedRef.current, dshVersion, item.installInfo?.requirements))
  }, [item, ownedIndex, showResult, dshVersion])
  useEffect(() => {
    if (state.origin !== 'manual' && shouldRefreshInstalledAfterDirect(state)) onInstalled()
  }, [state, onInstalled])
  const targetOwned = (spec: string): MarketInstalledPackage | undefined =>
    ownedIndex ? ownedByTarget(ownedIndex, spec) : undefined
  const targetsEval = evaluateTargetsCompatibility(targets, dshVersion, info?.requirements)
  const chosen = targets.filter((target, i) =>
    selected.includes(i) && (showResult || (targetOwned(target.install) === undefined && targetsEval.targetIssues[i] === undefined)))
  const available = info?.mode === 'command' && targets.length > 0
  const singleAlreadyInstalled = !showResult && available && targets.length === 1
    ? targetOwned(targets[0]!.install)
    : undefined
  const allAlreadyInstalled = !showResult && available && targets.length > 0
    && targets.every(target => targetOwned(target.install) !== undefined)
  const remainingEntries = !showResult && available
    ? targets
      .map((target, index) => ({ target, issue: targetsEval.targetIssues[index] }))
      .filter(({ target }) => targetOwned(target.install) === undefined)
    : []
  const remainingCompatIssue = remainingEntries.length > 0 && remainingEntries.every(entry => entry.issue !== undefined)
    ? evaluateTargetsCompatibility(
      remainingEntries.map(entry => entry.target),
      dshVersion,
      targets.length === 1 ? info?.requirements : undefined,
    ).blockingIssue
    : undefined
  const allRemainingIncompatible = !showResult && available && !allAlreadyInstalled && remainingCompatIssue !== undefined
  const fallbackTargets = remainingEntries
    .filter(entry => entry.issue === undefined && entry.target.compatFallback !== undefined)
    .map(entry => entry.target)
  const detailTargets = singleAlreadyInstalled !== undefined || (targets.length === 1 && remainingCompatIssue !== undefined) ? targets : chosen
  const manual = available ? '' : info?.manual
  const showDetails = detailTargets.length > 0 || Boolean(info?.requirements.length || info?.note || manual)
  const needsApproval = showResult && state.phase === 'failed' && state.pendingBuilds.length > 0
  const isIncompatFailure = showResult && state.phase === 'failed' && state.errorCode === 'incompatible-version'
  const finished = showResult && state.phase === 'done'
  const canDismiss = !busy || (state.phase === 'unknown' && !state.recovering)
  const start = () => { if (chosen.length) { setSubmitted(true); void installer.start(chosen.map(target => target.install)) } }
  const reviewTargets = showResult && !busy ? installedReviewTargets(state) : []
  const reviewButton = reviewTargets.length > 0 ? <MarketButton
    size="md"
    intent="secondary"
    disabled={reviewBusy || !reviewAvailable}
    title={!reviewAvailable ? t('install.profilePending') : undefined}
    onClick={() => { void onReview(reviewTargets).then(ok => { if (ok) dismiss() }) }}
  >
    {reviewBusy ? t('installing') : t('audit.action')}
  </MarketButton> : null
  const english = t('lang') === 'en'
  const description = english ? visibleItem?.descriptionEn || visibleItem?.description : visibleItem?.description
  const heading = (english ? visibleItem?.titleEn : visibleItem?.titleZh) || visibleItem?.name || state.spec || t('direct.title')
  return <Modal open={open} headless title={heading} className="dsh_market_modal"
    onClose={() => { if (canDismiss && !reviewBusy) dismiss() }}>
  <div className="dsh_market_directPanel">
    <div className="dsh_market_directHead">
      {visibleItem && <PluginLogo src={visibleItem.icon} name={visibleItem.name} fullName={visibleItem.fullName} />}
      <div className="dsh_market_installHeading">
        <span>{t('direct.title')}</span>
        <h3>{heading}</h3>
        {visibleItem && <small>{visibleItem.packageName || visibleItem.fullName}</small>}
      </div>
      {canDismiss && <button type="button" disabled={reviewBusy} className="dsh_market_directClose" aria-label={t('direct.close')} onClick={dismiss}>
        <IconCloseOutlineRegular size={16} />
      </button>}
    </div>
    {visibleItem && !showResult && description && <p className="dsh_market_installSummary">{description}</p>}
    {singleAlreadyInstalled !== undefined && <div className="dsh_market_installStatus" role="status" aria-live="polite">
      <strong>
        {isSafeVersion(singleAlreadyInstalled.version)
          ? t('installedHere', { version: singleAlreadyInstalled.version })
          : t('installedHereUnknown')}
      </strong>
    </div>}
    {remainingCompatIssue !== undefined && (
      <div className="dsh_market_compatBanner" role="alert">
        <strong>{formatInstallIncompatHeading(remainingCompatIssue.direction, t)}</strong>
        <p>{formatPreInstallCompatText(remainingCompatIssue, t)}</p>
      </div>
    )}
    {fallbackTargets.length > 0 && fallbackTargets.map(target => (
      <div key={`fb-${target.install}`} className="dsh_market_compatBanner" data-tone="info" role="status">
        <strong>{t('compat.fallbackTitle')}</strong>
        <p>{formatFallbackNoticeText(target.compatFallback!, dshVersion, t)}</p>
      </div>
    ))}
    {showResult && (
      <InstallStatusBanner
        phase={state.phase}
        application={state.application}
        errorCode={state.errorCode}
        incompatible={state.incompatible}
        pendingBuilds={state.pendingBuilds}
        message={state.message}
        queueLength={state.queue.length}
        dshVersion={dshVersion}
        t={t}
      />
    )}
    {showResult && state.queue.length > 1 && <ul className="dsh_market_installQueue" aria-label={t('direct.progress')}>
      {state.queue.map(entry => <li key={entry.spec}>
        <span>{installLabel(entry.spec)}</span>
        <small>{entry.phase === 'idle' ? t('direct.notStarted') : entry.application && entry.application !== 'failed'
          ? t(`direct.${entry.application as 'applied' | 'restart-required' | 'overridden' | 'cancelled'}`) : t(`direct.${entry.phase}`)}</small>
        {entry.message && entry.spec !== state.spec && <details><summary>{t('direct.diagnostic')}</summary><pre className="dsh_market_directMessage">{entry.message}</pre></details>}
      </li>)}
    </ul>}
    {visibleItem && !available && <div className="dsh_market_installUnavailable">
      <p>{t('direct.noTarget')}</p>
      <p>{t('direct.agentHint')}</p>
      {reviewMessage && <p role="status">{reviewMessage}</p>}
    </div>}
    {visibleItem && available && !showResult && targets.length > 1 && <fieldset className="dsh_market_installChoices" disabled={busy || showResult}>
      <legend>{t('direct.target')}</legend><p>{t('direct.multiHint')}</p>
      {targets.map((entry, i) => {
        const alreadyInstalled = targetOwned(entry.install)
        const compatIssue = alreadyInstalled === undefined ? targetsEval.targetIssues[i] : undefined
        const choiceDisabled = alreadyInstalled !== undefined || compatIssue !== undefined
        return <label key={entry.install} className="dsh_market_installChoice"
          data-installed={alreadyInstalled ? 'true' : undefined}
          data-incompatible={compatIssue ? compatIssue.direction : undefined}>
          <input type="checkbox" name={`${id}-component`} value={i} disabled={choiceDisabled}
            checked={!choiceDisabled && selected.includes(i)}
            onChange={() => {
              userTouchedRef.current = true
              setSelected(previous => previous.includes(i) ? previous.filter(index => index !== i) : [...previous, i])
              setSubmitted(false)
            }} />
          <span>{installLabel(entry.install)}</span>
          {alreadyInstalled !== undefined && (
            <span className="dsh_market_owned dsh_market_choiceOwned" title={alreadyInstalled.packageName}>
              {isSafeVersion(alreadyInstalled.version)
                ? t('installedHere', { version: alreadyInstalled.version })
                : t('installedHereUnknown')}
            </span>
          )}
          {compatIssue !== undefined && (
            <span className="dsh_market_choiceCompat" title={formatPreInstallCompatText(compatIssue, t)}>
              {compatBadgeText(compatIssue.direction, t)}
            </span>
          )}
        </label>
      })}
    </fieldset>}
    {visibleItem && showDetails && <details className="dsh_market_installDetails" key={visibleItem.packageName || visibleItem.fullName} open={available}>
      <summary>{t('direct.more')}<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg></summary>
      <div className="dsh_market_installDetailsBody">
        {detailTargets.map(target => <div key={target.install} className="dsh_market_installTarget"><code>{target.install}</code>{target.note && <p>{target.note}</p>}</div>)}
        {info?.requirements.length ? <ul className="dsh_market_installRequirements">{info.requirements.map((r, i) => <li key={i}>{r}</li>)}</ul> : null}
        {info?.note && <p>{info.note}</p>}
        {manual && <p>{manual}</p>}
      </div>
    </details>}
    {reviewTargets.length > 0 && reviewMessage && <p role="status">{reviewMessage}</p>}
    <fieldset className="dsh_market_installFooter" disabled={reviewBusy}>
      {needsApproval ? <>
        <MarketButton size="md" intent="secondary" onClick={dismiss}>{t('direct.decline')}</MarketButton>
        <MarketButton size="md" intent="primary" onClick={() => { void installer.approve() }}>{t('direct.allowContinue')}</MarketButton>
      </> : finished ? <>
        {reviewButton}
        <MarketButton size="md" intent="primary" onClick={dismiss}>{t('direct.finish')}</MarketButton>
      </>
        : state.phase === 'unavailable' ? <>
          {reviewButton}
          <MarketButton size="md" intent="primary" onClick={dismiss}>{t('direct.finishUnconfirmed')}</MarketButton>
        </>
        : state.phase === 'unknown' ? <MarketButton size="md" intent="primary" disabled={state.recovering} aria-busy={state.recovering} onClick={() => { void installer.recover() }}>{state.recovering ? t('direct.recovering') : t('direct.recover')}</MarketButton>
        : busy ? <MarketButton size="md" intent="secondary" disabled={state.phase !== 'installing'} onClick={() => { void installer.cancel() }}>{t('direct.cancel')}</MarketButton>
        : allAlreadyInstalled ? <MarketButton size="md" intent="primary" onClick={dismiss}>{t('direct.close')}</MarketButton>
        : (available || (showResult && state.phase === 'failed')) ? <>
          {visibleItem && (allRemainingIncompatible || isIncompatFailure) && (
            <a className="dsh_market_link" href={visibleItem.url} target="_blank" rel="noreferrer">
              {t(visibleItem.fullName ? 'repo' : 'package.page')}
            </a>
          )}
          <MarketButton size="md" intent="secondary" onClick={dismiss}>{t(showResult ? 'direct.close' : 'direct.dismiss')}</MarketButton>
          {reviewButton}
          {!isIncompatFailure && (
            <MarketButton size="md" intent="primary" disabled={!chosen.length && !showResult} onClick={showResult && state.phase === 'failed' ? () => { void installer.retry() } : start}>{showResult && state.phase === 'failed' ? t('direct.retry') : `${t('direct.confirm')}${chosen.length > 1 ? ` (${chosen.length})` : ''}`}</MarketButton>
          )}
        </>
        : <>
          {visibleItem && <a className="dsh_market_link" href={visibleItem.url} target="_blank" rel="noreferrer">{t(visibleItem.fullName ? 'repo' : 'package.page')}</a>}
          <MarketButton size="md" intent="secondary" onClick={dismiss}>{t('direct.close')}</MarketButton>
          {visibleItem && onAgentInstall && <MarketButton size="md" intent="primary" disabled={reviewBusy}
            onClick={() => { if (canDismiss) onAgentInstall() }}>{reviewBusy ? t('installing') : t('direct.agentInstall')}</MarketButton>}
        </>}
    </fieldset>
  </div>
  </Modal>
}
