import { test } from 'node:test'
import assert from 'node:assert/strict'
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
  assert.equal(isTelemetryEnvSuppressed({ DSH_MARKET_TELEMETRY: '0' }), true)
  assert.equal(isTelemetryEnvSuppressed({ DSH_MARKET_TELEMETRY: 'false' }), true)
  assert.equal(isTelemetryEnvSuppressed({ CI: 'true' }), true)
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

  // Public plugin install feedback is kept; private plugin target collapses to 'custom'.
  reporter.handleClientEvent({ kind: 'plugin_install', target: 'dsh-better-sidebar@0.32.1', mode: 'direct', result: 'ok' })
  reporter.handleClientEvent({ kind: 'plugin_install', target: '@acme/private-tool', mode: 'direct', result: 'failed', errorCode: 'compat' })
  reporter.handleClientEvent({ kind: 'mcp_install', target: 'playwright', mode: 'featured', result: 'ok' })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(sent.length, 4)
  assert.equal(sent[1]?.target, 'dsh-better-sidebar')
  assert.equal(sent[2]?.target, 'custom')
  assert.equal(sent[2]?.errorCode, 'compat')
  assert.equal(sent[3]?.event, 'mcp_install')
  assert.equal(sent[3]?.target, 'playwright')

  // Turning telemetry off immediately suppresses all outgoing events.
  enabled = false
  reporter.handleClientEvent({ kind: 'mcp_install', target: 'context7', mode: 'featured', result: 'ok' })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(sent.length, 4)

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
