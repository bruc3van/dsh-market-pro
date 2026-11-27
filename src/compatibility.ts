/**
 * Pure SemVer range evaluation and bidirectional DSH compatibility classification.
 *
 * Mirrors `@deepseek-ai/dsh-app-boot` (`semver.satisfies(..., { includePrerelease: true })`)
 * without external dependencies so both Host and browser Client share identical logic.
 */

export type CompatibilityDirection = 'host-too-old' | 'plugin-too-old' | 'mismatch'

export interface IncompatibleRequirementItem {
  readonly name: string
  readonly version: string
  readonly runtimeVersion?: string
  readonly requirements?: Readonly<Record<string, string>>
  readonly peers?: Readonly<Record<string, string>>
}

export interface DshCompatibilityIssue {
  readonly direction: CompatibilityDirection
  readonly runtimeVersion: string
  readonly requiredRange: string
  readonly requirements: Readonly<Record<string, string>>
}

export interface CompatFallbackInfo {
  readonly selectedVersion: string
  readonly latestVersion: string
  readonly latestEngine?: string
}

export interface SubscriptionVersionCandidate {
  readonly version: string
  readonly enginesDsh?: string
}

export interface SubscriptionVersionSelection<T extends SubscriptionVersionCandidate> {
  readonly selected: T
  readonly fallback?: CompatFallbackInfo
  readonly incompatible?: DshCompatibilityIssue
}

interface ParsedSemver {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: readonly (number | string)[]
}

interface Comparator {
  readonly op: '=' | '>' | '>=' | '<' | '<='
  readonly version: ParsedSemver
}

const STRICT_SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/
const PARTIAL_VERSION_RE = /^v?(0|[1-9]\d*|x|X|\*)(?:\.(0|[1-9]\d*|x|X|\*)(?:\.(0|[1-9]\d*|x|X|\*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)?)?$/
const NUMERIC_ID_RE = /^(?:0|[1-9]\d*)$/

function parsePrerelease(raw: string | undefined): readonly (number | string)[] {
  if (!raw) return []
  return raw.split('.').map(part => (NUMERIC_ID_RE.test(part) ? Number(part) : part))
}

function parseSemver(raw: string): ParsedSemver | null {
  const match = STRICT_SEMVER_RE.exec(raw.trim())
  if (match === null) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: parsePrerelease(match[4]),
  }
}

/** Whether `value` is a canonical semantic version string. */
export function isValidSemver(value: string): boolean {
  return parseSemver(value) !== null
}

function compareSemver(left: ParsedSemver, right: ParsedSemver): number {
  if (left.major !== right.major) return left.major - right.major
  if (left.minor !== right.minor) return left.minor - right.minor
  if (left.patch !== right.patch) return left.patch - right.patch
  const a = left.prerelease
  const b = right.prerelease
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1
  if (b.length === 0) return -1
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i += 1) {
    const pa = a[i]!
    const pb = b[i]!
    if (pa === pb) continue
    const numA = typeof pa === 'number'
    const numB = typeof pb === 'number'
    if (numA && numB) return pa - pb
    if (numA !== numB) return numA ? -1 : 1
    return pa < pb ? -1 : 1
  }
  return a.length - b.length
}

function isWildcard(token: string | undefined): boolean {
  return token === undefined || token === '*' || token === 'x' || token === 'X'
}

function zeroPre(major: number, minor: number, patch: number): ParsedSemver {
  return { major, minor, patch, prerelease: [0] }
}

interface ParsedPartial {
  readonly major: number | null
  readonly minor: number | null
  readonly patch: number | null
  readonly prerelease: readonly (number | string)[]
  readonly hasPrerelease: boolean
}

function parsePartial(raw: string): ParsedPartial | null {
  const match = PARTIAL_VERSION_RE.exec(raw.trim())
  if (match === null) return null
  const [, rawMajor, rawMinor, rawPatch, rawPre] = match
  const major = isWildcard(rawMajor) ? null : Number(rawMajor)
  const minor = isWildcard(rawMinor) ? null : Number(rawMinor)
  const patch = isWildcard(rawPatch) ? null : Number(rawPatch)
  if ((major === null && (minor !== null || patch !== null)) || (minor === null && patch !== null)) {
    return null
  }
  const hasPrerelease = typeof rawPre === 'string' && rawPre.length > 0
  return {
    major,
    minor,
    patch,
    prerelease: parsePrerelease(rawPre),
    hasPrerelease,
  }
}

