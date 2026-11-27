import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PluginUpdateResult, PluginVersion, PluginVersionList } from '@deepseek-ai/dsh-api-remotes/client'
import { createPluginUpdater, type UpdateHost } from '../src/client/pluginUpdates.ts'
import {
  IGNORED_UPDATES_STORAGE_KEY,
  isUpdateIgnored,
  normalizeIgnoredVersion,
  readIgnoredUpdates,
  shouldClearIgnoredVersion,
  withIgnoredAllUpdates,
  withIgnoredVersion,
  withoutIgnoredUpdate,
  writeIgnoredUpdates,
} from '../src/client/updateIgnore.ts'

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: (key) => { map.delete(key) },
    clear: () => { map.clear() },
    key: index => [...map.keys()][index] ?? null,
    get length() { return map.size },
  } as Storage
}

const ok = <T>(value: T) => ({ ok: true as const, value })
const version = (number: string, extra: Partial<PluginVersion> = {}): PluginVersion =>
  ({ version: number, tags: [], prerelease: false, bundle: true, ...extra })
const listed = (versions: PluginVersion[], installed = '1.0.0'): PluginVersionList =>
  ({ status: 'listed', installed, registry: 'https://registry.npmjs.org/', attempts: [], versions, omitted: 0 })
const outcome = (to = '2.0.0'): PluginUpdateResult => ({
  from: '1.0.0',
  to,
  step: 'install',
  result: { changed: true, application: 'applied', stage: 'install', target: `demo@${to}` },
})

test('updateIgnore helpers normalize versions, validate storage, and clean empty records', () => {
  assert.equal(normalizeIgnoredVersion(' v2.1.0 '), '2.1.0')
  assert.equal(isUpdateIgnored({ mode: 'version', version: '2.1.0' }, 'v2.1.0'), true)
  assert.equal(isUpdateIgnored({ mode: 'version', version: '2.1.0' }, '2.2.0'), false)
  assert.equal(isUpdateIgnored({ mode: 'all' }, '9.9.9'), true)
  assert.equal(isUpdateIgnored(undefined, '2.1.0'), false)

  const storage = memoryStorage()
  let rules = withIgnoredVersion({}, 'alpha', 'v1.2.3')
  rules = withIgnoredAllUpdates(rules, 'beta')
  writeIgnoredUpdates(rules, storage)
  assert.deepEqual(readIgnoredUpdates(storage), {
    alpha: { mode: 'version', version: '1.2.3' },
    beta: { mode: 'all' },
  })

  // Clearing the last rule removes the storage key cleanly.
  rules = withoutIgnoredUpdate(withoutIgnoredUpdate(rules, 'alpha'), 'beta')
  writeIgnoredUpdates(rules, storage)
  assert.equal(storage.getItem(IGNORED_UPDATES_STORAGE_KEY), null)

  // Corrupt or partial payloads degrade gracefully.
  storage.setItem(IGNORED_UPDATES_STORAGE_KEY, '{bad json')
  assert.deepEqual(readIgnoredUpdates(storage), {})
  storage.setItem(IGNORED_UPDATES_STORAGE_KEY, JSON.stringify({
    good: { mode: 'version', version: 'v2.0.0' },
    badEmpty: { mode: 'version', version: '' },
    badMode: { mode: 'forever' },
    '': { mode: 'all' },
  }))
  assert.deepEqual(readIgnoredUpdates(storage), {
    good: { mode: 'version', version: '2.0.0' },
  })
  assert.deepEqual(readIgnoredUpdates(null), {})
})

