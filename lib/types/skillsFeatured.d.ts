/**
 * Shared built-in curated Agent Skills catalog (100 verified All Time picks
 * from skills.sh) and pure matching/formatting helpers.
 *
 * Dependency-free on purpose so both the Host (`dsh_skills_pro` Agent tool)
 * and the browser (`SkillsView` Featured sub-tab) read the exact same verified
 * catalog and matching logic without runtime scraping.
 * @module dsh-market-pro/skillsFeatured
 */
/** High-level discovery category for curated Agent Skills. */
export type FeaturedSkillCategory = 'ai' | 'workflow' | 'frontend' | 'browser' | 'docs' | 'data' | 'cloud' | 'media';
/** Ordered category list for filter controls and overview summaries. */
export declare const FEATURED_SKILL_CATEGORIES: readonly FeaturedSkillCategory[];
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
/** Minimal shape of an installed local skill needed for featured matching. */
export interface InstalledSkillLike {
    readonly name: string;
    readonly source?: string;
    readonly sourceDirectory?: string;
    readonly provider?: string;
}
/** Match a curated skill against the session's currently available skills. */
export declare function findInstalledFeaturedSkill<T extends InstalledSkillLike>(item: Pick<FeaturedSkill, 'skillId' | 'name'>, installed: readonly T[]): T | null;
