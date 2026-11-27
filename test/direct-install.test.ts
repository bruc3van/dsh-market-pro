import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createDirectInstaller,
  installRegistryLabel,
  isManualInstallInputValid,
  isValidCustomRegistryUrl,
  offeredInstallRegistries,
  reconcileSelectedTargets,
  shouldRefreshInstalledAfterDirect,
  type InstallHost,
} from '../src/client/directInstall.ts'
import { ownedIndexOf } from '../src/client/owned.ts'
import { parseInstallInfo, isInstallSpec } from '../src/installInfo.ts'
import { deriveMarket } from '../src/catalog.ts'
import { marketCatalogSchema, type MarketInstalledPackage } from '../src/contract.ts'

function host(overrides: Partial<InstallHost> = {}): InstallHost {
  return {
    inspect: async () => ({ ok: true, value: { status: 'accepted', kind: 'registry', bundle: true, registry: null } }),
    installBundle: async () => ({ ok: true, value: { application: 'applied' } }),
    cancelInstall: async () => ({ ok: true, value: { status: 'cancelled' } }),
    waitForInstall: async () => ({ ok: true, value: { application: 'restart-required' } }),
    ...overrides,
  } as InstallHost
}

test('compatibility refusals show new engines requirements and legacy peer ranges', async () => {
  for (const incompatible of [
    { name: 'demo', version: '1.0.0', requirements: { 'engines.dsh': '>=0.3.0' } },
    { name: 'demo', version: '1.0.0', peers: { '@deepseek-ai/dsh-settings': '>=0.3.0' } },
  ]) {
    const installer = createDirectInstaller(() => host({ installBundle: async () => ({
      ok: true, value: { application: 'failed', error: { code: 'incompatible-version', incompatible: [incompatible] } },
    }) }))
    await installer.start('demo@1.0.0')
    assert.equal(installer.getSnapshot().phase, 'failed')
    assert.match(installer.getSnapshot().message, /demo@1.0.0/)
    assert.match(installer.getSnapshot().message, />=0.3.0/)
    assert.doesNotMatch(installer.getSnapshot().message, /undefined/)
  }
})

test('v2 feed preserves targets and tasks on the wire without executable commands', () => {
  const catalog = deriveMarket({ schema_version: 2, entries: [{ full_name: 'owner/demo', category: 'tools', packages: {
    mode: 'command', targets: [{ install: '@owner/demo@1.2.3', profile: 'web', command: 'rm -rf /', note: 'Account required' }], tasks: ['Word'], requirements: ['Node 24'],
  } }] }, 20)
  const row = marketCatalogSchema.parse(catalog).items[0]!
  assert.equal(row.installInfo?.targets[0]?.install, '@owner/demo@1.2.3')
  assert.deepEqual(row.installInfo?.tasks, ['Word'])
  assert.ok(!JSON.stringify(row).includes('rm -rf'))
})

