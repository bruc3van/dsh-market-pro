import type { MarketInstalledPackage, MarketPlugin } from '../contract.ts';
import type { MarketLocale } from './copy.ts';
import { type DirectInstaller } from './directInstall.ts';
import { type ReviewTarget } from './reviewPrompt.ts';
/** One shared installation remains observable if the recommendation page remounts. */
export declare function DirectInstallPanel({ item, installer, ownedIndex, t, onClose, onInstalled, onReview, onAgentInstall, reviewBusy, reviewAvailable, reviewMessage }: {
    item: MarketPlugin | null;
    installer: DirectInstaller;
    ownedIndex?: ReadonlyMap<string, MarketInstalledPackage>;
    t: MarketLocale;
    onClose: () => void;
    onInstalled: () => void;
    onReview: (targets: ReviewTarget[]) => Promise<boolean>;
    onAgentInstall?: () => void;
    reviewBusy: boolean;
    reviewAvailable: boolean;
    reviewMessage: string;
}): import("react").JSX.Element;