function expandToken(token: string): Comparator[] | null {
  const opMatch = /^(>=|<=|>|<|=|\^|~)?(.*)$/.exec(token.trim())
  if (opMatch === null) return null
  const op = opMatch[1] ?? ''
  const rest = opMatch[2]!.trim()
  const p = parsePartial(rest)
  if (p === null) return null

  if (op === '^') {
    if (p.major === null) return []
    if (p.minor === null) {
      return [
        { op: '>=', version: zeroPre(p.major, 0, 0) },
        { op: '<', version: zeroPre(p.major + 1, 0, 0) },
      ]
    }
    if (p.patch === null) {
      const upper = p.major === 0 ? zeroPre(0, p.minor + 1, 0) : zeroPre(p.major + 1, 0, 0)
      return [
        { op: '>=', version: zeroPre(p.major, p.minor, 0) },
        { op: '<', version: upper },
      ]
    }
    const lower: ParsedSemver = { major: p.major, minor: p.minor, patch: p.patch, prerelease: p.prerelease }
    const upper = p.major > 0
      ? zeroPre(p.major + 1, 0, 0)
      : p.minor > 0
        ? zeroPre(0, p.minor + 1, 0)
        : zeroPre(0, 0, p.patch + 1)
    return [
      { op: '>=', version: lower },
      { op: '<', version: upper },
    ]
  }

  if (op === '~') {
    if (p.major === null) return []
    if (p.minor === null) {
      return [
        { op: '>=', version: zeroPre(p.major, 0, 0) },
        { op: '<', version: zeroPre(p.major + 1, 0, 0) },
      ]
    }
    if (p.patch === null) {
      return [
        { op: '>=', version: zeroPre(p.major, p.minor, 0) },
        { op: '<', version: zeroPre(p.major, p.minor + 1, 0) },
      ]
    }
    return [
      { op: '>=', version: { major: p.major, minor: p.minor, patch: p.patch, prerelease: p.prerelease } },
      { op: '<', version: zeroPre(p.major, p.minor + 1, 0) },
    ]
  }

  if (op === '' || op === '=') {
    if (p.major === null) return []
    if (p.minor === null) {
      return [
        { op: '>=', version: zeroPre(p.major, 0, 0) },
        { op: '<', version: zeroPre(p.major + 1, 0, 0) },
      ]
    }
    if (p.patch === null) {
      return [
        { op: '>=', version: zeroPre(p.major, p.minor, 0) },
        { op: '<', version: zeroPre(p.major, p.minor + 1, 0) },
      ]
    }
    return [{ op: '=', version: { major: p.major, minor: p.minor, patch: p.patch, prerelease: p.prerelease } }]
  }

  if (p.major === null) {
    if (op === '<' || op === '>') return [{ op: '<', version: zeroPre(0, 0, 0) }]
    return []
  }

  if (op === '>') {
    if (p.minor === null) return [{ op: '>=', version: zeroPre(p.major + 1, 0, 0) }]
    if (p.patch === null) return [{ op: '>=', version: zeroPre(p.major, p.minor + 1, 0) }]
    return [{ op: '>', version: { major: p.major, minor: p.minor, patch: p.patch, prerelease: p.prerelease } }]
  }

  if (op === '>=') {
    if (p.minor === null) return [{ op: '>=', version: zeroPre(p.major, 0, 0) }]
    if (p.patch === null) return [{ op: '>=', version: zeroPre(p.major, p.minor, 0) }]
    return [{ op: '>=', version: { major: p.major, minor: p.minor, patch: p.patch, prerelease: p.prerelease } }]
  }

  if (op === '<') {
    if (p.minor === null) return [{ op: '<', version: zeroPre(p.major, 0, 0) }]
    if (p.patch === null) return [{ op: '<', version: zeroPre(p.major, p.minor, 0) }]
    return [{ op: '<', version: { major: p.major, minor: p.minor, patch: p.patch, prerelease: p.prerelease } }]
  }

  // op === '<='
  if (p.minor === null) return [{ op: '<', version: zeroPre(p.major + 1, 0, 0) }]
  if (p.patch === null) return [{ op: '<', version: zeroPre(p.major, p.minor + 1, 0) }]
  return [{ op: '<=', version: { major: p.major, minor: p.minor, patch: p.patch, prerelease: p.prerelease } }]
}

