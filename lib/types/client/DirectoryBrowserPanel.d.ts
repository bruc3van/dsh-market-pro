import { type ReactElement } from 'react';
import type { MarketLocale } from './copy.ts';
import type { DirectoryBrowserController } from './directoryBrowser.ts';
/**
 * In-app Host directory browser modal for runtimes whose directoryPicker serves
 * `"browse"` (such as DSH-go / Web) instead of a native OS file dialog.
 */
export declare function DirectoryBrowserPanel({ controller, ownerId, t }: {
    controller: DirectoryBrowserController;
    ownerId?: string;
    t: MarketLocale;
}): ReactElement;
