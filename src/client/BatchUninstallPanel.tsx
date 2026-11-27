import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { IconCloseOutlineRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarketInstalledPackage } from '../contract.ts'
import { PACKAGE_NAME } from '../shapes.ts'
import {
  isBatchUninstallSuccess,
  orderBatchUninstallTargets,
  type BatchUninstallItem,
  type BatchUninstallItemStatus,
  type BatchUninstallState,
  type BatchUninstallTarget,
  type BatchUninstaller,
} from './batchUninstall.ts'
import type { MarketLocale } from './copy.ts'
import { MarketButton } from './MarketButton.tsx'
import { shortName } from './owned.ts'

function itemTone(status: BatchUninstallItemStatus): 'ok' | 'warn' | 'error' | 'active' | 'muted' {
  if (status === 'removed') return 'ok'
  if (status === 'restart-required' || status === 'removed-with-faults' || status === 'skipped') return 'warn'
  if (status === 'failed') return 'error'
  if (status === 'running') return 'active'
  return 'muted'
}

function statusText(t: MarketLocale, item: BatchUninstallItem, elapsed: number): string {
  if (item.status === 'running') {
    return elapsed >= 3 ? `${t('installed.uninstalling')} ${String(elapsed)}s` : t('installed.uninstalling')
  }
  return t(`batchUninstall.status.${item.status}`)
}

function useItemElapsedSeconds(active: boolean, resetKey: number): number {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!active) {
      setSeconds(0)
      return
    }
    const startedAt = Date.now()
    setSeconds(0)
    const timer = window.setInterval(() => {
      setSeconds(Math.max(1, Math.floor((Date.now() - startedAt) / 1000)))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [active, resetKey])
  return seconds
}

