/**
 * Local per-server description notes for custom MCP servers.
 *
 * `dsh-mcp-manager` Settings does not carry a `description` field on server
 * entries, so `dsh-market-pro` persists optional user descriptions locally in
 * `localStorage` and surfaces them on MCP cards and in the editor.
 * @module dsh-market-pro/client/mcpDescriptions
 */
export declare const MCP_DESCRIPTION_MAX_LENGTH = 300;
export type McpDescriptionMap = Readonly<Record<string, string>>;
/** Collapse whitespace, trim, and bound one local MCP description to {@link MCP_DESCRIPTION_MAX_LENGTH}. */
export declare function normalizeMcpDescription(value: string): string;
/** Read the current local MCP description map (stable reference for `useSyncExternalStore`). */
export declare function getMcpDescriptions(storage?: Storage | null): McpDescriptionMap;
/** Read one server's saved local description, or `''` when unset. */
export declare function getMcpDescription(name: string, storage?: Storage | null): string;
/** Save, update, clear, or rename a server's local description. */
export declare function saveMcpDescription(name: string, description: string, previousName?: string, storage?: Storage | null): void;
/** Remove a deleted server's local description, if any. */
export declare function deleteMcpDescription(name: string, storage?: Storage | null): void;
/** Subscribe to local MCP description changes (compatible with `useSyncExternalStore`). */
export declare function subscribeMcpDescriptions(listener: () => void): () => void;
