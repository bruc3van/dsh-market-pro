/**
 * Shared built-in curated Agent Skills catalog (100 verified All Time picks
 * from skills.sh) and pure matching/formatting helpers.
 *
 * Dependency-free on purpose so both the Host (`dsh_skills_pro` Agent tool)
 * and the browser (`SkillsView` Featured sub-tab) read the exact same verified
 * catalog and matching logic without runtime scraping.
 * @module dsh-market-pro/skillsFeatured
 */
/** High-level discovery category for curated Agent Skills (aligned with Plugins). */
export type FeaturedSkillCategory = 'agents-workflows' | 'developer-tools' | 'ui-experience' | 'web-browser' | 'knowledge-research' | 'integrations-sharing' | 'media-vision';
/** Ordered category list for filter controls and overview summaries. */
export declare const FEATURED_SKILL_CATEGORIES: readonly FeaturedSkillCategory[];
/** Normalize a skill category string (supporting unified keys and legacy aliases). */
export declare function normalizeFeaturedSkillCategory(raw: string): FeaturedSkillCategory | undefined;
/** One curated Agent Skill entry shipped with the plugin (sourced from skills.sh All Time). */
export interface FeaturedSkill {
    /** Stable identifier (`owner/repo/skillId`). */
    readonly id: string;
    /** Skill identifier (`skillId` on skills.sh, used for CLI install flags). */
    readonly skillId: string;
    /** Display & invocation name. */
    readonly name: string;
    /** Verified GitHub repository slug (`owner/repo`). */
    readonly source: string;
    /** GitHub commit at which the skill path was verified. */
    readonly commit: string;
    /** Verified subdirectory path inside the repository containing `SKILL.md` (`""` for repo root). */
    readonly path: string;
    /** Whether marked as official on skills.sh. */
    readonly official: boolean;
    /** Curated discovery category. */
    readonly category: FeaturedSkillCategory;
    /** All Time install count snapshot from skills.sh. */
    readonly installs: number;
    readonly descriptionZh: string;
    readonly descriptionEn: string;
    readonly keywords?: readonly string[];
}
/** Source filter pill options on the Featured Skills sub-tab. */
export type FeaturedSkillOriginFilter = 'all' | 'official';
/** Curated 100 high-quality Agent Skills from skills.sh All Time (cleaned of spam clones). */
export declare const FEATURED_SKILLS: readonly FeaturedSkill[];
/** Build the GitHub URL pointing directly to this skill directory (or repo root). */
export declare function featuredSkillGithubUrl(item: Pick<FeaturedSkill, 'source' | 'path'>): string;
/** Return the direct numeric GitHub avatar URL for a curated skill's publisher, if known. */
export declare function featuredSkillIconUrl(item: Pick<FeaturedSkill, 'source'>): string | undefined;
/** Build the skills.sh detail page URL for a curated skill. */
export declare function featuredSkillSkillsShUrl(item: Pick<FeaturedSkill, 'source' | 'skillId'>): string;
/** Build the standard `npx skills add` CLI command for installing this skill. */
export declare function featuredSkillInstallCommand(item: Pick<FeaturedSkill, 'source' | 'skillId'>): string;
/** Format a skills.sh All Time install count compactly (e.g. `4.5M`, `925K`). */
export declare function formatSkillInstalls(installs: number): string;
/** Look up a curated skill by exact `id` (`owner/repo/skillId`) or case-insensitive `skillId`/`name`. */
export declare function findFeaturedSkillById(target: string): FeaturedSkill | undefined;
/** Whether a curated skill satisfies the official filter pill. */
export declare function matchesFeaturedSkillOrigin(item: FeaturedSkill, filter: FeaturedSkillOriginFilter): boolean;
/** Match a curated skill against category, official filter, and bilingual search query. */
export declare function matchesFeaturedSkill(item: FeaturedSkill, rawQuery: string, category: FeaturedSkillCategory | 'all', originFilter?: FeaturedSkillOriginFilter): boolean;
/** Exact lookup by canonical curated id (`owner/repo/skillId`), never falling back to bare names. */
export declare function findFeaturedSkillByExactId(id: string): FeaturedSkill | undefined;
/**
 * Resolve a curated skill from verified GitHub provenance (`owner/repo` plus
 * skill name and optional `SKILL.md` subpath from `.skill-lock.json`).
 */
export declare function findFeaturedSkillBySource(source: string, skillName: string, skillPath?: string): FeaturedSkill | undefined;
/** Minimal shape of an installed local skill needed for featured matching. */
export interface InstalledSkillLike {
    readonly name: string;
    readonly source?: string;
    readonly sourceDirectory?: string;
    readonly provider?: string;
    /** Verified canonical curated id (`owner/repo/skillId`) resolved from on-disk provenance. */
    readonly featuredId?: string;
}
/**
 * Match a curated skill against the session's currently available skills.
 *
 * Requires verified provenance (`featuredId`) so a custom local skill that
 * merely shares a generic name (e.g. `code-review`) is never misclaimed.
 */
export declare function findInstalledFeaturedSkill<T extends InstalledSkillLike>(item: Pick<FeaturedSkill, 'id'>, installed: readonly T[]): T | null;
/**
 * The curated catalog item an installed skill matches, if any: resolved
 * strictly from verified provenance (`featuredId`), never by bare skill name.
 */
export declare function featuredForSkill(skill: Pick<InstalledSkillLike, 'featuredId'>): FeaturedSkill | undefined;
/**
 * Pure check whether an installed skill directory path sits strictly inside a
 * user/project `.dsh/skills/` or `.agents/skills/` root and is safe to offer
 * for deletion (never bundled, never `node_modules`, never the skills root).
 */
export declare function isDeletableSkillPath(sourcePath: string | undefined): boolean;
