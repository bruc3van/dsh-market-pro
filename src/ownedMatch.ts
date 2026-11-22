/**
 * Shared pure matching between catalog rows/targets and installed profile
 * packages. Used identically by the browser UI (`client/owned.ts`) and the
 * Host AI discovery tool (`aiSearch.ts`) so both surfaces agree on installed
 * state with zero drift.
 */
import type { MarketInstalledPackage, MarketPlugin } from './contract.ts'
import {
  normalizeRepoDirectory,
  packageNameFromInstallSpec,
  parseGitHubInstallSpec,
  type InstallInfo,
} from './installInfo.ts'

/** `@scope/name` → `name`; a bare name stays itself. */
export function shortName(packageName: string): string {
  return packageName.startsWith('@') ? packageName.slice(packageName.indexOf('/') + 1) : packageName
}

function uniqueCommandTargets(item: MarketPlugin): InstallInfo['targets'] {
  if (item.installInfo?.mode !== 'command') return []
  const targets = item.installInfo.targets
  return targets.filter((entry, index) => targets.findIndex(other => other.install === entry.install) === index)
}

/**
 * Index the installed set by every key a catalog row may find it under.
 *
 * 1. Exact package identity (`package:<name>`) — authoritative for subscription
 *    cards and npm install targets.
 * 2. Repository + subdirectory (`repoPath:<owner/name>#<dir>`) — authoritative
 *    for subdirectory / monorepo git targets (`#path:...`).
 * 3. Whole repository (`repo:<owner/name>`) — authoritative for root-repo
 *    packages, plus `subRepo:<owner/name>` as a fallback for catalog-only
 *    repository cards whose installed plugin lives in a subfolder.
 * 4. Short package name (`name:<short>`) — fallback ONLY for packages that
 *    declared no repository at all, and dropped when two installs collide.
 *
 * Uses ASCII `.toLowerCase()` throughout so locale-specific case folding
 * (e.g. `tr-TR` dotless `ı`) cannot break repository/package keys.
 */
export function ownedIndexOf(packages: readonly MarketInstalledPackage[]): ReadonlyMap<string, MarketInstalledPackage> {
  const index = new Map<string, MarketInstalledPackage>()
  const ambiguous = new Set<string>()
  for (const item of packages) {
    // An unreadable package has no version and no slug to match on, and its
    // row already says so in the installed set.
    if (item.error !== '') continue
    const pkgKey = `package:${item.packageName.toLowerCase()}`
    if (!index.has(pkgKey)) index.set(pkgKey, item)
    if (item.repository !== '') {
      const repoKey = item.repository.toLowerCase()
      const dir = item.repositoryDirectory ? normalizeRepoDirectory(item.repositoryDirectory).toLowerCase() : ''
      if (dir !== '') {
        const pathKey = `repoPath:${repoKey}#${dir}`
        if (!index.has(pathKey)) index.set(pathKey, item)
        const subKey = `subRepo:${repoKey}`
        if (!index.has(subKey)) index.set(subKey, item)
      } else {
        const key = `repo:${repoKey}`
        if (!index.has(key)) index.set(key, item)
      }
      continue
    }
    const key = `name:${shortName(item.packageName).toLowerCase()}`
    if (index.has(key)) ambiguous.add(key)
    else index.set(key, item)
  }
  for (const key of ambiguous) index.delete(key)
  return index
}

/** The installed package matching one catalog install target spec, if any. */
export function ownedByTarget(
  index: ReadonlyMap<string, MarketInstalledPackage>,
  spec: string,
): MarketInstalledPackage | undefined {
  const packageName = packageNameFromInstallSpec(spec)
  if (packageName !== '') {
    return index.get(`package:${packageName.toLowerCase()}`)
  }
  const gh = parseGitHubInstallSpec(spec)
  if (gh !== null) {
    const repoKey = gh.repository.toLowerCase()
    if (gh.directory !== '') {
      return index.get(`repoPath:${repoKey}#${gh.directory.toLowerCase()}`)
    }
    return index.get(`repo:${repoKey}`)
  }
  return undefined
}

/** The installed package a catalog row stands for, when there is one. */
export function ownedBy(
  index: ReadonlyMap<string, MarketInstalledPackage>,
  item: MarketPlugin,
  options: { allowNameFallback?: boolean } = {},
): MarketInstalledPackage | undefined {
  if (item.packageName) return index.get(`package:${item.packageName.toLowerCase()}`)
  const targets = uniqueCommandTargets(item)
  const itemRepo = item.fullName.toLowerCase()
  if (targets.length === 1) {
    const matched = ownedByTarget(index, targets[0]!.install)
    if (matched !== undefined) return matched
  } else if (targets.length > 1) {
    for (const target of targets) {
      const matched = ownedByTarget(index, target.install)
      if (matched === undefined) continue
      // A multi-target card may list an external companion plugin (whose
      // manifest points to another repository); do not let that mark this
      // repository card as installed.
      if (itemRepo !== '' && matched.repository !== '' && matched.repository.toLowerCase() !== itemRepo) continue
      return matched
    }
  }
  // When a card names explicit `#path:` or npm package targets and none of them
  // are installed, never fall back to repo/subRepo/short-name matching — that
  // would falsely claim the card from a sibling package in the same monorepo.
  const hasPathTarget = targets.some(target => (parseGitHubInstallSpec(target.install)?.directory ?? '') !== '')
  const allNpmTargets = targets.length > 0 && targets.every(target => packageNameFromInstallSpec(target.install) !== '')
  if (hasPathTarget || allNpmTargets) return undefined

  if (itemRepo !== '') {
    const byRepo = index.get(`repo:${itemRepo}`)
    if (byRepo !== undefined) return byRepo
    if (targets.length === 0) {
      const bySubRepo = index.get(`subRepo:${itemRepo}`)
      if (bySubRepo !== undefined) return bySubRepo
    }
  }
  if (options.allowNameFallback === false) return undefined
  return index.get(`name:${item.name.toLowerCase()}`)
}

/**
 * Whether a multi-target repository card still has targets not yet installed.
 * Single-target cards never offer re-install once owned.
 */
export function hasRemainingTargets(
  index: ReadonlyMap<string, MarketInstalledPackage>,
  item: MarketPlugin,
): boolean {
  if (item.packageName) return false
  const targets = uniqueCommandTargets(item)
  if (targets.length <= 1) return false
  return targets.some(target => ownedByTarget(index, target.install) === undefined)
}
