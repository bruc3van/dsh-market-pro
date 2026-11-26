import type { ReactElement } from 'react';
import type { MarketLocale } from './copy.ts';
/**
 * The in-flow GitHub star nudge card. Both exits are terminal — following the
 * link counts as answered, closing as declined — so the card appears at most a
 * handful of times in the product's life.
 */
export declare function StarPromptCard({ t, onSettle }: {
    t: MarketLocale;
    onSettle: (outcome: 'dismissed' | 'starred') => void;
}): ReactElement;
