import { useMemo, useState } from 'react'
import { ownerAvatarUrl } from './avatar.ts'
import { iconCandidatesOf, noteIconLoaded } from './iconMirrors.ts'

/**
 * A plugin's own artwork (data URI or HTTPS URL, with two-edge fallback for
 * jsDelivr URLs), else its owner's GitHub avatar, else a built-in letter
 * placeholder. Each failed request (404, renamed repository, offline, blocked
 * by the host's CSP) moves one step down, so the layout never shows a broken image.
 */
export function PluginLogo({ src, name, fullName }: { src?: string; name: string; fullName?: string }) {
  const avatar = ownerAvatarUrl(fullName)
  const { iconSources, sources, sourceKey } = useMemo(() => {
    const primarySources = iconCandidatesOf(src)
    const combined = [...primarySources, avatar].filter(
      (value, index, all): value is string => typeof value === 'string' && value !== '' && all.indexOf(value) === index,
    )
    return {
      iconSources: primarySources,
      sources: combined,
      sourceKey: `${typeof src === 'string' ? src.trim() : ''}\0${avatar ?? ''}`,
    }
  }, [src, avatar])
  const [failure, setFailure] = useState<{ key: string; step: number }>({ key: sourceKey, step: 0 })
  const step = failure.key === sourceKey ? failure.step : 0
  const current = sources[step]
  const safeName = typeof name === 'string' ? name : ''
  const isAvatar = current !== undefined && current === avatar && !iconSources.includes(current)
  return <span className="dsh_market_logo" aria-hidden="true">
    {current
      ? <img key={current} src={current} alt="" loading="lazy" decoding="async" draggable={false} referrerPolicy="no-referrer"
          className={isAvatar ? 'dsh_market_logoAvatar' : undefined}
          onLoad={() => noteIconLoaded(src, current, step > 0)}
          onError={() => setFailure(previous => ({
            key: sourceKey,
            step: (previous.key === sourceKey ? previous.step : 0) + 1,
          }))} />
      : <span className="dsh_market_logoPlaceholder">{[...safeName.replace(/^@[^/]+\//, '').trim()][0]?.toLocaleUpperCase() || 'P'}</span>}
  </span>
}
