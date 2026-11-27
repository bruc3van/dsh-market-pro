import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { readdir, readFile } from 'node:fs/promises'
import React, { type ReactElement } from 'react'
import { build } from 'esbuild'

const primitivesStub = {
  '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(new URL('./support/primitives-stub.tsx', import.meta.url)),
}
const requireFromTest = createRequire(import.meta.url)

async function loadMarketDescription(): Promise<(props: { text: string }) => ReactElement> {
  const result = await build({
    stdin: {
      contents: "export { MarketDescription } from './src/client/MarketDescription.tsx'",
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
  return mod.exports.MarketDescription
}

const MarketDescription = await loadMarketDescription()
const ReactInternals = (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED

function createHarness(initialEl: { scrollHeight: number; clientHeight: number; scrollWidth: number; clientWidth: number } | null) {
  const ref = { current: initialEl }
  let clipped = false
  let setCount = 0
  let pendingEffect: (() => void | (() => void)) | null = null
  let cleanup: (() => void) | null = null
  let lastDeps: readonly unknown[] | undefined

  const render = (text: string): ReactElement<any> => {
    const previousDispatcher = ReactInternals.ReactCurrentDispatcher.current
    ReactInternals.ReactCurrentDispatcher.current = {
      useRef() { return ref },
      useState<S>() {
        return [clipped as unknown as S, (next: S | ((prev: S) => S)) => {
          const resolved = typeof next === 'function' ? (next as (prev: S) => S)(clipped as unknown as S) : next
          setCount += 1
          clipped = resolved as unknown as boolean
        }]
      },
      useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
        const changed = lastDeps === undefined
          || deps === undefined
          || deps.length !== lastDeps.length
          || deps.some((dep, i) => !Object.is(dep, lastDeps![i]))
        if (changed) {
          lastDeps = deps
          pendingEffect = effect
        }
      },
    }
    try {
      return MarketDescription({ text }) as ReactElement<any>
    } finally {
      ReactInternals.ReactCurrentDispatcher.current = previousDispatcher
    }
  }

  const flushEffect = () => {
    if (pendingEffect === null) return
    const effect = pendingEffect
    pendingEffect = null
    cleanup?.()
    cleanup = effect() ?? null
  }

  const unmount = () => {
    cleanup?.()
    cleanup = null
  }

  return { render, flushEffect, unmount, getSetCount: () => setCount }
}

function withDomGlobals<T>(
  overrides: { document?: unknown; ResizeObserver?: unknown },
  fn: () => Promise<T> | T,
): Promise<T> {
  const prevDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const prevResizeObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver')
  const restore = () => {
    if (prevDocument === undefined) delete (globalThis as any).document
    else Object.defineProperty(globalThis, 'document', prevDocument)
    if (prevResizeObserver === undefined) delete (globalThis as any).ResizeObserver
    else Object.defineProperty(globalThis, 'ResizeObserver', prevResizeObserver)
  }
  if ('document' in overrides) {
    Object.defineProperty(globalThis, 'document', { value: overrides.document, configurable: true, writable: true })
  }
  if ('ResizeObserver' in overrides) {
    Object.defineProperty(globalThis, 'ResizeObserver', { value: overrides.ResizeObserver, configurable: true, writable: true })
  }
  return Promise.resolve().then(fn).finally(restore)
}

test('market descriptions use the themed host tooltip rather than a native title bubble', () => {
  const text = '用于排查问题：在「会话数据诊断」中查看 DSH 为会话记录的内容。'
  const harness = createHarness(null)
  const element = harness.render(text)
  assert.equal(element.props.label, text)
  assert.equal(element.props.side, 'top')
  assert.equal(element.props.portal, true)
  assert.equal(element.props.openOnClick, true)
  assert.equal(element.props.maxWidth, 320)
  assert.equal(element.props.disabled, true)

  const anchor = element.props.children as ReactElement<any>
  assert.equal(anchor.type, 'p')
  assert.equal(anchor.props.className, 'dsh_market_desc')
  assert.equal(anchor.props.title, undefined)
  assert.equal(anchor.props['data-clipped'], undefined)
  assert.equal(anchor.props.tabIndex, undefined)
  assert.equal(anchor.props.children, text)
})

test('MarketDescription detects vertical/horizontal clipping with 1px tolerance and updates via ResizeObserver', async () => {
  const text = 'A long description that may wrap past the line clamp.'
  const el = { scrollHeight: 37, clientHeight: 36, scrollWidth: 201, clientWidth: 200 }
  let observerCallback: (() => void) | null = null
  let observedTarget: unknown = null
  let disconnected = false
  class FakeResizeObserver {
    constructor(cb: () => void) { observerCallback = cb }
    observe(target: unknown) { observedTarget = target }
    disconnect() { disconnected = true }
  }

  await withDomGlobals({ document: {}, ResizeObserver: FakeResizeObserver }, () => {
    const harness = createHarness(el)
    harness.render(text)
    harness.flushEffect()
    assert.equal(observedTarget, el)

    let element = harness.render(text)
    let anchor = element.props.children as ReactElement<any>
    assert.equal(element.props.disabled, true)
    assert.equal(anchor.props['data-clipped'], undefined)
    assert.equal(anchor.props.tabIndex, undefined)

    el.scrollHeight = 54
    observerCallback!()
    element = harness.render(text)
    anchor = element.props.children as ReactElement<any>
    assert.equal(element.props.disabled, false)
    assert.equal(anchor.props['data-clipped'], 'true')
    assert.equal(anchor.props.tabIndex, 0)

    el.scrollHeight = 36
    observerCallback!()
    element = harness.render(text)
    anchor = element.props.children as ReactElement<any>
    assert.equal(element.props.disabled, true)
    assert.equal(anchor.props['data-clipped'], undefined)
    assert.equal(anchor.props.tabIndex, undefined)

    el.scrollWidth = 240
    observerCallback!()
    element = harness.render(text)
    assert.equal(element.props.disabled, false)

    harness.unmount()
    assert.equal(disconnected, true)
  })
})

test('MarketDescription re-measures on document.fonts.ready only while loading and guards against unmount', async () => {
  const text = 'Description affected by late font load.'
  const el = { scrollHeight: 36, clientHeight: 36, scrollWidth: 200, clientWidth: 200 }

  let loadedThenCalls = 0
  await withDomGlobals({
    document: {
      fonts: {
        status: 'loaded',
        ready: { then() { loadedThenCalls += 1; return Promise.resolve() } },
      },
    },
    ResizeObserver: undefined,
  }, () => {
    const harness = createHarness(el)
    harness.render(text)
    harness.flushEffect()
    assert.equal(loadedThenCalls, 0)
    assert.equal(harness.getSetCount(), 1)
    harness.unmount()
  })

  let resolveFonts!: () => void
  const ready = new Promise<void>(resolve => { resolveFonts = resolve })
  await withDomGlobals({
    document: { fonts: { status: 'loading', ready } },
    ResizeObserver: undefined,
  }, async () => {
    const harness = createHarness(el)
    harness.render(text)
    harness.flushEffect()
    assert.equal(harness.render(text).props.disabled, true)

    el.scrollHeight = 54
    resolveFonts()
    await ready
    await Promise.resolve()
    assert.equal(harness.render(text).props.disabled, false)
    harness.unmount()
  })

  let resolveLateFonts!: () => void
  const lateReady = new Promise<void>(resolve => { resolveLateFonts = resolve })
  el.scrollHeight = 36
  await withDomGlobals({
    document: { fonts: { status: 'loading', ready: lateReady } },
    ResizeObserver: undefined,
  }, async () => {
    const harness = createHarness(el)
    harness.render(text)
    harness.flushEffect()
    const beforeUnmount = harness.getSetCount()
    harness.unmount()

    el.scrollHeight = 72
    resolveLateFonts()
    await lateReady
    await Promise.resolve()
    assert.equal(harness.getSetCount(), beforeUnmount)
  })
})

test('card description markup is centralized in MarketDescription', async () => {
  const clientDir = new URL('../src/client/', import.meta.url)
  const offenders: string[] = []
  for (const name of await readdir(clientDir)) {
    if (!name.endsWith('.tsx') || name === 'MarketDescription.tsx') continue
    const source = await readFile(new URL(name, clientDir), 'utf8')
    if (source.includes('dsh_market_desc')) offenders.push(name)
  }
  assert.deepEqual(offenders, [])
})
