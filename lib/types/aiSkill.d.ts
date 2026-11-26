/**
 * Built-in `market-pro` Agent Skill registered through `ctx.skills`.
 *
 * Unifies DSH Market Pro's three agent tools (`dsh_market_pro`, `dsh_mcp_pro`,
 * and `dsh_skills_pro`) behind a single `/market-pro` entry point so users and
 * agents can discover, compare, audit, update, and safely install DSH plugins,
 * curated Agent Skills, and MCP servers without pre-classifying capability types.
 *
 * Uses `registerProvider` at `BUNDLED_SKILL_RANK` (600) so user-defined or
 * project-local skills with the same name can override it cleanly, and
 * invalidates live whenever `settings.aiAssistantEnabled` flips. Falls back
 * safely on hosts whose `skills` service lacks provider registration.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SafeMarketSettings } from './contract.ts';
export declare const MARKET_SKILL_NAME = "market-pro";
export declare const MARKET_SKILL_PROVIDER = "dsh-market-pro";
/** Matches `@deepseek-ai/dsh-skill`'s `BUNDLED_SKILL_RANK` without requiring a runtime import. */
export declare const MARKET_SKILL_RANK = 600;
export declare const MARKET_SKILL_DESCRIPTION = "DSH Market Pro AI assistant: discover, compare, and safely install DSH plugins, 100 curated Agent Skills, and curated/custom MCP servers, plus check & batch-update installed plugins. / \u63D2\u4EF6\u5E02\u573APro AI \u52A9\u624B\uFF1A\u4E00\u7AD9\u5F0F\u9009\u578B\u3001\u5B89\u5168\u5B89\u88C5\u63D2\u4EF6\u3001\u7CBE\u9009\u6280\u80FD\u4E0E MCP\uFF0C\u652F\u6301\u63D2\u4EF6\u4E00\u952E\u6279\u91CF\u66F4\u65B0\u3002";
export declare const MARKET_SKILL_WHEN_TO_USE = "Invoke when finding, comparing, recommending, auditing, installing, or updating DSH plugins, curated Agent Skills (SKILL.md), or MCP servers \u2014 including when the user asks to check for plugin updates or upgrade/update installed plugins \u2014 or choosing the best capability type (plugin vs MCP vs skill) for a user goal. Skip for unrelated tasks.";
/** Build the model-facing instruction body for the unified built-in `market-pro` skill. */
export declare function buildMarketSkillContent(profile: string): string;
export interface MarketAiSkillDeps {
    readonly profile: string;
    readonly readSettings: () => SafeMarketSettings;
}
/**
 * Register the unified built-in `market-pro` skill and keep its visibility
 * synced with `settings.aiAssistantEnabled`.
 */
export declare function registerMarketAiSkill(ctx: Context, deps: MarketAiSkillDeps): {
    sync(): void;
};
