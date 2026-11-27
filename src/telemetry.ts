/**
 * Minimal, opt-out usage & install telemetry for DSH Market Pro.
 *
 * Design invariants:
 * - Local random install ID: uses a random per-install UUIDv4 persisted in
 *   the local storage domain (never tied to hardware IDs, accounts, usernames,
 *   paths, prompts, or secrets) and cleared immediately when opted out.
 * - Strictly low-frequency: at most one daily heartbeat per UTC+8 day (plus a
 *   single refinement ping if the UI attaches after a headless boot and adds
 *   exact `desktop`/`web` + locale context), with daily backoff on failure.
 * - Public targets only: plugin/MCP install feedback is checked against known
 *   official public catalog entries and built-in curated MCP IDs; anything else
 *   (including private/custom servers or custom catalog feeds) is dropped
 *   without sending any network request.
 * - Fail-silent & non-blocking: every request has a short timeout and swallows
 *   network failures without touching the marketplace UI or console error logs.
 */
import { randomUUID } from 'node:crypto'
import { detectDshVersion } from './hostRuntime.ts'
import { parseGitHubRepoSlug } from './installInfo.ts'
import { FEATURED_MCP_SERVERS } from './mcpFeatured.ts'
import { findFeaturedSkillByExactId } from './skillsFeatured.ts'
import type {
  TelemetryClientEvent,
  TelemetryErrorCode,
  TelemetryHostKind,
  TelemetryLocale,
  TelemetryOs,
} from './contract.ts'
import { PACKAGE_NAME_PATTERN, TELEMETRY_ERROR_DETAIL_PATTERN } from './shapes.ts'
import { classifyInstallError, extractInstallErrorDetail, type InstallErrorHints } from './telemetryError.ts'

export { classifyInstallError, detectDshVersion, extractInstallErrorDetail, type InstallErrorHints }

export const DEFAULT_TELEMETRY_ENDPOINT = 'https://dsh-market-pro.com/api/telemetry'
const REQUEST_TIMEOUT_MS = 3_000
const BOOT_PING_DELAY_MS = 8_000

const FEATURED_MCP_IDS = new Set(FEATURED_MCP_SERVERS.map(server => server.id))
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface TelemetryStoragePort {
  read(): {
    readonly telemetryId: string
    readonly telemetryLastPingDay: string
    readonly telemetryLastPingKind: string
  }
  write(patch: {
    readonly telemetryId?: string
    readonly telemetryLastPingDay?: string
    readonly telemetryLastPingKind?: string
  }): void
  readonly ready?: Promise<void>
}

export interface TelemetryOptions {
  readonly endpoint?: string
  readonly pluginVersion: string
  readonly dshVersion?: string
  readonly hostKind?: TelemetryHostKind
  readonly os?: TelemetryOs
  readonly isEnabled: () => boolean
  readonly isPublicPluginTarget?: (target: string) => boolean
  readonly resolvePublicPluginTarget?: (candidate: string) => string | null
  readonly storage: TelemetryStoragePort
  readonly disposeSignal?: AbortSignal
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly fetcher?: typeof fetch
  readonly now?: () => Date
  readonly bootDelayMs?: number
}

export interface TelemetryReporter {
  scheduleBootPing(): void
  handleClientEvent(event: TelemetryClientEvent): void
  reportPluginInstall(input: {
    readonly target: string
    readonly mode: 'direct' | 'ai'
    readonly result: 'ok' | 'failed'
    readonly errorCode?: TelemetryErrorCode
    readonly errorDetail?: string
  }): void
  reportMcpInstall(input: {
    readonly target: string
    readonly mode: 'featured' | 'ai' | 'custom'
    readonly result: 'ok' | 'failed'
    readonly errorCode?: TelemetryErrorCode
    readonly errorDetail?: string
  }): void
  reportSkillInstall(input: {
    readonly target: string
    readonly mode: 'featured' | 'ai'
    readonly result: 'ok' | 'failed'
    readonly errorCode?: TelemetryErrorCode
    readonly errorDetail?: string
  }): void
  dispose(): void
}

