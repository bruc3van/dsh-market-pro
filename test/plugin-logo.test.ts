import { test } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { deriveMarket } from '../src/catalog.ts'
import { marketCatalogSchema, type MarketCatalog, type MarketPlugin } from '../src/contract.ts'
import { ownerAvatarUrl } from '../src/client/avatar.ts'
import { zh, type SafeMarketLocaleKey } from '../src/client/locales.ts'
import { createTestRenderer, findAll, loadClientBundle, textOf } from './support/react-test-harness.ts'
import {
  advanceIconFailure,
  currentIconStep,
  getPreferredJsDelivrHost,
  iconCandidatesOf,
  logoPlaceholderLetter,
  logoSourceChainOf,
  noteIconLoaded,
  resetPreferredJsDelivrHost,
} from '../src/client/iconMirrors.ts'

const {
  PluginLogo,
  DirectInstallPanel,
  MarketSection,
  getPreferredJsDelivrHost: getBundledPreferredJsDelivrHost,
  resetPreferredJsDelivrHost: resetBundledPreferredJsDelivrHost,
} = await loadClientBundle([
  "export { PluginLogo } from './src/client/PluginLogo.tsx'",
  "export { DirectInstallPanel } from './src/client/DirectInstallPanel.tsx'",
  "export { MarketSection } from './src/client/MarketSection.tsx'",
  "export { getPreferredJsDelivrHost, resetPreferredJsDelivrHost } from './src/client/iconMirrors.ts'",
].join('\n'))

const t = (key: SafeMarketLocaleKey, params?: Record<string, string>) => {
  let copy: string = zh[key]
  if (params) {
    for (const [k, v] of Object.entries(params)) copy = copy.replaceAll(`{${k}}`, v)
  }
  return copy
}

const DATA_SVG_ICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4='
const DATA_PNG_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const JSDELIVR_SVG_ICON = 'https://cdn.jsdelivr.net/gh/demo-org/alpha-plugin@main/assets/logo.svg'
const JSDELIVR_NPM_ICON = 'https://cdn.jsdelivr.net/npm/@demo/alpha@1.0.0/assets/logo.png'
const HTTPS_PNG_ICON = 'https://cdn.example.com/plugins/beta-plugin/logo.png'
const DEMO_AVATAR = 'https://avatars.githubusercontent.com/demo-org?s=96'

test('a plugin without its own icon falls back to its GitHub owner avatar', () => {
  assert.equal(ownerAvatarUrl('Owner-1/repo'), 'https://avatars.githubusercontent.com/Owner-1?s=96')
  for (const bad of [undefined, '', 'npm', 'owner', '-bad-/repo', 'a.b/repo', 'owner/repo/extra', 'javascript:x/y']) {
    assert.equal(ownerAvatarUrl(bad), undefined, String(bad))
  }
})

test('iconCandidatesOf leaves data URIs and non-jsDelivr URLs untouched while capping jsDelivr fallback to two edges', () => {
  resetPreferredJsDelivrHost()
  assert.deepEqual(iconCandidatesOf(DATA_SVG_ICON), [DATA_SVG_ICON])
  assert.deepEqual(iconCandidatesOf(HTTPS_PNG_ICON), [HTTPS_PNG_ICON])
  assert.deepEqual(iconCandidatesOf('https://example.com/logo.png'), ['https://example.com/logo.png'])
  assert.deepEqual(iconCandidatesOf(JSDELIVR_SVG_ICON), [
    'https://cdn.jsdelivr.net/gh/demo-org/alpha-plugin@main/assets/logo.svg',
    'https://fastly.jsdelivr.net/gh/demo-org/alpha-plugin@main/assets/logo.svg',
  ])
  assert.deepEqual(iconCandidatesOf(JSDELIVR_NPM_ICON), [
    'https://cdn.jsdelivr.net/npm/@demo/alpha@1.0.0/assets/logo.png',
    'https://fastly.jsdelivr.net/npm/@demo/alpha@1.0.0/assets/logo.png',
  ])
})

