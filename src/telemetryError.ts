import type { TelemetryErrorCode } from './contract.ts'
import { TELEMETRY_ERROR_DETAIL_PATTERN } from './shapes.ts'

export interface InstallErrorHints {
  readonly inspectProblem?: string
  readonly errorCode?: string
  readonly packageKind?: string
  readonly timedOut?: boolean
  readonly skillErrorCode?: string
  readonly mcpReason?: string
  readonly stage?: string
  readonly failedAt?: string
  readonly specKind?: string
  readonly unmet?: string
  readonly exitCode?: number
}

const MANAGEMENT_ERROR_CODE_MAP: Readonly<Record<string, TelemetryErrorCode>> = {
  'incompatible-version': 'compat',
  'unsupported-platform': 'unsupported_platform',
  'not-bundle': 'not_bundle',
  'already-installed': 'already_installed',
  'invalid-spec': 'invalid_spec',
  'unexpected-package': 'invalid_spec',
  'ambiguous-install': 'invalid_spec',
  'stale-approval': 'build_blocked',
  'management-required': 'permission',
  unaddressable: 'permission',
  'unknown-plugin': 'not_found',
  'not-removable': 'refused',
  'stop-profile': 'refused',
  'bundle-in-use': 'refused',
}

const INSPECT_PROBLEM_MAP: Readonly<Record<string, TelemetryErrorCode>> = {
  'not-a-bundle': 'not_bundle',
  'not-a-package': 'not_bundle',
  'already-installed': 'already_installed',
  shipped: 'already_installed',
  'not-found': 'not_found',
  'invalid-spec': 'invalid_spec',
  network: 'network',
}

const PACKAGE_KIND_MAP: Readonly<Record<string, TelemetryErrorCode>> = {
  'pnpm-missing': 'pnpm_missing',
  timeout: 'timeout',
  'not-found': 'not_found',
  'no-matching-version': 'not_found',
  network: 'network',
  'disk-full': 'disk_full',
  permission: 'permission',
  'build-blocked': 'build_blocked',
  integrity: 'integrity',
}

/** Keep both the head and tail of long logs so leading `ERR_PNPM_*` codes survive truncation. */
export function excerptForTelemetry(raw: string, head = 4000, tail = 4000): string {
  const trimmed = raw.trim()
  if (trimmed.length <= head + tail) return trimmed
  return `${trimmed.slice(0, head)}\n...\n${trimmed.slice(-tail)}`
}

function isTimeoutText(text: string): boolean {
  return text.includes('timeout')
    || text.includes('timed out')
    || text.includes('etimedout')
    || text.includes('err_pnpm_fetch_timeout')
    || text.includes('und_err_connect_timeout')
    || text.includes('und_err_headers_timeout')
    || text.includes('und_err_body_timeout')
}

function isTlsText(text: string): boolean {
  return text.includes('self_signed_cert_in_chain')
    || text.includes('unable_to_verify_leaf_signature')
    || text.includes('cert_has_expired')
    || text.includes('depth_zero_self_signed_cert')
    || text.includes('unable to get local issuer certificate')
    || text.includes('err_tls_')
    || text.includes('err_ssl_')
    || text.includes('eproto')
    || text.includes('ssl routine')
    || text.includes('certificate has expired')
    || text.includes('schannel')
}

function isIntegrityText(text: string): boolean {
  return text.includes('integrity')
    || text.includes('err_pnpm_tarball_integrity')
    || text.includes('err_pnpm_bad_tarball_size')
    || text.includes('eintegrity')
    || text.includes('shasum')
    || text.includes('z_data_error')
    || text.includes('z_buf_error')
    || text.includes('incorrect header check')
    || text.includes('invalid tar entry size')
    || text.includes('tar longname entry is too large')
    || text.includes('tar pax entry is too large')
}

