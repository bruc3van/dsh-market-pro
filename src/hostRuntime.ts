/**
 * Host-only runtime version inspection.
 *
 * Kept separate from browser-shared compatibility code because reading host
 * package manifests uses Node's `createRequire`.
 */
import { createRequire } from 'node:module'
import { DSH_VERSION_MAX_LENGTH } from './contract.ts'

/** Best-effort read of the running DSH host package version. */
export function detectDshVersion(): string {
  const req = createRequire(import.meta.url)
  const candidates = [
    '@deepseek-ai/dsh-app-boot/package.json',
    '@deepseek-ai/dsh-plugin-manager/package.json',
    '@deepseek-ai/dsh-settings/package.json',
    '@deepseek-ai/dsh-typert-protocol/package.json',
  ]
  for (const specifier of candidates) {
    try {
      const pkg = req(specifier) as { version?: unknown }
      if (typeof pkg.version === 'string' && pkg.version.trim() !== '') {
        return pkg.version.trim().slice(0, DSH_VERSION_MAX_LENGTH)
      }
    } catch {
      /* Try next host package. */
    }
  }
  return 'unknown'
}