test('logoSourceChainOf appends the owner avatar once and keys the chain by its exact inputs', () => {
  resetPreferredJsDelivrHost()
  const chain = logoSourceChainOf(JSDELIVR_SVG_ICON, DEMO_AVATAR)
  assert.deepEqual(chain.sources, [
    'https://cdn.jsdelivr.net/gh/demo-org/alpha-plugin@main/assets/logo.svg',
    'https://fastly.jsdelivr.net/gh/demo-org/alpha-plugin@main/assets/logo.svg',
    DEMO_AVATAR,
  ])

  // An icon already pointing at the avatar is not tried twice.
  assert.deepEqual(logoSourceChainOf(DEMO_AVATAR, DEMO_AVATAR).sources, [DEMO_AVATAR])
  // No icon at all starts directly at the avatar; no avatar either means an empty chain.
  assert.deepEqual(logoSourceChainOf(undefined, DEMO_AVATAR).sources, [DEMO_AVATAR])
  assert.deepEqual(logoSourceChainOf(undefined, undefined).sources, [])
  assert.deepEqual(logoSourceChainOf('', undefined).sources, [])

  // The key distinguishes any input change so failure state resets across plugins.
  const base = logoSourceChainOf(JSDELIVR_SVG_ICON, DEMO_AVATAR).sourceKey
  assert.notEqual(logoSourceChainOf(JSDELIVR_NPM_ICON, DEMO_AVATAR).sourceKey, base)
  assert.notEqual(logoSourceChainOf(JSDELIVR_SVG_ICON, undefined).sourceKey, base)
  assert.equal(logoSourceChainOf(JSDELIVR_SVG_ICON, DEMO_AVATAR).sourceKey, base)
})

test('the failure chain walks cdn -> fastly -> avatar -> placeholder and resets when the source identity changes', () => {
  resetPreferredJsDelivrHost()
  // Renamed repository (404 on both jsDelivr edges): each error moves one step
  // down the chain, ending past the last source where the placeholder renders.
  const chain = logoSourceChainOf('https://cdn.jsdelivr.net/gh/demo-org/renamed-repo@main/logo.png', DEMO_AVATAR)
  let failure = { key: chain.sourceKey, step: 0 }
  const srcAt = () => chain.sources[currentIconStep(failure, chain.sourceKey)]

  assert.equal(srcAt(), 'https://cdn.jsdelivr.net/gh/demo-org/renamed-repo@main/logo.png')
  failure = advanceIconFailure(failure, chain.sourceKey)
  assert.equal(srcAt(), 'https://fastly.jsdelivr.net/gh/demo-org/renamed-repo@main/logo.png')
  failure = advanceIconFailure(failure, chain.sourceKey)
  assert.equal(srcAt(), DEMO_AVATAR)
  failure = advanceIconFailure(failure, chain.sourceKey)
  assert.equal(srcAt(), undefined, 'exhausting every candidate renders the built-in letter placeholder')

  // Switching to another plugin reads the failure state of the old identity as step zero.
  const other = logoSourceChainOf(DATA_SVG_ICON, undefined)
  assert.equal(currentIconStep(failure, other.sourceKey), 0)
  assert.equal(other.sources[0], DATA_SVG_ICON)

  // A failure arriving after the switch restarts at step 1 of the new chain instead of continuing the old count.
  const restarted = advanceIconFailure(failure, other.sourceKey)
  assert.equal(currentIconStep(restarted, other.sourceKey), 1)
})

test('logoPlaceholderLetter prefers the package part over the npm scope and falls back to P', () => {
  assert.equal(logoPlaceholderLetter('@demo/alpha'), 'A')
  assert.equal(logoPlaceholderLetter('beta-npm-only'), 'B')
  assert.equal(logoPlaceholderLetter('Pulumi'), 'P')
  assert.equal(logoPlaceholderLetter(''), 'P')
  assert.equal(logoPlaceholderLetter('@demo/'), 'P')
})