const KNOWN_LAUNCHER_NAMES = 'npx|uvx|uv|node|python3?|pipx|bunx|bun|deno|docker|npm'
const KNOWN_LAUNCHER_SPAWN_ENOENT = new RegExp(
  `\\bspawn\\s+(?:${KNOWN_LAUNCHER_NAMES})\\s+enoent\\b|['"]?(?:${KNOWN_LAUNCHER_NAMES})(?:\\.cmd|\\.exe)?['"]?\\s+is not recognized\\b|\\bcommand not found:\\s*(?:${KNOWN_LAUNCHER_NAMES})\\b`,
  'i',
)
const KNOWN_LAUNCHER_CAPTURE_ENOENT = new RegExp(
  `\\bspawn\\s+(${KNOWN_LAUNCHER_NAMES})\\s+enoent\\b|['"]?(${KNOWN_LAUNCHER_NAMES})(?:\\.cmd|\\.exe)?['"]?\\s+is not recognized\\b|\\bcommand not found:\\s*(${KNOWN_LAUNCHER_NAMES})\\b`,
  'i',
)

function classifyTextFallback(text: string): TelemetryErrorCode {
  if (isTimeoutText(text)) return 'timeout'
  if (isTlsText(text)) return 'tls_error'
  if (
    text.includes('econn')
    || text.includes('enotfound')
    || text.includes('eai_again')
    || text.includes('enetunreach')
    || text.includes('ehostunreach')
    || text.includes('epipe')
    || text.includes('err_socket_closed')
    || text.includes('und_err_socket')
    || text.includes('socket hang up')
    || text.includes('socket closed')
    || text.includes('reset by peer')
    || text.includes('could not resolve host')
    || /err_pnpm_fetch_5\d\d/.test(text)
    || /(?:http|status(?:\s+code)?)\s*5\d\d\b/.test(text)
    || text.includes('502 bad gateway')
    || text.includes('503 service unavailable')
    || text.includes('504 gateway')
  ) {
    return 'network'
  }
  if (text.includes('cancel') || text.includes('abort')) return 'cancelled'
  if (
    text.includes('err_pnpm_fetch_429')
    || text.includes('too many requests')
    || text.includes('rate limit')
    || /(?:http|status(?:\s+code)?)\s*429\b/.test(text)
  ) {
    return 'rate_limited'
  }
  if (
    /err_pnpm_fetch_40[13]\b/.test(text)
    || /(?:http|status(?:\s+code)?|returned error:)\s*40[13]\b/.test(text)
    || text.includes('authentication failed')
    || text.includes('could not read username')
    || text.includes('permission denied (publickey)')
    || text.includes('bad credentials')
    || text.includes('401 unauthorized')
    || text.includes('403 forbidden')
    || text.includes('invalid_token')
    || text.includes('invalid_client')
    || text.includes('unauthorized')
  ) {
    return 'auth_failed'
  }
  if (
    text.includes('incompat')
    || text.includes('engines.dsh')
    || text.includes('unsupported engine')
    || text.includes('err_pnpm_unsupported_engine')
    || text.includes('err_pnpm_peer_dep_issues')
    || text.includes('peer dep')
    || text.includes('peerdependency')
    || text.includes('peer dependencies')
    || text.includes('unmet peer')
  ) {
    return 'compat'
  }
  if (
    text.includes('unsupported-platform')
    || text.includes('err_pnpm_unsupported_platform')
    || text.includes('ebadplatform')
  ) {
    return 'unsupported_platform'
  }
  if (text.includes('not-a-bundle') || text.includes('not-bundle') || text.includes('not-a-package')) {
    return 'not_bundle'
  }
  if (
    text.includes('already-installed')
    || text.includes('already-exists')
    || text.includes('name-taken')
    || text.includes('already exists')
  ) {
    return 'already_installed'
  }
  if (text.includes('pnpm-missing') || text.includes('spawn pnpm enoent')) return 'pnpm_missing'
  if (
    KNOWN_LAUNCHER_SPAWN_ENOENT.test(text)
    || (text.includes('enoent') && text.includes('spawn') && new RegExp(`\\b(?:${KNOWN_LAUNCHER_NAMES})\\b`).test(text))
  ) {
    return 'runtime_missing'
  }
  if (
    text.includes('build-blocked')
    || text.includes('stale-approval')
    || text.includes('err_pnpm_ignored_builds')
    || text.includes('err_pnpm_git_dep_prepare_not_allowed')
    || text.includes('ignored build scripts')
  ) {
    return 'build_blocked'
  }
  if (
    text.includes('gyp err!')
    || text.includes('node-gyp')
    || text.includes('prebuild-install')
    || text.includes('err_pnpm_recursive_run_first_fail')
    || ((text.includes('lifecycle') || text.includes('postinstall') || text.includes('prepare'))
      && (text.includes('failed') || text.includes('exit')))
  ) {
    return 'build_failed'
  }
  if (text.includes('enospc') || text.includes('disk-full') || text.includes('no space left')) return 'disk_full'
  if (/\b(?:ebusy|elocked|enotempty|enametoolong|exdev)\b/.test(text)) return 'fs_locked'
  if (
    text.includes('eacces')
    || text.includes('eperm')
    || text.includes('erofs')
    || text.includes('management-required')
    || text.includes('unaddressable')
    || text.includes('settings-readonly')
    || text.includes('permission denied')
  ) {
    return 'permission'
  }
  if (
    text.includes('err_pnpm_no_matching_version')
    || text.includes('err_pnpm_fetch_404')
    || text.includes('no-matching-version')
    || text.includes('not-found')
    || text.includes('repository not found')
    || text.includes('pnpm view answered no package')
    || /returned error:\s*404\b/.test(text)
    || text.includes('http 404')
    || text.includes('e404')
    || /\betarget\b/.test(text)
  ) {
    return 'not_found'
  }
  if (
    text.includes('spawn git enoent')
    || text.includes('git is not recognized')
    || text.includes('err_pnpm_git_')
    || text.includes('failed to clone')
    || text.includes('did not match any file(s)')
    || text.includes('not a git repository')
    || text.includes('fatal: unable to access')
  ) {
    return 'git_failed'
  }
  if (isIntegrityText(text)) return 'integrity'
  if (
    text.includes('invalid-spec')
    || text.includes('unexpected-package')
    || text.includes('ambiguous-install')
    || text.includes('invalid-skill')
  ) {
    return 'invalid_spec'
  }
  if (
    text.includes('refused')
    || text.includes('denied')
    || text.includes('disallowed')
    || text.includes('forbidden')
    || text.includes('readonly')
    || text.includes('settings-conflict')
    || text.includes('settings conflict')
    || text.includes('conflict')
  ) {
    return 'refused'
  }
  if (
    text.includes('connection closed')
    || text.includes('transport closed')
    || text.includes('unexpected eof')
    || text.includes('mcp error -32')
  ) {
    return 'operation_error'
  }
  if (text.includes('network') || text.includes('fetch') || text.includes('http ') || text.includes('unable to access')) {
    return 'network'
  }
  return 'unknown'
}

