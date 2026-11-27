import { test } from 'node:test'
import assert from 'node:assert/strict'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import {
  classifyIncompatibleItems,
  classifyRangeDirection,
  classifyRequirementRecord,
  combineDirections,
  evaluateDshEngineRange,
  evaluateTargetsCompatibility,
  extractDshEngineFromRequirements,
  formatRequirementsText,
  isValidDshRange,
  isValidSemver,
  satisfiesDshRange,
  selectCompatibleSubscriptionVersion,
} from '../src/compatibility.ts'
import {
  catalogItemCompatibility,
  catalogTargetCompatibility,
  compatBadgeText,
  formatFallbackNoticeText,
  formatHostErrorText,
  formatInstallIncompatHeading,
  formatPreInstallCompatText,
  formatUpdateChoiceBlocked,
  remainingTargetsCompatibility,
} from '../src/client/compatCopy.ts'
import { en, zh, type SafeMarketLocaleKey } from '../src/client/locales.ts'
import type { MarketLocale } from '../src/client/copy.ts'
import { ownedIndexOf } from '../src/client/owned.ts'

function makeTranslator(dict: Record<SafeMarketLocaleKey, string>): MarketLocale {
  return (key, params) => {
    let text = dict[key]
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replaceAll(`{${k}}`, v)
      }
    }
    return text
  }
}

const tZh = makeTranslator(zh)
const tEn = makeTranslator(en)

test('isValidSemver validates canonical SemVer with optional prerelease and build metadata', () => {
  assert.equal(isValidSemver('0.2.2-rc.1'), true)
  assert.equal(isValidSemver('0.2.2-rc.1+build.42'), true)
  assert.equal(isValidSemver('1.0.0'), true)
  assert.equal(isValidSemver('0.2'), false)
  assert.equal(isValidSemver('v0.2.2'), false)
  assert.equal(isValidSemver('latest'), false)
})

test('satisfiesDshRange and classifyRangeDirection handle bidirectional ranges and prereleases', () => {
  // Real DSH prerelease range behavior (includePrerelease: true).
  assert.equal(satisfiesDshRange('0.2.2-rc.5', '>=0.2.2-rc.1 <0.3.0'), true)
  assert.equal(satisfiesDshRange('0.3.0-rc.1', '>=0.2.2-rc.1 <0.3.0'), true)
  assert.equal(satisfiesDshRange('0.3.0-rc.1', '>=0.2.2-rc.1 <0.3.0-0'), false)
  assert.equal(satisfiesDshRange('0.2.2-rc.1+exp.sha', '>=0.2.2-rc.1 <0.3.0-0'), true)

  // Caret, tilde, hyphen, and OR union ranges.
  assert.equal(satisfiesDshRange('0.1.0-rc.8', '^0.1.0-rc.6'), true)
  assert.equal(satisfiesDshRange('0.2.0', '^0.1.0-rc.6'), false)
  assert.equal(satisfiesDshRange('0.2.1', '^0.1.0-rc.6 || ^0.2.0-rc.1'), true)
  assert.equal(satisfiesDshRange('0.2.9', '~0.2.1'), true)
  assert.equal(satisfiesDshRange('0.3.0', '~0.2.1'), false)
  assert.equal(satisfiesDshRange('0.2.4', '0.2.0 - 0.2.5'), true)
  assert.equal(satisfiesDshRange('0.2.6', '0.2.0 - 0.2.5'), false)

  // Directional classification: host-too-old vs plugin-too-old vs mismatch.
  assert.equal(classifyRangeDirection('0.2.1', '>=0.2.2-rc.1 <0.3.0'), 'host-too-old')
  assert.equal(classifyRangeDirection('0.2.2-rc.5', '>=0.3.0'), 'host-too-old')
  assert.equal(classifyRangeDirection('0.2.2-rc.1', '^0.1.0-rc.6'), 'plugin-too-old')
  assert.equal(classifyRangeDirection('0.3.0', '>=0.2.0 <0.3.0'), 'plugin-too-old')
  assert.equal(classifyRangeDirection('0.2.2', '<0.2.0 || >=0.3.0'), 'mismatch')
  assert.equal(classifyRangeDirection('0.2.2', '>=0.2.0 <0.3.0'), undefined)

  // Invalid inputs fail safely without crashing.
  assert.equal(satisfiesDshRange('not-semver', '>=0.2.0'), false)
  assert.equal(evaluateDshEngineRange('', '>=0.3.0'), undefined)
  assert.equal(evaluateDshEngineRange('0.2.2', ''), undefined)
  const badRange = evaluateDshEngineRange('0.2.2', 'invalid-range-token')
  assert.equal(badRange?.direction, 'mismatch')
})

