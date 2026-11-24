/**
 * Host-side direct installer for curated Agent Skills.
 *
 * Only installs allowlisted entries from {@link FEATURED_SKILLS} by streaming
 * the verified GitHub repository tarball, extracting strictly regular files
 * under the skill's verified subpath (rejecting symlinks and traversal),
 * checking that a root `SKILL.md` is present, and atomically committing into
 * the chosen DSH target directory:
 * - `user-dsh`: `~/.dsh/skills/<name>` (default)
 * - `user-agents`: `~/.agents/skills/<name>` (shared across `.agents` tools)
 * - `project-dsh`: `<projectDir>/.dsh/skills/<name>` (project-scoped)
 */
import { randomBytes } from 'node:crypto'
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type {
  DeleteInstalledSkillRequest,
  DeleteInstalledSkillResult,
  FeaturedSkillInstallScope,
  InstallFeaturedSkillRequest,
  InstallFeaturedSkillResult,
} from './contract.ts'
import {
  findFeaturedSkillByExactId, findFeaturedSkillById, findFeaturedSkillBySource, isDeletableSkillPath,
  type FeaturedSkill,
} from './skillsFeatured.ts'
import { extractSubdirFromTgzResponse, type SubdirExtractLimits } from './tarball.ts'

/** Strict directory-name pattern for installed skill folders (single path segment). */
export const SAFE_SKILL_DIR_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/
/** Provenance marker written inside curated skills installed by `dsh-market-pro`. */
export const SKILL_PROVENANCE_FILE = '.dsh-market-pro.json'

const MAX_PROVENANCE_BYTES = 16 * 1024
const MAX_SKILL_LOCK_BYTES = 1024 * 1024

/** One entry parsed from `~/.agents/.skill-lock.json` (written by `npx skills`). */
export interface AgentsSkillLockEntry {
  readonly source: string
  readonly skillPath?: string
}

/** Read `~/.agents/.skill-lock.json` once per listing to verify `npx skills`-installed provenance. */
export async function readAgentsSkillLock(home: string = homedir()): Promise<ReadonlyMap<string, AgentsSkillLockEntry>> {
  const lockPath = join(home, '.agents', '.skill-lock.json')
  try {
    const info = await stat(lockPath)
    if (!info.isFile() || info.size > MAX_SKILL_LOCK_BYTES) return new Map()
    const raw = await readFile(lockPath, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map()
    const skills = (parsed as { skills?: unknown }).skills
    if (skills === null || typeof skills !== 'object' || Array.isArray(skills)) return new Map()
    const out = new Map<string, AgentsSkillLockEntry>()
    for (const [key, value] of Object.entries(skills as Record<string, unknown>)) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
      const source = (value as { source?: unknown }).source
      const skillPath = (value as { skillPath?: unknown }).skillPath
      if (typeof source !== 'string' || source.trim() === '') continue
      out.set(key.trim().toLowerCase(), {
        source: source.trim(),
        ...(typeof skillPath === 'string' && skillPath.trim() !== '' ? { skillPath: skillPath.trim() } : {}),
      })
    }
    return out
  } catch {
    return new Map()
  }
}

function isInsideAgentsUserSkills(skillDir: string, home: string): boolean {
  const agentsSkillsRoot = resolve(home, '.agents', 'skills')
  const normalizedTarget = resolve(skillDir)
  const rel = relative(agentsSkillsRoot, normalizedTarget)
  if (rel === '' || rel === '..' || rel.startsWith('..') || isAbsolute(rel)) return false
  return !rel.includes('/') && !rel.includes('\\')
}

/**
 * Resolve the verified curated `featuredId` (`owner/repo/skillId`) for an
 * installed skill directory on disk, or `undefined` when no provenance matches.
 */
