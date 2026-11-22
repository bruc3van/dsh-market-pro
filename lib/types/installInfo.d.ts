/** Maximum length accepted for a normalized repository subdirectory on the wire. */
export declare const MAX_REPO_DIRECTORY_LENGTH = 1024;
/** A GitHub repository and optional normalized subdirectory path. */
export interface GitHubLocator {
    readonly repository: string;
    readonly directory: string;
}
/** Normalize a repository subdirectory path (`packages/dsh-plugin`), or `''` for root / unsafe / overlong paths. */
export declare function normalizeRepoDirectory(raw: string): string;
/** Extract the npm package name from an npm install spec (`@scope/pkg@1.2.3` → `@scope/pkg`), or `''`. */
export declare function packageNameFromInstallSpec(spec: string): string;
/**
 * Reduce a GitHub URL or shorthand (`github:owner/name`, optional bare `owner/name`)
 * to `owner/name`, stripping trailing slashes and `.git` case-insensitively.
 */
export declare function parseGitHubRepoSlug(value: string, options?: {
    allowBareSlug?: boolean;
    allowCodeload?: boolean;
}): string;
/**
 * Extract the GitHub `owner/name` and optional `#path:...` subdirectory from a
 * catalog install target or profile `dependencies` git spec. Rejects invalid
 * `#path:` values instead of degrading them to the repository root.
 */
export declare function parseGitHubInstallSpec(spec: string): GitHubLocator | null;
export declare function isInstallSpec(value: string): boolean;
export interface InstallInfo {
    mode: 'command' | 'manual';
    targets: {
        install: string;
        profile: string;
        note: string;
    }[];
    tasks: string[];
    requirements: string[];
    note: string;
    manual: string;
}
export declare function parseInstallInfo(value: unknown): InstallInfo | undefined;
