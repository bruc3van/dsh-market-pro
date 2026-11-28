import { type ReactElement } from 'react';
import type { MarketLocale } from './copy.ts';
import type { HeaderRefreshAction } from './MarketSection.tsx';
import { type McpController } from './mcpController.ts';
/** MCP-owned actions hoisted into the shared tab toolbar alongside the AI assistant button. */
export interface McpToolbarActions {
    readonly canAdd: boolean;
    readonly onAdd: () => void;
}
/** The MCP page. */
export declare function McpView({ t, controller, pluginVersion, onBrowsePlugins, onRegisterRefresh, onRegisterToolbarActions }: {
    t: MarketLocale;
    controller: McpController;
    pluginVersion?: string;
    onBrowsePlugins?: () => void;
    onRegisterRefresh?: (action: HeaderRefreshAction | null) => void;
    onRegisterToolbarActions?: (actions: McpToolbarActions | null) => void;
}): ReactElement;