test('the current upstream Gitee target survives the catalog and wire validation', () => {
  const spec = 'https://gitee.com/HubaKing/dsh-community-plugins.git'
  const catalog = deriveMarket({ schema_version: 2, entries: [{
    full_name: 'HubaKing/dsh-community-plugins', category: 'tools',
    packages: { mode: 'command', targets: [{ profile: 'web', install: spec }] },
  }] }, 20)
  assert.equal(marketCatalogSchema.parse(catalog).items[0]?.installInfo?.targets[0]?.install, spec)
  for (const invalid of ['http://gitee.com/a/b.git', 'https://gitee.com.evil.example/a/b.git', 'https://user:secret@gitee.com/a/b.git']) {
    assert.equal(isInstallSpec(invalid), false, invalid)
  }
})
test('feed rejects shell commands, flags, local paths and credential URLs', () => {
  for (const value of ['npm install demo', '--help', '/tmp/demo', 'file:../demo', 'demo;id', 'demo@$(id)', 'https://user:pass@github.com/a/b', 'https://github.com/a/b#path:/../escape', 'https://github.com/a/b#main&path:a/../b', 'https://github.com/a/b#../ref']) assert.equal(isInstallSpec(value), false, value)
  for (const value of ['demo', '@owner/demo@1.2.3', 'demo@latest', 'git+https://github.com/a/b.git', 'https://github.com/a/b#main', 'https://github.com/a/b#main&path:/packages/plugin', 'https://codeload.github.com/a/b/tar.gz/refs/heads/main', 'https://raw.githubusercontent.com/a/b/main/dist/plugin.tgz', 'https://github.com/a/b/releases/download/v1/demo.tgz']) assert.equal(isInstallSpec(value), true, value)
  assert.equal(parseInstallInfo({ mode: 'manual', manual_instructions: 'Read README', targets: [{ install: 'demo' }] })?.mode, 'manual')
})
test('refused inspection never installs; missing host is an explicit failure', async () => {
  let calls = 0
  const installer = createDirectInstaller(() => host({ inspect: async () => ({ ok: true, value: { status: 'refused', problem: 'not-a-bundle', reason: 'No bundle' } }), installBundle: async () => { calls++; return { ok: true, value: { application: 'applied' } } } }))
  await installer.start('demo')
  assert.equal(calls, 0)
  assert.equal(installer.getSnapshot().phase, 'failed')
  const missing = createDirectInstaller(() => undefined)
  await missing.start('demo')
  assert.equal(missing.getSnapshot().phase, 'failed')
})
test('inspection supplies both Remote arguments before installing and enabling the selected target', async () => {
  for (const spec of ['https://github.com/vlln/whale-girl#main', 'whale-girl@0.1.0', 'https://gitee.com/HubaKing/dsh-community-plugins.git']) {
    const calls: unknown[] = []
    const registry = 'https://registry.npmjs.org/'
    const installer = createDirectInstaller(() => host({
      inspect: async (...args) => {
        // Model the strict Remote arity check, which rejects omitted options.
        assert.equal(args.length, 2)
        assert.deepEqual(args, [spec, {}])
        calls.push('inspect')
        return { ok: true, value: { status: 'accepted', registry } }
      },
      installBundle: async (target, options) => {
        assert.equal(target, spec)
        assert.equal(options?.registry, registry)
        assert.equal(options?.enabled, true)
        assert.ok(options?.requestId)
        calls.push('install')
        return { ok: true, value: { application: 'restart-required' } }
      },
    }))
    await installer.start(spec)
    assert.deepEqual(calls, ['inspect', 'install'])
    assert.equal(installer.getSnapshot().phase, 'done')
    assert.equal(installer.getSnapshot().application, 'restart-required')
  }
})
test('install uses selected spec, host profile, and explicit script approval only', async () => {
  const calls: unknown[] = []
  const installer = createDirectInstaller(() => host({ installBundle: async (spec, options) => {
    calls.push({ spec, options })
    return calls.length === 1 ? { ok: true, value: { application: 'failed', pendingBuilds: ['native-addon'] } } : { ok: true, value: { application: 'restart-required' } }
  } }))
  await installer.start('demo@1.0.0')
  assert.equal(installer.getSnapshot().phase, 'failed')
  assert.equal((calls[0] as any).options.approvedBuilds, undefined)
  await installer.approve()
  assert.deepEqual((calls[1] as any).options.approvedBuilds, ['native-addon'])
  assert.equal((calls[1] as any).options.profile, undefined)
  assert.equal(installer.getSnapshot().application, 'restart-required')
})
test('lost reply prevents duplicate installation and can recover the original result', async () => {
  let calls = 0
  const installer = createDirectInstaller(() => host({ installBundle: async () => { calls++; throw new Error('Disconnected') } }))
  await installer.start('demo')
  await installer.start('other')
  assert.equal(calls, 1)
  assert.equal(installer.getSnapshot().phase, 'unknown')
  await installer.recover()
  assert.equal(installer.getSnapshot().application, 'restart-required')
})

