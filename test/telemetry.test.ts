import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CN_MIRROR_CATALOG_BASE,
  DEFAULT_CATALOG_BASE,
  MIRROR_CATALOG_BASE,
  isOfficialCatalogBase,
} from '../src/catalog.ts'
import {
  classifyInstallError,
  createTelemetryReporter,
  detectHostKind,
  isTelemetryEnvSuppressed,
  sanitizeMcpTarget,
  sanitizePluginTarget,
} from '../src/telemetry.ts'

test('isTelemetryEnvSuppressed honors DSH_TELEMETRY_DISABLED, DO_NOT_TRACK, DSH_MARKET_TELEMETRY and CI', () => {
  assert.equal(isTelemetryEnvSuppressed({}), false)
  assert.equal(isTelemetryEnvSuppressed({ DSH_TELEMETRY_DISABLED: '1' }), true)
  assert.equal(isTelemetryEnvSuppressed({ DSH_TELEMETRY_DISABLED: '0' }), true)
  assert.equal(isTelemetryEnvSuppressed({ DO_NOT_TRACK: '1' }), true)
  assert.equal(isTelemetryEnvSuppressed({ DO_NOT_TRACK: 'yes' }), true)
  assert.equal(isTelemetryEnvSuppressed({ DO_NOT_TRACK: 'on' }), true)
  assert.equal(isTelemetryEnvSuppressed({ DO_NOT_TRACK: '0' }), false)
  assert.equal(isTelemetryEnvSuppressed({ DO_NOT_TRACK: 'false' }), false)
  assert.equal(isTelemetryEnvSuppressed({ DO_NOT_TRACK: 'off' }), false)
  assert.equal(isTelemetryEnvSuppressed({ DO_NOT_TRACK: 'no' }), false)
  assert.equal(isTelemetryEnvSuppressed({ DO_NOT_TRACK: '' }), false)
  assert.equal(isTelemetryEnvSuppressed({ DSH_MARKET_TELEMETRY: '0' }), true)
  assert.equal(isTelemetryEnvSuppressed({ DSH_MARKET_TELEMETRY: 'false' }), true)
  assert.equal(isTelemetryEnvSuppressed({ CI: 'true' }), true)
})

test('isOfficialCatalogBase accepts only official default and mirror catalog URLs', () => {
  assert.equal(isOfficialCatalogBase(DEFAULT_CATALOG_BASE), true)
  assert.equal(isOfficialCatalogBase(` ${CN_MIRROR_CATALOG_BASE} `), true)
  assert.equal(isOfficialCatalogBase(MIRROR_CATALOG_BASE), true)
  assert.equal(isOfficialCatalogBase('https://internal.corp.local/market.json'), false)
  assert.equal(isOfficialCatalogBase(''), false)
})

test('detectHostKind identifies desktop runtime signals and falls back to other', () => {
  assert.equal(detectHostKind({ DSH_DESKTOP_RUNTIME_ENTRY: '/app/dsh' }, {}), 'desktop')
  assert.equal(detectHostKind({ ELECTRON_RUN_AS_NODE: '1' }, {}), 'desktop')
  assert.equal(detectHostKind({}, { electron: '35.0.0' }), 'desktop')
  assert.equal(detectHostKind({}, {}), 'other')
})

test('sanitizePluginTarget and sanitizeMcpTarget never leak private targets', () => {
  const publicSet = new Set(['dsh-better-sidebar', 'bruc3van/dsh-market-pro', 'demo/gitee-plugin'])
  const isPublic = (candidate: string) => publicSet.has(candidate)

  assert.equal(sanitizePluginTarget('dsh-better-sidebar@0.32.1', isPublic), 'dsh-better-sidebar')
  assert.equal(sanitizePluginTarget('https://github.com/bruc3van/dsh-market-pro#abc123', isPublic), 'bruc3van/dsh-market-pro')
  assert.equal(sanitizePluginTarget('git+https://github.com/bruc3van/dsh-market-pro.git#main&path:packages/a', isPublic), 'bruc3van/dsh-market-pro')
  assert.equal(sanitizePluginTarget('https://codeload.github.com/bruc3van/dsh-market-pro/tar.gz/main', isPublic), 'bruc3van/dsh-market-pro')
  assert.equal(sanitizePluginTarget('github:bruc3van/dsh-market-pro#main', isPublic), 'bruc3van/dsh-market-pro')
  assert.equal(sanitizePluginTarget('https://gitee.com/demo/gitee-plugin.git#v1', isPublic), 'demo/gitee-plugin')
  assert.equal(sanitizePluginTarget('@corp/internal-secret-plugin@1.0.0', isPublic), 'custom')
  assert.equal(sanitizePluginTarget('file:///Users/alice/private', isPublic), 'custom')

  assert.equal(sanitizeMcpTarget('context7'), 'context7')
  assert.equal(sanitizeMcpTarget('my-private-internal-mcp'), 'custom')
})

