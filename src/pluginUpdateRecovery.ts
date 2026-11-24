interface UpdateResult {
  readonly step: string
  readonly result: {
    readonly application: string
    readonly error?: { readonly code?: string }
    readonly restartReason?: string
  }
  readonly restore?: { readonly restartReason?: string }
}

/** Whether the Host persisted the restored selection, live or for next boot. */
export function selectionWasRestored(application: string): boolean {
  return application === 'applied' || application === 'restart-required'
}

/** Whether the Host refused the hot removal because the installed version's rows are still running. */
export function isBundleInUse(result: UpdateResult | undefined): boolean {
  return result?.step === 'remove' && result.result.application === 'failed' && result.result.error?.code === 'bundle-in-use'
}

/**
 * Whether this process can no longer hot-swap profile packages after the given update. The Host keeps every later
 * recomposition waiting once a runtime resolution cannot publish (`package-moved`) or modules cannot be compared
 * (`module-comparison`); a removal it then refuses as `bundle-in-use` is the same state. Later hot updates would
 * deselect and fail the same way, so a batch stops and leaves them for after a restart. `no-hmr` is not such a state:
 * without HMR every update installs over the running version.
 */
export function blocksHotUpdates(result: UpdateResult | undefined): boolean {
  if (result === undefined) return false
  if (isBundleInUse(result)) return true
  const profileWide = (reason: string | undefined) => reason === 'package-moved' || reason === 'module-comparison'
  return profileWide(result.result.restartReason) || profileWide(result.restore?.restartReason)
}

/** Outcome of putting back the bundle selection after a failed removal step. */
export type SelectionRestore = 'restored' | 'failed'

/**
 * Run one Host update and, when it fails at the removal step, re-select a bundle that was enabled before.
 * With HMR the Host deselects the bundle before checking whether its rows stopped; a refusal such as
 * `bundle-in-use` leaves it deselected, so the plugin would silently stop loading at the next boot.
 */
export async function updateKeepingSelection<T>(
  readEnabled: () => Promise<boolean | undefined>,
  update: () => Promise<T>,
  resultOf: (answer: T) => UpdateResult | undefined,
  enable: (() => Promise<boolean>) | undefined,
): Promise<{ answer: T; selectionRestore?: SelectionRestore }> {
  const enabledNow = async () => {
    try { return await readEnabled() } catch { return undefined }
  }
  const wasEnabled = enable ? await enabledNow() : undefined
  const answer = await update()
  const result = resultOf(answer)
  if (!enable || wasEnabled !== true || result?.step !== 'remove') return { answer }
  const app = result.result.application
  if (app !== 'failed' && app !== 'cancelled') return { answer }
  if (await enabledNow() !== false) return { answer }
  try {
    return { answer, selectionRestore: await enable() ? 'restored' : 'failed' }
  } catch {
    return { answer, selectionRestore: 'failed' }
  }
}
