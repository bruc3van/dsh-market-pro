/**
 * Two-edge fallback for jsDelivr plugin icons (`cdn` -> `fastly`), tailored
 * for direct China network environments where `cdn.jsdelivr.net` may stall or
 * drop packets while the official Fastly edge remains reachable.
 *
 * Non-jsDelivr URLs (data URIs, other HTTPS hosts) are passed straight through
 * untouched. Keeping the fallback chain to two official edges caps wasted
 * requests on 404 icons (e.g. renamed repositories), and requiring consecutive
 * verified failovers before promoting an edge avoids switching the whole
 * session on a single transient hiccup.
 */
export declare const JSDELIVR_HOSTS: readonly ["cdn.jsdelivr.net", "fastly.jsdelivr.net"];
export type JsDelivrHost = (typeof JSDELIVR_HOSTS)[number];
/** Consecutive failover loads required before promoting an alternate jsDelivr edge for the session. */
export declare const JSDELIVR_PROMOTE_THRESHOLD = 2;
/** Inspect the session-preferred jsDelivr edge (used by tests). */
export declare function getPreferredJsDelivrHost(): JsDelivrHost | null;
/** Reset the session-preferred jsDelivr edge and failover counters (used by tests). */
export declare function resetPreferredJsDelivrHost(): void;
/**
 * Expand a single icon `src` into an ordered candidate list:
 * - Data URIs and non-jsDelivr URLs return `[src]` unchanged.
 * - jsDelivr URLs expand to at most two official edges (`cdn`, `fastly`).
 *   If earlier icons already proved the alternate edge works after repeated
 *   failures, that edge is placed first.
 */
export declare function iconCandidatesOf(src: string | undefined): string[];
/** Ordered deduplicated candidate chain for one plugin logo, plus the identity key that resets failure state when it changes. */
export interface LogoSourceChain {
    readonly sources: readonly string[];
    readonly sourceKey: string;
}
/**
 * Expand a plugin's icon into the full failover chain `PluginLogo` walks:
 * jsDelivr edges (or the single non-jsDelivr source) followed by the owner
 * avatar, deduplicated so an icon already pointing at the avatar is not tried twice.
 */
export declare function logoSourceChainOf(src: string | undefined, avatar: string | undefined): LogoSourceChain;
/** Failure-chain position; `key` ties the count to one source identity so switching plugins starts over. */
export interface IconFailureState {
    readonly key: string;
    readonly step: number;
}
/** Advance the failover chain one step; a failure belonging to a different source identity restarts at step 1. */
export declare function advanceIconFailure(previous: IconFailureState, sourceKey: string): IconFailureState;
/** Chain position for rendering: failures recorded against a different source identity do not apply. */
export declare function currentIconStep(failure: IconFailureState, sourceKey: string): number;
/** First letter of the built-in placeholder tile, preferring the package part over the npm scope. */
export declare function logoPlaceholderLetter(name: string): string;
/**
 * Record a completed image load for a jsDelivr icon:
 * - A first-try load (`failedBeforeLoad === false`) resets any pending failover streak.
 * - A fallback load (`failedBeforeLoad === true`) increments the streak for that
 *   edge and promotes it once {@link JSDELIVR_PROMOTE_THRESHOLD} consecutive
 *   failovers succeed, preventing a single transient error from flipping the session.
 */
export declare function noteIconLoaded(originalSrc: string | undefined, loadedUrl: string, failedBeforeLoad: boolean): void;
