/**
 * Schema-4 category-table decoding and subscription-to-repository hydration,
 * isolating per-target DSH compatibility constraints inside Monorepos.
 */
import { extractDshEngineFromRequirements } from './compatibility.ts'
import type { MarketFeatured, MarketPlugin } from './contract.ts'
import { packageNameFromInstallSpec, parseGitHubInstallSpec, type InstallTargetInfo } from './installInfo.ts'
import { clipCatalogText, mergeUniqueKeywords, repositorySlug } from './selectionMeta.ts'
import { deriveSubscription } from './subscription.ts'

/** Decode compact schema-4 `category_table` tuples `[key, zh, en]`. */
export function readCategoryTable(rawTable: unknown): Array<[string, string, string]> {
  const table: Array<[string, string, string]> = []
  if (!Array.isArray(rawTable)) return table
  for (const tuple of rawTable) {
    if (Array.isArray(tuple) && typeof tuple[0] === 'string') {
      const key = clipCatalogText(tuple[0], 60)
      table.push([key, clipCatalogText(tuple[1], 60) || key, clipCatalogText(tuple[2], 60) || key])
    } else {
      table.push(['', '', ''])
    }
  }
  return table
}

/**
 * Copy deduplicated artwork, search terms, and DSH compatibility targets from derived
 * subscription packages onto the corresponding `items` repository cards.
 */
export function hydrateRepositoriesFromSubscription(
  items: MarketPlugin[],
  byName: Map<string, MarketPlugin>,
  subscription: MarketFeatured,
): void {
  const subIconByRepo = new Map<string, string>()
  const subKeywordsByRepo = new Map<string, string[]>()
  const subTargetByPackage = new Map<string, InstallTargetInfo>()
  const subTargetByGitLocator = new Map<string, InstallTargetInfo>()
  const subRepoCount = new Map<string, number>()
  const subSingleTargetByRepo = new Map<string, InstallTargetInfo>()

  for (const entry of subscription.entries) {
    const subTarget = entry.item.installInfo?.targets[0]
    if (subTarget !== undefined) {
      const pkgName = entry.item.packageName?.toLowerCase() ?? packageNameFromInstallSpec(subTarget.install).toLowerCase()
      if (pkgName !== '' && !subTargetByPackage.has(pkgName)) {
        subTargetByPackage.set(pkgName, subTarget)
      }
      const gitLoc = parseGitHubInstallSpec(subTarget.install)
      if (gitLoc !== null) {
        const gitKey = `${gitLoc.repository.toLowerCase()}::${gitLoc.directory.toLowerCase()}`
        if (!subTargetByGitLocator.has(gitKey)) subTargetByGitLocator.set(gitKey, subTarget)
      }
    }
    const key = entry.item.fullName.toLowerCase()
    if (key === '') continue
    const nextCount = (subRepoCount.get(key) ?? 0) + 1
    subRepoCount.set(key, nextCount)
    if (nextCount === 1 && subTarget !== undefined) subSingleTargetByRepo.set(key, subTarget)
    else subSingleTargetByRepo.delete(key)
    if (entry.item.icon && !subIconByRepo.has(key)) subIconByRepo.set(key, entry.item.icon)
    const words = subKeywordsByRepo.get(key) ?? []
    for (const word of [entry.item.packageName, entry.item.titleZh, entry.item.titleEn, ...(entry.item.keywords ?? [])]) {
      if (typeof word === 'string' && word !== '') words.push(word)
    }
    if (words.length > 0) subKeywordsByRepo.set(key, words)
  }

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!
    const key = item.fullName.toLowerCase()
    const icon = item.icon ?? subIconByRepo.get(key)
    const extraKeywords = subKeywordsByRepo.get(key)
    let nextInstallInfo = item.installInfo
    if (item.installInfo?.mode === 'command' && item.installInfo.targets.length > 0) {
      let targetsChanged = false
      let anyFallbackApplied = false
      const nextTargets = item.installInfo.targets.map((target) => {
        const pkgName = packageNameFromInstallSpec(target.install).toLowerCase()
        let matched = pkgName !== '' ? subTargetByPackage.get(pkgName) : undefined
        if (matched === undefined) {
          const gitLoc = parseGitHubInstallSpec(target.install)
          if (gitLoc !== null) {
            matched = subTargetByGitLocator.get(`${gitLoc.repository.toLowerCase()}::${gitLoc.directory.toLowerCase()}`)
          }
        }
        if (matched === undefined && item.installInfo!.targets.length === 1 && subRepoCount.get(key) === 1) {
          matched = subSingleTargetByRepo.get(key)
        }
        if (matched === undefined) return target
        const useFallback = !target.compatFallback && matched.compatFallback !== undefined
        const install = useFallback ? matched.install : target.install
        const dshEngine = useFallback ? matched.dshEngine : (target.dshEngine ?? matched.dshEngine)
        const compatFallback = useFallback ? matched.compatFallback : target.compatFallback
        if (useFallback) anyFallbackApplied = true
        if (install === target.install && dshEngine === target.dshEngine && compatFallback === target.compatFallback) {
          return target
        }
        targetsChanged = true
        const { dshEngine: _prevEngine, compatFallback: _prevFallback, ...baseTarget } = target
        return {
          ...baseTarget,
          install,
          ...(dshEngine !== undefined ? { dshEngine } : {}),
          ...(compatFallback !== undefined ? { compatFallback } : {}),
        }
      })
      if (targetsChanged) {
        // When falling back to a compatible older subscription release, drop stale
        // single-target `DSH ...` requirement lines from the incompatible latest version
        // and replace them with the selected compatible version's constraint.
        const baseRequirements = anyFallbackApplied && nextTargets.length === 1
          ? item.installInfo.requirements.filter(req => extractDshEngineFromRequirements([req]) === undefined)
          : item.installInfo.requirements
        const sharedEngine = nextTargets[0]!.dshEngine
        const allShareEngine = Boolean(sharedEngine) && nextTargets.every(t => t.dshEngine === sharedEngine)
        const shouldAttachShared = allShareEngine
          && sharedEngine !== undefined
          && (baseRequirements.length === 0 || (anyFallbackApplied && nextTargets.length === 1))
        const nextRequirements = shouldAttachShared
          ? [...baseRequirements, `DSH ${sharedEngine}`]
          : baseRequirements
        nextInstallInfo = {
          ...item.installInfo,
          targets: nextTargets,
          requirements: nextRequirements,
        }
      }
    }
    const mergedKeywords = extraKeywords === undefined ? item.keywords : mergeUniqueKeywords(item.keywords, extraKeywords)
    if (icon === item.icon && mergedKeywords === item.keywords && nextInstallInfo === item.installInfo) continue
    const hydrated: MarketPlugin = {
      ...item,
      ...(icon === undefined ? {} : { icon }),
      ...(mergedKeywords === undefined ? {} : { keywords: mergedKeywords }),
      ...(nextInstallInfo === undefined ? {} : { installInfo: nextInstallInfo }),
    }
    items[i] = hydrated
    byName.set(key, hydrated)
  }
}

