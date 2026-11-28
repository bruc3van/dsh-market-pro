/** Pure formatting helpers for the Refresh button's data-source tooltip. */
import type { MarketLocale } from './copy.ts';
/**
 * Format an ISO timestamp (or `YYYY-MM-DD` date) into a compact local
 * `YYYY-MM-DD HH:mm` string for hover tooltips, or `''` when absent/invalid.
 */
export declare function formatRefreshTimestamp(iso: string | undefined): string;
/** Normalize a version string with a single leading `v`, or `''` when empty. */
export declare function formatVersionTag(version: string | undefined): string;
/** Join non-empty tooltip segments with a middle dot, or `undefined` when empty. */
export declare function joinRefreshTooltip(parts: readonly (string | undefined | null)[]): string | undefined;
export interface RefreshTooltipOptions {
    readonly source: string;
    readonly version?: string;
    readonly extra?: string;
    readonly timestamp?: string;
    readonly timestampKind?: 'read' | 'updated';
}
/** Build a localized single-line refresh tooltip (`<source> [vX] · [extra] · <updated/read time>`). */
export declare function buildRefreshTooltip(t: MarketLocale, options: RefreshTooltipOptions): string | undefined;
