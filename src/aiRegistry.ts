/**
 * Explicit three-state lifecycle for dynamically registering an Agent tool into
 * the optional Host `tools` service and keeping it synced with a live toggle.
 */
import type { Context } from '@deepseek-ai/cordis'

/** Structural subset of DSH's `ToolsService` used at runtime. */
export interface ToolsRegistryFace {
  register(definition: Record<string, unknown>, options?: { when?: () => boolean }): () => void
}

type ToolBindingState =
  | { readonly status: 'unbound' }
  | { readonly status: 'idle'; readonly registry: ToolsRegistryFace }
  | { readonly status: 'registered'; readonly registry: ToolsRegistryFace; readonly dispose: () => void }

export interface DynamicAiToolOptions {
  readonly effectLabel: string
  readonly logLabel: string
  readonly isEnabled: () => boolean
  readonly createDefinition: () => Record<string, unknown>
}

/**
 * Mount a dynamic tool into `ctx.tools` when present and synchronize its
 * registration state (`unbound -> idle <-> registered`) with `isEnabled()`.
 */
export function registerDynamicAiTool(ctx: Context, options: DynamicAiToolOptions): {
  sync(): void
} {
  let state: ToolBindingState = { status: 'unbound' }

  const withdraw = (): void => {
    if (state.status !== 'registered') return
    const { registry, dispose } = state
    state = { status: 'idle', registry }
    dispose()
  }

  const sync = (): void => {
    if (state.status === 'unbound') return
    if (!options.isEnabled()) {
      withdraw()
      return
    }
    if (state.status === 'registered') return
    const { registry } = state
    try {
      const dispose = registry.register(options.createDefinition(), {
        when: options.isEnabled,
      })
      state = { status: 'registered', registry, dispose }
    } catch (error) {
      console.warn(`[dsh-market-pro] could not register ${options.logLabel}:`, error)
    }
  }

  ctx.inject(['tools'], (scope) => {
    const getter = (scope as unknown as { get?: (name: string) => unknown }).get
    const registry = (typeof getter === 'function'
      ? getter.call(scope, 'tools')
      : (scope as unknown as { tools?: unknown }).tools) as ToolsRegistryFace | undefined
    if (registry === undefined || typeof registry.register !== 'function') return
    scope.effect(() => {
      state = { status: 'idle', registry }
      sync()
      return () => {
        if (state.status === 'registered') {
          const { dispose } = state
          state = { status: 'unbound' }
          dispose()
        } else {
          state = { status: 'unbound' }
        }
      }
    }, options.effectLabel)
  })

  return { sync }
}
