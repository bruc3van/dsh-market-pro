import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import * as RealReact from 'react'
import type { ReactElement, ReactNode } from 'react'
import { build } from 'esbuild'

export interface HookDispatcher {
  useState<S>(initial?: S | (() => S)): [S, (next: S | ((prev: S) => S)) => void]
  useReducer?<S, A>(reducer: (state: S, action: A) => S, initialArg: S, init?: (arg: S) => S): [S, (action: A) => void]
  useRef<T>(initial: T): { current: T }
  useMemo?<T>(factory: () => T, deps?: readonly unknown[]): T
  useCallback?<T>(callback: T, deps?: readonly unknown[]): T
  useEffect?(effect: () => void | (() => void), deps?: readonly unknown[]): void
  useLayoutEffect?(effect: () => void | (() => void), deps?: readonly unknown[]): void
  useId?(): string
  useSyncExternalStore?<T>(subscribe: unknown, getSnapshot: () => T): T
  useContext?<T>(ctx: { _currentValue?: T }): T
}

export type RenderedNode =
  | { kind: 'element'; type: string; props: Record<string, any>; children: RenderedNode[] }
  | { kind: 'text'; value: string }

let activeDispatcher: HookDispatcher | null = null

function requireDispatcher(name: string): HookDispatcher {
  if (activeDispatcher === null) {
    throw new Error(`${name} called outside of react-test-harness render`)
  }
  return activeDispatcher
}

export function withHookDispatcher<T>(dispatcher: HookDispatcher, fn: () => T): T {
  const previous = activeDispatcher
  activeDispatcher = dispatcher
  try {
    return fn()
  } finally {
    activeDispatcher = previous
  }
}

const { default: _defaultReact, ...realReactExports } = RealReact

const reactModule = {
  ...realReactExports,
  useState<S>(initial?: S | (() => S)) {
    return requireDispatcher('useState').useState(initial)
  },
  useReducer<S, A>(reducer: (state: S, action: A) => S, initialArg: S, init?: (arg: S) => S) {
    const fn = requireDispatcher('useReducer').useReducer
    if (!fn) throw new Error('useReducer not implemented in active dispatcher')
    return fn(reducer, initialArg, init)
  },
  useRef<T>(initial: T) {
    return requireDispatcher('useRef').useRef(initial)
  },
  useMemo<T>(factory: () => T, deps?: readonly unknown[]) {
    const fn = requireDispatcher('useMemo').useMemo
    return fn ? fn(factory, deps) : factory()
  },
  useCallback<T>(callback: T, deps?: readonly unknown[]) {
    const fn = requireDispatcher('useCallback').useCallback
    return fn ? fn(callback, deps) : callback
  },
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
    requireDispatcher('useEffect').useEffect?.(effect, deps)
  },
  useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
    requireDispatcher('useLayoutEffect').useLayoutEffect?.(effect, deps)
  },
  useId() {
    const fn = requireDispatcher('useId').useId
    return fn ? fn() : ':r0:'
  },
  useSyncExternalStore<T>(subscribe: unknown, getSnapshot: () => T) {
    const fn = requireDispatcher('useSyncExternalStore').useSyncExternalStore
    return fn ? fn(subscribe, getSnapshot) : getSnapshot()
  },
  useContext<T>(ctx: { _currentValue?: T }) {
    const fn = requireDispatcher('useContext').useContext
    return fn ? fn(ctx) : (ctx._currentValue as T)
  },
}

const primitivesStub = {
  '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(new URL('./primitives-stub.tsx', import.meta.url)),
}
const requireFromHarness = createRequire(import.meta.url)

function requireForTest(id: string): unknown {
  if (id === 'react') return reactModule
  return requireFromHarness(id)
}

export async function loadClientBundle(contents: string): Promise<Record<string, any>> {
  const result = await build({
    stdin: {
      contents,
      resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
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
  run(requireForTest, mod, mod.exports)
  return mod.exports
}

type HookSlot = { value: unknown; deps?: readonly unknown[] }

function sameDeps(prev: readonly unknown[] | undefined, next: readonly unknown[] | undefined): boolean {
  if (prev === undefined || next === undefined || prev.length !== next.length) return false
  for (let i = 0; i < prev.length; i += 1) {
    if (!Object.is(prev[i], next[i])) return false
  }
  return true
}

export function createTestRenderer() {
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
    return withHookDispatcher({
      useState<S>(initial?: S | (() => S)) {
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
        return nextSlot(() => ({ current: initial })).value as { current: T }
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
        return nextSlot(() => `:r${String(idCounter++)}:`).value as string
      },
      useSyncExternalStore<T>(_subscribe: unknown, getSnapshot: () => T) {
        return getSnapshot()
      },
      useContext<T>(ctx: { _currentValue?: T }) {
        return ctx._currentValue as T
      },
    }, () => fn(props))
  }

  function expand(node: ReactNode, path = 'root'): RenderedNode[] {
    if (node === null || node === undefined || typeof node === 'boolean') return []
    if (typeof node === 'string' || typeof node === 'number') return [{ kind: 'text', value: String(node) }]
    if (Array.isArray(node)) {
      return node.flatMap((child, index) => expand(child, `${path}[${String(index)}]`))
    }
    const element = node as ReactElement<any>
    if (element.type === RealReact.Fragment) {
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
      const name = renderFn.name || 'forwardRef'
      const key = element.key === null || element.key === undefined ? '' : `#${String(element.key)}`
      const nextPath = `${path}/${name}${key}`
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

export function findAll(
  nodes: readonly RenderedNode[],
  predicate: (node: Extract<RenderedNode, { kind: 'element' }>) => boolean,
): Extract<RenderedNode, { kind: 'element' }>[] {
  const matches: Extract<RenderedNode, { kind: 'element' }>[] = []
  for (const node of nodes) {
    if (node.kind !== 'element') continue
    if (predicate(node)) matches.push(node)
    matches.push(...findAll(node.children, predicate))
  }
  return matches
}

export function textOf(node: RenderedNode): string {
  if (node.kind === 'text') return node.value
  return node.children.map(textOf).join('')
}