/** UTC+8 calendar day (`YYYY-MM-DD`), matching the server analytics boundary. */
export function telemetryDay(now: Date = new Date()): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1_000).toISOString().slice(0, 10)
}

/** Respect standard opt-out, DSH host opt-out, and CI environment variables. */
export function isTelemetryEnvSuppressed(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if ((env.DSH_TELEMETRY_DISABLED ?? '').trim() !== '') return true
  const dnt = (env.DO_NOT_TRACK ?? '').trim().toLowerCase()
  if (dnt !== '' && dnt !== '0' && dnt !== 'false' && dnt !== 'off' && dnt !== 'no') return true
  const opt = (env.DSH_MARKET_TELEMETRY ?? '').trim().toLowerCase()
  if (opt === '0' || opt === 'false' || opt === 'off') return true
  const ci = (env.CI ?? '').trim().toLowerCase()
  if (ci === '1' || ci === 'true') return true
  return false
}

/** Detect whether the host process is running inside a desktop wrapper. */
export function detectHostKind(
  env: Readonly<Record<string, string | undefined>> = process.env,
  versions: Readonly<Record<string, string | undefined>> = process.versions,
): TelemetryHostKind {
  if (
    typeof versions.electron === 'string' && versions.electron !== ''
    || env.ELECTRON_RUN_AS_NODE === '1'
    || (env.DSH_DESKTOP_RUNTIME_ENTRY ?? '').trim() !== ''
    || (env.DSH_DESKTOP_HOME ?? '').trim() !== ''
  ) {
    return 'desktop'
  }
  return 'other'
}

export function detectOs(platform: string = process.platform): TelemetryOs {
  if (platform === 'darwin' || platform === 'win32' || platform === 'linux') return platform
  return 'other'
}

/**
 * Extract a clean package name or `owner/repo` slug from an install target,
 * optionally resolving it to a canonical official-catalog identifier, else `'custom'`.
 */