test('an unavailable install result stops its queue and allows a new install after dismissal', async () => {
  const calls: string[] = []
  const installer = createDirectInstaller(() => host({
    installBundle: async spec => {
      calls.push(spec)
      if (spec === 'demo') throw new Error('Disconnected')
      return { ok: true, value: { application: 'applied' } }
    },
    waitForInstall: async () => ({ ok: true, value: null }),
  }))
  await installer.start(['demo', 'queued'])
  installer.reset()
  assert.equal(installer.getSnapshot().phase, 'unknown')
  await installer.recover()
  assert.equal(installer.getSnapshot().phase, 'unavailable')
  assert.equal(installer.getSnapshot().queue[1]?.phase, 'idle')
  await installer.retry()
  installer.reset()
  await installer.start('other')
  assert.equal(installer.getSnapshot().application, 'applied')
  assert.deepEqual(calls, ['demo', 'other'])
})
test('concurrent clicks share one operation and cancellation waits for host settlement', async () => {
  let finish!: (value: any) => void
  const installer = createDirectInstaller(() => host({ installBundle: () => new Promise(resolve => { finish = resolve }) }))
  const pending = installer.start('demo')
  await new Promise(resolve => setImmediate(resolve))
  await installer.start('other')
  assert.equal(installer.getSnapshot().spec, 'demo')
  await installer.cancel()
  assert.equal(installer.getSnapshot().phase, 'cancelling')
  finish({ ok: true, value: { application: 'cancelled' } })
  await pending
  assert.equal(installer.getSnapshot().application, 'cancelled')
})

test('multiple selections install sequentially and deduplicate targets', async () => {
  const calls: string[] = []
  let active = 0
  const installer = createDirectInstaller(() => host({ installBundle: async spec => {
    assert.equal(active++, 0)
    calls.push(spec)
    await new Promise(resolve => setImmediate(resolve))
    active--
    return { ok: true, value: { application: spec === 'one' ? 'restart-required' : 'applied' } }
  } }))
  await installer.start(['one', 'two', 'one'])
  assert.deepEqual(calls, ['one', 'two'])
  assert.deepEqual(installer.getSnapshot().queue.map(entry => entry.application), ['restart-required', 'applied'])
})

test('failure pauses queue; retry does not repeat completed components', async () => {
  const calls: string[] = []
  const installer = createDirectInstaller(() => host({ installBundle: async spec => {
    calls.push(spec)
    return { ok: true, value: { application: calls.length === 2 ? 'failed' : 'applied' } }
  } }))
  await installer.start(['one', 'two', 'three'])
  assert.deepEqual(calls, ['one', 'two'])
  assert.equal(installer.getSnapshot().queue[2]?.phase, 'idle')
  await installer.retry()
  assert.deepEqual(calls, ['one', 'two', 'two', 'three'])
})

test('script permission pauses the queue and applies only to the current component', async () => {
  const calls: {spec: string; builds: string[] | undefined}[] = []
  const installer = createDirectInstaller(() => host({ installBundle: async (spec, options) => {
    calls.push({ spec, builds: options?.approvedBuilds })
    return calls.length === 1 ? { ok: true, value: { application: 'failed', pendingBuilds: ['native-addon'] } }
      : { ok: true, value: { application: 'applied' } }
  } }))
  await installer.start(['one', 'two'])
  await installer.retry()
  assert.equal(calls.length, 1)
  await installer.approve()
  assert.deepEqual(calls, [{spec:'one',builds:undefined},{spec:'one',builds:['native-addon']},{spec:'two',builds:undefined}])
})

test('cancellation stops later components even when the current install succeeds', async () => {
  let finish!: (value: any) => void
  const calls: string[] = []
  const installer = createDirectInstaller(() => host({ installBundle: spec => {
    calls.push(spec)
    return new Promise(resolve => { finish = resolve })
  } }))
  const pending = installer.start(['one', 'two'])
  await new Promise(resolve => setImmediate(resolve))
  await installer.cancel()
  finish({ok:true,value:{application:'applied'}})
  await pending
  assert.deepEqual(calls, ['one'])
  assert.equal(installer.getSnapshot().queue[1]?.phase, 'idle')
})

