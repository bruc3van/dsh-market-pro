/**
 * Parsing, validation, and catalog hydration for `plugin-selection-meta.json`
 * sidecar metadata (bilingual search keywords and fallback Chinese summaries).
 */
import type { MarketCatalog, MarketPlugin } from './contract.ts';
export interface ParsedSelectionMetaEntry {
    readonly summary: string;
    readonly keywords: readonly string[];
}
export interface ParsedSelectionMeta {
    readonly feedVersion: string;
    readonly publishedAt: string;
    readonly sourceFetchedAt: string;
    readonly entries: ReadonlyMap<string, ParsedSelectionMetaEntry>;
}
/** Normalize and code-point-truncate untrusted catalog text without splitting surrogate pairs. */
export declare function clipCatalogText(value: unknown, limit: number): string;
/** `owner/name` with nothing else in it — the only shape a repository link is built from. */
export declare function repositorySlug(value: unknown): string | null;
/** Merge unique non-empty keywords case-insensitively while preserving existing order. */
export declare function mergeUniqueKeywords(existing: readonly string[] | undefined, extra: Iterable<string>, limit?: number): readonly string[] | undefined;
/** Map a direct v4 catalog JSON URL to its sibling `plugin-selection-meta.json` URL. */
export declare function selectionMetaUrlOf(base: string): string | null;
/**
 * Whether a fetched sidecar drifts beyond the acceptable cross-mirror TTL window
 * from the catalog it is about to hydrate. Minor same-window drift (e.g. per-file
 * CDN edge caches differing by minutes or a few publishes) is tolerated; larger
 * divergence degrades gracefully by skipping sidecar hydration.
 */
export declare function isSidecarVersionSkewed(catalog: {
    readonly feedVersion: string;
    readonly publishedAt: string;
}, sidecar: Pick<ParsedSelectionMeta, 'feedVersion' | 'publishedAt'>): boolean;
export declare function sidecarFreshnessStampOf(meta: ParsedSelectionMeta): string;
/** Parse and bound the `plugin-selection-meta.json` sidecar envelope. */
export declare function parseSelectionMeta(raw: unknown): ParsedSelectionMeta | undefined;
/** Whether a repository description is missing, placeholder, or too weak to inform selection. */
export declare function isWeakDescription(description: string, item: Pick<MarketPlugin, 'name' | 'fullName'>): boolean;
export declare function isSubstantiveSelectionSummary(summary: string): boolean;
/**
 * Merge sidecar selection metadata (bilingual keywords and fallback Chinese summaries)
 * into a derived catalog without overwriting official subscription or editorial copy.
 */
export declare function hydrateCatalogWithSelectionMeta(catalog: MarketCatalog, selectionMeta: ParsedSelectionMeta, protectedRepos?: ReadonlySet<string>): MarketCatalog;