export function sanitizePluginTarget(
  rawTarget: string,
  resolver?: (candidate: string) => boolean | string | null,
): string {
  const trimmed = rawTarget.trim()
  if (trimmed === '' || trimmed === 'custom') return 'custom'
  let candidate = ''
  const withoutFragment = trimmed.split(/[#?]/, 1)[0]!
  const repoUrlMatch = /^(?:git\+)?https:\/\/(?:github\.com|gitee\.com)\/([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+?)(?:\.git)?(?:\/|$)/i.exec(withoutFragment)
  if (repoUrlMatch !== null) {
    candidate = repoUrlMatch[1]!
  } else {
    const parsedGh = parseGitHubRepoSlug(withoutFragment, { allowBareSlug: true, allowCodeload: true })
    if (parsedGh !== '') {
      candidate = parsedGh
    } else {
      // Strip npm version suffix (`@scope/pkg@1.2.3` -> `@scope/pkg`, `pkg@1.2.3` -> `pkg`).
      const at = trimmed.lastIndexOf('@')
      const bare = at > 0 ? trimmed.slice(0, at) : trimmed
      if (PACKAGE_NAME_PATTERN.test(bare)) {
        candidate = bare
      }
    }
  }
  if (candidate === '') return 'custom'
  if (resolver !== undefined) {
    const resolved = resolver(candidate)
    if (resolved === false || resolved === null || resolved === '' || resolved === 'custom') return 'custom'
    if (typeof resolved === 'string') return resolved
  }
  return candidate
}

/** Only keep known built-in curated MCP IDs; collapse user custom servers to `'custom'`. */
export function sanitizeMcpTarget(rawId: string): string {
  const clean = rawId.trim().toLowerCase()
  return FEATURED_MCP_IDS.has(clean) ? clean : 'custom'
}

/** Only keep known built-in curated Agent Skill IDs (`owner/repo/skillId`), else `'custom'`. */
export function sanitizeSkillTarget(rawId: string): string {
  const found = findFeaturedSkillByExactId(rawId.trim())
  return found !== undefined ? found.id : 'custom'
}

export function createTelemetryReporter(options: TelemetryOptions): TelemetryReporter {
  const endpoint = options.endpoint ?? DEFAULT_TELEMETRY_ENDPOINT
  const fetcher = options.fetcher ?? fetch
  const now = options.now ?? (() => new Date())
  const env = options.env ?? process.env
  const pluginVersion = options.pluginVersion.trim() || 'unknown'
  const dshVersion = options.dshVersion ?? detectDshVersion()
  const os = options.os ?? detectOs()
  const bootDelayMs = options.bootDelayMs ?? BOOT_PING_DELAY_MS

  let observedHostKind: TelemetryHostKind = options.hostKind ?? detectHostKind(env)
  let observedLocale: TelemetryLocale = 'other'
  let disposed = false
  let bootTimer: ReturnType<typeof setTimeout> | undefined
  let pingInFlight = false
  let pingRecheckRequested = false
  let pingFailedDay = ''
  let feedbackFailureDay = ''
  let feedbackFailuresToday = 0
  const MAX_DAILY_FEEDBACK_FAILURES = 3

  const canSend = (): boolean =>
    !disposed
    && !(options.disposeSignal?.aborted ?? false)
    && !isTelemetryEnvSuppressed(env)
    && options.isEnabled()

  const ensureInstallId = (): string => {
    const current = options.storage.read().telemetryId
    if (UUID_V4_PATTERN.test(current)) return current
    const generated = randomUUID()
    options.storage.write({ telemetryId: generated })
    return generated
  }

  const post = async (payload: Record<string, unknown>): Promise<boolean> => {
    if (!canSend()) return false
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    const signal = options.disposeSignal === undefined
      ? timeout
      : AbortSignal.any([timeout, options.disposeSignal])
    try {
      const response = await fetcher(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': `dsh-market-pro/${pluginVersion}`,
        },
        body: JSON.stringify(payload),
        signal,
      })
      await response.body?.cancel().catch(() => undefined)
      return response.ok
    } catch {
      return false
    }
  }

  const sendPingIfNeeded = async (): Promise<void> => {
    if (pingInFlight) {
      pingRecheckRequested = true
      return
    }
    pingInFlight = true
    try {
      do {
        pingRecheckRequested = false
        if (options.storage.ready !== undefined) {
          await options.storage.ready.catch(() => undefined)
        }
        if (!canSend()) return
        const today = telemetryDay(now())
        if (pingFailedDay === today) return
        const state = options.storage.read()
        const pingHostKind = observedHostKind
        const pingLocale = observedLocale
        const alreadyPingedToday = state.telemetryLastPingDay === today
        const refinedContext =
          state.telemetryLastPingKind === 'other' && pingHostKind !== 'other'
        if (alreadyPingedToday && !refinedContext) return

        const id = ensureInstallId()
        const ok = await post({
          v: 1,
          event: 'ping',
          id,
          pluginVersion,
          dshVersion,
          hostKind: pingHostKind,
          os,
          locale: pingLocale,
        })
        if (!ok) {
          pingFailedDay = today
          break
        }
        pingFailedDay = ''
        if (canSend() && options.storage.read().telemetryId === id) {
          options.storage.write({
            telemetryId: id,
            telemetryLastPingDay: today,
            telemetryLastPingKind: pingHostKind,
          })
        }
      } while (pingRecheckRequested && !disposed)
    } finally {
      pingInFlight = false
    }
  }

  const sendFeedback = async (
    event: 'plugin_install' | 'mcp_install' | 'skill_install',
    target: string,
    mode: 'direct' | 'ai' | 'featured' | 'custom',
    result: 'ok' | 'failed',
    errorCode?: TelemetryErrorCode,
    errorDetail?: string,
  ): Promise<void> => {
    if (options.storage.ready !== undefined) {
      await options.storage.ready.catch(() => undefined)
    }
    if (!canSend()) return
    const today = telemetryDay(now())
    if (feedbackFailureDay !== today) {
      feedbackFailureDay = today
      feedbackFailuresToday = 0
    }
    if (feedbackFailuresToday >= MAX_DAILY_FEEDBACK_FAILURES) return
    const id = ensureInstallId()
    const safeErrorDetail = result === 'failed'
      && typeof errorDetail === 'string'
      && TELEMETRY_ERROR_DETAIL_PATTERN.test(errorDetail)
      ? errorDetail
      : undefined
    const ok = await post({
      v: 1,
      event,
      id,
      pluginVersion,
      dshVersion,
      hostKind: observedHostKind,
      os,
      locale: observedLocale,
      target,
      mode,
      result,
      ...(result === 'failed' ? { errorCode: errorCode ?? 'unknown' } : {}),
      ...(safeErrorDetail !== undefined ? { errorDetail: safeErrorDetail } : {}),
    })
    if (ok) feedbackFailuresToday = 0
    else feedbackFailuresToday += 1
  }

  const pluginTargetResolver = options.resolvePublicPluginTarget ?? options.isPublicPluginTarget

  return {
    scheduleBootPing() {
      if (disposed || bootTimer !== undefined) return
      bootTimer = setTimeout(() => {
        bootTimer = undefined
        void sendPingIfNeeded()
      }, bootDelayMs)
      bootTimer.unref?.()
    },

    handleClientEvent(event) {
      if (event.kind === 'client_hello') {
        if (event.hostKind !== 'other') observedHostKind = event.hostKind
        if (event.locale !== 'other') observedLocale = event.locale
        if (bootTimer !== undefined) {
          clearTimeout(bootTimer)
          bootTimer = undefined
        }
        void sendPingIfNeeded()
        return
      }
      if (event.kind === 'plugin_install') {
        const cleanTarget = sanitizePluginTarget(event.target, pluginTargetResolver)
        if (cleanTarget === 'custom') return
        void sendFeedback('plugin_install', cleanTarget, event.mode, event.result, event.errorCode, event.errorDetail)
        return
      }
      if (event.kind === 'mcp_install') {
        const cleanTarget = sanitizeMcpTarget(event.target)
        if (cleanTarget === 'custom') return
        void sendFeedback('mcp_install', cleanTarget, event.mode, event.result, event.errorCode, event.errorDetail)
        return
      }
      if (event.kind === 'skill_install') {
        const cleanTarget = sanitizeSkillTarget(event.target)
        if (cleanTarget === 'custom') return
        void sendFeedback('skill_install', cleanTarget, event.mode, event.result, event.errorCode, event.errorDetail)
      }
    },

    reportPluginInstall(input) {
      const cleanTarget = sanitizePluginTarget(input.target, pluginTargetResolver)
      if (cleanTarget === 'custom') return
      void sendFeedback('plugin_install', cleanTarget, input.mode, input.result, input.errorCode, input.errorDetail)
    },

    reportMcpInstall(input) {
      const cleanTarget = sanitizeMcpTarget(input.target)
      if (cleanTarget === 'custom') return
      void sendFeedback('mcp_install', cleanTarget, input.mode, input.result, input.errorCode, input.errorDetail)
    },

    reportSkillInstall(input) {
      const cleanTarget = sanitizeSkillTarget(input.target)
      if (cleanTarget === 'custom') return
      void sendFeedback('skill_install', cleanTarget, input.mode, input.result, input.errorCode, input.errorDetail)
    },

    dispose() {
      disposed = true
      if (bootTimer !== undefined) {
        clearTimeout(bootTimer)
        bootTimer = undefined
      }
    },
  }
}
