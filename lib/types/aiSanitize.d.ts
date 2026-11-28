/**
 * Sanitization helpers for untrusted third-party marketplace metadata before it
 * enters LLM tool outputs or prompts.
 */
/** Zero-width, BiDi override, and Unicode tag-block characters used in invisible prompt injection. */
export declare const INVISIBLE_INJECTION_PATTERN: RegExp;
/** Whether text carries control or invisible characters that sanitizing would silently drop. */
export declare function hasUnsafeTextChars(value: string): boolean;
/**
 * Strip control, zero-width, BiDi override, and Unicode tag-block characters
 * (used for invisible prompt injection), neutralize `<` / `>` so third-party
 * text can never forge or close framing tags like `</untrusted_market_data>`
 * or `</skill_instructions>`, collapse whitespace, and cap length by code point.
 */
export declare function sanitizeUntrustedText(value: unknown, limit: number): string;
/** Bounded untrusted-text clipping helper shared across AI discovery views. */
export declare function clip(value: unknown, limit: number): string;
