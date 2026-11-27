import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveMarket } from '../src/catalog.ts'
import { marketCatalogSchema, type MarketInstalledPackage } from '../src/contract.ts'
import { featuredRows, marketKey, marketRows, matches, pageOf } from '../src/client/rows.ts'
import { catalogItemCompatibility } from '../src/client/compatCopy.ts'
import { ownedBy, ownedIndexOf } from '../src/client/owned.ts'
import { isMarketIcon } from '../src/shapes.ts'

const repository = { full_name: 'owner/monorepo', description: 'Repository', category: 'agents-workflows', category_zh: 'Agent 工作流', category_en: 'Agent workflows' }
const packageRow = (name: string, overrides = {}) => ({
  name, title: { zh: `插件 ${name}`, en: `Plugin ${name}` }, description: { zh: '编排任务', en: 'Orchestrate tasks' },
  repository: { url: 'https://github.com/owner/monorepo' },
  metadata: { category: 'agents-workflows', keywords: ['工作流编排', 'orchestration'] },
  versions: [{ version: '1.2.3', source: { type: 'npm', registry: 'https://registry.npmjs.org/' }, engines: { dsh: '^0.2.2' } }], ...overrides,
})
const feed = (plugins = [packageRow('@demo/one'), packageRow('@demo/two')]) => ({
  schema_version: 3, entries: [repository, { ...repository, full_name: 'owner/archived', archived: true }],
  subscription_updated_at: '2026-11-17T07:27:26Z',
  subscription: { format: 1, metadata: { categories: { 'agents-workflows': { title: { zh: 'Agent 工作流', en: 'Agent workflows' } } } }, plugins },
})

test('complete catalog ignores legacy size cuts and preserves package identities and subscription categories', () => {
  const catalog = marketCatalogSchema.parse(deriveMarket(feed(), 1))
  assert.equal(catalog.items.length, 2)
  assert.ok(catalog.items[1]?.archived)
  assert.equal(catalog.featured?.count, 2)
  const picks = catalog.featured!
  assert.deepEqual(picks.entries.map(entry => entry.item.packageName), ['@demo/one', '@demo/two'])
  assert.equal(new Set(picks.entries.map(entry => marketKey(entry.item))).size, 2)
  assert.deepEqual(picks.categories, [{ key: 'agents-workflows', zh: 'Agent 工作流', en: 'Agent workflows', count: 2 }])
  assert.equal(featuredRows(picks, 'orchestration', false, 'agents-workflows').length, 2)
  assert.equal(featuredRows(picks, '', false, 'developer-tools').length, 0)
  assert.equal(marketRows(catalog.items, picks, 'one').length, 2, 'All remains a repository list')
  assert.ok(matches(picks.entries[0]!.item, 'plugin 编排', '', false))
})

test('editorial picks win as featured and omit the redundant subscription payload', () => {
  const body = {
    ...feed(),
    featured: {
      title_zh: '编辑精选', title_en: 'Editor picks', updated_at: '2026-11-17',
      entries: [
        { full_name: 'owner/monorepo', description: '编辑写的推荐语' },
        { full_name: 'owner/not-in-catalog', description: '目录外的推荐' },
      ],
    },
  }
  const catalog = marketCatalogSchema.parse(deriveMarket(body, 1000))
  const picks = catalog.featured
  assert.equal(picks?.count, 1, 'a pick with no install target and no row is dropped')
  const pick = picks?.entries[0]?.item
  assert.equal(pick?.description, '编辑写的推荐语', 'the editorial copy wins')
  assert.ok(['@demo/one', '@demo/two'].includes(pick?.packageName ?? ''), 'the subscription plugin identity wins')
  assert.equal(catalog.subscription, undefined, 'redundant subscription payload is omitted once editorial picks are resolved')
  assert.equal(catalog.categories.some(category => category.key === 'dsh:subscription'), false)
})

test('a schema-3 feed without editorial picks keeps the subscription as 精选', () => {
  const catalog = marketCatalogSchema.parse(deriveMarket(feed(), 1000))
  assert.equal(catalog.featured?.count, 2)
  assert.equal(catalog.subscription, undefined)
})

test('all subscription plugins survive beyond the old fifty-pick cap', () => {
  const catalog = deriveMarket(feed(Array.from({ length: 130 }, (_, i) => packageRow(`plugin-${i}`))), 1)
  assert.equal(catalog.featured?.entries.length, 130)
  assert.equal(catalog.featured?.count, 130)
})

