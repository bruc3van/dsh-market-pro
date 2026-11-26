import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  HIDDEN_OFFICIAL_BUNDLES,
  createOfficialBundlesController,
  isExperimentalOfficialBundle,
  isListedOfficialBundle,
  officialBundleDisplay,
  officialBundleUpdateAvailable,
  orderOfficialBundles,
  resolveOfficialLocalizedText,
  type HostBundleInfo,
  type OfficialBundleHost,
} from '../src/client/officialBundles.ts'

function makeBundle(overrides: Partial<HostBundleInfo> = {}): HostBundleInfo {
  return {
    name: '@deepseek-ai/dsh-experimental-voice-input-bundle',
    official: true,
    availability: 'installation',
    installed: false,
    optional: true,
    removable: false,
    enabled: false,
    rows: [],
    meta: {
      title: { zh: '语音输入', en: 'Voice input' },
      description: { zh: '在本机使用 SenseVoice 转写录音', en: 'Transcribe recordings locally with SenseVoice' },
    },
    ...overrides,
  }
}

test('isListedOfficialBundle keeps optional and on-demand official bundles while hiding core profile bundles', () => {
  assert.equal(isListedOfficialBundle(makeBundle()), true)
  assert.equal(isListedOfficialBundle(makeBundle({ name: '@deepseek-ai/dsh-subagent-codex', availability: 'missing', optional: false, installTarget: { spec: '@deepseek-ai/dsh-subagent-codex@0.2.2', version: '0.2.2' } })), true)
  assert.equal(isListedOfficialBundle(makeBundle({ name: '@deepseek-ai/dsh-base' })), false)
  assert.equal(isListedOfficialBundle(makeBundle({ name: '@deepseek-ai/dsh-experimental-tool-worktree' })), false)
  assert.equal(isListedOfficialBundle(makeBundle({ name: 'third-party-plugin', official: false })), false)
  assert.equal(HIDDEN_OFFICIAL_BUNDLES.has('@deepseek-ai/dsh-base'), true)
})

test('orderOfficialBundles ranks leading, future unknown, and trailing official bundles deterministically', () => {
  const ordered = orderOfficialBundles([
    makeBundle({ name: '@deepseek-ai/dsh-subagent-codex' }),
    makeBundle({ name: '@deepseek-ai/dsh-experimental-future-bundle' }),
    makeBundle({ name: '@deepseek-ai/dsh-experimental-voice-input-bundle' }),
    makeBundle({ name: '@deepseek-ai/dsh-personalized-recommendations' }),
  ])
  assert.deepEqual(ordered.map(b => b.name), [
    '@deepseek-ai/dsh-experimental-voice-input-bundle',
    '@deepseek-ai/dsh-experimental-future-bundle',
    '@deepseek-ai/dsh-personalized-recommendations',
    '@deepseek-ai/dsh-subagent-codex',
  ])
})

