import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { watchElementClipping } from './clipping.ts'

export function MarketDescription({ text }: { text: string }): ReactElement {
  const ref = useRef<HTMLParagraphElement | null>(null)
  const [clipped, setClipped] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    return watchElementClipping(el, setClipped)
  }, [text])
  return (
    <Tooltip label={text} side="top" portal openOnClick maxWidth={320} disabled={!clipped}>
      <p ref={ref} className="dsh_market_desc" data-clipped={clipped ? 'true' : undefined} tabIndex={clipped ? 0 : undefined}>{text}</p>
    </Tooltip>
  )
}