test('npm-only, Gitee, and Git subdirectory packages retain usable links and exact pinned installs', () => {
  const catalog = marketCatalogSchema.parse(deriveMarket(feed([
    packageRow('npm-only', { repository: undefined }),
    packageRow('gitee-plugin', { repository: { url: 'https://gitee.com/demo/plugin' } }),
    packageRow('git-child', { versions: [{ version: '1.0.0', source: { type: 'git', url: 'https://github.com/owner/monorepo', commit: 'a'.repeat(40), path: 'plugins/child' } }] }),
  ]), 1000))
  const items = catalog.featured!.entries.map(entry => entry.item)
  assert.equal(items[0]?.fullName, '')
  assert.equal(items[0]?.url, 'https://www.npmjs.com/package/npm-only')
  assert.equal(items[0]?.installInfo?.targets[0]?.install, 'npm-only@1.2.3')
  assert.equal(items[1]?.url, 'https://gitee.com/demo/plugin')
  assert.equal(items[2]?.installInfo?.targets[0]?.install, `https://github.com/owner/monorepo#${'a'.repeat(40)}&path:plugins/child`)
})

test('plugin logos preserve supported image sources and discard executable or local URLs', () => {
  const dataIcon = 'data:image/svg+xml;base64,PHN2Zy8+'
  const icoIcon = 'data:image/vnd.microsoft.icon;base64,AAABAAE='
  const jsdelivrIcon = 'https://cdn.jsdelivr.net/gh/owner/monorepo@main/assets/logo.svg'
  const catalog = marketCatalogSchema.parse(deriveMarket(feed([
    packageRow('with-data-logo', { icon: dataIcon }),
    packageRow('with-ico-logo', { icon: icoIcon }),
    packageRow('with-jsdelivr-logo', { icon: jsdelivrIcon }),
    packageRow('without-logo'),
    packageRow('plaintext-http-logo', { icon: 'http://cdn.example.com/logo.png' }),
    packageRow('unsafe-logo', { icon: 'javascript:alert(1)' }),
    packageRow('credential-logo', { icon: 'https://user:pass@cdn.jsdelivr.net/logo.png' }),
  ]), 1000))
  assert.equal(catalog.featured?.entries[0]?.item.icon, dataIcon)
  assert.equal(catalog.featured?.entries[1]?.item.icon, icoIcon)
  assert.equal(catalog.featured?.entries[2]?.item.icon, jsdelivrIcon)
  assert.equal(catalog.featured?.entries[3]?.item.icon, undefined)
  assert.equal(catalog.featured?.entries[4]?.item.icon, undefined)
  assert.equal(catalog.featured?.entries[5]?.item.icon, undefined)
  assert.equal(catalog.featured?.entries[6]?.item.icon, undefined)
  assert.ok(isMarketIcon('https://example.com/logo.png'))
  assert.ok(isMarketIcon('https://cdn.jsdelivr.net/npm/demo@1.0.0/logo.png'))
  assert.ok(isMarketIcon('data:image/x-icon;base64,AAABAAE='))
  assert.ok(isMarketIcon('data:image/vnd.microsoft.icon;base64,AAABAAE='))
  assert.ok(!isMarketIcon('http://example.com/logo.png'))
  assert.ok(!isMarketIcon('file:///C:/logo.png'))
  assert.ok(!isMarketIcon('data:text/html;base64,PHN2Zy8+'))
  assert.ok(!isMarketIcon('https://user:pass@cdn.jsdelivr.net/logo.png'))
})

