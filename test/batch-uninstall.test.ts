import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { MarketInstalledResult } from '../src/contract.ts'
import {
  createBatchUninstaller,
  isBatchUninstallSuccess,
  orderBatchUninstallTargets,
  type BatchUninstallTarget,
} from '../src/client/batchUninstall.ts'

const target = (
  packageName: string,
  extra: Partial<BatchUninstallTarget> = {},
): BatchUninstallTarget => ({
  packageName,
  version: '1.0.0',
  self: false,
  inBox: false,
  unregistered: false,
  ...extra,
})

const okResult = (overrides: Partial<MarketInstalledResult> = {}): MarketInstalledResult => ({
  packages: [],
  profile: 'default',
  error: '',
  ...overrides,
})

test('orderBatchUninstallTargets preserves caller order and moves self last', () => {
  const ordered = orderBatchUninstallTargets(
    [
      target('dsh-market-pro'),
      target('alpha'),
      target('beta', { self: true }),
      target('gamma'),
    ],
    'dsh-market-pro',
  )
  assert.deepEqual(
    ordered.map(item => item.packageName),
    ['alpha', 'gamma', 'dsh-market-pro', 'beta'],
  )
})

test('createBatchUninstaller runs sequentially, maps outcomes, skips failures, and notifies onItemRemoved', async () => {
  const events: string[] = []
  const removed: string[] = []
  let active = 0
  let maxConcurrent = 0

  const uninstaller = createBatchUninstaller(
    async (packageName) => {
      active += 1
      maxConcurrent = Math.max(maxConcurrent, active)
      events.push(`start:${packageName}`)
      await new Promise(resolve => setTimeout(resolve, 5))
      active -= 1
      events.push(`end:${packageName}`)
      if (packageName === 'broken-plugin') {
        throw new Error('pnpm remove failed')
      }
      if (packageName === 'restart-plugin') {
        return okResult({ restartRequired: true })
      }
      if (packageName === 'faulty-plugin') {
        return okResult({ notice: 'leftover cache', noticeKind: 'faults' })
      }
      return okResult()
    },
    {
      selfName: 'dsh-market-pro',
      onItemRemoved: (packageName) => { removed.push(packageName) },
    },
  )

  // Empty targets is a no-op.
  await uninstaller.start([])
  assert.equal(uninstaller.getSnapshot().phase, 'idle')

  await uninstaller.start([
    target('dsh-market-pro'),
    target('broken-plugin'),
    target('restart-plugin'),
    target('broken-plugin'), // duplicate must be deduped
    target('faulty-plugin'),
    target('clean-plugin'),
  ])

  assert.equal(maxConcurrent, 1)
  assert.deepEqual(events, [
    'start:broken-plugin', 'end:broken-plugin',
    'start:restart-plugin', 'end:restart-plugin',
    'start:faulty-plugin', 'end:faulty-plugin',
    'start:clean-plugin', 'end:clean-plugin',
    'start:dsh-market-pro', 'end:dsh-market-pro',
  ])
  assert.deepEqual(removed, ['restart-plugin', 'faulty-plugin', 'clean-plugin', 'dsh-market-pro'])

  const snap = uninstaller.getSnapshot()
  assert.equal(snap.phase, 'done')
  assert.equal(snap.revision, 5)
  assert.deepEqual(
    snap.items.map(item => [item.packageName, item.status, item.self, item.message, item.notice]),
    [
      ['broken-plugin', 'failed', false, 'pnpm remove failed', undefined],
      ['restart-plugin', 'restart-required', false, undefined, undefined],
      ['faulty-plugin', 'removed-with-faults', false, undefined, 'leftover cache'],
      ['clean-plugin', 'removed', false, undefined, undefined],
      ['dsh-market-pro', 'removed', true, undefined, undefined],
    ],
  )
  assert.equal(isBatchUninstallSuccess('removed'), true)
  assert.equal(isBatchUninstallSuccess('restart-required'), true)
  assert.equal(isBatchUninstallSuccess('removed-with-faults'), true)
  assert.equal(isBatchUninstallSuccess('failed'), false)
  assert.equal(isBatchUninstallSuccess('skipped'), false)

  // Resetting returns to idle while preserving monotonic revision.
  uninstaller.reset()
  assert.equal(uninstaller.getSnapshot().phase, 'idle')
  assert.equal(uninstaller.getSnapshot().items.length, 0)
  assert.equal(uninstaller.getSnapshot().revision, 5)
})

test('requestStop finishes the active uninstall, skips remaining items, and guards re-entry', async () => {
  let finishFirst!: (value: MarketInstalledResult) => void
  const called: string[] = []
  const uninstaller = createBatchUninstaller(async (packageName) => {
    called.push(packageName)
    return new Promise(resolve => { finishFirst = resolve })
  })

  const pending = uninstaller.start([target('first'), target('second'), target('third')])
  await Promise.resolve()
  assert.equal(uninstaller.getSnapshot().phase, 'running')

  // Re-entrant start & reset while running must be ignored.
  await uninstaller.start([target('other')])
  uninstaller.reset()
  assert.equal(uninstaller.getSnapshot().items.length, 3)

  uninstaller.requestStop()
  assert.equal(uninstaller.getSnapshot().stopRequested, true)
  finishFirst(okResult({ noticeKind: 'may-run', notice: 'still active' }))
  await pending

  assert.deepEqual(called, ['first'])
  const snap = uninstaller.getSnapshot()
  assert.equal(snap.phase, 'done')
  assert.deepEqual(
    snap.items.map(item => [item.packageName, item.status]),
    [
      ['first', 'restart-required'],
      ['second', 'skipped'],
      ['third', 'skipped'],
    ],
  )
})