function expandHyphen(leftRaw: string, rightRaw: string): Comparator[] | null {
  const left = parsePartial(leftRaw)
  const right = parsePartial(rightRaw)
  if (left === null || right === null || left.major === null || right.major === null) return null

  const lower: Comparator = left.hasPrerelease && left.minor !== null && left.patch !== null
    ? { op: '>=', version: { major: left.major, minor: left.minor, patch: left.patch, prerelease: left.prerelease } }
    : { op: '>=', version: zeroPre(left.major, left.minor ?? 0, left.patch ?? 0) }

  let upper: Comparator
  if (right.minor === null) {
    upper = { op: '<', version: zeroPre(right.major + 1, 0, 0) }
  } else if (right.patch === null) {
    upper = { op: '<', version: zeroPre(right.major, right.minor + 1, 0) }
  } else if (right.hasPrerelease) {
    upper = { op: '<=', version: { major: right.major, minor: right.minor, patch: right.patch, prerelease: right.prerelease } }
  } else {
    upper = { op: '<', version: zeroPre(right.major, right.minor, right.patch + 1) }
  }
  return [lower, upper]
}

function parseBranch(rawBranch: string): Comparator[] | null {
  const normalized = rawBranch
    .trim()
    .replace(/([<>]=?|=|\^|~)\s+/g, '$1')
  if (normalized === '') return []
  const parts = normalized.split(/\s+/)
  const comparators: Comparator[] = []
  for (let i = 0; i < parts.length; i += 1) {
    const token = parts[i]!
    if (parts[i + 1] === '-' && i + 2 < parts.length) {
      const expanded = expandHyphen(token, parts[i + 2]!)
      if (expanded === null) return null
      comparators.push(...expanded)
      i += 2
      continue
    }
    const expanded = expandToken(token)
    if (expanded === null) return null
    comparators.push(...expanded)
  }
  return comparators
}

function parseRangeBranches(range: string): Comparator[][] | null {
  if (range.trim() === '') return [[]]
  const rawBranches = range.split(/\s*\|\|\s*/)
  const branches: Comparator[][] = []
  for (const raw of rawBranches) {
    const parsed = parseBranch(raw)
    if (parsed === null) return null
    branches.push(parsed)
  }
  return branches
}

function comparatorSatisfied(runtime: ParsedSemver, comp: Comparator): boolean {
  const cmp = compareSemver(runtime, comp.version)
  switch (comp.op) {
    case '=': return cmp === 0
    case '>': return cmp > 0
    case '>=': return cmp >= 0
    case '<': return cmp < 0
    case '<=': return cmp <= 0
  }
}

function branchDirection(runtime: ParsedSemver, branch: readonly Comparator[]): CompatibilityDirection | undefined {
  let violatedLower = false
  let violatedUpper = false
  for (const comp of branch) {
    if (comparatorSatisfied(runtime, comp)) continue
    const cmp = compareSemver(runtime, comp.version)
    if (comp.op === '>' || comp.op === '>=') {
      violatedLower = true
    } else if (comp.op === '<' || comp.op === '<=') {
      violatedUpper = true
    } else if (cmp < 0) {
      violatedLower = true
    } else {
      violatedUpper = true
    }
  }
  if (!violatedLower && !violatedUpper) return undefined
  if (violatedLower && !violatedUpper) return 'host-too-old'
  if (!violatedLower && violatedUpper) return 'plugin-too-old'
  return 'mismatch'
}

/** Whether `runtimeVersion` satisfies a SemVer range under `includePrerelease: true`. */
export function satisfiesDshRange(runtimeVersion: string, range: string): boolean {
  const runtime = parseSemver(runtimeVersion)
  if (runtime === null) return false
  const branches = parseRangeBranches(range)
  if (branches === null) return false
  return branches.some(branch => branch.every(comp => comparatorSatisfied(runtime, comp)))
}

/**
 * Determine incompatibility direction when `runtimeVersion` does not satisfy `range`.
 * Returns `undefined` when compatible or when `runtimeVersion` is invalid/unknown.
 */