test('extractDshEngineFromRequirements, formatRequirementsText, combineDirections, and classifyIncompatibleItems', () => {
  assert.equal(extractDshEngineFromRequirements(['DSH >=0.2.2-rc.1', 'Node 24']), '>=0.2.2-rc.1')
  assert.equal(extractDshEngineFromRequirements(['DSH ^0.2.0']), '^0.2.0')
  assert.equal(extractDshEngineFromRequirements(['dsh ^0.1.0']), '^0.1.0')
  assert.equal(extractDshEngineFromRequirements(['Node >= 20']), undefined)
  // Real catalog entries with prose notes after a DSH version must not become blocking SemVer ranges.
  assert.equal(isValidDshRange('>= 0.1.0-rc.6（宿主需包含 @deepseek-ai/dsh-web-app 组合）'), false)
  assert.equal(extractDshEngineFromRequirements(['DSH >= 0.1.0-rc.6（宿主需包含 @deepseek-ai/dsh-web-app 组合）']), undefined)
  assert.equal(extractDshEngineFromRequirements(['DSH 0.1.7-rc.2（Cordis ~4.0.4）']), undefined)

  assert.equal(
    formatRequirementsText({ 'engines.dsh': '>=0.3.0', 'dsh-settings': '^1.0.0' }),
    'DSH >=0.3.0, dsh-settings ^1.0.0',
  )
  assert.equal(combineDirections(['host-too-old', 'host-too-old']), 'host-too-old')
  assert.equal(combineDirections(['host-too-old', 'plugin-too-old']), 'mismatch')
  assert.equal(combineDirections([]), 'mismatch')

  const classifiedHostOld = classifyIncompatibleItems([
    { name: 'a', version: '2.0.0', runtimeVersion: '0.2.2-rc.1', requirements: { 'engines.dsh': '>=0.3.0' } },
  ])
  assert.equal(classifiedHostOld.direction, 'host-too-old')
  assert.equal(classifiedHostOld.runtimeVersion, '0.2.2-rc.1')
  assert.equal(classifiedHostOld.requirementsText, 'DSH >=0.3.0')

  const classifiedPluginOld = classifyIncompatibleItems([
    { name: 'b', version: '0.5.0', peers: { '@deepseek-ai/dsh-app': '^0.1.0' } },
  ], '0.2.2-rc.1')
  assert.equal(classifiedPluginOld.direction, 'plugin-too-old')
  assert.equal(classifiedPluginOld.runtimeVersion, '0.2.2-rc.1')

  const classifiedMixed = classifyIncompatibleItems([
    { name: 'a', version: '2.0.0', runtimeVersion: '0.2.2', requirements: { 'engines.dsh': '>=0.3.0' } },
    { name: 'b', version: '0.5.0', runtimeVersion: '0.2.2', requirements: { 'engines.dsh': '^0.1.0' } },
  ])
  assert.equal(classifiedMixed.direction, 'mismatch')

  // Non-DSH dependency ranges must classify as 'mismatch', never blaming DSH host version.
  assert.equal(classifyRequirementRecord({ '@deepseek-ai/cordis': '^4.0.4' }, '0.2.2-rc.5'), 'mismatch')
  assert.equal(classifyRequirementRecord({ node: '>=20' }, '0.2.2-rc.5'), 'mismatch')
  assert.equal(classifyRequirementRecord({ '@deepseek-ai/dsh-settings': '>=0.3.0' }, '0.2.2-rc.5'), 'host-too-old')
  assert.equal(classifyRequirementRecord({ 'engines.dsh': '^0.1.0', '@deepseek-ai/cordis': '^4.0.4' }, '0.2.2-rc.5'), 'mismatch')
})

