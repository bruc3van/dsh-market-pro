/**
 * Shared pure matching between catalog rows/targets and installed profile
 * packages. Used identically by the browser UI (`client/owned.ts`) and the
 * Host AI discovery tool (`aiSearch.ts`) so both surfaces agree on installed
 * state with zero drift.
 */
import type { MarketInstalledPackage, MarketPlugin } from './contract.ts';
/** `@scope/name` → `name`; a bare name stays itself. */
export declare function shortName(packageName: string): string;
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
export declare function ownedIndexOf(packages: readonly MarketInstalledPackage[]): ReadonlyMap<string, MarketInstalledPackage>;
/** The installed package matching one catalog install target spec, if any. */
export declare function ownedByTarget(index: ReadonlyMap<string, MarketInstalledPackage>, spec: string): MarketInstalledPackage | undefined;
/** The installed package a catalog row stands for, when there is one. */
export declare function ownedBy(index: ReadonlyMap<string, MarketInstalledPackage>, item: MarketPlugin, options?: {
    allowNameFallback?: boolean;
}): MarketInstalledPackage | undefined;
/**
 * Whether a multi-target repository card still has targets not yet installed.
 * Single-target cards never offer re-install once owned.
 */
export declare function hasRemainingTargets(index: ReadonlyMap<string, MarketInstalledPackage>, item: MarketPlugin): boolean;
