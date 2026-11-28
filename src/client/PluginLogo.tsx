import { useMemo, useState } from 'react'
import { ownerAvatarUrl } from './avatar.ts'
import {
  advanceIconFailure,
  currentIconStep,
  logoPlaceholderLetter,
  logoSourceChainOf,
  noteIconLoaded,
  type IconFailureState,
} from './iconMirrors.ts'

/**
 * A plugin's own artwork (data URI or HTTPS URL, with two-edge fallback for
 * jsDelivr URLs), else its owner's GitHub avatar, else a built-in letter
 * placeholder. Each failed request (404, renamed repository, offline, blocked
 * by the host's CSP) moves one step down, so the layout never shows a broken image.
 */
export function PluginLogo({ src, name, fullName }: { src?: string; name: string; fullName?: string }) {
  const avatar = ownerAvatarUrl(fullName)
  const { sources, sourceKey } = useMemo(() => logoSourceChainOf(src, avatar), [src, avatar])
  const [failure, setFailure] = useState<IconFailureState>({ key: sourceKey, step: 0 })
  const step = currentIconStep(failure, sourceKey)
  const current = sources[step]
  return <span className="dsh_market_logo" aria-hidden="true">
    {current
      ? <img key={current} src={current} alt="" loading="lazy" decoding="async" draggable={false} referrerPolicy="no-referrer"
          onLoad={() => noteIconLoaded(src, current, step > 0)}
          onError={() => setFailure(previous => advanceIconFailure(previous, sourceKey))} />
      : <span className="dsh_market_logoPlaceholder">{logoPlaceholderLetter(name)}</span>}
  </span>
}
