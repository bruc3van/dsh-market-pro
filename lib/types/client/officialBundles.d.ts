import type { IncompatibleRequirementItem } from '../compatibility.ts';
type Reply<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: {
        message: string;
    };
};
export type HostBundleLocalizedText = string | Readonly<Record<string, string>>;
export interface HostBundleRow {
    readonly rowId: string;
    readonly moduleName: string;
    readonly entryId?: string;
}
export interface HostBundleError {
    readonly code: string;
    readonly diagnostic?: string;
    readonly incompatible?: readonly IncompatibleRequirementItem[];
}
export interface HostBundleInfo {
    readonly name: string;
    readonly official: boolean;
    readonly availability: 'installation' | 'profile' | 'missing';
    readonly installTarget?: {
        readonly spec: string;
        readonly version: string;
    };
    readonly version?: string;
    readonly description?: string;
    readonly meta?: {
        readonly title?: HostBundleLocalizedText;
        readonly description?: HostBundleLocalizedText;
        readonly icon?: string;
        readonly error?: string;
    };
    readonly listedByDefault?: boolean;
    readonly installed: boolean;
    readonly source?: string;
    readonly optional: boolean;
    readonly removable: boolean;
    readonly enabled: boolean;
    readonly readOnlyReason?: 'management-required' | 'unaddressable';
    readonly error?: HostBundleError;
    readonly rows: readonly HostBundleRow[];
}
export interface HostBundleChangeResult {
    readonly application: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled';
    readonly restartReason?: string;
    readonly error?: HostBundleError;
}
export interface OfficialBundleHost {
    listBundles(): Promise<Reply<readonly HostBundleInfo[]>>;
    setBundleEnabled(name: string, enabled: boolean): Promise<Reply<HostBundleChangeResult>>;
    removeBundle?(name: string): Promise<Reply<HostBundleChangeResult>>;
}
/** Core profile bundles and headless tools excluded from official plugin management UI. */
export declare const HIDDEN_OFFICIAL_BUNDLES: Set<string>;
/** Whether one Host bundle belongs in the Official / Experimental management view. */
export declare function isListedOfficialBundle(bundle: HostBundleInfo): boolean;
/** Whether the Host marks or names this official bundle as experimental. */
export declare function isExperimentalOfficialBundle(bundle: HostBundleInfo): boolean;
/** Matches the official plugin manager's on-demand update eligibility rule. */
export declare function officialBundleUpdateAvailable(bundle: HostBundleInfo): boolean;
/** Resolve localized Host bundle metadata text (`string` or locale map) cleanly. */
export declare function resolveOfficialLocalizedText(value: HostBundleLocalizedText | undefined, english: boolean): string;
/** Order official bundles matching DSH's experimental plugins view, with unknown bundles cleanly ranked between. */
export declare function orderOfficialBundles(bundles: readonly HostBundleInfo[]): HostBundleInfo[];
export type OfficialBundleStatus = 'running' | 'disabled' | 'not-running' | 'problem';
export interface OfficialBundleDisplay {
    readonly title: string;
    readonly description: string;
    readonly icon?: string;
    readonly experimental: boolean;
    readonly notInstalled: boolean;
    readonly updatable: boolean;
    readonly status: OfficialBundleStatus;
    readonly switchDisabled: boolean;
    readonly errorCode?: string;
}
/** Derive display metadata and control availability for one official bundle card. */
export declare function officialBundleDisplay(bundle: HostBundleInfo, english: boolean): OfficialBundleDisplay;
export type OfficialBundlesNotice = {
    readonly kind: 'restart';
    readonly packageName: string;
    readonly message: string;
} | {
    readonly kind: 'overridden';
    readonly packageName: string;
    readonly message: string;
} | {
    readonly kind: 'removed';
    readonly packageName: string;
    readonly message: string;
} | {
    readonly kind: 'error';
    readonly packageName: string;
    readonly message: string;
    readonly error?: HostBundleError;
};
export interface OfficialBundlesState {
    readonly status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';
    readonly bundles: readonly HostBundleInfo[];
    readonly busy: readonly string[];
    readonly uninstalling: readonly string[];
    readonly confirmingUninstall: string | null;
    readonly notice: OfficialBundlesNotice | null;
    readonly error: string;
    readonly updatedAt?: string;
}
export interface OfficialBundlesController {
    getSnapshot(): OfficialBundlesState;
    subscribe(listener: () => void): () => void;
    load(): Promise<void>;
    refresh(): Promise<void>;
    toggle(bundle: HostBundleInfo, enabled: boolean, onInstallOnDemand?: (bundle: HostBundleInfo, enabled: boolean) => void): Promise<void>;
    update(bundle: HostBundleInfo, onInstallOnDemand?: (bundle: HostBundleInfo, enabled: boolean) => void, canInstall?: () => boolean): Promise<void>;
    requestUninstall(packageName: string): void;
    cancelUninstall(): void;
    confirmUninstallNow(packageName: string): Promise<void>;
    dismissNotice(): void;
    dispose(): void;
}
/**
 * Shared client controller that reads and mutates DSH's official / experimental
 * bundles directly via `remote.pluginManager`, staying in lockstep with DSH's
 * built-in Plugins view through `plugin-manager/changed`.
 */
export declare function createOfficialBundlesController(options: {
    readonly host: () => OfficialBundleHost | undefined;
}): OfficialBundlesController;
export {};