export function classifyRangeDirection(runtimeVersion: string, range: string): CompatibilityDirection | undefined {
  const runtime = parseSemver(runtimeVersion)
  if (runtime === null) return undefined
  const branches = parseRangeBranches(range)
  if (branches === null) return 'mismatch'
  const directions: CompatibilityDirection[] = []
  for (const branch of branches) {
    const dir = branchDirection(runtime, branch)
    if (dir === undefined) return undefined
    directions.push(dir)
  }
  if (directions.every(dir => dir === 'host-too-old')) return 'host-too-old'
  if (directions.every(dir => dir === 'plugin-too-old')) return 'plugin-too-old'
  return 'mismatch'
}

/** Evaluate a single `engines.dsh` requirement against the running DSH version. */
export function evaluateDshEngineRange(
  runtimeVersion: string | undefined,
  range: string | undefined,
): DshCompatibilityIssue | undefined {
  if (!runtimeVersion || !range) return undefined
  const trimmedRange = range.trim()
  if (trimmedRange === '') return undefined
  const direction = classifyRangeDirection(runtimeVersion, trimmedRange)
  if (direction === undefined) return undefined
  return {
    direction,
    runtimeVersion,
    requiredRange: trimmedRange,
    requirements: { 'engines.dsh': trimmedRange },
  }
}

/** Whether `range` is a non-empty syntactically valid SemVer range. */
export function isValidDshRange(range: string): boolean {
  const trimmed = range.trim()
  return trimmed !== '' && parseRangeBranches(trimmed) !== null
}

/** Extract a DSH SemVer range from a catalog requirement line like `"DSH >=0.2.2-rc.1 <0.3.0"`. */
export function extractDshEngineFromRequirements(requirements: readonly string[] | undefined): string | undefined {
  if (!requirements || requirements.length === 0) return undefined
  for (const entry of requirements) {
    const trimmed = entry.trim()
    if (/^dsh\s+/i.test(trimmed)) {
      const range = trimmed.slice(3).trim()
      if (isValidDshRange(range)) return range
    }
  }
  return undefined
}

/** Format requirement entries into a compact human-readable phrase (`DSH >=0.2.2-rc.1 <0.3.0`). */
export function formatRequirementsText(requirements: Readonly<Record<string, string>> | undefined): string {
  if (!requirements) return ''
  return Object.entries(requirements)
    .map(([name, range]) => `${name === 'engines.dsh' ? 'DSH' : name} ${range}`)
    .join(', ')
}

/** Merge multiple incompatibility directions conservatively. */
export function combineDirections(directions: readonly CompatibilityDirection[]): CompatibilityDirection {
  if (directions.length === 0) return 'mismatch'
  if (directions.every(dir => dir === 'host-too-old')) return 'host-too-old'
  if (directions.every(dir => dir === 'plugin-too-old')) return 'plugin-too-old'
  return 'mismatch'
}

/** Whether a requirement key belongs to the DSH host version namespace. */
export function isDshVersionRequirementKey(key: string): boolean {
  const normalized = key.trim().toLowerCase()
  return normalized === 'engines.dsh'
    || normalized === 'dsh'
    || normalized === '@deepseek-ai/dsh'
    || normalized.startsWith('@deepseek-ai/dsh-')
}

/** Classify a dependency/engine requirement map against the running DSH host version. */
export function classifyRequirementRecord(
  requirements: Readonly<Record<string, string>> | undefined,
  runtimeVersion?: string,
): CompatibilityDirection {
  if (!requirements || !runtimeVersion || !isValidSemver(runtimeVersion)) return 'mismatch'
  const entries = Object.entries(requirements)
  if (entries.length === 0) return 'mismatch'
  const directions: CompatibilityDirection[] = []
  for (const [key, range] of entries) {
    if (!isDshVersionRequirementKey(key)) {
      directions.push('mismatch')
      continue
    }
    const dir = classifyRangeDirection(runtimeVersion, range)
    if (dir !== undefined) directions.push(dir)
  }
  return combineDirections(directions)
}

