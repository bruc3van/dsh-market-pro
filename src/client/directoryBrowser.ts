/**
 * Native-to-browse directory picker bridge for DSH Desktop and DSH-go/Web.
 *
 * Desktop profiles serve `directoryPicker.pick` ("native"); remote / mobile
 * profiles such as DSH-go serve `directoryPicker.list` + `createDirectory`
 * ("browse") and reject `pick` with `directory-picker/unavailable`.
 * This controller tries `pickDirectory` first, remembers when the connected
 * host serves `"browse"`, and drives an owner-scoped in-app folder browser
 * modal so every workspace-picking flow keeps working across both runtimes.
 */
import type { DirectoryEntry, DirectoryListing } from '@deepseek-ai/dsh-api-remotes/client'

export type DirectoryBrowserEntry = DirectoryEntry
export type DirectoryBrowserListing = DirectoryListing

export interface DirectoryPickerNavigation {
  pickDirectory(): Promise<string | null>
  listDirectory?(path?: string, signal?: AbortSignal): Promise<DirectoryBrowserListing>
  createDirectory?(path: string, name: string): Promise<string>
}

export interface DirectoryBrowserState {
  readonly open: boolean
  /** The mounted surface that opened this modal, so multi-surface mounts never stack duplicate dialogs. */
  readonly ownerId: string | null
  readonly loading: boolean
  readonly creating: boolean
  readonly currentPath: string
  readonly listing: DirectoryBrowserListing | null
  readonly error: string
  readonly createError: string
  readonly canCreate: boolean
}

export interface DirectoryBrowserController {
  getSnapshot(): DirectoryBrowserState
  subscribe(listener: () => void): () => void
  /** Pick one directory via the native dialog or the remote browse modal. */
  pick(ownerId?: string): Promise<string | null>
  /** Navigate to another directory level inside the open browse modal. */
  browse(path?: string): Promise<void>
  /** Create a child directory under the currently listed path and enter it. */
  createFolder(name: string): Promise<boolean>
  /** Clear a transient create-folder error (e.g. when dismissing the form or editing the name). */
  clearCreateError(): void
  /** Accept the currently listed directory and close the modal. */
  confirm(): void
  /** Dismiss the modal without selecting a directory. When `ownerId` is given, only dismiss if owned by it. */
  cancel(ownerId?: string): void
  /** Reset cached capability and dismiss any pending modal (e.g. on reconnect). */
  reset(): void
}

const CLOSED_STATE: DirectoryBrowserState = {
  open: false,
  ownerId: null,
  loading: false,
  creating: false,
  currentPath: '',
  listing: null,
  error: '',
  createError: '',
  canCreate: false,
}

