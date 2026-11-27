/**
 * Pure SemVer range evaluation and bidirectional DSH compatibility classification.
 *
 * Mirrors `@deepseek-ai/dsh-app-boot` (`semver.satisfies(..., { includePrerelease: true })`)
 * without external dependencies so both Host and browser Client share identical logic.
 */
export type CompatibilityDirection = 'host-too-old' | 'plugin-too-old' | 'mismatch';
export interface IncompatibleRequirementItem {
    readonly name: string;
    readonly version: string;
    readonly runtimeVersion?: string;
    readonly requirements?: Readonly<Record<string, string>>;
    readonly peers?: Readonly<Record<string, string>>;
}
export interface DshCompatibilityIssue {
    readonly direction: CompatibilityDirection;
    readonly runtimeVersion: string;
    readonly requiredRange: string;
    readonly requirements: Readonly<Record<string, string>>;
}
export interface CompatFallbackInfo {
    readonly selectedVersion: string;
    readonly latestVersion: string;
    readonly latestEngine?: string;
}
export interface SubscriptionVersionCandidate {
    readonly version: string;
    readonly enginesDsh?: string;
}
export interface SubscriptionVersionSelection<T extends SubscriptionVersionCandidate> {
    readonly selected: T;
    readonly fallback?: CompatFallbackInfo;
    readonly incompatible?: DshCompatibilityIssue;
}
/** Whether `value` is a canonical semantic version string. */
export declare function isValidSemver(value: string): boolean;
/** Whether `runtimeVersion` satisfies a SemVer range under `includePrerelease: true`. */
export declare function satisfiesDshRange(runtimeVersion: string, range: string): boolean;
/**
 * Determine incompatibility direction when `runtimeVersion` does not satisfy `range`.
 * Returns `undefined` when compatible or when `runtimeVersion` is invalid/unknown.
 */
export declare function classifyRangeDirection(runtimeVersion: string, range: string): CompatibilityDirection | undefined;
/** Evaluate a single `engines.dsh` requirement against the running DSH version. */
export declare function evaluateDshEngineRange(runtimeVersion: string | undefined, range: string | undefined): DshCompatibilityIssue | undefined;
/** Whether `range` is a non-empty syntactically valid SemVer range. */
export declare function isValidDshRange(range: string): boolean;
/** Extract a DSH SemVer range from a catalog requirement line like `"DSH >=0.2.2-rc.1 <0.3.0"`. */
export declare function extractDshEngineFromRequirements(requirements: readonly string[] | undefined): string | undefined;
/** Format requirement entries into a compact human-readable phrase (`DSH >=0.2.2-rc.1 <0.3.0`). */
export declare function formatRequirementsText(requirements: Readonly<Record<string, string>> | undefined): string;
/** Merge multiple incompatibility directions conservatively. */
export declare function combineDirections(directions: readonly CompatibilityDirection[]): CompatibilityDirection;
/** Whether a requirement key belongs to the DSH host version namespace. */
export declare function isDshVersionRequirementKey(key: string): boolean;
/** Classify a dependency/engine requirement map against the running DSH host version. */
export declare function classifyRequirementRecord(requirements: Readonly<Record<string, string>> | undefined, runtimeVersion?: string): CompatibilityDirection;
/** Classify structured Host `incompatible` entries into an overall direction and requirement summary. */
export declare function classifyIncompatibleItems(items: readonly IncompatibleRequirementItem[] | undefined, fallbackRuntimeVersion?: string): {
    readonly direction: CompatibilityDirection;
    readonly runtimeVersion: string;
    readonly requirementsText: string;
    readonly items: readonly IncompatibleRequirementItem[];
};
export interface TargetCompatibilityCandidate {
    readonly dshEngine?: string;
    readonly compatFallback?: CompatFallbackInfo;
}
export interface TargetsCompatibilityResult {
    readonly targetIssues: readonly (DshCompatibilityIssue | undefined)[];
    readonly blockingIssue: DshCompatibilityIssue | undefined;
    readonly fallbackIndices: readonly number[];
}
/**
 * Evaluate a list of install targets against the running DSH version.
 * Repo-level fallback requirements apply only when there is a single target
 * so Monorepo siblings never inherit another sibling's constraint.
 */
export declare function evaluateTargetsCompatibility(targets: readonly TargetCompatibilityCandidate[], dshVersion: string | undefined, fallbackRequirements?: readonly string[]): TargetsCompatibilityResult;
/**
 * Select the newest subscription version compatible with `runtimeVersion`.
 * Falls back to older published versions if the newest requires another DSH version;
 * if no version is compatible, retains the newest version and attaches its compatibility issue.
 */
export declare function selectCompatibleSubscriptionVersion<T extends SubscriptionVersionCandidate>(versions: readonly T[], runtimeVersion?: string): SubscriptionVersionSelection<T> | undefined;