test('satisfiesDshRange matches real node-semver from @deepseek-ai/dsh-app-boot across edge cases', () => {
  const bootPkg = realpathSync('node_modules/@deepseek-ai/dsh-app-boot/package.json')
  const semver = createRequire(bootPkg)('semver') as {
    satisfies: (version: string, range: string, options: { includePrerelease: boolean }) => boolean
  }
  const cases: readonly (readonly [string, string])[] = [
    ['0.2.2-rc.5', '>=0.2.2-rc.1 <0.3.0'],
    ['0.3.0-rc.1', '>=0.2.2-rc.1 <0.3.0'],
    ['0.3.0-rc.1', '>=0.2.2-rc.1 <0.3.0-0'],
    ['0.3.0', '>=0.2.2-rc.1 <0.3.0-0'],
    ['0.2.2-rc.1+build.7', '>=0.2.2-rc.1 <0.3.0-0'],
    ['0.1.0-rc.8', '^0.1.0-rc.6'],
    ['0.2.0-rc.1', '^0.1.0-rc.6'],
    ['0.2.0-rc.1', '^0.2.0'],
    ['0.2.0-rc.1', '>=0.2.0'],
    ['0.2.0-rc.1', '~0.2.0'],
    ['0.2.1', '^0.1.0-rc.6 || ^0.2.0-rc.1'],
    ['0.2.0-rc.1', '0.2.0 - 0.3.0'],
    ['0.3.0-rc.1', '0.2.0 - 0.3.0'],
    ['0.3.0', '0.2.0 - 0.3.0'],
    ['0.3.1-rc.1', '0.2.0 - 0.3.0'],
    ['0.2.0-rc.1', '0.2 - 0.3'],
    ['0.3.9', '0.2 - 0.3'],
    ['0.4.0-rc.1', '0.2 - 0.3'],
    ['0.2.2', 'foo || >=0.2.0'],
    ['0.2.2', '>=0.2.0 || bad'],
    ['0.2.2', '>=0.2.0 || '],
    ['0.2.2', '|| >=0.2.0'],
    ['0.2.2', '01.02.03'],
    ['0.2.2', '>=01.02.03'],
    ['0.2.2', 'v0.2.2'],
    ['0.2.5', '0.2.x'],
    ['0.2.5', '*'],
    ['0.2.5', '0.2'],
    ['0.2.2', ''],
  ]
  for (const [ver, range] of cases) {
    assert.equal(
      satisfiesDshRange(ver, range),
      semver.satisfies(ver, range, { includePrerelease: true }),
      `differential mismatch for ${ver} against ${JSON.stringify(range)}`,
    )
  }
})

test('evaluateTargetsCompatibility handles mixed blocking directions, partial compatibility, and single-target fallback', () => {
  const mixed = evaluateTargetsCompatibility(
    [{ dshEngine: '>=0.3.0' }, { dshEngine: '^0.1.0' }],
    '0.2.2-rc.1',
  )
  assert.equal(mixed.blockingIssue?.direction, 'mismatch')
  assert.equal(mixed.blockingIssue?.requiredRange, '>=0.3.0 / ^0.1.0')

  // Multi-target entries must never propagate repo-level requirements across unconstrained targets.
  const multiWithFallback = evaluateTargetsCompatibility(
    [{ dshEngine: '>=0.3.0' }, {}],
    '0.2.2-rc.1',
    ['DSH >=0.3.0'],
  )
  assert.equal(multiWithFallback.blockingIssue, undefined)
  assert.equal(multiWithFallback.targetIssues[0]?.direction, 'host-too-old')
  assert.equal(multiWithFallback.targetIssues[1], undefined)

  // Single-target entry falls back to repo-level requirements cleanly.
  const singleWithFallback = evaluateTargetsCompatibility([{}], '0.2.2-rc.1', ['DSH >=0.3.0'])
  assert.equal(singleWithFallback.blockingIssue?.direction, 'host-too-old')
  assert.equal(singleWithFallback.blockingIssue?.requiredRange, '>=0.3.0')
})

test('selectCompatibleSubscriptionVersion chooses newest compatible version or records incompatibility', () => {
  const versions = [
    { version: '1.17.0', enginesDsh: '>=0.2.2-rc.1 <0.3.0' },
    { version: '1.7.0', enginesDsh: '^0.1.0-rc.6 || ^0.2.0-rc.1' },
  ]

  const onRc5 = selectCompatibleSubscriptionVersion(versions, '0.2.2-rc.5')
  assert.equal(onRc5?.selected.version, '1.17.0')
  assert.equal(onRc5?.fallback, undefined)
  assert.equal(onRc5?.incompatible, undefined)

  const onOldDsh = selectCompatibleSubscriptionVersion(versions, '0.2.1')
  assert.equal(onOldDsh?.selected.version, '1.7.0')
  assert.deepEqual(onOldDsh?.fallback, {
    selectedVersion: '1.7.0',
    latestVersion: '1.17.0',
    latestEngine: '>=0.2.2-rc.1 <0.3.0',
  })
  assert.equal(onOldDsh?.incompatible, undefined)

  const onVeryOldDsh = selectCompatibleSubscriptionVersion(versions, '0.0.9')
  assert.equal(onVeryOldDsh?.selected.version, '1.17.0')
  assert.equal(onVeryOldDsh?.fallback, undefined)
  assert.equal(onVeryOldDsh?.incompatible?.direction, 'host-too-old')

  const onFutureDsh = selectCompatibleSubscriptionVersion(versions, '0.3.0')
  assert.equal(onFutureDsh?.selected.version, '1.17.0')
  assert.equal(onFutureDsh?.fallback, undefined)
  assert.equal(onFutureDsh?.incompatible?.direction, 'plugin-too-old')

  const unknownHost = selectCompatibleSubscriptionVersion(versions, '')
  assert.equal(unknownHost?.selected.version, '1.17.0')
  assert.equal(unknownHost?.fallback, undefined)
  assert.equal(unknownHost?.incompatible, undefined)
})

