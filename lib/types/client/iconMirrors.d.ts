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
/**
 * Record a completed image load for a jsDelivr icon:
 * - A first-try load (`failedBeforeLoad === false`) resets any pending failover streak.
 * - A fallback load (`failedBeforeLoad === true`) increments the streak for that
 *   edge and promotes it once {@link JSDELIVR_PROMOTE_THRESHOLD} consecutive
 *   failovers succeed, preventing a single transient error from flipping the session.
 */
export declare function noteIconLoaded(originalSrc: string | undefined, loadedUrl: string, failedBeforeLoad: boolean): void;
