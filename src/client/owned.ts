/**
 * The join between the catalog and what this profile already has.
 *
 * The two sides are keyed differently — the catalog is a crawl of GitHub, so
 * repository identity is `owner/name`, while an install is a package name.
 * Subscription cards carry an exact package identity; repository cards need
 * the legacy join. This module holds the whole of that
 * reconciliation, out of the section's rendering and in a plain module, so
 * the rules that decide whether a card says "install" or "upgrade" can be
 * tested directly rather than through a React tree.
 */
import { isSafeVersion } from '../shapes.ts'
import type { MarketInstalledPackage } from '../contract.ts'
export { catalogIndexForInstalled, hasRemainingTargets, ownedBy, ownedByTarget, ownedIndexOf, shortName } from '../ownedMatch.ts'

/**
 * How the upgrade prompt names what is installed: `package version`, or the
 * package alone when the version is not in a shape safe to interpolate. Both
 * halves are shape-checked — see the INVARIANT in locales.ts.
 */
export function describeInstalled(item: MarketInstalledPackage): string {
  return isSafeVersion(item.version) ? `${item.packageName} ${item.version}` : item.packageName
}
