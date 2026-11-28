import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PluginUpdateResult, PluginVersion, PluginVersionList } from '@deepseek-ai/dsh-api-remotes/client'
import { createClientCatalogCache } from '../src/client/catalogCache.ts'
import { createDirectInstaller, type InstallHost } from '../src/client/directInstall.ts'
import { createPluginUpdater, type UpdateHost } from '../src/client/pluginUpdates.ts'
import { INITIAL_SEARCH_DOCK_STATE, stepSearchDock } from '../src/client/useSearchDock.ts'
import { classifyPendingSweep } from '../src/installed.ts'
import { createMarketAiToolDefinition, type HostPluginManagerUpdateFace } from '../src/aiTools.ts'
import { createMarketAiMcpToolDefinition, type MarketAiMcpToolDeps } from '../src/aiMcpTools.ts'
import { buildMarketSkillContent } from '../src/aiSkill.ts'
import type { MarketCatalog } from '../src/contract.ts'
import type { ManagedMcpInspection } from '../src/mcp.ts'

const ok = <T>(value: T) => ({ ok: true as const, value })

function makeCatalog(refreshedAt: string): MarketCatalog {
  return {
    items: [{
      fullName: 'owner/demo',
      owner: 'owner',
      name: 'demo',
      packageName: 'dsh-demo',
      url: 'https://github.com/owner/demo',
      description: 'Demo plugin',
      stars: 42,
      language: 'TypeScript',
      license: 'MIT',
      pushedAt: '2026-11-01T00:00:00.000Z',
      defaultBranch: 'main',
      category: 'tools',
      categoryZh: '工具',
      categoryEn: 'Tools',
      installStatus: 'command',
    }],
    categories: [{ key: 'tools', zh: '工具', en: 'Tools', count: 1 }],
    fetchedAt: refreshedAt,
    refreshedAt,
    scanned: 1,
  }
}

