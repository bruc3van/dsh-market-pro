/**
 * The dshMarketPro wire contract, shared verbatim by the host manifest
 * (`ctx.typert.register` in typert.ts) and the client contribution
 * (`ctx.remote.$mount` in client/remote.ts). The service exposes the reduced
 * community catalog and the plugin's own durable settings.
 *
 * Everything that crosses this boundary is remote text from a public
 * snapshot. It is reduced and sanitized on the Host — the repository link in
 * particular is rebuilt from `owner/name` rather than carried over from the
 * snapshot — so the browser half only ever renders values this contract has
 * already fixed the shape of.
 */
import { z } from 'zod';
import { type InstallInfo } from './installInfo.ts';
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol';
/** One row of the market: a community plugin the catalog kept. */
export interface MarketPlugin {
    readonly icon?: string;
    /** Present for subscription packages; repository cards retain fullName as their identity. */
    readonly packageName?: string;
    readonly titleZh?: string;
    readonly titleEn?: string;
    readonly descriptionEn?: string;
    /**
     * The publisher's installability signal for this row: a paste-ready
     * `command` target, a hand-written `manual` note, or `none` (catalog-only —
     * the repository reaches the market but has no install target yet). Absent
     * on legacy schema-2 feeds, where {@link MarketPlugin.installInfo} is the
     * only source of truth.
     */
    readonly installStatus?: 'command' | 'manual' | 'none';
    readonly keywords?: readonly string[];
    readonly archived?: boolean;
    readonly disabled?: boolean;
    readonly installInfo?: InstallInfo;
    /** Repository slug; empty for a subscription package without a repository. */
    readonly fullName: string;
    readonly owner: string;
    readonly name: string;
    /** Host-validated GitHub/Gitee repository or npm package page. */
    readonly url: string;
    readonly description: string;
    readonly stars: number;
    readonly language: string;
    readonly license: string;
    /** ISO date of the last push, for the "still maintained" read. */
    readonly pushedAt: string;
    /** The repository's default branch — the install command's fallback ref. */
    readonly defaultBranch: string;
    readonly category: string;
    readonly categoryZh: string;
    readonly categoryEn: string;
}
/** One category filter, with how many of the kept rows fall under it. */
export interface MarketCategory {
    readonly key: string;
    readonly zh: string;
    readonly en: string;
    readonly count: number;
}
/** One editorial pick: a complete card plus the editor's one-line reason. */
export interface MarketFeaturedEntry {
    /**
     * The catalog row the pick names, or — for a pick the shortlist does not
     * carry — a card the Host synthesized from the pick's own `packages` block.
     */
    readonly item: MarketPlugin;
    readonly reason: string;
}
/** The feed's editorial picks, resolved on the Host in the publisher's order. */
export interface MarketFeatured {
    readonly categories?: readonly MarketCategory[];
    readonly titleZh: string;
    readonly titleEn: string;
    readonly updatedAt: string;
    /** The publisher's own count (`featured_count`), else how many picks resolved. */
    readonly count: number;
    readonly entries: readonly MarketFeaturedEntry[];
}
/** The reduced catalog the browser renders. */
export interface MarketCatalog {
    readonly items: readonly MarketPlugin[];
    readonly categories: readonly MarketCategory[];
    /**
     * Absent when the feed carries no picks (or none survived the wire pass),
     * and in every catalog cached before the feed had them.
     */
    readonly featured?: MarketFeatured;
    /**
     * The published subscription (all verified plugins) supplied alongside the
     * editorial list. On older schema-3 feeds, `featured` carries the subscription.
     */
    readonly subscription?: MarketFeatured;
    /** When the upstream crawl ran (the snapshot's own timestamp). */
    readonly fetchedAt: string;
    /**
     * When the feed package itself was published (`published_at` in the feed
     * envelope). Absent on feeds published before the stamp existed — and
     * unlike `fetchedAt` it moves on every publish, so two publishes sharing
     * one crawl snapshot still order correctly when mirrors are compared.
     */
    readonly publishedAt?: string;
    /** When this Host last read the snapshot. */
    readonly refreshedAt: string;
    /** How many repositories the crawl saw, before curation and the top cut. */
    readonly scanned: number;
}
/** A catalog read: the answer, plus whether it is the last good one. */
export interface MarketCatalogResult {
    readonly catalog: MarketCatalog | null;
    /** The catalog is a cached one; this read did not reach the snapshot. */
    readonly stale: boolean;
    /** Why the read did not reach the snapshot, when it did not. */
    readonly error: string;
}
/** One skill this deployment can currently resolve. */
export interface MarketSkill {
    readonly name: string;
    readonly description: string;
    readonly whenToUse: string;
    /** The provider that owns the skill body (`filesystem`, `runtime`, …). */
    readonly provider: string;
    /** Discovery source reported by the winning provider. */
    readonly source?: string;
    /** Instruction file reported by the provider, when it has a file preview. */
    readonly instructionPath?: string;
    /** Actual resource directory, relative to the workspace or home when possible. */
    readonly sourceDirectory?: string;
    /**
     * The same directory as an absolute Host path, for the folder action. The
     * Host's own path opener re-verifies it before handing it to the desktop.
     */
    readonly sourcePath?: string;
    /** Verified curated catalog id (`owner/repo/skillId`) when provenance matches a featured skill. */
    readonly featuredId?: string;
    /** Whether the model may invoke it on its own. */
    readonly modelInvocable: boolean;
    /** Whether the user may invoke it with `/name`. */
    readonly userInvocable: boolean;
}
/** Wire codec: one session identity (branded string on the wire). */
export declare const sessionIdSchema: z.ZodString;
/** A skills read: the answer, or the reason there is none. */
export interface MarketSkillsResult {
    readonly skills: readonly MarketSkill[];
    readonly cwd?: string;
    readonly preset?: string;
    /** False when a provider failed or reported incomplete discovery. */
    readonly complete: boolean;
    readonly error: string;
}
/** Target location for installing one curated Agent Skill. */
export type FeaturedSkillInstallScope = 'user-dsh' | 'user-agents' | 'project-dsh';
/** Wire request for Host-side direct installation of one curated Agent Skill. */
export interface InstallFeaturedSkillRequest {
    readonly id: string;
    readonly scope: FeaturedSkillInstallScope;
    readonly projectDir?: string;
    readonly overwrite?: boolean;
}
/** Structured outcome of installing one curated Agent Skill on the Host. */
export interface InstallFeaturedSkillResult {
    readonly ok: boolean;
    readonly id: string;
    readonly name: string;
    readonly scope: FeaturedSkillInstallScope;
    readonly targetPath: string;
    readonly fileCount: number;
    readonly hasScripts: boolean;
    readonly code?: 'not-found' | 'already-exists' | 'invalid-project-dir' | 'download-failed' | 'invalid-skill' | 'write-failed' | 'cancelled';
    readonly error: string;
}
/** Request to delete one locally installed Agent Skill directory from disk. */
export interface DeleteInstalledSkillRequest {
    readonly name: string;
    readonly sourcePath: string;
}
/** Outcome of deleting one locally installed Agent Skill directory on the Host. */
export interface DeleteInstalledSkillResult {
    readonly ok: boolean;
    readonly name: string;
    readonly targetPath: string;
    readonly code?: 'not-found' | 'not-deletable' | 'delete-failed';
    readonly error: string;
}
/**
 * What the browser needs to name the install command. The profile is a
 * deployment fact (the Host is the only side that knows which profile it
 * boots), and the command is the official one — this plugin never runs it.
 */