/**
 * Map structured Host/installer signals and raw error text to a closed,
 * privacy-safe error enum. Shared by the browser client and Host telemetry
 * reporter without pulling Node built-ins or schema validators into the client bundle.
 */
export function classifyInstallError(raw: string, hints?: InstallErrorHints): TelemetryErrorCode {
  const text = raw.toLowerCase()
  if (hints?.timedOut === true || hints?.packageKind === 'timeout') return 'timeout'
  if (hints?.unmet === 'not-bundle') return 'not_bundle'
  if (hints?.unmet === 'unexpected-package') return 'invalid_spec'

  const fromManagement = hints?.errorCode !== undefined ? MANAGEMENT_ERROR_CODE_MAP[hints.errorCode] : undefined
  if (fromManagement !== undefined) return fromManagement

  const fromInspect = hints?.inspectProblem !== undefined ? INSPECT_PROBLEM_MAP[hints.inspectProblem] : undefined
  if (fromInspect !== undefined) return fromInspect

  const fromPackageKind = hints?.packageKind !== undefined && hints.packageKind !== 'unknown'
    ? PACKAGE_KIND_MAP[hints.packageKind]
    : undefined
  if (fromPackageKind !== undefined) return fromPackageKind

  if (hints?.skillErrorCode !== undefined) {
    if (hints.skillErrorCode === 'cancelled') return 'cancelled'
    if (hints.skillErrorCode === 'already-exists') return 'already_installed'
    if (hints.skillErrorCode === 'not-found') return 'not_found'
    if (hints.skillErrorCode === 'invalid-skill' || hints.skillErrorCode === 'invalid-project-dir') {
      return 'invalid_spec'
    }
    if (hints.skillErrorCode === 'download-failed') {
      if (text.includes('cancel') || text.includes('abort')) return 'cancelled'
      if (isTimeoutText(text)) return 'timeout'
      if (isTlsText(text)) return 'tls_error'
      if (
        text.includes('did not contain a root skill.md')
        || text.includes('did not contain skill.md')
        || text.includes('unsafe skill subpath')
        || /exceed(?:s|ed)?\b.*\b(?:bytes|size)\s+limit\b/.test(text)
      ) {
        return 'invalid_spec'
      }
      if (isIntegrityText(text)) return 'integrity'
      if (
        /(?:http|status(?:\s+code)?)\s*429\b/.test(text)
        || text.includes('too many requests')
        || text.includes('rate limit')
      ) {
        return 'rate_limited'
      }
      if (text.includes('http 401') || text.includes('http 403')) return 'auth_failed'
      if (text.includes('http 404') || text.includes('not found')) return 'not_found'
      return 'network'
    }
    if (hints.skillErrorCode === 'write-failed') {
      if (text.includes('eacces') || text.includes('eperm') || text.includes('erofs') || text.includes('permission')) return 'permission'
      if (text.includes('enospc') || text.includes('no space')) return 'disk_full'
      if (/\b(?:ebusy|elocked|enotempty|enametoolong|exdev)\b/.test(text)) return 'fs_locked'
      return 'write_failed'
    }
  }

  const fromText = classifyTextFallback(text)
  if (fromText !== 'unknown') return fromText

  if (hints?.mcpReason === 'startup-timeout' || hints?.mcpReason === 'reconnecting-timeout') return 'timeout'
  if (hints?.mcpReason === 'disabled') return 'cancelled'
  if (
    hints?.mcpReason === 'gave-up'
    || hints?.mcpReason === 'load'
    || hints?.mcpReason === 'cleanup'
    || hints?.mcpReason === 'reconnect-disabled'
    || hints?.mcpReason === 'unclosed-generation'
  ) {
    return 'operation_error'
  }

  if (hints?.errorCode === 'operation-error' || text.includes('operation-error')) return 'operation_error'
  if (hints?.failedAt === 'registry' || hints?.failedAt === 'spec-host') return 'network'
  return 'unknown'
}

