import { type IncompatibleRequirementItem } from '../compatibility.ts';
import type { MarketLocale } from './copy.ts';
import type { DirectState } from './directInstall.ts';
/** Shared post-install status, build-approval, incompatibility, and diagnostic banner. */
export declare function InstallStatusBanner({ id, phase, application, errorCode, incompatible, pendingBuilds, message, queueLength, dshVersion, diagnosticDefaultOpen, t, }: {
    readonly id?: string;
    readonly phase: DirectState['phase'];
    readonly application?: string;
    readonly errorCode?: string;
    readonly incompatible?: readonly IncompatibleRequirementItem[];
    readonly pendingBuilds: readonly string[];
    readonly message: string;
    readonly queueLength?: number;
    readonly dshVersion?: string;
    readonly diagnosticDefaultOpen?: boolean;
    readonly t: MarketLocale;
}): import("react").JSX.Element;
