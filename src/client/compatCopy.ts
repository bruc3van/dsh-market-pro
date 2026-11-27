/**
 * Shared client-side bidirectional compatibility localization helpers.
 */
import {
  classifyIncompatibleItems,
  evaluateDshEngineRange,
  evaluateTargetsCompatibility,
  extractDshEngineFromRequirements,
  formatRequirementsText,
  type CompatFallbackInfo,
  type CompatibilityDirection,
  type DshCompatibilityIssue,
} from '../compatibility.ts'
import type { MarketHostError, MarketInstalledPackage, MarketPlugin } from '../contract.ts'
import type { InstallTargetInfo } from '../installInfo.ts'
import { isSafeVersion } from '../shapes.ts'
import type { MarketLocale } from './copy.ts'
import { installChoices } from './installTargets.ts'
import { ownedByTarget } from './owned.ts'

export type CompatMessageContext = 'installed' | 'official' | 'install'

/** Evaluate a single catalog install target against the running DSH version. */
export function catalogTargetCompatibility(
  target: Pick<InstallTargetInfo, 'dshEngine'>,
  item: Pick<MarketPlugin, 'installInfo'> | null | undefined,
  dshVersion: string | undefined,
): DshCompatibilityIssue | undefined {
  const singleTargetFallback = (item?.installInfo?.targets.length ?? 0) <= 1
    ? extractDshEngineFromRequirements(item?.installInfo?.requirements)
    : undefined
  return evaluateDshEngineRange(dshVersion, target.dshEngine ?? singleTargetFallback)
}

/**
 * Evaluate a catalog item against the running DSH version.
 * Returns an issue only when every command-installable target is incompatible
 * (partial compatibility in Monorepos stays installable via individual target toggles).
 */
export function catalogItemCompatibility(
  item: Pick<MarketPlugin, 'installInfo'>,
  dshVersion: string | undefined,
): DshCompatibilityIssue | undefined {
  if (!dshVersion || item.installInfo?.mode !== 'command' || item.installInfo.targets.length === 0) {
    return undefined
  }
  const choices = installChoices(item.installInfo.targets)
  if (choices.length === 0) return undefined
  const fallbackReqs = item.installInfo.targets.length === 1 ? item.installInfo.requirements : undefined
  return evaluateTargetsCompatibility(choices, dshVersion, fallbackReqs).blockingIssue
}

/** Evaluate only uninstalled targets of a partially installed Monorepo card. */
export function remainingTargetsCompatibility(
  ownedIndex: ReadonlyMap<string, MarketInstalledPackage>,
  item: Pick<MarketPlugin, 'installInfo'>,
  dshVersion: string | undefined,
): DshCompatibilityIssue | undefined {
  if (!dshVersion || item.installInfo?.mode !== 'command' || item.installInfo.targets.length === 0) {
    return undefined
  }
  const remaining = installChoices(item.installInfo.targets)
    .filter(target => ownedByTarget(ownedIndex, target.install) === undefined)
  if (remaining.length === 0) return undefined
  const fallbackReqs = item.installInfo.targets.length === 1 ? item.installInfo.requirements : undefined
  return evaluateTargetsCompatibility(remaining, dshVersion, fallbackReqs).blockingIssue
}

/** Badge label for a catalog card or target row whose DSH requirement is unmet. */
export function compatBadgeText(direction: CompatibilityDirection, t: MarketLocale): string {
  switch (direction) {
    case 'host-too-old': return t('compat.badge.hostTooOld')
    case 'plugin-too-old': return t('compat.badge.pluginTooOld')
    case 'mismatch': return t('compat.badge.mismatch')
  }
}

/** Directional modal heading when installation fails or is blocked by DSH compatibility. */
export function formatInstallIncompatHeading(direction: CompatibilityDirection, t: MarketLocale): string {
  switch (direction) {
    case 'host-too-old': return t('compat.heading.hostTooOld')
    case 'plugin-too-old': return t('compat.heading.pluginTooOld')
    case 'mismatch': return t('compat.heading.mismatch')
  }
}

