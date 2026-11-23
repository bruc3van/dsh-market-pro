import { IconCloseOutlineRegular, Modal, StateDot, TextShimmer } from '@deepseek-ai/dsh-client-ui-primitives'
import { MarketSelector } from './InstallModeSelector.tsx'
import { MarketButton } from './MarketButton.tsx'
import { PluginLogo } from './PluginLogo.tsx'
import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  DeleteInstalledSkillRequest,
  DeleteInstalledSkillResult,
  FeaturedSkillInstallScope,
  InstallFeaturedSkillRequest,
  InstallFeaturedSkillResult,
  MarketSkill,
  MarketSkillsResult,
} from '../contract.ts'
import {
  FEATURED_SKILLS,
  FEATURED_SKILL_CATEGORIES,
  featuredSkillGithubUrl,
  featuredSkillIconUrl,
  featuredSkillSkillsShUrl,
  findInstalledFeaturedSkill,
  formatSkillInstalls,
  isDeletableSkillPath,
  matchesFeaturedSkill,
  matchesFeaturedSkillOrigin,
  type FeaturedSkill,
  type FeaturedSkillCategory,
  type FeaturedSkillOriginFilter,
} from '../skillsFeatured.ts'
import { watchSkills, type SkillsSessionSource } from './skillsSubscription.ts'
import type { MarketLocale } from './copy.ts'
import type { HeaderRefreshAction } from './MarketSection.tsx'
import { matchesSkill } from './rows.ts'

export const NO_SESSION = 'no-session'
export const SESSIONS_PENDING = 'sessions-pending'

type SkillsSubTab = 'featured' | 'installed'

type SkillsState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly result: MarketSkillsResult }
  | { readonly status: 'error'; readonly message: string }

type SkillsViewModel =
  | { readonly status: 'loading' }
  | { readonly status: 'no-session' }
  | { readonly status: 'failed'; readonly message: string; readonly writerHeld: boolean }
  | { readonly status: 'ready'; readonly result: MarketSkillsResult }

function resolveSkillsView(state: SkillsState): SkillsViewModel {
  if (state.status === 'loading') return { status: 'loading' }
  if (state.status === 'error') {
    const message = state.message === '' ? 'unknown error' : state.message
    return { status: 'failed', message, writerHeld: message.startsWith('session/writer-held:') }
  }
  const { result } = state
  if (result.error === SESSIONS_PENDING) return { status: 'loading' }
  if (result.error === NO_SESSION) return { status: 'no-session' }
  if (result.error !== '') {
    return { status: 'failed', message: result.error, writerHeld: result.error.startsWith('session/writer-held:') }
  }
  return { status: 'ready', result }
}

interface SkillsActions {
  listSkills: () => Promise<MarketSkillsResult>
  skillsSession: SkillsSessionSource
  deleteInstalledSkill?: (request: DeleteInstalledSkillRequest) => Promise<DeleteInstalledSkillResult>
  canOpenFolder: () => Promise<boolean>
  openFolder: (path: string) => Promise<void>
}

type SkillDeleteModalState =
  | { readonly status: 'closed' }
  | { readonly status: 'confirming'; readonly skill: MarketSkill; readonly error?: string }
  | { readonly status: 'deleting'; readonly skill: MarketSkill }

type SkillDeleteFeedback =
  | { readonly status: 'none' }
  | { readonly status: 'notice'; readonly message: string }
  | { readonly status: 'error'; readonly message: string }

function skillRowKey(skill: MarketSkill): string {
  return `${skill.name}::${skill.sourcePath ?? skill.provider}`
}

function canDeleteInstalledSkill(skill: MarketSkill): boolean {
  if (originOf(skill) === 'bundled') return false
  return isDeletableSkillPath(skill.sourcePath)
}

const origins = ['project', 'user', 'custom', 'bundled', 'other'] as const
type Origin = typeof origins[number]

function originOf(skill: MarketSkill): Origin {
  switch (skill.source) {
    case 'project-dsh':
    case 'project-agents': return 'project'
    case 'user-dsh':
    case 'user-agents': return 'user'
    case 'custom': return 'custom'
    case 'bundled': return 'bundled'
    default: return 'other'
  }
}

export function ProjectSkillsView(props: SkillsActions & PropsLocale<'settings.dshMarketPro'>): ReactElement {
  return <SkillsView {...props} project />
}

export interface SkillAiInstallFeedback {
  readonly skillId: string
  readonly status: 'error' | 'needs-workspace'
  readonly message: string
}

