import { classifyIncompatibleItems, type IncompatibleRequirementItem } from '../compatibility.ts'
import type { MarketLocale } from './copy.ts'
import { formatHostErrorText, formatInstallIncompatHeading } from './compatCopy.ts'
import type { DirectState } from './directInstall.ts'

/** Shared post-install status, build-approval, incompatibility, and diagnostic banner. */
export function InstallStatusBanner({
  id,
  phase,
  application,
  errorCode,
  incompatible,
  pendingBuilds,
  message,
  queueLength = 0,
  dshVersion,
  diagnosticDefaultOpen,
  t,
}: {
  readonly id?: string
  readonly phase: DirectState['phase']
  readonly application?: string
  readonly errorCode?: string
  readonly incompatible?: readonly IncompatibleRequirementItem[]
  readonly pendingBuilds: readonly string[]
  readonly message: string
  readonly queueLength?: number
  readonly dshVersion?: string
  readonly diagnosticDefaultOpen?: boolean
  readonly t: MarketLocale
}) {
  const needsApproval = phase === 'failed' && pendingBuilds.length > 0
  const isIncompatFailure = phase === 'failed' && errorCode === 'incompatible-version'
  const incompatInfo = isIncompatFailure ? classifyIncompatibleItems(incompatible, dshVersion) : undefined
  const finished = phase === 'done'
  const outcome = application as 'applied' | 'restart-required' | 'overridden' | 'cancelled' | undefined

  return (
    <div id={id} className="dsh_market_installStatus" role="status" aria-live="polite">
      <strong>
        {needsApproval
          ? t('direct.authorization')
          : isIncompatFailure && incompatInfo
            ? formatInstallIncompatHeading(incompatInfo.direction, t)
            : finished && queueLength > 1
              ? t('direct.batchDone')
              : finished && outcome
                ? t(`direct.${outcome}`)
                : t(`direct.${phase}`)}
      </strong>
      {isIncompatFailure && (
        <p>{formatHostErrorText({ code: 'incompatible-version', incompatible }, t, 'install', { fallbackRuntimeVersion: dshVersion })}</p>
      )}
      {needsApproval && (
        <>
          <p>{t('direct.buildHint')}</p>
          <ul className="dsh_market_buildList">
            {pendingBuilds.map(name => <li key={name}>{name}</li>)}
          </ul>
        </>
      )}
      {message && (
        <details className="dsh_market_installDiagnostic" open={diagnosticDefaultOpen}>
          <summary>{t('direct.diagnostic')}</summary>
          <pre className="dsh_market_directMessage">{message}</pre>
        </details>
      )}
    </div>
  )
}
