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
    };
}
export interface InstallHost {
    inspect(spec: string, options: {
        registry?: string | null;
    }): Promise<Reply<{
        status: 'accepted';
        registry: string | null;
    } | {
        status: 'refused';
        problem: string;
        reason: string;
    }>>;
    installBundle(spec: string, options?: {
        requestId?: string;
        registry?: string | null;
        enabled?: boolean;
        approvedBuilds?: string[];
    }): Promise<Reply<InstallResult>>;
    cancelInstall(requestId: string): Promise<Reply<{
        status: string;
    }>>;
    waitForInstall(requestId: string): Promise<Reply<InstallResult | null>>;
}
export interface DirectState {
    phase: 'idle' | 'checking' | 'installing' | 'cancelling' | 'unknown' | 'unavailable' | 'done' | 'failed';
    spec: string;
    message: string;
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
export declare function createDirectInstaller(host: () => InstallHost | undefined): {
    getSnapshot: () => DirectState;
    subscribe: (fn: () => void) => () => void;
    start(input: string | string[]): Promise<void>;
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
