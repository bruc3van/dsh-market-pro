import { type ReactNode } from 'react';
/** One external destination offered from the header's More menu. */
export interface MarketMoreLink {
    id: string;
    label: string;
    href: string;
    icon?: ReactNode;
}
export declare function MarketMoreActions({ label, links }: {
    label: string;
    links: readonly MarketMoreLink[];
}): import("react").JSX.Element;