/** Three-stage sequential batch uninstaller: confirm selection -> run sequentially -> summary. */
export function BatchUninstallPanel({ open, state, uninstaller, packages, busy = false, t, onClose }: {
  open: boolean
  state: BatchUninstallState
  uninstaller: BatchUninstaller
  packages: readonly MarketInstalledPackage[]
  busy?: boolean
  t: MarketLocale
  onClose: () => void
}): ReactElement {
  const candidates = useMemo<readonly BatchUninstallTarget[]>(
    () => orderBatchUninstallTargets(
      packages.map(pkg => ({
        packageName: pkg.packageName,
        version: pkg.version,
        self: pkg.self,
        inBox: pkg.inBox,
        unregistered: pkg.unregistered,
      })),
      PACKAGE_NAME,
    ),
    [packages],
  )
  const [selected, setSelected] = useState<readonly string[]>([])
  const initializedSelection = useRef(false)

  useEffect(() => {
    if (!open || state.phase !== 'idle') {
      initializedSelection.current = false
      return
    }
    if (!initializedSelection.current) {
      initializedSelection.current = true
      setSelected([])
    }
  }, [open, state.phase])

  const selectedSet = useMemo(() => new Set(selected), [selected])
  const chosenTargets = useMemo(
    () => candidates.filter(item => selectedSet.has(item.packageName)),
    [candidates, selectedSet],
  )
  const chosenCount = chosenTargets.length
  const selectedHasSelf = chosenTargets.some(item => item.self)

  const selectableForSelectAll = useMemo(() => {
    const nonSelf = candidates.filter(item => !item.self).map(item => item.packageName)
    return nonSelf.length > 0 ? nonSelf : candidates.map(item => item.packageName)
  }, [candidates])
  const allSelected = selectableForSelectAll.length > 0
    && selectableForSelectAll.every(name => selectedSet.has(name))

  const running = state.phase === 'running'
  const elapsed = useItemElapsedSeconds(running, state.currentIndex)

  const close = () => {
    if (running) {
      onClose()
      return
    }
    uninstaller.reset()
    onClose()
  }

  const toggle = (packageName: string) => {
    setSelected(previous => (
      previous.includes(packageName)
        ? previous.filter(name => name !== packageName)
        : [...previous, packageName]
    ))
  }

  const toggleSelectAll = () => {
    setSelected(allSelected ? [] : selectableForSelectAll)
  }

  const start = () => {
    if (!busy && chosenTargets.length > 0) void uninstaller.start(chosenTargets)
  }

  const total = state.items.length
  const succeeded = state.items.filter(item => isBatchUninstallSuccess(item.status)).length
  const failed = state.items.filter(item => item.status === 'failed').length
  const skipped = state.items.filter(item => item.status === 'skipped').length
  const finishedCount = succeeded + failed + skipped
  const remaining = Math.max(0, total - finishedCount)
  const restartCount = state.items.filter(item => item.status === 'restart-required').length
  const faultsCount = state.items.filter(item => item.status === 'removed-with-faults').length

  const currentPackageSet = useMemo(() => new Set(packages.map(pkg => pkg.packageName)), [packages])
  const retryableTargets: BatchUninstallTarget[] = state.items
    .filter(item => item.status === 'failed' && currentPackageSet.has(item.packageName))
    .map(item => ({
      packageName: item.packageName,
      version: item.version,
      self: item.self,
      inBox: item.inBox,
      unregistered: item.unregistered,
    }))

  const currentStepNumber = state.currentIndex >= 0 ? Math.min(total, state.currentIndex + 1) : total
  const percent = total > 0 ? Math.round((finishedCount / total) * 100) : 0

  const title = state.phase === 'running'
    ? t('batchUninstall.runningTitle', { current: String(currentStepNumber), total: String(total) })
    : state.phase === 'done'
      ? t('batchUninstall.doneTitle')
      : t('batchUninstall.title')

  return (
    <Modal open={open} headless title={title} className="dsh_market_modal" onClose={close}>
      <div className="dsh_market_directPanel dsh_market_updateDialog">
        <div className="dsh_market_directHead">
          <div className="dsh_market_installHeading">
            <span>{t('installed.chip')}</span>
            <h3>{title}</h3>
          </div>
          <button type="button" className="dsh_market_directClose" aria-label={t('direct.close')} onClick={close}>
            <IconCloseOutlineRegular size={16} />
          </button>
        </div>

        <div className="dsh_market_updateBody">
          {state.phase === 'idle' && (
            <>
              <p>{t('batchUninstall.subtitle')}</p>
              {candidates.length > 0 ? (
                <>
                  <div className="dsh_market_batchSelectBar">
                    <span>{t('batchUninstall.selectedCount', { selected: String(chosenCount), total: String(candidates.length) })}</span>
                    <MarketButton size="sm" intent="quiet" onClick={toggleSelectAll}>
                      {allSelected ? t('batchUninstall.deselectAll') : t('batchUninstall.selectAll')}
                    </MarketButton>
                  </div>
                  <fieldset className="dsh_market_installChoices">
                    <div className="dsh_market_updateChoiceList">
                      {candidates.map(item => (
                        <label className="dsh_market_installChoice dsh_market_batchChoice" key={item.packageName}>
                          <input
                            type="checkbox"
                            checked={selectedSet.has(item.packageName)}
                            onChange={() => toggle(item.packageName)}
                          />
                          <span className="dsh_market_batchChoiceMain">
                            <span className="dsh_market_batchNameRow">
                              <strong title={item.packageName}>{shortName(item.packageName)}</strong>
                              {item.self && <em className="dsh_market_updateBadge">{t('batchUninstall.selfLast')}</em>}
                              {item.inBox && <em className="dsh_market_updateBadge">{t('installed.inBox')}</em>}
                              {item.unregistered && <em className="dsh_market_updateBadge">{t('installed.unregistered')}</em>}
                            </span>
                            {item.version !== '' && (
                              <small className="dsh_market_batchTransition">{`v${item.version}`}</small>
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  {selectedHasSelf && (
                    <p className="dsh_market_batchWarn" role="note">{t('batchUninstall.selfWarning')}</p>
                  )}
                </>
              ) : (
                <p>{t('installed.empty')}</p>
              )}
              <p>{t('batchUninstall.notice')}</p>
            </>
          )}

          {state.phase === 'running' && (
            <>
              <div className="dsh_market_batchProgress">
                <div className="dsh_market_batchProgressTrack" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                  <div className="dsh_market_batchProgressFill dsh_market_batchProgressFillDanger" style={{ width: `${String(percent)}%` }} />
                </div>
                <p className="dsh_market_batchProgressText" role="status" aria-live="polite">
                  {t('batchUninstall.progress', { done: String(succeeded), failed: String(failed), remaining: String(remaining) })}
                </p>
              </div>
              {elapsed >= 15 && (
                <p className="dsh_market_cardNotice" aria-live="polite">{t('installed.uninstallingSlow')}</p>
              )}
              <ul className="dsh_market_installQueue dsh_market_batchQueue" aria-label={t('batchUninstall.title')}>
                {state.items.map(item => (
                  <li key={item.packageName}>
                    <div className="dsh_market_batchRowHead">
                      <span className="dsh_market_batchRowName" title={item.packageName}>
                        <strong>{shortName(item.packageName)}</strong>
                        {item.self && <em className="dsh_market_updateBadge">{t('batchUninstall.selfLast')}</em>}
                      </span>
                      <span className="dsh_market_batchState" data-tone={itemTone(item.status)}>
                        {statusText(t, item, elapsed)}
                      </span>
                    </div>
                    {item.version !== '' && <small>{`v${item.version}`}</small>}
                  </li>
                ))}
              </ul>
            </>
          )}

          {state.phase === 'done' && (
            <>
              <div className="dsh_market_installStatus" role="status" aria-live="polite">
                <strong>
                  {skipped > 0
                    ? t('batchUninstall.summarySkipped', { total: String(total), succeeded: String(succeeded), failed: String(failed), skipped: String(skipped) })
                    : t('batchUninstall.summary', { total: String(total), succeeded: String(succeeded), failed: String(failed) })}
                </strong>
                {restartCount > 0 && <p>{t('batchUninstall.restartHint', { count: String(restartCount) })}</p>}
                {faultsCount > 0 && <p>{t('batchUninstall.faultsHint', { count: String(faultsCount) })}</p>}
              </div>
              <ul className="dsh_market_installQueue dsh_market_batchQueue" aria-label={t('batchUninstall.doneTitle')}>
                {state.items.map(item => (
                  <li key={item.packageName}>
                    <div className="dsh_market_batchRowHead">
                      <span className="dsh_market_batchRowName" title={item.packageName}>
                        <strong>{shortName(item.packageName)}</strong>
                        {item.self && <em className="dsh_market_updateBadge">{t('batchUninstall.selfLast')}</em>}
                      </span>
                      <span className="dsh_market_batchState" data-tone={itemTone(item.status)}>
                        {statusText(t, item, 0)}
                      </span>
                    </div>
                    {item.version !== '' && <small>{`v${item.version}`}</small>}
                    {item.notice !== undefined && item.notice !== '' && (
                      <small>{item.notice}</small>
                    )}
                    {item.status === 'failed' && item.message !== undefined && item.message !== '' && (
                      <details className="dsh_market_installDiagnostic">
                        <summary>{t('direct.diagnostic')}</summary>
                        <pre className="dsh_market_directMessage">{item.message}</pre>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="dsh_market_updateActions">
          {state.phase === 'idle' && (
            <>
              <MarketButton size="md" intent="secondary" onClick={close}>{t('direct.dismiss')}</MarketButton>
              <MarketButton size="md" intent="danger" disabled={chosenCount === 0 || busy} onClick={start}>
                {t('batchUninstall.start', { count: String(chosenCount) })}
              </MarketButton>
            </>
          )}
          {state.phase === 'running' && (
            <MarketButton
              size="md"
              intent="secondary"
              disabled={state.stopRequested}
              onClick={() => uninstaller.requestStop()}
            >
              {state.stopRequested ? t('batchUninstall.stopping') : t('batchUninstall.stopAfter')}
            </MarketButton>
          )}
          {state.phase === 'done' && (
            <>
              {retryableTargets.length > 0 && (
                <MarketButton size="md" intent="danger" disabled={busy} onClick={() => { if (!busy) void uninstaller.start(retryableTargets) }}>
                  {t('batchUninstall.retryFailed', { count: String(retryableTargets.length) })}
                </MarketButton>
              )}
              <MarketButton size="md" intent="primary" onClick={close}>{t('direct.finish')}</MarketButton>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