export async function readInstalledSkillFeaturedId(
  skillDir: string,
  skillName: string,
  options: {
    readonly source?: string
    readonly home?: string
    readonly agentsLock?: ReadonlyMap<string, AgentsSkillLockEntry>
  } = {},
): Promise<string | undefined> {
  const trimmedName = skillName.trim()
  if (skillDir.trim() === '' || trimmedName === '') return undefined
  const markerPath = join(skillDir, SKILL_PROVENANCE_FILE)
  try {
    const info = await stat(markerPath)
    if (info.isFile() && info.size <= MAX_PROVENANCE_BYTES) {
      const parsed: unknown = JSON.parse(await readFile(markerPath, 'utf8'))
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const featuredId = (parsed as { featuredId?: unknown }).featuredId
        if (typeof featuredId === 'string') {
          const item = findFeaturedSkillByExactId(featuredId)
          if (item !== undefined
            && (item.name.toLowerCase() === trimmedName.toLowerCase()
              || item.skillId.toLowerCase() === trimmedName.toLowerCase())) {
            return item.id
          }
        }
      }
    }
  } catch {
    // Missing or unreadable marker; fall through to `.skill-lock.json` for `.agents/skills` only.
  }

  const home = options.home ?? homedir()
  if (options.source === 'user-agents' || isInsideAgentsUserSkills(skillDir, home)) {
    const lock = options.agentsLock ?? await readAgentsSkillLock(home)
    const entry = lock.get(basename(skillDir).trim().toLowerCase()) ?? lock.get(trimmedName.toLowerCase())
    if (entry !== undefined) {
      const matched = findFeaturedSkillBySource(entry.source, trimmedName, entry.skillPath)
      if (matched !== undefined) return matched.id
    }
  }
  return undefined
}

const DEFAULT_FETCH_TIMEOUT_MS = 12_000
const JSDELIVR_DATA_API_BASE = 'https://data.jsdelivr.com/v1/packages/gh'
const JSDELIVR_FILE_HOSTS = ['fastly.jsdelivr.net', 'cdn.jsdelivr.net'] as const
const JSDELIVR_BRANCH_REFS = ['main', 'master'] as const
const JSDELIVR_CONCURRENCY = 6
const MAX_JSDELIVR_MANIFEST_BYTES = 4 * 1024 * 1024
const DEFAULT_EXTRACT_LIMITS: SubdirExtractLimits = {
  maxCompressedBytes: 64 * 1024 * 1024,
  maxDecompressedBytes: 192 * 1024 * 1024,
  maxExtractedBytes: 10 * 1024 * 1024,
  maxFileBytes: 2 * 1024 * 1024,
  maxFiles: 200,
}

const SCRIPT_PATH_PATTERN = /(^|\/)scripts?\//i
const SCRIPT_EXT_PATTERN = /\.(?:sh|bash|zsh|ps1|bat|cmd|py|js|mjs|cjs|ts)$/i

/** Build the ordered GitHub archive tarball URLs for one verified `owner/repo`. */
export function skillArchiveUrls(source: string): readonly string[] {
  return [
    `https://codeload.github.com/${source}/tar.gz/HEAD`,
    `https://api.github.com/repos/${source}/tarball/HEAD`,
  ]
}

export type SkillTargetResolution =
  | { readonly ok: true; readonly rootDir: string; readonly targetPath: string; readonly projectDir?: string }
  | { readonly ok: false; readonly code: 'invalid-project-dir' | 'invalid-skill'; readonly error: string }

/** Resolve and validate the target directory for one curated skill + scope. */
export function resolveSkillInstallTarget(
  item: FeaturedSkill,
  scope: FeaturedSkillInstallScope,
  projectDir: string | undefined,
  home: string = homedir(),
): SkillTargetResolution {
  if (!SAFE_SKILL_DIR_NAME.test(item.name)) {
    return { ok: false, code: 'invalid-skill', error: `invalid skill directory name "${item.name}"` }
  }
  let rootDir: string
  let normalizedProjectDir: string | undefined
  if (scope === 'user-dsh') {
    rootDir = join(home, '.dsh', 'skills')
  } else if (scope === 'user-agents') {
    rootDir = join(home, '.agents', 'skills')
  } else {
    const trimmed = projectDir?.trim() ?? ''
    if (trimmed === '' || trimmed.length > 4096 || /[\u0000-\u001f]/.test(trimmed) || !isAbsolute(trimmed)) {
      return { ok: false, code: 'invalid-project-dir', error: 'project directory must be a valid absolute path' }
    }
    normalizedProjectDir = resolve(trimmed)
    rootDir = join(normalizedProjectDir, '.dsh', 'skills')
  }
  const targetPath = join(rootDir, item.name)
  const rel = relative(rootDir, targetPath)
  if (rel !== item.name || rel.includes('/') || rel.includes('\\') || rel === '..') {
    return { ok: false, code: 'invalid-skill', error: 'resolved skill target escaped the skills root' }
  }
  return {
    ok: true,
    rootDir,
    targetPath,
    ...(normalizedProjectDir === undefined ? {} : { projectDir: normalizedProjectDir }),
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as { code?: unknown } | null | undefined)?.code === 'ENOENT') return false
    throw error
  }
}

