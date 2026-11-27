/**
 * Sequential batch uninstaller for installed plugins.
 *
 * Mirrors the sequential queue, skip-on-failure, stop-after-current, and
 * self-last ordering model of {@link ./pluginUpdates.ts | pluginUpdates.ts}.
 * @module dsh-market-pro/client/batchUninstall
 */
import type { MarketInstalledResult } from '../contract.ts';
export interface BatchUninstallTarget {
    readonly packageName: string;
    readonly version: string;
    readonly self: boolean;
    readonly inBox: boolean;
    readonly unregistered: boolean;
}
export type BatchUninstallItemStatus = 'pending' | 'running' | 'removed' | 'restart-required' | 'removed-with-faults' | 'failed' | 'skipped';
export interface BatchUninstallItem extends BatchUninstallTarget {
    readonly status: BatchUninstallItemStatus;
    readonly message?: string;
    readonly notice?: string;
    readonly noticeKind?: 'faults' | 'may-run';
}
export interface BatchUninstallState {
    readonly phase: 'idle' | 'running' | 'done';
    readonly items: readonly BatchUninstallItem[];
    readonly currentIndex: number;
    readonly stopRequested: boolean;
    /** Incremented after every settled package removal so the installed list refreshes. */
    readonly revision: number;
}
/** Keep caller order while always placing the marketplace itself last. */
export declare function orderBatchUninstallTargets<T extends {
    readonly packageName: string;
    readonly self?: boolean;
}>(items: readonly T[], selfName?: string): T[];
/** Whether a settled batch-uninstall item removed the package from the profile. */
export declare function isBatchUninstallSuccess(status: BatchUninstallItemStatus): boolean;
export interface BatchUninstallerOptions {
    readonly selfName?: string;
    readonly onItemRemoved?: (packageName: string) => void;
}
/** Sequential batch uninstall store shared across marketplace entry points. */
export declare function createBatchUninstaller(uninstallInstalled: (packageName: string) => Promise<MarketInstalledResult>, options?: BatchUninstallerOptions): {
    getSnapshot: () => BatchUninstallState;
    subscribe: (listener: () => void) => () => void;
    start(targets: readonly BatchUninstallTarget[]): Promise<void>;
    requestStop(): void;
    reset(): void;
};
export type BatchUninstaller = ReturnType<typeof createBatchUninstaller>;
