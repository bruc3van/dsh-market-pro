import type { TelemetryErrorCode } from './contract.ts';
/**
 * Map raw installation error text to a closed, privacy-safe error enum.
 * Shared by the browser client and Host telemetry reporter without pulling
 * Node built-ins or schema validators into the client bundle.
 */
export declare function classifyInstallError(raw: string): TelemetryErrorCode;
