import type { ReactElement } from 'react'
import { IconCloseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarketLocale } from './copy.ts'
import { STAR_REPOSITORY_URL } from './starPrompt.ts'

export function StarGlyph({ size = 18 }: { size?: number }): ReactElement {
  return (
    <svg className="dsh_market_starIcon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9 2.9-6Z" />
    </svg>
  )
}

export function StarActionLink({ t, onStarred }: {
  t: MarketLocale
  onStarred?: () => void
}): ReactElement {
  return (
    <a
      className="dsh_market_starAction"
      href={STAR_REPOSITORY_URL}
      target="_blank"
      rel="noreferrer"
      onClick={() => onStarred?.()}
      onAuxClick={(event) => { if (event.button === 1) onStarred?.() }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.77 2.72 1.26 3.38.96.1-.75.4-1.26.74-1.55-2.57-.29-5.27-1.28-5.27-5.68 0-1.26.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.16 1.18A10.98 10.98 0 0 1 12 6.16c.98 0 1.94.13 2.86.38 2.2-1.49 3.16-1.18 3.16-1.18.63 1.58.23 2.75.11 3.04.74.8 1.19 1.82 1.19 3.08 0 4.41-2.71 5.38-5.29 5.67.42.36.79 1.06.79 2.14v3.26c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
      </svg>
      {t('star.action')}
    </a>
  )
}

/**
 * The in-flow GitHub star nudge card. Both exits are terminal — following the
 * link counts as answered, closing as declined — so the card appears at most a
 * handful of times in the product's life.
 */
export function StarPromptCard({ t, onSettle }: {
  t: MarketLocale
  onSettle: (outcome: 'dismissed' | 'starred') => void
}): ReactElement {
  return (
    <aside className="dsh_market_starPrompt" aria-label={t('star.action')}>
      <StarGlyph />
      <p className="dsh_market_starText">{t('star.prompt')}</p>
      <div className="dsh_market_starActions">
        <StarActionLink t={t} onStarred={() => onSettle('starred')} />
        <button
          type="button"
          className="dsh_market_starDismiss"
          aria-label={t('direct.close')}
          onClick={() => onSettle('dismissed')}
        >
          <IconCloseOutlineRegular size={14} />
        </button>
      </div>
    </aside>
  )
}