type TelemetryStage = 'inspect' | 'connect' | 'install' | 'enable' | 'unknown'

function resolveTelemetryStage(hints?: InstallErrorHints): TelemetryStage {
  const rawStage = hints?.stage?.trim().toLowerCase()
  if (rawStage === 'inspect' || rawStage === 'connect' || rawStage === 'install' || rawStage === 'enable') {
    return rawStage
  }
  if (hints?.inspectProblem !== undefined) return 'inspect'
  if (hints?.failedAt === 'spec-host' || hints?.mcpReason !== undefined) return 'connect'
  if (hints?.packageKind !== undefined || hints?.unmet !== undefined || hints?.timedOut !== undefined) return 'install'
  return 'unknown'
}

function sanitizeMachineToken(value: string, maxLen = 40): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, maxLen)
}

const TLS_CERT_CODE_PATTERN = /\b(SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|CERT_HAS_EXPIRED|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_GET_ISSUER_CERT_LOCALLY)\b/i
const ERRNO_PATTERN = /\b(ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|EPROTO|EPIPE|ENOSPC|EACCES|EPERM|EBUSY|ELOCKED|ENOTEMPTY|ENAMETOOLONG|ENOENT|EXDEV|EROFS|EISDIR|ENOTDIR|EMFILE|ENFILE|EEXIST|EBADPLATFORM|EINTEGRITY|E404|ETARGET)\b/i

