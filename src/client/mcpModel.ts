/**
 * The MCP page's pure rules: how the three official reads — the manager's
 * `watch` stream, the manager's Settings namespace, and the credential
 * descriptions — fold into one card per server, and how an editor draft turns
 * back into a path-addressed Settings write.
 *
 * Kept free of React and of any Remote so `node --test` can pin them; the
 * controller in ./mcpController.ts owns the I/O.
 * @module dsh-market-pro/client/mcpModel
 */
import {
  SERVER_NAME_PATTERN, credentialRefsIn, credentialTemplate, isMcpStarting, isSecretField, isSecretUrl,
  malformedTemplate, maskArg, maskUrl, secretArgIndexes, suggestRef,
} from '../mcpShapes.ts'
import { normalizeMcpDescription } from './mcpDescriptions.ts'

export { credentialTemplate, suggestRef }

/** One server's runtime status, as `mcpManager.watch` reports it. */
export type McpStatus =
  | { readonly state: 'closed'; readonly result: { readonly closeConfirmed: boolean; readonly cleanupError?: string } }
  | { readonly state: 'waiting-credentials'; readonly lastError: string }
  | { readonly state: 'waiting-authorization'; readonly reason: string; readonly lastError: string }
  | { readonly state: 'connecting'; readonly attempt: number }
  | { readonly state: 'connected'; readonly toolCount: number; readonly connectedAt: number }
  | {
    readonly state: 'reconnecting'; readonly attempt: number; readonly maxAttempts: number
    readonly nextRetryAtMs: number; readonly lastError: string
  }
  | { readonly state: 'failed'; readonly reason: 'gave-up' | 'reconnect-disabled' | 'unclosed-generation'; readonly lastError?: string }
  | { readonly state: 'disabled' }
  | { readonly state: 'failed'; readonly reason: 'load'; readonly lastError: string }
  | { readonly state: 'failed'; readonly reason: 'cleanup'; readonly result: { readonly closeConfirmed: boolean; readonly cleanupError?: string } }

/** One row of the manager's list. */
export interface McpServerView {
  readonly name: string
  readonly configured: boolean
  readonly status: McpStatus
}

/** One `servers.<name>` entry as Settings returns it (defaults resolved in `value`). */
export interface McpEntry {
  readonly transport?: string
  readonly command?: string
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly cwd?: string
  readonly url?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly enabled?: boolean
  readonly startupTimeoutMs?: number
  readonly toolCallTimeoutMs?: number
  readonly closeTimeoutMs?: number
  readonly reconnect?: Readonly<Record<string, unknown>>
}

/** One Settings namespace view (the subset this page reads). */
export interface McpSettingsView {
  readonly ns: string
  readonly value: unknown
  readonly base?: unknown
  readonly user?: unknown
  readonly revision: number
}

/** One path-addressed Settings edit. */
export type McpSettingsOp =
  | { readonly op: 'set'; readonly path: readonly string[]; readonly value: unknown }
  | { readonly op: 'unset'; readonly path: readonly string[] }

/** One credential reference's described state. */
export interface McpCredentialInfo {
  readonly configured: boolean
  readonly source?: string
  readonly writable: boolean
  readonly masked?: string
}

/**
 * Where a server comes from, which decides what the page may do with it.
 * - `user`: added in this profile's Settings layer — editable and removable.
 * - `inherited`: from the composition base — editable as an override, never removable.
 * - `overridden`: inherited, with a user-layer override — "restore default" drops it.
 * - `registered`: an installed plugin registered it — read-only, lives with the plugin.
 * - `retained`: removed, but its cleanup failed — only a Host restart clears it.
 */
export type McpSource = 'user' | 'inherited' | 'overridden' | 'registered' | 'retained'