/** Whether `pickDirectory()` failed specifically because the host serves `"browse"` instead of `"native"`. */
export function isBrowseDirectoryPickerError(error: unknown): boolean {
  if (error !== null && typeof error === 'object') {
    const rpc = (error as { rpcError?: { code?: unknown; details?: { capability?: unknown } } }).rpcError
    if (rpc?.code === 'directory-picker/unavailable') {
      return rpc.details?.capability === 'browse'
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  return /serves\s+"browse"/i.test(message)
}

function isPickerUnavailableError(error: unknown): boolean {
  if (error !== null && typeof error === 'object') {
    const rpc = (error as { rpcError?: { code?: unknown } }).rpcError
    if (rpc?.code === 'directory-picker/unavailable') return true
  }
  const message = error instanceof Error ? error.message : String(error)
  return /directory-picker\/unavailable/i.test(message) || /needs the browse capability/i.test(message)
}

/** Create the shared directory-picker controller consumed by client flows and the browse modal. */
export function createDirectoryBrowser(navigation: DirectoryPickerNavigation): DirectoryBrowserController {
  let state: DirectoryBrowserState = { ...CLOSED_STATE, canCreate: typeof navigation.createDirectory === 'function' }
  const listeners = new Set<() => void>()
  let mode: 'unknown' | 'browse' = 'unknown'
  let pending: {
    promise: Promise<string | null>
    resolve: (path: string | null) => void
  } | null = null
  let listController: AbortController | null = null
  let listSeq = 0
  let sessionSeq = 0

  const emit = (next: DirectoryBrowserState): void => {
    state = next
    for (const listener of [...listeners]) listener()
  }

  const abortList = (): void => {
    listSeq += 1
    listController?.abort()
    listController = null
  }

  const closeWith = (value: string | null): void => {
    sessionSeq += 1
    abortList()
    const active = pending
    pending = null
    emit({ ...CLOSED_STATE, canCreate: typeof navigation.createDirectory === 'function' })
    active?.resolve(value)
  }

  const browse = async (path?: string): Promise<void> => {
    const list = navigation.listDirectory
    if (typeof list !== 'function') {
      emit({ ...state, loading: false, error: 'directory browsing is unavailable on this host' })
      return
    }
    abortList()
    const seq = listSeq
    const activeSession = sessionSeq
    const controller = new AbortController()
    listController = controller
    emit({
      ...state,
      open: true,
      loading: true,
      currentPath: path ?? '',
      error: '',
      createError: '',
    })
    try {
      const listing = await list(path, controller.signal)
      if (seq !== listSeq || activeSession !== sessionSeq || !state.open) return
      listController = null
      emit({
        ...state,
        open: true,
        loading: false,
        currentPath: listing.path,
        listing,
        error: '',
      })
    } catch (error) {
      if (seq !== listSeq || activeSession !== sessionSeq || controller.signal.aborted || !state.open) return
      listController = null
      if (isPickerUnavailableError(error)) mode = 'unknown'
      emit({
        ...state,
        open: true,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const openModal = (ownerId?: string): Promise<string | null> => {
    if (pending !== null) return pending.promise
    sessionSeq += 1
    let resolve!: (path: string | null) => void
    const promise = new Promise<string | null>((res) => { resolve = res })
    pending = { promise, resolve }
    emit({
      ...CLOSED_STATE,
      open: true,
      ownerId: ownerId ?? null,
      loading: true,
      canCreate: typeof navigation.createDirectory === 'function',
    })
    void browse(undefined)
    return promise
  }

  const pick = async (ownerId?: string): Promise<string | null> => {
    const canBrowse = typeof navigation.listDirectory === 'function'
    if (mode === 'browse' && canBrowse) return await openModal(ownerId)
    try {
      return await navigation.pickDirectory()
    } catch (error) {
      if (canBrowse && isBrowseDirectoryPickerError(error)) {
        mode = 'browse'
        return await openModal(ownerId)
      }
      throw error
    }
  }

  const createFolder = async (rawName: string): Promise<boolean> => {
    const create = navigation.createDirectory
    const parent = state.listing?.path ?? ''
    const name = rawName.trim()
    if (typeof create !== 'function' || parent === '' || state.loading || state.creating || !state.open) return false
    if (name === '' || name === '.' || name === '..' || /[/\\]/.test(name)) {
      emit({ ...state, createError: 'invalid-name' })
      return false
    }
    const activeSession = sessionSeq
    emit({ ...state, creating: true, createError: '' })
    try {
      const createdPath = await create(parent, name)
      if (activeSession !== sessionSeq || !state.open) return false
      emit({ ...state, creating: false, createError: '' })
      await browse(createdPath)
      return true
    } catch (error) {
      if (activeSession !== sessionSeq || !state.open) return false
      emit({
        ...state,
        creating: false,
        createError: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    pick,
    browse,
    createFolder,
    clearCreateError: () => {
      if (state.createError !== '') emit({ ...state, createError: '' })
    },
    confirm: () => {
      const selected = state.listing?.path ?? ''
      if (selected === '' || state.loading || state.creating) return
      closeWith(selected)
    },
    cancel: (ownerId?: string) => {
      if (ownerId !== undefined && state.ownerId !== ownerId) return
      if (state.open || pending !== null) closeWith(null)
    },
    reset: () => {
      mode = 'unknown'
      sessionSeq += 1
      if (state.open || pending !== null) closeWith(null)
    },
  }
}