test('recovery continues the queue without reinstalling the uncertain component', async () => {
  const calls: string[] = []
  const installer = createDirectInstaller(() => host({ installBundle: async spec => {
    calls.push(spec)
    if (spec === 'one') throw new Error('Disconnected')
    return {ok:true,value:{application:'applied'}}
  } }))
  await installer.start(['one','two'])
  assert.deepEqual(calls,['one'])
  await Promise.all([installer.recover(), installer.recover()])
  assert.deepEqual(calls,['one','two'])
  assert.equal(installer.getSnapshot().queue[0]?.application,'restart-required')
})

test('overridden results stop the queue for inspection', async () => {
  const calls: string[] = []
  const installer = createDirectInstaller(() => host({ installBundle: async spec => {
    calls.push(spec)
    return {ok:true,value:{application:'overridden'}}
  } }))
  await installer.start(['one','two'])
  assert.deepEqual(calls,['one'])
})

test('approvals name only the current pending builds and retries carry none', async () => {
  // The Host refuses ('stale-approval') any approved name that is no longer pending.
  const calls: (string[] | undefined)[] = []
  const replies = [
    { application: 'failed', pendingBuilds: ['native-addon'] },
    { application: 'failed', pendingBuilds: ['second-addon'] },
    { application: 'failed', error: { code: 'pnpm-failed' } },
    { application: 'applied' },
  ]
  const installer = createDirectInstaller(() => host({ installBundle: async (_spec, options) => {
    calls.push(options?.approvedBuilds)
    return { ok: true, value: replies[calls.length - 1] } as any
  } }))
  await installer.start('demo@1.0.0')
  await installer.approve()
  await installer.approve()
  assert.equal(installer.getSnapshot().phase, 'failed')
  await installer.retry()
  assert.deepEqual(calls, [undefined, ['native-addon'], ['second-addon'], undefined])
  assert.equal(installer.getSnapshot().phase, 'done')
})

test('reconcileSelectedTargets advances past async already-installed targets while respecting manual edits', () => {
  const targets = [
    { install: 'dsh-team-control', profile: 'web', note: '' },
    { install: 'dsh-team-control-ui', profile: 'web', note: '' },
  ]
  const installedA = ownedIndexOf([{
    packageName: 'dsh-team-control',
    version: '1.0.0',
    description: '',
    repository: 'hunmer/dsh-team-control',
    self: false, inBox: false, unregistered: false, enabled: true, entries: [], error: '', heldDown: false,
  } as MarketInstalledPackage])
  const installedBoth = ownedIndexOf([
    {
      packageName: 'dsh-team-control',
      version: '1.0.0',
      description: '',
      repository: 'hunmer/dsh-team-control',
      self: false, inBox: false, unregistered: false, enabled: true, entries: [], error: '', heldDown: false,
    },
    {
      packageName: 'dsh-team-control-ui',
      version: '1.0.0',
      description: '',
      repository: 'hunmer/dsh-team-control',
      self: false, inBox: false, unregistered: false, enabled: true, entries: [], error: '', heldDown: false,
    },
  ])

  // Before ownedIndex loads, defaults to [0]
  assert.deepEqual(reconcileSelectedTargets(targets, [], undefined, false), [0])
  // Once ownedIndex arrives showing target 0 is installed, auto-advances to [1]
  assert.deepEqual(reconcileSelectedTargets(targets, [0], installedA, false), [1])
  // If user manually unchecked everything, do not re-select automatically
  assert.deepEqual(reconcileSelectedTargets(targets, [], installedA, true), [])
  // If user checked both and target 0 became installed, keep only [1]
  assert.deepEqual(reconcileSelectedTargets(targets, [0, 1], installedA, true), [1])
  // When all targets are installed, selection is empty
  assert.deepEqual(reconcileSelectedTargets(targets, [1], installedBoth, false), [])
})