test('classifyInstallError maps arbitrary error strings to closed safe enums', () => {
  assert.equal(classifyInstallError('Incompatible engines.dsh peer requirement'), 'compat')
  assert.equal(classifyInstallError('Request timed out after 30s'), 'timeout')
  assert.equal(classifyInstallError('npm error version 10.9.0\nRequest timed out while fetching metadata'), 'timeout')
  assert.equal(classifyInstallError('AbortError: The operation was aborted due to timeout'), 'timeout')
  assert.equal(classifyInstallError('connect ECONNREFUSED 127.0.0.1:443'), 'network')
  assert.equal(classifyInstallError('ECONNRESET fetch failed'), 'network')
  assert.equal(classifyInstallError('getaddrinfo ENOTFOUND registry.npmjs.org'), 'network')
  assert.equal(classifyInstallError('Operation cancelled by user'), 'cancelled')
  assert.equal(classifyInstallError('Write refused: readonly profile'), 'refused')
  assert.equal(classifyInstallError('name-conflict'), 'refused')
  assert.equal(classifyInstallError('Unexpected crash at /Users/alice/secret.ts'), 'unknown')
})

test('createTelemetryReporter sends at most one daily ping, respects toggle, and reports sanitized feedback', async () => {
  const sent: Array<Record<string, unknown>> = []
  let enabled = true
  let storageState = { telemetryId: '', telemetryLastPingDay: '', telemetryLastPingKind: '' }

  const reporter = createTelemetryReporter({
    endpoint: 'https://dsh-market-pro.com/api/telemetry',
    pluginVersion: '1.12.3',
    dshVersion: '0.2.2-rc.5',
    hostKind: 'other',
    os: 'darwin',
    env: {},
    isEnabled: () => enabled,
    isPublicPluginTarget: (target) => target === 'dsh-better-sidebar',
    storage: {
      read: () => storageState,
      write: (patch) => { storageState = { ...storageState, ...patch } },
    },
    now: () => new Date('2026-11-23T02:00:00Z'),
    fetcher: (async (_url: string | URL | Request, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return new Response(JSON.stringify({ ok: true }), { status: 202 })
    }) as typeof fetch,
  })

  // First client_hello sends one ping with refined hostKind and locale.
  reporter.handleClientEvent({ kind: 'client_hello', hostKind: 'desktop', locale: 'zh' })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(sent.length, 1)
  assert.equal(sent[0]?.event, 'ping')
  assert.equal(sent[0]?.hostKind, 'desktop')
  assert.equal(sent[0]?.dshVersion, '0.2.2-rc.5')
  assert.equal(sent[0]?.locale, 'zh')
  assert.match(String(sent[0]?.id), /^[0-9a-f-]{36}$/i)

  // Second client_hello on the same day is deduplicated.
  reporter.handleClientEvent({ kind: 'client_hello', hostKind: 'desktop', locale: 'zh' })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(sent.length, 1)

  // Public plugin and curated MCP install feedback are kept; private/custom targets are dropped completely.
  reporter.handleClientEvent({ kind: 'plugin_install', target: 'dsh-better-sidebar@0.32.1', mode: 'direct', result: 'ok' })
  reporter.handleClientEvent({ kind: 'plugin_install', target: '@acme/private-tool', mode: 'direct', result: 'failed', errorCode: 'compat' })
  reporter.handleClientEvent({ kind: 'mcp_install', target: 'playwright', mode: 'featured', result: 'ok' })
  reporter.handleClientEvent({ kind: 'mcp_install', target: 'my-private-mcp', mode: 'custom', result: 'ok' })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(sent.length, 3)
  assert.equal(sent[1]?.target, 'dsh-better-sidebar')
  assert.equal(sent[2]?.event, 'mcp_install')
  assert.equal(sent[2]?.target, 'playwright')

  // Turning telemetry off immediately suppresses all outgoing events.
  enabled = false
  reporter.handleClientEvent({ kind: 'mcp_install', target: 'context7', mode: 'featured', result: 'ok' })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(sent.length, 3)

  reporter.dispose()
})

