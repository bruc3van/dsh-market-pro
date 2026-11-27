/**
 * Sequential batch uninstaller for installed plugins.
 *
 * Mirrors the sequential queue, skip-on-failure, stop-after-current, and
 * self-last ordering model of {@link ./pluginUpdates.ts | pluginUpdates.ts}.
 * @module dsh-market-pro/client/batchUninstall
 */
import type { MarketInstalledResult } from '../contract.ts'

export interface BatchUninstallTarget {
  readonly packageName: string
  readonly version: string
  readonly self: boolean
  readonly inBox: boolean
  readonly unregistered: boolean
}

export type BatchUninstallItemStatus =
  | 'pending'
  | 'running'
  | 'removed'
  | 'restart-required'
  | 'removed-with-faults'
  | 'failed'
  | 'skipped'

export interface BatchUninstallItem extends BatchUninstallTarget {
  readonly status: BatchUninstallItemStatus
  readonly message?: string
  readonly notice?: string
  readonly noticeKind?: 'faults' | 'may-run'
}

export interface BatchUninstallState {
  readonly phase: 'idle' | 'running' | 'done'
  readonly items: readonly BatchUninstallItem[]
  readonly currentIndex: number
  readonly stopRequested: boolean
  /** Incremented after every settled package removal so the installed list refreshes. */
  readonly revision: number
}

const IDLE_STATE: BatchUninstallState = {
  phase: 'idle',
  items: [],
  currentIndex: -1,
  stopRequested: false,
  revision: 0,
}

/** Keep caller order while always placing the marketplace itself last. */
export function orderBatchUninstallTargets<T extends { readonly packageName: string; readonly self?: boolean }>(
  items: readonly T[],
  selfName = '',
): T[] {
  const others: T[] = []
  const selfItems: T[] = []
  for (const item of items) {
    if (item.self === true || (selfName !== '' && item.packageName === selfName)) {
      selfItems.push(item)
    } else {
      others.push(item)
    }
  }
  return [...others, ...selfItems]
}

/** Whether a settled batch-uninstall item removed the package from the profile. */
export function isBatchUninstallSuccess(status: BatchUninstallItemStatus): boolean {
  return status === 'removed' || status === 'restart-required' || status === 'removed-with-faults'
}

export interface BatchUninstallerOptions {
  readonly selfName?: string
  readonly onItemRemoved?: (packageName: string) => void
}

/** Sequential batch uninstall store shared across marketplace entry points. */
export function createBatchUninstaller(
  uninstallInstalled: (packageName: string) => Promise<MarketInstalledResult>,
  options?: BatchUninstallerOptions,
) {
  const selfName = options?.selfName ?? ''
  let state: BatchUninstallState = IDLE_STATE
  const listeners = new Set<() => void>()
  const set = (patch: Partial<BatchUninstallState>) => {
    state = { ...state, ...patch }
    for (const listener of [...listeners]) listener()
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    async start(targets: readonly BatchUninstallTarget[]): Promise<void> {
      if (state.phase === 'running') return
      const deduped: BatchUninstallTarget[] = []
      const seen = new Set<string>()
      for (const entry of targets) {
        if (entry.packageName.trim() === '' || seen.has(entry.packageName)) continue
        seen.add(entry.packageName)
        deduped.push(entry)
      }
      if (deduped.length === 0) return

      const ordered = orderBatchUninstallTargets(deduped, selfName)
      const queue: BatchUninstallItem[] = ordered.map(item => ({
        ...item,
        self: item.self || (selfName !== '' && item.packageName === selfName),
        status: 'pending',
      }))
      set({
        phase: 'running',
        items: queue,
        currentIndex: 0,
        stopRequested: false,
      })

      for (let index = 0; index < queue.length; index += 1) {
        if (state.stopRequested) {
          const items = state.items.map((entry, i) => (i >= index ? { ...entry, status: 'skipped' as const } : entry))
          set({ phase: 'done', items, currentIndex: -1, stopRequested: false })
          return
        }
        const entry = queue[index]!
        set({
          currentIndex: index,
          items: state.items.map((item, i) => (i === index ? { ...item, status: 'running' } : item)),
        })
        try {
          const result = await uninstallInstalled(entry.packageName)
          const notice = result.notice ?? ''
          const status: BatchUninstallItemStatus = (result.restartRequired === true || result.noticeKind === 'may-run')
            ? 'restart-required'
            : notice !== ''
              ? 'removed-with-faults'
              : 'removed'
          const nextItems = state.items.map((item, i) => (i === index ? {
            ...item,
            status,
            ...(notice !== '' ? { notice } : {}),
            ...(result.noticeKind !== undefined ? { noticeKind: result.noticeKind } : {}),
          } : item))
          set({ items: nextItems, revision: state.revision + 1 })
          options?.onItemRemoved?.(entry.packageName)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const nextItems = state.items.map((item, i) => (i === index ? {
            ...item,
            status: 'failed' as const,
            message,
          } : item))
          set({ items: nextItems, revision: state.revision + 1 })
        }
      }
      set({ phase: 'done', currentIndex: -1, stopRequested: false })
    },
    requestStop(): void {
      if (state.phase === 'running' && !state.stopRequested) {
        set({ stopRequested: true })
      }
    },
    reset(): void {
      if (state.phase === 'running') return
      set({ phase: 'idle', items: [], currentIndex: -1, stopRequested: false })
    },
  }
}

export type BatchUninstaller = ReturnType<typeof createBatchUninstaller>
