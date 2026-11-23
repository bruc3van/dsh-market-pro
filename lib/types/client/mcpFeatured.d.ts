/**
 * Browser-side helpers over the shared curated MCP catalog: matching against
 * live `McpRow`s, validating modal inputs, and building {@link McpDraft}s with
 * credential-store templates.
 *
 * Kept free of React and JSX so `node --test` can exercise every rule directly.
 * @module dsh-market-pro/client/mcpFeatured
 */
import type { McpUnmanagedServer } from '../contract.ts';
import { FEATURED_MCP_CATEGORIES, FEATURED_MCP_SERVERS, featuredRuntimeBadge, featuredTargetPreview, findFeaturedMcpById, hasRequiredInputs, hasSecretInputs, matchesFeaturedMcp, matchesFeaturedRuntime, mcpIdentityKey, pickAvailableServerName, type FeaturedMcpCategory, type FeaturedMcpInput, type FeaturedMcpRuntimeFilter, type FeaturedMcpServer } from '../mcpFeatured.ts';
import { type McpDraft, type McpRow, type McpStatus } from './mcpModel.ts';
import type { McpProbeState } from './mcpController.ts';
export { FEATURED_MCP_CATEGORIES, FEATURED_MCP_SERVERS, featuredRuntimeBadge, featuredTargetPreview, findFeaturedMcpById, hasRequiredInputs, hasSecretInputs, matchesFeaturedMcp, matchesFeaturedRuntime, mcpIdentityKey, pickAvailableServerName, type FeaturedMcpCategory, type FeaturedMcpInput, type FeaturedMcpRuntimeFilter, type FeaturedMcpServer, };
/** Where an existing configured server matches a curated catalog item. */
export interface FeaturedMcpMatch {
    readonly name: string;
    readonly source: 'managed' | 'static';
}
/** Field-level validation error for the curated install modal. */
export type FeaturedMcpError = {
    readonly field: 'name';
    readonly code: 'required' | 'pattern' | 'taken';
} | {
    readonly field: 'input';
    readonly key: string;
    readonly code: 'required' | 'malformed';
};
/** Find whether a curated server is already configured as a managed or static row. */
export declare function findInstalledFeatured(item: FeaturedMcpServer, rows: readonly McpRow[], unmanaged: readonly McpUnmanagedServer[]): FeaturedMcpMatch | null;
/** Validate the server name, required inputs, and credential template syntax before building a draft. */
export declare function validateFeaturedValues(item: FeaturedMcpServer, rawName: string, values: Readonly<Record<string, string>>, takenNames: ReadonlySet<string>): FeaturedMcpError[];
/**
 * Build a ready-to-save {@link McpDraft} from a curated server and user inputs.
 *
 * Secret inputs are moved into `draft.pending` with generated `${credential:REF}`
 * templates so `controller.save` writes them to the credential store before
 * mutating Settings.
 */
export declare function draftFromFeatured(item: FeaturedMcpServer, values: Readonly<Record<string, string>>, options: {
    readonly name: string;
    readonly enabled: boolean;
    readonly takenRefs?: ReadonlySet<string>;
}): McpDraft;
/** Terminal outcome detected while waiting for a newly added featured MCP server to connect. */
export type FeaturedInstallOutcome = {
    readonly kind: 'connected';
    readonly toolCount: number;
} | {
    readonly kind: 'failed';
    readonly reason: string;
} | {
    readonly kind: 'waiting';
};
export interface ResolveFeaturedInstallOptions {
    /**
     * True right after retrying from a terminal failure, while waiting for the
     * manager to report a fresh non-failed transition (e.g. `connecting`,
     * `connected`, or `waiting-*`). Prevents stale pre-retry failure frames from
     * immediately snapping the modal back to `failed`.
     */
    readonly awaitingRetryTransition?: boolean;
}
/**
 * Inspect live manager status + optional probe state for a newly saved server.
 * Returns `null` while the server is still downloading, launching, or handshaking.
 *
 * Probe success (`done` with `ok: true`) is accepted as a positive signal when
 * the watch stream is silent, while probe errors/failures are ignored so a
 * fallback probe hitting `already-connecting`, `not-found`, or a handshake
 * timeout during first-run `npx`/`uvx` downloads never fails the modal.
 */
export declare function resolveFeaturedInstallOutcome(status: McpStatus | undefined, probe: McpProbeState | undefined, options?: ResolveFeaturedInstallOptions): FeaturedInstallOutcome | null;
