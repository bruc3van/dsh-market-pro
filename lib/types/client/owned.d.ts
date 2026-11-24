import type { MarketInstalledPackage } from '../contract.ts';
export { catalogIndexForInstalled, hasRemainingTargets, ownedBy, ownedByTarget, ownedIndexOf, shortName } from '../ownedMatch.ts';
/**
 * How the upgrade prompt names what is installed: `package version`, or the
 * package alone when the version is not in a shape safe to interpolate. Both
 * halves are shape-checked — see the INVARIANT in locales.ts.
 */
export declare function describeInstalled(item: MarketInstalledPackage): string;
