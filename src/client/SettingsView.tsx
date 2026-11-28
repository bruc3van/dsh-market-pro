import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { MarketButton } from './MarketButton.tsx'
import { StarActionLink } from './StarPromptCard.tsx'
import { useEffect, useId, useRef, useState, type ReactElement } from 'react'
import type { SafeMarketSettings, SafeMarketSettingsUpdate } from '../contract.ts'
import type { MarketLocale } from './copy.ts'

export interface SettingsViewProps {
  readonly t: MarketLocale
  readonly settings: SafeMarketSettings
  readonly settingsReady: boolean
  readonly telemetrySuppressedByEnv?: boolean
  readonly updateSettings?: (update: SafeMarketSettingsUpdate) => Promise<SafeMarketSettings>
  readonly onTryAssistant?: () => void
  readonly tryBusy?: boolean
  readonly tryMessage?: string
  readonly onStarred?: () => void
}

type SettingsSaveState =
  | { readonly status: 'idle' }
  | { readonly status: 'saving'; readonly field: SafeMarketSettingsUpdate['field'] }
  | { readonly status: 'error'; readonly message: string }

/** Built-in settings tab for toggling the AI assistant and online catalog access. */
export function SettingsView({
  t,
  settings,
  settingsReady,
  telemetrySuppressedByEnv = false,
  updateSettings,
  onTryAssistant,
  tryBusy = false,
  tryMessage = '',
  onStarred,
}: SettingsViewProps): ReactElement {
  const [saveState, setSaveState] = useState<SettingsSaveState>({ status: 'idle' })
  const baseId = useId()
  const aiHeadingId = `${baseId}-ai`
  const catalogHeadingId = `${baseId}-catalog`
  const telemetryHeadingId = `${baseId}-telemetry`
  const starHeadingId = `${baseId}-star`
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const toggle = (field: SafeMarketSettingsUpdate['field'], next: boolean): void => {
    if (!updateSettings || saveState.status === 'saving') return
    setSaveState({ status: 'saving', field })
    void updateSettings({ field, value: next }).then(
      () => { if (mounted.current) setSaveState({ status: 'idle' }) },
      (cause: unknown) => {
        if (!mounted.current) return
        setSaveState({
          status: 'error',
          message: t('settings.saveFailed', { reason: cause instanceof Error ? cause.message : String(cause) }),
        })
      },
    )
  }

  const controlsDisabled = !settingsReady || !updateSettings || saveState.status === 'saving'

  return (
    <div className="dsh_market_page dsh_market_settingsPage">
      {saveState.status === 'error' && <p className="dsh_market_status" data-error="true" role="alert">{saveState.message}</p>}
      {!updateSettings && <p className="dsh_market_status">{t('settings.unavailable')}</p>}

      <section className="dsh_market_settingRow" aria-labelledby={aiHeadingId}>
        <div className="dsh_market_settingHead">
          <div className="dsh_market_settingCopy">
            <h4 id={aiHeadingId} className="dsh_market_settingName">{t('settings.ai.title')}</h4>
            <p className="dsh_market_settingBody">{t('settings.ai.desc')}</p>
          </div>
          <Switch
            checked={settings.aiAssistantEnabled}
            label={t('settings.ai.title')}
            disabled={controlsDisabled}
            onChange={next => toggle('aiAssistantEnabled', next)}
          />
        </div>

        {settings.aiAssistantEnabled && !settings.enabled && (
          <p className="dsh_market_settingWarn">{t('settings.ai.catalogOffHint')}</p>
        )}

        {onTryAssistant && (
          <div className="dsh_market_settingActions">
            <MarketButton
              intent="secondary"
              disabled={!settingsReady || !settings.aiAssistantEnabled || tryBusy}
              onClick={onTryAssistant}
            >
              {tryBusy ? t('installing') : t('settings.ai.try')}
            </MarketButton>
            {tryMessage !== '' && <span className="dsh_market_cardNotice">{tryMessage}</span>}
          </div>
        )}
      </section>

      <section className="dsh_market_settingRow" aria-labelledby={catalogHeadingId}>
        <div className="dsh_market_settingHead">
          <div className="dsh_market_settingCopy">
            <h4 id={catalogHeadingId} className="dsh_market_settingName">{t('settings.catalog.title')}</h4>
            <p className="dsh_market_settingBody">{t('settings.catalog.desc')}</p>
          </div>
          <Switch
            checked={settings.enabled}
            label={t('settings.catalog.title')}
            disabled={controlsDisabled}
            onChange={next => toggle('enabled', next)}
          />
        </div>
      </section>

      <section className="dsh_market_settingRow" aria-labelledby={telemetryHeadingId}>
        <div className="dsh_market_settingHead">
          <div className="dsh_market_settingCopy">
            <h4 id={telemetryHeadingId} className="dsh_market_settingName">{t('settings.telemetry.title')}</h4>
            <p className="dsh_market_settingBody">
              {t('settings.telemetry.desc')}
              <a
                className="dsh_market_settingLink"
                href="https://github.com/bruc3van/dsh-market-pro/blob/master/PRIVACY.md"
                target="_blank"
                rel="noreferrer"
              >
                {t('settings.telemetry.privacyLink')}
              </a>
            </p>
          </div>
          <Switch
            checked={telemetrySuppressedByEnv ? false : settings.telemetryEnabled}
            label={t('settings.telemetry.title')}
            disabled={controlsDisabled || telemetrySuppressedByEnv}
            onChange={next => toggle('telemetryEnabled', next)}
          />
        </div>
        {telemetrySuppressedByEnv && (
          <p className="dsh_market_settingBody">{t('settings.telemetry.envSuppressed')}</p>
        )}
      </section>

      <section className="dsh_market_settingRow" aria-labelledby={starHeadingId}>
        <div className="dsh_market_settingHead dsh_market_settingStarHead">
          <div className="dsh_market_settingCopy">
            <h4 id={starHeadingId} className="dsh_market_settingName">{t('settings.star.title')}</h4>
            <p className="dsh_market_settingBody">{t('star.prompt')}</p>
          </div>
          <StarActionLink t={t} onStarred={onStarred} />
        </div>
      </section>
    </div>
  )
}
