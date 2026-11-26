import type { TelemetryErrorCode } from './contract.ts'

export interface InstallErrorHints {
  readonly inspectProblem?: string
  readonly errorCode?: string
  readonly packageKind?: string
  readonly timedOut?: boolean
  readonly skillErrorCode?: string
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

function classifyTextFallback(text: string): TelemetryErrorCode {
  if (text.includes('timeout') || text.includes('timed out') || text.includes('etimedout')) return 'timeout'
  if (
    text.includes('econn')
    || text.includes('enotfound')
    || text.includes('eai_again')
    || text.includes('enetunreach')
    || text.includes('ehostunreach')
    || text.includes('socket hang up')
  ) {
    return 'network'
  }
  if (text.includes('cancel') || text.includes('abort')) return 'cancelled'
  if (
    text.includes('incompat')
    || text.includes('engines.dsh')
    || text.includes('unsupported engine')
    || text.includes('peer')
  ) {
    return 'compat'
  }
  if (text.includes('unsupported-platform') || text.includes('ebadplatform')) return 'unsupported_platform'
  if (text.includes('not-a-bundle') || text.includes('not-bundle') || text.includes('not-a-package')) {
    return 'not_bundle'
  }
  if (text.includes('already-installed') || text.includes('already-exists')) return 'already_installed'
  if (text.includes('pnpm-missing') || text.includes('spawn pnpm enoent')) return 'pnpm_missing'
  if (
    text.includes('build-blocked')
    || text.includes('stale-approval')
    || text.includes('ignored build scripts')
  ) {
    return 'build_blocked'
  }
  if (text.includes('enospc') || text.includes('disk-full') || text.includes('no space left')) return 'disk_full'
  if (
    text.includes('eacces')
    || text.includes('eperm')
    || text.includes('management-required')
    || text.includes('unaddressable')
    || text.includes('permission denied')
  ) {
    return 'permission'
  }
  if (
    text.includes('err_pnpm_no_matching_version')
    || text.includes('err_pnpm_fetch_404')
    || text.includes('no-matching-version')
    || text.includes('not-found')
    || text.includes('http 404')
    || text.includes('e404')
  ) {
    return 'not_found'
  }
  if (
    text.includes('integrity')
    || text.includes('err_pnpm_tarball_integrity')
    || text.includes('shasum')
  ) {
    return 'integrity'
  }
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
    || text.includes('conflict')
  ) {
    return 'refused'
  }
  if (text.includes('network') || text.includes('fetch') || text.includes('http ')) return 'network'
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
      if (text.includes('timeout') || text.includes('timed out') || text.includes('etimedout')) return 'timeout'
      if (text.includes('cancel') || text.includes('abort')) return 'cancelled'
      if (text.includes('http 404') || text.includes('not found')) return 'not_found'
      return 'network'
    }
    if (hints.skillErrorCode === 'write-failed') {
      if (text.includes('eacces') || text.includes('eperm') || text.includes('permission')) return 'permission'
      if (text.includes('enospc') || text.includes('no space')) return 'disk_full'
      return 'write_failed'
    }
  }

  const fromText = classifyTextFallback(text)
  if (fromText !== 'unknown') return fromText

  if (hints?.errorCode === 'operation-error' || text.includes('operation-error')) return 'operation_error'
  return 'unknown'
}
