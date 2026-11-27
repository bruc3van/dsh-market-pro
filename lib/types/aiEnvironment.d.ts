import { type CompatibilityDirection } from './compatibility.ts';
import type { MarketInstalledResult, McpHostContext } from './contract.ts';
export interface AiEnvironmentResult {
    readonly profile: string;
    readonly dshVersion?: string;
    readonly installedError: string;
    readonly installedPackages: readonly {
        readonly packageName: string;
        readonly version: string;
        readonly enabled: boolean;
        readonly repository?: string;
        readonly self?: true;
        readonly inBox?: true;
        readonly hostError?: {
            readonly code: string;
            readonly direction?: CompatibilityDirection;
            readonly requirements?: string;
        };
    }[];
    readonly mcp: {
        readonly managerActive: boolean;
        readonly toolGroups: readonly {
            readonly server: string;
            readonly toolCount: number;
            readonly sampleTools: readonly string[];
        }[];
        readonly unmanagedServers: readonly {
            readonly serverName: string;
            readonly transport: string;
            readonly enabled: boolean;
            readonly phase: string | null;
        }[];
        readonly toolsError?: string;
    };
}
/** Build a secret-free, sanitized summary of installed plugins and MCP servers in this profile. */
export declare function buildAiEnvironment(profile: string, installed: MarketInstalledResult, mcp: McpHostContext, dshVersion?: string): AiEnvironmentResult;