export interface MarketEnvironment {
    /** The profile whose plugins an install would change. */
    readonly profile: string;
    /**
     * The market's own version, for the section header.
     *
     * The installed panel also carries a row for a marked in-box seat, so this
     * is no longer the only place the version can appear — but that row exists
     * only while the seat is listed, and it is one card among many. The header
     * states which market is running regardless. '' when the manifest could
     * not be read.
     */
    readonly version: string;
    /** Running DSH Host semantic version, when readable. */
    readonly dshVersion?: string;
    /** True when Host/process environment variables suppress telemetry. */
    readonly telemetrySuppressedByEnv?: boolean;
}
/** The marketplace's live configuration fields exposed to the browser. */
export interface SafeMarketSettings {
    /**
     * Whether the market is on. Default false: the tab explains itself and
     * asks first, because turning it on is what starts reaching GitHub.
     */
    readonly enabled: boolean;
    /**
     * Whether the built-in AI assistant (the unified `market-pro` skill and
     * the `dsh_market_pro`, `dsh_mcp_pro`, and `dsh_skills_pro` tools) is active
     * for conversations.
     */
    readonly aiAssistantEnabled: boolean;
    /**
     * Whether anonymous usage & install feedback telemetry is enabled (opt-out).
     */
    readonly telemetryEnabled: boolean;
}
/** One field update sent through the plugin-owned settings Remote. */
export type SafeMarketSettingsUpdate = {
    readonly field: 'enabled';
    readonly value: boolean;
} | {
    readonly field: 'aiAssistantEnabled';
    readonly value: boolean;
} | {
    readonly field: 'telemetryEnabled';
    readonly value: boolean;
};
export type TelemetryHostKind = 'desktop' | 'web' | 'other';
export type TelemetryOs = 'darwin' | 'win32' | 'linux' | 'other';
export type TelemetryLocale = 'zh' | 'en' | 'other';
export type TelemetryErrorCode = 'compat' | 'unsupported_platform' | 'not_bundle' | 'already_installed' | 'not_found' | 'pnpm_missing' | 'build_blocked' | 'permission' | 'disk_full' | 'integrity' | 'invalid_spec' | 'network' | 'timeout' | 'refused' | 'cancelled' | 'write_failed' | 'operation_error' | 'unknown';
export type TelemetryClientEvent = {
    readonly kind: 'client_hello';
    readonly hostKind: TelemetryHostKind;
    readonly locale: TelemetryLocale;
} | {
    readonly kind: 'plugin_install';
    readonly target: string;
    readonly mode: 'direct' | 'ai';
    readonly result: 'ok' | 'failed';
    readonly errorCode?: TelemetryErrorCode;
} | {
    readonly kind: 'mcp_install';
    readonly target: string;
    readonly mode: 'featured' | 'custom';
    readonly result: 'ok' | 'failed';
    readonly errorCode?: TelemetryErrorCode;
} | {
    readonly kind: 'skill_install';
    readonly target: string;
    readonly mode: 'featured' | 'ai';
    readonly result: 'ok' | 'failed';
    readonly errorCode?: TelemetryErrorCode;
};
/** Live state of one loader entry an installed bundle introduces. */
export interface MarketInstalledEntry {
    /** The patch-addressable entry id (no `include:` prefix). */
    readonly id: string;
    /** The module specifier the entry imports. */
    readonly name: string;
    /** Whether the entry exists in the live Loader tree. */
    readonly present: boolean;
    /** Effective enablement (a disabled ancestor group included). */
    readonly enabled: boolean;
    /** The entry's fiber phase, or null while no fiber exists. */
    readonly phase: 'pending' | 'loading' | 'active' | 'failed' | 'disposed' | 'unloading' | null;
}
/** One package whose declared DSH requirements reject the running DSH version. */
export interface MarketIncompatiblePlugin {
    readonly name: string;
    readonly version: string;
    readonly runtimeVersion?: string;
    readonly requirements?: Readonly<Record<string, string>>;
    readonly peers?: Readonly<Record<string, string>>;
}
/** Structured management/load refusal reported by the Host pluginManager for an installed bundle. */
export interface MarketHostError {
    readonly code: string;
    readonly diagnostic?: string;
    readonly incompatible?: readonly MarketIncompatiblePlugin[];
}
/** One user-installed plugin package, with the live state of its entries. */
export interface MarketInstalledPackage {
    readonly packageName: string;
    readonly icon?: string;
    readonly version: string;
    readonly titleZh?: string;
    readonly titleEn?: string;
    readonly description: string;
    readonly descriptionZh?: string;
    readonly descriptionEn?: string;
    /**
     * The `owner/name` this package's manifest points its `repository` field
     * at, when that field names a GitHub repository in a shape matching
     * {@link REPOSITORY_SLUG_PATTERN}; '' otherwise.
     *
     * This is what joins an installed package to a catalog row: the catalog is
     * keyed by repository (it is a crawl of GitHub) while an install is keyed by
     * package name, and the two are only sometimes spelled alike.
     */
    readonly repository: string;
    /** Normalized subdirectory within `repository` (e.g. `packages/dsh-plugin`), when installed from a subfolder. */
    readonly repositoryDirectory?: string;
    /** The market's own row: listed, but the panel must not disable it. */
    readonly self: boolean;
    /**
     * Seated by the desktop client rather than installed as a dependency: the
     * client copied it in and wrote its ownership marker. Listed so it can be
     * removed at all — the official CLI will not touch a name that is not a
     * dependency, and the client that seated it may be uninstalled by now.
     */
    readonly inBox: boolean;
    /**
     * Installed outside the bundle stack on a legacy Host that cannot enable
     * it from this panel. The package remains available for uninstall.
     */
    readonly unregistered: boolean;
    /** Host bundle selection when native package-level management is available. */
    readonly bundleEnabled?: boolean;
    /** Effective package switch, including legacy entry-level stops. */
    readonly enabled: boolean;
    readonly entries: readonly MarketInstalledEntry[];
    /** Why the bundle could not be read (uninstall stays available); '' when read. */
    readonly error: string;
    /** Host-reported compatibility/platform/load refusal for this bundle, when any. */
    readonly hostError?: MarketHostError;
    /**
     * A same-session uninstall of this package left stop rows in the profile's
     * patch layer that are still holding its entries down: the sweep record is
     * consumed only at the next boot, and the package came back before that —
     * a mid-session reinstall. The panel explains the disabled state, and the
     * ordinary Enable verb clears the rows.
     */
    readonly heldDown: boolean;
}
/** The installed-panel read: the packages, or the reason the profile read failed. */
export interface MarketInstalledResult {
    readonly packages: readonly MarketInstalledPackage[];
    /** The profile the list describes (the panel names it in its explainer). */
    readonly profile: string;
    readonly error: string;
    /** The Host saved the change and requires a restart to apply it. */
    readonly restartRequired?: boolean;
    /**
     * Fault details a verb wants the panel to wrap in localized copy. Absent
     * (or empty) means the default success line. The wrapping sentence is
     * chosen by {@link MarketInstalledResult.noticeKind}.
     */
    readonly notice?: string;
    /**
     * How the panel should phrase a non-empty {@link MarketInstalledResult.notice}.
     * `may-run` means the package is off the profile but may keep running until
     * the next restart; `faults` means it is off the profile and the details
     * are the leftover work that did not finish.
     */
    readonly noticeKind?: 'faults' | 'may-run';
}
/** One enable/disable request for an installed package. */
export interface SetInstalledEnabledUpdate {
    readonly packageName: string;
    readonly enabled: boolean;
}
/** One uninstall request for an installed package. */
export interface UninstallInstalledUpdate {
    readonly packageName: string;
}
/** Strict wire codec for one market row. */
export declare const marketPluginSchema: z.ZodReadonly<z.ZodObject<{
    icon: z.ZodOptional<z.ZodString>;
    packageName: z.ZodOptional<z.ZodString>;
    titleZh: z.ZodOptional<z.ZodString>;
    titleEn: z.ZodOptional<z.ZodString>;
    descriptionEn: z.ZodOptional<z.ZodString>;
    installStatus: z.ZodOptional<z.ZodEnum<{
        command: "command";
        manual: "manual";
        none: "none";
    }>>;
    keywords: z.ZodOptional<z.ZodReadonly<z.ZodArray<z.ZodString>>>;
    archived: z.ZodOptional<z.ZodBoolean>;
    disabled: z.ZodOptional<z.ZodBoolean>;
    installInfo: z.ZodOptional<z.ZodObject<{
        mode: z.ZodEnum<{
            command: "command";
            manual: "manual";
        }>;
        targets: z.ZodArray<z.ZodObject<{
            install: z.ZodString;
            profile: z.ZodString;
            note: z.ZodString;
            dshEngine: z.ZodOptional<z.ZodString>;
            compatFallback: z.ZodOptional<z.ZodReadonly<z.ZodObject<{
                selectedVersion: z.ZodString;
                latestVersion: z.ZodString;
                latestEngine: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>>;
        }, z.core.$strip>>;
        tasks: z.ZodArray<z.ZodString>;
        requirements: z.ZodArray<z.ZodString>;
        note: z.ZodString;
        manual: z.ZodString;
    }, z.core.$strip>>;
    fullName: z.ZodUnion<readonly [z.ZodString, z.ZodLiteral<"">]>;
    owner: z.ZodString;
    name: z.ZodString;
    url: z.ZodString;
    description: z.ZodString;
    stars: z.ZodNumber;
    language: z.ZodString;
    license: z.ZodString;
    pushedAt: z.ZodString;
    defaultBranch: z.ZodString;
    category: z.ZodString;
    categoryZh: z.ZodString;
    categoryEn: z.ZodString;
}, z.core.$strip>>;
/** Strict wire codec for one category filter. */
export declare const marketCategorySchema: z.ZodReadonly<z.ZodObject<{
    key: z.ZodString;
    zh: z.ZodString;
    en: z.ZodString;
    count: z.ZodNumber;
}, z.core.$strip>>;
/** Strict wire codec for the editorial picks. */
export declare const marketFeaturedSchema: z.ZodReadonly<z.ZodObject<{
    categories: z.ZodOptional<z.ZodReadonly<z.ZodArray<z.ZodReadonly<z.ZodObject<{
        key: z.ZodString;
        zh: z.ZodString;
        en: z.ZodString;
        count: z.ZodNumber;
    }, z.core.$strip>>>>>;
    titleZh: z.ZodString;
    titleEn: z.ZodString;
    updatedAt: z.ZodString;
    count: z.ZodNumber;
    entries: z.ZodReadonly<z.ZodArray<z.ZodReadonly<z.ZodObject<{
        item: z.ZodReadonly<z.ZodObject<{
            icon: z.ZodOptional<z.ZodString>;
            packageName: z.ZodOptional<z.ZodString>;
            titleZh: z.ZodOptional<z.ZodString>;
            titleEn: z.ZodOptional<z.ZodString>;
            descriptionEn: z.ZodOptional<z.ZodString>;
            installStatus: z.ZodOptional<z.ZodEnum<{
                command: "command";
                manual: "manual";
                none: "none";
            }>>;
            keywords: z.ZodOptional<z.ZodReadonly<z.ZodArray<z.ZodString>>>;
            archived: z.ZodOptional<z.ZodBoolean>;
            disabled: z.ZodOptional<z.ZodBoolean>;
            installInfo: z.ZodOptional<z.ZodObject<{
                mode: z.ZodEnum<{
                    command: "command";
                    manual: "manual";
                }>;
                targets: z.ZodArray<z.ZodObject<{
                    install: z.ZodString;
                    profile: z.ZodString;
                    note: z.ZodString;
                    dshEngine: z.ZodOptional<z.ZodString>;
                    compatFallback: z.ZodOptional<z.ZodReadonly<z.ZodObject<{
                        selectedVersion: z.ZodString;
                        latestVersion: z.ZodString;
                        latestEngine: z.ZodOptional<z.ZodString>;
                    }, z.core.$strip>>>;
                }, z.core.$strip>>;
                tasks: z.ZodArray<z.ZodString>;
                requirements: z.ZodArray<z.ZodString>;
                note: z.ZodString;
                manual: z.ZodString;
            }, z.core.$strip>>;
            fullName: z.ZodUnion<readonly [z.ZodString, z.ZodLiteral<"">]>;
            owner: z.ZodString;
            name: z.ZodString;
            url: z.ZodString;
            description: z.ZodString;
            stars: z.ZodNumber;
            language: z.ZodString;
            license: z.ZodString;
            pushedAt: z.ZodString;
            defaultBranch: z.ZodString;
            category: z.ZodString;
            categoryZh: z.ZodString;
            categoryEn: z.ZodString;
        }, z.core.$strip>>;
        reason: z.ZodString;
    }, z.core.$strip>>>>;
}, z.core.$strip>>;
/** Strict wire codec for the reduced catalog. */
export declare const marketCatalogSchema: z.ZodReadonly<z.ZodObject<{
    items: z.ZodReadonly<z.ZodArray<z.ZodReadonly<z.ZodObject<{
        icon: z.ZodOptional<z.ZodString>;
        packageName: z.ZodOptional<z.ZodString>;
        titleZh: z.ZodOptional<z.ZodString>;
        titleEn: z.ZodOptional<z.ZodString>;
        descriptionEn: z.ZodOptional<z.ZodString>;
        installStatus: z.ZodOptional<z.ZodEnum<{
            command: "command";
            manual: "manual";
            none: "none";
        }>>;
        keywords: z.ZodOptional<z.ZodReadonly<z.ZodArray<z.ZodString>>>;
        archived: z.ZodOptional<z.ZodBoolean>;
        disabled: z.ZodOptional<z.ZodBoolean>;
        installInfo: z.ZodOptional<z.ZodObject<{
            mode: z.ZodEnum<{
                command: "command";
                manual: "manual";
            }>;
            targets: z.ZodArray<z.ZodObject<{
                install: z.ZodString;
                profile: z.ZodString;
                note: z.ZodString;
                dshEngine: z.ZodOptional<z.ZodString>;
                compatFallback: z.ZodOptional<z.ZodReadonly<z.ZodObject<{
                    selectedVersion: z.ZodString;
                    latestVersion: z.ZodString;
                    latestEngine: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>>;
            }, z.core.$strip>>;
            tasks: z.ZodArray<z.ZodString>;
            requirements: z.ZodArray<z.ZodString>;
            note: z.ZodString;
            manual: z.ZodString;
        }, z.core.$strip>>;
        fullName: z.ZodUnion<readonly [z.ZodString, z.ZodLiteral<"">]>;
        owner: z.ZodString;
        name: z.ZodString;
        url: z.ZodString;
        description: z.ZodString;
        stars: z.ZodNumber;
        language: z.ZodString;
        license: z.ZodString;
        pushedAt: z.ZodString;
        defaultBranch: z.ZodString;
        category: z.ZodString;
        categoryZh: z.ZodString;
        categoryEn: z.ZodString;
    }, z.core.$strip>>>>;
    categories: z.ZodReadonly<z.ZodArray<z.ZodReadonly<z.ZodObject<{
        key: z.ZodString;
        zh: z.ZodString;
        en: z.ZodString;
        count: z.ZodNumber;
    }, z.core.$strip>>>>;
    featured: z.ZodOptional<z.ZodReadonly<z.ZodObject<{
        categories: z.ZodOptional<z.ZodReadonly<z.ZodArray<z.ZodReadonly<z.ZodObject<{
            key: z.ZodString;
            zh: z.ZodString;
            en: z.ZodString;
            count: z.ZodNumber;
        }, z.core.$strip>>>>>;
        titleZh: z.ZodString;
        titleEn: z.ZodString;
        updatedAt: z.ZodString;
        count: z.ZodNumber;
        entries: z.ZodReadonly<z.ZodArray<z.ZodReadonly<z.ZodObject<{
            item: z.ZodReadonly<z.ZodObject<{
                icon: z.ZodOptional<z.ZodString>;
                packageName: z.ZodOptional<z.ZodString>;
                titleZh: z.ZodOptional<z.ZodString>;
                titleEn: z.ZodOptional<z.ZodString>;
                descriptionEn: z.ZodOptional<z.ZodString>;
                installStatus: z.ZodOptional<z.ZodEnum<{
                    command: "command";
                    manual: "manual";
                    none: "none";
                }>>;
                keywords: z.ZodOptional<z.ZodReadonly<z.ZodArray<z.ZodString>>>;
                archived: z.ZodOptional<z.ZodBoolean>;
                disabled: z.ZodOptional<z.ZodBoolean>;
                installInfo: z.ZodOptional<z.ZodObject<{
                    mode: z.ZodEnum<{
                        command: "command";
                        manual: "manual";
                    }>;
                    targets: z.ZodArray<z.ZodObject<{
                        install: z.ZodString;
                        profile: z.ZodString;
                        note: z.ZodString;
                        dshEngine: z.ZodOptional<z.ZodString>;
                        compatFallback: z.ZodOptional<z.ZodReadonly<z.ZodObject<{
                            selectedVersion: z.ZodString;
                            latestVersion: z.ZodString;
                            latestEngine: z.ZodOptional<z.ZodString>;
                        }, z.core.$strip>>>;
                    }, z.core.$strip>>;
                    tasks: z.ZodArray<z.ZodString>;
                    requirements: z.ZodArray<z.ZodString>;
                    note: z.ZodString;
                    manual: z.ZodString;
                }, z.core.$strip>>;
                fullName: z.ZodUnion<readonly [z.ZodString, z.ZodLiteral<"">]>;
                owner: z.ZodString;
                name: z.ZodString;
                url: z.ZodString;
                description: z.ZodString;
                stars: z.ZodNumber;
                language: z.ZodString;
                license: z.ZodString;
                pushedAt: z.ZodString;
                defaultBranch: z.ZodString;
                category: z.ZodString;
                categoryZh: z.ZodString;
                categoryEn: z.ZodString;
            }, z.core.$strip>>;
            reason: z.ZodString;
        }, z.core.$strip>>>>;
    }, z.core.$strip>>>;
    subscription: z.ZodOptional<z.ZodReadonly<z.ZodObject<{
        categories: z.ZodOptional<z.ZodReadonly<z.ZodArray<z.ZodReadonly<z.ZodObject<{
            key: z.ZodString;
            zh: z.ZodString;
            en: z.ZodString;
            count: z.ZodNumber;
        }, z.core.$strip>>>>>;
        titleZh: z.ZodString;
        titleEn: z.ZodString;
        updatedAt: z.ZodString;
        count: z.ZodNumber;
        entries: z.ZodReadonly<z.ZodArray<z.ZodReadonly<z.ZodObject<{
            item: z.ZodReadonly<z.ZodObject<{
                icon: z.ZodOptional<z.ZodString>;
                packageName: z.ZodOptional<z.ZodString>;
                titleZh: z.ZodOptional<z.ZodString>;
                titleEn: z.ZodOptional<z.ZodString>;
                descriptionEn: z.ZodOptional<z.ZodString>;
                installStatus: z.ZodOptional<z.ZodEnum<{
                    command: "command";
                    manual: "manual";
                    none: "none";
                }>>;
                keywords: z.ZodOptional<z.ZodReadonly<z.ZodArray<z.ZodString>>>;
                archived: z.ZodOptional<z.ZodBoolean>;
                disabled: z.ZodOptional<z.ZodBoolean>;
                installInfo: z.ZodOptional<z.ZodObject<{
                    mode: z.ZodEnum<{
                        command: "command";
                        manual: "manual";
                    }>;
                    targets: z.ZodArray<z.ZodObject<{
                        install: z.ZodString;
                        profile: z.ZodString;
                        note: z.ZodString;
                        dshEngine: z.ZodOptional<z.ZodString>;
                        compatFallback: z.ZodOptional<z.ZodReadonly<z.ZodObject<{
                            selectedVersion: z.ZodString;
                            latestVersion: z.ZodString;
                            latestEngine: z.ZodOptional<z.ZodString>;
                        }, z.core.$strip>>>;
                    }, z.core.$strip>>;
                    tasks: z.ZodArray<z.ZodString>;
                    requirements: z.ZodArray<z.ZodString>;
                    note: z.ZodString;
                    manual: z.ZodString;
                }, z.core.$strip>>;
                fullName: z.ZodUnion<readonly [z.ZodString, z.ZodLiteral<"">]>;
                owner: z.ZodString;
                name: z.ZodString;
                url: z.ZodString;
                description: z.ZodString;
                stars: z.ZodNumber;
                language: z.ZodString;
                license: z.ZodString;
                pushedAt: z.ZodString;
                defaultBranch: z.ZodString;
                category: z.ZodString;
                categoryZh: z.ZodString;
                categoryEn: z.ZodString;
            }, z.core.$strip>>;
            reason: z.ZodString;
        }, z.core.$strip>>>>;
    }, z.core.$strip>>>;
    fetchedAt: z.ZodString;
    publishedAt: z.ZodOptional<z.ZodString>;
    refreshedAt: z.ZodString;
    scanned: z.ZodNumber;
}, z.core.$strip>>;
/** Strict wire codec for one catalog read. */
export declare const marketCatalogResultSchema: z.ZodReadonly<z.ZodObject<{
    catalog: z.ZodUnion<readonly [z.ZodReadonly<z.ZodObject<{
        items: z.ZodReadonly<z.ZodArray<z.ZodReadonly<z.ZodObject<{
            icon: z.ZodOptional<z.ZodString>;
            packageName: z.ZodOptional<z.ZodString>;
            titleZh: z.ZodOptional<z.ZodString>;
            titleEn: z.ZodOptional<z.ZodString>;
            descriptionEn: z.ZodOptional<z.ZodString>;
            installStatus: z.ZodOptional<z.ZodEnum<{
                command: "command";
                manual: "manual";
                none: "none";
            }>>;
            keywords: z.ZodOptional<z.ZodReadonly<z.ZodArray<z.ZodString>>>;
            archived: z.ZodOptional<z.ZodBoolean>;
            disabled: z.ZodOptional<z.ZodBoolean>;
            installInfo: z.ZodOptional<z.ZodObject<{
                mode: z.ZodEnum<{
                    command: "command";
                    manual: "manual";
                }>;
                targets: z.ZodArray<z.ZodObject<{
                    install: z.ZodString;
                    profile: z.ZodString;
                    note: z.ZodString;
                    dshEngine: z.ZodOptional<z.ZodString>;
                    compatFallback: z.ZodOptional<z.ZodReadonly<z.ZodObject<{
                        selectedVersion: z.ZodString;
                        latestVersion: z.ZodString;
                        latestEngine: z.ZodOptional<z.ZodString>;
                    }, z.core.$strip>>>;
                }, z.core.$strip>>;
                tasks: z.ZodArray<z.ZodString>;
                requirements: z.ZodArray<z.ZodString>;
                note: z.ZodString;
                manual: z.ZodString;
            }, z.core.$strip>>;
            fullName: z.ZodUnion<readonly [z.ZodString, z.ZodLiteral<"">]>;
            owner: z.ZodString;
            name: z.ZodString;
            url: z.ZodString;
            description: z.ZodString;
            stars: z.ZodNumber;
            language: z.ZodString;
            license: z.ZodString;
            pushedAt: z.ZodString;
            defaultBranch: z.ZodString;
            category: z.ZodString;
            categoryZh: z.ZodString;
            categoryEn: z.ZodString;
        }, z.core.$strip>>>>;
        categories: z.ZodReadonly<z.ZodArray<z.ZodReadonly<z.ZodObject<{
            key: z.ZodString;
            zh: z.ZodString;
            en: z.ZodString;
            count: z.ZodNumber;
        }, z.core.$strip>>>>;
        featured: z.ZodOptional<z.ZodReadonly<z.ZodObject<{
            categories: z.ZodOptional<z.ZodReadonly<z.ZodArray<z.ZodReadonly<z.ZodObject<{
                key: z.ZodString;
                zh: z.ZodString;
                en: z.ZodString;
                count: z.ZodNumber;
            }, z.core.$strip>>>>>;
            titleZh: z.ZodString;
            titleEn: z.ZodString;
            updatedAt: z.ZodString;
            count: z.ZodNumber;
            entries: z.ZodReadonly<z.ZodArray<z.ZodReadonly<z.ZodObject<{
                item: z.ZodReadonly<z.ZodObject<{
                    icon: z.ZodOptional<z.ZodString>;
                    packageName: z.ZodOptional<z.ZodString>;
                    titleZh: z.ZodOptional<z.ZodString>;
                    titleEn: z.ZodOptional<z.ZodString>;
                    descriptionEn: z.ZodOptional<z.ZodString>;
                    installStatus: z.ZodOptional<z.ZodEnum<{
                        command: "command";
                        manual: "manual";
                        none: "none";
                    }>>;
                    keywords: z.ZodOptional<z.ZodReadonly<z.ZodArray<z.ZodString>>>;
                    archived: z.ZodOptional<z.ZodBoolean>;
                    disabled: z.ZodOptional<z.ZodBoolean>;
                    installInfo: z.ZodOptional<z.ZodObject<{
                        mode: z.ZodEnum<{
                            command: "command";
                            manual: "manual";
                        }>;
                        targets: z.ZodArray<z.ZodObject<{
                            install: z.ZodString;
                            profile: z.ZodString;
                            note: z.ZodString;
                            dshEngine: z.ZodOptional<z.ZodString>;
                            compatFallback: z.ZodOptional<z.ZodReadonly<z.ZodObject<{
                                selectedVersion: z.ZodString;
                                latestVersion: z.ZodString;
                                latestEngine: z.ZodOptional<z.ZodString>;
                            }, z.core.$strip>>>;
                        }, z.core.$strip>>;
                        tasks: z.ZodArray<z.ZodString>;
                        requirements: z.ZodArray<z.ZodString>;
                        note: z.ZodString;
                        manual: z.ZodString;
                    }, z.core.$strip>>;
                    fullName: z.ZodUnion<readonly [z.ZodString, z.ZodLiteral<"">]>;
                    owner: z.ZodString;
                    name: z.ZodString;
                    url: z.ZodString;
                    description: z.ZodString;
                    stars: z.ZodNumber;
                    language: z.ZodString;
                    license: z.ZodString;
                    pushedAt: z.ZodString;
                    defaultBranch: z.ZodString;
                    category: z.ZodString;
                    categoryZh: z.ZodString;
                    categoryEn: z.ZodString;
                }, z.core.$strip>>;
                reason: z.ZodString;
            }, z.core.$strip>>>>;
        }, z.core.$strip>>>;
        subscription: z.ZodOptional<z.ZodReadonly<z.ZodObject<{
            categories: z.ZodOptional<z.ZodReadonly<z.ZodArray<z.ZodReadonly<z.ZodObject<{
                key: z.ZodString;
                zh: z.ZodString;
                en: z.ZodString;
                count: z.ZodNumber;
            }, z.core.$strip>>>>>;
            titleZh: z.ZodString;
            titleEn: z.ZodString;
            updatedAt: z.ZodString;
            count: z.ZodNumber;
            entries: z.ZodReadonly<z.ZodArray<z.ZodReadonly<z.ZodObject<{
                item: z.ZodReadonly<z.ZodObject<{
                    icon: z.ZodOptional<z.ZodString>;
                    packageName: z.ZodOptional<z.ZodString>;
                    titleZh: z.ZodOptional<z.ZodString>;
                    titleEn: z.ZodOptional<z.ZodString>;
                    descriptionEn: z.ZodOptional<z.ZodString>;
                    installStatus: z.ZodOptional<z.ZodEnum<{
                        command: "command";
                        manual: "manual";
                        none: "none";
                    }>>;
                    keywords: z.ZodOptional<z.ZodReadonly<z.ZodArray<z.ZodString>>>;
                    archived: z.ZodOptional<z.ZodBoolean>;
                    disabled: z.ZodOptional<z.ZodBoolean>;
                    installInfo: z.ZodOptional<z.ZodObject<{
                        mode: z.ZodEnum<{
                            command: "command";
                            manual: "manual";
                        }>;
                        targets: z.ZodArray<z.ZodObject<{
                            install: z.ZodString;
                            profile: z.ZodString;
                            note: z.ZodString;
                            dshEngine: z.ZodOptional<z.ZodString>;
                            compatFallback: z.ZodOptional<z.ZodReadonly<z.ZodObject<{
                                selectedVersion: z.ZodString;
                                latestVersion: z.ZodString;
                                latestEngine: z.ZodOptional<z.ZodString>;
                            }, z.core.$strip>>>;
                        }, z.core.$strip>>;
                        tasks: z.ZodArray<z.ZodString>;
                        requirements: z.ZodArray<z.ZodString>;
                        note: z.ZodString;
                        manual: z.ZodString;
                    }, z.core.$strip>>;
                    fullName: z.ZodUnion<readonly [z.ZodString, z.ZodLiteral<"">]>;
                    owner: z.ZodString;
                    name: z.ZodString;
                    url: z.ZodString;
                    description: z.ZodString;
                    stars: z.ZodNumber;
                    language: z.ZodString;
                    license: z.ZodString;
                    pushedAt: z.ZodString;
                    defaultBranch: z.ZodString;
                    category: z.ZodString;
                    categoryZh: z.ZodString;
                    categoryEn: z.ZodString;
                }, z.core.$strip>>;
                reason: z.ZodString;
            }, z.core.$strip>>>>;
        }, z.core.$strip>>>;
        fetchedAt: z.ZodString;
        publishedAt: z.ZodOptional<z.ZodString>;
        refreshedAt: z.ZodString;
        scanned: z.ZodNumber;
    }, z.core.$strip>>, z.ZodNull]>;
    stale: z.ZodBoolean;
    error: z.ZodString;
}, z.core.$strip>>;
/** Strict wire codec for one resolvable skill. */
export declare const marketSkillSchema: z.ZodReadonly<z.ZodObject<{
    name: z.ZodString;
    description: z.ZodString;
    whenToUse: z.ZodString;
    provider: z.ZodString;
    source: z.ZodOptional<z.ZodString>;
    instructionPath: z.ZodOptional<z.ZodString>;
    sourceDirectory: z.ZodOptional<z.ZodString>;
    sourcePath: z.ZodOptional<z.ZodString>;
    featuredId: z.ZodOptional<z.ZodString>;
    modelInvocable: z.ZodBoolean;
    userInvocable: z.ZodBoolean;
}, z.core.$strip>>;
/** Strict wire codec for one skills read. */
export declare const marketSkillsResultSchema: z.ZodReadonly<z.ZodObject<{
    skills: z.ZodReadonly<z.ZodArray<z.ZodReadonly<z.ZodObject<{
        name: z.ZodString;
        description: z.ZodString;
        whenToUse: z.ZodString;
        provider: z.ZodString;
        source: z.ZodOptional<z.ZodString>;
        instructionPath: z.ZodOptional<z.ZodString>;
        sourceDirectory: z.ZodOptional<z.ZodString>;
        sourcePath: z.ZodOptional<z.ZodString>;
        featuredId: z.ZodOptional<z.ZodString>;
        modelInvocable: z.ZodBoolean;
        userInvocable: z.ZodBoolean;
    }, z.core.$strip>>>>;
    cwd: z.ZodOptional<z.ZodString>;
    preset: z.ZodOptional<z.ZodString>;
    complete: z.ZodBoolean;
    error: z.ZodString;
}, z.core.$strip>>;
export declare const DSH_VERSION_MAX_LENGTH = 80;
/** Strict wire codec for the deployment facts the browser needs. */
export declare const marketEnvironmentSchema: z.ZodReadonly<z.ZodObject<{
    profile: z.ZodString;
    version: z.ZodString;
    dshVersion: z.ZodOptional<z.ZodString>;
    telemetrySuppressedByEnv: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>>;
/** Strict wire codec for the resolved settings section. */
export declare const safeMarketSettingsSchema: z.ZodReadonly<z.ZodObject<{
    enabled: z.ZodBoolean;
    aiAssistantEnabled: z.ZodBoolean;
    telemetryEnabled: z.ZodBoolean;
}, z.core.$strip>>;
/** Strict wire codec for one field update. */
export declare const safeMarketSettingsUpdateSchema: z.ZodDiscriminatedUnion<[z.ZodReadonly<z.ZodObject<{
    field: z.ZodLiteral<"enabled">;
    value: z.ZodBoolean;
}, z.core.$strip>>, z.ZodReadonly<z.ZodObject<{
    field: z.ZodLiteral<"aiAssistantEnabled">;
    value: z.ZodBoolean;
}, z.core.$strip>>, z.ZodReadonly<z.ZodObject<{
    field: z.ZodLiteral<"telemetryEnabled">;
    value: z.ZodBoolean;
}, z.core.$strip>>], "field">;
/** Strict wire codec for client-reported anonymous telemetry events. */
export declare const telemetryClientEventSchema: z.ZodDiscriminatedUnion<[z.ZodReadonly<z.ZodObject<{
    kind: z.ZodLiteral<"client_hello">;
    hostKind: z.ZodEnum<{
        desktop: "desktop";
        web: "web";
        other: "other";
    }>;
    locale: z.ZodEnum<{
        other: "other";
        zh: "zh";
        en: "en";
    }>;
}, z.core.$strip>>, z.ZodReadonly<z.ZodObject<{
    kind: z.ZodLiteral<"plugin_install">;
    target: z.ZodString;
    mode: z.ZodEnum<{
        direct: "direct";
        ai: "ai";
    }>;
    result: z.ZodEnum<{
        ok: "ok";
        failed: "failed";
    }>;
    errorCode: z.ZodOptional<z.ZodEnum<{
        cancelled: "cancelled";
        compat: "compat";
        unsupported_platform: "unsupported_platform";
        not_bundle: "not_bundle";
        already_installed: "already_installed";
        not_found: "not_found";
        pnpm_missing: "pnpm_missing";
        build_blocked: "build_blocked";
        permission: "permission";
        disk_full: "disk_full";
        integrity: "integrity";
        invalid_spec: "invalid_spec";
        network: "network";
        timeout: "timeout";
        refused: "refused";
        write_failed: "write_failed";
        operation_error: "operation_error";
        unknown: "unknown";
    }>>;
}, z.core.$strip>>, z.ZodReadonly<z.ZodObject<{
    kind: z.ZodLiteral<"mcp_install">;
    target: z.ZodString;
    mode: z.ZodEnum<{
        featured: "featured";
        custom: "custom";
    }>;
    result: z.ZodEnum<{
        ok: "ok";
        failed: "failed";
    }>;
    errorCode: z.ZodOptional<z.ZodEnum<{
        cancelled: "cancelled";
        compat: "compat";
        unsupported_platform: "unsupported_platform";
        not_bundle: "not_bundle";
        already_installed: "already_installed";
        not_found: "not_found";
        pnpm_missing: "pnpm_missing";
        build_blocked: "build_blocked";
        permission: "permission";
        disk_full: "disk_full";
        integrity: "integrity";
        invalid_spec: "invalid_spec";
        network: "network";
        timeout: "timeout";
        refused: "refused";
        write_failed: "write_failed";
        operation_error: "operation_error";
        unknown: "unknown";
    }>>;
}, z.core.$strip>>, z.ZodReadonly<z.ZodObject<{
    kind: z.ZodLiteral<"skill_install">;
    target: z.ZodString;
    mode: z.ZodEnum<{
        featured: "featured";
        ai: "ai";
    }>;
    result: z.ZodEnum<{
        ok: "ok";
        failed: "failed";
    }>;
    errorCode: z.ZodOptional<z.ZodEnum<{
        cancelled: "cancelled";
        compat: "compat";
        unsupported_platform: "unsupported_platform";
        not_bundle: "not_bundle";
        already_installed: "already_installed";
        not_found: "not_found";
        pnpm_missing: "pnpm_missing";
        build_blocked: "build_blocked";
        permission: "permission";
        disk_full: "disk_full";
        integrity: "integrity";
        invalid_spec: "invalid_spec";
        network: "network";
        timeout: "timeout";
        refused: "refused";
        write_failed: "write_failed";
        operation_error: "operation_error";
        unknown: "unknown";
    }>>;
}, z.core.$strip>>], "kind">;
/** Strict wire codec for an npm package name. */
export declare const packageNameSchema: z.ZodString;
/** Strict wire codec for one installed entry's live state. */
export declare const marketInstalledEntrySchema: z.ZodReadonly<z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    present: z.ZodBoolean;
    enabled: z.ZodBoolean;
    phase: z.ZodUnion<readonly [z.ZodEnum<{
        failed: "failed";
        pending: "pending";
        loading: "loading";
        active: "active";
        disposed: "disposed";
        unloading: "unloading";
    }>, z.ZodNull]>;
}, z.core.$strip>>;
export declare const marketHostErrorSchema: z.ZodReadonly<z.ZodObject<{
    code: z.ZodString;
    diagnostic: z.ZodOptional<z.ZodString>;
    incompatible: z.ZodOptional<z.ZodReadonly<z.ZodArray<z.ZodReadonly<z.ZodObject<{
        name: z.ZodString;
        version: z.ZodString;
        runtimeVersion: z.ZodOptional<z.ZodString>;
        requirements: z.ZodOptional<z.ZodReadonly<z.ZodRecord<z.ZodString, z.ZodString>>>;
        peers: z.ZodOptional<z.ZodReadonly<z.ZodRecord<z.ZodString, z.ZodString>>>;
    }, z.core.$strip>>>>>;
}, z.core.$strip>>;
/** Normalize an arbitrary Host management error into the bounded wire shape. */
export declare function normalizeHostError(raw: unknown): MarketHostError | undefined;
/** Strict wire codec for one installed package. */
export declare const marketInstalledPackageSchema: z.ZodReadonly<z.ZodObject<{
    packageName: z.ZodString;
    icon: z.ZodOptional<z.ZodString>;
    version: z.ZodString;
    titleZh: z.ZodOptional<z.ZodString>;
    titleEn: z.ZodOptional<z.ZodString>;
    description: z.ZodString;
    descriptionZh: z.ZodOptional<z.ZodString>;
    descriptionEn: z.ZodOptional<z.ZodString>;
    repository: z.ZodUnion<readonly [z.ZodString, z.ZodLiteral<"">]>;
    repositoryDirectory: z.ZodOptional<z.ZodString>;
    self: z.ZodBoolean;
    inBox: z.ZodBoolean;
    unregistered: z.ZodBoolean;
    bundleEnabled: z.ZodOptional<z.ZodBoolean>;
    enabled: z.ZodBoolean;
    entries: z.ZodReadonly<z.ZodArray<z.ZodReadonly<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        present: z.ZodBoolean;
        enabled: z.ZodBoolean;
        phase: z.ZodUnion<readonly [z.ZodEnum<{
            failed: "failed";
            pending: "pending";
            loading: "loading";
            active: "active";
            disposed: "disposed";
            unloading: "unloading";
        }>, z.ZodNull]>;
    }, z.core.$strip>>>>;
    error: z.ZodString;
    hostError: z.ZodOptional<z.ZodReadonly<z.ZodObject<{
        code: z.ZodString;
        diagnostic: z.ZodOptional<z.ZodString>;
        incompatible: z.ZodOptional<z.ZodReadonly<z.ZodArray<z.ZodReadonly<z.ZodObject<{
            name: z.ZodString;
            version: z.ZodString;
            runtimeVersion: z.ZodOptional<z.ZodString>;
            requirements: z.ZodOptional<z.ZodReadonly<z.ZodRecord<z.ZodString, z.ZodString>>>;
            peers: z.ZodOptional<z.ZodReadonly<z.ZodRecord<z.ZodString, z.ZodString>>>;
        }, z.core.$strip>>>>>;
    }, z.core.$strip>>>;
    heldDown: z.ZodBoolean;
}, z.core.$strip>>;
/** Strict wire codec for the installed-panel read. */
export declare const marketInstalledResultSchema: z.ZodReadonly<z.ZodObject<{
    packages: z.ZodReadonly<z.ZodArray<z.ZodReadonly<z.ZodObject<{
        packageName: z.ZodString;
        icon: z.ZodOptional<z.ZodString>;
        version: z.ZodString;
        titleZh: z.ZodOptional<z.ZodString>;
        titleEn: z.ZodOptional<z.ZodString>;
        description: z.ZodString;
        descriptionZh: z.ZodOptional<z.ZodString>;
        descriptionEn: z.ZodOptional<z.ZodString>;
        repository: z.ZodUnion<readonly [z.ZodString, z.ZodLiteral<"">]>;
        repositoryDirectory: z.ZodOptional<z.ZodString>;
        self: z.ZodBoolean;
        inBox: z.ZodBoolean;
        unregistered: z.ZodBoolean;
        bundleEnabled: z.ZodOptional<z.ZodBoolean>;
        enabled: z.ZodBoolean;
        entries: z.ZodReadonly<z.ZodArray<z.ZodReadonly<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            present: z.ZodBoolean;
            enabled: z.ZodBoolean;
            phase: z.ZodUnion<readonly [z.ZodEnum<{
                failed: "failed";
                pending: "pending";
                loading: "loading";
                active: "active";
                disposed: "disposed";
                unloading: "unloading";
            }>, z.ZodNull]>;
        }, z.core.$strip>>>>;
        error: z.ZodString;
        hostError: z.ZodOptional<z.ZodReadonly<z.ZodObject<{
            code: z.ZodString;
            diagnostic: z.ZodOptional<z.ZodString>;
            incompatible: z.ZodOptional<z.ZodReadonly<z.ZodArray<z.ZodReadonly<z.ZodObject<{
                name: z.ZodString;
                version: z.ZodString;
                runtimeVersion: z.ZodOptional<z.ZodString>;
                requirements: z.ZodOptional<z.ZodReadonly<z.ZodRecord<z.ZodString, z.ZodString>>>;
                peers: z.ZodOptional<z.ZodReadonly<z.ZodRecord<z.ZodString, z.ZodString>>>;
            }, z.core.$strip>>>>>;
        }, z.core.$strip>>>;
        heldDown: z.ZodBoolean;
    }, z.core.$strip>>>>;
    profile: z.ZodString;
    error: z.ZodString;
    notice: z.ZodOptional<z.ZodString>;
    noticeKind: z.ZodOptional<z.ZodEnum<{
        faults: "faults";
        "may-run": "may-run";
    }>>;
    restartRequired: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>>;
/** Strict wire codec for one enable/disable request. */
export declare const setInstalledEnabledUpdateSchema: z.ZodReadonly<z.ZodObject<{
    packageName: z.ZodString;
    enabled: z.ZodBoolean;
}, z.core.$strip>>;
/** Strict wire codec for one uninstall request. */
export declare const uninstallInstalledUpdateSchema: z.ZodReadonly<z.ZodObject<{
    packageName: z.ZodString;
}, z.core.$strip>>;
/** One `dsh-mcp-client` row composed straight into the profile, outside the manager. */
export interface McpUnmanagedServer {
    /** The Loader entry id (patch-addressable). */
    readonly entryId: string;
    /** The Loader's full entry identity — what the official plugin manager's `listPlugins` names `entryId`. */
    readonly loaderId: string;
    readonly serverName: string;
    readonly transport: 'stdio' | 'streamable-http' | 'unknown';
    readonly command: string;
    /** Arguments with secret-looking values masked on the Host. */
    readonly args: readonly string[];
    /** Environment variable NAMES only; values never leave the Host. */
    readonly envKeys: readonly string[];
    /** Endpoint with secret query values masked. */
    readonly url: string;
    /** Header NAMES only. */
    readonly headerKeys: readonly string[];
    readonly enabled: boolean;
    readonly phase: 'pending' | 'loading' | 'active' | 'failed' | 'disposed' | 'unloading' | null;
    /** Config paths that hold a secret in the clear (`args[3]`, `env.API_KEY`, …). */
    readonly plaintextSecrets: readonly string[];
    /** Why the row cannot be moved under the manager as it stands, or `''`. */
    readonly adoptBlocker: McpAdoptBlocker;
}
/**
 * Why a static row cannot become a managed entry: an unknown transport, a
 * server name the manager would refuse, or an `!!js` expression other than a
 * plain `process.env.NAME` read.
 */
export type McpAdoptBlocker = '' | 'transport' | 'name' | 'expression';
/** What moving one static row under the manager did. */
export interface McpAdoptResult {
    /** The managed entry's name (the static row's `serverName`). */
    readonly name: string;
    /** Credential references written by this adoption. */
    readonly stored: readonly string[];
    /** References that already held the same value and were reused. */
    readonly reused: readonly string[];
    /** Config fields the manager does not accept, left behind. */
    readonly dropped: readonly string[];
}
/** Strict wire codec for one adoption request. */
export declare const mcpAdoptRequestSchema: z.ZodReadonly<z.ZodObject<{
    loaderId: z.ZodString;
}, z.core.$strip>>;
/** Strict wire codec for one adoption result. */
export declare const mcpAdoptResultSchema: z.ZodReadonly<z.ZodObject<{
    name: z.ZodString;
    stored: z.ZodReadonly<z.ZodArray<z.ZodString>>;
    reused: z.ZodReadonly<z.ZodArray<z.ZodString>>;
    dropped: z.ZodReadonly<z.ZodArray<z.ZodString>>;
}, z.core.$strip>>;
/** One registered MCP tool, as the model sees its name. */
export interface McpTool {
    readonly name: string;
    readonly description: string;
}
/** The live tools one server namespace contributes to the global view. */
export interface McpToolGroup {
    readonly server: string;
    readonly tools: readonly McpTool[];
}
/** The MCP facts only the Host can answer. */
export interface McpHostContext {
    /** The `dsh-mcp-manager` Loader entry id — its Settings namespace — or null when the runtime has none. */
    readonly managerEntry: string | null;
    readonly managerActive: boolean;
    readonly unmanaged: readonly McpUnmanagedServer[];
    readonly tools: readonly McpToolGroup[];
    /** Why the tool view could not be read, when it could not. */
    readonly toolsError: string;
}
/** Strict wire codec for the MCP Host read. */
export declare const mcpHostContextSchema: z.ZodReadonly<z.ZodObject<{
    managerEntry: z.ZodUnion<readonly [z.ZodString, z.ZodNull]>;
    managerActive: z.ZodBoolean;
    unmanaged: z.ZodReadonly<z.ZodArray<z.ZodReadonly<z.ZodObject<{
        entryId: z.ZodString;
        loaderId: z.ZodString;
        serverName: z.ZodString;
        transport: z.ZodEnum<{
            unknown: "unknown";
            stdio: "stdio";
            "streamable-http": "streamable-http";
        }>;
        command: z.ZodString;
        args: z.ZodReadonly<z.ZodArray<z.ZodString>>;
        envKeys: z.ZodReadonly<z.ZodArray<z.ZodString>>;
        url: z.ZodString;
        headerKeys: z.ZodReadonly<z.ZodArray<z.ZodString>>;
        enabled: z.ZodBoolean;
        phase: z.ZodUnion<readonly [z.ZodEnum<{
            failed: "failed";
            pending: "pending";
            loading: "loading";
            active: "active";
            disposed: "disposed";
            unloading: "unloading";
        }>, z.ZodNull]>;
        plaintextSecrets: z.ZodReadonly<z.ZodArray<z.ZodString>>;
        adoptBlocker: z.ZodEnum<{
            "": "";
            name: "name";
            transport: "transport";
            expression: "expression";
        }>;
    }, z.core.$strip>>>>;
    tools: z.ZodReadonly<z.ZodArray<z.ZodReadonly<z.ZodObject<{
        server: z.ZodString;
        tools: z.ZodReadonly<z.ZodArray<z.ZodReadonly<z.ZodObject<{
            name: z.ZodString;
            description: z.ZodString;
        }, z.core.$strip>>>>;
    }, z.core.$strip>>>>;
    toolsError: z.ZodString;
}, z.core.$strip>>;
export declare const mcpProbeResultSchema: z.ZodDiscriminatedUnion<[z.ZodReadonly<z.ZodObject<{
    serverInfo: z.ZodOptional<z.ZodReadonly<z.ZodObject<{
        name: z.ZodString;
        version: z.ZodString;
    }, z.core.$strip>>>;
    toolNames: z.ZodReadonly<z.ZodArray<z.ZodString>>;
    truncated: z.ZodBoolean;
    durationMs: z.ZodNumber;
    closeConfirmed: z.ZodBoolean;
    cleanupError: z.ZodOptional<z.ZodString>;
    ok: z.ZodLiteral<true>;
}, z.core.$strip>>, z.ZodReadonly<z.ZodObject<{
    stage: z.ZodEnum<{
        connect: "connect";
        list: "list";
    }>;
    message: z.ZodString;
    durationMs: z.ZodNumber;
    closeConfirmed: z.ZodBoolean;
    cleanupError: z.ZodOptional<z.ZodString>;
    ok: z.ZodLiteral<false>;
}, z.core.$strip>>], "ok">;
export type McpProbeResult = z.infer<typeof mcpProbeResultSchema>;
export declare const featuredSkillInstallScopeSchema: z.ZodEnum<{
    "user-dsh": "user-dsh";
    "user-agents": "user-agents";
    "project-dsh": "project-dsh";
}>;
export declare const installFeaturedSkillRequestSchema: z.ZodReadonly<z.ZodObject<{
    id: z.ZodString;
    scope: z.ZodEnum<{
        "user-dsh": "user-dsh";
        "user-agents": "user-agents";
        "project-dsh": "project-dsh";
    }>;
    projectDir: z.ZodOptional<z.ZodString>;
    overwrite: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>>;
export declare const installFeaturedSkillResultSchema: z.ZodReadonly<z.ZodObject<{
    ok: z.ZodBoolean;
    id: z.ZodString;
    name: z.ZodString;
    scope: z.ZodEnum<{
        "user-dsh": "user-dsh";
        "user-agents": "user-agents";
        "project-dsh": "project-dsh";
    }>;
    targetPath: z.ZodString;
    fileCount: z.ZodNumber;
    hasScripts: z.ZodBoolean;
    code: z.ZodOptional<z.ZodEnum<{
        "not-found": "not-found";
        "already-exists": "already-exists";
        "invalid-project-dir": "invalid-project-dir";
        "download-failed": "download-failed";
        "invalid-skill": "invalid-skill";
        "write-failed": "write-failed";
        cancelled: "cancelled";
    }>>;
    error: z.ZodString;
}, z.core.$strip>>;
export declare const deleteInstalledSkillRequestSchema: z.ZodReadonly<z.ZodObject<{
    name: z.ZodString;
    sourcePath: z.ZodString;
}, z.core.$strip>>;
export declare const deleteInstalledSkillResultSchema: z.ZodReadonly<z.ZodObject<{
    ok: z.ZodBoolean;
    name: z.ZodString;
    targetPath: z.ZodString;
    code: z.ZodOptional<z.ZodEnum<{
        "not-found": "not-found";
        "not-deletable": "not-deletable";
        "delete-failed": "delete-failed";
    }>>;
    error: z.ZodString;
}, z.core.$strip>>;
/** The dshMarketPro Remote namespace's strict invocation descriptors. */
export declare const SAFE_MARKET_INVOCATIONS: readonly InvocationDescriptor[];
