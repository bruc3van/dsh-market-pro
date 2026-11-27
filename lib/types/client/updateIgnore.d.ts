export declare const IGNORED_UPDATES_STORAGE_KEY = "dsh-market-pro:ignored-updates:v1";
export type IgnoredUpdateRule = {
    readonly mode: 'version';
    readonly version: string;
} | {
    readonly mode: 'all';
};
export type IgnoredUpdatesMap = Readonly<Record<string, IgnoredUpdateRule>>;
/** Normalize version strings (`v1.2.3` -> `1.2.3`) so probes and UI labels compare uniformly. */
export declare function normalizeIgnoredVersion(version: string): string;
/** Return true when updating to `targetVersion` reaches or surpasses a version-specific ignore rule. */
export declare function shouldClearIgnoredVersion(rule: IgnoredUpdateRule | undefined, targetVersion: string): boolean;
/** Return true when `version` is suppressed by `rule`. */
export declare function isUpdateIgnored(rule: IgnoredUpdateRule | undefined, version: string): boolean;
/** Read and validate persisted ignore rules from `storage`. */
export declare function readIgnoredUpdates(storage?: Storage | null): IgnoredUpdatesMap;
/** Persist ignore rules to `storage` (deleting the key when empty). */
export declare function writeIgnoredUpdates(rules: IgnoredUpdatesMap, storage?: Storage | null): void;
/** Ignore a specific target version for `packageName`. */
export declare function withIgnoredVersion(rules: IgnoredUpdatesMap, packageName: string, version: string): IgnoredUpdatesMap;
/** Mute all future update prompts for `packageName`. */
export declare function withIgnoredAllUpdates(rules: IgnoredUpdatesMap, packageName: string): IgnoredUpdatesMap;
/** Remove any ignore rule for `packageName`. */
export declare function withoutIgnoredUpdate(rules: IgnoredUpdatesMap, packageName: string): IgnoredUpdatesMap;
