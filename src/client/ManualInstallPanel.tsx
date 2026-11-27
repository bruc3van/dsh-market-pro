import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { IconCloseOutlineRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarketLocale } from './copy.ts'
import { InstallStatusBanner } from './InstallStatusBanner.tsx'
import { MarketButton } from './MarketButton.tsx'
import { MarketSelector } from './InstallModeSelector.tsx'
import {
  installRegistryLabel,
  isManualInstallInputValid,
  isValidCustomRegistryUrl,
  offeredInstallRegistries,
  shouldRefreshInstalledAfterDirect,
  type DirectInstaller,
  type InspectRefusal,
  type PluginRegistriesSnapshot,
} from './directInstall.ts'
import { installedReviewTargets, type ReviewTarget } from './reviewPrompt.ts'

const REGISTRY_MEMORY_KEY = 'dsh-market-pro:install-registry:v1'
const PNPM_DEFAULT_VALUE = '__pnpm_default__'
const CUSTOM_REGISTRY_VALUE = '__custom__'

interface StoredRegistryChoice {
  readonly kind: 'offered' | 'custom'
  readonly registry: string | null
}

function readStoredRegistry(): StoredRegistryChoice | null {
  try {
    const raw = window.localStorage.getItem(REGISTRY_MEMORY_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return null
    const kind = (parsed as { kind?: unknown }).kind
    const registry = (parsed as { registry?: unknown }).registry
    if (kind === 'custom' && typeof registry === 'string') {
      return { kind: 'custom', registry }
    }
    if (kind === 'offered' && (registry === null || typeof registry === 'string')) {
      return { kind: 'offered', registry }
    }
  } catch {
    /* ignore storage errors */
  }
  return null
}

function writeStoredRegistry(choice: StoredRegistryChoice): void {
  try {
    window.localStorage.setItem(REGISTRY_MEMORY_KEY, JSON.stringify(choice))
  } catch {
    /* ignore storage errors */
  }
}

function encodeRegistryOption(registry: string | null): string {
  return registry === null ? PNPM_DEFAULT_VALUE : `url:${registry}`
}

function decodeRegistryOption(encoded: string): string | null {
  return encoded === PNPM_DEFAULT_VALUE ? null : encoded.slice(4)
}

function normalizeUrlKey(registry: string | null, resolved: string | null): string {
  const raw = registry ?? resolved
  if (raw === null) return ''
  try {
    const parsed = new URL(raw)
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '').toLowerCase()
  } catch {
    return raw.trim().replace(/\/+$/, '').toLowerCase()
  }
}

function formatInspectError(
  error: InspectRefusal,
  t: MarketLocale,
  formatRegistry: (registry: string | null) => string,
): string {
  const asked = error.registries ?? []
  if (error.problem === 'network' && asked.length > 1) {
    const sep = t('lang') === 'zh' ? '、' : ', '
    return t('manual.problem.networkAll', { registries: asked.map(formatRegistry).join(sep) })
  }
  switch (error.problem) {
    case 'invalid-spec': return t('manual.problem.invalid-spec', { reason: error.reason })
    case 'already-installed': return t('manual.problem.already-installed')
    case 'shipped': return t('manual.problem.shipped')
    case 'not-found': return t('manual.problem.not-found')
    case 'not-a-package': return t('manual.problem.not-a-package')
    case 'not-a-bundle': return t('manual.problem.not-a-bundle', { reason: error.reason })
    case 'network': return t('manual.problem.network')
    default: return t('manual.problem.unknown', { reason: error.reason })
  }
}