test('createTelemetryReporter deduplicates concurrent pings and preserves refinement when boot ping is in flight', async () => {
  const sent: Array<Record<string, unknown>> = []
  let storageState = { telemetryId: '', telemetryLastPingDay: '', telemetryLastPingKind: '' }
  let releaseFirst!: () => void
  const firstInFlight = new Promise<void>(resolve => { releaseFirst = resolve })
  let callCount = 0

  const reporter = createTelemetryReporter({
    endpoint: 'https://dsh-market-pro.com/api/telemetry',
    pluginVersion: '1.12.3',
    dshVersion: '0.2.2-rc.5',
    hostKind: 'other',
    os: 'darwin',
    env: {},
    bootDelayMs: 5,
    isEnabled: () => true,
    storage: {
      read: () => storageState,
      write: (patch) => { storageState = { ...storageState, ...patch } },
    },
    now: () => new Date('2026-11-23T02:00:00Z'),
    fetcher: (async (_url: string | URL | Request, init?: RequestInit) => {
      callCount += 1
      sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      if (callCount === 1) await firstInFlight
      return new Response(JSON.stringify({ ok: true }), { status: 202 })
    }) as typeof fetch,
  })

  // Start boot ping ('other'), wait until it is in flight, then deliver two concurrent desktop client_hello events.
  reporter.scheduleBootPing()
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(sent.length, 1)
  assert.equal(sent[0]?.hostKind, 'other')

  reporter.handleClientEvent({ kind: 'client_hello', hostKind: 'desktop', locale: 'zh' })
  reporter.handleClientEvent({ kind: 'client_hello', hostKind: 'desktop', locale: 'zh' })
  assert.equal(sent.length, 1, 'concurrent client_hello must wait for the in-flight ping instead of racing')

  releaseFirst()
  await new Promise(resolve => setTimeout(resolve, 30))

  // Exactly one refinement ping fires after the boot ping resolves, recording the refined desktop kind.
  assert.equal(sent.length, 2)
  assert.equal(sent[1]?.hostKind, 'desktop')
  assert.equal(sent[1]?.locale, 'zh')
  assert.equal(storageState.telemetryLastPingKind, 'desktop')

  reporter.dispose()
})

