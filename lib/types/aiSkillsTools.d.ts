/**
 * Agent-native `dsh_skills_pro` tool registered into the Host tool registry
 * when `ctx.tools` is available and `settings.aiAssistantEnabled` is on.
 *
 * Strictly read-only and concurrency-safe:
 * - `list_installed`: inspect the current session's resolvable Agent Skills
 * - `list_featured`: browse the 100 curated All Time skills from skills.sh
 * - `search_featured`: bilingual + CJK bigram search over the 100 curated skills
 * - `detail`: batch-inspect 1..6 curated skills with verified repo, subpath,
 *   official status, All Time installs, GitHub/skills.sh links, and CLI command
 *
 * All model-facing output is wrapped in `<untrusted_skill_data>` with invisible
 * Unicode stripping and angle-bracket neutralization.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SafeMarketSettings } from './contract.ts';
import { type InstalledSkillLike } from './skillsFeatured.ts';
export declare const SKILLS_TOOL_NAME = "dsh_skills_pro";
export declare const MAX_AI_SKILL_QUERIES = 6;
export declare const MAX_AI_SKILL_DETAILS = 6;
export declare const MAX_AI_SKILL_LIMIT = 100;
/** Wrap model-facing skill discovery output in an unforgeable untrusted-data boundary. */
export declare function wrapUntrustedSkillData(payload: string): string;
/** One installed skill observed in the calling session. */
export interface ObservedInstalledSkill extends InstalledSkillLike {
    readonly description?: string;
    readonly modelInvocable?: boolean;
    readonly userInvocable?: boolean;
}
/** Snapshot of currently available skills in the calling session. */
export interface LiveSkillsSnapshot {
    readonly available: boolean;
    readonly complete: boolean;
    readonly cwd?: string;
    readonly error?: string;
    readonly skills: readonly ObservedInstalledSkill[];
}
export interface SkillsToolExecContext {
    readonly agent?: unknown;
    readonly callId?: string;
    readonly signal?: AbortSignal;
}
export interface MarketAiSkillsToolDeps {
    readonly profile: string;
    readonly readSettings: () => SafeMarketSettings;
    readonly readInstalledSkills: (agent: unknown, signal?: AbortSignal) => Promise<LiveSkillsSnapshot>;
}
/** Build the registry-ready `dsh_skills_pro` read-only tool definition. */
export declare function createMarketAiSkillsToolDefinition(deps: MarketAiSkillsToolDeps): Record<string, unknown>;
/**
 * Read the calling live agent's scoped skill inventory without falling back to
 * an unscoped root snapshot (which on web hosts omits preset-scoped filesystem
 * skills and would falsely report an empty inventory).
 */
export declare function readLiveSessionSkills(ctx: Context, agent: unknown, signal?: AbortSignal): Promise<LiveSkillsSnapshot>;
/**
 * Mount the `dsh_skills_pro` tool when `ctx.tools` is available and keep its
 * registration synchronized with `settings.aiAssistantEnabled`.
 */
export declare function registerMarketAiSkillsTool(ctx: Context, deps: {
    readonly profile: string;
    readonly readSettings: () => SafeMarketSettings;
}): {
    sync(): void;
};
