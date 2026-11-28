/**
 * Sanitization helpers for untrusted third-party marketplace metadata before it
 * enters LLM tool outputs or prompts.
 */
/** Zero-width, BiDi override, invisible filler, variation-selector, and Unicode tag-block characters used in invisible prompt injection. */
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
/** Wrap a model-facing payload in an untrusted-data envelope that third-party text cannot close. */
export declare function wrapUntrustedData(tag: string, source: string, payload: string): string;
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
export declare function renderUntrustedToolOutput(tag: string, source: string, value: string): string;
/** A dynamic identifier allowed into tool guidance only when it matches its strict grammar. */
export declare function guidanceToken(value: unknown, grammar: RegExp): string;
/** A filesystem path for tool guidance: sanitized, bounded, and quoted so it reads as a value. */
export declare function guidancePath(value: unknown): string;
