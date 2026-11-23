import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  currentSessionOf,
  workspaceReady,
  workspaceTargetOf,
} from '../src/client/workspaceCompat.ts'
import {
  createDirectoryBrowser,
  isBrowseDirectoryPickerError,
  type DirectoryBrowserListing,
} from '../src/client/directoryBrowser.ts'

test('workspace readiness requires both split Controller baselines', () => {
  assert.equal(workspaceReady(
    { phase: 'pending', items: [] },
    { phase: 'ready', byId: {} },
  ), false)
  assert.equal(workspaceReady(
    { phase: 'ready', items: [] },
    { phase: 'pending', byId: {} },
  ), false)
  assert.equal(workspaceReady(
    { phase: 'ready', items: [] },
    { phase: 'ready', byId: {} },
  ), true)
})

test('workspace selection derives the latest target for split Controllers', () => {
  const state = {
    phase: 'ready' as const,
    items: [
      { workspaceId: 'older', sessionIds: ['s1'], createdAt: '2026-01-01T00:00:00Z' },
      { workspaceId: 'newer', sessionIds: ['s2'], createdAt: '2026-02-01T00:00:00Z' },
    ],
  }
  assert.equal(workspaceTargetOf(state, {
    phase: 'ready',
    byId: { s1: { id: 's1', updatedAt: 10, retainedBy: {} }, s2: { id: 's2', updatedAt: 20, retainedBy: {} } },
  }), 'newer')
  assert.equal(workspaceTargetOf(state, {
    phase: 'ready',
    byId: { s1: { id: 's1', updatedAt: 10, retainedBy: { mainView: 1 } }, s2: { id: 's2', updatedAt: 20, retainedBy: {} } },
  }), 'older')
})

test('current session follows main-view retention rather than sidebar or background ownership', () => {
  const byId = {
    side: { id: 'side', updatedAt: 30, retainedBy: { sidebar: 1 } },
    main: { id: 'main', updatedAt: 10, retainedBy: { mainView: 1 } },
  }
  assert.equal(currentSessionOf({ phase: 'ready', byId }), 'main')
  byId.main.retainedBy.mainView = 0
  assert.equal(currentSessionOf({ phase: 'ready', byId }), undefined)
  byId.side.retainedBy.mainView = 1
  assert.equal(currentSessionOf({ phase: 'ready', byId }), 'side')
})

test('isBrowseDirectoryPickerError recognizes DSH-go browse capability errors only', () => {
  assert.equal(
    isBrowseDirectoryPickerError(new Error('directory picker failed: directoryPicker.pick needs the native capability; the composed picker serves "browse"')),
    true,
  )
  assert.equal(
    isBrowseDirectoryPickerError({ rpcError: { code: 'directory-picker/unavailable', details: { capability: 'browse' } } }),
    true,
  )
  assert.equal(
    isBrowseDirectoryPickerError(new Error('directory picker failed: directoryPicker.pick needs the native capability; the composed picker serves "none"')),
    false,
  )
  assert.equal(
    isBrowseDirectoryPickerError({ rpcError: { code: 'directory-picker/unavailable', details: { capability: 'none' } } }),
    false,
  )
  assert.equal(isBrowseDirectoryPickerError(new Error('permission denied')), false)
})

test('directory browser falls back from native pick to remote browse, supports folder creation, and caches browse mode', async () => {
  let pickCalls = 0
  const listings: Record<string, DirectoryBrowserListing> = {
    '': {
      path: '/home/user',
      home: '/home/user',
      crumbs: [{ name: '/', path: '/', hidden: false }, { name: 'home', path: '/home', hidden: false }, { name: 'user', path: '/home/user', hidden: false }],
      entries: [
        { name: '.cache', path: '/home/user/.cache', hidden: true },
        { name: 'projects', path: '/home/user/projects', hidden: false },
      ],
      truncated: false,
    },
    '/home/user/projects': {
      path: '/home/user/projects',
      home: '/home/user',
      crumbs: [{ name: '/', path: '/', hidden: false }, { name: 'projects', path: '/home/user/projects', hidden: false }],
      entries: [],
      truncated: false,
    },
    '/home/user/projects/demo': {
      path: '/home/user/projects/demo',
      home: '/home/user',
      crumbs: [{ name: '/', path: '/', hidden: false }, { name: 'demo', path: '/home/user/projects/demo', hidden: false }],
      entries: [],
      truncated: false,
    },
  }
  const browser = createDirectoryBrowser({
    pickDirectory: async () => {
      pickCalls += 1
      throw new Error('directory picker failed: directoryPicker.pick needs the native capability; the composed picker serves "browse"')
    },
    listDirectory: async (path) => listings[path ?? '']!,
    createDirectory: async (parent, name) => `${parent}/${name}`,
  })

  const firstPick = browser.pick()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(pickCalls, 1)
  assert.equal(browser.getSnapshot().open, true)
  assert.equal(browser.getSnapshot().listing?.path, '/home/user')

  await browser.browse('/home/user/projects')
  assert.equal(browser.getSnapshot().listing?.path, '/home/user/projects')

  assert.equal(await browser.createFolder('bad/name'), false)
  assert.equal(browser.getSnapshot().createError, 'invalid-name')

  assert.equal(await browser.createFolder('demo'), true)
  assert.equal(browser.getSnapshot().listing?.path, '/home/user/projects/demo')

  browser.confirm()
  assert.equal(await firstPick, '/home/user/projects/demo')
  assert.equal(browser.getSnapshot().open, false)

  // Subsequent picks skip pickDirectory() once browse mode is known.
  const secondPick = browser.pick()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(pickCalls, 1)
  assert.equal(browser.getSnapshot().open, true)
  browser.cancel()
  assert.equal(await secondPick, null)

  // Reset clears cached browse mode and cancels an open modal.
  const thirdPick = browser.pick()
  await new Promise(resolve => setTimeout(resolve, 0))
  browser.reset()
  assert.equal(await thirdPick, null)
  const fourthPick = browser.pick()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(pickCalls, 2)
  browser.cancel()
  assert.equal(await fourthPick, null)
})

