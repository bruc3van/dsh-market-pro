/**
 * Bounded, secret-free runtime environment summary for `dsh_market_pro`.
 */
import { clip } from './aiSanitize.ts'
import { classifyIncompatibleItems, type CompatibilityDirection } from './compatibility.ts'
import type { MarketInstalledResult, McpHostContext } from './contract.ts'

export interface AiEnvironmentResult {
  readonly profile: string
  readonly dshVersion?: string
  readonly installedError: string
  readonly installedPackages: readonly {
    readonly packageName: string
    readonly version: string
    readonly enabled: boolean
    readonly repository?: string
    readonly self?: true
    readonly inBox?: true
    readonly hostError?: {
      readonly code: string
      readonly direction?: CompatibilityDirection
      readonly requirements?: string
    }
  }[]
  readonly mcp: {
    readonly managerActive: boolean
    readonly toolGroups: readonly {
      readonly server: string
      readonly toolCount: number
      readonly sampleTools: readonly string[]
    }[]
    readonly unmanagedServers: readonly {
      readonly serverName: string
      readonly transport: string
      readonly enabled: boolean
      readonly phase: string | null
    }[]
    readonly toolsError?: string
  }
}

/** Build a secret-free, sanitized summary of installed plugins and MCP servers in this profile. */
export function buildAiEnvironment(
  profile: string,
  installed: MarketInstalledResult,
  mcp: McpHostContext,
  dshVersion?: string,
): AiEnvironmentResult {
  return {
    profile: clip(profile, 80),
    ...(dshVersion ? { dshVersion: clip(dshVersion, 60) } : {}),
    installedError: clip(installed.error, 200),
    installedPackages: installed.packages.slice(0, 100).map((pkg) => {
      let hostError: NonNullable<AiEnvironmentResult['installedPackages'][number]['hostError']> | undefined
      if (pkg.hostError !== undefined) {
        if (pkg.hostError.code === 'incompatible-version') {
          const info = classifyIncompatibleItems(pkg.hostError.incompatible, dshVersion)
          hostError = {
            code: 'incompatible-version',
            direction: info.direction,
            ...(info.requirementsText ? { requirements: clip(info.requirementsText, 200) } : {}),
          }
        } else {
          hostError = { code: clip(pkg.hostError.code, 60) }
        }
      }
      return {
        packageName: clip(pkg.packageName, 120),
        version: clip(pkg.version, 60),
        enabled: pkg.enabled,
        ...(pkg.repository !== '' ? { repository: clip(pkg.repository, 140) } : {}),
        ...(pkg.self ? { self: true as const } : {}),
        ...(pkg.inBox ? { inBox: true as const } : {}),
        ...(hostError !== undefined ? { hostError } : {}),
      }
    }),
    mcp: {
      managerActive: mcp.managerActive,
      toolGroups: mcp.tools.slice(0, 40).map(group => ({
        server: clip(group.server, 80),
        toolCount: group.tools.length,
        sampleTools: group.tools.slice(0, 8).map(tool => clip(tool.name, 80)),
      })),
      unmanagedServers: mcp.unmanaged.slice(0, 40).map(server => ({
        serverName: clip(server.serverName, 80),
        transport: server.transport,
        enabled: server.enabled,
        phase: server.phase,
      })),
      ...(mcp.toolsError !== '' ? { toolsError: clip(mcp.toolsError, 200) } : {}),
    },
  }
}