test('DirectInstaller exposes recovering state, avoids dirty frames on start, and does not strand queue when cancel is refused', async () => {
  // 1. Recovering flag is observable while waitForInstall is in flight.
  let resolveWait!: (value: { ok: true; value: { application: 'applied' } }) => void
  const recoveringInstaller = createDirectInstaller(() => ({
    inspect: async () => ok({ status: 'accepted', registry: null }),
    installBundle: async () => { throw new Error('Network dropped') },
    cancelInstall: async () => ok({ status: 'cancelled' }),
    waitForInstall: () => new Promise(resolve => { resolveWait = resolve }),
  }) as InstallHost)

  await recoveringInstaller.start('demo@1.0.0')
  assert.equal(recoveringInstaller.getSnapshot().phase, 'unknown')
  assert.equal(recoveringInstaller.getSnapshot().recovering, false)

  const recovery = recoveringInstaller.recover()
  assert.equal(recoveringInstaller.getSnapshot().recovering, true)
  resolveWait(ok({ application: 'applied' }))
  await recovery
  assert.equal(recoveringInstaller.getSnapshot().phase, 'done')
  assert.equal(recoveringInstaller.getSnapshot().recovering, false)

  // 2. Starting a new run after done emits no intermediate frame with stale phase + empty spec.
  const frames: Array<{ phase: string; spec: string }> = []
  recoveringInstaller.subscribe(() => {
    const snap = recoveringInstaller.getSnapshot()
    frames.push({ phase: snap.phase, spec: snap.spec })
  })
  const simpleInstaller = createDirectInstaller(() => ({
    inspect: async () => ok({ status: 'accepted', registry: null }),
    installBundle: async () => ok({ application: 'applied' }),
    cancelInstall: async () => ok({ status: 'cancelled' }),
    waitForInstall: async () => ok(null),
  }) as InstallHost)
  await simpleInstaller.start('first@1.0.0')
  const observed: Array<{ phase: string; spec: string }> = []
  simpleInstaller.subscribe(() => {
    const snap = simpleInstaller.getSnapshot()
    observed.push({ phase: snap.phase, spec: snap.spec })
  })
  await simpleInstaller.start(['second@1.0.0', 'third@1.0.0'])
  assert.equal(observed[0]?.phase, 'checking')
  assert.equal(observed[0]?.spec, 'second@1.0.0')

  // 3. When cancelInstall is refused by the host, stopped resets so subsequent queue items still install.
  let finishFirst!: (value: { ok: true; value: { application: 'applied' } }) => void
  const calls: string[] = []
  const cancelRefusedInstaller = createDirectInstaller(() => ({
    inspect: async () => ok({ status: 'accepted', registry: null }),
    installBundle: (spec: string) => {
      calls.push(spec)
      if (spec === 'one@1.0.0') return new Promise(resolve => { finishFirst = resolve })
      return Promise.resolve(ok({ application: 'applied' as const }))
    },
    cancelInstall: async () => ({ ok: false as const, error: { message: 'too-late' } }),
    waitForInstall: async () => ok(null),
  }) as InstallHost)

  const pending = cancelRefusedInstaller.start(['one@1.0.0', 'two@1.0.0'])
  await new Promise(resolve => setImmediate(resolve))
  await cancelRefusedInstaller.cancel()
  assert.equal(cancelRefusedInstaller.getSnapshot().phase, 'installing')
  finishFirst(ok({ application: 'applied' }))
  await pending
  assert.deepEqual(calls, ['one@1.0.0', 'two@1.0.0'])
  assert.equal(cancelRefusedInstaller.getSnapshot().phase, 'done')

  // 4. Calling start() while cancelling is ignored by busy() and does not clear stopped.
  let finishCancelled!: (value: { ok: true; value: { application: 'applied' } }) => void
  const cancelCalls: string[] = []
  const cancelGuardInstaller = createDirectInstaller(() => ({
    inspect: async () => ok({ status: 'accepted', registry: null }),
    installBundle: (spec: string) => {
      cancelCalls.push(spec)
      if (spec === 'first@1.0.0') return new Promise(resolve => { finishCancelled = resolve })
      return Promise.resolve(ok({ application: 'applied' as const }))
    },
    cancelInstall: async () => ok({ status: 'cancelled' }),
    waitForInstall: async () => ok(null),
  }) as InstallHost)

  const cancellingRun = cancelGuardInstaller.start(['first@1.0.0', 'second@1.0.0'])
  await new Promise(resolve => setImmediate(resolve))
  await cancelGuardInstaller.cancel()
  assert.equal(cancelGuardInstaller.getSnapshot().phase, 'cancelling')
  await cancelGuardInstaller.start(['other@1.0.0'])
  finishCancelled(ok({ application: 'applied' }))
  await cancellingRun
  assert.deepEqual(cancelCalls, ['first@1.0.0'])
})

test('PluginUpdater close and startBatch clear stale single-update fields completely', async () => {
  const outcome: PluginUpdateResult = {
    from: '1.0.0',
    to: '2.0.0',
    step: 'install',
    result: { changed: true, application: 'applied', stage: 'install', target: 'demo@2.0.0' },
  }
  const version = (number: string): PluginVersion => ({ version: number, tags: [], prerelease: false, bundle: true })
  const listed = (versions: PluginVersion[]): PluginVersionList => ({
    status: 'listed',
    installed: '1.0.0',
    registry: 'https://registry.npmjs.org/',
    attempts: [],
    versions,
    omitted: 0,
  })
  const updater = createPluginUpdater(() => ({
    listBundles: async () => ok([{ name: 'demo', version: '1.0.0', installed: true, update: 'registry' }]),
    listVersions: async () => ok(listed([version('2.0.0')])),
    updateBundle: async () => ok(outcome),
  }) as UpdateHost, () => undefined)

  await updater.check('demo')
  assert.equal(updater.getSnapshot().phase, 'ready')
  assert.equal(updater.getSnapshot().packageName, 'demo')
  assert.equal(updater.getSnapshot().choices.length, 1)

  updater.close()
  const afterClose = updater.getSnapshot()
  assert.equal(afterClose.phase, 'idle')
  assert.equal(afterClose.packageName, '')
  assert.equal(afterClose.installed, '')
  assert.equal(afterClose.choices.length, 0)
  assert.equal(afterClose.selected, '')
  assert.equal(afterClose.result, undefined)
  assert.equal(afterClose.step, undefined)
})

