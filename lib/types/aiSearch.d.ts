/**
 * Pure read-only catalog search, detail lookup, and environment summary for
 * the built-in `dsh_market_pro` Agent tool.
 *
 * All remote catalog fields are third-party untrusted text: every string is
 * normalized and tightly bounded here, and base64 icons are stripped so model
 * context stays small and clean.
 */
import type { MarketCatalog, MarketInstalledPackage, MarketInstalledResult, MarketPlugin, McpHostContext } from './contract.ts';
import { type CompatibilityDirection } from './compatibility.ts';
import { INVISIBLE_INJECTION_PATTERN, sanitizeUntrustedText } from './aiSanitize.ts';
import { buildAiEnvironment, type AiEnvironmentResult } from './aiEnvironment.ts';
export { INVISIBLE_INJECTION_PATTERN, sanitizeUntrustedText, buildAiEnvironment, type AiEnvironmentResult };
export type AiSearchScope = 'all' | 'featured';
export type AiSearchSort = 'relevance' | 'active' | 'stars' | 'updated';
export type AiInstallStatus = 'command' | 'manual' | 'none';
export type AiLang = 'zh' | 'en';
export interface AiInstallTargetSummary {
    readonly install: string;
    readonly note?: string;
}
export interface AiCatalogEntrySummary {
    readonly fullName: string;
    readonly packageName?: string;
    readonly name: string;
    readonly titleZh?: string;
    readonly titleEn?: string;
    readonly url?: string;
    readonly category: string;
    readonly categoryZh?: string;
    readonly categoryEn?: string;
    readonly stars: number;
    readonly pushedAt: string;
    readonly language?: string;
    readonly license?: string;
    readonly archived?: true;
    readonly disabled?: true;
    readonly featured?: true;
    readonly reason?: string;
    readonly description: string;
    readonly descriptionEn?: string;
    readonly installStatus: AiInstallStatus;
    readonly installTargets?: readonly AiInstallTargetSummary[];
    readonly hasExtraDetails?: true;
    readonly compatibility?: {
        readonly status: CompatibilityDirection | 'fallback';
        readonly required?: string;
        readonly selectedVersion?: string;
        readonly latestVersion?: string;
    };
    readonly installed: boolean;
    readonly installedVersion?: string;
}
export interface AiCatalogEntryDetail extends AiCatalogEntrySummary {
    readonly url: string;
    readonly defaultBranch: string;
    readonly keywords?: readonly string[];
    readonly tasks?: readonly string[];
    readonly requirements?: readonly string[];
    readonly note?: string;
    readonly manual?: string;
    readonly installedEnabled?: boolean;
}
export interface AiSearchOptions {
    readonly query?: string;
    readonly queries?: readonly string[];
    readonly category?: string;
    readonly scope?: AiSearchScope;
    readonly installableOnly?: boolean;
    readonly excludeInstalled?: boolean;
    readonly includeArchived?: boolean;
    readonly lang?: AiLang;
    readonly sort?: AiSearchSort;
    readonly offset?: number;
    readonly limit?: number;
    readonly dshVersion?: string;
}
export interface AiSearchResult {
    readonly total: number;
    readonly offset: number;
    readonly limit: number;
    readonly nextOffset: number | null;
    readonly matchMode: 'all' | 'exact' | 'broad';
    readonly stale: boolean;
    readonly invalidCategory?: true;
    readonly availableCategories?: readonly {
        readonly key: string;
        readonly zh: string;
        readonly en: string;
    }[];
    readonly entries: readonly AiCatalogEntrySummary[];
}
export interface AiOverviewResult {
    readonly profile: string;
    readonly fetchedAt: string;
    readonly scanned: number;
    readonly stale: boolean;
    readonly totalRepositories: number;
    readonly featuredCount: number;
    readonly installableCount: number;
    readonly categories: readonly {
        readonly key: string;
        readonly zh: string;
        readonly en: string;
        readonly count: number;
    }[];
    readonly installedCount: number;
    readonly installedPackages: readonly {
        readonly packageName: string;
        readonly version: string;
        readonly enabled: boolean;
        readonly self?: true;
    }[];
    readonly mcpServerCount: number;
    readonly mcpToolCount: number;
}
export declare const DEFAULT_AI_LIMIT = 8;
export declare const MAX_AI_LIMIT = 25;
export declare const MAX_AI_QUERIES = 6;
export declare const MAX_AI_DETAIL_TARGETS = 5;
export declare function installStatusOf(item: MarketPlugin): AiInstallStatus;
/** Build a compact index of catalog statistics, categories, and installed status. */
export declare function buildAiOverview(catalog: MarketCatalog, stale: boolean, installed: MarketInstalledResult, mcp: McpHostContext, profile: string): AiOverviewResult;
/** Search curated picks or the complete catalog with weighted relevance, CJK 2-gram fallback, and multi-query merging. */
export declare function searchAiCatalog(catalog: MarketCatalog, stale: boolean, installedPackages: readonly MarketInstalledPackage[], options?: AiSearchOptions): AiSearchResult;
/** Look up one catalog entry by `owner/repo` or `packageName` with complete bounded metadata. */
export declare function lookupAiCatalogDetail(catalog: MarketCatalog, installedPackages: readonly MarketInstalledPackage[], target: string, lang?: AiLang, dshVersion?: string): AiCatalogEntryDetail | null;
/** Batch detail lookup for up to MAX_AI_DETAIL_TARGETS items in one round-trip. */
export declare function lookupAiCatalogDetails(catalog: MarketCatalog, installedPackages: readonly MarketInstalledPackage[], targets: readonly string[], lang?: AiLang, dshVersion?: string): {
    readonly entries: readonly AiCatalogEntryDetail[];
    readonly notFound: readonly string[];
};