test('one transient failover must not switch the entire session, and a first-try load resets the streak', () => {
  resetPreferredJsDelivrHost()
  try {
    noteIconLoaded(JSDELIVR_SVG_ICON, 'https://fastly.jsdelivr.net/gh/demo-org/alpha-plugin@main/assets/logo.svg', true)
    assert.equal(getPreferredJsDelivrHost(), null, 'a single verified failover stays below the promotion threshold')

    // A normal first-try load resets the failover counter, so the next single failover restarts at one.
    noteIconLoaded(JSDELIVR_SVG_ICON, JSDELIVR_SVG_ICON, false)
    noteIconLoaded(JSDELIVR_SVG_ICON, 'https://fastly.jsdelivr.net/gh/demo-org/alpha-plugin@main/assets/logo.svg', true)
    assert.equal(getPreferredJsDelivrHost(), null)
  } finally {
    resetPreferredJsDelivrHost()
  }
})

test('two consecutive verified failovers promote the alternate edge for subsequent candidates', () => {
  resetPreferredJsDelivrHost()
  try {
    for (const src of [JSDELIVR_SVG_ICON, JSDELIVR_NPM_ICON]) {
      const fastly = iconCandidatesOf(src)[1]!
      noteIconLoaded(src, fastly, true)
      assert.match(fastly, /^https:\/\/fastly\.jsdelivr\.net\//)
    }
    assert.equal(getPreferredJsDelivrHost(), 'fastly.jsdelivr.net')

    // New cards put the proven edge first while keeping the origin host as fallback.
    assert.deepEqual(iconCandidatesOf(JSDELIVR_NPM_ICON), [
      'https://fastly.jsdelivr.net/npm/@demo/alpha@1.0.0/assets/logo.png',
      'https://cdn.jsdelivr.net/npm/@demo/alpha@1.0.0/assets/logo.png',
    ])

    // Loads landing on the already-preferred edge reset the pending streak instead of counting further.
    noteIconLoaded(JSDELIVR_NPM_ICON, 'https://fastly.jsdelivr.net/npm/@demo/alpha@1.0.0/assets/logo.png', true)
    noteIconLoaded(JSDELIVR_SVG_ICON, 'https://cdn.jsdelivr.net/gh/demo-org/alpha-plugin@main/assets/logo.svg', true)
    assert.equal(getPreferredJsDelivrHost(), 'fastly.jsdelivr.net', 'one cdn fallback after the reset stays below threshold')
  } finally {
    resetPreferredJsDelivrHost()
  }
})

test('alternating failover edges never accumulate a consecutive streak', () => {
  resetPreferredJsDelivrHost()
  try {
    const fastly = 'https://fastly.jsdelivr.net/gh/demo-org/alpha-plugin@main/assets/logo.svg'
    const cdn = 'https://cdn.jsdelivr.net/gh/demo-org/alpha-plugin@main/assets/logo.svg'
    for (const loaded of [fastly, cdn, fastly, cdn]) {
      noteIconLoaded(JSDELIVR_SVG_ICON, loaded, true)
    }
    assert.equal(getPreferredJsDelivrHost(), null)
  } finally {
    resetPreferredJsDelivrHost()
  }
})

test('noteIconLoaded ignores non-jsDelivr sources and loaded URLs', () => {
  resetPreferredJsDelivrHost()
  try {
    noteIconLoaded(HTTPS_PNG_ICON, HTTPS_PNG_ICON, true)
    noteIconLoaded(undefined, 'https://fastly.jsdelivr.net/gh/x/y@main/logo.png', true)
    noteIconLoaded(DATA_SVG_ICON, DATA_PNG_ICON, true)
    noteIconLoaded(JSDELIVR_SVG_ICON, 'https://cdn.example.com/logo.png', true)
    assert.equal(getPreferredJsDelivrHost(), null)
  } finally {
    resetPreferredJsDelivrHost()
  }
})

function mockCatalog(icons: { alpha: string; beta: string }): MarketCatalog {
  const body = {
    schema_version: 4,
    source_fetched_at: '2026-11-22T00:00:00Z',
    source_repo_count: 2,
    repository_count: 2,
    subscription_updated_at: '2026-11-22T00:00:00Z',
    category_table: [['agents-workflows', 'Agent 工作流', 'Agent workflows']],
    entries: [
      {
        n: 'demo-org/alpha-plugin',
        d: 'Alpha 插件',
        s: 120,
        c: 0,
        p: '2026-11-21',
        l: 'TypeScript',
        lic: 'MIT',
        is: 'command',
        tz: 'Alpha 插件',
        te: 'Alpha Plugin',
        de: 'Alpha plugin',
        pkg: { mode: 'command', targets: [{ install: '@demo/alpha@1.0.0', profile: 'web', note: '' }], tasks: [], requirements: [], note: '', manual: '' },
      },
    ],
    subscription: {
      format: 1,
      metadata: { categories: { 'agents-workflows': { title: { zh: 'Agent 工作流', en: 'Agent workflows' } } } },
      plugins: [
        {
          icon: icons.alpha,
          name: '@demo/alpha',
          title: { zh: 'Alpha 插件', en: 'Alpha Plugin' },
          description: { zh: '带仓库的订阅插件', en: 'Repo-backed plugin' },
          repository: { url: 'https://github.com/demo-org/alpha-plugin' },
          metadata: { category: 'agents-workflows', keywords: ['alpha'] },
          versions: [{ version: '1.0.0', source: { type: 'npm', registry: 'https://registry.npmjs.org/' }, engines: { dsh: '^0.2.2' } }],
        },
        {
          icon: icons.beta,
          name: 'beta-npm-only',
          title: { zh: 'Beta 纯包插件', en: 'Beta NPM-only Plugin' },
          description: { zh: '纯 npm 订阅插件', en: 'NPM-only plugin' },
          metadata: { category: 'agents-workflows', keywords: ['beta'] },
          versions: [{ version: '2.0.0', source: { type: 'npm', registry: 'https://registry.npmjs.org/' }, engines: { dsh: '^0.2.2' } }],
        },
      ],
    },
  }
  return marketCatalogSchema.parse(deriveMarket(body, 1000))
}

function makeDirectInstallerStub() {
  const snapshot = { phase: 'idle', spec: '', message: '', queue: [], pendingBuilds: [], recovering: false }
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    start: async () => {},
    approve: async () => {},
    cancel: async () => {},
    retry: async () => {},
    recover: async () => {},
    reset: () => {},
  }
}