test('ClientCatalogCache explicit state transitions handle fresh reuse, invalidation, and stale error fallback', async () => {
  let clock = Date.parse('2026-11-22T00:00:00.000Z')
  let calls = 0
  let shouldFail = false
  const cache = createClientCatalogCache(async () => {
    calls += 1
    if (shouldFail) throw new Error('offline')
    return { catalog: makeCatalog(new Date(clock).toISOString()), stale: false, error: '' }
  }, () => clock)

  assert.equal(cache.peek(), null)
  const first = await cache.load(false)
  assert.equal(first.stale, false)
  assert.equal(calls, 1)

  // Fresh cache hit does not re-fetch.
  clock += 1_000
  const second = await cache.load(false)
  assert.equal(second, first)
  assert.equal(calls, 1)

  // Invalidated cache preserves peeked snapshot and degrades to stale on network error.
  cache.invalidate()
  assert.equal(cache.peek(), first)
  shouldFail = true
  const degraded = await cache.load(false)
  assert.equal(calls, 2)
  assert.equal(degraded.stale, true)
  assert.equal(degraded.catalog, first.catalog)
  assert.equal(degraded.error, 'offline')
})

test('dsh_market_pro emits explicit machine-readable status, outcome, and nextStep for Agent workflows', async () => {
  const catalog = makeCatalog('2026-11-22T00:00:00.000Z')
  let updateApp: 'applied' | 'restart-required' | 'failed' = 'failed'
  const manager: HostPluginManagerUpdateFace = {
    listBundles: async () => [
      { name: 'alpha', version: '1.0.0', installed: true, update: 'registry' },
    ],
    listVersions: async () => ({
      status: 'listed',
      installed: '1.0.0',
      registry: 'https://registry.npmjs.org/',
      versions: [{ version: '2.0.0', prerelease: false, bundle: true }],
    }),
    updateBundle: async (name, to) => ({
      from: '1.0.0',
      to,
      step: 'install',
      result: { changed: updateApp !== 'failed', application: updateApp, ...(updateApp === 'failed' ? { error: { code: 'boom' } } : {}) },
    }),
  }

  const tool = createMarketAiToolDefinition({
    profile: 'web',
    readSettings: () => ({ enabled: true, aiAssistantEnabled: true }),
    readCatalog: async () => ({ catalog, stale: false, error: '' }),
    listInstalled: async () => ({ packages: [], profile: 'web', error: '' }),
    readMcp: () => ({ managerEntry: null, managerActive: false, unmanaged: [], tools: [], toolsError: '' }),
    pluginManager: () => manager,
    getApprover: () => ({ request: async () => 'allowed-once' }),
  })
  const exec = (args: unknown) => (tool.execute as (a: unknown, e?: unknown) => Promise<string>)(args, { agent: {} })

  const checked = JSON.parse(await exec({ action: 'check_updates' }))
  assert.equal(checked.status, 'updates-available')
  assert.match(checked.nextStep, /update_plugins/)

  // All failed must explicitly report outcome: 'failed' (never mislead the agent via updated: true alone).
  const allFailed = JSON.parse(await exec({ action: 'update_plugins', updates: [{ packageName: 'alpha', version: '2.0.0' }] }))
  assert.equal(allFailed.outcome, 'failed')
  assert.equal(allFailed.updated, true)
  assert.match(allFailed.nextStep, /no plugins were updated/i)

  updateApp = 'restart-required'
  const needsRestart = JSON.parse(await exec({ action: 'update_plugins', updates: [{ packageName: 'alpha', version: '2.0.0' }] }))
  assert.equal(needsRestart.outcome, 'restart-required')
  assert.equal(needsRestart.restartRequired, true)
  assert.match(needsRestart.nextStep, /restart/i)

  updateApp = 'applied'
  const applied = JSON.parse(await exec({ action: 'update_plugins', updates: [{ packageName: 'alpha', version: '2.0.0' }] }))
  assert.equal(applied.outcome, 'applied')
  assert.equal(applied.restartRequired, false)

  // Partial check failure alongside available updates mentions errors in nextStep.
  const partialManager: HostPluginManagerUpdateFace = {
    listBundles: async () => [
      { name: 'alpha', version: '1.0.0', installed: true, update: 'registry' },
      { name: 'broken', version: '1.0.0', installed: true, update: 'registry' },
    ],
    listVersions: async (name) => name === 'alpha'
      ? {
          status: 'listed',
          installed: '1.0.0',
          registry: 'https://registry.npmjs.org/',
          versions: [{ version: '2.0.0', prerelease: false, bundle: true }],
        }
      : { status: 'refused', reason: 'registry timeout' },
    updateBundle: manager.updateBundle,
  }
  const partialTool = createMarketAiToolDefinition({
    profile: 'web',
    readSettings: () => ({ enabled: true, aiAssistantEnabled: true }),
    readCatalog: async () => ({ catalog, stale: false, error: '' }),
    listInstalled: async () => ({ packages: [], profile: 'web', error: '' }),
    readMcp: () => ({ managerEntry: null, managerActive: false, unmanaged: [], tools: [], toolsError: '' }),
    pluginManager: () => partialManager,
    getApprover: () => ({ request: async () => 'allowed-once' }),
  })
  const partialChecked = JSON.parse(await (partialTool.execute as (a: unknown) => Promise<string>)({ action: 'check_updates' }))
  assert.equal(partialChecked.status, 'updates-available')
  assert.equal(partialChecked.errors.length, 1)
  assert.match(partialChecked.nextStep, /errors/)

  // Detail single and batch return explicit status.
  const detailFound = JSON.parse(await exec({ action: 'detail', target: 'dsh-demo' }))
  assert.equal(detailFound.status, 'found')
  const detailMissing = JSON.parse(await exec({ action: 'detail', target: 'nonexistent-pkg' }))
  assert.equal(detailMissing.status, 'not-found')
  const detailPartial = JSON.parse(await exec({ action: 'detail', targets: ['dsh-demo', 'nonexistent-pkg'] }))
  assert.equal(detailPartial.status, 'partial')
})

