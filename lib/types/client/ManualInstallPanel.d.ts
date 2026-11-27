import type { MarketLocale } from './copy.ts';
import { type DirectInstaller } from './directInstall.ts';
import { type ReviewTarget } from './reviewPrompt.ts';
/** Manual plugin install dialog covering npm packages, Git repositories, tarballs, and local directories. */
export declare function ManualInstallPanel({ open: requestedOpen, installer, dshVersion, t, onClose, onInstalled, onReview, reviewBusy, reviewAvailable, reviewMessage, }: {
    readonly open: boolean;
    readonly installer: DirectInstaller;
    readonly dshVersion?: string;
    readonly t: MarketLocale;
    readonly onClose: () => void;
    readonly onInstalled: () => void;
    readonly onReview: (targets: ReviewTarget[]) => Promise<boolean>;
    readonly reviewBusy: boolean;
    readonly reviewAvailable: boolean;
    readonly reviewMessage: string;
}): import("react").JSX.Element;
