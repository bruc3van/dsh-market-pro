import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { findFeaturedSkillById, isDeletableSkillPath } from '../src/skillsFeatured.ts'
import {
  SKILL_PROVENANCE_FILE, deleteInstalledSkillOnHost, fetchSkillSubdirFromJsDelivr, installFeaturedSkillOnHost,
  readInstalledSkillFeaturedId, resolveSkillInstallTarget,
} from '../src/skillInstall.ts'

function tarEntry(path: string, content: Buffer | string, typeFlag = '0'): Buffer {
  const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
  const header = Buffer.alloc(512, 0)
  header.write(path, 0, Math.min(Buffer.byteLength(path), 100), 'utf8')
  header.write('0000644\0', 100, 8, 'ascii')
  header.write('0000000\0', 108, 8, 'ascii')
  header.write('0000000\0', 116, 8, 'ascii')
  header.write(`${data.byteLength.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii')
  header.write('00000000000\0', 136, 12, 'ascii')
  header.fill(0x20, 148, 156)
  header.write(typeFlag, 156, 1, 'ascii')
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')
  let checksum = 0
  for (let i = 0; i < 512; i += 1) checksum += header[i]!
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')

  const padLen = (512 - (data.byteLength % 512)) % 512
  return Buffer.concat([header, data, Buffer.alloc(padLen, 0)])
}

function makeTgz(entries: readonly { path: string; content: string; typeFlag?: string }[]): Buffer {
  const parts = entries.map(entry => tarEntry(entry.path, entry.content, entry.typeFlag ?? '0'))
  parts.push(Buffer.alloc(1024, 0))
  return gzipSync(Buffer.concat(parts))
}

function tgzResponse(buffer: Buffer): Response {
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: { 'content-type': 'application/gzip', 'content-length': String(buffer.byteLength) },
  })
}

test('resolveSkillInstallTarget resolves user-dsh, user-agents, and project-dsh and rejects invalid project paths', () => {
  const item = findFeaturedSkillById('vercel-labs/skills/find-skills')!
  const fakeHome = join(tmpdir(), 'dsh-skill-home-test')
  const fakeProject = join(tmpdir(), 'dsh-skill-proj-test')

  const userDsh = resolveSkillInstallTarget(item, 'user-dsh', undefined, fakeHome)
  assert.equal(userDsh.ok, true)
  if (userDsh.ok) assert.equal(userDsh.targetPath, join(fakeHome, '.dsh', 'skills', 'find-skills'))

  const userAgents = resolveSkillInstallTarget(item, 'user-agents', undefined, fakeHome)
  assert.equal(userAgents.ok, true)
  if (userAgents.ok) assert.equal(userAgents.targetPath, join(fakeHome, '.agents', 'skills', 'find-skills'))

  const projectDsh = resolveSkillInstallTarget(item, 'project-dsh', fakeProject, fakeHome)
  assert.equal(projectDsh.ok, true)
  if (projectDsh.ok) assert.equal(projectDsh.targetPath, join(fakeProject, '.dsh', 'skills', 'find-skills'))

  const emptyProj = resolveSkillInstallTarget(item, 'project-dsh', '', fakeHome)
  assert.equal(emptyProj.ok, false)
  if (!emptyProj.ok) assert.equal(emptyProj.code, 'invalid-project-dir')

  const relativeProj = resolveSkillInstallTarget(item, 'project-dsh', 'relative/path', fakeHome)
  assert.equal(relativeProj.ok, false)
  if (!relativeProj.ok) assert.equal(relativeProj.code, 'invalid-project-dir')
})

test('installFeaturedSkillOnHost extracts verified subpath into .dsh, .agents, and project dirs, blocks symlinks/traversal, and guards overwrite', async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'dsh-skill-install-'))
  const home = join(sandbox, 'home')
  const project = join(sandbox, 'my-project')
  await mkdir(home, { recursive: true })
  await mkdir(project, { recursive: true })

  const archiveV1 = makeTgz([
    { path: 'skills-main/skills/find-skills/SKILL.md', content: '# find-skills v1\n' },
    { path: 'skills-main/skills/find-skills/references/guide.md', content: 'guide v1' },
    { path: 'skills-main/skills/find-skills/scripts/helper.sh', content: 'echo hi' },
    { path: 'skills-main/skills/find-skills/evil-link', content: '', typeFlag: '2' },
    { path: 'skills-main/skills/find-skills/../escape.txt', content: 'nope' },
    { path: 'skills-main/skills/other-skill/SKILL.md', content: '# other' },
  ])
  const archiveV2 = makeTgz([
    { path: 'skills-main/skills/find-skills/SKILL.md', content: '# find-skills v2\n' },
  ])

  let currentArchive = archiveV1
  let attempts = 0
  let failPrimaryOnce = true
  const fakeFetch: typeof fetch = async () => {
    attempts += 1
    if (failPrimaryOnce) {
      failPrimaryOnce = false
      return new Response('server error', { status: 502 })
    }
    return tgzResponse(currentArchive)
  }

  try {
    // 1. Default user-dsh install with primary->fallback mirror recovery
    const first = await installFeaturedSkillOnHost(
      { id: 'vercel-labs/skills/find-skills', scope: 'user-dsh' },
      new AbortController().signal,
      { home, fetchImpl: fakeFetch },
    )
    assert.equal(first.ok, true)
    assert.equal(first.targetPath, join(home, '.dsh', 'skills', 'find-skills'))
    assert.equal(first.fileCount, 3)
    assert.equal(first.hasScripts, true)
    assert.equal(attempts, 2, 'should fall back to secondary archive URL on HTTP 502')
    assert.equal(await readFile(join(first.targetPath, 'SKILL.md'), 'utf8'), '# find-skills v1\n')
    assert.equal(await readFile(join(first.targetPath, 'references', 'guide.md'), 'utf8'), 'guide v1')
    // Symlink, traversal, and sibling skills must NOT be written.
    const rootEntries = await readdir(join(home, '.dsh', 'skills'))
    assert.deepEqual(rootEntries, ['find-skills'])

    // 2. Second install without overwrite fails safely with already-exists
    const conflict = await installFeaturedSkillOnHost(
      { id: 'vercel-labs/skills/find-skills', scope: 'user-dsh' },
      new AbortController().signal,
      { home, fetchImpl: fakeFetch },
    )
    assert.equal(conflict.ok, false)
    assert.equal(conflict.code, 'already-exists')
    assert.equal(await readFile(join(first.targetPath, 'SKILL.md'), 'utf8'), '# find-skills v1\n')

    // 3. Explicit overwrite atomically replaces the directory and leaves no staging/backup leftovers
    currentArchive = archiveV2
    const replaced = await installFeaturedSkillOnHost(
      { id: 'vercel-labs/skills/find-skills', scope: 'user-dsh', overwrite: true },
      new AbortController().signal,
      { home, fetchImpl: fakeFetch },
    )
    assert.equal(replaced.ok, true)
    assert.equal(replaced.fileCount, 1)
    assert.equal(replaced.hasScripts, false)
    assert.equal(await readFile(join(replaced.targetPath, 'SKILL.md'), 'utf8'), '# find-skills v2\n')
    assert.deepEqual(await readdir(join(home, '.dsh', 'skills')), ['find-skills'])

    // 4. Shared user-agents install
    const agents = await installFeaturedSkillOnHost(
      { id: 'vercel-labs/skills/find-skills', scope: 'user-agents' },
      new AbortController().signal,
      { home, fetchImpl: fakeFetch },
    )
    assert.equal(agents.ok, true)
    assert.equal(agents.targetPath, join(home, '.agents', 'skills', 'find-skills'))
    assert.equal(await readFile(join(agents.targetPath, 'SKILL.md'), 'utf8'), '# find-skills v2\n')

    // 5. Project-level install into existing project directory
    const proj = await installFeaturedSkillOnHost(
      { id: 'vercel-labs/skills/find-skills', scope: 'project-dsh', projectDir: project },
      new AbortController().signal,
      { home, fetchImpl: fakeFetch },
    )
    assert.equal(proj.ok, true)
    assert.equal(proj.targetPath, join(project, '.dsh', 'skills', 'find-skills'))
    assert.equal(await readFile(join(proj.targetPath, 'SKILL.md'), 'utf8'), '# find-skills v2\n')

    // 6. Non-existent project directory is rejected cleanly
    const badProj = await installFeaturedSkillOnHost(
      { id: 'vercel-labs/skills/find-skills', scope: 'project-dsh', projectDir: join(sandbox, 'does-not-exist') },
      new AbortController().signal,
      { home, fetchImpl: fakeFetch },
    )
    assert.equal(badProj.ok, false)
    assert.equal(badProj.code, 'invalid-project-dir')

    // 7. Unknown skill id is rejected before any network fetch
    const beforeCalls = attempts
    const unknown = await installFeaturedSkillOnHost(
      { id: 'evil/repo/not-in-allowlist', scope: 'user-dsh' },
      new AbortController().signal,
      { home, fetchImpl: fakeFetch },
    )
    assert.equal(unknown.ok, false)
    assert.equal(unknown.code, 'not-found')
    assert.equal(attempts, beforeCalls)

    // 8. Archive without root SKILL.md is rejected as invalid-skill and writes nothing
    const noDocArchive = makeTgz([
      { path: 'skills-main/skills/find-skills/README.md', content: 'not a skill' },
    ])
    const noDoc = await installFeaturedSkillOnHost(
      { id: 'vercel-labs/skills/find-skills', scope: 'user-dsh', overwrite: true },
      new AbortController().signal,
      { home, fetchImpl: async () => tgzResponse(noDocArchive) },
    )
    assert.equal(noDoc.ok, false)
    assert.equal(noDoc.code, 'invalid-skill')
    assert.equal(await readFile(join(replaced.targetPath, 'SKILL.md'), 'utf8'), '# find-skills v2\n')

    // 9. Pre-aborted signal returns cancelled without network access
    const aborted = new AbortController()
    aborted.abort()
    const cancelled = await installFeaturedSkillOnHost(
      { id: 'vercel-labs/skills/find-skills', scope: 'user-dsh' },
      aborted.signal,
      { home, fetchImpl: fakeFetch },
    )
    assert.equal(cancelled.ok, false)
    assert.equal(cancelled.code, 'cancelled')
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
})

test('deleteInstalledSkillOnHost deletes verified user/project skill dirs and refuses unsafe paths', async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'dsh-skill-delete-'))
  try {
    const validSkill = join(sandbox, '.dsh', 'skills', 'demo-skill')
    await mkdir(validSkill, { recursive: true })
    await writeFile(join(validSkill, 'SKILL.md'), '# demo\n', 'utf8')

    const agentsSkill = join(sandbox, '.agents', 'skills', 'shared-skill')
    await mkdir(agentsSkill, { recursive: true })
    await writeFile(join(agentsSkill, 'SKILL.md'), '# shared\n', 'utf8')

    const nonSkillDir = join(sandbox, '.dsh', 'skills', 'not-a-skill')
    await mkdir(nonSkillDir, { recursive: true })
    await writeFile(join(nonSkillDir, 'README.md'), 'keep me\n', 'utf8')

    const outsideDir = join(sandbox, 'outside')
    await mkdir(outsideDir, { recursive: true })
    await writeFile(join(outsideDir, 'SKILL.md'), '# outside\n', 'utf8')

    assert.equal(isDeletableSkillPath(validSkill), true)
    assert.equal(isDeletableSkillPath(agentsSkill), true)
    assert.equal(isDeletableSkillPath(join(sandbox, '.dsh', 'skills')), false)
    assert.equal(isDeletableSkillPath(outsideDir), false)
    assert.equal(isDeletableSkillPath(join(sandbox, 'node_modules', '.dsh', 'skills', 'bundled')), false)

    // Refuses non-skill dir (no SKILL.md)
    const noDoc = await deleteInstalledSkillOnHost({ name: 'not-a-skill', sourcePath: nonSkillDir })
    assert.equal(noDoc.ok, false)
    assert.equal(noDoc.code, 'not-deletable')
    assert.equal(await readFile(join(nonSkillDir, 'README.md'), 'utf8'), 'keep me\n')

    // Refuses outside dir
    const outside = await deleteInstalledSkillOnHost({ name: 'outside', sourcePath: outsideDir })
    assert.equal(outside.ok, false)
    assert.equal(outside.code, 'not-deletable')

    // Deletes verified .dsh/skills and .agents/skills dirs cleanly
    const del1 = await deleteInstalledSkillOnHost({ name: 'demo-skill', sourcePath: validSkill })
    assert.equal(del1.ok, true)
    const del2 = await deleteInstalledSkillOnHost({ name: 'shared-skill', sourcePath: agentsSkill })
    assert.equal(del2.ok, true)
    assert.deepEqual(await readdir(join(sandbox, '.dsh', 'skills')), ['not-a-skill'])
    assert.deepEqual(await readdir(join(sandbox, '.agents', 'skills')), [])

    // Deleting again returns not-found
    const missing = await deleteInstalledSkillOnHost({ name: 'demo-skill', sourcePath: validSkill })
    assert.equal(missing.ok, false)
    assert.equal(missing.code, 'not-found')
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
})

test('installFeaturedSkillOnHost fails over to jsDelivr at the same commit (fastly -> cdn) when GitHub is unreachable', async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'dsh-skill-jsdelivr-'))
  const home = join(sandbox, 'home')
  try {
    await mkdir(home, { recursive: true })
    const seenUrls: string[] = []
    let fastlyFailed = false
    const item = findFeaturedSkillById('vercel-labs/skills/find-skills')!

    const fakeFetch: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      seenUrls.push(url)
      if (url.includes('codeload.github.com') || url.includes('api.github.com')) {
        throw new Error('connect ETIMEDOUT github')
      }
      if (url.includes('data.jsdelivr.com') && url.includes(`@${item.commit}?structure=flat`)) {
        return new Response(JSON.stringify({
          type: 'gh',
          name: 'vercel-labs/skills',
          version: item.commit,
          files: [
            { name: '/README.md', size: 10 },
            { name: '/skills/other/SKILL.md', size: 10 },
            { name: '/skills/find-skills/../evil.txt', size: 10 },
            { name: '/skills/find-skills/SKILL.md', size: 20 },
            { name: '/skills/find-skills/scripts/helper.mjs', size: 22 },
          ],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.startsWith('https://fastly.jsdelivr.net/') && !fastlyFailed) {
        fastlyFailed = true
        return new Response('bad gateway', { status: 502 })
      }
      if (url.endsWith('/skills/find-skills/SKILL.md')) {
        return new Response('# find-skills via jsDelivr\n', { status: 200 })
      }
      if (url.endsWith('/skills/find-skills/scripts/helper.mjs')) {
        return new Response('export const ok = true\n', { status: 200 })
      }
      return new Response('unexpected', { status: 404 })
    }

    const res = await installFeaturedSkillOnHost(
      { id: 'vercel-labs/skills/find-skills', scope: 'user-dsh' },
      new AbortController().signal,
      { home, fetchImpl: fakeFetch },
    )
    assert.equal(res.ok, true, res.error)
    assert.equal(res.fileCount, 2)
    assert.equal(res.hasScripts, true)
    assert.equal(await readFile(join(res.targetPath, 'SKILL.md'), 'utf8'), '# find-skills via jsDelivr\n')
    assert.equal(await readFile(join(res.targetPath, 'scripts', 'helper.mjs'), 'utf8'), 'export const ok = true\n')
    assert.deepEqual((await readdir(res.targetPath)).sort(), [SKILL_PROVENANCE_FILE, 'SKILL.md', 'scripts'])
    assert.deepEqual(seenUrls.slice(0, 2), [
      `https://codeload.github.com/${item.source}/tar.gz/${item.commit}`,
      `https://api.github.com/repos/${item.source}/tarball/${item.commit}`,
    ])
    assert.ok(seenUrls.some(u => u.includes('data.jsdelivr.com') && u.includes(`@${item.commit}?structure=flat`)))
    assert.ok(seenUrls.some(u => u.startsWith(`https://fastly.jsdelivr.net/gh/${item.source}@${item.commit}/`)))
    assert.ok(seenUrls.some(u => u.startsWith(`https://cdn.jsdelivr.net/gh/${item.source}@${item.commit}/`)))

    // Size limit enforcement on jsDelivr fallback
    const oversized = await installFeaturedSkillOnHost(
      { id: 'vercel-labs/skills/find-skills', scope: 'user-agents' },
      new AbortController().signal,
      {
        home,
        fetchImpl: fakeFetch,
        limits: {
          maxCompressedBytes: 1024,
          maxDecompressedBytes: 1024,
          maxExtractedBytes: 1024,
          maxFileBytes: 10,
          maxFiles: 10,
        },
      },
    )
    assert.equal(oversized.ok, false)
    assert.equal(oversized.code, 'download-failed')
    assert.match(oversized.error, /jsDelivr fallback:.*bytes limit/)
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
})

