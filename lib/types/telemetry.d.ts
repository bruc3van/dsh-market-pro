import type { TelemetryClientEvent, TelemetryErrorCode, TelemetryHostKind, TelemetryOs } from './contract.ts';
import { classifyInstallError } from './telemetryError.ts';
export { classifyInstallError };
export declare const DEFAULT_TELEMETRY_ENDPOINT = "https://dsh-market-pro.com/api/telemetry";
export interface TelemetryStoragePort {
    read(): {
        readonly telemetryId: string;
        readonly telemetryLastPingDay: string;
        readonly telemetryLastPingKind: string;
    };
    write(patch: {
        readonly telemetryId?: string;
        readonly telemetryLastPingDay?: string;
        readonly telemetryLastPingKind?: string;
    }): void;
    readonly ready?: Promise<void>;
}
export interface TelemetryOptions {
    readonly endpoint?: string;
    readonly pluginVersion: string;
    readonly dshVersion?: string;
    readonly hostKind?: TelemetryHostKind;
    readonly os?: TelemetryOs;
    readonly isEnabled: () => boolean;
    readonly isPublicPluginTarget?: (target: string) => boolean;
    readonly resolvePublicPluginTarget?: (candidate: string) => string | null;
    readonly storage: TelemetryStoragePort;
    readonly disposeSignal?: AbortSignal;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly fetcher?: typeof fetch;
    readonly now?: () => Date;
    readonly bootDelayMs?: number;
}
export interface TelemetryReporter {
    scheduleBootPing(): void;
    handleClientEvent(event: TelemetryClientEvent): void;
    reportPluginInstall(input: {
        readonly target: string;
        readonly mode: 'direct' | 'ai';
        readonly result: 'ok' | 'failed';
        readonly errorCode?: TelemetryErrorCode;
    }): void;
    reportMcpInstall(input: {
        readonly target: string;
        readonly mode: 'featured' | 'custom';
        readonly result: 'ok' | 'failed';
        readonly errorCode?: TelemetryErrorCode;
    }): void;
    reportSkillInstall(input: {
        readonly target: string;
        readonly mode: 'featured' | 'ai';
        readonly result: 'ok' | 'failed';
        readonly errorCode?: TelemetryErrorCode;
    }): void;
    dispose(): void;
}
/** UTC+8 calendar day (`YYYY-MM-DD`), matching the server analytics boundary. */
export declare function telemetryDay(now?: Date): string;
/** Respect standard opt-out, DSH host opt-out, and CI environment variables. */
export declare function isTelemetryEnvSuppressed(env?: Readonly<Record<string, string | undefined>>): boolean;
/** Best-effort read of the running DSH host package version. */
export declare function detectDshVersion(): string;
/** Detect whether the host process is running inside a desktop wrapper. */
export declare function detectHostKind(env?: Readonly<Record<string, string | undefined>>, versions?: Readonly<Record<string, string | undefined>>): TelemetryHostKind;
export declare function detectOs(platform?: string): TelemetryOs;
/**
 * Extract a clean package name or `owner/repo` slug from an install target,
 * optionally resolving it to a canonical official-catalog identifier, else `'custom'`.
 */
export declare function sanitizePluginTarget(rawTarget: string, resolver?: (candidate: string) => boolean | string | null): string;
/** Only keep known built-in curated MCP IDs; collapse user custom servers to `'custom'`. */
export declare function sanitizeMcpTarget(rawId: string): string;
/** Only keep known built-in curated Agent Skill IDs (`owner/repo/skillId`), else `'custom'`. */
export declare function sanitizeSkillTarget(rawId: string): string;
export declare function createTelemetryReporter(options: TelemetryOptions): TelemetryReporter;