export function SkillsView({
  t,
  listSkills,
  skillsSession,
  installFeaturedSkill,
  deleteInstalledSkill,
  pickProjectDir,
  canOpenFolder,
  openFolder,
  project = false,
  onRegisterRefresh,
  onAskAiInstall,
  aiInstallBusy = false,
  aiInstallFeedback = null,
}: SkillsActions & {
  t: MarketLocale
  project?: boolean
  installFeaturedSkill?: (request: InstallFeaturedSkillRequest, signal?: AbortSignal) => Promise<InstallFeaturedSkillResult>
  pickProjectDir?: () => Promise<string | null>
  onRegisterRefresh?: (action: HeaderRefreshAction | null) => void
  onAskAiInstall?: (
    item: FeaturedSkill,
    target?: { readonly scope: FeaturedSkillInstallScope; readonly projectDir?: string },
  ) => Promise<boolean>
  aiInstallBusy?: boolean
  aiInstallFeedback?: SkillAiInstallFeedback | null
}): ReactElement {
  const [subTab, setSubTab] = useState<SkillsSubTab>(project ? 'installed' : 'featured')
  const [featuredQuery, setFeaturedQuery] = useState('')
  const [featuredCategory, setFeaturedCategory] = useState<FeaturedSkillCategory | 'all'>('all')
  const [featuredOrigin, setFeaturedOrigin] = useState<FeaturedSkillOriginFilter>('all')
  const [selectedFeatured, setSelectedFeatured] = useState<FeaturedSkill | null>(null)
  const [state, setState] = useState<SkillsState>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [origin, setOrigin] = useState<Origin | 'all'>('all')
  const [refresh, setRefresh] = useState(0)
  const [folderAvailable, setFolderAvailable] = useState(false)
  const [actionError, setActionError] = useState('')
  const [deleteModal, setDeleteModal] = useState<SkillDeleteModalState>({ status: 'closed' })
  const [deleteFeedback, setDeleteFeedback] = useState<SkillDeleteFeedback>({ status: 'none' })
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    let live = true
    void canOpenFolder().then(ok => { if (live) setFolderAvailable(ok) }, () => undefined)
    return () => { live = false }
  }, [canOpenFolder])

  useEffect(() => watchSkills(skillsSession, listSkills, {
    loading: () => {
      setActionError('')
      setState({ status: 'loading' })
    },
    result: result => setState({ status: 'ready', result }),
    error: error => {
      const raw = error instanceof Error ? error.message : String(error)
      setState({ status: 'error', message: raw === '' ? 'unknown error' : raw })
    },
  }), [listSkills, skillsSession, refresh])

  const view = resolveSkillsView(state)
  const busy = view.status === 'loading'
  const available = view.status === 'ready'
  const readyResult = view.status === 'ready' ? view.result : null
  const hasFailure = view.status === 'failed'
  const retry = () => setRefresh(value => value + 1)
  const needle = query.trim().toLocaleLowerCase()
  const groups = origins.map(id => ({ id, items: [] as MarketSkill[], total: 0 }))
  for (const skill of readyResult?.skills ?? []) {
    const group = groups[origins.indexOf(originOf(skill))]
    group.total += 1
    if (origin !== 'all' && origin !== group.id) continue
    if (matchesSkill(skill, needle)) group.items.push(skill)
  }
  const count = groups.reduce((sum, group) => sum + group.items.length, 0)
  const installedSkills = readyResult?.skills ?? []

  const featuredMatches = useMemo(
    () => new Map(FEATURED_SKILLS.map(item => [item.id, findInstalledFeaturedSkill(item, installedSkills)])),
    [installedSkills],
  )
  const featuredItems = useMemo(
    () => FEATURED_SKILLS.filter(item => matchesFeaturedSkill(item, featuredQuery, featuredCategory, featuredOrigin)),
    [featuredQuery, featuredCategory, featuredOrigin],
  )
  const featuredOriginCount = (filter: FeaturedSkillOriginFilter) =>
    FEATURED_SKILLS.filter(item => matchesFeaturedSkillOrigin(item, filter)
      && (featuredCategory === 'all' || item.category === featuredCategory)).length
  const featuredCategoryCount = (value: FeaturedSkillCategory | 'all') =>
    FEATURED_SKILLS.filter(item => matchesFeaturedSkillOrigin(item, featuredOrigin)
      && (value === 'all' || item.category === value)).length

  const viewInstalledSkill = (name: string) => {
    setSelectedFeatured(null)
    setSubTab('installed')
    setOrigin('all')
    setQuery(name)
  }

  const openSkillFolder = async (path: string) => {
    setActionError('')
    try {
      await openFolder(path)
    } catch (error) {
      if (!mounted.current) return
      setActionError(t('skills.openFailed', { reason: error instanceof Error ? error.message : String(error) }))
    }
  }

  const confirmDeleteSkill = async (skill: MarketSkill) => {
    if (!deleteInstalledSkill || !skill.sourcePath) return
    setActionError('')
    setDeleteFeedback({ status: 'none' })
    setDeleteModal({ status: 'deleting', skill })
    try {
      const result = await deleteInstalledSkill({ name: skill.name, sourcePath: skill.sourcePath })
      if (!mounted.current) return
      if (result.ok) {
        setDeleteModal({ status: 'closed' })
        setDeleteFeedback({ status: 'notice', message: t('skills.deleted', { name: skill.name }) })
        setRefresh(value => value + 1)
      } else {
        setDeleteModal({
          status: 'confirming',
          skill,
          error: t('skills.deleteFailed', { reason: result.error || 'unknown error' }),
        })
      }
    } catch (error) {
      if (!mounted.current) return
      setDeleteModal({
        status: 'confirming',
        skill,
        error: t('skills.deleteFailed', { reason: error instanceof Error ? error.message : String(error) }),
      })
    }
  }

  const retryRef = useRef(retry)
  retryRef.current = retry
  const refreshLabel = busy ? t('refreshing') : t('skills.refresh')
  const showHeaderRefresh = !hasFailure || (!project && subTab === 'featured')
  useEffect(() => {
    if (!onRegisterRefresh) return
    onRegisterRefresh(showHeaderRefresh ? {
      label: refreshLabel,
      busy,
      disabled: busy,
      onClick: () => retryRef.current(),
    } : null)
  }, [onRegisterRefresh, showHeaderRefresh, refreshLabel, busy])
  useEffect(() => () => { onRegisterRefresh?.(null) }, [onRegisterRefresh])

  const refreshButton = showHeaderRefresh ? (
    <button
      className={project ? 'dsh_market_headerAction' : 'dsh_market_headerAction dsh_market_refreshMarket'}
      type="button"
      disabled={busy}
      aria-busy={busy}
      onClick={retry}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20 4v6h-6M20 10a8 8 0 1 0-1.7 7" />
      </svg>
      {refreshLabel}
    </button>
  ) : null

  const showFeatured = !project && subTab === 'featured'

  return (
    <div className={project ? 'dsh_market_projectSkills' : 'dsh_market_page dsh_market_fixedPage'}>
      <div className="dsh_market_controls dsh_market_skillsControls">
        {!project && !onRegisterRefresh && refreshButton}
        {project && (
          <div className="dsh_market_skillsHeading">
            <h2>{t('skills.title')}</h2>
            {refreshButton}
          </div>
        )}
        {!project ? (
          <>
            <div className="dsh_market_filterBar">
              <div className="dsh_market_scope" role="group" aria-label={t('skills.subtab.aria')}>
                <button
                  type="button"
                  className="dsh_market_scopeButton"
                  aria-pressed={subTab === 'featured'}
                  onClick={() => setSubTab('featured')}
                >
                  {t('skills.subtab.featured')} <span>{FEATURED_SKILLS.length}</span>
                </button>
                <button
                  type="button"
                  className="dsh_market_scopeButton"
                  aria-pressed={subTab === 'installed'}
                  onClick={() => setSubTab('installed')}
                >
                  {t('skills.subtab.installed')} {readyResult !== null && <span>{readyResult.skills.length}</span>}
                </button>
              </div>
              {showFeatured ? (
                <div className="dsh_market_filterActions">
                  <input
                    className="dsh_market_search dsh_market_filterSearch"
                    type="search"
                    spellCheck={false}
                    value={featuredQuery}
                    aria-label={t('skills.featured.search')}
                    placeholder={t('skills.featured.search')}
                    onChange={event => setFeaturedQuery(event.target.value)}
                  />
                  <MarketSelector
                    value={featuredCategory}
                    onChange={setFeaturedCategory}
                    label={t('skills.featured.category.aria')}
                    className="dsh_market_category"
                    options={[
                      { value: 'all', label: t('filter.allCategories'), count: featuredCategoryCount('all') },
                      ...FEATURED_SKILL_CATEGORIES.map(value => ({
                        value,
                        label: t(`skills.featured.category.${value}`),
                        count: featuredCategoryCount(value),
                      })),
                    ]}
                  />
                  <MarketSelector
                    value={featuredOrigin}
                    onChange={setFeaturedOrigin}
                    label={t('skills.featured.filter.aria')}
                    className="dsh_market_sort"
                    options={[
                      { value: 'all', label: t('skills.featured.filter.allLabel'), count: featuredOriginCount('all') },
                      { value: 'official', label: t('skills.featured.filter.official'), count: featuredOriginCount('official') },
                    ]}
                  />
                </div>
              ) : ((available || busy) && (
                <div className="dsh_market_filterActions">
                  <input
                    className="dsh_market_search dsh_market_filterSearch"
                    type="search"
                    spellCheck={false}
                    value={query}
                    aria-label={t('skills.search')}
                    placeholder={t('skills.search')}
                    onChange={event => setQuery(event.target.value)}
                  />
                  <MarketSelector
                    value={origin}
                    onChange={setOrigin}
                    label={t('skills.origin')}
                    className="dsh_market_category"
                    options={[
                      { value: 'all', label: t('skills.origin.allLabel'), ...(readyResult ? { count: readyResult.skills.length } : {}) },
                      ...groups.map(group => ({
                        value: group.id,
                        label: t(`skills.origin.${group.id}`),
                        ...(readyResult ? { count: group.total } : {}),
                      })),
                    ]}
                  />
                </div>
              ))}
            </div>
          </>
        ) : ((available || busy) && (
          <div className="dsh_market_filterBar">
            <div className="dsh_market_filterActions">
              <input
                className="dsh_market_search dsh_market_filterSearch"
                type="search"
                spellCheck={false}
                value={query}
                aria-label={t('skills.search')}
                placeholder={t('skills.search')}
                onChange={event => setQuery(event.target.value)}
              />
              <MarketSelector
                value={origin}
                onChange={setOrigin}
                label={t('skills.origin')}
                className="dsh_market_category"
                options={[
                  { value: 'all', label: t('skills.origin.allLabel'), ...(readyResult ? { count: readyResult.skills.length } : {}) },
                  ...groups.map(group => ({
                    value: group.id,
                    label: t(`skills.origin.${group.id}`),
                    ...(readyResult ? { count: group.total } : {}),
                  })),
                ]}
              />
            </div>
          </div>
        ))}
      </div>
      <div className={project ? 'dsh_market_projectSkillsResults' : 'dsh_market_results'} aria-busy={!showFeatured && busy}>
        {showFeatured ? (
          <>
            {(featuredQuery.trim() !== '' || featuredCategory !== 'all' || featuredOrigin !== 'all') && featuredItems.length > 0 && (
              <p className="dsh_market_status" aria-live="polite">
                {t('filter.results', { shown: String(featuredItems.length) })}
                <button
                  type="button"
                  className="dsh_market_clearFilters"
                  onClick={() => {
                    setFeaturedQuery('')
                    setFeaturedCategory('all')
                    setFeaturedOrigin('all')
                  }}
                >
                  {t('filter.clear')}
                </button>
              </p>
            )}
            {featuredItems.length === 0 ? (
              <p className="dsh_market_status">{t('skills.featured.noMatch')}</p>
            ) : (
              <ul className="dsh_market_cards dsh_market_cardsUniform">
                {featuredItems.map(item => (
                  <FeaturedSkillCard
                    key={item.id}
                    t={t}
                    item={item}
                    installed={featuredMatches.get(item.id) ?? null}
                    onOpenDetail={() => setSelectedFeatured(item)}
                    onViewInstalled={viewInstalledSkill}
                  />
                ))}
              </ul>
            )}
            <p className="dsh_market_note">
              {t('skills.featured.sourceNote', { total: String(FEATURED_SKILLS.length) })}
              {' · '}
              <a href="https://skills.sh" target="_blank" rel="noreferrer">skills.sh All Time</a>
            </p>
          </>
        ) : (
          <>
            {view.status === 'loading' && <p className="dsh_market_status" role="status">{t('skills.loading')}</p>}
            {view.status === 'no-session' && <p className="dsh_market_status">{t('skills.noSession')}</p>}
            {view.status === 'failed' && (
              <div className="dsh_market_notice dsh_market_skillsNotice">
                <div role="alert">
                  <h3>{t(view.writerHeld ? 'skills.writerHeld' : 'skills.failed')}</h3>
                  <p className="dsh_market_noticeBody">{t(view.writerHeld ? 'skills.writerHeldHint' : 'skills.failedHint')}</p>
                </div>
                <MarketButton intent="primary" onClick={retry}>{t('skills.retry')}</MarketButton>
                <details className="dsh_market_installDetails" key={view.message}>
                  <summary>{t('skills.diagnostic')}<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg></summary>
                  <pre className="dsh_market_directMessage">{view.message}</pre>
                </details>
              </div>
            )}
            {readyResult && !readyResult.complete && <p className="dsh_market_status" role="status" data-error="true">{t('skills.incomplete')}</p>}
            {actionError && <p className="dsh_market_status" role="alert" data-error="true">{actionError}</p>}
            {deleteFeedback.status === 'notice' && <p className="dsh_market_installedNotice" role="status">{deleteFeedback.message}</p>}
            {deleteFeedback.status === 'error' && <p className="dsh_market_status" role="alert" data-error="true">{deleteFeedback.message}</p>}
            {readyResult && (count === 0 || project || needle !== '' || origin !== 'all') && (
              <p className="dsh_market_status" role="status">
                {count > 0 ? t('skills.count', { count: String(count) })
                  : origin === 'project' && groups[0].total === 0 && readyResult.complete ? t('skills.noProject')
                    : readyResult.skills.length === 0 && readyResult.complete ? t('skills.empty') : t('skills.noMatches')}
              </p>
            )}
            {!project && readyResult && readyResult.skills.length === 0 && readyResult.complete && (
              <div className="dsh_market_mcpEmptyActions">
                <MarketButton intent="primary" onClick={() => setSubTab('featured')}>{t('skills.emptyFeatured')}</MarketButton>
              </div>
            )}
            {groups.filter(group => group.items.length > 0).map(group => (
              <section key={group.id} className="dsh_market_skillGroup" aria-label={t(`skills.origin.${group.id}`)}>
                <div className="dsh_market_skillGroupHead">
                  <h3>{t(`skills.origin.${group.id}`)}</h3>
                  <span className="dsh_market_skillGroupCount">{group.items.length}</span>
                </div>
                <ul className="dsh_market_cards dsh_market_cardsUniform">
                  {group.items.map(skill => {
                    const { sourcePath } = skill
                    const source = skill.sourceDirectory ?? skill.provider
                    const rowKey = skillRowKey(skill)
                    const deletingAny = deleteModal.status === 'deleting'
                    const deletable = deleteInstalledSkill !== undefined && canDeleteInstalledSkill(skill)
                    return (
                      <li key={rowKey} className="dsh_market_card">
                        <div className="dsh_market_head">
                          <span className="dsh_market_name" title={skill.name}>{skill.name}</span>
                          <span
                            className="dsh_market_installedState"
                            data-state={group.id === 'bundled' ? 'installed' : 'running'}
                          >
                            {t(`skills.origin.${group.id}`)}
                          </span>
                        </div>
                        <p className="dsh_market_meta">
                          {skill.modelInvocable && <span className="dsh_market_categoryTag">{t('skills.model')}</span>}
                          {skill.userInvocable && <span className="dsh_market_categoryTag" title={'/' + skill.name}>{t('skills.user')}</span>}
                          {!skill.modelInvocable && !skill.userInvocable && <span className="dsh_market_categoryTag">{t('skills.invocation.restricted')}</span>}
                          <span className="dsh_market_skillSource" title={sourcePath ?? source}>{source}</span>
                        </p>
                        {skill.description && <p className="dsh_market_desc" title={skill.description}>{skill.description}</p>}
                        {skill.whenToUse && <p className="dsh_market_meta">{skill.whenToUse}</p>}
                        <div className="dsh_market_foot">
                          {folderAvailable && sourcePath && (
                            <MarketButton
                              intent="secondary"
                              disabled={deletingAny}
                              title={sourcePath}
                              onClick={() => { void openSkillFolder(sourcePath) }}
                            >
                              {t('skills.openFolder')}
                            </MarketButton>
                          )}
                          {deletable && (
                            <MarketButton
                              intent="danger"
                              disabled={deletingAny}
                              onClick={() => {
                                setDeleteFeedback({ status: 'none' })
                                setDeleteModal({ status: 'confirming', skill })
                              }}
                            >
                              {t('skills.delete')}
                            </MarketButton>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>
      {!project && selectedFeatured !== null && (
        <FeaturedSkillModal
          key={selectedFeatured.id}
          t={t}
          item={selectedFeatured}
          installed={featuredMatches.get(selectedFeatured.id) ?? null}
          defaultProjectDir={readyResult?.cwd ?? ''}
          folderAvailable={folderAvailable}
          aiInstallBusy={aiInstallBusy}
          aiInstallFeedback={aiInstallFeedback}
          onClose={() => setSelectedFeatured(null)}
          onViewInstalled={viewInstalledSkill}
          onInstalled={retry}
          onOpenFolder={openSkillFolder}
          onDirectInstall={installFeaturedSkill}
          onPickProjectDir={pickProjectDir}
          onAskAiInstall={onAskAiInstall}
        />
      )}
      {deleteModal.status !== 'closed' && (
        <SkillDeleteModal
          t={t}
          skill={deleteModal.skill}
          deleting={deleteModal.status === 'deleting'}
          error={deleteModal.status === 'confirming' ? deleteModal.error : undefined}
          onConfirm={() => { void confirmDeleteSkill(deleteModal.skill) }}
          onClose={() => {
            if (deleteModal.status !== 'deleting') setDeleteModal({ status: 'closed' })
          }}
        />
      )}
    </div>
  )
}

function SkillDeleteModal({ t, skill, deleting, error, onConfirm, onClose }: {
  t: MarketLocale
  skill: MarketSkill
  deleting: boolean
  error?: string
  onConfirm: () => void
  onClose: () => void
}): ReactElement {
  const handleClose = () => {
    if (!deleting) onClose()
  }
  const title = t('skills.deleteModal.title')
  return (
    <Modal open headless title={title} className="dsh_market_modal" onClose={handleClose}>
      <div className="dsh_market_directPanel dsh_market_mcpEditor">
        <div className="dsh_market_directHead">
          <div className="dsh_market_installHeading">
            <h3>{title}</h3>
            <small>{skill.name}</small>
          </div>
          <button
            type="button"
            className="dsh_market_directClose"
            aria-label={t('skills.featured.close')}
            disabled={deleting}
            onClick={handleClose}
          >
            <IconCloseOutlineRegular size={16} />
          </button>
        </div>

        <p className="dsh_market_installSummary">{t('skills.confirmDelete', { name: skill.name })}</p>

        {skill.sourcePath && (
          <div className="dsh_market_skillDetailMeta">
            <div className="dsh_market_skillDetailRow">
              <span>{t('skills.deleteModal.pathLabel')}</span>
              <code>{skill.sourcePath}</code>
            </div>
          </div>
        )}

        {deleting && (
          <div className="dsh_market_mcpInstallPanel">
            <div className="dsh_market_mcpInstallStatusRow">
              <StateDot state="ongoing" className="dsh_market_stateDot" />
              <p role="status">
                <TextShimmer active>{t('skills.deletingHint', { name: skill.name })}</TextShimmer>
              </p>
            </div>
          </div>
        )}

        {error && (
          <p className="dsh_market_status" data-error="true" role="alert">
            {error}
          </p>
        )}

        <div className="dsh_market_installFooter">
          <MarketButton size="md" intent="secondary" disabled={deleting} onClick={handleClose}>
            {t('installed.cancel')}
          </MarketButton>
          <MarketButton size="md" intent="danger" disabled={deleting} onClick={onConfirm}>
            {deleting ? t('skills.deleting') : t('skills.confirmDeleteBtn')}
          </MarketButton>
        </div>
      </div>
    </Modal>
  )
}

function FeaturedSkillCard({ t, item, installed, onOpenDetail, onViewInstalled }: {
  t: MarketLocale
  item: FeaturedSkill
  installed: MarketSkill | null
  onOpenDetail: () => void
  onViewInstalled: (name: string) => void
}): ReactElement {
  const isZh = t('lang') === 'zh'
  const description = isZh ? item.descriptionZh : item.descriptionEn
  const installsCompact = formatSkillInstalls(item.installs)
  const metaParts = [
    item.official ? t('skills.featured.officialBadge') : '',
    installsCompact !== '' ? t('skills.featured.installsShort', { count: installsCompact }) : '',
  ].filter(part => part !== '')
  return (
    <li className="dsh_market_card dsh_market_catalogCard">
      <div className="dsh_market_head">
        <PluginLogo src={featuredSkillIconUrl(item)} name={item.name} fullName={item.source} />
        <div className="dsh_market_identity">
          <span className="dsh_market_name" title={item.name}>{item.name}</span>
          <span className="dsh_market_packageName" title={item.source}>{item.source}</span>
        </div>
        {installed !== null && (
          <span className="dsh_market_owned" title={installed.sourceDirectory ?? installed.provider}>
            {t('skills.featured.installedBadge')}
          </span>
        )}
      </div>
      <p className="dsh_market_meta">
        <span className="dsh_market_categoryTag">{t(`skills.featured.category.${item.category}`)}</span>
        {metaParts.length > 0 && (
          <span title={t('skills.featured.installsTitle', { count: item.installs.toLocaleString() })}>
            {metaParts.join(' · ')}
          </span>
        )}
      </p>
      <p className="dsh_market_desc" title={description}>{description}</p>
      <div className="dsh_market_foot">
        <a className="dsh_market_link" href={featuredSkillGithubUrl(item)} target="_blank" rel="noreferrer">
          {t('skills.featured.github')}
        </a>
        {installed !== null ? (
          <MarketButton intent="primary" onClick={() => onViewInstalled(installed.name)}>
            {t('direct.manage')}
          </MarketButton>
        ) : (
          <MarketButton intent="primary" onClick={onOpenDetail}>
            {t('direct.install')}
          </MarketButton>
        )}
      </div>
    </li>
  )
}

type DirectSkillInstallState =
  | { readonly status: 'idle' }
  | { readonly status: 'installing' }
  | { readonly status: 'done'; readonly result: InstallFeaturedSkillResult }
  | { readonly status: 'exists'; readonly targetPath: string }
  | { readonly status: 'error'; readonly message: string }

function skillInstallErrorText(t: MarketLocale, result: InstallFeaturedSkillResult): string {
  switch (result.code) {
    case 'invalid-project-dir': return t('skills.featured.installError.invalidProjectDir')
    case 'download-failed': return t('skills.featured.installError.downloadFailed', { reason: result.error })
    case 'invalid-skill': return t('skills.featured.installError.invalidSkill')
    case 'cancelled': return t('skills.featured.installError.cancelled')
    default: return t('skills.featured.installFailed', { reason: result.error || 'unknown error' })
  }
}

function FeaturedSkillModal({
  t,
  item,
  installed,
  defaultProjectDir,
  folderAvailable,
  aiInstallBusy,
  aiInstallFeedback,
  onClose,
  onViewInstalled,
  onInstalled,
  onOpenFolder,
  onDirectInstall,
  onPickProjectDir,
  onAskAiInstall,
}: {
  t: MarketLocale
  item: FeaturedSkill
  installed: MarketSkill | null
  defaultProjectDir: string
  folderAvailable: boolean
  aiInstallBusy: boolean
  aiInstallFeedback: SkillAiInstallFeedback | null
  onClose: () => void
  onViewInstalled: (name: string) => void
  onInstalled: () => void
  onOpenFolder: (path: string) => Promise<void>
  onDirectInstall?: (request: InstallFeaturedSkillRequest, signal?: AbortSignal) => Promise<InstallFeaturedSkillResult>
  onPickProjectDir?: () => Promise<string | null>
  onAskAiInstall?: (
    item: FeaturedSkill,
    target?: { readonly scope: FeaturedSkillInstallScope; readonly projectDir?: string },
  ) => Promise<boolean>
}): ReactElement {
  const isZh = t('lang') === 'zh'
  const scopeRadioName = useId()
  const [scope, setScope] = useState<FeaturedSkillInstallScope>('user-dsh')
  const [projectDir, setProjectDir] = useState(defaultProjectDir)
  const projectDirDirtyRef = useRef(false)
  const [pickingDir, setPickingDir] = useState(false)
  const [asking, setAsking] = useState(false)
  const [installState, setInstallState] = useState<DirectSkillInstallState>({ status: 'idle' })
  const abortRef = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      abortRef.current?.abort()
    }
  }, [])
  useEffect(() => {
    if (!projectDirDirtyRef.current && projectDir === '' && defaultProjectDir.trim() !== '') {
      setProjectDir(defaultProjectDir)
    }
  }, [defaultProjectDir, projectDir])

  const installing = installState.status === 'installing'
  const installsCompact = formatSkillInstalls(item.installs)

  const handleClose = () => {
    if (installing) return
    onClose()
  }

  const changeScope = (next: FeaturedSkillInstallScope) => {
    if (installing) return
    setScope(next)
    setInstallState(current => (current.status === 'exists' || current.status === 'error' ? { status: 'idle' } : current))
  }

  const pickProjectFolder = async () => {
    if (!onPickProjectDir || pickingDir || installing) return
    setPickingDir(true)
    try {
      const picked = await onPickProjectDir()
      if (!mounted.current || picked === null || picked.trim() === '') return
      projectDirDirtyRef.current = true
      setProjectDir(picked.trim())
      setInstallState(current => (current.status === 'exists' || current.status === 'error' ? { status: 'idle' } : current))
    } finally {
      if (mounted.current) setPickingDir(false)
    }
  }

  const runDirectInstall = async (overwrite: boolean) => {
    if (!onDirectInstall || installing) return
    if (scope === 'project-dsh' && projectDir.trim() === '') {
      setInstallState({ status: 'error', message: t('skills.featured.projectDirRequired') })
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    setInstallState({ status: 'installing' })
    try {
      const result = await onDirectInstall({
        id: item.id,
        scope,
        ...(scope === 'project-dsh' ? { projectDir: projectDir.trim() } : {}),
        ...(overwrite ? { overwrite: true } : {}),
      }, controller.signal)
      if (!mounted.current) return
      if (result.ok) {
        setInstallState({ status: 'done', result })
        onInstalled()
      } else if (result.code === 'already-exists') {
        setInstallState({ status: 'exists', targetPath: result.targetPath })
      } else {
        setInstallState({ status: 'error', message: skillInstallErrorText(t, result) })
      }
    } catch (error) {
      if (!mounted.current) return
      setInstallState({
        status: 'error',
        message: controller.signal.aborted
          ? t('skills.featured.installError.cancelled')
          : t('skills.featured.installFailed', { reason: error instanceof Error ? error.message : String(error) }),
      })
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  const cancelDirectInstall = () => {
    abortRef.current?.abort()
  }

  const askAi = async () => {
    if (!onAskAiInstall || asking || aiInstallBusy || installing) return
    setAsking(true)
    try {
      const ok = await onAskAiInstall(item, {
        scope,
        ...(scope === 'project-dsh' && projectDir.trim() !== '' ? { projectDir: projectDir.trim() } : {}),
      })
      if (ok && mounted.current) onClose()
    } finally {
      if (mounted.current) setAsking(false)
    }
  }

  const canDirectInstall = onDirectInstall !== undefined
  const scopeOptions: readonly {
    readonly value: FeaturedSkillInstallScope
    readonly title: string
    readonly desc: string
  }[] = [
    {
      value: 'user-dsh',
      title: t('skills.featured.scope.userDsh'),
      desc: t('skills.featured.scope.userDshDesc', { name: item.name }),
    },
    {
      value: 'user-agents',
      title: t('skills.featured.scope.userAgents'),
      desc: t('skills.featured.scope.userAgentsDesc', { name: item.name }),
    },
    {
      value: 'project-dsh',
      title: t('skills.featured.scope.projectDsh'),
      desc: t('skills.featured.scope.projectDshDesc', { name: item.name }),
    },
  ]

  return (
    <Modal open headless title={item.name} className="dsh_market_modal" onClose={handleClose}>
      <div className="dsh_market_directPanel dsh_market_mcpEditor">
        <div className="dsh_market_directHead">
          <PluginLogo src={featuredSkillIconUrl(item)} name={item.name} fullName={item.source} />
          <div className="dsh_market_installHeading">
            <h3>{item.name}</h3>
            <small>
              {item.source}
              {item.official ? ` · ${t('skills.featured.officialBadge')}` : ''}
              {installsCompact !== '' ? ` · ${installsCompact}` : ''}
            </small>
          </div>
          <button
            type="button"
            className="dsh_market_directClose"
            aria-label={t('skills.featured.close')}
            disabled={installing}
            onClick={handleClose}
          >
            <IconCloseOutlineRegular size={16} />
          </button>
        </div>

        <p className="dsh_market_installSummary">{isZh ? item.descriptionZh : item.descriptionEn}</p>

        <div className="dsh_market_skillDetailMeta">
          <div className="dsh_market_skillDetailRow">
            <span>{t('skills.featured.repoLabel')}</span>
            <div className="dsh_market_skillDetailLinks">
              <a className="dsh_market_inlineLink" href={featuredSkillGithubUrl(item)} target="_blank" rel="noreferrer">
                {item.source}
              </a>
              <span className="dsh_market_skillDetailSep" aria-hidden="true">·</span>
              <a className="dsh_market_inlineLink" href={featuredSkillSkillsShUrl(item)} target="_blank" rel="noreferrer">
                {t('skills.featured.skillsSh')}
              </a>
            </div>
          </div>
          <div className="dsh_market_skillDetailRow">
            <span>{t('skills.featured.pathLabel')}</span>
            <code>{item.path === '' ? t('skills.featured.pathRoot') : item.path}</code>
          </div>
        </div>

        {installState.status === 'done' ? (
          <div className="dsh_market_mcpInstallPanel" data-tone="success">
            <div className="dsh_market_mcpInstallStatusRow">
              <StateDot state="done" appearance="step" size={16} className="dsh_market_stateDot" />
              <div>
                <p role="status">
                  {t('skills.featured.installSuccess', {
                    path: installState.result.targetPath,
                    count: String(installState.result.fileCount),
                  })}
                </p>
                {installState.result.hasScripts && (
                  <p className="dsh_market_meta">{t('skills.featured.installSuccessScripts')}</p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <>
            <fieldset className="dsh_market_skillTargetGroup" disabled={installing}>
              <legend>{t('skills.featured.targetLabel')}</legend>
              {scopeOptions.map(option => (
                <div
                  key={option.value}
                  className="dsh_market_skillTargetOption"
                  data-selected={scope === option.value ? 'true' : undefined}
                >
                  <label className="dsh_market_skillTargetHeader">
                    <input
                      type="radio"
                      name={scopeRadioName}
                      value={option.value}
                      checked={scope === option.value}
                      onChange={() => changeScope(option.value)}
                    />
                    <div className="dsh_market_skillTargetCopy">
                      <span className="dsh_market_skillTargetTitle">{option.title}</span>
                      <span className="dsh_market_skillTargetDesc">{option.desc}</span>
                    </div>
                  </label>
                  {option.value === 'project-dsh' && scope === 'project-dsh' && (
                    <div className="dsh_market_skillProjectRow">
                      <input
                        type="text"
                        value={projectDir}
                        spellCheck={false}
                        placeholder={t('skills.featured.projectDirPlaceholder')}
                        aria-label={t('skills.featured.scope.projectDsh')}
                        onChange={event => {
                          projectDirDirtyRef.current = true
                          setProjectDir(event.target.value)
                          setInstallState(current => (current.status === 'exists' || current.status === 'error' ? { status: 'idle' } : current))
                        }}
                      />
                      {onPickProjectDir && (
                        <MarketButton
                          intent="secondary"
                          disabled={pickingDir || installing}
                          onClick={() => { void pickProjectFolder() }}
                        >
                          {t('skills.featured.chooseProjectDir')}
                        </MarketButton>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </fieldset>

            {installState.status === 'installing' && (
              <div className="dsh_market_mcpInstallPanel">
                <div className="dsh_market_mcpInstallStatusRow">
                  <StateDot state="ongoing" className="dsh_market_stateDot" />
                  <p role="status">
                    <TextShimmer active>{t('skills.featured.installingHint')}</TextShimmer>
                  </p>
                </div>
              </div>
            )}

            {installState.status === 'exists' && (
              <p className="dsh_market_status" role="status">
                {t('skills.featured.installExists', { path: installState.targetPath })}
              </p>
            )}

            {installState.status === 'error' && (
              <p className="dsh_market_status" data-error="true" role="status">
                {installState.message}
              </p>
            )}

            <div className="dsh_market_mcpRisk" role="note">
              <p className="dsh_market_meta">{t('skills.featured.safetyNote')}</p>
            </div>

            {aiInstallFeedback && aiInstallFeedback.skillId === item.id && (
              <p
                className="dsh_market_status"
                data-error={aiInstallFeedback.status === 'error' ? 'true' : undefined}
                role="status"
              >
                {aiInstallFeedback.message}
              </p>
            )}
          </>
        )}

        <div className="dsh_market_installFooter dsh_market_skillModalFooter">
          {installState.status === 'done' ? (
            <>
              {folderAvailable ? (
                <MarketButton
                  size="md"
                  intent="secondary"
                  onClick={() => { void onOpenFolder(installState.result.targetPath) }}
                >
                  {t('skills.featured.openInstalledDir')}
                </MarketButton>
              ) : <span />}
              <div className="dsh_market_skillModalFooterRight">
                <MarketButton size="md" intent="secondary" onClick={() => onViewInstalled(item.name)}>
                  {t('skills.featured.viewInstalled')}
                </MarketButton>
                <MarketButton size="md" intent="primary" onClick={onClose}>
                  {t('skills.featured.done')}
                </MarketButton>
              </div>
            </>
          ) : installing ? (
            <>
              <span />
              <div className="dsh_market_skillModalFooterRight">
                <MarketButton size="md" intent="secondary" onClick={cancelDirectInstall}>
                  {t('skills.featured.cancel')}
                </MarketButton>
              </div>
            </>
          ) : (
            <>
              {onAskAiInstall ? (
                <MarketButton size="md" intent="secondary" disabled={asking || aiInstallBusy} onClick={() => { void askAi() }}>
                  {asking || aiInstallBusy ? t('skills.featured.askingAi') : t('skills.featured.askAi')}
                </MarketButton>
              ) : <span />}
              <div className="dsh_market_skillModalFooterRight">
                <MarketButton size="md" intent="secondary" onClick={handleClose}>{t('skills.featured.close')}</MarketButton>
                {canDirectInstall ? (
                  installState.status === 'exists' ? (
                    <MarketButton size="md" intent="primary" onClick={() => { void runDirectInstall(true) }}>
                      {t('skills.featured.overwriteInstall')}
                    </MarketButton>
                  ) : (
                    <MarketButton
                      size="md"
                      intent="primary"
                      disabled={scope === 'project-dsh' && projectDir.trim() === ''}
                      onClick={() => { void runDirectInstall(false) }}
                    >
                      {t('skills.featured.installNow')}
                    </MarketButton>
                  )
                ) : installed !== null && (
                  <MarketButton size="md" intent="primary" onClick={() => onViewInstalled(installed.name)}>
                    {t('skills.featured.viewInstalled')}
                  </MarketButton>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
