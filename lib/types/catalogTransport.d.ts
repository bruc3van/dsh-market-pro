/** One attempt against one base; a chain of three costs at most three times this. */
export declare const FETCH_TIMEOUT_MS = 20000;
/** Bound both the response stream and decompression. The compact v4 feed is ~11.6 MiB. */
export declare const MAX_CATALOG_BYTES: number;
/** unpkg and npmmirror answer every `@latest` path with a 302; a few more hops is already a loop. */
export declare const MAX_REDIRECTS = 5;
/**
 * Maximum backward drift treated as a lagging `@latest` mirror cache across
 * different hosts. Larger backward jumps (e.g. an upstream rollback or a prior
 * clock-skewed future timestamp) are accepted so the cache can never lock up.
 */
export declare const STALE_MIRROR_WINDOW_MS: number;
export declare function errorText(error: unknown): string;
/** A short host label for an error that names failed mirror attempts. */
export declare function baseLabel(base: string): string;
/**
 * Fetch one URL, following redirects by hand. The DSH host's sandboxed fetch
 * does not follow them itself, and unpkg answers every `@latest` path with a
 * 302 to the pinned version. The whole chain shares one timeout; a hop that
 * leaves the origin drops the ETag (it certifies the first server's content
 * only), and a hop down from https to http is refused.
 */
export declare function fetchFollowing(url: string, etag: string, abortSignal?: AbortSignal, acceptEncoding?: string): Promise<Response>;
/**
 * Parse a JSON body that may arrive still compressed. A body that starts
 * (after whitespace) with `{` or `[` is already plain text whatever
 * `content-encoding` claims; anything else is decoded before parsing.
 */
export declare function readJson(response: Response): Promise<unknown>;
export declare function isAllowedTarballUrl(metadataUrl: string, tarballUrl: string): boolean;
export declare function parseSnapshotTime(value: string): number;
/** Whether `candidateFetchedAt` is within the cross-mirror stale-cache window behind `currentFetchedAt`. */
export declare function isStaleMirrorSnapshot(candidateFetchedAt: string, currentFetchedAt: string): boolean;
export interface MirrorRaceOptions<T> {
    readonly targets: readonly string[];
    readonly hedgeDelayMs: number;
    readonly bodyHedgeDelayMs: number;
    readonly disposeSignal?: AbortSignal;
    readonly attempt: (target: string, abortSignal: AbortSignal | undefined, onHeaders?: () => void) => Promise<T>;
    readonly evaluate: (outcome: T) => {
        readonly accept: true;
        readonly value: T;
    } | {
        readonly accept: false;
    };
    readonly onExhausted: (sawRejected: boolean, failures: readonly (string | undefined)[]) => T | Promise<T>;
}
/**
 * Execute a single-source attempt or a TTFB/body-grace hedged race across ordered mirrors.
 */
export declare function runMirrorRace<T>(options: MirrorRaceOptions<T>): Promise<T>;
