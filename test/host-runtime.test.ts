/** Exercise the built plugin against the host version pinned in devDependencies (the active verification lane). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { boot, getDshRuntimeVersion, initProfile, readProfilePatches } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Settings from '@deepseek-ai/dsh-settings'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import * as Market from '../lib/index.js'
import { initialDomainState } from '../src/store.ts'
import { SAFE_MARKET_INVOCATIONS } from '../src/contract.ts'

test('built market boots, registers RPCs, and persists settings and plugin toggles across restarts', async () => {
  // The lane under test is whichever host version the manifest pins in devDependencies.
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { devDependencies: Record<string, string> }
  assert.equal(getDshRuntimeVersion(), manifest.devDependencies['@deepseek-ai/dsh-app-boot'])
  const home = await realpath(await mkdtemp(join(tmpdir(), 'safe-market-host-')))
  const previousHome = process.env.DSH_HOME
  const previousTelemetry = process.env.DSH_MARKET_TELEMETRY
  process.env.DSH_HOME = home
  process.env.DSH_MARKET_TELEMETRY = '0'
  const contexts = []
  try {
    // Application-owned directory: neither config nor DSH_HOME may redirect the manager.
    const dir = join(home, 'application-profile', 'test')
    initProfile(dir, ['test-market-bundle', 'test-user-bundle'])
    const manifestPath = join(dir, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.dependencies['test-user-bundle'] = '1.0.0'
    await writeFile(manifestPath, JSON.stringify(manifest))
    const userBundle = join(dir, 'node_modules', 'test-user-bundle')
    await mkdir(userBundle, { recursive: true })
    await writeFile(join(userBundle, 'package.json'), JSON.stringify({
      name: 'test-user-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } },
    }))
    await writeFile(join(userBundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
      { id: 'test-user-entry', name: 'cordis:demo' },
    ] }]))
    const bundle = join(dir, 'node_modules', 'test-market-bundle')
    await mkdir(bundle, { recursive: true })
    await writeFile(join(home, 'package.json'), '{"name":"market-test"}\n')
    await writeFile(join(bundle, 'package.json'), JSON.stringify({
      name: 'test-market-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } },
    }))
    await writeFile(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
      { id: 'config-editor', name: 'cordis:editor' },
      { id: 'settings', name: 'cordis:settings' },
      { id: 'skills', name: 'cordis:skills' },
      { id: 'typert', name: 'cordis:typert' },
      { id: 'renamed-market', name: 'cordis:market', config: { profile: 'web' } },
    ] }]))
    await writeFile(join(dir, 'cordis.yml'), '[]\n')
    const profile = {
      name: 'test', startedBundles: ['test-market-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'),
      // Keep both `overlays` (0.2.2-rc.5) and `overlayPaths` (0.2.3-alpha.3+) so both host lanes pass.
      installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], overlayPaths: [], telemetryDisabledEnv: undefined,
    }
    const start = async () => {
      const mountedTools = new Set<string>()
      const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), ctx => {
        ctx.provide('profileContext', profile)
        ctx.provide('appReady', { onReady: listener => { listener(); return () => {} } })
        ctx.provide('tools', {
          register(definition: { name?: string }) {
            const name = String(definition.name ?? '')
            mountedTools.add(name)
            return () => { mountedTools.delete(name) }
          },
        })
        ctx.provide('storageDomain', { open: async () => ({
          global: { get: () => initialDomainState, set: async () => {} }, close: async () => {},
        }) })
        Object.assign(ctx.loader.builtins, {
          editor: ConfigEditor, settings: Settings, skills: SkillRegistry, typert: TypertRegistry, market: Market,
          demo: ctx => { ctx.provide('marketTestDemo', true) },
        })
      })
      contexts.push(ctx)
      await ctx.loader.await()
      assert.ok(ctx.get('dshMarketPro'), 'the built body must mount under the real Loader')
      return Object.assign(ctx, { mountedTools })
    }
    const first = await start()
    const market = first.get('dshMarketPro')
    assert.deepEqual(market.getSettings(), { enabled: true, aiAssistantEnabled: true, telemetryEnabled: true })
    assert.equal((await first.skills.list()).some(skill => skill.name === 'market-pro'), true)
    assert.deepEqual([...first.mountedTools].sort(), ['dsh_market_pro', 'dsh_mcp_pro', 'dsh_skills_pro'])
    assert.equal(market.describe().profile, 'test')
    assert.equal(market.describe().telemetrySuppressedByEnv, true)
    assert.equal(first.settings.describe().find(row => row.ns === 'renamed-market').autoGenerate, false)
    for (const descriptor of SAFE_MARKET_INVOCATIONS) {
      const registered = first.typert.local.get(`dshMarketPro/${descriptor.method}`)
      assert.ok(registered, `${descriptor.method} must be registered`)
      const codecs = [...registered.parameters.map(param => param.codec), registered.result]
      for (const codec of codecs) assert.equal(typeof codec.create().safeParse, 'function')
    }
    // Either previous package may still be present during migration. Withdrawing
    // its strict endpoints must leave the new market callable.
    for (const [packageName, namespace] of [
      ['dsh-desktop-safe-market', 'safeMarket'],
      ['safer-dsh-market', 'saferMarket'],
    ]) {
      const legacyInvocations = SAFE_MARKET_INVOCATIONS.map(descriptor => ({
        ...descriptor,
        id: descriptor.id.replace('dsh-market-pro#dshMarketPro/', `${packageName}#${namespace}/`),
        service: namespace, namespace,
      }))
      const legacy = first.typert.register({
        package: packageName, face: 'host', schemas: [],
        model: { services: [], events: [], objects: [] }, invocations: legacyInvocations,
      })
      assert.ok(first.typert.local.get(`${namespace}/updateSettings`))
      await legacy()
      assert.equal(first.typert.local.get(`${namespace}/updateSettings`), undefined)
      assert.ok(first.typert.local.hasSeen(`${namespace}/updateSettings`))
      assert.ok(first.typert.local.get('dshMarketPro/updateSettings'), 'legacy teardown must preserve the new strict endpoint')
      assert.equal(first.get('dshMarketPro').describe().profile, 'test')
    }
    const installed = await market.listInstalled()
    assert.equal(installed.error, '')
    assert.equal(installed.profile, 'test')
    assert.equal(installed.packages.length, 1)
    assert.equal(installed.packages[0].packageName, 'test-user-bundle')
    assert.equal(installed.packages[0].entries[0].phase, 'active')
    assert.equal(first.get('marketTestDemo'), true)
    const disabled = await market.setInstalledEnabled({ packageName: 'test-user-bundle', enabled: false })
    assert.equal(disabled.error, '')
    assert.equal(disabled.packages[0].enabled, false)
    assert.equal(first.get('marketTestDemo'), undefined)
    await market.updateSettings({ field: 'enabled', value: false })
    await assert.rejects(market.getCatalog(false, new AbortController().signal), /disabled/)
    assert.deepEqual(await market.updateSettings({ field: 'enabled', value: true }), { enabled: true, aiAssistantEnabled: true, telemetryEnabled: true })
    assert.deepEqual(market.getSettings(), { enabled: true, aiAssistantEnabled: true, telemetryEnabled: true }, 'the original service must observe live edits')
    assert.deepEqual(await market.updateSettings({ field: 'aiAssistantEnabled', value: false }), { enabled: true, aiAssistantEnabled: false, telemetryEnabled: true })
    assert.deepEqual(await market.updateSettings({ field: 'telemetryEnabled', value: false }), { enabled: true, aiAssistantEnabled: false, telemetryEnabled: false })
    assert.equal((await first.skills.list()).some(skill => skill.name === 'market-pro'), false, 'disabling AI assistant withdraws the built-in skill immediately')
    assert.deepEqual([...first.mountedTools], [], 'disabling AI assistant withdraws all three AI tools immediately')
    assert.match(await readFile(profile.patchPath, 'utf8'), /enabled: true/)
    await first.fiber.dispose()
    const second = await start()
    assert.deepEqual(second.get('dshMarketPro').getSettings(), { enabled: true, aiAssistantEnabled: false, telemetryEnabled: false })
    assert.equal((await second.skills.list()).some(skill => skill.name === 'market-pro'), false)
    assert.deepEqual([...second.mountedTools], [])
    assert.equal(second.get('marketTestDemo'), undefined, 'the user patch must keep the plugin disabled after restart')
    const enabled = await second.get('dshMarketPro').setInstalledEnabled({ packageName: 'test-user-bundle', enabled: true })
    assert.equal(enabled.error, '')
    assert.equal(enabled.packages[0].entries[0].phase, 'active')
    assert.equal(second.get('marketTestDemo'), true)
    await second.get('dshMarketPro').updateSettings({ field: 'enabled', value: false })
    await second.get('dshMarketPro').updateSettings({ field: 'aiAssistantEnabled', value: true })
    await second.get('dshMarketPro').updateSettings({ field: 'telemetryEnabled', value: true })
    assert.deepEqual(second.get('dshMarketPro').getSettings(), { enabled: false, aiAssistantEnabled: true, telemetryEnabled: true })
    assert.equal((await second.skills.list()).some(skill => skill.name === 'market-pro'), true)
    assert.deepEqual([...second.mountedTools].sort(), ['dsh_market_pro', 'dsh_mcp_pro', 'dsh_skills_pro'])
    await second.fiber.dispose()
    const third = await start()
    assert.equal(third.get('marketTestDemo'), true, 'the plugin must stay enabled after restart')
    assert.deepEqual(third.get('dshMarketPro').getSettings(), { enabled: false, aiAssistantEnabled: true, telemetryEnabled: true })
  } finally {
    for (const ctx of contexts.reverse()) await ctx.fiber.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    if (previousTelemetry === undefined) delete process.env.DSH_MARKET_TELEMETRY
    else process.env.DSH_MARKET_TELEMETRY = previousTelemetry
    await rm(home, { recursive: true, force: true })
  }
})

test('disabling telemetry clears persisted telemetryId immediately, across the domain-open window, and on boot', async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'safe-market-telemetry-clear-')))
  const previousHome = process.env.DSH_HOME
  const previousTelemetry = process.env.DSH_MARKET_TELEMETRY
  process.env.DSH_HOME = home
  process.env.DSH_MARKET_TELEMETRY = '0'
  const contexts: Array<{ fiber: { dispose(): Promise<void> } }> = []
  try {
    const dir = join(home, 'application-profile', 'test')
    initProfile(dir, ['test-market-bundle'])
    const bundle = join(dir, 'node_modules', 'test-market-bundle')
    await mkdir(bundle, { recursive: true })
    await writeFile(join(home, 'package.json'), '{"name":"market-test"}\n')
    await writeFile(join(bundle, 'package.json'), JSON.stringify({
      name: 'test-market-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } },
    }))
    await writeFile(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
      { id: 'config-editor', name: 'cordis:editor' },
      { id: 'settings', name: 'cordis:settings' },
      { id: 'skills', name: 'cordis:skills' },
      { id: 'typert', name: 'cordis:typert' },
      { id: 'market', name: 'cordis:market', config: { profile: 'web' } },
    ] }]))
    await writeFile(join(dir, 'cordis.yml'), '[]\n')
    const profile = {
      name: 'test', startedBundles: ['test-market-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'),
      // Keep both `overlays` (0.2.2-rc.5) and `overlayPaths` (0.2.3-alpha.3+) so both host lanes pass.
      installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], overlayPaths: [], telemetryDisabledEnv: undefined,
    }

    const seededDomain = () => ({
      ...initialDomainState,
      telemetryId: '550e8400-e29b-41d4-a716-446655440000',
      telemetryLastPingDay: '2026-11-25',
      telemetryLastPingKind: 'desktop',
    })

    const startWithDomain = async (openFn: () => Promise<{ global: { get: () => typeof initialDomainState; set: (next: typeof initialDomainState) => Promise<void> }; close: () => Promise<void> }>) => {
      const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), ctx => {
        ctx.provide('profileContext', profile)
        ctx.provide('appReady', { onReady: listener => { listener(); return () => {} } })
        ctx.provide('tools', { register: () => () => {} })
        ctx.provide('storageDomain', { open: openFn })
        Object.assign(ctx.loader.builtins, {
          editor: ConfigEditor, settings: Settings, skills: SkillRegistry, typert: TypertRegistry, market: Market,
        })
      })
      contexts.push(ctx)
      await ctx.loader.await()
      return ctx
    }

    // 1. Immediate opt-out clear on an already-open durable domain.
    let diskState = seededDomain()
    const writes1: Array<typeof initialDomainState> = []
    const first = await startWithDomain(async () => ({
      global: {
        get: () => diskState,
        set: async (next) => { diskState = next; writes1.push(next) },
      },
      close: async () => {},
    }))
    await new Promise(resolve => setTimeout(resolve, 20))
    const market1 = first.get('dshMarketPro')
    assert.deepEqual(await market1.updateSettings({ field: 'telemetryEnabled', value: false }), {
      enabled: true, aiAssistantEnabled: true, telemetryEnabled: false,
    })
    assert.ok(writes1.length >= 1)
    assert.equal(diskState.telemetryId, '')
    assert.equal(diskState.telemetryLastPingDay, '')
    assert.equal(diskState.telemetryLastPingKind, '')
    await first.fiber.dispose()

    // 2. Retroactive boot clear when starting with telemetryEnabled=false and stale disk telemetry fields.
    diskState = seededDomain()
    const writes2: Array<typeof initialDomainState> = []
    const second = await startWithDomain(async () => ({
      global: {
        get: () => diskState,
        set: async (next) => { diskState = next; writes2.push(next) },
      },
      close: async () => {},
    }))
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.ok(writes2.length >= 1)
    assert.equal(diskState.telemetryId, '')
    assert.equal(diskState.telemetryLastPingDay, '')
    assert.equal(diskState.telemetryLastPingKind, '')

    // Re-enable telemetry for the opening-window test.
    await second.get('dshMarketPro').updateSettings({ field: 'telemetryEnabled', value: true })
    await second.fiber.dispose()

    // 3. Opting out while storageDomain.open is still pending must not let adoptDomainState resurrect stale disk ID.
    diskState = seededDomain()
    const writes3: Array<typeof initialDomainState> = []
    let releaseOpen!: () => void
    const openGate = new Promise<void>(resolve => { releaseOpen = resolve })
    const third = await startWithDomain(async () => {
      await openGate
      return {
        global: {
          get: () => diskState,
          set: async (next) => { diskState = next; writes3.push(next) },
        },
        close: async () => {},
      }
    })
    await third.get('dshMarketPro').updateSettings({ field: 'telemetryEnabled', value: false })
    releaseOpen()
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.ok(writes3.length >= 1)
    assert.equal(diskState.telemetryId, '')
    assert.equal(diskState.telemetryLastPingDay, '')
    assert.equal(diskState.telemetryLastPingKind, '')
  } finally {
    for (const ctx of contexts.reverse()) await ctx.fiber.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    if (previousTelemetry === undefined) delete process.env.DSH_MARKET_TELEMETRY
    else process.env.DSH_MARKET_TELEMETRY = previousTelemetry
    await rm(home, { recursive: true, force: true })
  }
})