function makeMarketSectionProps(catalog: MarketCatalog) {
  const snapshot = {
    value: { enabled: true, aiAssistantEnabled: false },
    settingsReady: true,
    profile: 'web',
    version: '1.12.0',
  }
  const catalogResult = { catalog, stale: false, error: '' }
  return {
    useScope: (selector: (value: typeof snapshot) => unknown) => selector(snapshot),
    updateSettings: async () => snapshot.value,
    loadCatalog: async () => catalogResult,
    peekCatalog: () => catalogResult,
    listSkills: async () => ({ skills: [], complete: true, error: '' }),
    skillsSession: { getSnapshot: () => 'ready', subscribe: () => () => {} },
    canOpenFolder: async () => false,
    openFolder: async () => {},
    install: async () => ({ ok: true as const }),
    installIntoNewWorkspace: async () => ({ ok: true as const }),
    chooseWorkspace: async () => ({ ok: false as const, reason: 'cancelled' as const }),
    workspaceReadiness: { getSnapshot: () => 'present' as const, subscribe: () => () => {} },
    listInstalled: async () => ({ packages: [], profile: 'web', error: '' }),
    setInstalledEnabled: async () => ({ packages: [], profile: 'web', error: '' }),
    uninstallInstalled: async () => ({ packages: [], profile: 'web', error: '' }),
    directInstaller: makeDirectInstallerStub(),
    close: () => {},
    t,
  }
}

