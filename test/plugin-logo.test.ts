import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import React, { type ReactElement, type ReactNode } from 'react'
import { build } from 'esbuild'
import { deriveMarket } from '../src/catalog.ts'
import { marketCatalogSchema, type MarketCatalog, type MarketPlugin } from '../src/contract.ts'
import { ownerAvatarUrl } from '../src/client/avatar.ts'
import { zh, type SafeMarketLocaleKey } from '../src/client/locales.ts'

// The host supplies the shared UI primitives at runtime; keep react external so
// bundled components share the exact React dispatcher used by the test harness.
// Bundling all UI entrypoints together mirrors production `lib/client.js`, where
// `iconMirrors.ts` shares one module-level session preference across views.
const primitivesStub = {
  '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(new URL('./support/primitives-stub.tsx', import.meta.url)),
}
const requireFromTest = createRequire(import.meta.url)

async function loadClientModules(): Promise<Record<string, any>> {
  const result = await build({
    stdin: {
      contents: [
        "export { PluginLogo } from './src/client/PluginLogo.tsx'",
        "export { DirectInstallPanel } from './src/client/DirectInstallPanel.tsx'",
        "export { MarketSection } from './src/client/MarketSection.tsx'",
        "export { getPreferredJsDelivrHost, iconCandidatesOf, resetPreferredJsDelivrHost } from './src/client/iconMirrors.ts'",
      ].join('\n'),
      resolveDir: fileURLToPath(new URL('..', import.meta.url)),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    external: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    alias: primitivesStub,
  })
  const mod = { exports: {} as Record<string, any> }
  const run = new Function('require', 'module', 'exports', result.outputFiles[0]!.text)
  run(requireFromTest, mod, mod.exports)
  return mod.exports
}

const {
  PluginLogo,
  DirectInstallPanel,
  MarketSection,
  getPreferredJsDelivrHost,
  iconCandidatesOf,
  resetPreferredJsDelivrHost,
} = await loadClientModules()

// Minimal React 18 function-component tree renderer with persistent per-path hook
// state so real TSX components (including `useState`/`useMemo` transitions via
// `onError`/`onLoad`) can be rendered and verified in Node without react-dom.
type HookSlot = { value: unknown; deps?: readonly unknown[] }
type RenderedNode =
  | { kind: 'element'; type: string; props: Record<string, any>; children: RenderedNode[] }
  | { kind: 'text'; value: string }

const ReactInternals = (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED

function sameDeps(prev: readonly unknown[] | undefined, next: readonly unknown[] | undefined): boolean {
  if (prev === undefined || next === undefined || prev.length !== next.length) return false
  for (let i = 0; i < prev.length; i += 1) {
    if (!Object.is(prev[i], next[i])) return false
  }
  return true
}

function createTestRenderer() {
  const hookStore = new Map<string, HookSlot[]>()
  const pendingEffects: (() => void)[] = []
  let idCounter = 0

  function renderComponent(fn: (props: any) => ReactNode, props: any, path: string): ReactNode {
    const slots = hookStore.get(path) ?? []
    hookStore.set(path, slots)
    let cursor = 0
    const nextSlot = (init: () => unknown): HookSlot => {
      const index = cursor++
      if (index >= slots.length) slots.push({ value: init() })
      return slots[index]!
    }
    const previousDispatcher = ReactInternals.ReactCurrentDispatcher.current
    ReactInternals.ReactCurrentDispatcher.current = {
      useState<S>(initial: S | (() => S)) {
        const slot = nextSlot(() => (typeof initial === 'function' ? (initial as () => S)() : initial))
        const setState = (next: S | ((prev: S) => S)) => {
          slot.value = typeof next === 'function' ? (next as (prev: S) => S)(slot.value as S) : next
        }
        return [slot.value as S, setState]
      },
      useReducer<S, A>(reducer: (state: S, action: A) => S, initialArg: S, init?: (arg: S) => S) {
        const slot = nextSlot(() => (init ? init(initialArg) : initialArg))
        const dispatch = (action: A) => { slot.value = reducer(slot.value as S, action) }
        return [slot.value as S, dispatch]
      },
      useRef<T>(initial: T) {
        return nextSlot(() => ({ current: initial })).value
      },
      useMemo<T>(factory: () => T, deps?: readonly unknown[]) {
        const index = cursor++
        const existing = slots[index]
        if (existing !== undefined && sameDeps(existing.deps, deps)) {
          return existing.value as T
        }
        const value = factory()
        slots[index] = { value, deps }
        return value
      },
      useCallback<T>(callback: T, deps?: readonly unknown[]) {
        const index = cursor++
        const existing = slots[index]
        if (existing !== undefined && sameDeps(existing.deps, deps)) {
          return existing.value as T
        }
        slots[index] = { value: callback, deps }
        return callback
      },
      useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
        const index = cursor++
        const existing = slots[index]
        if (existing !== undefined && deps !== undefined && sameDeps(existing.deps, deps)) return
        slots[index] = { value: effect, deps }
        pendingEffects.push(() => { effect() })
      },
      useLayoutEffect() {},
      useId() {
        return nextSlot(() => `:r${String(idCounter++)}:`).value
      },
      useSyncExternalStore<T>(_subscribe: unknown, getSnapshot: () => T) {
        return getSnapshot()
      },
      useContext(ctx: { _currentValue?: unknown }) {
        return ctx._currentValue
      },
    }
    try {
      return fn(props)
    } finally {
      ReactInternals.ReactCurrentDispatcher.current = previousDispatcher
    }
  }

  function expand(node: ReactNode, path = 'root'): RenderedNode[] {
    if (node === null || node === undefined || typeof node === 'boolean') return []
    if (typeof node === 'string' || typeof node === 'number') return [{ kind: 'text', value: String(node) }]
    if (Array.isArray(node)) {
      return node.flatMap((child, index) => expand(child, `${path}[${String(index)}]`))
    }
    const element = node as ReactElement<any>
    if (element.type === React.Fragment) {
      return expand(element.props?.children, `${path}.frag`)
    }
    if (typeof element.type === 'function') {
      const name = element.type.name || 'anon'
      const key = element.key === null || element.key === undefined ? '' : `#${String(element.key)}`
      const nextPath = `${path}/${name}${key}`
      return expand(renderComponent(element.type as (props: any) => ReactNode, element.props ?? {}, nextPath), nextPath)
    }
    if (typeof element.type === 'object' && element.type !== null && 'render' in element.type) {
      const renderFn = (element.type as { render: (props: any, ref: unknown) => ReactNode }).render
      const nextPath = `${path}/forwardRef`
      return expand(renderComponent(props => renderFn(props, null), element.props ?? {}, nextPath), nextPath)
    }
    if (typeof element.type === 'string') {
      return [{
        kind: 'element',
        type: element.type,
        props: element.props ?? {},
        children: expand(element.props?.children, `${path}/${element.type}`),
      }]
    }
    return []
  }

  return {
    render(element: ReactElement): RenderedNode[] {
      return expand(element)
    },
    flushEffects(): void {
      while (pendingEffects.length > 0) {
        pendingEffects.shift()!()
      }
    },
  }
}

function findAll(nodes: readonly RenderedNode[], predicate: (node: Extract<RenderedNode, { kind: 'element' }>) => boolean): Extract<RenderedNode, { kind: 'element' }>[] {
  const matches: Extract<RenderedNode, { kind: 'element' }>[] = []
  for (const node of nodes) {
    if (node.kind !== 'element') continue
    if (predicate(node)) matches.push(node)
    matches.push(...findAll(node.children, predicate))
  }
  return matches
}

function textOf(node: RenderedNode): string {
  if (node.kind === 'text') return node.value
  return node.children.map(textOf).join('')
}

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

test('PluginLogo renders data URI and HTTPS URLs format-agnostically, fails over two jsDelivr edges, and requires consecutive failovers before promoting an edge', () => {
  resetPreferredJsDelivrHost()
  try {
    for (const icon of [DATA_SVG_ICON, DATA_PNG_ICON, JSDELIVR_SVG_ICON, HTTPS_PNG_ICON]) {
      const renderer = createTestRenderer()
      const tree = renderer.render(React.createElement(PluginLogo, {
        src: icon,
        name: '@demo/alpha',
        fullName: 'demo-org/alpha-plugin',
      }))
      const imgs = findAll(tree, node => node.type === 'img')
      assert.equal(imgs.length, 1)
      assert.equal(imgs[0]!.props.src, icon)
      assert.equal(imgs[0]!.props.className, undefined)
    }

    // 1. Renamed repository (404 on both jsDelivr edges):
    // cdn -> fastly -> owner GitHub avatar -> built-in letter placeholder,
    // without corrupting session edge preference.
    const repoRenderer = createTestRenderer()
    const repoProps = {
      src: 'https://cdn.jsdelivr.net/gh/demo-org/renamed-repo@main/logo.png',
      name: '@demo/alpha',
      fullName: 'demo-org/alpha-plugin',
    }
    const step0Img = findAll(repoRenderer.render(React.createElement(PluginLogo, repoProps)), node => node.type === 'img')[0]!
    assert.equal(step0Img.props.src, 'https://cdn.jsdelivr.net/gh/demo-org/renamed-repo@main/logo.png')
    assert.equal(step0Img.props.className, undefined)

    step0Img.props.onError()
    const step1Img = findAll(repoRenderer.render(React.createElement(PluginLogo, repoProps)), node => node.type === 'img')[0]!
    assert.equal(step1Img.props.src, 'https://fastly.jsdelivr.net/gh/demo-org/renamed-repo@main/logo.png')
    assert.equal(step1Img.props.className, undefined, 'jsDelivr mirror keeps plugin logo styling')

    step1Img.props.onError()
    const avatarImg = findAll(repoRenderer.render(React.createElement(PluginLogo, repoProps)), node => node.type === 'img')[0]!
    assert.equal(avatarImg.props.src, 'https://avatars.githubusercontent.com/demo-org?s=96')
    assert.equal(avatarImg.props.className, undefined, 'avatar fallback keeps tile framing without circular crop')

    avatarImg.props.onError()
    const placeholderTree = repoRenderer.render(React.createElement(PluginLogo, repoProps))
    assert.equal(findAll(placeholderTree, node => node.type === 'img').length, 0)
    const placeholder = findAll(placeholderTree, node => node.props.className === 'dsh_market_logoPlaceholder')[0]!
    assert.equal(textOf(placeholder), 'A')
    assert.equal(getPreferredJsDelivrHost(), null, 'all-404 repository icon must not promote an alternate edge')

    // Switching to another plugin synchronously resets failure state on the same mounted instance.
    const switchedImg = findAll(repoRenderer.render(React.createElement(PluginLogo, {
      src: DATA_SVG_ICON,
      name: 'other-plugin',
      fullName: 'other-org/other-plugin',
    })), node => node.type === 'img')[0]!
    assert.equal(switchedImg.props.src, DATA_SVG_ICON)

    // 2. Single transient failure on `cdn.jsdelivr.net` does NOT flip the session, and a first-try load resets the streak.
    const hiccupRenderer = createTestRenderer()
    const hiccupProps = { src: JSDELIVR_SVG_ICON, name: '@demo/alpha', fullName: 'demo-org/alpha-plugin' }
    const hiccupImg = findAll(hiccupRenderer.render(React.createElement(PluginLogo, hiccupProps)), node => node.type === 'img')[0]!
    hiccupImg.props.onError()
    const hiccupFastly = findAll(hiccupRenderer.render(React.createElement(PluginLogo, hiccupProps)), node => node.type === 'img')[0]!
    assert.equal(hiccupFastly.props.src, 'https://fastly.jsdelivr.net/gh/demo-org/alpha-plugin@main/assets/logo.svg')
    hiccupFastly.props.onLoad()
    assert.equal(getPreferredJsDelivrHost(), null, 'one transient failover must not switch the entire session')

    // A normal first-try load resets the failover counter.
    const healthyRenderer = createTestRenderer()
    const healthyImg = findAll(healthyRenderer.render(React.createElement(PluginLogo, hiccupProps)), node => node.type === 'img')[0]!
    assert.equal(healthyImg.props.src, JSDELIVR_SVG_ICON)
    healthyImg.props.onLoad()

    // 3. Two consecutive verified failovers promote `fastly.jsdelivr.net` for subsequent cards in the session.
    for (const src of [JSDELIVR_SVG_ICON, JSDELIVR_NPM_ICON]) {
      const cnRenderer = createTestRenderer()
      const props = { src, name: '@demo/alpha', fullName: 'demo-org/alpha-plugin' }
      const blocked = findAll(cnRenderer.render(React.createElement(PluginLogo, props)), node => node.type === 'img')[0]!
      blocked.props.onError()
      const fastly = findAll(cnRenderer.render(React.createElement(PluginLogo, props)), node => node.type === 'img')[0]!
      assert.match(fastly.props.src, /^https:\/\/fastly\.jsdelivr\.net\//)
      fastly.props.onLoad()
    }
    assert.equal(getPreferredJsDelivrHost(), 'fastly.jsdelivr.net')

    const nextCardRenderer = createTestRenderer()
    const nextCardImg = findAll(nextCardRenderer.render(React.createElement(PluginLogo, {
      src: JSDELIVR_NPM_ICON,
      name: '@demo/gamma',
      fullName: '',
    })), node => node.type === 'img')[0]!
    assert.equal(nextCardImg.props.src, 'https://fastly.jsdelivr.net/npm/@demo/alpha@1.0.0/assets/logo.png')

    // 4. Broken non-jsDelivr URL on an npm-only plugin falls directly to built-in placeholder.
    const npmRenderer = createTestRenderer()
    const npmProps = { src: HTTPS_PNG_ICON, name: 'beta-npm-only', fullName: '' }
    const npmFirstImg = findAll(npmRenderer.render(React.createElement(PluginLogo, npmProps)), node => node.type === 'img')[0]!
    assert.equal(npmFirstImg.props.src, HTTPS_PNG_ICON)
    npmFirstImg.props.onError()
    const npmFallbackTree = npmRenderer.render(React.createElement(PluginLogo, npmProps))
    assert.equal(findAll(npmFallbackTree, node => node.type === 'img').length, 0)
    const npmPlaceholder = findAll(npmFallbackTree, node => node.props.className === 'dsh_market_logoPlaceholder')[0]!
    assert.equal(textOf(npmPlaceholder), 'B')
  } finally {
    resetPreferredJsDelivrHost()
  }
})

test('list page (MarketSection) renders both base64 data URI and jsDelivr HTTPS URL mocks and survives broken URLs', () => {
  resetPreferredJsDelivrHost()
  try {
    const cases = [
      { label: 'base64 mock', icons: { alpha: DATA_SVG_ICON, beta: DATA_PNG_ICON } },
      { label: 'HTTPS URL mock', icons: { alpha: JSDELIVR_SVG_ICON, beta: HTTPS_PNG_ICON } },
    ]
    for (const { label, icons } of cases) {
      resetPreferredJsDelivrHost()
      const catalog = mockCatalog(icons)
      const renderer = createTestRenderer()
      const props = makeMarketSectionProps(catalog)
      const tree = renderer.render(React.createElement(MarketSection, props))
      const cards = findAll(tree, node => node.type === 'li' && String(node.props.className ?? '').includes('dsh_market_catalogCard'))
      assert.equal(cards.length, 2, `${label}: both subscription cards should render on the list page`)
      const renderedSrcs = cards.map(card => findAll([card], node => node.type === 'img')[0]?.props.src)
      assert.deepEqual(renderedSrcs, [icons.alpha, icons.beta], `${label}: card icons must pass straight into <img src>`)

      // Clicking the card's install button opens the detail panel (DirectInstallPanel) with the same icon.
      const firstInstallButton = findAll([cards[0]!], node => node.type === 'button')[0]!
      firstInstallButton.props.onClick()
      const withDetailTree = renderer.render(React.createElement(MarketSection, props))
      const detailHead = findAll(withDetailTree, node => node.props.className === 'dsh_market_directHead')[0]!
      assert.equal(findAll([detailHead], node => node.type === 'img')[0]?.props.src, icons.alpha, `${label}: opened detail view must render the same icon`)

      // Trigger image failure on the npm-only card and re-render the entire list page:
      // the failed card falls back to the built-in placeholder while the sibling card remains intact.
      const secondImg = findAll([cards[1]!], node => node.type === 'img')[0]!
      secondImg.props.onError()
      const afterErrorTree = renderer.render(React.createElement(MarketSection, props))
      const cardsAfterError = findAll(afterErrorTree, node => node.type === 'li' && String(node.props.className ?? '').includes('dsh_market_catalogCard'))
      assert.equal(cardsAfterError.length, 2, `${label}: list page must not crash when one icon fails`)
      assert.equal(findAll([cardsAfterError[0]!], node => node.type === 'img')[0]?.props.src, icons.alpha)
      assert.equal(findAll([cardsAfterError[1]!], node => node.type === 'img').length, 0)
      const fallbackBadge = findAll([cardsAfterError[1]!], node => node.props.className === 'dsh_market_logoPlaceholder')[0]!
      assert.equal(textOf(fallbackBadge), 'B')
    }
  } finally {
    resetPreferredJsDelivrHost()
  }
})

test('detail view (DirectInstallPanel) renders both base64 data URI and jsDelivr HTTPS URL mocks and falls back on error', () => {
  resetPreferredJsDelivrHost()
  try {
    const base64Catalog = mockCatalog({ alpha: DATA_SVG_ICON, beta: DATA_PNG_ICON })
    const urlCatalog = mockCatalog({ alpha: JSDELIVR_SVG_ICON, beta: HTTPS_PNG_ICON })
    const scenarios: { label: string; item: MarketPlugin; expectedSrc: string }[] = [
      { label: 'base64 SVG (repo plugin)', item: base64Catalog.featured!.entries[0]!.item, expectedSrc: DATA_SVG_ICON },
      { label: 'base64 PNG (npm-only plugin)', item: base64Catalog.featured!.entries[1]!.item, expectedSrc: DATA_PNG_ICON },
      { label: 'jsDelivr HTTPS URL (repo plugin)', item: urlCatalog.featured!.entries[0]!.item, expectedSrc: JSDELIVR_SVG_ICON },
      { label: 'HTTPS URL (npm-only plugin)', item: urlCatalog.featured!.entries[1]!.item, expectedSrc: HTTPS_PNG_ICON },
    ]

    const installer = makeDirectInstallerStub()
    const baseProps = {
      installer,
      t,
      onClose: () => {},
      onInstalled: () => {},
      onReview: async () => false,
      reviewBusy: false,
      reviewAvailable: true,
      reviewMessage: '',
    }

    for (const { label, item, expectedSrc } of scenarios) {
      const renderer = createTestRenderer()
      const tree = renderer.render(React.createElement(DirectInstallPanel, { ...baseProps, item }))
      const head = findAll(tree, node => node.props.className === 'dsh_market_directHead')[0]!
      const img = findAll([head], node => node.type === 'img')[0]!
      assert.equal(img.props.src, expectedSrc, `${label}: detail panel must pass icon directly into <img src>`)
    }

    // Verify fallback on broken URL inside the detail panel, and clean recovery when switching to another plugin.
    const panelRenderer = createTestRenderer()
    const brokenUrlItem = urlCatalog.featured!.entries[1]!.item
    const firstTree = panelRenderer.render(React.createElement(DirectInstallPanel, { ...baseProps, item: brokenUrlItem }))
    const firstImg = findAll(firstTree, node => node.type === 'img')[0]!
    assert.equal(firstImg.props.src, HTTPS_PNG_ICON)
    firstImg.props.onError()

    const fallbackTree = panelRenderer.render(React.createElement(DirectInstallPanel, { ...baseProps, item: brokenUrlItem }))
    assert.equal(findAll(fallbackTree, node => node.type === 'img').length, 0)
    const badge = findAll(fallbackTree, node => node.props.className === 'dsh_market_logoPlaceholder')[0]!
    assert.equal(textOf(badge), 'B')

    const nextItem = base64Catalog.featured!.entries[0]!.item
    const recoveredTree = panelRenderer.render(React.createElement(DirectInstallPanel, { ...baseProps, item: nextItem }))
    const recoveredImg = findAll(recoveredTree, node => node.type === 'img')[0]!
    assert.equal(recoveredImg.props.src, DATA_SVG_ICON)
  } finally {
    resetPreferredJsDelivrHost()
  }
})

test('installed view prefers each installed package own local icon and falls back to featured catalog entries', async () => {
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
  const baseProps = makeMarketSectionProps(catalog)
  const props = {
    ...baseProps,
    listInstalled: async () => ({ packages: installedPackages, profile: 'web', error: '' }),
  }
  const renderer = createTestRenderer()
  const initialTree = renderer.render(React.createElement(MarketSection, props))
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
  assert.ok(initialTree.length > 0)
})