/** Resolve subscription + editorial picks for complete (schema 3/4) catalogs. */
export function resolveCompleteCatalogLists(options: {
  readonly rawSubscription: unknown
  readonly rawEditorial: unknown
  readonly subscriptionUpdatedAt: string
  readonly items: MarketPlugin[]
  readonly byName: Map<string, MarketPlugin>
  readonly dshVersion: string | undefined
  readonly descriptionLimit: number
  readonly deriveFeatured: (
    value: unknown,
    declared: unknown,
    rows: ReadonlyMap<string, MarketPlugin>,
    copy?: Map<string, string>,
  ) => MarketFeatured | undefined
}): { readonly featured: MarketFeatured; readonly subscription: undefined; readonly protectedRepos: ReadonlySet<string> } {
  const { rawSubscription, rawEditorial, subscriptionUpdatedAt, items, byName, dshVersion, descriptionLimit, deriveFeatured } = options
  const subscription = deriveSubscription(rawSubscription, subscriptionUpdatedAt, byName, dshVersion)
  hydrateRepositoriesFromSubscription(items, byName, subscription)
  const protectedRepos = new Set<string>()
  for (const entry of subscription.entries) {
    const key = entry.item.fullName.toLowerCase()
    if (key !== '' && entry.item.description.trim() !== '') protectedRepos.add(key)
  }
  if (rawEditorial !== undefined && rawEditorial !== null) {
    const rowsForPicks = new Map(byName)
    const copy = new Map<string, string>()
    const rawEntries = (rawEditorial as { entries?: unknown }).entries
    for (const raw of Array.isArray(rawEntries) ? rawEntries : []) {
      if (raw === null || typeof raw !== 'object') continue
      const pick = raw as { full_name?: unknown; description?: unknown }
      const slug = repositorySlug(pick.full_name)
      if (slug === null) continue
      const description = clipCatalogText(pick.description, descriptionLimit)
      if (description !== '') {
        const lower = slug.toLowerCase()
        copy.set(lower, description)
        protectedRepos.add(lower)
      }
    }
    for (const entry of subscription.entries) {
      const key = entry.item.fullName.toLowerCase()
      if (key !== '') rowsForPicks.set(key, entry.item)
    }
    const picks = deriveFeatured(rawEditorial, undefined, rowsForPicks, copy)
    return { featured: picks ?? subscription, subscription: undefined, protectedRepos }
  }
  return { featured: subscription, subscription: undefined, protectedRepos }
}
