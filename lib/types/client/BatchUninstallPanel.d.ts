import { type ReactElement } from 'react';
import type { MarketInstalledPackage } from '../contract.ts';
import { type BatchUninstallState, type BatchUninstaller } from './batchUninstall.ts';
import type { MarketLocale } from './copy.ts';
/** Three-stage sequential batch uninstaller: confirm selection -> run sequentially -> summary. */
export declare function BatchUninstallPanel({ open, state, uninstaller, packages, busy, t, onClose }: {
    open: boolean;
    state: BatchUninstallState;
    uninstaller: BatchUninstaller;
    packages: readonly MarketInstalledPackage[];
    busy?: boolean;
    t: MarketLocale;
    onClose: () => void;
}): ReactElement;
