import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_AI_MCP_LIMIT } from '../src/aiMcpTools.ts'
import { SERVER_NAME_PATTERN } from '../src/mcpShapes.ts'
import type { McpUnmanagedServer } from '../src/contract.ts'
import { en, zh, type SafeMarketLocaleKey } from '../src/client/locales.ts'
import { draftPlaintext, entryFromDraft, pendingToStore, validateDraft, type McpRow } from '../src/client/mcpModel.ts'
import {
  FEATURED_MCP_CATEGORIES,
  FEATURED_MCP_SERVERS,
  draftFromFeatured,
  featuredForServer,
  featuredRuntimeBadge,
  featuredTargetPreview,
  findInstalledFeatured,
  hasRequiredInputs,
  hasSecretInputs,
  matchesFeaturedMcp,
  matchesFeaturedRuntime,
  mcpIdentityKey,
  pickAvailableServerName,
  resolveFeaturedInstallOutcome,
  validateFeaturedValues,
} from '../src/client/mcpFeatured.ts'

const byId = (id: string) => {
  const item = FEATURED_MCP_SERVERS.find(entry => entry.id === id)
  assert.ok(item, `missing featured server ${id}`)
  return item
}

test('curated catalog invariants: valid unique ids, identity keys, transports, links, and locales', () => {
  const ids = new Set<string>()
  const keys = new Set<string>()
  const categories = new Set<string>(FEATURED_MCP_CATEGORIES)
  assert.ok(FEATURED_MCP_SERVERS.length >= 15)

  for (const category of FEATURED_MCP_CATEGORIES) {
    const key = `mcp.featured.category.${category}` as SafeMarketLocaleKey
    assert.ok(zh[key].trim() !== '', `missing zh copy for ${key}`)
    assert.ok(en[key].trim() !== '', `missing en copy for ${key}`)
  }

  for (const item of FEATURED_MCP_SERVERS) {
    assert.match(item.id, SERVER_NAME_PATTERN, `illegal id ${item.id}`)
    assert.equal(ids.has(item.id), false, `duplicate id ${item.id}`)
    ids.add(item.id)

    assert.ok(categories.has(item.category), `unknown category ${item.category}`)
    assert.ok(item.title.trim() !== '')
    assert.ok(item.publisher.trim() !== '')
    assert.ok(item.descriptionZh.trim() !== '')
    assert.ok(item.descriptionEn.trim() !== '')
    assert.match(item.icon ?? '', /^https:\/\//)
    assert.match(item.homepage, /^https:\/\//)

    const identity = mcpIdentityKey(item)
    assert.notEqual(identity, '', `empty identity key for ${item.id}`)
    assert.equal(keys.has(identity), false, `duplicate identity key ${identity}`)
    keys.add(identity)

    if (item.transport === 'streamable-http') {
      assert.match(item.url ?? '', /^https:\/\//)
      assert.equal(featuredRuntimeBadge(item), 'HTTP')
      assert.equal(featuredTargetPreview(item), item.url)
    } else {
      assert.ok((item.command ?? '').trim() !== '')
      assert.equal(featuredRuntimeBadge(item), item.command)
      assert.ok(featuredTargetPreview(item).startsWith(item.command!))
    }

    for (const input of item.inputs) {
      assert.ok(input.key.trim() !== '')
      assert.ok(input.labelZh.trim() !== '')
      assert.ok(input.labelEn.trim() !== '')
      if (input.helpUrl !== undefined) {
        assert.match(input.helpUrl, /^https:\/\//, `invalid helpUrl on ${item.id}.${input.key}`)
      }
    }
  }
})

test('mcpIdentityKey normalizes trailing slashes, package versions, uvx flags, and Windows cmd wrappers', () => {
  assert.equal(
    mcpIdentityKey({ transport: 'streamable-http', url: 'https://api.githubcopilot.com/mcp/' }),
    mcpIdentityKey({ transport: 'streamable-http', url: 'HTTPS://API.GITHUBCOPILOT.COM/mcp' }),
  )
  assert.equal(
    mcpIdentityKey({ transport: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'] }),
    'npx @playwright/mcp',
  )
  assert.equal(
    mcpIdentityKey({ transport: 'stdio', command: 'C:\\Windows\\System32\\cmd.exe', args: ['/c', 'npx.cmd', '-y', '@playwright/mcp@0.1.0'] }),
    'npx @playwright/mcp',
  )
  assert.equal(
    mcpIdentityKey({ transport: 'stdio', command: 'uvx', args: ['-p', '3.13', 'mcp-server-fetch'] }),
    'uvx mcp-server-fetch',
  )
})

test('findInstalledFeatured matches renamed managed rows, static rows, and plugin-registered rows', () => {
  const rows: McpRow[] = [
    {
      name: 'my-browser',
      source: 'user',
      entry: { transport: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@0.2.0'], enabled: true },
      plaintext: [],
      refs: [],
    },
    {
      name: 'deepwiki',
      source: 'registered',
      plaintext: [],
      refs: [],
    },
    {
      name: 'exa',
      source: 'retained',
      plaintext: [],
      refs: [],
    },
  ]
  const unmanaged: McpUnmanagedServer[] = [
    {
      entryId: 'static-ctx7',
      loaderId: 'include:static-ctx7',
      serverName: 'ctx7-local',
      transport: 'streamable-http',
      command: '',
      args: [],
      envKeys: [],
      url: 'https://mcp.context7.com/mcp/',
      headerKeys: [],
      enabled: true,
      phase: 'active',
      plaintextSecrets: [],
      adoptBlocker: '',
    },
  ]

  assert.deepEqual(findInstalledFeatured(byId('playwright'), rows, unmanaged), { name: 'my-browser', source: 'managed' })
  assert.deepEqual(findInstalledFeatured(byId('context7'), rows, unmanaged), { name: 'ctx7-local', source: 'static' })
  assert.deepEqual(findInstalledFeatured(byId('deepwiki'), rows, unmanaged), { name: 'deepwiki', source: 'managed' })
  assert.equal(findInstalledFeatured(byId('exa'), rows, unmanaged), null)
})

test('pickAvailableServerName avoids collisions and enforces 32-character limit', () => {
  assert.equal(pickAvailableServerName('context7', new Set()), 'context7')
  assert.equal(pickAvailableServerName('context7', new Set(['context7'])), 'context7-2')
  assert.equal(pickAvailableServerName('context7', new Set(['context7', 'context7-2'])), 'context7-3')

  const longId = 'a'.repeat(32)
  const picked = pickAvailableServerName(longId, new Set([longId]))
  assert.equal(picked.length, 32)
  assert.match(picked, SERVER_NAME_PATTERN)
  assert.ok(picked.endsWith('-2'))
})

test('validateFeaturedValues enforces server name rules and required inputs', () => {
  const github = byId('github')
  const ctx7 = byId('context7')
  assert.equal(hasRequiredInputs(github), true)
  assert.equal(hasSecretInputs(github), true)
  assert.equal(hasRequiredInputs(ctx7), false)
  assert.equal(hasSecretInputs(ctx7), true)

  assert.deepEqual(validateFeaturedValues(github, '', {}, new Set()), [
    { field: 'name', code: 'required' },
    { field: 'input', key: 'Authorization', code: 'required' },
  ])
  assert.deepEqual(validateFeaturedValues(github, 'bad name', { Authorization: 'tok' }, new Set()), [
    { field: 'name', code: 'pattern' },
  ])
  assert.deepEqual(validateFeaturedValues(github, 'github', { Authorization: 'tok' }, new Set(['github'])), [
    { field: 'name', code: 'taken' },
  ])
  assert.deepEqual(validateFeaturedValues(github, 'github', { Authorization: '${credential:bad-ref}' }, new Set()), [
    { field: 'input', key: 'Authorization', code: 'malformed' },
  ])
  assert.deepEqual(validateFeaturedValues(byId('filesystem'), 'filesystem', { dir: '/tmp/${env:HOME}' }, new Set()), [
    { field: 'input', key: 'dir', code: 'malformed' },
  ])
  assert.deepEqual(validateFeaturedValues(ctx7, 'context7', {}, new Set()), [])
})

test('draftFromFeatured moves secret headers and env vars into credentials without leaking plaintext', () => {
  const github = byId('github')
  const githubDraft = draftFromFeatured(github, { Authorization: 'github_pat_secret1234567890' }, {
    name: 'github',
    enabled: true,
    takenRefs: new Set(['MCP_GITHUB_AUTHORIZATION']),
  })
  assert.deepEqual(validateDraft(githubDraft, new Set()), [])
  assert.deepEqual(draftPlaintext(githubDraft), [])
  assert.deepEqual(githubDraft.headers, [
    { key: 'Authorization', value: 'Bearer ${credential:MCP_GITHUB_AUTHORIZATION_2}' },
  ])
  assert.deepEqual(pendingToStore(githubDraft), [
    { ref: 'MCP_GITHUB_AUTHORIZATION_2', value: 'github_pat_secret1234567890' },
  ])
  const serialized = JSON.stringify(entryFromDraft(githubDraft))
  assert.equal(serialized.includes('github_pat_secret1234567890'), false)

  // Already-templated credential references are kept verbatim with no duplicate pending secret.
  const templated = draftFromFeatured(github, { Authorization: '${credential:MY_GH_PAT}' }, {
    name: 'github',
    enabled: false,
  })
  assert.deepEqual(templated.headers, [{ key: 'Authorization', value: 'Bearer ${credential:MY_GH_PAT}' }])
  assert.deepEqual(pendingToStore(templated), [])
  assert.deepEqual(validateDraft(templated, new Set()), [])

  // Pasting a repeated `Bearer ` prefix (plaintext or template) never produces `Bearer Bearer …`.
  const repeatedPlain = draftFromFeatured(github, { Authorization: 'Bearer github_pat_secret9999999999' }, {
    name: 'github',
    enabled: true,
  })
  assert.deepEqual(repeatedPlain.headers, [{ key: 'Authorization', value: 'Bearer ${credential:MCP_GITHUB_AUTHORIZATION}' }])
  assert.deepEqual(pendingToStore(repeatedPlain), [{ ref: 'MCP_GITHUB_AUTHORIZATION', value: 'github_pat_secret9999999999' }])

  const repeatedTemplate = draftFromFeatured(github, { Authorization: 'Bearer ${credential:MY_GH_PAT}' }, {
    name: 'github',
    enabled: true,
  })
  assert.deepEqual(repeatedTemplate.headers, [{ key: 'Authorization', value: 'Bearer ${credential:MY_GH_PAT}' }])
  assert.deepEqual(pendingToStore(repeatedTemplate), [])

  // Mixed plaintext + credential template in a secret input is still routed through pending storage.
  const mixedSecret = draftFromFeatured(github, { Authorization: 'ghp_leak ${credential:MY_GH_PAT}' }, {
    name: 'github',
    enabled: true,
  })
  assert.equal(JSON.stringify(entryFromDraft(mixedSecret)).includes('ghp_leak'), false)
  assert.deepEqual(pendingToStore(mixedSecret), [
    { ref: 'MCP_GITHUB_AUTHORIZATION', value: 'ghp_leak ${credential:MY_GH_PAT}' },
  ])

  // Secret env var + arg input.
  const braveDraft = draftFromFeatured(byId('brave-search'), { BRAVE_API_KEY: 'BSA_secret_token_value' }, {
    name: 'brave-search',
    enabled: true,
  })
  assert.deepEqual(validateDraft(braveDraft, new Set()), [])
  assert.deepEqual(draftPlaintext(braveDraft), [])
  assert.deepEqual(braveDraft.env, [{ key: 'BRAVE_API_KEY', value: '${credential:MCP_BRAVE_SEARCH_BRAVE_API_KEY}' }])
  assert.deepEqual(pendingToStore(braveDraft), [{ ref: 'MCP_BRAVE_SEARCH_BRAVE_API_KEY', value: 'BSA_secret_token_value' }])

  const fsDraft = draftFromFeatured(byId('filesystem'), { dir: '/Users/dev/code' }, {
    name: 'filesystem',
    enabled: true,
  })
  assert.deepEqual(validateDraft(fsDraft, new Set()), [])
  assert.deepEqual(fsDraft.args, ['-y', '@modelcontextprotocol/server-filesystem', '/Users/dev/code'])

  // Flag-prefixed args (`-a` plain + `-s` secret templated as credential).
  const larkDraft = draftFromFeatured(byId('lark-mcp'), {
    APP_ID: 'cli_a1b2c3d4',
    APP_SECRET: 'super_secret_feishu_app_secret_1234',
  }, { name: 'lark-mcp', enabled: true })
  assert.deepEqual(validateDraft(larkDraft, new Set()), [])
  assert.deepEqual(draftPlaintext(larkDraft), [])
  assert.deepEqual(larkDraft.args, [
    '-y',
    '@larksuiteoapi/lark-mcp',
    'mcp',
    '-a',
    'cli_a1b2c3d4',
    '-s',
    '${credential:MCP_LARK_MCP_APP_SECRET}',
  ])
  assert.deepEqual(pendingToStore(larkDraft), [
    { ref: 'MCP_LARK_MCP_APP_SECRET', value: 'super_secret_feishu_app_secret_1234' },
  ])
})

test('the Draw.io featured draft passes its cold-start timeout to the Settings entry', () => {
  const draft = draftFromFeatured(byId('next-ai-drawio'), {}, { name: 'next-ai-drawio', enabled: true })
  assert.deepEqual(validateDraft(draft, new Set()), [])
  assert.equal(entryFromDraft(draft).startupTimeoutMs, 120_000)
})

test('matchesFeaturedMcp filters by category and Chinese/English/package queries', () => {
  const playwright = byId('playwright')
  assert.equal(matchesFeaturedMcp(playwright, '', 'all'), true)
  assert.equal(matchesFeaturedMcp(playwright, '', 'web-browser'), true)
  assert.equal(matchesFeaturedMcp(playwright, '', 'knowledge-research'), false)
  assert.equal(matchesFeaturedMcp(playwright, '浏览器', 'all'), true)
  assert.equal(matchesFeaturedMcp(playwright, '@playwright/mcp', 'all'), true)
  assert.equal(matchesFeaturedMcp(playwright, 'accessibility', 'web-browser'), true)
  assert.equal(matchesFeaturedMcp(playwright, 'nonexistent-xyz', 'all'), false)
  assert.equal(matchesFeaturedMcp(byId('amap-maps'), '高德', 'utilities'), true)
  assert.equal(matchesFeaturedMcp(byId('12306'), '火车票', 'utilities'), true)
  assert.equal(matchesFeaturedMcp(byId('lark-mcp'), '飞书', 'integrations-sharing'), true)
  assert.equal(matchesFeaturedMcp(byId('antv-chart'), '图表', 'media-vision'), true)
  assert.equal(matchesFeaturedMcp(byId('dbhub'), 'PostgreSQL', 'developer-tools'), true)
  assert.equal(matchesFeaturedMcp(byId('serena'), 'LSP', 'developer-tools'), true)
  assert.equal(matchesFeaturedMcp(byId('excel'), '透视表', 'utilities'), true)
  assert.equal(matchesFeaturedMcp(byId('arxiv'), '论文', 'knowledge-research'), true)
  assert.equal(matchesFeaturedMcp(byId('aihot'), '热点', 'knowledge-research'), true)
  assert.equal(matchesFeaturedMcp(byId('basic-memory'), 'Obsidian', 'agents-workflows'), true)
})

test('expanded curated servers keep secret credentials templated, arg flags intact, and fit within MAX_AI_MCP_LIMIT', () => {
  assert.ok(
    MAX_AI_MCP_LIMIT >= FEATURED_MCP_SERVERS.length,
    `MAX_AI_MCP_LIMIT (${MAX_AI_MCP_LIMIT}) must cover all ${FEATURED_MCP_SERVERS.length} featured MCP servers`,
  )

  const dbhubDraft = draftFromFeatured(byId('dbhub'), {
    DSN: 'postgres://readonly:super_secret_pw@db.example.com:5432/app',
  }, { name: 'dbhub', enabled: true })
  assert.deepEqual(validateDraft(dbhubDraft, new Set()), [])
  assert.deepEqual(draftPlaintext(dbhubDraft), [])
  assert.deepEqual(dbhubDraft.env, [{ key: 'DSN', value: '${credential:MCP_DBHUB_DSN}' }])
  assert.equal(JSON.stringify(entryFromDraft(dbhubDraft)).includes('super_secret_pw'), false)

  const excelDraft = draftFromFeatured(byId('excel'), { allowDir: '/Users/dev/sheets' }, {
    name: 'excel',
    enabled: true,
  })
  assert.deepEqual(validateDraft(excelDraft, new Set()), [])
  assert.deepEqual(excelDraft.args, ['excel-mcp-server', 'stdio', '--allow-dir', '/Users/dev/sheets'])

  const zoteroDefault = draftFromFeatured(byId('zotero'), {}, { name: 'zotero', enabled: true })
  assert.deepEqual(validateDraft(zoteroDefault, new Set()), [])
  assert.deepEqual(zoteroDefault.env, [{ key: 'ZOTERO_LOCAL', value: 'true' }])

  const serenaDraft = draftFromFeatured(byId('serena'), {}, { name: 'serena', enabled: true })
  assert.equal(entryFromDraft(serenaDraft).startupTimeoutMs, 120_000)

  const scraplingDraft = draftFromFeatured(byId('scrapling'), {}, { name: 'scrapling', enabled: true })
  assert.equal(entryFromDraft(scraplingDraft).startupTimeoutMs, 120_000)

  assert.equal(FEATURED_MCP_SERVERS.length, 100)
  assert.equal(byId('context7').inputs[0]?.helpUrl, 'https://context7.com/dashboard')
  assert.equal(byId('gitlab').inputs[0]?.helpUrl, 'https://gitlab.com/-/user_settings/personal_access_tokens')
  assert.equal(byId('supabase').inputs[0]?.helpUrl, 'https://supabase.com/dashboard/account/tokens')
  assert.equal(matchesFeaturedRuntime(byId('context7'), 'no-key'), true)
  assert.equal(matchesFeaturedRuntime(byId('github'), 'no-key'), false)
  assert.equal(matchesFeaturedRuntime(byId('drawio'), 'http'), true)
  assert.equal(matchesFeaturedRuntime(byId('dbhub'), 'npx'), true)
  assert.equal(matchesFeaturedRuntime(byId('duckdb'), 'uvx'), true)
  assert.equal(matchesFeaturedMcp(byId('duckdb'), 'Parquet', 'developer-tools', 'uvx'), true)
  assert.equal(matchesFeaturedMcp(byId('duckdb'), 'Parquet', 'developer-tools', 'npx'), false)
})

test('resolveFeaturedInstallOutcome tracks connecting, connected, failed, waiting, retry guards, and safe probe fallback', () => {
  const failedProbe = {
    status: 'done' as const,
    result: { ok: false, durationMs: 400, stage: 'connect', message: '401 unauthorized', closeConfirmed: true },
  }
  const errorProbe = {
    status: 'error' as const,
    message: 'already-connecting: wait for the managed MCP connection to settle',
  }
  const okProbe = {
    status: 'done' as const,
    result: { ok: true, durationMs: 220, toolNames: ['a', 'b'], truncated: false, closeConfirmed: true },
  }

  assert.equal(resolveFeaturedInstallOutcome(undefined, undefined), null)
  assert.equal(resolveFeaturedInstallOutcome({ state: 'connecting', attempt: 1 }, undefined), null)
  // Probe errors/failures must never mark a starting or not-yet-reported server as failed.
  assert.equal(resolveFeaturedInstallOutcome({ state: 'connecting', attempt: 1 }, errorProbe), null)
  assert.equal(resolveFeaturedInstallOutcome({ state: 'connecting', attempt: 1 }, failedProbe), null)
  assert.equal(resolveFeaturedInstallOutcome({ state: 'connecting', attempt: 1 }, okProbe), null)
  assert.equal(
    resolveFeaturedInstallOutcome(
      { state: 'reconnecting', attempt: 1, maxAttempts: 3, nextRetryAtMs: 5_000, lastError: 'transient' },
      errorProbe,
    ),
    null,
  )
  assert.equal(resolveFeaturedInstallOutcome(undefined, errorProbe), null)
  assert.equal(resolveFeaturedInstallOutcome(undefined, failedProbe), null)

  assert.deepEqual(
    resolveFeaturedInstallOutcome({ state: 'connected', toolCount: 12, connectedAt: 1000 }, undefined),
    { kind: 'connected', toolCount: 12 },
  )
  assert.deepEqual(
    resolveFeaturedInstallOutcome({ state: 'failed', reason: 'load', lastError: 'uvx not found' }, undefined),
    { kind: 'failed', reason: 'uvx not found' },
  )
  assert.deepEqual(
    resolveFeaturedInstallOutcome({ state: 'failed', reason: 'gave-up' }, undefined),
    { kind: 'failed', reason: 'gave-up' },
  )
  assert.deepEqual(
    resolveFeaturedInstallOutcome({ state: 'disabled' }, undefined),
    { kind: 'failed', reason: 'disabled' },
  )
  assert.equal(
    resolveFeaturedInstallOutcome({ state: 'disabled' }, undefined, { awaitingRetryTransition: true }),
    null,
  )
  assert.deepEqual(
    resolveFeaturedInstallOutcome({ state: 'waiting-credentials', lastError: 'missing' }, undefined),
    { kind: 'waiting' },
  )
  assert.deepEqual(
    resolveFeaturedInstallOutcome({ state: 'closed', result: { closeConfirmed: false, cleanupError: 'spawn ENOENT' } }, undefined),
    { kind: 'failed', reason: 'spawn ENOENT' },
  )
  assert.equal(resolveFeaturedInstallOutcome({ state: 'closed', result: { closeConfirmed: true } }, undefined), null)
  // Positive probe signal resolves connected when watch status is absent.
  assert.deepEqual(
    resolveFeaturedInstallOutcome(undefined, okProbe),
    { kind: 'connected', toolCount: 2 },
  )

  // Retry transition guard suppresses stale pre-retry failure frames while still accepting fresh connected/waiting outcomes.
  assert.equal(
    resolveFeaturedInstallOutcome(
      { state: 'failed', reason: 'load', lastError: 'stale error' },
      undefined,
      { awaitingRetryTransition: true },
    ),
    null,
  )
  assert.equal(
    resolveFeaturedInstallOutcome(
      { state: 'closed', result: { closeConfirmed: false, cleanupError: 'stale cleanup error' } },
      undefined,
      { awaitingRetryTransition: true },
    ),
    null,
  )
  assert.deepEqual(
    resolveFeaturedInstallOutcome(
      { state: 'connected', toolCount: 4, connectedAt: 2000 },
      undefined,
      { awaitingRetryTransition: true },
    ),
    { kind: 'connected', toolCount: 4 },
  )
  assert.deepEqual(
    resolveFeaturedInstallOutcome(
      { state: 'waiting-credentials', lastError: 'missing' },
      undefined,
      { awaitingRetryTransition: true },
    ),
    { kind: 'waiting' },
  )
})

test('featuredForServer resolves curated servers by launch target and optional targetless name fallback', () => {
  const github = byId('github')
  const filesystem = byId('filesystem')
  // Matches HTTP server by normalized URL regardless of local server name.
  assert.equal(
    featuredForServer({ transport: 'http', url: 'https://api.githubcopilot.com/mcp/' }, 'my-gh')?.id,
    github.id,
  )
  // Matches stdio server by normalized package/command identity.
  const fsEntry = entryFromDraft(draftFromFeatured(filesystem, { dir: '/tmp' }, { name: 'custom-fs', enabled: true }))
  assert.equal(featuredForServer(fsEntry, 'custom-fs')?.id, filesystem.id)
  // Falls back to exact catalog id ONLY when target is absent and name is provided (e.g. plugin-registered).
  assert.equal(featuredForServer(undefined, 'github')?.id, github.id)
  assert.equal(featuredForServer(undefined, ''), undefined)
  // When a target is present but does not match any curated server, never fall back to name.
  assert.equal(
    featuredForServer({ transport: 'http', url: 'https://custom.example.com/mcp' }, 'github'),
    undefined,
  )
})