export interface InstallFeaturedSkillOptions {
  readonly home?: string
  readonly fetchImpl?: typeof fetch
  readonly archiveUrls?: (source: string) => readonly string[]
  readonly timeoutMs?: number
  readonly limits?: SubdirExtractLimits
  /** Enable jsDelivr GitHub CDN failover when direct GitHub tarball URLs fail (default true). */
  readonly jsDelivrFallback?: boolean
  readonly jsDelivrDataApiBase?: string
  readonly jsDelivrFileHosts?: readonly string[]
}

async function readResponseWithLimit(response: Response, maxBytes: number, signal?: AbortSignal): Promise<Buffer> {
  if (signal?.aborted) {
    void response.body?.cancel().catch(() => undefined)
    throw signal.reason instanceof Error ? signal.reason : new Error('download aborted')
  }
  if (response.body === null) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const onAbort = (): void => {
    void reader.cancel(signal?.reason).catch(() => undefined)
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  const chunks: Buffer[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (signal?.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new Error('download aborted')
      }
      if (done) break
      if (value === undefined || value.byteLength === 0) continue
      total += value.byteLength
      if (total > maxBytes) {
        throw new Error(`downloaded file exceeded ${maxBytes} bytes limit`)
      }
      chunks.push(Buffer.from(value))
    }
    return Buffer.concat(chunks, total)
  } finally {
    signal?.removeEventListener('abort', onAbort)
    void reader.cancel().catch(() => undefined)
  }
}

function normalizeSkillSubpath(raw: string): string {
  return raw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

function safeRelativeFromFlatEntry(entryName: string, subdirPrefix: string): string | null {
  if (!entryName.startsWith('/') || /[\u0000-\u001f\\]/.test(entryName)) return null
  const trimmed = entryName.slice(1)
  if (trimmed === '' || trimmed.endsWith('/')) return null
  const segments = trimmed.split('/')
  if (segments.some(seg => seg === '' || seg === '.' || seg === '..' || seg.includes(':'))) return null
  if (subdirPrefix === '') {
    if (segments[0] === '.git' || segments[0] === 'node_modules') return null
    return trimmed
  }
  const prefix = `${subdirPrefix}/`
  if (!trimmed.startsWith(prefix)) return null
  const rel = trimmed.slice(prefix.length)
  return rel === '' ? null : rel
}

function encodePathSegments(path: string): string {
  return path.split('/').map(segment => encodeURIComponent(segment)).join('/')
}

async function fetchBufferWithLimit(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  timeoutMs: number,
  maxBytes: number,
): Promise<{ readonly ok: true; readonly buffer: Buffer } | { readonly ok: false; readonly status: number }> {
  const attemptController = new AbortController()
  const onAbort = (): void => { attemptController.abort(signal.reason) }
  if (signal.aborted) {
    attemptController.abort(signal.reason)
  } else {
    signal.addEventListener('abort', onAbort, { once: true })
  }
  const timer = setTimeout(() => { attemptController.abort(new Error('download timed out')) }, timeoutMs)
  try {
    const response = await fetchImpl(url, {
      headers,
      redirect: 'follow',
      signal: attemptController.signal,
    })
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined)
      return { ok: false, status: response.status }
    }
    const buffer = await readResponseWithLimit(response, maxBytes, attemptController.signal)
    return { ok: true, buffer }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}

/**
 * China-friendly fallback using jsDelivr's official GitHub package file tree
 * (`data.jsdelivr.com`) and Fastly/CDN edges (`fastly.jsdelivr.net`,
 * `cdn.jsdelivr.net`) when `codeload.github.com` and `api.github.com` fail.
 */
