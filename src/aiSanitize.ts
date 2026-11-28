/**
 * Sanitization helpers for untrusted third-party marketplace metadata before it
 * enters LLM tool outputs or prompts.
 */

/** Zero-width, BiDi override, and Unicode tag-block characters used in invisible prompt injection. */
export const INVISIBLE_INJECTION_PATTERN = /[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\u{e0000}-\u{e007f}]/gu

const UNSAFE_TEXT_CHAR = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\u{e0000}-\u{e007f}]/u

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
