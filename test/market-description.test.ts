import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import type { ReactElement } from 'react'
import { isElementClipped, watchElementClipping } from '../src/client/clipping.ts'
import { loadClientBundle, withHookDispatcher } from './support/react-test-harness.ts'

const { MarketDescription } = await loadClientBundle("export { MarketDescription } from './src/client/MarketDescription.tsx'") as {
  MarketDescription: (props: { text: string }) => ReactElement<any>
}

function createDescriptionHarness(initialEl: { scrollHeight: number; clientHeight: number; scrollWidth: number; clientWidth: number } | null) {
  const ref = { current: initialEl }
  let clipped = false
  let pendingEffect: (() => void | (() => void)) | null = null
  let cleanup: (() => void) | null = null
  let lastDeps: readonly unknown[] | undefined

  const render = (text: string): ReactElement<any> => withHookDispatcher({
    useRef<T>() { return ref as unknown as { current: T } },
    useState<S>() {
      return [clipped as unknown as S, (next: S | ((prev: S) => S)) => {
        const resolved = typeof next === 'function' ? (next as (prev: S) => S)(clipped as unknown as S) : next
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
  }, () => MarketDescription({ text }))

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

  return { render, flushEffect, unmount }
}

function fakeEl(measurement: { scrollHeight: number; clientHeight: number; scrollWidth: number; clientWidth: number }): HTMLElement {
  return measurement as HTMLElement
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

test('isElementClipped detects vertical and horizontal overflow with exactly 1px tolerance', () => {
  const base = { scrollHeight: 36, clientHeight: 36, scrollWidth: 200, clientWidth: 200 }
  assert.equal(isElementClipped(base), false)
  // Exactly 1px over in either direction is still within tolerance.
  assert.equal(isElementClipped({ ...base, scrollHeight: 37 }), false)
  assert.equal(isElementClipped({ ...base, scrollWidth: 201 }), false)
  // Beyond 1px in either direction alone is clipped.
  assert.equal(isElementClipped({ ...base, scrollHeight: 38 }), true)
  assert.equal(isElementClipped({ ...base, scrollWidth: 202 }), true)
  // Content smaller than the box never clips.
  assert.equal(isElementClipped({ scrollHeight: 20, clientHeight: 36, scrollWidth: 100, clientWidth: 200 }), false)
})

test('watchElementClipping measures on start, follows resize, and disconnects on stop', async () => {
  const measurement = { scrollHeight: 36, clientHeight: 36, scrollWidth: 200, clientWidth: 200 }
  const el = fakeEl(measurement)
  let observerCallback: (() => void) | null = null
  let observedTarget: unknown = null
  let disconnected = false
  class FakeResizeObserver {
    constructor(cb: () => void) { observerCallback = cb }
    observe(target: unknown) { observedTarget = target }
    disconnect() { disconnected = true }
  }

  await withDomGlobals({ document: {}, ResizeObserver: FakeResizeObserver }, () => {
    const states: boolean[] = []
    const stop = watchElementClipping(el, clipped => states.push(clipped))
    assert.deepEqual(states, [false], 'unclipped content starts unclipped')
    assert.equal(observedTarget, el)

    measurement.scrollHeight = 54
    observerCallback!()
    assert.deepEqual(states, [false, true], 'vertical overflow reports clipped')

    measurement.scrollHeight = 36
    observerCallback!()
    assert.deepEqual(states, [false, true, false], 'shrinking back reports unclipped')

    measurement.scrollWidth = 240
    observerCallback!()
    assert.deepEqual(states, [false, true, false, true], 'horizontal overflow alone reports clipped')

    stop()
    assert.equal(disconnected, true)
  })
})

test('watchElementClipping re-measures on document.fonts.ready only while fonts are loading', async () => {
  const measurement = { scrollHeight: 36, clientHeight: 36, scrollWidth: 200, clientWidth: 200 }

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
    const states: boolean[] = []
    const stop = watchElementClipping(fakeEl(measurement), clipped => states.push(clipped))
    assert.equal(loadedThenCalls, 0, 'settled fonts never subscribe a re-measure')
    assert.deepEqual(states, [false])
    stop()
  })

  let resolveFonts!: () => void
  const ready = new Promise<void>(resolve => { resolveFonts = resolve })
  await withDomGlobals({
    document: { fonts: { status: 'loading', ready } },
    ResizeObserver: undefined,
  }, async () => {
    const states: boolean[] = []
    const stop = watchElementClipping(fakeEl(measurement), clipped => states.push(clipped))
    assert.deepEqual(states, [false])

    measurement.scrollHeight = 54
    resolveFonts()
    await ready
    await Promise.resolve()
    assert.deepEqual(states, [false, true], 'late font load triggers one re-measure')
    stop()
  })
})

test('watchElementClipping blocks late callbacks after stop', async () => {
  const measurement = { scrollHeight: 36, clientHeight: 36, scrollWidth: 200, clientWidth: 200 }
  let resolveLateFonts!: () => void
  const lateReady = new Promise<void>(resolve => { resolveLateFonts = resolve })
  await withDomGlobals({
    document: { fonts: { status: 'loading', ready: lateReady } },
    ResizeObserver: undefined,
  }, async () => {
    const states: boolean[] = []
    const stop = watchElementClipping(fakeEl(measurement), clipped => states.push(clipped))
    stop()

    measurement.scrollHeight = 72
    resolveLateFonts()
    await lateReady
    await Promise.resolve()
    assert.deepEqual(states, [false], 'the fonts.ready re-measure never fires after stop')
  })
})

test('MarketDescription wires the themed host tooltip, disables native title, and reflects clipping state', async () => {
  const text = '用于排查问题：在「会话数据诊断」中查看 DSH 为会话记录的内容。'
  const measurement = { scrollHeight: 36, clientHeight: 36, scrollWidth: 200, clientWidth: 200 }
  let observerCallback: (() => void) | null = null
  let disconnected = false
  class FakeResizeObserver {
    constructor(cb: () => void) { observerCallback = cb }
    observe() {}
    disconnect() { disconnected = true }
  }

  await withDomGlobals({ document: {}, ResizeObserver: FakeResizeObserver }, () => {
    const harness = createDescriptionHarness(measurement)
    let element = harness.render(text)
    assert.equal(element.props.label, text)
    assert.equal(element.props.side, 'top')
    assert.equal(element.props.portal, true)
    assert.equal(element.props.openOnClick, true)
    assert.equal(element.props.maxWidth, 320)
    assert.equal(element.props.disabled, true)

    let anchor = element.props.children as ReactElement<any>
    assert.equal(anchor.type, 'p')
    assert.equal(anchor.props.className, 'dsh_market_desc')
    assert.equal(anchor.props.title, undefined)
    assert.equal(anchor.props['data-clipped'], undefined)
    assert.equal(anchor.props.tabIndex, undefined)
    assert.equal(anchor.props.children, text)

    harness.flushEffect()
    measurement.scrollHeight = 54
    observerCallback!()
    element = harness.render(text)
    anchor = element.props.children as ReactElement<any>
    assert.equal(element.props.disabled, false)
    assert.equal(anchor.props['data-clipped'], 'true')
    assert.equal(anchor.props.tabIndex, 0)

    harness.unmount()
    assert.equal(disconnected, true)
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