test('ignoreVersion suppresses the ignored version until a newer release appears or rule is restored', async () => {
  const storage = memoryStorage()
  let latest = '2.0.0'
  const host = (): UpdateHost => ({
    listBundles: async () => ok([{ name: 'demo', version: '1.0.0', installed: true, update: 'registry' }]),
    listVersions: async () => ok(listed([version(latest)])),
    updateBundle: async (_name, to) => ok(outcome(to)),
  })

  const updater = createPluginUpdater(host, () => undefined, undefined, storage)
  await updater.probe(['demo'])
  assert.equal(updater.getSnapshot().available.demo, '2.0.0')

  // Ignoring 2.0.0 hides it from available & availableDetails and persists.
  updater.ignoreVersion('demo', 'v2.0.0')
  assert.equal(updater.getSnapshot().available.demo, undefined)
  assert.equal(updater.getSnapshot().availableDetails.demo, undefined)
  assert.deepEqual(updater.getSnapshot().ignored.demo, { mode: 'version', version: '2.0.0' })

  // A new updater instance loads persisted rules and still hides 2.0.0 on probe.
  const reloaded = createPluginUpdater(host, () => undefined, undefined, storage)
  await reloaded.probe(['demo'])
  assert.equal(reloaded.getSnapshot().available.demo, undefined)

  // Manual check still exposes 2.0.0 in choices so the user can update anytime.
  await reloaded.check('demo')
  assert.equal(reloaded.getSnapshot().choices.map(c => c.version).includes('2.0.0'), true)
  assert.equal(reloaded.getSnapshot().available.demo, undefined)

  // Unignoring restores visibility immediately from cached detection without re-probing.
  reloaded.unignore('demo')
  assert.equal(reloaded.getSnapshot().available.demo, '2.0.0')
  assert.equal(reloaded.getSnapshot().ignored.demo, undefined)

  // Ignore 2.0.0 again, then publish 2.1.0 -> probe surfaces 2.1.0 automatically.
  reloaded.ignoreVersion('demo', '2.0.0')
  assert.equal(reloaded.getSnapshot().available.demo, undefined)
  latest = '2.1.0'
  await reloaded.probe(['demo'])
  assert.equal(reloaded.getSnapshot().available.demo, '2.1.0')

  // Manually confirming update clears any version-specific ignore rule.
  reloaded.ignoreVersion('demo', '2.1.0')
  await reloaded.check('demo')
  await reloaded.confirm()
  assert.equal(reloaded.getSnapshot().phase, 'done')
  assert.equal(reloaded.getSnapshot().ignored.demo, undefined)
  assert.deepEqual(readIgnoredUpdates(storage), {})
})

test('ignoreAllUpdates skips background probe queries, survives updates, and unignore re-probes', async () => {
  const storage = memoryStorage()
  let listVersionsCalls = 0
  const host = (): UpdateHost => ({
    listBundles: async () => ok([{ name: 'demo', version: '1.0.0', installed: true, update: 'registry' }]),
    listVersions: async () => {
      listVersionsCalls += 1
      return ok(listed([version('2.0.0')]))
    },
    updateBundle: async (_name, to) => ok(outcome(to)),
  })

  const updater = createPluginUpdater(host, () => undefined, undefined, storage)
  updater.ignoreAllUpdates('demo')
  await updater.probe(['demo'])
  assert.equal(listVersionsCalls, 0)
  assert.equal(updater.getSnapshot().available.demo, undefined)

  // Manual update leaves mode:'all' intact.
  await updater.check('demo')
  assert.equal(listVersionsCalls, 1)
  await updater.confirm()
  assert.deepEqual(updater.getSnapshot().ignored.demo, { mode: 'all' })

  // Unignoring mode:'all' when no cached update exists triggers a background probe.
  updater.unignore('demo')
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(listVersionsCalls, 2)
  assert.equal(updater.getSnapshot().available.demo, '2.0.0')

  // clearPackageState removes both available state and persisted ignore rules on uninstall.
  updater.ignoreVersion('demo', '2.0.0')
  updater.clearPackageState('demo')
  assert.equal(updater.getSnapshot().available.demo, undefined)
  assert.equal(updater.getSnapshot().ignored.demo, undefined)
  assert.deepEqual(readIgnoredUpdates(storage), {})
})

test('syncIgnoredFromStorage reflects cross-tab storage edits immediately', async () => {
  const storage = memoryStorage()
  const updater = createPluginUpdater(
    () => ({
      listBundles: async () => ok([{ name: 'demo', version: '1.0.0', installed: true, update: 'registry' }]),
      listVersions: async () => ok(listed([version('2.0.0')])),
      updateBundle: async () => ok(outcome()),
    }),
    () => undefined,
    undefined,
    storage,
  )
  await updater.probe(['demo'])
  assert.equal(updater.getSnapshot().available.demo, '2.0.0')

  writeIgnoredUpdates({ demo: { mode: 'version', version: '2.0.0' } }, storage)
  updater.syncIgnoredFromStorage()
  assert.equal(updater.getSnapshot().available.demo, undefined)
  assert.deepEqual(updater.getSnapshot().ignored.demo, { mode: 'version', version: '2.0.0' })
})