/** One card's facts. */
export interface McpRow {
  readonly name: string
  readonly source: McpSource
  /** Resolved entry; absent for registered and retained rows (Settings does not carry them). */
  readonly entry?: McpEntry
  readonly status?: McpStatus
  /** Config paths holding a secret in the clear. */
  readonly plaintext: readonly string[]
  /** Credential references the entry names. */
  readonly refs: readonly string[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** The `servers` map of one Settings layer, or `{}`. */
export function serversOf(layer: unknown): Record<string, McpEntry> {
  if (!isRecord(layer) || !isRecord(layer.servers)) return {}
  return Object.fromEntries(Object.entries(layer.servers).filter(([, entry]) => isRecord(entry))) as Record<string, McpEntry>
}

/** Every string of an entry that may carry a template or a secret, with its config path. */
export function entryStrings(entry: McpEntry): [string, string][] {
  return [
    [entry.command ?? '', 'command'],
    ...(entry.args ?? []).map((arg, index): [string, string] => [arg, `args[${index}]`]),
    ...Object.entries(entry.env ?? {}).map(([key, value]): [string, string] => [value, `env.${key}`]),
    [entry.cwd ?? '', 'cwd'],
    [entry.url ?? '', 'url'],
    ...Object.entries(entry.headers ?? {}).map(([key, value]): [string, string] => [value, `headers.${key}`]),
  ]
}

/** The credential references an entry names, deduplicated in order. */
export function entryRefs(entry: McpEntry): string[] {
  return [...new Set(entryStrings(entry).flatMap(([value]) => credentialRefsIn(value)))]
}

/** Config paths of an entry that hold a secret in the clear. */
export function plaintextSecrets(entry: McpEntry): string[] {
  return [
    ...secretArgIndexes(entry.args ?? []).map(index => `args[${index}]`),
    ...Object.entries(entry.env ?? {}).filter(([key, value]) => isSecretField(key, value)).map(([key]) => `env.${key}`),
    ...(isSecretUrl(entry.url ?? '') ? ['url'] : []),
    ...Object.entries(entry.headers ?? {}).filter(([key, value]) => isSecretField(key, value)).map(([key]) => `headers.${key}`),
  ]
}

/**
 * Fold the manager list and the Settings namespace into cards: configured
 * entries in document order, then plugin registrations, then retained
 * cleanup failures.
 */
export function buildRows(views: readonly McpServerView[] | null, settings: McpSettingsView | null): McpRow[] {
  const value = serversOf(settings?.value)
  const base = serversOf(settings?.base)
  const user = serversOf(settings?.user)
  const statusOf = new Map((views ?? []).map(view => [view.name, view]))
  const rows: McpRow[] = Object.entries(value).map(([name, entry]): McpRow => ({
    name,
    source: Object.hasOwn(base, name) ? (Object.hasOwn(user, name) ? 'overridden' : 'inherited') : 'user',
    entry,
    status: statusOf.get(name)?.status,
    plaintext: plaintextSecrets(entry),
    refs: entryRefs(entry),
  }))
  for (const view of views ?? []) {
    if (Object.hasOwn(value, view.name)) continue
    rows.push({ name: view.name, source: view.configured ? 'registered' : 'retained', status: view.status, plaintext: [], refs: [] })
  }
  return rows
}

/** The coarse buckets the status filter and the colour use. */
export type McpStatusKind = 'connected' | 'pending' | 'issue' | 'disabled' | 'locked' | 'unknown'

/** Classify one status; `locked` is cleanup the Host can only clear by restarting. */
export function statusKind(status: McpStatus | undefined): McpStatusKind {
  if (status === undefined) return 'unknown'
  switch (status.state) {
    case 'connected': return 'connected'
    case 'connecting': return 'pending'
    case 'disabled': return 'disabled'
    case 'closed': return status.result.closeConfirmed && status.result.cleanupError === undefined ? 'disabled' : 'locked'
    case 'reconnecting':
    case 'waiting-authorization':
    case 'waiting-credentials': return 'issue'
    case 'failed': return status.reason === 'unclosed-generation' || status.reason === 'cleanup' ? 'locked' : 'issue'
  }
}

/** The status's diagnostic text, when it carries one. */
export function statusError(status: McpStatus | undefined): string {
  if (status === undefined) return ''
  if ('lastError' in status && typeof status.lastError === 'string') return status.lastError
  if ('result' in status) return status.result.cleanupError ?? ''
  return ''
}

/** Whether the manager's restart verb applies (a fresh reconnect budget). */
export function canRestart(row: McpRow): boolean {
  const kind = statusKind(row.status)
  return row.source !== 'retained' && row.status !== undefined && kind !== 'locked' && kind !== 'disabled'
}

/** Whether a one-off probe applies; a disabled entry may be probed before it is turned on. */
export function canProbe(row: McpRow): boolean {
  return row.source !== 'retained' && statusKind(row.status) !== 'locked' && !isMcpStarting(row.status?.state)
}

/** Whether Settings may edit this row at all. */
export function isConfigured(row: McpRow): boolean {
  return row.source === 'user' || row.source === 'inherited' || row.source === 'overridden'
}

/** Whether the entry is switched on in Settings. */
export function isEnabled(row: McpRow): boolean {
  return row.entry?.enabled !== false
}

/** The transport label a card shows. */
export function transportOf(entry: McpEntry | undefined): 'stdio' | 'streamable-http' | 'unknown' {
  return entry?.transport === 'stdio' || entry?.transport === 'streamable-http' ? entry.transport : 'unknown'
}

const NEEDS_QUOTES = /[\s"']/

/** Render one command line for display, secrets masked. */
export function commandLine(command: string, args: readonly string[]): string {
  const secret = new Set(secretArgIndexes(args))
  return [command, ...args.map((arg, index) => secret.has(index) ? maskArg(arg) : arg)]
    .filter(part => part !== '')
    .map(part => NEEDS_QUOTES.test(part) ? JSON.stringify(part) : part)
    .join(' ')
}

/** One-line target summary for a card: the masked command line or endpoint. */
export function targetOf(entry: McpEntry | undefined): string {
  if (entry === undefined) return ''
  return transportOf(entry) === 'stdio' ? commandLine(entry.command ?? '', entry.args ?? []) : maskUrl(entry.url ?? '')
}

/** Split a pasted command line into words, honouring single and double quotes. */
export function splitCommandLine(line: string): string[] {
  const words: string[] = []
  let current = ''
  let quote: string | null = null
  let started = false
  for (const char of line.trim()) {
    if (quote !== null) {
      if (char === quote) quote = null
      else current += char
    } else if (char === '"' || char === '\'') {
      quote = char
      started = true
    } else if (/\s/.test(char)) {
      if (started || current !== '') words.push(current)
      current = ''
      started = false
    } else {
      current += char
    }
  }
  if (started || current !== '') words.push(current)
  return words
}

/** Risk notes for a stdio command: dynamic package fetches and shell wrappers. */
export type McpCommandRisk = 'fetch' | 'shell'

/** Which risk notes a command earns. */
export function commandRisks(command: string, args: readonly string[]): McpCommandRisk[] {
  const all = [command, ...args]
  const words = all.map(word => word.replace(/^.*[\\/]/, '').replace(/\.(?:exe|cmd|bat)$/i, '').toLowerCase())
  const risks: McpCommandRisk[] = []
  if (words.some(word => ['npx', 'bunx', 'uvx', 'pipx'].includes(word))
    || (words.includes('pnpm') && words.includes('dlx'))) risks.push('fetch')
  const shell = words.findIndex(word => ['cmd', 'sh', 'bash', 'zsh', 'powershell', 'pwsh'].includes(word))
  if (shell >= 0 && all.slice(shell + 1).some(arg => /^(?:\/c|\/k|-c|-command|-encodedcommand)$/i.test(arg))) risks.push('shell')
  return risks
}

/** One key/value row of the editor (env or headers). */
export interface McpPair {
  readonly key: string
  readonly value: string
}

/** A credential the editor will store before it writes the entry. */
export interface McpPendingSecret {
  readonly ref: string
  readonly value: string
}

/** The editor's working copy of one entry. */
export interface McpDraft {
  readonly name: string
  /** Optional local-only description note persisted by `dsh-market-pro` (never written to `dsh-mcp-manager` Settings). */
  readonly description: string
  readonly transport: 'stdio' | 'streamable-http'
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: readonly McpPair[]
  readonly url: string
  readonly headers: readonly McpPair[]
  readonly enabled: boolean
  /** Text fields, so a half-typed number is not coerced away. */
  readonly startupTimeoutMs: string
  readonly toolCallTimeoutMs: string
  readonly closeTimeoutMs: string
  /** Reconnect policy; an empty number means the client's default. */
  readonly reconnectEnabled: boolean
  readonly initialDelayMs: string
  readonly maxDelayMs: string
  readonly maxAttempts: string
  /** Fields this editor does not render, carried through untouched. */
  readonly extra: Readonly<Record<string, unknown>>
  /** Plaintext values the user chose to move into the credential store. */
  readonly pending: readonly McpPendingSecret[]
}

/** Whether the working draft differs from its opened or last-reloaded baseline. */
export function isDraftDirty(draft: McpDraft, baseline: McpDraft): boolean {
  if (
    draft.name !== baseline.name
    || draft.description !== baseline.description
    || draft.transport !== baseline.transport
    || draft.command !== baseline.command
    || draft.cwd !== baseline.cwd
    || draft.url !== baseline.url
    || draft.enabled !== baseline.enabled
    || draft.startupTimeoutMs !== baseline.startupTimeoutMs
    || draft.toolCallTimeoutMs !== baseline.toolCallTimeoutMs
    || draft.closeTimeoutMs !== baseline.closeTimeoutMs
    || draft.reconnectEnabled !== baseline.reconnectEnabled
    || draft.initialDelayMs !== baseline.initialDelayMs
    || draft.maxDelayMs !== baseline.maxDelayMs
    || draft.maxAttempts !== baseline.maxAttempts
    || draft.args.length !== baseline.args.length
    || draft.env.length !== baseline.env.length
    || draft.headers.length !== baseline.headers.length
    || draft.pending.length !== baseline.pending.length
  ) return true
  if (draft.args.some((arg, i) => arg !== baseline.args[i])) return true
  if (draft.env.some((pair, i) => pair.key !== baseline.env[i]!.key || pair.value !== baseline.env[i]!.value)) return true
  if (draft.headers.some((pair, i) => pair.key !== baseline.headers[i]!.key || pair.value !== baseline.headers[i]!.value)) return true
  if (draft.pending.some((secret, i) => secret.ref !== baseline.pending[i]!.ref || secret.value !== baseline.pending[i]!.value)) return true
  return false
}

/** Whether a blank "Add MCP" draft has any user-entered content worth confirming on close. */
export function hasDraftContent(draft: McpDraft): boolean {
  return draft.name.trim() !== ''
    || draft.description.trim() !== ''
    || draft.command.trim() !== ''
    || draft.args.some(arg => arg.trim() !== '')
    || draft.cwd.trim() !== ''
    || draft.url.trim() !== ''
    || draft.env.some(pair => pair.key.trim() !== '' || pair.value.trim() !== '')
    || draft.headers.some(pair => pair.key.trim() !== '' || pair.value.trim() !== '')
    || !draft.enabled
    || draft.startupTimeoutMs.trim() !== ''
    || draft.toolCallTimeoutMs.trim() !== ''
    || draft.closeTimeoutMs.trim() !== ''
    || !draft.reconnectEnabled
    || draft.initialDelayMs.trim() !== ''
    || draft.maxDelayMs.trim() !== ''
    || draft.maxAttempts.trim() !== ''
    || draft.pending.length > 0
}

/** A fresh draft. New servers start enabled so saving connects them right away. */
export function emptyDraft(): McpDraft {
  return {
    name: '', description: '', transport: 'stdio', command: '', args: [], cwd: '', env: [], url: '', headers: [],
    enabled: true, startupTimeoutMs: '', toolCallTimeoutMs: '', closeTimeoutMs: '',
    reconnectEnabled: true, initialDelayMs: '', maxDelayMs: '', maxAttempts: '', extra: {}, pending: [],
  }
}

/** The manager's schema default for `startupTimeoutMs`; a resolved value equal to it is not an edit. */
const DEFAULT_STARTUP_MS = 30_000
/** `dsh-mcp-client`'s close-timeout default. */
export const DEFAULT_CLOSE_MS = 5_000

/** `dsh-mcp-client`'s reconnect defaults; Settings resolves them into every entry. */
export const RECONNECT_DEFAULTS = { initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 } as const

/** A resolved number as editor text: empty when unset or equal to its default. */
const numberText = (value: unknown, fallback?: number): string =>
  typeof value === 'number' && value !== fallback ? String(value) : ''

function draftTiming(entry: McpEntry) {
  const reconnect = entry.reconnect ?? {}
  return {
    startupTimeoutMs: entry.startupTimeoutMs === undefined || entry.startupTimeoutMs === DEFAULT_STARTUP_MS
      ? '' : String(entry.startupTimeoutMs),
    toolCallTimeoutMs: entry.toolCallTimeoutMs === undefined ? '' : String(entry.toolCallTimeoutMs),
    closeTimeoutMs: numberText(entry.closeTimeoutMs, DEFAULT_CLOSE_MS),
    reconnectEnabled: reconnect.enabled !== false,
    initialDelayMs: numberText(reconnect.initialDelayMs, RECONNECT_DEFAULTS.initialDelayMs),
    maxDelayMs: numberText(reconnect.maxDelayMs, RECONNECT_DEFAULTS.maxDelayMs),
    maxAttempts: numberText(reconnect.maxAttempts, RECONNECT_DEFAULTS.maxAttempts),
  }
}

/** A draft over an existing entry. */
export function draftFromEntry(name: string, entry: McpEntry, description = ''): McpDraft {
  const extra: Record<string, unknown> = {}
  const reconnect = entry.reconnect ?? {}
  const unknownReconnect = Object.fromEntries(Object.entries(reconnect)
    .filter(([key]) => key !== 'enabled' && !Object.hasOwn(RECONNECT_DEFAULTS, key)))
  if (Object.keys(unknownReconnect).length > 0) extra.reconnect = unknownReconnect
  return {
    name,
    description,
    transport: transportOf(entry) === 'streamable-http' ? 'streamable-http' : 'stdio',
    command: entry.command ?? '',
    args: [...(entry.args ?? [])],
    cwd: entry.cwd ?? '',
    env: Object.entries(entry.env ?? {}).map(([key, value]) => ({ key, value })),
    url: entry.url ?? '',
    headers: Object.entries(entry.headers ?? {}).map(([key, value]) => ({ key, value })),
    enabled: entry.enabled !== false,
    ...draftTiming(entry),
    extra,
    pending: [],
  }
}

/** Every string of a draft that its transport writes, with its config path. */
function draftStrings(draft: McpDraft): [string, string][] {
  return draft.transport === 'stdio'
    ? [
        [draft.command, 'command'],
        ...draft.args.map((arg, index): [string, string] => [arg, `args[${index}]`]),
        ...draft.env.map((pair): [string, string] => [pair.value, `env.${pair.key}`]),
        [draft.cwd, 'cwd'],
      ]
    : [[draft.url, 'url'], ...draft.headers.map((pair): [string, string] => [pair.value, `headers.${pair.key}`])]
}

/** What a field-level validation failure names. */
export type McpDraftError =
  | { readonly field: 'name'; readonly code: 'required' | 'pattern' | 'taken' }
  | { readonly field: 'command'; readonly code: 'required' }
  | { readonly field: 'url'; readonly code: 'required' | 'scheme' }
  | { readonly field: 'env' | 'headers'; readonly code: 'key' | 'duplicate' }
  | { readonly field: 'template'; readonly code: 'malformed'; readonly where: string }
  | { readonly field: McpNumberField; readonly code: 'number' }
  | { readonly field: 'maxDelayMs'; readonly code: 'order' }

/** The editor's numeric fields, all positive integers. */
export type McpNumberField = 'startupTimeoutMs' | 'toolCallTimeoutMs' | 'closeTimeoutMs' | 'initialDelayMs' | 'maxDelayMs' | 'maxAttempts'
const NUMBER_FIELDS: readonly McpNumberField[] = ['startupTimeoutMs', 'toolCallTimeoutMs', 'closeTimeoutMs', 'initialDelayMs', 'maxDelayMs', 'maxAttempts']
const RECONNECT_NUMBER_FIELDS: ReadonlySet<McpNumberField> = new Set(['initialDelayMs', 'maxDelayMs', 'maxAttempts'])

const MAX_TIMER = 2_147_483_647

function isTimingNumber(value: unknown, max = MAX_TIMER): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max
}

export function hasCustomMcpTiming(timing: Pick<McpDraft, McpNumberField | 'reconnectEnabled'>): boolean {
  return !timing.reconnectEnabled || NUMBER_FIELDS.some(field => timing[field] !== '')
}

/**
 * The same rules the manager enforces at write time, checked before the
 * round trip so the form can point at the field rather than a Host message.
 * @param taken - every name already in use (managed, registered or static), minus the one being edited.
 */
export function validateDraft(draft: McpDraft, taken: ReadonlySet<string>): McpDraftError[] {
  const errors: McpDraftError[] = []
  const name = draft.name.trim()
  if (name === '') errors.push({ field: 'name', code: 'required' })
  else if (!SERVER_NAME_PATTERN.test(name)) errors.push({ field: 'name', code: 'pattern' })
  else if (taken.has(name)) errors.push({ field: 'name', code: 'taken' })
  if (draft.transport === 'stdio') {
    if (draft.command.trim() === '') errors.push({ field: 'command', code: 'required' })
  } else if (draft.url.trim() === '') {
    errors.push({ field: 'url', code: 'required' })
  } else if (!/^https?:\/\//i.test(draft.url.trim()) && credentialRefsIn(draft.url).length === 0) {
    errors.push({ field: 'url', code: 'scheme' })
  }
  const field = draft.transport === 'stdio' ? 'env' : 'headers'
  const keys = draft[field].map(pair => pair.key.trim())
  if (keys.some(key => key === '')) errors.push({ field, code: 'key' })
  else if (new Set(keys).size !== keys.length) errors.push({ field, code: 'duplicate' })
  for (const [value, where] of draftStrings(draft)) {
    if (malformedTemplate(value) !== undefined) errors.push({ field: 'template', code: 'malformed', where })
  }
  const bad = new Set<McpNumberField>()
  for (const field of NUMBER_FIELDS) {
    if (!draft.reconnectEnabled && RECONNECT_NUMBER_FIELDS.has(field)) continue
    const text = draft[field].trim()
    if (text === '') continue
    const value = Number(text)
    const max = field === 'maxAttempts' ? Number.MAX_SAFE_INTEGER : MAX_TIMER
    if (!isTimingNumber(value, max)) {
      errors.push({ field, code: 'number' })
      bad.add(field)
    }
  }
  if (draft.reconnectEnabled && !bad.has('initialDelayMs') && !bad.has('maxDelayMs')) {
    const initial = draft.initialDelayMs.trim() === '' ? RECONNECT_DEFAULTS.initialDelayMs : Number(draft.initialDelayMs)
    const ceiling = draft.maxDelayMs.trim() === '' ? RECONNECT_DEFAULTS.maxDelayMs : Number(draft.maxDelayMs)
    if (initial > ceiling) errors.push({ field: 'maxDelayMs', code: 'order' })
  }
  return errors
}

/** The entry a draft writes: only the fields its transport uses, plus carried extras. */
export function entryFromDraft(draft: McpDraft): Record<string, unknown> {
  const entry: Record<string, unknown> = { transport: draft.transport }
  if (draft.transport === 'stdio') {
    entry.command = draft.command.trim()
    if (draft.args.length > 0) entry.args = [...draft.args]
    if (draft.env.length > 0) entry.env = Object.fromEntries(draft.env.map(pair => [pair.key.trim(), pair.value]))
    if (draft.cwd.trim() !== '') entry.cwd = draft.cwd.trim()
  } else {
    entry.url = draft.url.trim()
    if (draft.headers.length > 0) entry.headers = Object.fromEntries(draft.headers.map(pair => [pair.key.trim(), pair.value]))
  }
  entry.enabled = draft.enabled
  if (draft.startupTimeoutMs.trim() !== '') entry.startupTimeoutMs = Number(draft.startupTimeoutMs)
  if (draft.toolCallTimeoutMs.trim() !== '') entry.toolCallTimeoutMs = Number(draft.toolCallTimeoutMs)
  if (draft.closeTimeoutMs.trim() !== '') entry.closeTimeoutMs = Number(draft.closeTimeoutMs)
  const reconnect: Record<string, unknown> = { ...(draft.extra.reconnect as Record<string, unknown> | undefined) }
  if (!draft.reconnectEnabled) reconnect.enabled = false
  // A disabled policy keeps its valid numbers: switching it back on restores them.
  for (const field of ['initialDelayMs', 'maxDelayMs', 'maxAttempts'] as const) {
    const text = draft[field].trim()
    if (text === '') continue
    const value = Number(text)
    const max = field === 'maxAttempts' ? Number.MAX_SAFE_INTEGER : MAX_TIMER
    if (isTimingNumber(value, max)) reconnect[field] = value
  }
  const { reconnect: _carried, ...extra } = draft.extra
  if (Object.keys(reconnect).length > 0) entry.reconnect = reconnect
  return { ...extra, ...entry }
}

/** The credentials a save must store first: pending ones whose template the draft still names. */
export function pendingToStore(draft: McpDraft): McpPendingSecret[] {
  const named = new Set(draftStrings(draft).flatMap(([value]) => credentialRefsIn(value)))
  const seen = new Set<string>()
  return draft.pending.filter((secret) => {
    if (!named.has(secret.ref) || seen.has(secret.ref)) return false
    seen.add(secret.ref)
    return true
  })
}

/**
 * The Settings edits one save performs. A rename of a user-layer entry drops
 * the old key in the same write, so the document never holds both.
 */
export function saveOps(draft: McpDraft, original: string | undefined): McpSettingsOp[] {
  const name = draft.name.trim()
  const ops: McpSettingsOp[] = []
  if (original !== undefined && original !== name) ops.push({ op: 'unset', path: ['servers', original] })
  ops.push({ op: 'set', path: ['servers', name], value: entryFromDraft(draft) })
  return ops
}

const URL_SECRET = /([?&][^=&#]*(?:key|token|secret|password|auth)[^=&#]*=)([^&#]+)/gi

/**
 * Move one plaintext value into the pending credential list and put its
 * template in its place. A `Bearer <token>` header keeps its scheme word.
 * @param where - `args[3]`, `env.NAME`, `headers.NAME` or `url`.
 */
export function convertToCredential(draft: McpDraft, where: string, ref: string): McpDraft {
  const template = credentialTemplate(ref)
  const argMatch = /^args\[(\d+)\]$/.exec(where)
  if (argMatch !== null) {
    const index = Number(argMatch[1])
    const arg = draft.args[index]
    if (arg === undefined) return draft
    const eq = arg.indexOf('=')
    const inline = arg.startsWith('-') && eq > 0
    const args = draft.args.map((item, at) => at === index ? (inline ? `${arg.slice(0, eq + 1)}${template}` : template) : item)
    return { ...draft, args, pending: [...draft.pending, { ref, value: inline ? arg.slice(eq + 1) : arg }] }
  }
  const pairMatch = /^(env|headers)\.(.+)$/.exec(where)
  if (pairMatch !== null) {
    const field = pairMatch[1] as 'env' | 'headers'
    const key = pairMatch[2]!
    const pair = draft[field].find(item => item.key === key)
    if (pair === undefined) return draft
    const scheme = /^(Bearer|Basic|token)\s+(.+)$/i.exec(pair.value)
    return {
      ...draft,
      [field]: draft[field].map(item => item.key === key ? { key, value: scheme !== null ? `${scheme[1]} ${template}` : template } : item),
      pending: [...draft.pending, { ref, value: scheme !== null ? scheme[2]! : pair.value }],
    }
  }
  if (where === 'url') {
    // The first plaintext secret parameter; one already templated is skipped.
    const match = [...draft.url.matchAll(URL_SECRET)].find(found => credentialRefsIn(found[2]!).length === 0)
    if (match === undefined) return draft
    const value = match[2]!
    const at = match.index! + match[1]!.length
    const url = `${draft.url.slice(0, at)}${template}${draft.url.slice(at + match[2]!.length)}`
    return { ...draft, url, pending: [...draft.pending, { ref, value }] }
  }
  return draft
}

/** The plaintext secrets a draft still carries, by config path. */
export function draftPlaintext(draft: McpDraft): string[] {
  return plaintextSecrets(draft.transport === 'stdio'
    ? { transport: 'stdio', args: draft.args, env: Object.fromEntries(draft.env.map(pair => [pair.key, pair.value])) }
    : { transport: 'streamable-http', url: draft.url, headers: Object.fromEntries(draft.headers.map(pair => [pair.key, pair.value])) })
}

/** A save may retain an existing plaintext value at the same path in the user document. */
export function newDraftPlaintext(draft: McpDraft, previous?: McpEntry): string[] {
  const next = entryFromDraft(draft) as McpEntry
  const detected = plaintextSecrets(next)
  if (previous === undefined || detected.length === 0) return detected
  const previouslyPlain = new Set(plaintextSecrets(previous))
  const oldValues = new Map(entryStrings(previous).map(([value, path]) => [path, value]))
  const newValues = new Map(entryStrings(next).map(([value, path]) => [path, value]))
  return detected.filter(path => !previouslyPlain.has(path) || oldValues.get(path) !== newValues.get(path))
}

/** Summary counts for the page header. */
export function summarize(rows: readonly McpRow[], unmanaged: number): { servers: number; connected: number; tools: number } {
  let connected = 0
  let tools = 0
  for (const row of rows) {
    if (row.status?.state === 'connected') {
      connected += 1
      tools += row.status.toolCount
    }
  }
  return { servers: rows.length + unmanaged, connected, tools }
}

/** One server definition parsed from a pasted MCP JSON snippet. */
export interface ParsedMcpSnippet {
  readonly rawName: string
  readonly name: string
  readonly description: string
  readonly transport: 'stdio' | 'streamable-http'
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: readonly McpPair[]
  readonly url: string
  readonly headers: readonly McpPair[]
  readonly enabled?: boolean
  readonly timing: ReturnType<typeof draftTiming>
  readonly ignored: readonly string[]
}

export type ParseMcpJsonResult =
  | { readonly ok: true; readonly entries: readonly ParsedMcpSnippet[]; readonly unsupported: readonly string[] }
  | { readonly ok: false; readonly code: 'unsupported-transport'; readonly unsupported: readonly string[] }
  | { readonly ok: false; readonly code: 'empty' | 'invalid-json' | 'no-server' }

/** Sanitize an arbitrary display name (e.g. `"IP location"`) into a valid MCP server id. */
export function sanitizeServerName(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return SERVER_NAME_PATTERN.test(cleaned) ? cleaned : ''
}

function pairsFromRecord(value: unknown): McpPair[] {
  if (!isRecord(value)) return []
  const pairs: McpPair[] = []
  for (const [key, raw] of Object.entries(value)) {
    const trimmed = key.trim()
    if (trimmed === '') continue
    if (typeof raw === 'string') pairs.push({ key: trimmed, value: raw })
    else if (typeof raw === 'number' || typeof raw === 'boolean') pairs.push({ key: trimmed, value: String(raw) })
  }
  return pairs
}

function parseServerObject(
  rawName: string,
  obj: Record<string, unknown>,
): ParsedMcpSnippet | 'unsupported-transport' | null {
  const url = typeof obj.url === 'string' && obj.url.trim() !== ''
    ? obj.url.trim()
    : typeof obj.serverUrl === 'string' ? obj.serverUrl.trim() : ''
  const command = typeof obj.command === 'string' ? obj.command.trim() : ''
  if (url === '' && command === '') return null

  const rawType = typeof obj.transport === 'string' && obj.transport.trim() !== '' ? obj.transport.trim().toLowerCase()
    : typeof obj.type === 'string' ? obj.type.trim().toLowerCase() : ''
  const explicitHttp = rawType === 'http' || rawType === 'streamablehttp' || rawType === 'streamable-http'
  if (rawType !== '' && rawType !== 'stdio' && !explicitHttp) return 'unsupported-transport'
  // Without an explicit HTTP type, a command wins over a companion docs URL.
  const useHttp = explicitHttp || (rawType === '' && command === '')
  if (useHttp ? url === '' : command === '') return null

  const ignored = new Set(Object.keys(obj))
  for (const field of ['name', 'type', 'transport']) ignored.delete(field)
  const advanced: Record<string, unknown> = {}
  for (const field of ['startupTimeoutMs', 'toolCallTimeoutMs', 'closeTimeoutMs'] as const) {
    const value = obj[field]
    if (isTimingNumber(value)) {
      advanced[field] = value
      ignored.delete(field)
    }
  }
  if (isRecord(obj.reconnect)) {
    ignored.delete('reconnect')
    const reconnect: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj.reconnect)) {
      if (key === 'enabled' ? typeof value === 'boolean'
        : Object.hasOwn(RECONNECT_DEFAULTS, key) && isTimingNumber(value, key === 'maxAttempts' ? Number.MAX_SAFE_INTEGER : MAX_TIMER)) {
        reconnect[key] = value
      } else {
        ignored.add(`reconnect.${key}`)
      }
    }
    advanced.reconnect = reconnect
  }
  if (typeof obj.enabled === 'boolean') ignored.delete('enabled')
  if (typeof obj.description === 'string') ignored.delete('description')
  const pairs = (field: 'env' | 'headers') => {
    const raw = obj[field]
    const parsed = pairsFromRecord(raw)
    if (isRecord(raw) && parsed.length === Object.keys(raw).length) ignored.delete(field)
    return parsed
  }
  const args = !useHttp && Array.isArray(obj.args) ? obj.args.filter((item): item is string => typeof item === 'string') : []
  const env = useHttp ? [] : pairs('env')
  const headers = useHttp ? pairs('headers') : []
  if (useHttp) {
    ignored.delete(typeof obj.url === 'string' && obj.url.trim() !== '' ? 'url' : 'serverUrl')
  } else {
    ignored.delete('command')
    if (Array.isArray(obj.args) && args.length === obj.args.length) ignored.delete('args')
    if (typeof obj.cwd === 'string') ignored.delete('cwd')
  }
  return {
    rawName,
    name: sanitizeServerName(rawName),
    description: typeof obj.description === 'string' ? normalizeMcpDescription(obj.description) : '',
    transport: useHttp ? 'streamable-http' : 'stdio',
    command: useHttp ? '' : command,
    args,
    cwd: !useHttp && typeof obj.cwd === 'string' ? obj.cwd.trim() : '',
    env,
    url: useHttp ? url : '',
    headers,
    ...(typeof obj.enabled === 'boolean' ? { enabled: obj.enabled } : {}),
    timing: draftTiming(advanced),
    ignored: [...ignored],
  }
}

/** Whether a configured or static MCP card matches the search query across visible text and tool names. */
export function matchesMcpSearch(
  texts: readonly string[],
  query: string,
  toolNames: readonly string[] = [],
): boolean {
  const needle = query.trim().toLocaleLowerCase()
  if (needle === '') return true
  const haystack = [...texts, ...toolNames].join(' ').toLocaleLowerCase()
  return needle.split(/\s+/).every(word => haystack.includes(word))
}

/**
 * Parse a pasted MCP JSON snippet (Claude Desktop / Cursor `mcpServers`,
 * DSH `servers`, keyed map `{ "name": { ... } }`, or a bare server object).
 * Tolerates surrounding Markdown code fences.
 */
export function parseMcpJsonSnippet(raw: string): ParseMcpJsonResult {
  const stripped = raw.trim().replace(/^```(?:json|jsonc)?\s*/i, '').replace(/\s*```$/, '').trim()
  if (stripped === '') return { ok: false, code: 'empty' }
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch {
    return { ok: false, code: 'invalid-json' }
  }
  if (!isRecord(parsed)) return { ok: false, code: 'no-server' }

  const entries: ParsedMcpSnippet[] = []
  const unsupported: string[] = []
  const addServer = (name: string, value: unknown): boolean => {
    if (!isRecord(value)) return false
    const server = parseServerObject(name, value)
    if (server === null) return false
    if (server === 'unsupported-transport') unsupported.push(name)
    else entries.push(server)
    return true
  }
  const container = isRecord(parsed.mcpServers) ? parsed.mcpServers : isRecord(parsed.servers) ? parsed.servers : null
  if (container !== null || !addServer(typeof parsed.name === 'string' ? parsed.name : '', parsed)) {
    for (const [name, value] of Object.entries(container ?? parsed)) addServer(name, value)
  }
  if (entries.length > 0) return { ok: true, entries, unsupported }
  return unsupported.length > 0 ? { ok: false, code: 'unsupported-transport', unsupported } : { ok: false, code: 'no-server' }
}
