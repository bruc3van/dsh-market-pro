import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { useLayoutEffect, useRef, useState, type ReactElement } from 'react'

export function MarketDescription({ text }: { text: string }): ReactElement {
  const ref = useRef<HTMLParagraphElement | null>(null)
  const [clipped, setClipped] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    let cancelled = false
    const measure = () => {
      if (!cancelled) {
        setClipped(el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)
      }
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
  }, [text])
  return (
    <Tooltip label={text} side="top" portal openOnClick maxWidth={320} disabled={!clipped}>
      <p ref={ref} className="dsh_market_desc" data-clipped={clipped ? 'true' : undefined} tabIndex={clipped ? 0 : undefined}>{text}</p>
    </Tooltip>
  )
}