test('shouldClearIgnoredVersion keeps ignoring 2.0.0 when manually updating to intermediate 1.5.0', async () => {
  assert.equal(shouldClearIgnoredVersion({ mode: 'version', version: '2.0.0' }, '1.5.0'), false)
  assert.equal(shouldClearIgnoredVersion({ mode: 'version', version: '2.0.0' }, '2.0.0'), true)
  assert.equal(shouldClearIgnoredVersion({ mode: 'version', version: '2.0.0' }, '2.1.0'), true)
  assert.equal(shouldClearIgnoredVersion({ mode: 'all' }, '2.0.0'), false)

  const storage = memoryStorage()
  const updater = createPluginUpdater(
    () => ({
      listBundles: async () => ok([{ name: 'demo', version: '1.0.0', installed: true, update: 'registry' }]),
      listVersions: async () => ok(listed([version('2.0.0'), version('1.5.0')])),
      updateBundle: async (_name, to) => ok(outcome(to)),
    }),
    () => undefined,
    undefined,
    storage,
  )

  updater.ignoreVersion('demo', '2.0.0')
  await updater.check('demo')
  updater.select('1.5.0')
  await updater.confirm()
  assert.deepEqual(updater.getSnapshot().ignored.demo, { mode: 'version', version: '2.0.0' })

  await updater.check('demo')
  updater.select('2.0.0')
  await updater.confirm()
  assert.equal(updater.getSnapshot().ignored.demo, undefined)
})

test('unignore and cross-tab sync probe only targeted packages without aborting an in-flight full probe', async () => {
  const storage = memoryStorage()
  let resolveAlphaFirstProbe!: () => void
  const alphaFirstGate = new Promise<void>(resolve => { resolveAlphaFirstProbe = resolve })
  let alphaCalls = 0
  let betaCalls = 0
  let gammaCalls = 0

  const updater = createPluginUpdater(
    () => ({
      listBundles: async () => ok([
        { name: 'alpha', version: '1.0.0', installed: true, update: 'registry' },
        { name: 'beta', version: '1.0.0', installed: true, update: 'registry' },
        { name: 'gamma', version: '1.0.0', installed: true, update: 'registry' },
      ]),
      listVersions: async (name) => {
        if (name === 'alpha') {
          alphaCalls += 1
          if (alphaCalls === 1) await alphaFirstGate
          return ok(listed([version('1.1.0')]))
        }
        if (name === 'beta') {
          betaCalls += 1
          return ok(listed([version('2.1.0')]))
        }
        gammaCalls += 1
        return ok(listed([version('3.1.0')]))
      },
      updateBundle: async (_name, to) => ok(outcome(to)),
    }),
    () => undefined,
    undefined,
    storage,
  )

  updater.ignoreAllUpdates('beta')
  updater.ignoreAllUpdates('gamma')

  // Start full probe; pause while it is querying alpha.
  const fullProbe = updater.probe()
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(alphaCalls, 1)

  // Unignoring both beta and gamma while full probe is in flight must not cancel alpha or gamma!
  updater.unignore('beta')
  updater.unignore('gamma')
  resolveAlphaFirstProbe()
  await fullProbe
  await new Promise(resolve => setTimeout(resolve, 20))

  assert.equal(updater.getSnapshot().available.alpha, '1.1.0')
  assert.equal(updater.getSnapshot().available.beta, '2.1.0')
  assert.equal(updater.getSnapshot().available.gamma, '3.1.0')
  assert.ok(betaCalls >= 1 && gammaCalls >= 1)

  // Cross-tab removal of mode:'all' when nothing is cached triggers targeted re-probe.
  const crossTabStorage = memoryStorage()
  writeIgnoredUpdates({ beta: { mode: 'all' } }, crossTabStorage)
  let crossTabBetaCalls = 0
  const crossTabUpdater = createPluginUpdater(
    () => ({
      listBundles: async () => ok([{ name: 'beta', version: '1.0.0', installed: true, update: 'registry' }]),
      listVersions: async () => { crossTabBetaCalls += 1; return ok(listed([version('2.2.0')])) },
      updateBundle: async (_name, to) => ok(outcome(to)),
    }),
    () => undefined,
    undefined,
    crossTabStorage,
  )
  writeIgnoredUpdates({}, crossTabStorage)
  crossTabUpdater.syncIgnoredFromStorage()
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(crossTabBetaCalls, 1)
  assert.equal(crossTabUpdater.getSnapshot().available.beta, '2.2.0')
})