test('shouldRefreshInstalledAfterDirect refreshes only when profile state may have changed or diverged', () => {
  assert.equal(shouldRefreshInstalledAfterDirect({ phase: 'done', queue: [], message: '' }), true)
  assert.equal(shouldRefreshInstalledAfterDirect({ phase: 'unavailable', queue: [], message: '' }), true)
  assert.equal(shouldRefreshInstalledAfterDirect({
    phase: 'failed',
    queue: [
      { spec: 'one', phase: 'done', message: '' },
      { spec: 'two', phase: 'failed', message: 'pnpm-failed' },
    ],
    message: 'pnpm-failed',
  }), true)
  assert.equal(shouldRefreshInstalledAfterDirect({ phase: 'failed', queue: [], message: 'already-installed\n...' }), true)
  assert.equal(shouldRefreshInstalledAfterDirect({ phase: 'failed', queue: [], message: 'ambiguous-install\n...' }), true)
  assert.equal(shouldRefreshInstalledAfterDirect({ phase: 'failed', queue: [], message: 'not-a-bundle: refused' }), false)
  assert.equal(shouldRefreshInstalledAfterDirect({ phase: 'failed', queue: [], message: 'build-approval-required' }), false)
  assert.equal(shouldRefreshInstalledAfterDirect({ phase: 'installing', queue: [], message: '' }), false)
})

test('directInstaller does not report build-approval pauses as failed outcomes', async () => {
  const outcomes: Array<{ spec: string; result: string; message: string }> = []
  let calls = 0
  const host = {
    inspect: async () => ({ ok: true as const, value: { status: 'accepted' as const, registry: null } }),
    installBundle: async (_spec: string, options?: { approvedBuilds?: string[] }) => {
      calls += 1
      if (calls === 1) {
        return {
          ok: true as const,
          value: {
            application: 'failed' as const,
            pendingBuilds: ['esbuild'],
            error: { code: 'build-approval-required', diagnostic: 'Approve build scripts' },
          },
        }
      }
      assert.deepEqual(options?.approvedBuilds, ['esbuild'])
      return { ok: true as const, value: { application: 'applied' as const } }
    },
    cancelInstall: async () => ({ ok: true as const, value: { status: 'cancelled' } }),
    waitForInstall: async () => ({ ok: true as const, value: null }),
  }
  const installer = createDirectInstaller(() => host, outcome => outcomes.push(outcome))
  await installer.start('demo-native-plugin')
  assert.equal(installer.getSnapshot().phase, 'failed')
  assert.deepEqual(outcomes, [])
  await installer.approve()
  assert.equal(installer.getSnapshot().phase, 'done')
  assert.deepEqual(outcomes, [{ spec: 'demo-native-plugin', result: 'ok', message: '' }])
})

test('directInstaller surfaces structured inspectProblem and packageResult failure hints to onOutcome', async () => {
  const outcomes: Array<{
    spec: string
    result: string
    inspectProblem?: string
    errorCode?: string
    packageKind?: string
    timedOut?: boolean
  }> = []
  const inspectRefusalHost = {
    inspect: async () => ({ ok: true as const, value: { status: 'refused' as const, problem: 'not-a-bundle', reason: 'No bundle' } }),
    installBundle: async () => ({ ok: true as const, value: { application: 'applied' as const } }),
    cancelInstall: async () => ({ ok: true as const, value: { status: 'cancelled' } }),
    waitForInstall: async () => ({ ok: true as const, value: null }),
  }
  const installer1 = createDirectInstaller(() => inspectRefusalHost, outcome => outcomes.push(outcome))
  await installer1.start('https://github.com/alchaincyf/nuwa-skill')
  assert.equal(outcomes[0]?.result, 'failed')
  assert.equal(outcomes[0]?.inspectProblem, 'not-a-bundle')
  assert.deepEqual(installer1.getSnapshot().inspectError, { problem: 'not-a-bundle', reason: 'No bundle' })

  const installFailureHost = {
    inspect: async () => ({ ok: true as const, value: { status: 'accepted' as const, registry: null } }),
    installBundle: async () => ({
      ok: true as const,
      value: {
        application: 'failed' as const,
        error: { code: 'operation-error', diagnostic: 'pnpm failed' },
        packageResult: { output: 'ERR_PNPM_NO_MATCHING_VERSION', kind: 'no-matching-version', timedOut: false },
      },
    }),
    cancelInstall: async () => ({ ok: true as const, value: { status: 'cancelled' } }),
    waitForInstall: async () => ({ ok: true as const, value: null }),
  }
  const installer2 = createDirectInstaller(() => installFailureHost, outcome => outcomes.push(outcome))
  await installer2.start('demo-pkg')
  assert.equal(outcomes[1]?.result, 'failed')
  assert.equal(outcomes[1]?.errorCode, 'operation-error')
  assert.equal(outcomes[1]?.packageKind, 'no-matching-version')
  assert.equal(outcomes[1]?.timedOut, false)
})