test('fetchSkillSubdirFromJsDelivr enforces timeout and AbortSignal while streaming response bodies', async () => {
  const hangingResponse = () => new Response(new ReadableStream({
    start() {
      // Intentionally never enqueue or close: simulates a stalled connection after HTTP 200 headers.
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } })

  // 1. Timeout aborts stalled manifest body read instead of hanging forever
  const start = Date.now()
  const timedOut = await fetchSkillSubdirFromJsDelivr(
    'vercel-labs/skills',
    findFeaturedSkillById('vercel-labs/skills/find-skills')!.commit,
    'skills/find-skills',
    new AbortController().signal,
    { fetchImpl: async () => hangingResponse(), timeoutMs: 60 },
  )
  assert.equal(timedOut.ok, false)
  assert.match(timedOut.error, /timed out/)
  assert.ok(Date.now() - start < 3_000, 'body timeout should abort promptly')

  // 2. External AbortSignal cancels stalled file body read promptly
  const abortController = new AbortController()
  const abortFetch: typeof fetch = async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('data.jsdelivr.com')) {
      return new Response(JSON.stringify({
        files: [{ name: '/skills/find-skills/SKILL.md', size: 100 }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    setTimeout(() => abortController.abort(), 40)
    return hangingResponse()
  }
  const cancelled = await fetchSkillSubdirFromJsDelivr(
    'vercel-labs/skills',
    findFeaturedSkillById('vercel-labs/skills/find-skills')!.commit,
    'skills/find-skills',
    abortController.signal,
    { fetchImpl: abortFetch, timeoutMs: 10_000 },
  )
  assert.equal(cancelled.ok, false)
  assert.match(cancelled.error, /cancelled/)
})

test('fetchSkillSubdirFromJsDelivr rejects colon path segments and skips .git and node_modules at repo root', async () => {
  const seenFiles: string[] = []
  const fakeFetch: typeof fetch = async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('data.jsdelivr.com')) {
      return new Response(JSON.stringify({
        files: [
          { name: '/SKILL.md', size: 16 },
          { name: '/.git/config', size: 12 },
          { name: '/node_modules/pkg/index.js', size: 12 },
          { name: '/bad:stream.txt', size: 12 },
          { name: '/docs/guide.md', size: 10 },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    seenFiles.push(url)
    return new Response('content', { status: 200 })
  }

  const res = await fetchSkillSubdirFromJsDelivr(
    'example/root-skill',
    'a'.repeat(40),
    '',
    new AbortController().signal,
    { fetchImpl: fakeFetch },
  )
  assert.equal(res.ok, true)
  if (res.ok) {
    assert.deepEqual([...res.files.keys()].sort(), ['SKILL.md', 'docs/guide.md'])
  }
  assert.equal(seenFiles.some(u => u.includes('.git') || u.includes('node_modules') || u.includes('bad%3Astream')), false)
})

test('deleteInstalledSkillOnHost rejects symlinked skills roots and symlinked intermediate parent dirs', async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'dsh-skill-del-symlink-'))
  try {
    const outsideRoot = join(sandbox, 'outside')
    const outsideSkill = join(outsideRoot, 'victim-skill')
    await mkdir(outsideSkill, { recursive: true })
    await writeFile(join(outsideSkill, 'SKILL.md'), '# do not delete', 'utf8')

    // Case 1: intermediate parent directory under .dsh/skills is a symlink/junction pointing outside
    const realSkillsRoot = join(sandbox, 'home1', '.dsh', 'skills')
    await mkdir(realSkillsRoot, { recursive: true })
    const parentLink = join(realSkillsRoot, 'escape-parent')
    await symlink(outsideRoot, parentLink, process.platform === 'win32' ? 'junction' : 'dir')

    const nestedEscape = await deleteInstalledSkillOnHost({
      name: 'victim-skill',
      sourcePath: join(parentLink, 'victim-skill'),
    })
    assert.equal(nestedEscape.ok, false)
    assert.equal(nestedEscape.code, 'not-deletable')
    assert.equal(await readFile(join(outsideSkill, 'SKILL.md'), 'utf8'), '# do not delete')

    // Case 2: .dsh/skills itself is a symlink/junction pointing outside
    const home2Dsh = join(sandbox, 'home2', '.dsh')
    await mkdir(home2Dsh, { recursive: true })
    const symlinkedRoot = join(home2Dsh, 'skills')
    await symlink(outsideRoot, symlinkedRoot, process.platform === 'win32' ? 'junction' : 'dir')

    const rootEscape = await deleteInstalledSkillOnHost({
      name: 'victim-skill',
      sourcePath: join(symlinkedRoot, 'victim-skill'),
    })
    assert.equal(rootEscape.ok, false)
    assert.equal(rootEscape.code, 'not-deletable')
    assert.equal(await readFile(join(outsideSkill, 'SKILL.md'), 'utf8'), '# do not delete')

    // Case 3: direct symlink inside a real .dsh/skills root unlinks ONLY the symlink, keeping target intact
    const directLink = join(realSkillsRoot, 'linked-skill')
    await symlink(outsideSkill, directLink, process.platform === 'win32' ? 'junction' : 'dir')
    const directDel = await deleteInstalledSkillOnHost({
      name: 'linked-skill',
      sourcePath: directLink,
    })
    assert.equal(directDel.ok, true, directDel.error)
    assert.equal(await readFile(join(outsideSkill, 'SKILL.md'), 'utf8'), '# do not delete')
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
})

test('curated skill installs record provenance that clears on delete/manual replacement and respects .skill-lock.json', async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'dsh-skill-provenance-'))
  try {
    const home = join(sandbox, 'home')
    const item = findFeaturedSkillById('mattpocock/skills/code-review')!
    assert.ok(item)

    const archive = makeTgz([
      { path: `skills-main/${item.path}/SKILL.md`, content: '---\nname: code-review\n---\n# Matt Pocock review' },
    ])
    const installed = await installFeaturedSkillOnHost(
      { id: item.id, scope: 'user-dsh' },
      new AbortController().signal,
      {
        home,
        fetchImpl: async () => new Response(new Uint8Array(archive), { status: 200 }),
      },
    )
    assert.equal(installed.ok, true, installed.error)
    assert.equal(installed.fileCount, 1)

    const marker = JSON.parse(await readFile(join(installed.targetPath, SKILL_PROVENANCE_FILE), 'utf8')) as {
      featuredId: string
      source: string
      path: string
      commit: string
    }
    assert.equal(marker.featuredId, item.id)
    assert.equal(marker.source, item.source)
    assert.equal(marker.commit, item.commit)
    assert.equal(await readInstalledSkillFeaturedId(installed.targetPath, 'code-review', { home }), item.id)

    // Deleting the curated skill and manually copying a different local `code-review` clears provenance.
    const removed = await deleteInstalledSkillOnHost({ name: 'code-review', sourcePath: installed.targetPath })
    assert.equal(removed.ok, true, removed.error)
    await mkdir(installed.targetPath, { recursive: true })
    await writeFile(join(installed.targetPath, 'SKILL.md'), '---\nname: code-review\n---\n# Custom local review', 'utf8')
    assert.equal(await readInstalledSkillFeaturedId(installed.targetPath, 'code-review', { home }), undefined)

    // For ~/.agents/skills/*, verified `.skill-lock.json` provenance matches curated skills,
    // while unrelated repos or mismatched skills do not.
    const agentsDir = join(home, '.agents')
    const agentsSkillDir = join(agentsDir, 'skills', 'frontend-design')
    await mkdir(agentsSkillDir, { recursive: true })
    await writeFile(join(agentsSkillDir, 'SKILL.md'), '---\nname: frontend-design\n---', 'utf8')
    await writeFile(join(agentsDir, '.skill-lock.json'), JSON.stringify({
      version: 3,
      skills: {
        'frontend-design': {
          source: 'anthropics/skills',
          skillPath: 'skills/frontend-design/SKILL.md',
        },
        'code-review': {
          source: 'someone-else/custom-skills',
          skillPath: 'skills/code-review/SKILL.md',
        },
      },
    }), 'utf8')
    assert.equal(
      await readInstalledSkillFeaturedId(agentsSkillDir, 'frontend-design', { source: 'user-agents', home }),
      'anthropics/skills/frontend-design',
    )
    const otherAgentsSkillDir = join(agentsDir, 'skills', 'code-review')
    await mkdir(otherAgentsSkillDir, { recursive: true })
    assert.equal(
      await readInstalledSkillFeaturedId(otherAgentsSkillDir, 'code-review', { source: 'user-agents', home }),
      undefined,
    )
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
})