test('dsh_mcp_pro emits explicit outcome and nextStep across install and toggle actions', async () => {
  const inspection: ManagedMcpInspection = {
    managerEntry: 'mcp-manager',
    managerActive: true,
    settingsWritable: true,
    settingsRevision: 1,
    managed: [{
      name: 'context7',
      transport: 'streamable-http',
      target: 'https://mcp.context7.com/mcp',
      enabled: false,
      state: 'disabled',
      toolCount: 0,
      credentialRefs: [],
      identityKey: 'http:https://mcp.context7.com/mcp',
    }],
    unmanaged: [],
    tools: [],
    takenNames: ['context7'],
  }
  const deps: MarketAiMcpToolDeps = {
    profile: 'web',
    readSettings: () => ({ enabled: true, aiAssistantEnabled: true }),
    inspectMcp: () => inspection,
    findExistingFeaturedMcp: (_input, current) => current.managed[0],
    installMcp: async (plan) => ({
      name: plan.name,
      source: plan.source,
      transport: plan.transport,
      preview: plan.preview,
      enabled: plan.enabled,
      connection: { state: 'connected', toolCount: 3 },
      credentialRefs: [],
      configuredCredentials: [],
      missingCredentials: [],
    }),
    setMcpEnabled: async (name, enabled) => ({ name, enabled }),
    getApprover: () => ({ request: async () => 'allowed-once' }),
  }
  const tool = createMarketAiMcpToolDefinition(deps)
  const exec = (args: unknown) => (tool.execute as (a: unknown, e?: unknown) => Promise<string>)(args, { agent: {} })

  const toggleNeeded = JSON.parse(await exec({ action: 'install_featured', featuredId: 'context7', enabled: true }))
  assert.equal(toggleNeeded.outcome, 'already-configured-toggle-needed')

  const installedCustom = JSON.parse(await exec({
    action: 'install_custom',
    name: 'my-http',
    transport: 'streamable-http',
    url: 'https://example.com/mcp',
  }))
  assert.equal(installedCustom.outcome, 'installed-connected')

  const enabled = JSON.parse(await exec({ action: 'set_enabled', name: 'context7', enabled: true }))
  assert.equal(enabled.outcome, 'enabled')
  assert.equal(enabled.updated, true)
  assert.match(enabled.nextStep, /list_configured/)
})

