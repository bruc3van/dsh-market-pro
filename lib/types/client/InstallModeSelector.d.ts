interface MenuOption<T extends string = string> {
    value: T;
    label: string;
    count?: number;
}
export declare function MarketSelector<T extends string = string>({ value, onChange, label, options, className, prefix, disabled }: {
    value: T;
    onChange: (value: T) => void;
    label: string;
    options: readonly MenuOption<T>[];
    className: string;
    prefix?: string;
    disabled?: boolean;
}): import("react").JSX.Element;
export {};