/** Manual plugin install dialog covering npm packages, Git repositories, tarballs, and local directories. */
export function ManualInstallPanel({
  open: requestedOpen,
  installer,
  dshVersion,
  t,
  onClose,
  onInstalled,
  onReview,
  reviewBusy,
  reviewAvailable,
  reviewMessage,
}: {
  readonly open: boolean
  readonly installer: DirectInstaller
  readonly dshVersion?: string
  readonly t: MarketLocale
  readonly onClose: () => void
  readonly onInstalled: () => void
  readonly onReview: (targets: ReviewTarget[]) => Promise<boolean>
  readonly reviewBusy: boolean
  readonly reviewAvailable: boolean
  readonly reviewMessage: string
}) {
  const state = useSyncExternalStore(installer.subscribe, installer.getSnapshot)
  const [dismissed, setDismissed] = useState(false)
  const isManualRun = state.origin === 'manual' && state.phase !== 'idle'
  const unknownFromOtherOrigin = requestedOpen && state.origin !== 'manual' && state.phase === 'unknown'
  const open = !dismissed && (requestedOpen || isManualRun)
  const installerBusy = ['checking', 'installing', 'cancelling', 'unknown'].includes(state.phase)
  const busy = isManualRun && installerBusy
  const checking = isManualRun && !state.manualTitle && state.phase === 'checking'
  const inlineInspectError = isManualRun && !state.manualTitle && state.phase === 'failed'
    ? state.inspectError
    : undefined
  const showForm = !unknownFromOtherOrigin && (!isManualRun || (!state.manualTitle && (checking || inlineInspectError !== undefined)))
  const showResult = (isManualRun || unknownFromOtherOrigin) && !showForm
  const canDismiss = (!busy && !unknownFromOtherOrigin) || (state.phase === 'unknown' && !state.recovering)

  const [spec, setSpec] = useState('')
  const [guideOpen, setGuideOpen] = useState(false)
  const [registries, setRegistries] = useState<PluginRegistriesSnapshot | null>(null)
  const [registryReady, setRegistryReady] = useState(false)
  const [registryMode, setRegistryMode] = useState<'offered' | 'custom'>('offered')
  const [selectedRegistry, setSelectedRegistry] = useState<string | null>(null)
  const [customRegistry, setCustomRegistry] = useState('')
  const [customRegistryError, setCustomRegistryError] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const composingRef = useRef(false)
  const registryTouchedRef = useRef(false)
  const lastRefreshedStateRef = useRef<typeof state | null>(null)
  const guideId = useId()
  const errorId = useId()
  const registryErrorId = useId()

  useEffect(() => {
    if (requestedOpen) setDismissed(false)
  }, [requestedOpen])

  useEffect(() => {
    if (isManualRun && state.phase === 'checking') setDismissed(false)
  }, [isManualRun, state.phase])

  useEffect(() => {
    if (!requestedOpen) return
    let active = true
    registryTouchedRef.current = false
    const remembered = readStoredRegistry()
    if (remembered?.kind === 'custom') {
      setRegistryMode('custom')
      setCustomRegistry(remembered.registry ?? '')
      setRegistryReady(true)
    } else if (remembered?.kind === 'offered') {
      setRegistryMode('offered')
      setSelectedRegistry(remembered.registry)
      setRegistryReady(true)
    } else {
      setRegistryReady(false)
    }
    setCustomRegistryError(false)
    void installer.listRegistries().then((snapshot) => {
      if (!active || snapshot === null) return
      setRegistries(snapshot)
      setRegistryReady(true)
      if (registryTouchedRef.current) return
      const offered = offeredInstallRegistries(snapshot)
      const currentRemembered = readStoredRegistry()
      if (currentRemembered === null) {
        setRegistryMode('offered')
        setSelectedRegistry(snapshot.registry)
        return
      }
      if (currentRemembered.kind === 'custom') {
        setRegistryMode('custom')
        setCustomRegistry(currentRemembered.registry ?? '')
        return
      }
      if (currentRemembered.registry === null) {
        setRegistryMode('offered')
        setSelectedRegistry(null)
        return
      }
      const wantedKey = normalizeUrlKey(currentRemembered.registry, snapshot.resolved)
      const matched = offered.find(item => normalizeUrlKey(item, snapshot.resolved) === wantedKey)
      if (matched !== undefined) {
        setRegistryMode('offered')
        setSelectedRegistry(matched)
      } else {
        setRegistryMode('custom')
        setCustomRegistry(currentRemembered.registry)
      }
    })
    return () => { active = false }
  }, [requestedOpen, installer])

  useEffect(() => {
    if (!isManualRun || !shouldRefreshInstalledAfterDirect(state)) {
      lastRefreshedStateRef.current = null
      return
    }
    if (lastRefreshedStateRef.current === state) return
    lastRefreshedStateRef.current = state
    onInstalled()
  }, [isManualRun, state, onInstalled])

  const dismiss = (): void => {
    setDismissed(true)
    setCustomRegistryError(false)
    if (isManualRun && state.phase === 'done') setSpec('')
    if (isManualRun) installer.reset()
    onClose()
  }

  const clearInlineError = (): void => {
    if (inlineInspectError !== undefined) installer.reset()
  }

  const editSpecAgain = (): void => {
    if (state.spec !== '' && spec.trim() === '') setSpec(state.spec)
    installer.reset()
  }

  const offered = offeredInstallRegistries(registries)
  const visibleOffered = registryMode === 'offered' && selectedRegistry !== null && !offered.includes(selectedRegistry)
    ? [...offered, selectedRegistry]
    : offered
  const resolvedUrl = registries?.resolved ?? null
  const formatOfferedLabel = (registry: string | null): string => {
    const info = installRegistryLabel(registry, resolvedUrl)
    if (info.kind === 'default') return t('manual.registryDefault')
    if (info.kind === 'official') return t('manual.registryOfficial')
    if (info.kind === 'npmmirror') return t('manual.registryNpmmirror')
    return info.host
  }
  const inlineErrorText = inlineInspectError === undefined
    ? null
    : formatInspectError(inlineInspectError, t, formatOfferedLabel)

  const selectorOptions = [
    ...visibleOffered.map(registry => ({
      value: encodeRegistryOption(registry),
      label: formatOfferedLabel(registry),
    })),
    { value: CUSTOM_REGISTRY_VALUE, label: t('manual.registryCustom') },
  ]
  const activeSelectorValue = registryMode === 'custom'
    ? CUSTOM_REGISTRY_VALUE
    : visibleOffered.some(item => item === selectedRegistry)
      ? encodeRegistryOption(selectedRegistry)
      : encodeRegistryOption(visibleOffered[0] ?? null)

  const submit = (): void => {
    if (installerBusy) return
    const trimmed = spec.trim()
    if (!isManualInstallInputValid(trimmed)) return
    let registryToUse: string | null | undefined
    if (registryMode === 'custom') {
      const url = customRegistry.trim()
      if (!isValidCustomRegistryUrl(url)) {
        setCustomRegistryError(true)
        return
      }
      setCustomRegistryError(false)
      registryToUse = url
      writeStoredRegistry({ kind: 'custom', registry: url })
    } else if (registryReady || registryTouchedRef.current) {
      registryToUse = selectedRegistry
      writeStoredRegistry({ kind: 'offered', registry: selectedRegistry })
    }
    void installer.startManual(trimmed, {
      ...(registryToUse !== undefined ? { registry: registryToUse } : {}),
      enabled: true,
    })
  }

  const needsApproval = showResult && state.phase === 'failed' && state.pendingBuilds.length > 0
  const isIncompatFailure = showResult && state.phase === 'failed' && state.errorCode === 'incompatible-version'
  const finished = showResult && state.phase === 'done'
  const reviewTargets = showResult && !busy ? installedReviewTargets(state) : []
  const reviewButton = reviewTargets.length > 0
    ? (
      <MarketButton
        size="md"
        intent="secondary"
        disabled={reviewBusy || !reviewAvailable}
        title={!reviewAvailable ? t('install.profilePending') : undefined}
        onClick={() => { void onReview(reviewTargets).then((ok) => { if (ok) dismiss() }) }}
      >
        {reviewBusy ? t('installing') : t('audit.action')}
      </MarketButton>
      )
    : null

  const heading = state.manualTitle
    ? t('manual.installNamed', { name: state.manualTitle })
    : t('manual.title')

  const examples = [
    { key: 'npm', title: t('manual.guide.npmTitle'), hint: t('manual.guide.npmHint'), example: 'dsh-plugin-whale-pet' },
    { key: 'git', title: t('manual.guide.gitTitle'), hint: t('manual.guide.gitHint'), example: 'https://github.com/owner/dsh-plugin' },
    { key: 'path', title: t('manual.guide.pathTitle'), hint: t('manual.guide.pathHint'), example: '/path/to/my-dsh-plugin' },
  ] as const

  const canSubmit = isManualInstallInputValid(spec)

  return (
    <Modal
      open={open}
      headless
      title={heading}
      className="dsh_market_modal"
      onClose={() => { if (canDismiss && !reviewBusy) dismiss() }}
    >
      <div className="dsh_market_directPanel">
        <div className="dsh_market_directHead">
          <div className="dsh_market_installHeading">
            <h3>{heading}</h3>
            {showResult && state.spec !== '' && <small title={state.spec}>{state.spec}</small>}
          </div>
          {(canDismiss || checking) && (
            <button
              type="button"
              disabled={!canDismiss || reviewBusy}
              className="dsh_market_directClose"
              aria-label={t('direct.close')}
              onClick={dismiss}
            >
              <IconCloseOutlineRegular size={16} />
            </button>
          )}
        </div>

        {showForm && (
          <>
            <p className="dsh_market_installSummary">{t('manual.desc')}</p>
            <input
              ref={inputRef}
              type="text"
              autoFocus
              disabled={checking}
              className="dsh_market_manualInput"
              value={spec}
              placeholder={t('manual.placeholder')}
              aria-label={t('manual.inputLabel')}
              aria-invalid={inlineErrorText !== null}
              aria-describedby={inlineErrorText !== null ? errorId : undefined}
              spellCheck={false}
              onChange={(event) => {
                setSpec(event.currentTarget.value)
                clearInlineError()
              }}
              onCompositionStart={() => { composingRef.current = true }}
              onCompositionEnd={() => { composingRef.current = false }}
              onKeyDown={(event) => {
                if (composingRef.current || event.nativeEvent.isComposing) return
                if (event.key === 'Enter' && canSubmit && !installerBusy) submit()
              }}
            />
            {inlineErrorText !== null && (
              <p id={errorId} className="dsh_market_manualError dsh_market_manualInputError" role="alert">
                {inlineErrorText}
              </p>
            )}

            <div className="dsh_market_manualOptions">
              <button
                type="button"
                className="dsh_market_manualGuideToggle"
                aria-expanded={guideOpen}
                aria-controls={guideId}
                onClick={() => { setGuideOpen(prev => !prev) }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m6 9 6 6 6-6" />
                </svg>
                <span>{t(guideOpen ? 'manual.guideHide' : 'manual.guideToggle')}</span>
              </button>
              <MarketSelector
                value={activeSelectorValue}
                disabled={checking}
                prefix={t('manual.registryLabel')}
                onChange={(next) => {
                  registryTouchedRef.current = true
                  clearInlineError()
                  if (next === CUSTOM_REGISTRY_VALUE) {
                    setRegistryMode('custom')
                    setCustomRegistryError(false)
                  } else {
                    setRegistryMode('offered')
                    setSelectedRegistry(decodeRegistryOption(next))
                    setCustomRegistryError(false)
                  }
                }}
                label={t('manual.registryLabel')}
                className="dsh_market_manualRegistry"
                options={selectorOptions}
              />
            </div>

            {registryMode === 'custom' && (
              <div className="dsh_market_manualCustomRegistry">
                <input
                  type="text"
                  disabled={checking}
                  className="dsh_market_manualInput"
                  value={customRegistry}
                  placeholder={t('manual.registryCustomPlaceholder')}
                  aria-label={t('manual.registryCustom')}
                  aria-invalid={customRegistryError}
                  aria-describedby={customRegistryError ? registryErrorId : undefined}
                  spellCheck={false}
                  onChange={(event) => {
                    setCustomRegistry(event.currentTarget.value)
                    if (customRegistryError) setCustomRegistryError(false)
                    clearInlineError()
                  }}
                />
                {customRegistryError && (
                  <p id={registryErrorId} className="dsh_market_manualError" role="alert">
                    {t('manual.registryCustomInvalid')}
                  </p>
                )}
                <p className="dsh_market_manualHint">{t('manual.registryCustomHint')}</p>
              </div>
            )}

            {guideOpen && (
              <div id={guideId} className="dsh_market_manualGuide">
                {examples.map(entry => (
                  <div key={entry.key} className="dsh_market_manualGuideItem">
                    <div className="dsh_market_manualGuideCopy">
                      <strong>{entry.title}</strong>
                      <span>{entry.hint}</span>
                      <code>{entry.example}</code>
                    </div>
                    <MarketButton
                      intent="secondary"
                      disabled={checking}
                      onClick={() => {
                        setSpec(entry.example)
                        clearInlineError()
                        inputRef.current?.focus()
                      }}
                    >
                      {t('manual.guideFill')}
                    </MarketButton>
                  </div>
                ))}
              </div>
            )}

            <div className="dsh_market_manualSafety" role="note">
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="9.5" />
                <path d="M12 8v5M12 16h.01" />
              </svg>
              <div className="dsh_market_manualSafetyText">
                <p>{t('manual.safety')}</p>
                <p>{t('manual.upgradeNotice')}</p>
              </div>
            </div>
          </>
        )}

        {showResult && (
          <InstallStatusBanner
            id={errorId}
            phase={state.phase}
            application={state.application}
            errorCode={state.errorCode}
            incompatible={state.incompatible}
            pendingBuilds={state.pendingBuilds}
            message={state.message}
            dshVersion={dshVersion}
            diagnosticDefaultOpen={state.phase === 'failed' && !isIncompatFailure}
            t={t}
          />
        )}

        {reviewTargets.length > 0 && reviewMessage && <p role="status">{reviewMessage}</p>}

        <fieldset className="dsh_market_installFooter" disabled={reviewBusy}>
          {showForm ? (
            <MarketButton
              size="md"
              intent="primary"
              className="dsh_market_manualSubmit"
              disabled={checking || installerBusy || !canSubmit}
              aria-busy={checking}
              onClick={submit}
            >
              {checking && <span className="dsh_market_manualSpinner" aria-hidden="true" />}
              {checking ? t('manual.checking') : t('manual.submit')}
            </MarketButton>
          ) : needsApproval ? (
            <>
              <MarketButton size="md" intent="secondary" onClick={dismiss}>{t('direct.decline')}</MarketButton>
              <MarketButton size="md" intent="primary" onClick={() => { void installer.approve() }}>{t('direct.allowContinue')}</MarketButton>
            </>
          ) : finished ? (
            <>
              {reviewButton}
              <MarketButton size="md" intent="primary" onClick={dismiss}>{t('direct.finish')}</MarketButton>
            </>
          ) : state.phase === 'unavailable' ? (
            <>
              {reviewButton}
              <MarketButton size="md" intent="primary" onClick={dismiss}>{t('direct.finishUnconfirmed')}</MarketButton>
            </>
          ) : state.phase === 'unknown' ? (
            <MarketButton
              size="md"
              intent="primary"
              disabled={state.recovering}
              aria-busy={state.recovering}
              onClick={() => { void installer.recover() }}
            >
              {state.recovering ? t('direct.recovering') : t('direct.recover')}
            </MarketButton>
          ) : busy ? (
            <MarketButton
              size="md"
              intent="secondary"
              disabled={state.phase !== 'installing'}
              onClick={() => { void installer.cancel() }}
            >
              {t('direct.cancel')}
            </MarketButton>
          ) : (
            <>
              {!state.manualTitle && (
                <MarketButton size="md" intent="secondary" onClick={editSpecAgain}>
                  {t('manual.editSpec')}
                </MarketButton>
              )}
              <MarketButton size="md" intent="secondary" onClick={dismiss}>{t('direct.close')}</MarketButton>
              {!isIncompatFailure && (
                <MarketButton size="md" intent="primary" onClick={() => { void installer.retry() }}>
                  {t('direct.retry')}
                </MarketButton>
              )}
            </>
          )}
        </fieldset>
      </div>
    </Modal>
  )
}
