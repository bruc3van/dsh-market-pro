import type { MarketFeatured, MarketPlugin } from './contract.ts';
/** Decode compact schema-4 `category_table` tuples `[key, zh, en]`. */
export declare function readCategoryTable(rawTable: unknown, clipText: (value: unknown, limit: number) => string): Array<[string, string, string]>;
/**
 * Copy deduplicated artwork, search terms, and DSH compatibility targets from derived
 * subscription packages onto the corresponding `items` repository cards.
 */
export declare function hydrateRepositoriesFromSubscription(items: MarketPlugin[], byName: Map<string, MarketPlugin>, subscription: MarketFeatured): void;
/** Resolve subscription + editorial picks for complete (schema 3/4) catalogs. */
export declare function resolveCompleteCatalogLists(options: {
    readonly rawSubscription: unknown;
    readonly rawEditorial: unknown;
    readonly subscriptionUpdatedAt: string;
    readonly items: MarketPlugin[];
    readonly byName: Map<string, MarketPlugin>;
    readonly dshVersion: string | undefined;
    readonly descriptionLimit: number;
    readonly clipText: (value: unknown, limit: number) => string;
    readonly repositorySlug: (value: unknown) => string | null;
    readonly deriveFeatured: (value: unknown, declared: unknown, rows: ReadonlyMap<string, MarketPlugin>, copy?: Map<string, string>) => MarketFeatured | undefined;
}): {
    readonly featured: MarketFeatured;
    readonly subscription: undefined;
};
