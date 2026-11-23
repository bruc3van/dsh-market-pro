import { IconCloseOutlineRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { MarketSelector } from './InstallModeSelector.tsx'
import { MarketButton } from './MarketButton.tsx'
import { PluginLogo } from './PluginLogo.tsx'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { MarketSkill, MarketSkillsResult } from '../contract.ts'
import {
  FEATURED_SKILLS,
  FEATURED_SKILL_CATEGORIES,
  featuredSkillGithubUrl,
  featuredSkillInstallCommand,
  featuredSkillSkillsShUrl,
  findInstalledFeaturedSkill,
  formatSkillInstalls,
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
  canOpenFolder: () => Promise<boolean>
  openFolder: (path: string) => Promise<void>
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
  onRegisterRefresh?: (action: HeaderRefreshAction | null) => void
  onAskAiInstall?: (item: FeaturedSkill) => Promise<boolean>
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
            {showFeatured && (
              <div className="dsh_market_mcpSummaryBar">
                <div className="dsh_market_mcpRuntimeBar" role="group" aria-label={t('skills.featured.filter.aria')}>
                  {([
                    ['all', 'skills.featured.filter.all'],
                    ['official', 'skills.featured.filter.official'],
                  ] as const).map(([value, key]) => (
                    <button
                      key={value}
                      type="button"
                      className="dsh_market_mcpRuntimePill"
                      aria-pressed={featuredOrigin === value}
                      onClick={() => setFeaturedOrigin(value)}
                    >
                      {t(key)} <span>{featuredOriginCount(value)}</span>
                    </button>
                  ))}
                </div>
                <p className="dsh_market_meta">
                  {t('skills.featured.summary', { shown: String(featuredItems.length), total: String(FEATURED_SKILLS.length) })}
                </p>
              </div>
            )}
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
          featuredItems.length === 0 ? (
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
          )
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
            {readyResult && (
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
                <h3>{t(`skills.origin.${group.id}`)}</h3>
                <ul className="dsh_market_cards dsh_market_skillCards">
                  {group.items.map(skill => {
                    const { sourcePath } = skill
                    const source = skill.sourceDirectory ?? skill.provider
                    return (
                      <li key={skill.name} className="dsh_market_card dsh_market_skillCard">
                        <div className="dsh_market_head">
                          <span className="dsh_market_name">{skill.name}</span>
                        </div>
                        <div className="dsh_market_meta dsh_market_skillBadges">
                          {skill.modelInvocable && <span className="dsh_market_categoryTag">{t('skills.model')}</span>}
                          {skill.userInvocable && <span className="dsh_market_categoryTag" title={'/' + skill.name}>{t('skills.user')}</span>}
                          {!skill.modelInvocable && !skill.userInvocable && <span className="dsh_market_categoryTag">{t('skills.invocation.restricted')}</span>}
                        </div>
                        {skill.description && <p className="dsh_market_desc" title={skill.description}>{skill.description}</p>}
                        {skill.whenToUse && <p className="dsh_market_meta">{skill.whenToUse}</p>}
                        <div className="dsh_market_foot dsh_market_skillFooter">
                          <span className="dsh_market_meta dsh_market_skillSource" title={sourcePath ?? source}>{source}</span>
                          {folderAvailable && sourcePath && (
                            <button type="button" className="dsh_market_folderButton" aria-label={t('skills.openFolder') + ' ' + skill.name}
                              title={t('skills.openFolder') + ' · ' + sourcePath}
                              onClick={() => void openSkillFolder(sourcePath)}>
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.3l2 2.2h8.7A1.5 1.5 0 0 1 21 8.7v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.7z" />
                              </svg>
                            </button>
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
          t={t}
          item={selectedFeatured}
          installed={featuredMatches.get(selectedFeatured.id) ?? null}
          aiInstallBusy={aiInstallBusy}
          aiInstallFeedback={aiInstallFeedback}
          onClose={() => setSelectedFeatured(null)}
          onViewInstalled={viewInstalledSkill}
          onAskAiInstall={onAskAiInstall}
        />
      )}
    </div>
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
  return (
    <li className="dsh_market_card dsh_market_catalogCard dsh_market_mcpFeaturedCard">
      <div className="dsh_market_head">
        <PluginLogo name={item.name} fullName={item.source} />
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
      <div className="dsh_market_meta dsh_market_skillBadges">
        <span className="dsh_market_categoryTag">{t(`skills.featured.category.${item.category}`)}</span>
        {item.official && (
          <span className="dsh_market_categoryTag dsh_market_skillOfficialTag">
            {t('skills.featured.officialBadge')}
          </span>
        )}
        {installsCompact !== '' && (
          <span
            className="dsh_market_categoryTag dsh_market_skillInstallsTag"
            title={t('skills.featured.installsTitle', { count: item.installs.toLocaleString() })}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 4v12m0 0-4-4m4 4 4-4M5 20h14" />
            </svg>
            {installsCompact}
          </span>
        )}
      </div>
      <p className="dsh_market_desc" title={description}>{description}</p>
      <div className="dsh_market_foot dsh_market_mcpFeaturedFooter">
        <a className="dsh_market_link" href={featuredSkillGithubUrl(item)} target="_blank" rel="noreferrer">
          {t('skills.featured.github')}
        </a>
        <div className="dsh_market_mcpFeaturedFooterRight">
          {installed !== null ? (
            <MarketButton intent="secondary" onClick={() => onViewInstalled(installed.name)}>
              {t('skills.featured.viewInstalled')}
            </MarketButton>
          ) : (
            <MarketButton intent="primary" onClick={onOpenDetail}>
              {t('skills.featured.details')}
            </MarketButton>
          )}
        </div>
      </div>
    </li>
  )
}

function FeaturedSkillModal({ t, item, installed, aiInstallBusy, aiInstallFeedback, onClose, onViewInstalled, onAskAiInstall }: {
  t: MarketLocale
  item: FeaturedSkill
  installed: MarketSkill | null
  aiInstallBusy: boolean
  aiInstallFeedback: SkillAiInstallFeedback | null
  onClose: () => void
  onViewInstalled: (name: string) => void
  onAskAiInstall?: (item: FeaturedSkill) => Promise<boolean>
}): ReactElement {
  const isZh = t('lang') === 'zh'
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [asking, setAsking] = useState(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const command = featuredSkillInstallCommand(item)
  const installsCompact = formatSkillInstalls(item.installs)

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(command)
      if (!mounted.current) return
      setCopyState('copied')
      setTimeout(() => { if (mounted.current) setCopyState('idle') }, 2_000)
    } catch {
      if (mounted.current) setCopyState('failed')
    }
  }

  const askAi = async () => {
    if (!onAskAiInstall || asking || aiInstallBusy) return
    setAsking(true)
    try {
      const ok = await onAskAiInstall(item)
      if (ok && mounted.current) onClose()
    } finally {
      if (mounted.current) setAsking(false)
    }
  }

  return (
    <Modal open headless title={item.name} className="dsh_market_modal" onClose={onClose}>
      <div className="dsh_market_directPanel dsh_market_mcpEditor">
        <div className="dsh_market_directHead">
          <PluginLogo name={item.name} fullName={item.source} />
          <div className="dsh_market_installHeading">
            <h3>{item.name}</h3>
            <small>
              {item.source}
              {item.official ? ` · ${t('skills.featured.officialBadge')}` : ''}
              {installsCompact !== '' ? ` · ${installsCompact}` : ''}
            </small>
          </div>
          <button type="button" className="dsh_market_directClose" aria-label={t('skills.featured.close')} onClick={onClose}>
            <IconCloseOutlineRegular size={16} />
          </button>
        </div>

        <p className="dsh_market_installSummary">{isZh ? item.descriptionZh : item.descriptionEn}</p>

        <div className="dsh_market_skillDetailMeta">
          <div className="dsh_market_skillDetailRow">
            <span>{t('skills.featured.repoLabel')}</span>
            <div className="dsh_market_skillDetailLinks">
              <a className="dsh_market_link" href={featuredSkillGithubUrl(item)} target="_blank" rel="noreferrer">
                {item.source}
              </a>
              <a className="dsh_market_link" href={featuredSkillSkillsShUrl(item)} target="_blank" rel="noreferrer">
                {t('skills.featured.skillsSh')}
              </a>
            </div>
          </div>
          <div className="dsh_market_skillDetailRow">
            <span>{t('skills.featured.pathLabel')}</span>
            <code>{item.path === '' ? t('skills.featured.pathRoot') : item.path}</code>
          </div>
        </div>

        <div className="dsh_market_skillCommandBox">
          <div className="dsh_market_skillCommandHead">
            <span>{t('skills.featured.installCmdLabel')}</span>
            <button type="button" className="dsh_market_headerAction" onClick={() => { void copyCommand() }}>
              {copyState === 'copied' ? t('skills.featured.copied') : t('skills.featured.copyCmd')}
            </button>
          </div>
          <div className="dsh_market_skillCommandRow">
            <code>{command}</code>
          </div>
          {copyState === 'failed' && <p className="dsh_market_cardError">{t('skills.featured.copyFailed')}</p>}
        </div>

        <div className="dsh_market_mcpRisk">
          <p className="dsh_market_directMessage">{t('skills.featured.safetyNote')}</p>
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

        <div className="dsh_market_installFooter">
          <MarketButton intent="secondary" onClick={onClose}>{t('skills.featured.close')}</MarketButton>
          {installed !== null ? (
            <MarketButton intent="primary" onClick={() => onViewInstalled(installed.name)}>
              {t('skills.featured.viewInstalled')}
            </MarketButton>
          ) : onAskAiInstall && (
            <MarketButton intent="primary" disabled={asking || aiInstallBusy} onClick={() => { void askAi() }}>
              {asking || aiInstallBusy ? t('skills.featured.askingAi') : t('skills.featured.askAi')}
            </MarketButton>
          )}
        </div>
      </div>
    </Modal>
  )
}
