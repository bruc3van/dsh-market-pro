/**
 * Explicit three-state lifecycle for dynamically registering an Agent tool into
 * the optional Host `tools` service and keeping it synced with a live toggle.
 */
import type { Context } from '@deepseek-ai/cordis';
/** Structural subset of DSH's `ToolsService` used at runtime. */
export interface ToolsRegistryFace {
    register(definition: Record<string, unknown>, options?: {
        when?: () => boolean;
    }): () => void;
}
export interface DynamicAiToolOptions {
    readonly effectLabel: string;
    readonly logLabel: string;
    readonly isEnabled: () => boolean;
    readonly createDefinition: () => Record<string, unknown>;
}
/**
 * Mount a dynamic tool into `ctx.tools` when present and synchronize its
 * registration state (`unbound -> idle <-> registered`) with `isEnabled()`.
 */
export declare function registerDynamicAiTool(ctx: Context, options: DynamicAiToolOptions): {
    sync(): void;
};
