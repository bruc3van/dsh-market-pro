import type { TelemetryErrorCode } from './contract.ts';
export interface InstallErrorHints {
    readonly inspectProblem?: string;
    readonly errorCode?: string;
    readonly packageKind?: string;
    readonly timedOut?: boolean;
    readonly skillErrorCode?: string;
    readonly mcpReason?: string;
    readonly stage?: string;
    readonly failedAt?: string;
    readonly specKind?: string;
    readonly unmet?: string;
    readonly exitCode?: number;
}
/** Keep both the head and tail of long logs so leading `ERR_PNPM_*` codes survive truncation. */
export declare function excerptForTelemetry(raw: string, head?: number, tail?: number): string;
/**
 * Map structured Host/installer signals and raw error text to a closed,
 * privacy-safe error enum. Shared by the browser client and Host telemetry
 * reporter without pulling Node built-ins or schema validators into the client bundle.
 */
export declare function classifyInstallError(raw: string, hints?: InstallErrorHints): TelemetryErrorCode;
/**
 * Extract a strictly whitelisted `<stage>:<machineCode>` diagnostic fingerprint
 * without ever including paths, package names, URLs, tokens, or free-form messages.
 */
export declare function extractInstallErrorDetail(raw: string, hints?: InstallErrorHints): string | undefined;
