import { type ReactElement } from 'react';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { DeleteInstalledSkillRequest, DeleteInstalledSkillResult, FeaturedSkillInstallScope, InstallFeaturedSkillRequest, InstallFeaturedSkillResult, MarketSkillsResult } from '../contract.ts';
import { type FeaturedSkill } from '../skillsFeatured.ts';
import { type SkillsSessionSource } from './skillsSubscription.ts';
import type { MarketLocale } from './copy.ts';
import type { HeaderRefreshAction } from './MarketSection.tsx';
export declare const NO_SESSION = "no-session";
export declare const SESSIONS_PENDING = "sessions-pending";
interface SkillsActions {
    listSkills: () => Promise<MarketSkillsResult>;
    skillsSession: SkillsSessionSource;
    deleteInstalledSkill?: (request: DeleteInstalledSkillRequest) => Promise<DeleteInstalledSkillResult>;
    canOpenFolder: () => Promise<boolean>;
    openFolder: (path: string) => Promise<void>;
}
export declare function ProjectSkillsView(props: SkillsActions & PropsLocale<'settings.dshMarketPro'>): ReactElement;
export interface SkillAiInstallFeedback {
    readonly skillId: string;
    readonly status: 'error' | 'needs-workspace';
    readonly message: string;
}
export declare function SkillsView({ t, listSkills, skillsSession, installFeaturedSkill, deleteInstalledSkill, pickProjectDir, canOpenFolder, openFolder, project, pluginVersion, onRegisterRefresh, onAskAiInstall, aiInstallBusy, aiInstallFeedback, }: SkillsActions & {
    t: MarketLocale;
    project?: boolean;
    pluginVersion?: string;
    installFeaturedSkill?: (request: InstallFeaturedSkillRequest, signal?: AbortSignal) => Promise<InstallFeaturedSkillResult>;
    pickProjectDir?: () => Promise<string | null>;
    onRegisterRefresh?: (action: HeaderRefreshAction | null) => void;
    onAskAiInstall?: (item: FeaturedSkill, target?: {
        readonly scope: FeaturedSkillInstallScope;
        readonly projectDir?: string;
    }) => Promise<boolean>;
    aiInstallBusy?: boolean;
    aiInstallFeedback?: SkillAiInstallFeedback | null;
}): ReactElement;
export {};
