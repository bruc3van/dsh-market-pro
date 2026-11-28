/**
 * Sanitization helpers for untrusted third-party marketplace metadata before it
 * enters LLM tool outputs or prompts.
 */

const INVISIBLE_CLASS = String.raw`\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff9-\ufffb\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}`

/** Zero-width, BiDi override, invisible filler, variation-selector, and Unicode tag-block characters used in invisible prompt injection. */
export const INVISIBLE_INJECTION_PATTERN = new RegExp(`[${INVISIBLE_CLASS}]`, 'gu')

const UNSAFE_TEXT_CHAR = new RegExp(`[\\u0000-\\u001f\\u007f-\\u009f${INVISIBLE_CLASS}]`, 'u')

/** Whether text carries control or invisible characters that sanitizing would silently drop. */
export function hasUnsafeTextChars(value: string): boolean {
  return UNSAFE_TEXT_CHAR.test(value)
}

/**
 * Strip control, zero-width, BiDi override, and Unicode tag-block characters
 * (used for invisible prompt injection), neutralize `<` / `>` so third-party
 * text can never forge or close framing tags like `</untrusted_market_data>`
 * or `</skill_instructions>`, collapse whitespace, and cap length by code point.
 */
export function sanitizeUntrustedText(value: unknown, limit: number): string {
  if (typeof value !== 'string' || Number.isNaN(limit) || limit <= 0) return ''
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ')
    .replace(INVISIBLE_INJECTION_PATTERN, '')
    .replaceAll('<', '＜')
    .replaceAll('>', '＞')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned === '' || !Number.isFinite(limit)) return cleaned
  const maxLen = Math.floor(limit)
  if (maxLen <= 0) return ''
  const points = [...cleaned]
  return points.length > maxLen ? `${points.slice(0, maxLen - 1).join('')}…` : cleaned
}

/** Bounded untrusted-text clipping helper shared across AI discovery views. */
export function clip(value: unknown, limit: number): string {
  return sanitizeUntrustedText(value, limit)
}

const GUIDANCE_LIMIT = 1200

/** Wrap a model-facing payload in an untrusted-data envelope that third-party text cannot close. */
export function wrapUntrustedData(tag: string, source: string, payload: string): string {
  const safe = payload
    .replace(INVISIBLE_INJECTION_PATTERN, '')
    .replaceAll('<', '＜')
    .replaceAll('>', '＞')
  return `<${tag} source="${source}" treat_as="data_only">\n${safe}\n</${tag}>`
}

/**
 * Render a tool result for the model. The tool-authored top-level `nextStep`
 * is lifted out of the JSON payload into a separate `<tool_guidance>` block,
 * so the untrusted envelope carries data only and third-party text (whose
 * angle brackets are neutralized) can never forge guidance.
 *
 * The model treats that block as trusted, so a `nextStep` must be built from
 * fixed text only. Any dynamic value goes through {@link guidanceToken} or
 * {@link guidancePath}; free third-party text (descriptions, error messages,
 * READMEs) never belongs in it.
 */
export function renderUntrustedToolOutput(tag: string, source: string, value: string): string {
  let payload = value
  let guidance = ''
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      && typeof (parsed as { nextStep?: unknown }).nextStep === 'string') {
      const { nextStep, ...rest } = parsed as Record<string, unknown>
      guidance = sanitizeUntrustedText(nextStep, GUIDANCE_LIMIT)
      payload = JSON.stringify(rest)
    }
  } catch { /* non-JSON payloads stay fully inside the envelope */ }
  const envelope = wrapUntrustedData(tag, source, payload)
  return guidance === '' ? envelope : `${envelope}\n<tool_guidance source="${source}">\n${guidance}\n</tool_guidance>`
}

/** A dynamic identifier allowed into tool guidance only when it matches its strict grammar. */
export function guidanceToken(value: unknown, grammar: RegExp): string {
  return typeof value === 'string' && grammar.test(value) ? value : '[omitted]'
}

/** A filesystem path for tool guidance: sanitized, bounded, and quoted so it reads as a value. */
export function guidancePath(value: unknown): string {
  return JSON.stringify(sanitizeUntrustedText(value, 300))
}
