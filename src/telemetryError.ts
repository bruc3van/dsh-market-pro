import type { TelemetryErrorCode } from './contract.ts'

/**
 * Map raw installation error text to a closed, privacy-safe error enum.
 * Shared by the browser client and Host telemetry reporter without pulling
 * Node built-ins or schema validators into the client bundle.
 */
export function classifyInstallError(raw: string): TelemetryErrorCode {
  const text = raw.toLowerCase()
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