test('built-in unified market-pro skill contains no stray blank-line runs and defers state branching to tool guidance', () => {
  const marketSkill = buildMarketSkillContent('web')
  assert.equal(marketSkill.includes('\n\n\n'), false)
  // Per-outcome handling lives in each tool's own `<tool_guidance>`, so the skill
  // only tells the Agent to branch on it instead of repeating every state.
  assert.match(marketSkill, /`outcome` \/ `status`/)
  assert.match(marketSkill, /<tool_guidance>/)
  assert.doesNotMatch(marketSkill, /updates-available|already-configured-toggle-needed/)
  assert.match(marketSkill, /set_enabled/)
  assert.match(marketSkill, /dsh_skills_pro/)
})

test('classifyPendingSweep explicitly distinguishes completed, legacy, held, and orphaned uninstall records', () => {
  const manifestWithDep = { dependencies: { demo: '^1.0.0' }, dsh: { profile: { bundles: [] } } }
  const manifestWithBundle = { dependencies: {}, dsh: { profile: { bundles: ['demo'] } } }
  const cleanManifest = { dependencies: {}, dsh: { profile: { bundles: [] } } }

  assert.equal(classifyPendingSweep({ packageName: 'demo', completed: true }, manifestWithDep), 'release')
  assert.equal(classifyPendingSweep({ packageName: 'demo', completed: undefined }, manifestWithDep), 'release')
  assert.equal(classifyPendingSweep({ packageName: 'demo', completed: false }, manifestWithDep), 'hold')
  assert.equal(classifyPendingSweep({ packageName: 'demo', completed: false }, manifestWithBundle), 'hold')
  assert.equal(classifyPendingSweep({ packageName: 'demo', completed: false }, cleanManifest), 'release')
})

test('stepSearchDock enforces hysteresis, focus lock, viewport-height stability, and narrow-width undocking', () => {
  let state = INITIAL_SEARCH_DOCK_STATE

  // Small scroll (< 40px) keeps bar expanded.
  state = stepSearchDock(state, { type: 'scroll', scrollTop: 30, clientHeight: 600, rootWidth: 800, focusInside: false })
  assert.equal(state.mode, 'expanded')

  // Crossing +40px threshold compacts the bar.
  state = stepSearchDock(state, { type: 'scroll', scrollTop: 60, clientHeight: 600, rootWidth: 800, focusInside: false })
  assert.equal(state.mode, 'compact')

  // Viewport height shift alone does not flip state.
  state = stepSearchDock(state, { type: 'scroll', scrollTop: 10, clientHeight: 500, rootWidth: 800, focusInside: false })
  assert.equal(state.mode, 'compact')

  // Focus inside search box prevents undocking on narrow resize or scroll-up.
  state = stepSearchDock(state, { type: 'resize', rootWidth: 360, focusInside: true })
  assert.equal(state.mode, 'compact')
  state = stepSearchDock(state, { type: 'scroll', scrollTop: 0, clientHeight: 500, rootWidth: 800, focusInside: true })
  assert.equal(state.mode, 'compact')

  // Narrow resize without focus expands immediately.
  state = stepSearchDock(state, { type: 'resize', rootWidth: 360, focusInside: false })
  assert.equal(state.mode, 'expanded')

  // Scroll down past threshold then scroll up > 16px expands smoothly.
  state = stepSearchDock(state, { type: 'scroll', scrollTop: 80, clientHeight: 500, rootWidth: 800, focusInside: false })
  assert.equal(state.mode, 'compact')
  state = stepSearchDock(state, { type: 'scroll', scrollTop: 70, clientHeight: 500, rootWidth: 800, focusInside: false })
  assert.equal(state.mode, 'compact')
  state = stepSearchDock(state, { type: 'scroll', scrollTop: 50, clientHeight: 500, rootWidth: 800, focusInside: false })
  assert.equal(state.mode, 'expanded')
})