test('resolveOfficialLocalizedText, officialBundleUpdateAvailable, and officialBundleDisplay cover localization and state rules', () => {
  assert.equal(resolveOfficialLocalizedText({ zh: '语音输入', en: 'Voice input' }, false), '语音输入')
  assert.equal(resolveOfficialLocalizedText({ zh: '语音输入', en: 'Voice input' }, true), 'Voice input')
  assert.equal(resolveOfficialLocalizedText({ 'zh-cn': '简体中文', 'en-us': 'US English' }, false), '简体中文')
  assert.equal(resolveOfficialLocalizedText({ 'zh-CN': '简体中文', 'en-US': 'US English' }, true), 'US English')
  assert.equal(resolveOfficialLocalizedText('Plain Title', true), 'Plain Title')

  const missingOnDemand = makeBundle({
    name: '@deepseek-ai/dsh-subagent-claude-code',
    availability: 'missing',
    installed: false,
    removable: false,
    installTarget: { spec: '@deepseek-ai/dsh-subagent-claude-code@0.2.2', version: '0.2.2' },
    error: { code: 'not-installed' },
  })
  const missingDisplay = officialBundleDisplay(missingOnDemand, false)
  assert.equal(missingDisplay.notInstalled, true)
  assert.equal(missingDisplay.switchDisabled, false)
  assert.equal(officialBundleUpdateAvailable(missingOnDemand), false)

  const outdatedOnDemand = makeBundle({
    name: '@deepseek-ai/dsh-subagent-claude-code',
    availability: 'profile',
    installed: true,
    removable: true,
    version: '0.2.1',
    installTarget: { spec: '@deepseek-ai/dsh-subagent-claude-code@0.2.2', version: '0.2.2' },
  })
  assert.equal(officialBundleUpdateAvailable(outdatedOnDemand), true)
  assert.equal(isExperimentalOfficialBundle(outdatedOnDemand), true)

  const unsupported = makeBundle({
    error: { code: 'unsupported-platform' },
  })
  assert.equal(officialBundleDisplay(unsupported, false).switchDisabled, true)
})

test('createOfficialBundlesController loads, toggles, installs on-demand, updates, and uninstalls in sync with Host', async () => {
  const bundles: HostBundleInfo[] = [
    makeBundle({ name: '@deepseek-ai/dsh-experimental-voice-input-bundle', enabled: false }),
    makeBundle({
      name: '@deepseek-ai/dsh-subagent-codex',
      availability: 'missing',
      installed: false,
      removable: false,
      installTarget: { spec: '@deepseek-ai/dsh-subagent-codex@0.2.2-rc.5', version: '0.2.2-rc.5' },
    }),
    makeBundle({
      name: '@deepseek-ai/dsh-subagent-claude-code',
      availability: 'profile',
      installed: true,
      removable: true,
      enabled: true,
      version: '0.2.2-rc.4',
      installTarget: { spec: '@deepseek-ai/dsh-subagent-claude-code@0.2.2-rc.5', version: '0.2.2-rc.5' },
    }),
  ]
  const calls: string[] = []
  const host: OfficialBundleHost = {
    async listBundles() {
      return { ok: true, value: bundles.map(b => ({ ...b })) }
    },
    async setBundleEnabled(name, enabled) {
      calls.push(`enable:${name}:${String(enabled)}`)
      const target = bundles.find(b => b.name === name)
      if (target) (target as { enabled: boolean }).enabled = enabled
      return { ok: true, value: { application: enabled ? 'applied' : 'restart-required' } }
    },
    async removeBundle(name) {
      calls.push(`remove:${name}`)
      const target = bundles.find(b => b.name === name)
      if (target) {
        ;(target as { installed: boolean }).installed = false
        ;(target as { enabled: boolean }).enabled = false
      }
      return { ok: true, value: { application: 'applied' } }
    },
  }

  const controller = createOfficialBundlesController({ host: () => host })
  await controller.load()
  assert.equal(controller.getSnapshot().status, 'ready')
  assert.equal(controller.getSnapshot().bundles.length, 3)

  // Toggle built-in experimental bundle on.
  await controller.toggle(controller.getSnapshot().bundles[0]!, true)
  assert.equal(calls.includes('enable:@deepseek-ai/dsh-experimental-voice-input-bundle:true'), true)
  assert.equal(controller.getSnapshot().bundles[0]!.enabled, true)

  // Toggle uninstalled on-demand bundle delegates to onInstallOnDemand.
  const onDemandCalls: Array<{ name: string; enabled: boolean }> = []
  const codex = controller.getSnapshot().bundles.find(b => b.name === '@deepseek-ai/dsh-subagent-codex')!
  await controller.toggle(codex, true, (bundle, enabled) => {
    onDemandCalls.push({ name: bundle.name, enabled })
  })
  assert.deepEqual(onDemandCalls, [{ name: '@deepseek-ai/dsh-subagent-codex', enabled: true }])

  // Update outdated on-demand bundle removes first, then delegates to onInstallOnDemand.
  const claude = controller.getSnapshot().bundles.find(b => b.name === '@deepseek-ai/dsh-subagent-claude-code')!
  await controller.update(claude, (bundle, enabled) => {
    onDemandCalls.push({ name: bundle.name, enabled })
  })
  assert.equal(calls.includes('remove:@deepseek-ai/dsh-subagent-claude-code'), true)
  assert.deepEqual(onDemandCalls[1], { name: '@deepseek-ai/dsh-subagent-claude-code', enabled: true })

  // Uninstall confirmation flow tracks uninstalling state and sets removed notice.
  controller.requestUninstall('@deepseek-ai/dsh-subagent-claude-code')
  assert.equal(controller.getSnapshot().confirmingUninstall, '@deepseek-ai/dsh-subagent-claude-code')
  const sawUninstalling: boolean[] = []
  const offWatch = controller.subscribe(() => {
    if (controller.getSnapshot().uninstalling.includes('@deepseek-ai/dsh-subagent-claude-code')) {
      sawUninstalling.push(true)
    }
  })
  await controller.confirmUninstallNow('@deepseek-ai/dsh-subagent-claude-code')
  offWatch()
  assert.equal(sawUninstalling.length > 0, true)
  assert.deepEqual(controller.getSnapshot().uninstalling, [])
  assert.equal(controller.getSnapshot().confirmingUninstall, null)
  assert.equal(controller.getSnapshot().notice?.kind, 'removed')

  controller.dispose()
})