test('createTelemetryReporter backs off for the rest of the UTC+8 day after unreachable failures', async () => {
  let currentNow = new Date('2026-11-23T02:00:00Z')
  let attempts = 0
  let failRequests = true
  let storageState = { telemetryId: '', telemetryLastPingDay: '', telemetryLastPingKind: '' }

  const reporter = createTelemetryReporter({
    endpoint: 'https://dsh-market-pro.com/api/telemetry',
    pluginVersion: '1.15.4',
    dshVersion: '0.2.2-rc.5',
    hostKind: 'desktop',
    os: 'darwin',
    env: {},
    isEnabled: () => true,
    isPublicPluginTarget: () => true,
    storage: {
      read: () => storageState,
      write: (patch) => { storageState = { ...storageState, ...patch } },
    },
    now: () => currentNow,
    fetcher: (async () => {
      attempts += 1
      if (failRequests) throw new Error('network unreachable')
      return new Response(JSON.stringify({ ok: true }), { status: 202 })
    }) as typeof fetch,
  })

  // Failed ping backs off for the rest of the same UTC+8 day.
  reporter.handleClientEvent({ kind: 'client_hello', hostKind: 'desktop', locale: 'zh' })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(attempts, 1)
  reporter.handleClientEvent({ kind: 'client_hello', hostKind: 'desktop', locale: 'zh' })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(attempts, 1)

  // Feedback stops after 3 failures on the same UTC+8 day.
  for (let i = 0; i < 5; i += 1) {
    reporter.handleClientEvent({ kind: 'mcp_install', target: 'playwright', mode: 'featured', result: 'ok' })
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.equal(attempts, 4)

  // Advancing to the next UTC+8 day resets both backoff gates.
  failRequests = false
  currentNow = new Date('2026-11-24T02:00:00Z')
  reporter.handleClientEvent({ kind: 'client_hello', hostKind: 'desktop', locale: 'zh' })
  reporter.handleClientEvent({ kind: 'mcp_install', target: 'playwright', mode: 'featured', result: 'ok' })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(attempts, 6)
  assert.equal(storageState.telemetryLastPingDay, '2026-11-24')

  reporter.dispose()
})

test('createTelemetryReporter does not write back telemetryId when opted out while ping is in flight', async () => {
  let enabled = true
  let storageState = { telemetryId: '', telemetryLastPingDay: '', telemetryLastPingKind: '' }
  let releasePing!: () => void
  const pingParked = new Promise<void>(resolve => { releasePing = resolve })

  const reporter = createTelemetryReporter({
    endpoint: 'https://dsh-market-pro.com/api/telemetry',
    pluginVersion: '1.15.4',
    dshVersion: '0.2.2-rc.5',
    hostKind: 'desktop',
    os: 'darwin',
    env: {},
    isEnabled: () => enabled,
    storage: {
      read: () => storageState,
      write: (patch) => { storageState = { ...storageState, ...patch } },
    },
    now: () => new Date('2026-11-23T02:00:00Z'),
    fetcher: (async () => {
      await pingParked
      return new Response(JSON.stringify({ ok: true }), { status: 202 })
    }) as typeof fetch,
  })

  // Start a ping and wait until it is in flight (ID generated).
  reporter.handleClientEvent({ kind: 'client_hello', hostKind: 'desktop', locale: 'zh' })
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.notEqual(storageState.telemetryId, '')

  // Opt out while the ping is still in flight, clearing local storage state.
  enabled = false
  storageState = { telemetryId: '', telemetryLastPingDay: '', telemetryLastPingKind: '' }

  // Even if the user rapidly toggles telemetry back on before the old ping returns,
  // the in-flight response must not resurrect the cleared ID or heartbeat day.
  enabled = true
  releasePing()
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.deepEqual(storageState, { telemetryId: '', telemetryLastPingDay: '', telemetryLastPingKind: '' })

  // Same guarantee when telemetry remains disabled as the in-flight ping resolves.
  let releaseSecondPing!: () => void
  const secondParked = new Promise<void>(resolve => { releaseSecondPing = resolve })
  const reporter2 = createTelemetryReporter({
    endpoint: 'https://dsh-market-pro.com/api/telemetry',
    pluginVersion: '1.15.4',
    dshVersion: '0.2.2-rc.5',
    hostKind: 'desktop',
    os: 'darwin',
    env: {},
    isEnabled: () => enabled,
    storage: {
      read: () => storageState,
      write: (patch) => { storageState = { ...storageState, ...patch } },
    },
    now: () => new Date('2026-11-23T02:00:00Z'),
    fetcher: (async () => {
      await secondParked
      return new Response(JSON.stringify({ ok: true }), { status: 202 })
    }) as typeof fetch,
  })

  reporter2.handleClientEvent({ kind: 'client_hello', hostKind: 'desktop', locale: 'zh' })
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.notEqual(storageState.telemetryId, '')

  enabled = false
  storageState = { telemetryId: '', telemetryLastPingDay: '', telemetryLastPingKind: '' }
  releaseSecondPing()
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.deepEqual(storageState, { telemetryId: '', telemetryLastPingDay: '', telemetryLastPingKind: '' })

  reporter.dispose()
  reporter2.dispose()
})
