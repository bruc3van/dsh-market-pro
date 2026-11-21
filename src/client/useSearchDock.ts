import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * The docked search box's height; styles.ts sets the same value on the docked
 * input. Shorter than the 40px resting box so it sits inside the tab row
 * instead of running over the row's bottom rule.
 */
const DOCKED_HEIGHT = 30
const MIN_DOCK_WIDTH = 440
const TOP_REST_PX = 4
const COMPACT_THRESHOLD_PX = 40
const EXPAND_THRESHOLD_PX = -16

/** Explicit hysteresis state for the docking search bar. */
export type SearchDockMode = 'expanded' | 'compact'

export interface SearchDockState {
  readonly mode: SearchDockMode
  readonly previousTop: number
  readonly viewportHeight: number
  readonly scrollDelta: number
}

export type SearchDockEvent =
  | { readonly type: 'reset' }
  | { readonly type: 'resize'; readonly rootWidth: number; readonly focusInside: boolean }
  | {
    readonly type: 'scroll'
    readonly scrollTop: number
    readonly clientHeight: number
    readonly rootWidth: number
    readonly focusInside: boolean
  }

export const INITIAL_SEARCH_DOCK_STATE: SearchDockState = {
  mode: 'expanded',
  previousTop: 0,
  viewportHeight: 0,
  scrollDelta: 0,
}

/** Pure hysteresis transition for docking/undocking the search bar without DOM coupling. */
export function stepSearchDock(state: SearchDockState, event: SearchDockEvent): SearchDockState {
  if (event.type === 'reset') return INITIAL_SEARCH_DOCK_STATE
  if (event.type === 'resize') {
    if (event.rootWidth < MIN_DOCK_WIDTH && !event.focusInside && state.mode !== 'expanded') {
      return { ...state, mode: 'expanded', scrollDelta: 0 }
    }
    return state
  }
  const delta = event.scrollTop - state.previousTop
  // Ignore scroll shifts caused by a container resize rather than user scroll.
  if (state.viewportHeight > 0 && state.viewportHeight !== event.clientHeight) {
    return { ...state, previousTop: event.scrollTop, viewportHeight: event.clientHeight }
  }
  if (event.scrollTop <= TOP_REST_PX) {
    return {
      mode: event.focusInside ? state.mode : 'expanded',
      previousTop: event.scrollTop,
      viewportHeight: event.clientHeight,
      scrollDelta: 0,
    }
  }
  const baseDistance = Math.sign(delta) !== Math.sign(state.scrollDelta) ? 0 : state.scrollDelta
  const scrollDelta = baseDistance + delta
  if (scrollDelta > COMPACT_THRESHOLD_PX && event.rootWidth >= MIN_DOCK_WIDTH) {
    return {
      mode: event.focusInside ? state.mode : 'compact',
      previousTop: event.scrollTop,
      viewportHeight: event.clientHeight,
      scrollDelta: 0,
    }
  }
  if (scrollDelta < EXPAND_THRESHOLD_PX) {
    return {
      mode: event.focusInside ? state.mode : 'expanded',
      previousTop: event.scrollTop,
      viewportHeight: event.clientHeight,
      scrollDelta: 0,
    }
  }
  return {
    mode: state.mode,
    previousTop: event.scrollTop,
    viewportHeight: event.clientHeight,
    scrollDelta,
  }
}

/** Move the existing search controls, retaining their value and keyboard focus. */
export function useSearchDock(page: string) {
  const root = useRef<HTMLDivElement>(null)
  const [compact, setCompact] = useState(false)
  const before = useRef<DOMRect | null>(null)
  const bar = () => root.current?.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden]) .dsh_market_dockable')
  useEffect(() => {
    setCompact(false)
    const element = root.current
    if (!element) return
    let dockState: SearchDockState = INITIAL_SEARCH_DOCK_STATE
    // Centre the docked box on the tab labels. Measured for the bar being
    // docked, at the moment it docks: a page's bar can mount long after the
    // last resize (the Skills search waits for its list), and a position
    // computed only on resize would leave that bar where it stood.
    const place = () => {
      const control = bar()
      const tab = element.querySelector<HTMLElement>('.dsh_market_tabs [role="tab"]')
      if (!control || !tab) return
      const tabRect = tab.getBoundingClientRect()
      const labelCentre = tabRect.top - element.getBoundingClientRect().top + tabRect.height / 2
      control.style.top = `${Math.round(labelCentre - DOCKED_HEIGHT / 2)}px`
    }
    const dispatch = (event: SearchDockEvent) => {
      const next = stepSearchDock(dockState, event)
      const modeChanged = next.mode !== dockState.mode
      dockState = next
      if (!modeChanged) return
      before.current = bar()?.getBoundingClientRect() ?? null
      if (next.mode === 'compact') place()
      setCompact(next.mode === 'compact')
    }
    const geometry = () => {
      if (dockState.mode === 'compact') place()
      dispatch({
        type: 'resize',
        rootWidth: element.clientWidth,
        focusInside: Boolean(bar()?.contains(document.activeElement)),
      })
    }
    const observer = new ResizeObserver(geometry)
    observer.observe(element)
    const tabs = element.querySelector('.dsh_market_tabs')
    if (tabs) observer.observe(tabs)
    geometry()
    const scroll = (event: Event) => {
      const list = event.target
      if (!(list instanceof HTMLElement) || !list.matches('.dsh_market_results') || !bar()) return
      dispatch({
        type: 'scroll',
        scrollTop: list.scrollTop,
        clientHeight: list.clientHeight,
        rootWidth: element.clientWidth,
        focusInside: Boolean(bar()?.contains(document.activeElement)),
      })
    }
    element.addEventListener('scroll', scroll, true)
    return () => { observer.disconnect(); element.removeEventListener('scroll', scroll, true) }
  }, [page])
  useLayoutEffect(() => {
    const control = bar()
    const old = before.current
    before.current = null
    if (!control || !old || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const next = control.getBoundingClientRect()
    const animation = control.animate([
      { transform: `translate(${old.left - next.left}px, ${old.top - next.top}px)`, width: `${old.width}px` },
      { transform: 'translate(0, 0)', width: `${next.width}px` },
    ], { duration: 180, easing: 'ease-out' })
    return () => animation.cancel()
  }, [compact])
  return { root, compact }
}
