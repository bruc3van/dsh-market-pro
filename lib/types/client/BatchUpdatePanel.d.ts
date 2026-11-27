import { type ReactElement } from 'react';
import type { MarketLocale } from './copy.ts';
import { type PluginUpdater, type UpdateState } from './pluginUpdates.ts';
/** Three-stage sequential batch updater: confirm list -> run with skip-on-failure -> summary. */
export declare function BatchUpdatePanel({ open, state, updater, busy, t, onClose }: {
    open: boolean;
    state: UpdateState;
    updater: PluginUpdater;
    busy?: boolean;
    t: MarketLocale;
    onClose: () => void;
}): ReactElement;
