import { useEffect, useState, useSyncExternalStore, type ReactElement } from 'react'
import { IconCloseOutlineRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarketLocale } from './copy.ts'
import type { DirectoryBrowserController } from './directoryBrowser.ts'
import { MarketButton } from './MarketButton.tsx'

/**
 * In-app Host directory browser modal for runtimes whose directoryPicker serves
 * `"browse"` (such as DSH-go / Web) instead of a native OS file dialog.
 */
export function DirectoryBrowserPanel({ controller, ownerId, t }: {
  controller: DirectoryBrowserController
  ownerId?: string
  t: MarketLocale
}): ReactElement {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [showHidden, setShowHidden] = useState(false)
  const [creatingOpen, setCreatingOpen] = useState(false)
  const [folderName, setFolderName] = useState('')

  const open = state.open && (ownerId === undefined || state.ownerId === null || state.ownerId === ownerId)

  useEffect(() => {
    if (!open) {
      setCreatingOpen(false)
      setFolderName('')
    }
  }, [open])

  useEffect(() => () => {
    if (ownerId !== undefined) controller.cancel(ownerId)
  }, [controller, ownerId])

  const listing = state.listing
  const entries = listing === null
    ? []
    : (showHidden ? listing.entries : listing.entries.filter(entry => !entry.hidden))
  const hasHidden = listing !== null && listing.entries.some(entry => entry.hidden)
  const busy = state.loading || state.creating
  const canConfirm = listing !== null && listing.path !== '' && !busy
  const failedSubdir = state.error !== '' && listing !== null
    && state.currentPath !== '' && state.currentPath !== listing.path

  const toggleCreateForm = () => {
    controller.clearCreateError()
    setCreatingOpen(value => !value)
    setFolderName('')
  }

  const closeCreateForm = () => {
    controller.clearCreateError()
    setCreatingOpen(false)
    setFolderName('')
  }

  const submitCreate = async () => {
    const ok = await controller.createFolder(folderName)
    if (ok) {
      setFolderName('')
      setCreatingOpen(false)
    }
  }

  return (
    <Modal
      open={open}
      headless
      title={t('workspace.browser.title')}
      className="dsh_market_modal"
      onClose={() => { if (!state.creating) controller.cancel(ownerId) }}
    >
      <div className="dsh_market_directPanel dsh_market_updateDialog dsh_market_dirDialog">
        <div className="dsh_market_directHead">
          <div className="dsh_market_installHeading">
            <h3>{t('workspace.browser.title')}</h3>
            {listing !== null && <small title={listing.path}>{listing.path}</small>}
          </div>
          <button
            type="button"
            className="dsh_market_directClose"
            disabled={state.creating}
            aria-label={t('direct.close')}
            onClick={() => controller.cancel(ownerId)}
          >
            <IconCloseOutlineRegular size={16} />
          </button>
        </div>

        <div className="dsh_market_dirToolbar">
          {listing !== null && (
            <nav className="dsh_market_dirCrumbs" aria-label={t('workspace.browser.path')}>
              {listing.crumbs.map((crumb, index) => {
                const isLast = index === listing.crumbs.length - 1
                const prev = index > 0 ? listing.crumbs[index - 1] : undefined
                const showSep = index > 0 && prev?.name !== '/' && !prev?.name.endsWith('\\')
                return (
                  <span key={crumb.path} className="dsh_market_dirCrumbWrap">
                    {showSep && <span className="dsh_market_dirSep" aria-hidden="true">/</span>}
                    <button
                      type="button"
                      className="dsh_market_dirCrumb"
                      disabled={busy || isLast}
                      data-current={isLast ? 'true' : undefined}
                      onClick={() => { void controller.browse(crumb.path) }}
                    >
                      {crumb.name}
                    </button>
                  </span>
                )
              })}
            </nav>
          )}
          <div className="dsh_market_dirMetaRow">
            {hasHidden && (
              <label className="dsh_market_dirHiddenToggle">
                <input
                  type="checkbox"
                  checked={showHidden}
                  onChange={event => setShowHidden(event.target.checked)}
                />
                <span>{t('workspace.browser.showHidden')}</span>
              </label>
            )}
            <div className="dsh_market_dirQuickActions">
              {listing !== null && listing.home !== '' && listing.path !== listing.home && (
                <button
                  type="button"
                  className="dsh_market_chip"
                  disabled={busy}
                  onClick={() => { void controller.browse(listing.home) }}
                >
                  {t('workspace.browser.home')}
                </button>
              )}
              {state.canCreate && listing !== null && (
                <button
                  type="button"
                  className="dsh_market_chip"
                  disabled={busy}
                  onClick={toggleCreateForm}
                >
                  {t('workspace.browser.newFolder')}
                </button>
              )}
            </div>
          </div>
          {creatingOpen && listing !== null && (
            <form
              className="dsh_market_dirCreateForm"
              onSubmit={(event) => { event.preventDefault(); void submitCreate() }}
            >
              <input
                className="dsh_market_search"
                type="text"
                spellCheck={false}
                value={folderName}
                disabled={state.creating}
                aria-label={t('workspace.browser.folderName')}
                placeholder={t('workspace.browser.folderName')}
                onChange={event => { controller.clearCreateError(); setFolderName(event.target.value) }}
              />
              <MarketButton type="submit" intent="primary" disabled={state.creating || folderName.trim() === ''}>
                {state.creating ? t('workspace.browser.creating') : t('workspace.browser.create')}
              </MarketButton>
              <MarketButton intent="secondary" disabled={state.creating} onClick={closeCreateForm}>
                {t('installed.cancel')}
              </MarketButton>
            </form>
          )}
          {state.createError !== '' && (
            <p className="dsh_market_cardError" role="alert">
              {state.createError === 'invalid-name'
                ? t('workspace.browser.invalidName')
                : t('workspace.browser.createFailed', { reason: state.createError })}
            </p>
          )}
        </div>

        <div className="dsh_market_updateBody dsh_market_dirBody" aria-busy={state.loading}>
          {state.loading && listing === null && (
            <p className="dsh_market_dirHint" role="status">{t('workspace.browser.loading')}</p>
          )}
          {state.error !== '' && (
            <div className="dsh_market_installStatus" role="alert">
              <p className="dsh_market_cardError">
                {failedSubdir
                  ? t('workspace.browser.openFailed', { path: state.currentPath, reason: state.error })
                  : t('workspace.browser.loadFailed', { reason: state.error })}
              </p>
              <div className="dsh_market_dirErrorActions">
                <MarketButton intent="secondary" onClick={() => { void controller.browse(state.currentPath || undefined) }}>
                  {t('retry')}
                </MarketButton>
                <MarketButton intent="secondary" onClick={() => { void controller.browse(undefined) }}>
                  {t('workspace.browser.home')}
                </MarketButton>
              </div>
            </div>
          )}
          {listing !== null && state.error === '' && entries.length === 0 && (
            <p className="dsh_market_dirHint">{t('workspace.browser.empty')}</p>
          )}
          {listing !== null && entries.length > 0 && (
            <ul className="dsh_market_dirList">
              {entries.map(entry => (
                <li key={entry.path}>
                  <button
                    type="button"
                    className="dsh_market_dirRow"
                    disabled={busy}
                    onClick={() => { void controller.browse(entry.path) }}
                  >
                    <svg className="dsh_market_dirIcon" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.3l2 2.2h8.7A1.5 1.5 0 0 1 21 8.7v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.7z" />
                    </svg>
                    <span className="dsh_market_dirName">{entry.name}</span>
                    <svg className="dsh_market_dirChevron" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {listing?.truncated && (
            <p className="dsh_market_dirHint">{t('workspace.browser.truncated')}</p>
          )}
        </div>

        <div className="dsh_market_updateActions">
          <MarketButton size="md" intent="secondary" disabled={state.creating} onClick={() => controller.cancel(ownerId)}>
            {t('installed.cancel')}
          </MarketButton>
          <MarketButton size="md" intent="primary" disabled={!canConfirm} onClick={() => controller.confirm()}>
            {t('workspace.browser.selectCurrent')}
          </MarketButton>
        </div>
      </div>
    </Modal>
  )
}