export async function fetchSkillSubdirFromJsDelivr(
  source: string,
  subdir: string,
  signal: AbortSignal,
  options: {
    readonly fetchImpl?: typeof fetch
    readonly timeoutMs?: number
    readonly limits?: SubdirExtractLimits
    readonly dataApiBase?: string
    readonly fileHosts?: readonly string[]
  } = {},
): Promise<{ readonly ok: true; readonly files: ReadonlyMap<string, Buffer> } | { readonly ok: false; readonly error: string }> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
  const limits = options.limits ?? DEFAULT_EXTRACT_LIMITS
  const dataApiBase = (options.dataApiBase ?? JSDELIVR_DATA_API_BASE).replace(/\/+$/, '')
  const fileHosts = options.fileHosts ?? JSDELIVR_FILE_HOSTS
  const normalizedSubdir = normalizeSkillSubpath(subdir)
  let lastError = 'could not fetch skill files from jsDelivr mirror'

  for (const ref of JSDELIVR_BRANCH_REFS) {
    if (signal.aborted) return { ok: false, error: 'installation cancelled' }
    const manifestUrl = `${dataApiBase}/${source}@${ref}?structure=flat`
    let manifestJson: unknown
    try {
      const manifestFetch = await fetchBufferWithLimit(
        fetchImpl,
        manifestUrl,
        { 'user-agent': 'dsh-market-pro', accept: 'application/json' },
        signal,
        timeoutMs,
        MAX_JSDELIVR_MANIFEST_BYTES,
      )
      if (!manifestFetch.ok) {
        lastError = `HTTP ${String(manifestFetch.status)} from jsDelivr (${ref})`
        continue
      }
      manifestJson = JSON.parse(manifestFetch.buffer.toString('utf8'))
    } catch (error) {
      if (signal.aborted) return { ok: false, error: 'installation cancelled' }
      lastError = error instanceof Error ? error.message : String(error)
      continue
    }

    const rawFiles = manifestJson !== null && typeof manifestJson === 'object'
      ? (manifestJson as { files?: unknown }).files
      : undefined
    if (!Array.isArray(rawFiles)) {
      lastError = `invalid jsDelivr manifest for ${source}@${ref}`
      continue
    }

    const candidates: { readonly repoPath: string; readonly relPath: string }[] = []
    for (const entry of rawFiles) {
      if (entry === null || typeof entry !== 'object') continue
      const name = (entry as { name?: unknown }).name
      if (typeof name !== 'string') continue
      const relPath = safeRelativeFromFlatEntry(name, normalizedSubdir)
      if (relPath === null) continue
      const size = (entry as { size?: unknown }).size
      if (typeof size === 'number' && size > limits.maxFileBytes) {
        return { ok: false, error: `skill file "${relPath}" exceeds ${limits.maxFileBytes} bytes limit` }
      }
      candidates.push({ repoPath: name.slice(1), relPath })
      if (candidates.length > limits.maxFiles) {
        return { ok: false, error: `skill directory exceeds maximum ${limits.maxFiles} files limit` }
      }
    }

    const hasRootSkillDoc = candidates.some(c => !c.relPath.includes('/') && c.relPath.toLowerCase() === 'skill.md')
    if (candidates.length === 0 || !hasRootSkillDoc) {
      lastError = `jsDelivr mirror (${ref}) did not contain SKILL.md under "${normalizedSubdir || '/'}"`
      continue
    }

    const downloaded = new Map<string, Buffer>()
    let totalBytes = 0
    let cursor = 0
    let preferredHostIndex = 0
    let workerError: string | undefined

    const downloadOne = async (candidate: { readonly repoPath: string; readonly relPath: string }): Promise<void> => {
      const encoded = encodePathSegments(candidate.repoPath)
      const order = [
        ...fileHosts.slice(preferredHostIndex),
        ...fileHosts.slice(0, preferredHostIndex),
      ]
      let fileErr = `failed to download ${candidate.relPath}`
      for (let i = 0; i < order.length; i += 1) {
        if (signal.aborted || workerError !== undefined) return
        const host = order[i]!
        const fileUrl = `https://${host}/gh/${source}@${ref}/${encoded}`
        try {
          const fileFetch = await fetchBufferWithLimit(
            fetchImpl,
            fileUrl,
            { 'user-agent': 'dsh-market-pro' },
            signal,
            timeoutMs,
            limits.maxFileBytes,
          )
          if (!fileFetch.ok) {
            fileErr = `HTTP ${String(fileFetch.status)} from ${host}`
            continue
          }
          const buf = fileFetch.buffer
          totalBytes += buf.byteLength
          if (totalBytes > limits.maxExtractedBytes) {
            throw new Error(`extracted skill files exceed ${limits.maxExtractedBytes} bytes limit`)
          }
          downloaded.set(candidate.relPath, buf)
          preferredHostIndex = fileHosts.indexOf(host)
          return
        } catch (error) {
          if (signal.aborted) return
          fileErr = error instanceof Error ? error.message : String(error)
          if (fileErr.includes('exceed')) {
            workerError = fileErr
            return
          }
        }
      }
      workerError = fileErr
    }

    const workers = Array.from({ length: Math.min(JSDELIVR_CONCURRENCY, candidates.length) }, async () => {
      while (cursor < candidates.length && workerError === undefined && !signal.aborted) {
        const next = candidates[cursor]!
        cursor += 1
        await downloadOne(next)
      }
    })
    await Promise.all(workers)

    if (signal.aborted) return { ok: false, error: 'installation cancelled' }
    if (workerError !== undefined) {
      lastError = workerError
      continue
    }
    if (downloaded.size === candidates.length) {
      return { ok: true, files: downloaded }
    }
  }

  return { ok: false, error: lastError }
}

