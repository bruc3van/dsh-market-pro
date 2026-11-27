/**
 * Shared client-side bidirectional compatibility localization helpers.
 */
import { type CompatFallbackInfo, type CompatibilityDirection, type DshCompatibilityIssue } from '../compatibility.ts';
import type { MarketHostError, MarketInstalledPackage, MarketPlugin } from '../contract.ts';
import type { InstallTargetInfo } from '../installInfo.ts';
import type { MarketLocale } from './copy.ts';
export type CompatMessageContext = 'installed' | 'official' | 'install';
/** Evaluate a single catalog install target against the running DSH version. */
export declare function catalogTargetCompatibility(target: Pick<InstallTargetInfo, 'dshEngine'>, item: Pick<MarketPlugin, 'installInfo'> | null | undefined, dshVersion: string | undefined): DshCompatibilityIssue | undefined;
/**
 * Evaluate a catalog item against the running DSH version.
 * Returns an issue only when every command-installable target is incompatible
 * (partial compatibility in Monorepos stays installable via individual target toggles).
 */
export declare function catalogItemCompatibility(item: Pick<MarketPlugin, 'installInfo'>, dshVersion: string | undefined): DshCompatibilityIssue | undefined;
/** Evaluate only uninstalled targets of a partially installed Monorepo card. */
export declare function remainingTargetsCompatibility(ownedIndex: ReadonlyMap<string, MarketInstalledPackage>, item: Pick<MarketPlugin, 'installInfo'>, dshVersion: string | undefined): DshCompatibilityIssue | undefined;
/** Badge label for a catalog card or target row whose DSH requirement is unmet. */
export declare function compatBadgeText(direction: CompatibilityDirection, t: MarketLocale): string;
/** Directional modal heading when installation fails or is blocked by DSH compatibility. */
export declare function formatInstallIncompatHeading(direction: CompatibilityDirection, t: MarketLocale): string;
/** Format a single pre-install catalog compatibility issue into localized warning text. */
export declare function formatPreInstallCompatText(issue: DshCompatibilityIssue, t: MarketLocale): string;
/** Format a Host `ManagementError` (`incompatible-version`, `unsupported-platform`, etc.) into localized text. */
export declare function formatHostErrorText(error: MarketHostError, t: MarketLocale, context: CompatMessageContext, options?: {
    readonly hasUpdate?: boolean;
    readonly fallbackRuntimeVersion?: string;
}): string;
/** Format notice when subscription compatibility fallback picked an older release. */
export declare function formatFallbackNoticeText(fallback: CompatFallbackInfo, dshVersion: string | undefined, t: MarketLocale): string;
/** Format directional blocked reason for an incompatible candidate in the update dialog. */
export declare function formatUpdateChoiceBlocked(choice: {
    readonly blocked?: string;
    readonly blockedKind?: CompatibilityDirection;
}, t: MarketLocale): string;
