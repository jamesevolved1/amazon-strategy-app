import React from 'react'
import { Delta, cx } from './ui'

export type KpiTone = 'peri' | 'mint' | 'gold' | 'lavender' | 'blush'

const STRIPE: Record<KpiTone, string> = {
  peri: 'bg-accent-peri',
  mint: 'bg-accent-mint',
  gold: 'bg-accent-gold',
  lavender: 'bg-accent-lavender',
  blush: 'bg-accent-blush',
}

const ICON_BG: Record<KpiTone, string> = {
  peri: 'bg-accent-periSoft text-[#3b48a5]',
  mint: 'bg-accent-mintSoft text-[#1f7a4a]',
  gold: 'bg-accent-goldSoft text-[#8b6a18]',
  lavender: 'bg-accent-lavenderSoft text-[#5b4a90]',
  blush: 'bg-accent-blushSoft text-[#9c4651]',
}

export function KPICard({
  label, value, tone = 'peri', icon, delta, deltaInvert, secondary, hint,
}: {
  label: string
  value: React.ReactNode
  tone?: KpiTone
  icon?: React.ReactNode
  delta?: number
  deltaInvert?: boolean
  secondary?: React.ReactNode
  hint?: string
}) {
  return (
    <div className="relative rounded-xl2 bg-canvas-panel border border-line shadow-card overflow-hidden">
      <div className={cx('absolute inset-x-0 top-0 h-[3px]', STRIPE[tone])} />
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <span className="text-2xs font-semibold tracking-wider text-ink-mute uppercase">{label}</span>
          {icon && (
            <span className={cx('w-7 h-7 rounded-lg flex items-center justify-center', ICON_BG[tone])}>
              {icon}
            </span>
          )}
        </div>
        <div className="mt-2 tnum text-[28px] leading-tight font-semibold text-ink">
          {value}
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs text-ink-mute">
          {delta !== undefined && <Delta value={delta} invert={deltaInvert} />}
          {secondary && <span className="tnum">{secondary}</span>}
        </div>
        {hint && <p className="mt-1 text-2xs text-ink-faint">{hint}</p>}
      </div>
    </div>
  )
}