function failResult(
  id: string,
  name: string,
  scope: FeaturedSkillInstallScope,
  targetPath: string,
  code: NonNullable<InstallFeaturedSkillResult['code']>,
  error: string,
): InstallFeaturedSkillResult {
  return { ok: false, id, name, scope, targetPath, fileCount: 0, hasScripts: false, code, error }
}

/**
 * Download and atomically install one allowlisted curated Agent Skill on the Host.
 */
export async function installFeaturedSkillOnHost(
  request: InstallFeaturedSkillRequest,
  signal: AbortSignal,
  options: InstallFeaturedSkillOptions = {},
): Promise<InstallFeaturedSkillResult> {
  const item = findFeaturedSkillById(request.id)
  if (item === undefined) {
    return failResult(request.id, '', request.scope, '', 'not-found', `featured skill "${request.id}" was not found`)
  }
  if (signal.aborted) {
    return failResult(item.id, item.name, request.scope, '', 'cancelled', 'installation cancelled')
  }

  const resolved = resolveSkillInstallTarget(item, request.scope, request.projectDir, options.home)
  if (!resolved.ok) {
    return failResult(item.id, item.name, request.scope, '', resolved.code, resolved.error)
  }
  const { rootDir, targetPath, projectDir } = resolved

  if (projectDir !== undefined) {
    try {
      const info = await stat(projectDir)
      if (!info.isDirectory()) {
        return failResult(item.id, item.name, request.scope, targetPath, 'invalid-project-dir', 'selected project path is not a directory')
      }
    } catch {
      return failResult(item.id, item.name, request.scope, targetPath, 'invalid-project-dir', 'selected project directory does not exist')
    }
  }

  try {
    if (await pathExists(targetPath) && request.overwrite !== true) {
      return failResult(item.id, item.name, request.scope, targetPath, 'already-exists', `skill directory already exists at ${targetPath}`)
    }
  } catch (error) {
    return failResult(
      item.id,
      item.name,
      request.scope,
      targetPath,
      'write-failed',
      error instanceof Error ? error.message : String(error),
    )
  }

  const fetchImpl = options.fetchImpl ?? fetch
  const urls = (options.archiveUrls ?? skillArchiveUrls)(item.source)
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
  const limits = options.limits ?? DEFAULT_EXTRACT_LIMITS

  let files: ReadonlyMap<string, Buffer> | undefined
  let lastError = 'could not download skill archive'

  for (const url of urls) {
    if (signal.aborted) {
      return failResult(item.id, item.name, request.scope, targetPath, 'cancelled', 'installation cancelled')
    }
    const attemptController = new AbortController()
    const onAbort = (): void => { attemptController.abort(signal.reason) }
    signal.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => { attemptController.abort(new Error('download timed out')) }, timeoutMs)
    try {
      const response = await fetchImpl(url, {
        headers: {
          'user-agent': 'dsh-market-pro',
          accept: 'application/gzip, application/octet-stream, */*',
        },
        redirect: 'follow',
        signal: attemptController.signal,
      })
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined)
        lastError = `HTTP ${String(response.status)} from ${new URL(url).hostname}`
        continue
      }
      const extracted = await extractSubdirFromTgzResponse(response, item.path, limits)
      files = extracted.files
      break
    } catch (error) {
      if (signal.aborted) {
        return failResult(item.id, item.name, request.scope, targetPath, 'cancelled', 'installation cancelled')
      }
      lastError = error instanceof Error ? error.message : String(error)
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }
  }

  if (files === undefined && options.jsDelivrFallback !== false && !signal.aborted) {
    const mirror = await fetchSkillSubdirFromJsDelivr(item.source, item.path, signal, {
      fetchImpl,
      timeoutMs,
      limits,
      ...(options.jsDelivrDataApiBase !== undefined ? { dataApiBase: options.jsDelivrDataApiBase } : {}),
      ...(options.jsDelivrFileHosts !== undefined ? { fileHosts: options.jsDelivrFileHosts } : {}),
    })
    if (signal.aborted) {
      return failResult(item.id, item.name, request.scope, targetPath, 'cancelled', 'installation cancelled')
    }
    if (mirror.ok) {
      files = mirror.files
    } else {
      lastError = `${lastError}; jsDelivr fallback: ${mirror.error}`
    }
  }

  if (files === undefined) {
    return failResult(item.id, item.name, request.scope, targetPath, 'download-failed', lastError)
  }

  const hasSkillDoc = [...files.keys()].some(rel => !rel.includes('/') && rel.toLowerCase() === 'skill.md')
  if (files.size === 0 || !hasSkillDoc) {
    return failResult(
      item.id,
      item.name,
      request.scope,
      targetPath,
      'invalid-skill',
      'downloaded repository subpath did not contain a root SKILL.md',
    )
  }

  const hasScripts = [...files.keys()].some(rel => SCRIPT_PATH_PATTERN.test(rel) || SCRIPT_EXT_PATTERN.test(rel))

  const stageDir = join(rootDir, `.dsh-skill-stage-${randomBytes(6).toString('hex')}`)
  let backupDir: string | undefined
  try {
    await mkdir(stageDir, { recursive: true })
    for (const [relPath, content] of files) {
      const destFile = resolve(stageDir, relPath)
      const relCheck = relative(stageDir, destFile)
      if (relCheck === '' || relCheck.startsWith('..') || isAbsolute(relCheck)) {
        throw new Error(`unsafe extracted file path "${relPath}"`)
      }
      await mkdir(dirname(destFile), { recursive: true })
      await writeFile(destFile, content)
    }
    const provenance = `${JSON.stringify({
      schemaVersion: 1,
      featuredId: item.id,
      source: item.source,
      path: item.path,
    }, null, 2)}\n`
    await writeFile(join(stageDir, SKILL_PROVENANCE_FILE), provenance, 'utf8')
    if (signal.aborted) {
      return failResult(item.id, item.name, request.scope, targetPath, 'cancelled', 'installation cancelled')
    }

    const existsNow = await pathExists(targetPath)
    if (existsNow) {
      if (request.overwrite !== true) {
        return failResult(item.id, item.name, request.scope, targetPath, 'already-exists', `skill directory already exists at ${targetPath}`)
      }
      backupDir = join(rootDir, `.dsh-skill-bak-${randomBytes(6).toString('hex')}`)
      await rename(targetPath, backupDir)
      try {
        await rename(stageDir, targetPath)
      } catch (swapError) {
        await rename(backupDir, targetPath).catch(() => undefined)
        backupDir = undefined
        throw swapError
      }
      await rm(backupDir, { recursive: true, force: true }).catch(() => undefined)
      backupDir = undefined
    } else {
      await rename(stageDir, targetPath)
    }

    return {
      ok: true,
      id: item.id,
      name: item.name,
      scope: request.scope,
      targetPath,
      fileCount: files.size,
      hasScripts,
      error: '',
    }
  } catch (error) {
    if (signal.aborted) {
      return failResult(item.id, item.name, request.scope, targetPath, 'cancelled', 'installation cancelled')
    }
    const code = (error as { code?: unknown } | null | undefined)?.code
    if ((code === 'EEXIST' || code === 'ENOTEMPTY') && request.overwrite !== true) {
      return failResult(item.id, item.name, request.scope, targetPath, 'already-exists', `skill directory already exists at ${targetPath}`)
    }
    return failResult(
      item.id,
      item.name,
      request.scope,
      targetPath,
      'write-failed',
      error instanceof Error ? error.message : String(error),
    )
  } finally {
    await rm(stageDir, { recursive: true, force: true }).catch(() => undefined)
    if (backupDir !== undefined) {
      await rm(backupDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

function findSkillsRootDir(targetPath: string): string | null {
  let cursor = dirname(targetPath)
  while (true) {
    const parent = dirname(cursor)
    if (parent === cursor) return null
    const dirName = basename(cursor).toLowerCase()
    const parentName = basename(parent).toLowerCase()
    if (dirName === 'skills' && (parentName === '.dsh' || parentName === '.agents')) {
      return cursor
    }
    cursor = parent
  }
}

/**
 * Safely delete one locally installed Agent Skill directory from disk.
 *
 * Refuses anything outside a recognized `.dsh/skills/` or `.agents/skills/`
 * directory (including symlinked skills roots or symlinked intermediate parent
 * directories), refuses `node_modules` / `.asar` / bundled paths, removes
 * direct symlinks without following them, and verifies real directories contain
 * a root `SKILL.md` before deleting.
 */
export async function deleteInstalledSkillOnHost(
  request: DeleteInstalledSkillRequest,
): Promise<DeleteInstalledSkillResult> {
  const name = request.name.trim()
  const rawPath = request.sourcePath.trim()
  if (name === '' || !isDeletableSkillPath(rawPath)) {
    return {
      ok: false,
      name,
      targetPath: rawPath,
      code: 'not-deletable',
      error: 'skill path is not a deletable user or project skill directory',
    }
  }
  const targetPath = resolve(rawPath)
  const skillsRoot = findSkillsRootDir(targetPath)
  if (!isDeletableSkillPath(targetPath) || skillsRoot === null) {
    return {
      ok: false,
      name,
      targetPath,
      code: 'not-deletable',
      error: 'resolved skill path is not a deletable user or project skill directory',
    }
  }
  try {
    const rootInfo = await lstat(skillsRoot)
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
      return {
        ok: false,
        name,
        targetPath,
        code: 'not-deletable',
        error: 'skills root directory is not a real directory and cannot be modified safely',
      }
    }
    const realSkillsRoot = await realpath(skillsRoot)
    const realParent = await realpath(dirname(targetPath))
    const relParent = relative(realSkillsRoot, realParent)
    const escapesRoot = relParent === '..'
      || relParent.startsWith('../')
      || relParent.startsWith('..\\')
      || isAbsolute(relParent)
    const realTarget = join(realParent, basename(targetPath))
    if (escapesRoot || !isDeletableSkillPath(realTarget)) {
      return {
        ok: false,
        name,
        targetPath,
        code: 'not-deletable',
        error: 'skill parent directory resolves outside the skills root and will not be deleted',
      }
    }
    const info = await lstat(realTarget)
    if (info.isSymbolicLink()) {
      await rm(realTarget, { force: false })
      return { ok: true, name, targetPath, error: '' }
    }
    if (!info.isDirectory()) {
      return {
        ok: false,
        name,
        targetPath,
        code: 'not-deletable',
        error: 'skill target path is not a directory',
      }
    }
    const entries = await readdir(realTarget)
    const hasSkillDoc = entries.some(entry => entry.toLowerCase() === 'skill.md')
    if (!hasSkillDoc) {
      return {
        ok: false,
        name,
        targetPath,
        code: 'not-deletable',
        error: 'target directory does not contain SKILL.md and will not be deleted',
      }
    }
    await rm(realTarget, { recursive: true, force: false })
    return { ok: true, name, targetPath, error: '' }
  } catch (error) {
    const code = (error as { code?: unknown } | null | undefined)?.code
    if (code === 'ENOENT') {
      return {
        ok: false,
        name,
        targetPath,
        code: 'not-found',
        error: `skill directory does not exist at ${targetPath}`,
      }
    }
    return {
      ok: false,
      name,
      targetPath,
      code: 'delete-failed',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
