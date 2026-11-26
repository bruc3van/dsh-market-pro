import type { TelemetryErrorCode } from './contract.ts';
export interface InstallErrorHints {
    readonly inspectProblem?: string;
    readonly errorCode?: string;
    readonly packageKind?: string;
    readonly timedOut?: boolean;
    readonly skillErrorCode?: string;
}
/**
 * Map structured Host/installer signals and raw error text to a closed,
 * privacy-safe error enum. Shared by the browser client and Host telemetry
 * reporter without pulling Node built-ins or schema validators into the client bundle.
 */
export declare function classifyInstallError(raw: string, hints?: InstallErrorHints): TelemetryErrorCode;
