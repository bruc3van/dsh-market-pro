import type { MarketCatalog } from './contract.ts';
import { type ParsedSelectionMeta } from './selectionMeta.ts';
/** Default feed and mirrors (including China-reachable npmmirror tarball) serve the same npm package dataset. */
export declare const DEFAULT_CATALOG_BASE = "https://cdn.jsdelivr.net/npm/awesome-dsh-plugin-feed@latest/data/market-catalog-v4.json";
export declare const CN_MIRROR_CATALOG_BASE = "https://registry.npmmirror.com/awesome-dsh-plugin-feed/latest";
export declare const MIRROR_CATALOG_BASE = "https://unpkg.com/awesome-dsh-plugin-feed@latest/data/market-catalog-v4.json";
/** Whether `base` points to an official public catalog source (never a custom/private feed). */
export declare function isOfficialCatalogBase(base: string): boolean;
export declare const TARBALL_SELECTION_META_PATH = "package/data/plugin-selection-meta.json";
/**
 * The shape {@link deriveMarket} produces. A stored catalog records the
 * format it was derived under, and the cache gate refuses any other: a
 * revalidation only asks whether the FEED changed, so after an upgrade that
 * changes the parse a 304 would keep serving the old build's reduction
 * forever. Bump this whenever the derived catalog gains or changes a field.
 * 1 — before the editorial picks; 2 — `featured`; 3 — inline pick descriptions;
 * 4 — v2-only feeds; 5 — complete catalogs and package-identified subscriptions;
 * 6 — up to 100 editorial picks with their own category totals;
 * 7 — schema-4 compact feed support, subscription icon/keyword hydration, and npmmirror failover.
 * 8 — the editorial pick cap grows from 100 to 1000.
 * 9 — `publishedAt`, the feed's own publish stamp used for cross-mirror freshness comparison.
 * 10 — DSH runtime compatibility target selection (`dshEngine`, `compatFallback`) hydrated across subscription and repository cards.
 * 11 — `plugin-selection-meta.json` sidecar keywords and weak-description Chinese summary hydration.
 * 12 — `feedVersion`, the feed package version carried in the catalog envelope.
 */
export declare const CATALOG_FORMAT = 12;
/** Where a parsed catalog survives a restart. */
export interface CatalogCache {
    read: () => {
        catalog: MarketCatalog | null;
        marketEtag: string;
        activeBase: string;
    };
    write: (next: {
        catalog: MarketCatalog;
        marketEtag: string;
        activeBase: string;
    }) => void;
    ready?: Promise<void>;
}
/** Deployment-varying knobs the plugin config owns. */
export interface CatalogOptions {
    readonly base: string;
    readonly marketSize: number;
    readonly cache?: CatalogCache;
    readonly disposeSignal?: AbortSignal;
    readonly hedgeDelayMs?: number;
    readonly bodyHedgeDelayMs?: number;
    readonly dshVersion?: string;
}
/**
 * Drop the redundant `subscription` payload when an editorial `featured` list
 * is already present.
 */
export declare function stripUnusedSubscription(catalog: MarketCatalog): MarketCatalog;
/**
 * Parse the published market into the catalog the browser renders. The
 * publisher's file order is preserved. Only legacy schema-2 feeds are
 * truncated to marketSize; schema 3/4 carry the complete reviewed catalog.
 */
export declare function deriveMarket(body: unknown, marketSize: number, dshVersion?: string, selectionMeta?: ParsedSelectionMeta): MarketCatalog;
/** The catalog reader: memory first, then the network. */
export interface CatalogSource {
    read: (force: boolean, signal?: AbortSignal) => Promise<{
        catalog: MarketCatalog | null;
        stale: boolean;
        error: string;
    }>;
    warmup: () => void;
}
/**
 * Build the catalog reader.
 * @param options - the base URL, the market size, and the durable seat.
 * @returns the reader.
 */
export declare function createCatalogSource(options: CatalogOptions): CatalogSource;