test('manual install helpers validate inputs, deduplicate registries, and format registry labels', () => {
  assert.equal(isManualInstallInputValid('  dsh-plugin-whale-pet  '), true)
  assert.equal(isManualInstallInputValid('/Users/alice/my-plugin'), true)
  assert.equal(isManualInstallInputValid('   '), false)
  assert.equal(isManualInstallInputValid('bad\ninput'), false)

  assert.equal(isValidCustomRegistryUrl('https://npm.example.com/'), true)
  assert.equal(isValidCustomRegistryUrl('http://localhost:4873'), true)
  assert.equal(isValidCustomRegistryUrl('ftp://example.com'), false)
  assert.equal(isValidCustomRegistryUrl('not-a-url'), false)

  const offered = offeredInstallRegistries({
    registry: 'https://registry.npmmirror.com/',
    fallbackRegistries: ['https://registry.npmjs.org/', 'https://registry.npmmirror.com'],
    resolved: 'https://registry.npmjs.org/',
  })
  assert.deepEqual(offered, ['https://registry.npmmirror.com/', 'https://registry.npmjs.org/'])

  assert.equal(installRegistryLabel('https://registry.npmmirror.com/', null).kind, 'npmmirror')
  assert.equal(installRegistryLabel('https://registry.npmjs.org/', null).kind, 'official')
  assert.equal(installRegistryLabel(null, null).kind, 'default')
  assert.equal(installRegistryLabel('https://npm.corp.local/', null).host, 'npm.corp.local')
})

test('directInstaller startManual supports local paths, custom registries, and preserves manual options across retry', async () => {
  const seenInspect: Array<{ spec: string; registry?: string | null }> = []
  const seenInstall: Array<{ spec: string; registry?: string | null; saveExact?: boolean; enabled?: boolean }> = []
  const outcomes: Array<{ spec: string; result: string; manual?: boolean }> = []
  let failOnce = true

  const host = {
    registries: async () => ({
      ok: true as const,
      value: { registry: 'https://registry.npmmirror.com/', fallbackRegistries: ['https://registry.npmjs.org/'], resolved: null },
    }),
    inspect: async (spec: string, options: { registry?: string | null }) => {
      seenInspect.push({ spec, registry: options.registry })
      return { ok: true as const, value: { status: 'accepted' as const, registry: options.registry ?? null } }
    },
    installBundle: async (spec: string, options?: { registry?: string | null; saveExact?: boolean; enabled?: boolean }) => {
      seenInstall.push({ spec, registry: options?.registry, saveExact: options?.saveExact, enabled: options?.enabled })
      if (failOnce) {
        failOnce = false
        return { ok: true as const, value: { application: 'failed' as const, error: { code: 'operation-error', diagnostic: 'transient' } } }
      }
      return { ok: true as const, value: { application: 'applied' as const } }
    },
    cancelInstall: async () => ({ ok: true as const, value: { status: 'cancelled' } }),
    waitForInstall: async () => ({ ok: true as const, value: null }),
  }

  const installer = createDirectInstaller(() => host, outcome => outcomes.push(outcome))
  const regs = await installer.listRegistries()
  assert.equal(regs?.registry, 'https://registry.npmmirror.com/')

  await installer.startManual('  C:\\plugins\\local-plugin  ', {
    registry: 'https://npm.corp.local/',
    saveExact: true,
    enabled: false,
    title: 'Local Plugin',
  })
  assert.equal(installer.getSnapshot().origin, 'manual')
  assert.equal(installer.getSnapshot().phase, 'failed')
  assert.equal(outcomes[0]?.manual, true)

  await installer.retry()
  assert.equal(installer.getSnapshot().phase, 'done')
  assert.equal(outcomes[1]?.manual, true)
  assert.deepEqual(seenInspect[1], { spec: 'C:\\plugins\\local-plugin', registry: 'https://npm.corp.local/' })
  assert.deepEqual(seenInstall[1], {
    spec: 'C:\\plugins\\local-plugin',
    registry: 'https://npm.corp.local/',
    saveExact: true,
    enabled: false,
  })
})

