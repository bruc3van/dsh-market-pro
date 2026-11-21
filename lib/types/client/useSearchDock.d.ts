/** Explicit hysteresis state for the docking search bar. */
export type SearchDockMode = 'expanded' | 'compact';
export interface SearchDockState {
    readonly mode: SearchDockMode;
    readonly previousTop: number;
    readonly viewportHeight: number;
    readonly scrollDelta: number;
}
export type SearchDockEvent = {
    readonly type: 'reset';
} | {
    readonly type: 'resize';
    readonly rootWidth: number;
    readonly focusInside: boolean;
} | {
    readonly type: 'scroll';
    readonly scrollTop: number;
    readonly clientHeight: number;
    readonly rootWidth: number;
    readonly focusInside: boolean;
};
export declare const INITIAL_SEARCH_DOCK_STATE: SearchDockState;
/** Pure hysteresis transition for docking/undocking the search bar without DOM coupling. */
export declare function stepSearchDock(state: SearchDockState, event: SearchDockEvent): SearchDockState;
/** Move the existing search controls, retaining their value and keyboard focus. */
export declare function useSearchDock(page: string): {
    root: import("react").RefObject<HTMLDivElement>;
    compact: boolean;
};