test('createOfficialBundlesController guards update against busy installer, cancelled/overridden removal, and shows loading on error retry', async () => {
  let failList = true
  let removeApp: 'cancelled' | 'overridden' = 'cancelled'
  const removedNames: string[] = []
  const onDemand: string[] = []
  const outdated = makeBundle({
    name: '@deepseek-ai/dsh-subagent-claude-code',
    availability: 'profile',
    installed: true,
    removable: true,
    enabled: true,
    version: '0.2.2-rc.4',
    installTarget: { spec: '@deepseek-ai/dsh-subagent-claude-code@0.2.2-rc.5', version: '0.2.2-rc.5' },
  })
  const controller = createOfficialBundlesController({
    host: () => ({
      async listBundles() {
        if (failList) return { ok: false, error: { message: 'offline' } }
        return { ok: true, value: [outdated] }
      },
      async setBundleEnabled() {
        return { ok: true, value: { application: 'applied' } }
      },
      async removeBundle(name) {
        removedNames.push(name)
        return { ok: true, value: { application: removeApp } }
      },
    }),
  })
  await controller.load()
  assert.equal(controller.getSnapshot().status, 'error')
  const statuses: string[] = []
  const off = controller.subscribe(() => { statuses.push(controller.getSnapshot().status) })
  failList = false
  await controller.refresh()
  off()
  assert.equal(statuses[0], 'loading')
  assert.equal(controller.getSnapshot().status, 'ready')

  // Busy installer prevents removeBundle from running at all.
  await controller.update(outdated, bundle => onDemand.push(bundle.name), () => false)
  assert.deepEqual(removedNames, [])
  assert.deepEqual(onDemand, [])

  // Cancelled removal does not start reinstall.
  await controller.update(outdated, bundle => onDemand.push(bundle.name), () => true)
  assert.deepEqual(removedNames, ['@deepseek-ai/dsh-subagent-claude-code'])
  assert.deepEqual(onDemand, [])

  // Overridden removal surfaces notice and does not start reinstall.
  removeApp = 'overridden'
  await controller.update(outdated, bundle => onDemand.push(bundle.name), () => true)
  assert.equal(controller.getSnapshot().notice?.kind, 'overridden')
  assert.deepEqual(onDemand, [])

  controller.dispose()
})
