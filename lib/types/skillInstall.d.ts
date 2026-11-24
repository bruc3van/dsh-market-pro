import type { DeleteInstalledSkillRequest, DeleteInstalledSkillResult, FeaturedSkillInstallScope, InstallFeaturedSkillRequest, InstallFeaturedSkillResult } from './contract.ts';
import { type FeaturedSkill } from './skillsFeatured.ts';
import { type SubdirExtractLimits } from './tarball.ts';
/** Strict directory-name pattern for installed skill folders (single path segment). */
export declare const SAFE_SKILL_DIR_NAME: RegExp;
/** Provenance marker written inside curated skills installed by `dsh-market-pro`. */
export declare const SKILL_PROVENANCE_FILE = ".dsh-market-pro.json";
/** One entry parsed from `~/.agents/.skill-lock.json` (written by `npx skills`). */
export interface AgentsSkillLockEntry {
    readonly source: string;
    readonly skillPath?: string;
}
/** Read `~/.agents/.skill-lock.json` once per listing to verify `npx skills`-installed provenance. */
export declare function readAgentsSkillLock(home?: string): Promise<ReadonlyMap<string, AgentsSkillLockEntry>>;
/**
 * Resolve the verified curated `featuredId` (`owner/repo/skillId`) for an
 * installed skill directory on disk, or `undefined` when no provenance matches.
 */
export declare function readInstalledSkillFeaturedId(skillDir: string, skillName: string, options?: {
    readonly source?: string;
    readonly home?: string;
    readonly agentsLock?: ReadonlyMap<string, AgentsSkillLockEntry>;
}): Promise<string | undefined>;
/** Build the ordered GitHub archive tarball URLs for one verified `owner/repo`. */
export declare function skillArchiveUrls(source: string): readonly string[];
export type SkillTargetResolution = {
    readonly ok: true;
    readonly rootDir: string;
    readonly targetPath: string;
    readonly projectDir?: string;
} | {
    readonly ok: false;
    readonly code: 'invalid-project-dir' | 'invalid-skill';
    readonly error: string;
};
/** Resolve and validate the target directory for one curated skill + scope. */
export declare function resolveSkillInstallTarget(item: FeaturedSkill, scope: FeaturedSkillInstallScope, projectDir: string | undefined, home?: string): SkillTargetResolution;
export interface InstallFeaturedSkillOptions {
    readonly home?: string;
    readonly fetchImpl?: typeof fetch;
    readonly archiveUrls?: (source: string) => readonly string[];
    readonly timeoutMs?: number;
    readonly limits?: SubdirExtractLimits;
    /** Enable jsDelivr GitHub CDN failover when direct GitHub tarball URLs fail (default true). */
    readonly jsDelivrFallback?: boolean;
    readonly jsDelivrDataApiBase?: string;
    readonly jsDelivrFileHosts?: readonly string[];
}
/**
 * China-friendly fallback using jsDelivr's official GitHub package file tree
 * (`data.jsdelivr.com`) and Fastly/CDN edges (`fastly.jsdelivr.net`,
 * `cdn.jsdelivr.net`) when `codeload.github.com` and `api.github.com` fail.
 */
export declare function fetchSkillSubdirFromJsDelivr(source: string, subdir: string, signal: AbortSignal, options?: {
    readonly fetchImpl?: typeof fetch;
    readonly timeoutMs?: number;
    readonly limits?: SubdirExtractLimits;
    readonly dataApiBase?: string;
    readonly fileHosts?: readonly string[];
}): Promise<{
    readonly ok: true;
    readonly files: ReadonlyMap<string, Buffer>;
} | {
    readonly ok: false;
    readonly error: string;
}>;
/**
 * Download and atomically install one allowlisted curated Agent Skill on the Host.
 */
export declare function installFeaturedSkillOnHost(request: InstallFeaturedSkillRequest, signal: AbortSignal, options?: InstallFeaturedSkillOptions): Promise<InstallFeaturedSkillResult>;
/**
 * Safely delete one locally installed Agent Skill directory from disk.
 *
 * Refuses anything outside a recognized `.dsh/skills/` or `.agents/skills/`
 * directory (including symlinked skills roots or symlinked intermediate parent
 * directories), refuses `node_modules` / `.asar` / bundled paths, removes
 * direct symlinks without following them, and verifies real directories contain
 * a root `SKILL.md` before deleting.
 */
export declare function deleteInstalledSkillOnHost(request: DeleteInstalledSkillRequest): Promise<DeleteInstalledSkillResult>;