test('DirectState records structured incompatible error details and reconcileSelectedTargets filters incompatible targets', async () => {
  const incompatible = [{
    name: 'demo',
    version: '2.0.0',
    runtimeVersion: '0.2.2-rc.1',
    requirements: { 'engines.dsh': '>=0.3.0' },
  }]
  const installer = createDirectInstaller(() => host({
    installBundle: async () => ({
      ok: true,
      value: { application: 'failed', error: { code: 'incompatible-version', incompatible } },
    }),
  }))

  await installer.start('demo@2.0.0')
  const failed = installer.getSnapshot()
  assert.equal(failed.phase, 'failed')
  assert.equal(failed.errorCode, 'incompatible-version')
  assert.deepEqual(failed.incompatible, incompatible)

  // Starting a fresh install clears stale incompatibility error fields immediately.
  installer.reset()
  assert.equal(installer.getSnapshot().errorCode, undefined)
  assert.equal(installer.getSnapshot().incompatible, undefined)

  const targets = [
    { install: 'new-only@2.0.0', profile: 'web', note: '', dshEngine: '>=0.3.0' },
    { install: 'compat-pkg@1.0.0', profile: 'web', note: '', dshEngine: '>=0.2.0-rc.1 <0.3.0' },
  ]

  // Only compatible target survives automatic selection when dshVersion is provided.
  assert.deepEqual(reconcileSelectedTargets(targets, [], undefined, false, '0.2.2-rc.1'), [1])
  assert.deepEqual(reconcileSelectedTargets(targets, [0, 1], undefined, true, '0.2.2-rc.1'), [1])

  // Single-target parseInstallInfo inherits `DSH ...` from requirements; multi-target leaves per-target engines clean.
  const singleParsed = parseInstallInfo({
    mode: 'command',
    targets: [{ install: 'only-one@1.0.0', profile: 'web', note: '' }],
    requirements: ['DSH >=0.3.0'],
  })
  assert.equal(singleParsed?.targets[0]?.dshEngine, '>=0.3.0')
  assert.deepEqual(reconcileSelectedTargets(singleParsed!.targets, [], undefined, false, '0.2.2-rc.1', singleParsed!.requirements), [])

  // Natural-language prose in `requirements` must not be promoted into a blocking `dshEngine`.
  const proseParsed = parseInstallInfo({
    mode: 'command',
    targets: [{ install: 'prose-pkg@1.0.0', profile: 'web', note: '' }],
    requirements: ['DSH >= 0.1.0-rc.6（宿主需包含 @deepseek-ai/dsh-web-app 组合）'],
  })
  assert.equal(proseParsed?.targets[0]?.dshEngine, undefined)
  assert.deepEqual(reconcileSelectedTargets(proseParsed!.targets, [], undefined, false, '0.2.2-rc.5', proseParsed!.requirements), [0])

  // packageResult.incompatible fallback is captured when error.incompatible is omitted.
  const fallbackInstaller = createDirectInstaller(() => host({
    installBundle: async () => ({
      ok: true,
      value: {
        application: 'failed',
        error: { code: 'incompatible-version' },
        packageResult: { incompatible },
      } as never,
    }),
  }))
  await fallbackInstaller.start('demo@2.0.0')
  assert.deepEqual(fallbackInstaller.getSnapshot().incompatible, incompatible)
})