/** Classify structured Host `incompatible` entries into an overall direction and requirement summary. */
export function classifyIncompatibleItems(
  items: readonly IncompatibleRequirementItem[] | undefined,
  fallbackRuntimeVersion?: string,
): {
  readonly direction: CompatibilityDirection
  readonly runtimeVersion: string
  readonly requirementsText: string
  readonly items: readonly IncompatibleRequirementItem[]
} {
  const list = items ?? []
  const directions: CompatibilityDirection[] = []
  const requirementParts: string[] = []
  let resolvedRuntime = ''
  for (const item of list) {
    const runtime = item.runtimeVersion || fallbackRuntimeVersion || ''
    if (resolvedRuntime === '' && runtime !== '') resolvedRuntime = runtime
    const reqs = item.requirements ?? item.peers ?? {}
    const formatted = formatRequirementsText(reqs)
    if (formatted !== '') requirementParts.push(formatted)
    if (runtime !== '' && isValidSemver(runtime)) {
      directions.push(classifyRequirementRecord(reqs, runtime))
    }
  }
  if (resolvedRuntime === '' && fallbackRuntimeVersion) resolvedRuntime = fallbackRuntimeVersion
  const uniqueRequirements = [...new Set(requirementParts)]
  return {
    direction: combineDirections(directions),
    runtimeVersion: resolvedRuntime,
    requirementsText: uniqueRequirements.join('; '),
    items: list,
  }
}

export interface TargetCompatibilityCandidate {
  readonly dshEngine?: string
  readonly compatFallback?: CompatFallbackInfo
}

export interface TargetsCompatibilityResult {
  readonly targetIssues: readonly (DshCompatibilityIssue | undefined)[]
  readonly blockingIssue: DshCompatibilityIssue | undefined
  readonly fallbackIndices: readonly number[]
}

/**
 * Evaluate a list of install targets against the running DSH version.
 * Repo-level fallback requirements apply only when there is a single target
 * so Monorepo siblings never inherit another sibling's constraint.
 */
export function evaluateTargetsCompatibility(
  targets: readonly TargetCompatibilityCandidate[],
  dshVersion: string | undefined,
  fallbackRequirements?: readonly string[],
): TargetsCompatibilityResult {
  if (targets.length === 0) {
    return { targetIssues: [], blockingIssue: undefined, fallbackIndices: [] }
  }
  const singleFallbackEngine = targets.length === 1
    ? extractDshEngineFromRequirements(fallbackRequirements)
    : undefined
  const targetIssues: (DshCompatibilityIssue | undefined)[] = []
  const fallbackIndices: number[] = []
  const blockingIssues: DshCompatibilityIssue[] = []
  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i]!
    const engine = target.dshEngine ?? singleFallbackEngine
    const issue = evaluateDshEngineRange(dshVersion, engine)
    targetIssues.push(issue)
    if (issue === undefined) {
      if (target.compatFallback !== undefined) fallbackIndices.push(i)
    } else {
      blockingIssues.push(issue)
    }
  }
  if (blockingIssues.length !== targets.length) {
    return { targetIssues, blockingIssue: undefined, fallbackIndices }
  }
  const direction = combineDirections(blockingIssues.map(issue => issue.direction))
  const requiredRange = [...new Set(blockingIssues.map(issue => issue.requiredRange))].join(' / ')
  return {
    targetIssues,
    blockingIssue: {
      direction,
      runtimeVersion: blockingIssues[0]!.runtimeVersion,
      requiredRange,
      requirements: { 'engines.dsh': requiredRange },
    },
    fallbackIndices,
  }
}

/**
 * Select the newest subscription version compatible with `runtimeVersion`.
 * Falls back to older published versions if the newest requires another DSH version;
 * if no version is compatible, retains the newest version and attaches its compatibility issue.
 */
export function selectCompatibleSubscriptionVersion<T extends SubscriptionVersionCandidate>(
  versions: readonly T[],
  runtimeVersion?: string,
): SubscriptionVersionSelection<T> | undefined {
  if (versions.length === 0) return undefined
  const latest = versions[0]!
  if (!runtimeVersion || !isValidSemver(runtimeVersion)) {
    return { selected: latest }
  }
  const latestIssue = evaluateDshEngineRange(runtimeVersion, latest.enginesDsh)
  if (latestIssue === undefined) {
    return { selected: latest }
  }
  for (let i = 1; i < versions.length; i += 1) {
    const candidate = versions[i]!
    const issue = evaluateDshEngineRange(runtimeVersion, candidate.enginesDsh)
    if (issue === undefined) {
      const hasVersions = candidate.version.trim() !== '' && latest.version.trim() !== ''
      return {
        selected: candidate,
        ...(hasVersions
          ? {
              fallback: {
                selectedVersion: candidate.version,
                latestVersion: latest.version,
                ...(latest.enginesDsh ? { latestEngine: latest.enginesDsh } : {}),
              },
            }
          : {}),
      }
    }
  }
  return {
    selected: latest,
    incompatible: latestIssue,
  }
}