test('compatCopy formats zh and en messages across all directions and contexts', () => {
  const hostOldItem = {
    installInfo: {
      mode: 'command' as const,
      targets: [{ install: 'demo@2.0.0', profile: 'web', note: '', dshEngine: '>=0.3.0' }],
      tasks: [],
      requirements: [],
      note: '',
      manual: '',
    },
  }
  const mixedMonorepoItem = {
    installInfo: {
      mode: 'command' as const,
      targets: [
        { install: 'new-only@2.0.0', profile: 'web', note: '', dshEngine: '>=0.3.0' },
        { install: 'compat@1.0.0', profile: 'web', note: '', dshEngine: '^0.2.0' },
      ],
      tasks: [],
      requirements: [],
      note: '',
      manual: '',
    },
  }

  const cardIssue = catalogItemCompatibility(hostOldItem, '0.2.2-rc.1')
  assert.equal(cardIssue?.direction, 'host-too-old')
  assert.equal(catalogItemCompatibility(mixedMonorepoItem, '0.2.2-rc.1'), undefined)
  assert.equal(
    catalogTargetCompatibility(mixedMonorepoItem.installInfo.targets[0]!, mixedMonorepoItem, '0.2.2-rc.1')?.direction,
    'host-too-old',
  )

  for (const dir of ['host-too-old', 'plugin-too-old', 'mismatch'] as const) {
    assert.ok(compatBadgeText(dir, tZh).length > 0)
    assert.ok(compatBadgeText(dir, tEn).length > 0)
    assert.ok(formatInstallIncompatHeading(dir, tZh).length > 0)
    assert.ok(formatInstallIncompatHeading(dir, tEn).length > 0)

    const issue = {
      direction: dir,
      runtimeVersion: '0.2.2-rc.1',
      requiredRange: '>=0.3.0',
      requirements: { 'engines.dsh': '>=0.3.0' },
    }
    assert.match(formatPreInstallCompatText(issue, tZh), /0\.2\.2-rc\.1/)
    assert.match(formatPreInstallCompatText(issue, tEn), /0\.2\.2-rc\.1/)
  }

  const hostErrPluginOld = {
    code: 'incompatible-version' as const,
    incompatible: [{ name: 'old', version: '0.5.0', runtimeVersion: '0.2.2-rc.1', requirements: { 'engines.dsh': '^0.1.0' } }],
  }
  assert.match(formatHostErrorText(hostErrPluginOld, tZh, 'installed', { hasUpdate: true }), /更新/)
  assert.match(formatHostErrorText(hostErrPluginOld, tEn, 'installed', { hasUpdate: true }), /update/i)
  assert.match(formatHostErrorText(hostErrPluginOld, tEn, 'official', { hasUpdate: false }), /DSH/i)

  const blockedText = formatUpdateChoiceBlocked({ blocked: 'DSH ^0.1.0', blockedKind: 'plugin-too-old' }, tEn)
  assert.match(blockedText, /DSH \^0\.1\.0/)
  assert.match(
    formatUpdateChoiceBlocked({ blocked: 'DSH >=0.3.0', blockedKind: 'host-too-old' }, tZh),
    /升级/,
  )

  // Partially installed Monorepo: target 0 (`compat`) installed, target 1 (`new-only`) incompatible -> surfaces remaining issue.
  const partialOwned = ownedIndexOf([{
    packageName: 'compat',
    version: '1.0.0',
    description: '',
    repository: '',
    self: false,
    inBox: false,
    unregistered: false,
    enabled: true,
    entries: [],
    error: '',
    heldDown: false,
  }])
  assert.equal(
    remainingTargetsCompatibility(partialOwned, mixedMonorepoItem, '0.2.2-rc.1')?.direction,
    'host-too-old',
  )

  assert.match(
    formatFallbackNoticeText({ selectedVersion: '1.7.0', latestVersion: '1.17.0', latestEngine: '>=0.3.0' }, '0.2.1', tZh),
    /v1\.7\.0.*v1\.17\.0/,
  )
})