test('PluginLogo wires jsDelivr failover, avatar fallback, placeholder rendering, and edge promotion', () => {
  resetBundledPreferredJsDelivrHost()
  try {
    const repoRenderer = createTestRenderer()
    const repoProps = {
      src: 'https://cdn.jsdelivr.net/gh/demo-org/renamed-repo@main/logo.png',
      name: '@demo/alpha',
      fullName: 'demo-org/alpha-plugin',
    }
    const step0 = findAll(repoRenderer.render(React.createElement(PluginLogo, repoProps)), node => node.type === 'img')[0]!
    assert.equal(step0.props.src, 'https://cdn.jsdelivr.net/gh/demo-org/renamed-repo@main/logo.png')
    assert.equal(step0.props.className, undefined)

    step0.props.onError()
    const step1 = findAll(repoRenderer.render(React.createElement(PluginLogo, repoProps)), node => node.type === 'img')[0]!
    assert.equal(step1.props.src, 'https://fastly.jsdelivr.net/gh/demo-org/renamed-repo@main/logo.png')

    step1.props.onError()
    const avatar = findAll(repoRenderer.render(React.createElement(PluginLogo, repoProps)), node => node.type === 'img')[0]!
    assert.equal(avatar.props.src, DEMO_AVATAR)

    avatar.props.onError()
    const placeholderTree = repoRenderer.render(React.createElement(PluginLogo, repoProps))
    assert.equal(findAll(placeholderTree, node => node.type === 'img').length, 0)
    assert.equal(textOf(findAll(placeholderTree, node => node.props.className === 'dsh_market_logoPlaceholder')[0]!), 'A')
    assert.equal(getBundledPreferredJsDelivrHost(), null)

    // Two consecutive verified failovers promote fastly for subsequent cards.
    for (const src of [JSDELIVR_SVG_ICON, JSDELIVR_NPM_ICON]) {
      const r = createTestRenderer()
      const props = { src, name: '@demo/alpha', fullName: 'demo-org/alpha-plugin' }
      findAll(r.render(React.createElement(PluginLogo, props)), node => node.type === 'img')[0]!.props.onError()
      const fastlyImg = findAll(r.render(React.createElement(PluginLogo, props)), node => node.type === 'img')[0]!
      assert.match(fastlyImg.props.src, /^https:\/\/fastly\.jsdelivr\.net\//)
      fastlyImg.props.onLoad()
    }
    assert.equal(getBundledPreferredJsDelivrHost(), 'fastly.jsdelivr.net')

    const nextCardRenderer = createTestRenderer()
    const nextCardImg = findAll(nextCardRenderer.render(React.createElement(PluginLogo, {
      src: JSDELIVR_NPM_ICON,
      name: '@demo/gamma',
      fullName: '',
    })), node => node.type === 'img')[0]!
    assert.equal(nextCardImg.props.src, 'https://fastly.jsdelivr.net/npm/@demo/alpha@1.0.0/assets/logo.png')
  } finally {
    resetBundledPreferredJsDelivrHost()
  }
})

test('list page (MarketSection) and detail view (DirectInstallPanel) propagate icons and fall back cleanly on error', () => {
  resetBundledPreferredJsDelivrHost()
  try {
    for (const icons of [
      { alpha: DATA_SVG_ICON, beta: DATA_PNG_ICON },
      { alpha: JSDELIVR_SVG_ICON, beta: HTTPS_PNG_ICON },
    ]) {
      resetBundledPreferredJsDelivrHost()
      const catalog = mockCatalog(icons)
      const renderer = createTestRenderer()
      const props = makeMarketSectionProps(catalog)
      const tree = renderer.render(React.createElement(MarketSection, props))
      const cards = findAll(tree, node => node.type === 'li' && String(node.props.className ?? '').includes('dsh_market_catalogCard'))
      assert.equal(cards.length, 2)
      assert.deepEqual(cards.map(card => findAll([card], node => node.type === 'img')[0]?.props.src), [icons.alpha, icons.beta])

      const firstInstallButton = findAll([cards[0]!], node => node.type === 'button')[0]!
      firstInstallButton.props.onClick()
      const withDetailTree = renderer.render(React.createElement(MarketSection, props))
      const detailHead = findAll(withDetailTree, node => node.props.className === 'dsh_market_directHead')[0]!
      assert.equal(findAll([detailHead], node => node.type === 'img')[0]?.props.src, icons.alpha)

      findAll([cards[1]!], node => node.type === 'img')[0]!.props.onError()
      const afterErrorTree = renderer.render(React.createElement(MarketSection, props))
      const cardsAfterError = findAll(afterErrorTree, node => node.type === 'li' && String(node.props.className ?? '').includes('dsh_market_catalogCard'))
      assert.equal(findAll([cardsAfterError[0]!], node => node.type === 'img')[0]?.props.src, icons.alpha)
      assert.equal(findAll([cardsAfterError[1]!], node => node.type === 'img').length, 0)
      assert.equal(textOf(findAll([cardsAfterError[1]!], node => node.props.className === 'dsh_market_logoPlaceholder')[0]!), 'B')
    }

    const base64Catalog = mockCatalog({ alpha: DATA_SVG_ICON, beta: DATA_PNG_ICON })
    const urlCatalog = mockCatalog({ alpha: JSDELIVR_SVG_ICON, beta: HTTPS_PNG_ICON })
    const panelProps = {
      installer: makeDirectInstallerStub(),
      t,
      onClose: () => {},
      onInstalled: () => {},
      onReview: async () => false,
      reviewBusy: false,
      reviewAvailable: true,
      reviewMessage: '',
    }
    const panelRenderer = createTestRenderer()
    const brokenItem: MarketPlugin = urlCatalog.featured!.entries[1]!.item
    findAll(panelRenderer.render(React.createElement(DirectInstallPanel, { ...panelProps, item: brokenItem })), node => node.type === 'img')[0]!.props.onError()
    const fallbackTree = panelRenderer.render(React.createElement(DirectInstallPanel, { ...panelProps, item: brokenItem }))
    assert.equal(findAll(fallbackTree, node => node.type === 'img').length, 0)
    assert.equal(textOf(findAll(fallbackTree, node => node.props.className === 'dsh_market_logoPlaceholder')[0]!), 'B')

    const recoveredTree = panelRenderer.render(React.createElement(DirectInstallPanel, { ...panelProps, item: base64Catalog.featured!.entries[0]!.item }))
    assert.equal(findAll(recoveredTree, node => node.type === 'img')[0]?.props.src, DATA_SVG_ICON)
  } finally {
    resetBundledPreferredJsDelivrHost()
  }
})

test('installed view prefers each installed package own local icon and falls back to featured catalog entries', async () => {
  resetBundledPreferredJsDelivrHost()
  try {
    const catalog = mockCatalog({ alpha: DATA_SVG_ICON, beta: DATA_PNG_ICON })
    const installedPackages = [
      {
        packageName: 'dsh-market-pro',
        icon: DATA_SVG_ICON,
        version: '1.15.1',
        description: 'Market Pro',
        repository: 'bruc3van/dsh-market-pro',
        self: true,
        inBox: false,
        unregistered: false,
        enabled: true,
        entries: [{ id: 'market', name: 'dsh-market-pro', present: true, enabled: true, phase: 'active' as const }],
        error: '',
        heldDown: false,
      },
      {
        packageName: 'beta-npm-only',
        version: '2.0.0',
        description: 'Beta local description',
        repository: '',
        self: false,
        inBox: false,
        unregistered: false,
        enabled: true,
        entries: [{ id: 'beta', name: 'beta-npm-only', present: true, enabled: true, phase: 'active' as const }],
        error: '',
        heldDown: false,
      },
    ]
    const props = {
      ...makeMarketSectionProps(catalog),
      listInstalled: async () => ({ packages: installedPackages, profile: 'web', error: '' }),
    }
    const renderer = createTestRenderer()
    renderer.render(React.createElement(MarketSection, props))
    renderer.flushEffects()
    await new Promise(resolve => setImmediate(resolve))
    const loadedTree = renderer.render(React.createElement(MarketSection, props))
    const installedTab = findAll(loadedTree, node => node.type === 'button' && textOf(node).includes(zh['installed.chip']))[0]!
    installedTab.props.onClick()
    const installedTree = renderer.render(React.createElement(MarketSection, props))
    const cards = findAll(installedTree, node => node.type === 'li' && String(node.props.className ?? '').includes('dsh_market_installedCard'))
    assert.equal(cards.length, 2)
    assert.equal(
      findAll([cards[0]!], node => node.type === 'img')[0]?.props.src,
      DATA_SVG_ICON,
      'installed card must render local package icon instead of degrading to GitHub owner avatar',
    )
    assert.equal(
      findAll([cards[1]!], node => node.type === 'img')[0]?.props.src,
      DATA_PNG_ICON,
      'installed card without local icon must match featured/subscription catalog icon',
    )
  } finally {
    resetBundledPreferredJsDelivrHost()
  }
})
