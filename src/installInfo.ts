/** Feed installation metadata is data, never a shell command. */
import { REPOSITORY_SLUG_PATTERN } from './shapes.ts'

const NPM_INSTALL_SPEC_PATTERN = /^((?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*)(?:@[a-zA-Z0-9.*^~+_-][a-zA-Z0-9.*^~+_-]*)?$/

/** Maximum length accepted for a normalized repository subdirectory on the wire. */
export const MAX_REPO_DIRECTORY_LENGTH = 1024

/** A GitHub repository and optional normalized subdirectory path. */
export interface GitHubLocator {
  readonly repository: string
  readonly directory: string
}

/** Normalize a repository subdirectory path (`packages/dsh-plugin`), or `''` for root / unsafe / overlong paths. */
export function normalizeRepoDirectory(raw: string): string {
  if (raw.length > MAX_REPO_DIRECTORY_LENGTH * 4) return ''
  const cleaned = raw.trim().replaceAll('\\', '/').replace(/^(?:\.\/)+/, '').replace(/^\/+/, '').replace(/\/+$/, '')
  if (cleaned === '' || cleaned === '.') return ''
  const parts = cleaned.split('/').filter(Boolean)
  if (parts.length === 0 || parts.some(part => part === '.' || part === '..' || /[\x00-\x1f]/.test(part))) return ''
  const normalized = parts.join('/')
  return normalized.length <= MAX_REPO_DIRECTORY_LENGTH ? normalized : ''
}

/** Extract the npm package name from an npm install spec (`@scope/pkg@1.2.3` → `@scope/pkg`), or `''`. */
export function packageNameFromInstallSpec(spec: string): string {
  const match = NPM_INSTALL_SPEC_PATTERN.exec(spec.trim())
  return match?.[1] ?? ''
}

/**
 * Reduce a GitHub URL or shorthand (`github:owner/name`, optional bare `owner/name`)
 * to `owner/name`, stripping trailing slashes and `.git` case-insensitively.
 */
export function parseGitHubRepoSlug(
  value: string,
  options: { allowBareSlug?: boolean; allowCodeload?: boolean } = {},
): string {
  const trimmed = value.trim()
  if (trimmed === '') return ''
  if (trimmed.toLowerCase().startsWith('github:')) {
    const slug = trimmed.slice('github:'.length).replace(/\/+$/, '').replace(/\.git$/i, '')
    return REPOSITORY_SLUG_PATTERN.test(slug) ? slug : ''
  }
  if (options.allowBareSlug && REPOSITORY_SLUG_PATTERN.test(trimmed)) return trimmed
  const urlMatch = /^(?:git\+)?(?:https?|git|ssh):\/\/(?:[^@/]*@)?github\.com\/(.+)$/i.exec(trimmed)
    ?? /^(?:git\+ssh:\/\/)?git@github\.com:(.+)$/i.exec(trimmed)
  if (urlMatch !== null) {
    const slug = urlMatch[1]!.replace(/\/+$/, '').replace(/\.git$/i, '')
    return REPOSITORY_SLUG_PATTERN.test(slug) ? slug : ''
  }
  if (options.allowCodeload) {
    const codeloadMatch = /^https:\/\/codeload\.github\.com\/([^/]+\/[^/]+)\//i.exec(trimmed)
    if (codeloadMatch !== null && REPOSITORY_SLUG_PATTERN.test(codeloadMatch[1]!)) {
      return codeloadMatch[1]!
    }
  }
  return ''
}

/**
 * Extract the GitHub `owner/name` and optional `#path:...` subdirectory from a
 * catalog install target or profile `dependencies` git spec. Rejects invalid
 * `#path:` values instead of degrading them to the repository root.
 */
export function parseGitHubInstallSpec(spec: string): GitHubLocator | null {
  const trimmed = spec.trim()
  if (trimmed === '') return null
  const hashIndex = trimmed.indexOf('#')
  const base = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed
  const hash = hashIndex >= 0 ? trimmed.slice(hashIndex + 1) : ''
  const pathMatch = /(?:^|&)path:([^&#]*)/.exec(hash)
  let directory = ''
  if (pathMatch !== null) {
    let rawDir = pathMatch[1]!
    try { rawDir = decodeURIComponent(rawDir) } catch { /* keep raw */ }
    const normalized = normalizeRepoDirectory(rawDir)
    const explicitRoot = /^\s*(?:\.?\/+|\.)?\s*$/.test(rawDir.replaceAll('\\', '/'))
    if (normalized === '' && !explicitRoot) return null
    directory = normalized
  }
  const repository = parseGitHubRepoSlug(base, { allowCodeload: true })
  return repository !== '' ? { repository, directory } : null
}

export function isInstallSpec(value: string): boolean {
  if (value.length > 2048 || /[\s\x00-\x1f`$<>\\]/.test(value)) return false
  if (NPM_INSTALL_SPEC_PATTERN.test(value)) return true
  try {
    const url = new URL(value.replace(/^git\+/, ''))
    return url.protocol === 'https:' && !url.username && !url.password && !url.search
      && ['github.com', 'codeload.github.com', 'raw.githubusercontent.com', 'gitee.com'].includes(url.hostname)
      && /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)?$/.test(url.pathname)
      && !url.pathname.split('/').some(p => p === '.' || p === '..')
      && (!url.hash || (/^#(?:[A-Za-z0-9_./-]+)?(?:&?path:\/?[A-Za-z0-9_./-]*)?$/.test(url.hash) && !url.hash.includes('..')))
  } catch { return false }
}
export interface InstallInfo {
  mode: 'command' | 'manual'
  targets: { install: string; profile: string; note: string }[]
  tasks: string[]
  requirements: string[]
  note: string
  manual: string
}
const text = (v: unknown): string => typeof v === 'string' ? v.slice(0, 2000) : ''
const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, 30).map(text) : []
export function parseInstallInfo(value: unknown): InstallInfo | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (raw.mode !== 'command' && raw.mode !== 'manual') return undefined
  const targets: InstallInfo['targets'] = []
  for (const entry of Array.isArray(raw.targets) ? raw.targets.slice(0, 30) : []) {
    if (!entry || typeof entry !== 'object' || typeof entry.install !== 'string' || !isInstallSpec(entry.install)) continue
    if (targets.some(t => t.install === entry.install && t.profile === text(entry.profile))) continue
    targets.push({ install: entry.install, profile: text(entry.profile), note: text(entry.note) })
  }
  return { mode: raw.mode, targets, tasks: strings(raw.tasks), requirements: strings(raw.requirements), note: text(raw.note), manual: text(raw.manual_instructions) }
}