test('directory browser preserves native pick results and non-browse failures', async () => {
  const nativeBrowser = createDirectoryBrowser({
    pickDirectory: async () => '/workspace/app',
    listDirectory: async () => { throw new Error('should not browse on native host') },
  })
  assert.equal(await nativeBrowser.pick(), '/workspace/app')

  const failingBrowser = createDirectoryBrowser({
    pickDirectory: async () => { throw new Error('unexpected host fault') },
    listDirectory: async () => { throw new Error('should not browse on unrelated error') },
  })
  await assert.rejects(() => failingBrowser.pick(), /unexpected host fault/)
})

test('directory browser enforces owner scoping, resets currentPath for home, clears createError, and ignores stale createFolder across reset', async () => {
  let resolveCreate!: (path: string) => void
  let listMode: 'ok' | 'fail-root' | 'fail-home' = 'ok'
  const browser = createDirectoryBrowser({
    pickDirectory: async () => {
      throw new Error('directoryPicker.pick needs the native capability; the composed picker serves "browse"')
    },
    listDirectory: async (path) => {
      if (path === '/root' && listMode === 'fail-root') throw new Error('permission denied')
      if (path === undefined && listMode === 'fail-home') throw new Error('home unavailable')
      return {
        path: path ?? '/home/user',
        home: '/home/user',
        crumbs: [{ name: '/', path: '/', hidden: false }],
        entries: [],
        truncated: false,
      }
    },
    createDirectory: () => new Promise<string>((resolve) => { resolveCreate = resolve }),
  })

  // Owner scoping: only the opening owner can cancel via ownerId.
  const ownedPick = browser.pick('surface-main')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(browser.getSnapshot().ownerId, 'surface-main')
  browser.cancel('surface-sidebar')
  assert.equal(browser.getSnapshot().open, true)

  // browse(undefined) clears currentPath instead of keeping a prior failed subdir path.
  listMode = 'fail-root'
  await browser.browse('/root')
  assert.equal(browser.getSnapshot().currentPath, '/root')
  assert.match(browser.getSnapshot().error, /permission denied/)
  listMode = 'fail-home'
  await browser.browse(undefined)
  assert.equal(browser.getSnapshot().currentPath, '')
  listMode = 'ok'
  await browser.browse(undefined)
  assert.equal(browser.getSnapshot().listing?.path, '/home/user')

  // clearCreateError clears invalid-name errors when dismissing/editing the form.
  assert.equal(await browser.createFolder('../escape'), false)
  assert.equal(browser.getSnapshot().createError, 'invalid-name')
  browser.clearCreateError()
  assert.equal(browser.getSnapshot().createError, '')

  // Stale createFolder resolving after reset() + reopen must not hijack the new session.
  const staleCreate = browser.createFolder('old-folder')
  assert.equal(browser.getSnapshot().creating, true)
  browser.reset()
  assert.equal(await ownedPick, null)
  const freshPick = browser.pick('surface-sidebar')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(browser.getSnapshot().ownerId, 'surface-sidebar')
  resolveCreate('/home/user/old-folder')
  assert.equal(await staleCreate, false)
  assert.equal(browser.getSnapshot().listing?.path, '/home/user')
  assert.equal(browser.getSnapshot().creating, false)
  browser.cancel('surface-sidebar')
  assert.equal(await freshPick, null)
})