function extractMachineCode(raw: string, hints?: InstallErrorHints): string {
  const pnpmCode = /\b(ERR_PNPM_[A-Z0-9_]{2,39})\b/i.exec(raw)
  if (pnpmCode !== null) return pnpmCode[1]!.toUpperCase()

  const undiciCode = /\b(UND_ERR_[A-Z0-9_]{2,32})\b/i.exec(raw)
  if (undiciCode !== null) return undiciCode[1]!.toUpperCase()

  const tlsRuntimeCode = /\b(ERR_(?:TLS|SSL)_[A-Z0-9_]{2,32})\b/i.exec(raw)
  if (tlsRuntimeCode !== null) return tlsRuntimeCode[1]!.toUpperCase()

  const tlsCertCode = TLS_CERT_CODE_PATTERN.exec(raw)
  if (tlsCertCode !== null) return tlsCertCode[1]!.toUpperCase()

  const zlibCode = /\b(Z_(?:DATA|BUF|STREAM|MEM|VERSION)_ERROR)\b/i.exec(raw)
  if (zlibCode !== null) return zlibCode[1]!.toUpperCase()

  const lower = raw.toLowerCase()
  if (lower.includes('unreadable pnpm view output')) return 'UNREADABLE_JSON'
  if (lower.includes('pnpm view answered no package')) return 'EMPTY_VIEW'
  if (lower.includes('spawn git enoent') || lower.includes('git is not recognized')) return 'GIT_ENOENT'
  if (lower.includes('spawn pnpm enoent')) return 'PNPM_ENOENT'

  const launcherMatch = KNOWN_LAUNCHER_CAPTURE_ENOENT.exec(raw)
  if (launcherMatch !== null) {
    const bin = launcherMatch[1] ?? launcherMatch[2] ?? launcherMatch[3]
    if (bin) return `SPAWN_${bin.toUpperCase()}_ENOENT`
  }

  if (lower.includes('gyp err!') || lower.includes('node-gyp')) return 'NODE_GYP'
  if (lower.includes('unavailable in this host')) return 'HOST_UNAVAILABLE'

  if (lower.includes('did not contain a root skill.md') || lower.includes('did not contain skill.md')) {
    return 'SKILL_NO_SKILL_MD'
  }
  if ((hints?.skillErrorCode !== undefined || lower.includes('skill')) && /(?:^|[^a-z])files?\s+limit\b/i.test(raw)) {
    return 'SKILL_FILE_LIMIT'
  }
  if (
    (hints?.skillErrorCode !== undefined || lower.includes('skill') || lower.includes('downloaded file'))
    && /exceed(?:s|ed)?\b.*\b(?:bytes|size)\s+limit\b/i.test(raw)
  ) {
    return 'SKILL_SIZE_LIMIT'
  }
  if (
    lower.includes('invalid tar entry size')
    || lower.includes('tar longname')
    || lower.includes('tar pax')
    || lower.includes('incorrect header check')
  ) {
    return 'TAR_CORRUPT'
  }
  if (lower.includes('invalid jsdelivr manifest')) return 'JSDELIVR_BAD_MANIFEST'

  const mcpRpcMatch = /\bmcp error (-32\d{3})\b/i.exec(raw)
  if (mcpRpcMatch !== null) return `MCP_ERR_${mcpRpcMatch[1]!.replace('-', '')}`
  if (lower.includes('connection closed') || lower.includes('transport closed') || lower.includes('unexpected eof')) {
    return 'MCP_CONNECTION_CLOSED'
  }
  if (lower.includes('settings-readonly')) return 'SETTINGS_READONLY'
  if (lower.includes('settings-unavailable')) return 'SETTINGS_UNAVAILABLE'
  if (lower.includes('settings-conflict') || lower.includes('settings conflict')) return 'SETTINGS_CONFLICT'
  if (lower.includes('namespace-missing')) return 'NAMESPACE_MISSING'
  if (lower.includes('manager-unavailable')) return 'MANAGER_UNAVAILABLE'
  if (lower.includes('credentials-unavailable')) return 'CREDENTIALS_UNAVAILABLE'
  if (lower.includes('name-taken')) return 'NAME_TAKEN'

  const errno = ERRNO_PATTERN.exec(raw)
  if (errno !== null) return errno[1]!.toUpperCase()

  const httpStatus = /(?:http|status(?:\s+code)?|returned error:)\s*([45]\d\d)\b/i.exec(raw)
  if (httpStatus !== null) return `HTTP_${httpStatus[1]!}`

  if (lower.includes('download timed out') || lower.includes('mcp startup timed out') || lower.includes('request timed out')) {
    return 'TIMED_OUT'
  }

  if (hints?.unmet) {
    const token = sanitizeMachineToken(hints.unmet, 32)
    if (token !== '') return `UNMET_${token}`
  }
  if (hints?.packageKind && hints.packageKind !== 'unknown') {
    const token = sanitizeMachineToken(hints.packageKind, 32)
    if (token !== '') return `PKG_${token}`
  }
  if (hints?.timedOut === true) return 'TIMED_OUT'
  if (hints?.failedAt) {
    const token = sanitizeMachineToken(hints.failedAt, 24)
    if (token !== '') return `FAILED_AT_${token}`
  }
  if (hints?.inspectProblem && hints.inspectProblem !== 'unknown') {
    const token = sanitizeMachineToken(hints.inspectProblem, 32)
    if (token !== '') return `INSPECT_${token}`
  }
  if (hints?.errorCode && hints.errorCode !== 'operation-error') {
    const token = sanitizeMachineToken(hints.errorCode, 32)
    if (token !== '') return `HOST_${token}`
  }
  if (hints?.skillErrorCode) {
    const token = sanitizeMachineToken(hints.skillErrorCode, 32)
    if (token !== '') return `SKILL_${token}`
  }
  if (typeof hints?.exitCode === 'number' && Number.isInteger(hints.exitCode) && hints.exitCode > 0 && hints.exitCode <= 255) {
    return `${hints.specKind === 'git' ? 'GIT_' : ''}EXIT_${String(hints.exitCode)}`
  }
  const exitMatch = /\bexited(?:\s+with)?\s+(?:code\s+)?(\d{1,3})\b/i.exec(raw)
  if (exitMatch !== null) {
    const code = Number(exitMatch[1])
    if (Number.isInteger(code) && code > 0 && code <= 255) return `EXIT_${String(code)}`
  }
  if (hints?.mcpReason) {
    const token = sanitizeMachineToken(hints.mcpReason, 32)
    if (token !== '') return `MCP_${token}`
  }
  if (hints?.errorCode === 'operation-error') return 'HOST_OPERATION_ERROR'
  if (hints?.inspectProblem === 'unknown') return 'INSPECT_UNKNOWN'
  return ''
}

/**
 * Extract a strictly whitelisted `<stage>:<machineCode>` diagnostic fingerprint
 * without ever including paths, package names, URLs, tokens, or free-form messages.
 */
export function extractInstallErrorDetail(raw: string, hints?: InstallErrorHints): string | undefined {
  const stage = resolveTelemetryStage(hints)
  const code = extractMachineCode(raw, hints)
  const resolvedCode = code !== '' ? code : stage !== 'unknown' ? 'UNCLASSIFIED' : ''
  if (resolvedCode === '') return undefined
  const detail = `${stage}:${resolvedCode}`
  return TELEMETRY_ERROR_DETAIL_PATTERN.test(detail) ? detail : undefined
}
