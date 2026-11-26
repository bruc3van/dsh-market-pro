/**
 * The one-time GitHub star nudge.
 *
 * Counts market openings in `localStorage` and, from the third open on,
 * offers a small dismissible card asking for a star — the moment a returning
 * user has demonstrably found the market useful. Clicking through or
 * dismissing is terminal: the card never nags again, and because the state
 * is per-browser it never leaves the machine either.
 * @module dsh-market-pro/client/starPrompt
 */
export declare const STAR_PROMPT_STORAGE_KEY = "dsh-market-pro:star-prompt:v1";
/** The open count at which the nudge first appears. */
export declare const STAR_PROMPT_OPEN_THRESHOLD = 3;
export declare const STAR_REPOSITORY_URL = "https://github.com/bruc3van/dsh-market-pro";
/** Broadcast on `window` when any mounted market instance settles the nudge, so peers hide theirs too. */
export declare const STAR_SETTLED_EVENT = "dsh-market-pro:star-settled";
/**
 * Count one market opening and answer whether the nudge should show now:
 * the threshold reached, and neither the star click nor a dismissal recorded.
 */
export declare function recordMarketOpen(storage?: Storage | null): boolean;
/** Whether the nudge is still armed for a later open (exported for tests). */
export declare function starPromptPending(storage?: Storage | null): boolean;
/** Terminal answer to the nudge: the user clicked through or closed it — never ask again. */
export declare function settleStarPrompt(outcome: 'dismissed' | 'starred', storage?: Storage | null): void;