function actionHintKey(
  direction: CompatibilityDirection,
  context: CompatMessageContext,
  hasUpdate: boolean,
):
  | 'compat.action.upgradeDshInstall'
  | 'compat.action.upgradeDshInstalled'
  | 'compat.action.updatePlugin'
  | 'compat.action.pluginTooOldInstall'
  | 'compat.action.pluginTooOldInstalled'
  | 'compat.action.mismatchInstall'
  | 'compat.action.mismatchInstalled' {
  if (direction === 'host-too-old') {
    return context === 'install' ? 'compat.action.upgradeDshInstall' : 'compat.action.upgradeDshInstalled'
  }
  if (direction === 'plugin-too-old') {
    if (context === 'install') return 'compat.action.pluginTooOldInstall'
    return hasUpdate ? 'compat.action.updatePlugin' : 'compat.action.pluginTooOldInstalled'
  }
  if (context === 'install') return 'compat.action.mismatchInstall'
  return hasUpdate ? 'compat.action.updatePlugin' : 'compat.action.mismatchInstalled'
}

/** Format a single pre-install catalog compatibility issue into localized warning text. */
export function formatPreInstallCompatText(issue: DshCompatibilityIssue, t: MarketLocale): string {
  const requirements = formatRequirementsText(issue.requirements)
  const detail = issue.direction === 'host-too-old'
    ? t('compat.hostTooOldDetail', { runtime: issue.runtimeVersion, requirements })
    : issue.direction === 'plugin-too-old'
      ? t('compat.pluginTooOldDetail', { runtime: issue.runtimeVersion, requirements })
      : t('compat.mismatchDetail', { runtime: issue.runtimeVersion, requirements })
  const action = t(actionHintKey(issue.direction, 'install', false))
  return `${detail} ${action}`
}

/** Format a Host `ManagementError` (`incompatible-version`, `unsupported-platform`, etc.) into localized text. */
export function formatHostErrorText(
  error: MarketHostError,
  t: MarketLocale,
  context: CompatMessageContext,
  options: { readonly hasUpdate?: boolean; readonly fallbackRuntimeVersion?: string } = {},
): string {
  const hasUpdate = options.hasUpdate === true
  if (error.code === 'incompatible-version') {
    const info = classifyIncompatibleItems(error.incompatible, options.fallbackRuntimeVersion)
    const runtime = info.runtimeVersion
    const requirements = info.requirementsText
    let reason: string
    if (runtime !== '' && requirements !== '') {
      reason = info.direction === 'host-too-old'
        ? t('compat.hostTooOldDetail', { runtime, requirements })
        : info.direction === 'plugin-too-old'
          ? t('compat.pluginTooOldDetail', { runtime, requirements })
          : t('compat.mismatchDetail', { runtime, requirements })
    } else {
      reason = info.direction === 'host-too-old'
        ? t('compat.hostTooOldShort')
        : info.direction === 'plugin-too-old'
          ? t('compat.pluginTooOldShort')
          : t('compat.mismatchShort')
    }
    const action = t(actionHintKey(info.direction, context, hasUpdate))
    return `${reason} ${action}`
  }
  switch (error.code) {
    case 'unsupported-platform': return t('hostError.unsupportedPlatform')
    case 'not-bundle': return t('hostError.notBundle')
    case 'management-required': return t('hostError.managementRequired')
    case 'unaddressable': return t('hostError.unaddressable')
    case 'bundle-in-use': return t('hostError.bundleInUse')
    case 'stop-profile': return t('hostError.stopProfile')
    default: return error.diagnostic || error.code
  }
}

/** Format notice when subscription compatibility fallback picked an older release. */
export function formatFallbackNoticeText(
  fallback: CompatFallbackInfo,
  dshVersion: string | undefined,
  t: MarketLocale,
): string {
  const selected = isSafeVersion(fallback.selectedVersion) ? fallback.selectedVersion : fallback.selectedVersion.replace(/^v/i, '')
  const latest = isSafeVersion(fallback.latestVersion) ? fallback.latestVersion : fallback.latestVersion.replace(/^v/i, '')
  const runtime = dshVersion || '-'
  return fallback.latestEngine
    ? t('compat.fallbackNotice', {
        selected,
        runtime,
        latest,
        requirements: `DSH ${fallback.latestEngine}`,
      })
    : t('compat.fallbackNoticeSimple', {
        selected,
        runtime,
        latest,
      })
}

/** Format directional blocked reason for an incompatible candidate in the update dialog. */
export function formatUpdateChoiceBlocked(
  choice: { readonly blocked?: string; readonly blockedKind?: CompatibilityDirection },
  t: MarketLocale,
): string {
  const reason = choice.blocked ?? ''
  if (choice.blockedKind === 'host-too-old') {
    return t('update.blockedHostTooOld', { reason })
  }
  if (choice.blockedKind === 'plugin-too-old') {
    return t('update.blockedPluginTooOld', { reason })
  }
  return t('update.blocked', { reason })
}
