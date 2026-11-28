/** Minimal measurement surface of a clipped text element. */
export interface ClippingMeasurement {
  readonly scrollHeight: number
  readonly clientHeight: number
  readonly scrollWidth: number
  readonly clientWidth: number
}

/**
 * Whether the element's content overflows its box in either direction, with a
 * 1px tolerance absorbing sub-pixel rounding of line-clamped text.
 */
export function isElementClipped(el: ClippingMeasurement): boolean {
  return el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1
}

/**
 * Measure clipping now and keep it current: re-measure on resize, and once more
 * when late-loading fonts settle (only while `document.fonts` is still loading).
 * The returned stop function disconnects the observer and blocks late callbacks.
 */
export function watchElementClipping(el: HTMLElement, onClipping: (clipped: boolean) => void): () => void {
  let cancelled = false
  const measure = () => {
    if (!cancelled) onClipping(isElementClipped(el))
  }
  measure()
  if (typeof document !== 'undefined' && document.fonts?.status === 'loading') {
    void document.fonts.ready.then(measure)
  }
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
  observer?.observe(el)
  return () => {
    cancelled = true
    observer?.disconnect()
  }
}