test('schema-4 compact catalogs hydrate both base64 data URI and jsDelivr URL icons from subscription', () => {
  const cases = [
    { label: 'base64 data URI', icon: 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=' },
    { label: 'base64 ICO (vnd.microsoft.icon)', icon: 'data:image/vnd.microsoft.icon;base64,AAABAAE=' },
    { label: 'jsDelivr HTTPS URL', icon: 'https://cdn.jsdelivr.net/gh/owner/monorepo@main/assets/logo.png' },
    { label: 'generic HTTPS URL', icon: 'https://cdn.example.com/plugins/one/logo.png' },
  ]
  for (const { label, icon } of cases) {
    const compactFeed = {
      schema_version: 4,
      source_fetched_at: '2026-11-22T00:00:00Z',
      source_repo_count: 1,
      repository_count: 1,
      subscription_updated_at: '2026-11-22T00:00:00Z',
      category_table: [['agents-workflows', 'Agent 工作流', 'Agent workflows']],
      entries: [{
        n: 'owner/monorepo',
        d: '编排任务',
        s: 42,
        c: 0,
        is: 'command',
        pkg: { mode: 'command', targets: [{ install: '@demo/one', profile: 'web', note: '' }], tasks: [], requirements: [], note: '', manual: '' },
      }],
      featured: {
        title_zh: '编辑精选',
        title_en: "Editor's Picks",
        updated_at: '2026-11-22',
        entries: [{ full_name: 'owner/monorepo', description: '编辑推荐语' }],
      },
      subscription: {
        format: 1,
        metadata: { categories: { 'agents-workflows': { title: { zh: 'Agent 工作流', en: 'Agent workflows' } } } },
        plugins: [packageRow('@demo/one', { icon })],
      },
    }
    const catalog = marketCatalogSchema.parse(deriveMarket(compactFeed, 1))
    assert.equal(catalog.items[0]?.icon, icon, `${label}: repository row must inherit icon`)
    assert.equal(catalog.featured?.entries[0]?.item.icon, icon, `${label}: featured entry must preserve icon`)
  }
})

test('repository rows carry install_status and the subscription plugin copy', () => {
  const body = {
    ...feed(),
    entries: [
      {
        ...repository,
        install_status: 'command',
        title_zh: '小部件',
        title_en: 'Widget',
        description_en: 'A widget plugin',
        packages: { mode: 'command', targets: [{ install: 'acme-widget', profile: 'web', note: '' }], tasks: [], requirements: [], note: '', manual: '' },
      },
      { ...repository, full_name: 'owner/unmapped', install_status: 'none' },
      { ...repository, full_name: 'owner/legacy' },
    ],
  }
  const catalog = marketCatalogSchema.parse(deriveMarket(body, 1000))
  const [mapped, unmapped, legacy] = catalog.items
  assert.equal(mapped?.installStatus, 'command')
  assert.equal(mapped?.titleZh, '小部件')
  assert.equal(mapped?.titleEn, 'Widget')
  assert.equal(mapped?.descriptionEn, 'A widget plugin')
  assert.equal(mapped?.installInfo?.targets[0]?.install, 'acme-widget')
  assert.equal(unmapped?.installStatus, 'none')
  assert.equal(unmapped?.installInfo, undefined)
  assert.equal(legacy?.installStatus, undefined)
  assert.equal(legacy?.titleZh, undefined)
})

test('broken subscription sources cannot quietly become a smaller featured set', () => {
  assert.throws(() => deriveMarket({ ...feed(), subscription: undefined }, 1000), /no published/)
  assert.throws(() => deriveMarket(feed([packageRow('same'), packageRow('same')]), 1000), /duplicate/)
  assert.throws(() => deriveMarket(feed([packageRow('bad', { versions: [{ version: '1.0.0', source: { type: 'git', url: 'https://evil.example/x/y', commit: 'a'.repeat(40) } }] })]), 1000), /install source/)
})

test('installed badges use exact package identity for monorepo siblings', () => {
  const installed = { packageName: '@demo/one', repository: 'owner/monorepo', error: '' } as MarketInstalledPackage
  const index = ownedIndexOf([installed])
  const picks = deriveMarket(feed(), 1000).featured!
  assert.equal(ownedBy(index, picks.entries[0]!.item), installed)
  assert.equal(ownedBy(index, picks.entries[1]!.item), undefined)
})

test('pagination searches the complete list and renders only the selected fifty results', () => {
  const items = Array.from({ length: 28440 }, (_, i) => i)
  const first = pageOf(items, 0), second = pageOf(items, 1), last = pageOf(items, 568)
  assert.deepEqual([first.total, first.pages, first.start, first.end, first.items.length], [28440, 569, 1, 50, 50])
  assert.equal(second.items[0], 50)
  assert.deepEqual([last.start, last.end, last.items.length], [28401, 28440, 40])
  assert.equal(pageOf(items.filter(i => i === 28439), 568).items[0], 28439)
  assert.equal(pageOf([], 568).items.length, 0)
})

test('schema-4 compact catalogs decode category_table, omitted defaults, and hydrate icons/keywords from subscription', () => {
  const icon = 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA='
  const compactFeed = {
    schema_version: 4,
    source_fetched_at: '2026-11-19T00:00:00Z',
    source_repo_count: 2,
    repository_count: 2,
    subscription_updated_at: '2026-11-19T00:00:00Z',
    category_table: [['agents-workflows', 'Agent 工作流', 'Agent workflows']],
    entries: [
      {
        n: 'owner/monorepo',
        d: '编排任务',
        s: 123,
        c: 0,
        p: '2026-11-18',
        l: 'TypeScript',
        lic: 'MIT',
        is: 'command',
        tz: '插件一',
        te: 'Plugin One',
        de: 'Orchestrate tasks',
        pkg: { mode: 'command', targets: [{ install: '@demo/one', profile: 'web', note: '' }], tasks: [], requirements: [], note: '', manual: '' },
      },
      {
        n: 'owner/unmapped',
        d: 'Catalog only',
        s: 5,
        c: 0,
        ar: 1,
      },
    ],
    featured: {
      title_zh: '编辑精选',
      title_en: "Editor's Picks",
      updated_at: '2026-11-19',
      entries: [{ full_name: 'owner/monorepo', description: '编辑推荐语' }],
    },
    subscription: {
      format: 1,
      metadata: { categories: { 'agents-workflows': { title: { zh: 'Agent 工作流', en: 'Agent workflows' } } } },
      plugins: [packageRow('@demo/one', { icon }), packageRow('@demo/two')],
    },
  }
  const catalog = marketCatalogSchema.parse(deriveMarket(compactFeed, 1))
  assert.equal(catalog.items.length, 2)
  const [mapped, unmapped] = catalog.items
  assert.equal(mapped?.category, 'agents-workflows')
  assert.equal(mapped?.categoryZh, 'Agent 工作流')
  assert.equal(mapped?.categoryEn, 'Agent workflows')
  assert.equal(mapped?.defaultBranch, 'main')
  assert.equal(mapped?.installStatus, 'command')
  assert.equal(mapped?.icon, icon, 'repository card must inherit deduplicated icon from subscription')
  assert.ok(mapped?.keywords?.includes('@demo/two'), 'repository card must inherit monorepo package keywords from subscription')
  assert.equal(unmapped?.installStatus, 'none')
  assert.equal(unmapped?.archived, true)
  assert.equal(catalog.featured?.entries[0]?.item.description, '编辑推荐语')
  assert.equal(catalog.subscription, undefined, 'hydrated compact catalog omits redundant subscription payload')
})

test('an editorial block with no surviving picks falls back to the subscription as the pick list', () => {
  const feed = {
    schema_version: 3,
    source_fetched_at: '2026-11-19T00:00:00Z',
    subscription_updated_at: '2026-11-19T00:00:00Z',
    entries: [{ full_name: 'owner/monorepo', description: 'Row', stargazers_count: 1, category: 'agents-workflows' }],
    featured: { entries: [{ full_name: 'ghost/missing' }] },
    subscription: {
      format: 1,
      metadata: { categories: { 'agents-workflows': { title: { zh: 'Agent 工作流', en: 'Agent workflows' } } } },
      plugins: [packageRow('@demo/one'), packageRow('@demo/two')],
    },
  }
  const catalog = marketCatalogSchema.parse(deriveMarket(feed, 1))
  assert.equal(catalog.featured?.count, 2, 'the subscription is still shown, as the pick list')
  assert.equal(catalog.subscription, undefined, 'subscription never travels without an editorial list')
})

test('deriveMarket falls back to compatible subscription versions and hydrates All repo targets without monorepo cross-contamination', () => {
  const rawFeed = {
    schema_version: 3,
    source_fetched_at: '2026-11-26T00:00:00Z',
    subscription_updated_at: '2026-11-26T00:00:00Z',
    entries: [
      {
        full_name: 'owner/monorepo',
        description: 'Monorepo',
        stargazers_count: 50,
        category: 'agents-workflows',
        packages: {
          mode: 'command',
          targets: [
            { install: '@demo/alpha@2.0.0', profile: 'web', note: 'Alpha' },
            { install: `https://github.com/owner/monorepo#${'a'.repeat(40)}&path:/packages/beta`, profile: 'web', note: 'Beta' },
          ],
          tasks: [],
          requirements: [],
          note: '',
          manual: '',
        },
      },
      {
        full_name: 'owner/standalone',
        description: 'Standalone',
        stargazers_count: 20,
        category: 'agents-workflows',
        packages: {
          mode: 'command',
          targets: [{ install: 'standalone@1.0.0', profile: 'web', note: '' }],
          tasks: [],
          requirements: [],
          note: '',
          manual: '',
        },
      },
    ],
    subscription: {
      format: 1,
      metadata: { categories: { 'agents-workflows': { title: { zh: 'Agent 工作流', en: 'Agent workflows' } } } },
      plugins: [
        packageRow('@demo/alpha', {
          versions: [
            { version: '2.0.0', source: { type: 'npm', registry: 'https://registry.npmjs.org/' }, engines: { dsh: '>=0.2.2-rc.1 <0.3.0' } },
            { version: '1.0.0', source: { type: 'npm', registry: 'https://registry.npmjs.org/' }, engines: { dsh: '^0.1.0 || ^0.2.0' } },
          ],
        }),
        packageRow('@demo/beta', {
          repository: { url: 'https://github.com/owner/monorepo', path: 'packages/beta' },
          versions: [
            { version: '3.0.0', source: { type: 'git', url: 'https://github.com/owner/monorepo.git', commit: 'a'.repeat(40), path: 'packages/beta' }, engines: { dsh: '>=0.3.0' } },
          ],
        }),
        packageRow('standalone', {
          repository: { url: 'https://github.com/owner/standalone' },
          versions: [
            { version: '1.0.0', source: { type: 'npm', registry: 'https://registry.npmjs.org/' }, engines: { dsh: '>=0.2.2-rc.1' } },
          ],
        }),
      ],
    },
  }

  const catalog = marketCatalogSchema.parse(deriveMarket(rawFeed, 10, '0.2.1'))
  const alphaEntry = catalog.featured?.entries.find(e => e.item.packageName === '@demo/alpha')
  assert.ok(alphaEntry)
  const alphaTarget = alphaEntry.item.installInfo?.targets[0]
  assert.equal(alphaTarget?.install, '@demo/alpha@1.0.0')
  assert.equal(alphaTarget?.dshEngine, '^0.1.0 || ^0.2.0')
  assert.deepEqual(alphaTarget?.compatFallback, {
    selectedVersion: '1.0.0',
    latestVersion: '2.0.0',
    latestEngine: '>=0.2.2-rc.1 <0.3.0',
  })

  const monoRepo = catalog.items.find(i => i.fullName === 'owner/monorepo')
  assert.ok(monoRepo?.installInfo)
  const [monoAlpha, monoBeta] = monoRepo.installInfo.targets
  assert.equal(monoAlpha?.dshEngine, '^0.1.0 || ^0.2.0')
  assert.deepEqual(monoAlpha?.compatFallback, {
    selectedVersion: '1.0.0',
    latestVersion: '2.0.0',
    latestEngine: '>=0.2.2-rc.1 <0.3.0',
  })
  assert.equal(monoBeta?.dshEngine, '>=0.3.0')
  assert.equal(monoBeta?.compatFallback, undefined)

  const standaloneRepo = catalog.items.find(i => i.fullName === 'owner/standalone')
  assert.equal(standaloneRepo?.installInfo?.targets[0]?.dshEngine, '>=0.2.2-rc.1')
})

test('Monorepo hydration never promotes one sibling constraint onto unconstrained targets, and skips malformed historical versions', () => {
  const partialFeed = {
    schema_version: 3,
    source_fetched_at: '2026-11-26T00:00:00Z',
    subscription_updated_at: '2026-11-26T00:00:00Z',
    entries: [
      {
        full_name: 'owner/mixed-mono',
        description: 'Mixed Monorepo',
        stargazers_count: 30,
        category: 'agents-workflows',
        packages: {
          mode: 'command',
          targets: [
            { install: '@demo/alpha@2.0.0', profile: 'web', note: 'Alpha' },
            { install: '@demo/unconstrained@1.0.0', profile: 'web', note: 'Beta' },
          ],
          tasks: [],
          requirements: [],
          note: '',
          manual: '',
        },
      },
    ],
    subscription: {
      format: 1,
      metadata: { categories: { 'agents-workflows': { title: { zh: 'Agent 工作流', en: 'Agent workflows' } } } },
      plugins: [
        packageRow('@demo/alpha', {
          repository: { url: 'https://github.com/owner/mixed-mono' },
          versions: [
            { version: '2.0.0', source: { type: 'npm', registry: 'https://registry.npmjs.org/' }, engines: { dsh: '>=0.3.0' } },
            // Malformed historical source must not abort loading the full catalog.
            { version: '1.0.0', source: { type: 'tarball', url: 'https://evil.example/a.tgz' } },
          ],
        }),
      ],
    },
  }

  const catalog = marketCatalogSchema.parse(deriveMarket(partialFeed, 10, '0.2.2-rc.1'))
  const mono = catalog.items[0]
  assert.ok(mono?.installInfo)
  assert.equal(mono.installInfo.targets[0]?.dshEngine, '>=0.3.0')
  assert.equal(mono.installInfo.targets[1]?.dshEngine, undefined)
  assert.deepEqual(mono.installInfo.requirements, [])
})

test('compatFallback hydration replaces incompatible latest dshEngine and stale requirements with the selected older release', () => {
  const fallbackFeed = {
    schema_version: 3,
    source_fetched_at: '2026-11-26T00:00:00Z',
    subscription_updated_at: '2026-11-26T00:00:00Z',
    entries: [
      {
        full_name: 'owner/fallback-with-engine',
        description: 'Fallback with engine',
        stargazers_count: 40,
        category: 'agents-workflows',
        packages: {
          mode: 'command',
          targets: [{ install: 'pkg-engine@2.0.0', profile: 'web', note: '' }],
          tasks: [],
          requirements: ['DSH >=0.3.0', 'Node >= 20'],
          note: '',
          manual: '',
        },
      },
      {
        full_name: 'owner/fallback-no-engine',
        description: 'Fallback without engine',
        stargazers_count: 35,
        category: 'agents-workflows',
        packages: {
          mode: 'command',
          targets: [{ install: 'pkg-plain@2.0.0', profile: 'web', note: '' }],
          tasks: [],
          requirements: ['DSH >=0.3.0'],
          note: '',
          manual: '',
        },
      },
    ],
    subscription: {
      format: 1,
      metadata: { categories: { 'agents-workflows': { title: { zh: 'Agent 工作流', en: 'Agent workflows' } } } },
      plugins: [
        packageRow('pkg-engine', {
          repository: { url: 'https://github.com/owner/fallback-with-engine' },
          versions: [
            { version: '2.0.0', source: { type: 'npm', registry: 'https://registry.npmjs.org/' }, engines: { dsh: '>=0.3.0' } },
            { version: '1.0.0', source: { type: 'npm', registry: 'https://registry.npmjs.org/' }, engines: { dsh: '>=0.2.0' } },
          ],
        }),
        packageRow('pkg-plain', {
          repository: { url: 'https://github.com/owner/fallback-no-engine' },
          versions: [
            { version: '2.0.0', source: { type: 'npm', registry: 'https://registry.npmjs.org/' }, engines: { dsh: '>=0.3.0' } },
            { version: '1.0.0', source: { type: 'npm', registry: 'https://registry.npmjs.org/' } },
          ],
        }),
      ],
    },
  }

  const catalog = marketCatalogSchema.parse(deriveMarket(fallbackFeed, 10, '0.2.2-rc.5'))

  const withEngine = catalog.items.find(i => i.fullName === 'owner/fallback-with-engine')
  assert.ok(withEngine?.installInfo)
  assert.equal(withEngine.installInfo.targets[0]?.install, 'pkg-engine@1.0.0')
  assert.equal(withEngine.installInfo.targets[0]?.dshEngine, '>=0.2.0')
  assert.deepEqual(withEngine.installInfo.requirements, ['Node >= 20', 'DSH >=0.2.0'])
  assert.equal(catalogItemCompatibility(withEngine, '0.2.2-rc.5'), undefined)

  const noEngine = catalog.items.find(i => i.fullName === 'owner/fallback-no-engine')
  assert.ok(noEngine?.installInfo)
  assert.equal(noEngine.installInfo.targets[0]?.install, 'pkg-plain@1.0.0')
  assert.equal(noEngine.installInfo.targets[0]?.dshEngine, undefined)
  assert.deepEqual(noEngine.installInfo.requirements, [])
  assert.equal(catalogItemCompatibility(noEngine, '0.2.2-rc.5'), undefined)
})
