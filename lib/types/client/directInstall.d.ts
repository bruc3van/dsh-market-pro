import { type InstallInfo } from '../installInfo.ts';
import type { MarketInstalledPackage } from '../contract.ts';
type Reply<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: {
        message: string;
    };
};
interface InstallResult {
    application: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled';
    pendingBuilds?: string[];
    warnings?: string[];
    error?: {
        code: string;
        diagnostic?: string;
        incompatible?: {
            name: string;
            version: string;
            requirements?: Record<string, string>;
            /** Before DSH 0.2.1-alpha.4. */
            peers?: Record<string, string>;
        }[];
    };
    packageResult?: {
        output?: string;
        kind?: string;
        timedOut?: boolean;
    };
}
export interface PluginRegistriesSnapshot {
    readonly registry: string | null;
    readonly fallbackRegistries: readonly string[];
    readonly resolved: string | null;
}
export interface InstallHost {
    inspect(spec: string, options: {
        registry?: string | null;
    }): Promise<Reply<{
        status: 'accepted';
        registry: string | null;
        kind?: string;
        name?: string;
        version?: string;
        description?: string;
        bundle?: boolean | null;
        host?: string;
    } | {
        status: 'refused';
        problem: string;
        reason: string;
        registries?: readonly (string | null)[];
    }>>;
    installBundle(spec: string, options?: {
        requestId?: string;
        registry?: string | null;
        enabled?: boolean;
        saveExact?: boolean;
        approvedBuilds?: string[];
    }): Promise<Reply<InstallResult>>;
    cancelInstall(requestId: string): Promise<Reply<{
        status: string;
    }>>;
    waitForInstall(requestId: string): Promise<Reply<InstallResult | null>>;
    registries?(): Promise<Reply<PluginRegistriesSnapshot>>;
}
export interface InspectRefusal {
    readonly problem: string;
    readonly reason: string;
    readonly registries?: readonly (string | null)[];
}
export interface DirectState {
    phase: 'idle' | 'checking' | 'installing' | 'cancelling' | 'unknown' | 'unavailable' | 'done' | 'failed';
    origin: 'catalog' | 'manual';
    spec: string;
    manualTitle?: string;
    registry?: string | null;
    message: string;
    inspectError?: InspectRefusal;
    application?: string;
    pendingBuilds: string[];
    /** True while `recover()` is polling the Host for an interrupted install's outcome. */
    recovering: boolean;
    queue: {
        spec: string;
        phase: DirectState['phase'];
        application?: string;
        message: string;
    }[];
}
export interface DirectInstallOutcome {
    readonly spec: string;
    readonly result: 'ok' | 'failed';
    readonly message: string;
    readonly manual?: boolean;
    readonly inspectProblem?: string;
    readonly errorCode?: string;
    readonly packageKind?: string;
    readonly timedOut?: boolean;
}
export interface ManualInstallOptions {
    readonly registry?: string | null;
    readonly saveExact?: boolean;
    readonly enabled?: boolean;
    readonly title?: string;
}
/** Basic sanity check for user-entered package names, Git URLs, tarballs, or local directories. */
export declare function isManualInstallInputValid(raw: string): boolean;
/** Validate a user-entered custom npm registry URL (`http://` or `https://`). */
export declare function isValidCustomRegistryUrl(raw: string): boolean;
/** Deduplicated list of registries offered by the Host (primary, fallbacks, and pnpm default). */
export declare function offeredInstallRegistries(registries: PluginRegistriesSnapshot | null): readonly (string | null)[];
/** Classify a registry URL into a user-facing label key + hostname. */
export declare function installRegistryLabel(registry: string | null, resolved: string | null): {
    readonly kind: 'default' | 'official' | 'npmmirror' | 'host';
    readonly host: string;
};
export declare function createDirectInstaller(host: () => InstallHost | undefined, onOutcome?: (outcome: DirectInstallOutcome) => void): {
    getSnapshot: () => DirectState;
    subscribe: (fn: () => void) => () => void;
    start(input: string | string[]): Promise<void>;
    startManual(rawSpec: string, options?: ManualInstallOptions): Promise<void>;
    listRegistries(): Promise<PluginRegistriesSnapshot | null>;
    retry(): Promise<void>;
    reset(): void;
    approve: () => Promise<void>;
    cancel(): Promise<void>;
    recover(): Promise<void>;
};
export type DirectInstaller = ReturnType<typeof createDirectInstaller>;
/**
 * Keep checkbox selection aligned with live `ownedIndex` updates before submission:
 * drop any target that is now installed, and if the user has not manually edited
 * selection yet, automatically advance to the first uninstalled target.
 */
export declare function reconcileSelectedTargets(targets: readonly InstallInfo['targets'][number][], selected: readonly number[], ownedIndex: ReadonlyMap<string, MarketInstalledPackage> | undefined, userTouched: boolean): number[];
/**
 * Whether a settled direct-install snapshot warrants re-reading the profile's
 * installed list. Avoids redundant reloads on `inspect` refusals or script
 * approval prompts while still reconciling partial batches and already-installed
 * errors.
 */
export declare function shouldRefreshInstalledAfterDirect(state: Pick<DirectState, 'phase' | 'queue' | 'message'>): boolean;
export {};
