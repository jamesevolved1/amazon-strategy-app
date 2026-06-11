// Shared primitives: Panel, KPICard, SegmentedControl, Pill, Stat, EmptyState, Toast.
import React, { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Minus } from 'lucide-react'

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

export function Panel({
  className, children, padding = 'p-5',
}: { className?: string; children: React.ReactNode; padding?: string }) {
  return (
    <div className={cx('rounded-xl2 bg-canvas-panel border border-line shadow-card', padding, className)}>
      {children}
    </div>
  )
}

export function SectionHeader({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3 mb-3">
      <div>
        <h2 className="text-base font-semibold text-ink leading-tight">{title}</h2>
        {sub && <p className="text-xs text-ink-mute mt-0.5">{sub}</p>}
      </div>
      {right}
    </div>
  )
}

export function Pill({
  tone = 'mute', children, className,
}: { tone?: 'mint' | 'peri' | 'gold' | 'lavender' | 'blush' | 'mute' | 'ink'; children: React.ReactNode; className?: string }) {
  const map: Record<string, string> = {
    mint:     'bg-accent-mintSoft text-[#1f7a4a]',
    peri:     'bg-accent-periSoft text-[#3b48a5]',
    gold:     'bg-accent-goldSoft text-[#8b6a18]',
    lavender: 'bg-accent-lavenderSoft text-[#5b4a90]',
    blush:    'bg-accent-blushSoft text-[#9c4651]',
    mute:     'bg-[#f1f2f5] text-ink-mute',
    ink:      'bg-ink text-white',
  }
  return (
    <span className={cx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-medium', map[tone], className)}>
      {children}
    </span>
  )
}

export function Delta({ value, suffix = '%', invert = false }: { value: number | undefined; suffix?: string; invert?: boolean }) {
  if (value == null || !Number.isFinite(value)) {
    return <span className="inline-flex items-center gap-1 text-2xs text-ink-mute"><Minus className="w-3 h-3" />—</span>
  }
  const positive = invert ? value < 0 : value > 0
  const negative = invert ? value > 0 : value < 0
  const zero = value === 0
  const tone = positive ? 'text-[#1f7a4a] bg-accent-mintSoft' : negative ? 'text-[#9c4651] bg-accent-blushSoft' : 'text-ink-mute bg-[#f1f2f5]'
  const Icon = zero ? Minus : (value > 0 ? ArrowUp : ArrowDown)
  return (
    <span className={cx('inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-2xs font-semibold tnum', tone)}>
      <Icon className="w-3 h-3" strokeWidth={2.4} />
      {Math.abs(value).toFixed(1)}{suffix}
    </span>
  )
}

export function SegmentedControl<T extends string>({
  options, value, onChange, className,
}: { options: Array<{ id: T; label: string }>; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cx('inline-flex items-center gap-1 p-1 rounded-full border border-line bg-canvas-panel', className)}>
      {options.map(o => {
        const selected = o.id === value
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className={cx(
              'px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors',
              selected ? 'bg-ink text-white' : 'text-ink-mute hover:text-ink hover:bg-[#f1f2f5]'
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="text-center py-10 px-6">
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {description && <p className="text-sm text-ink-mute mt-1.5 max-w-md mx-auto">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function TextField({
  label, value, onChange, type = 'text', suffix, prefix, placeholder, className, step,
}: {
  label?: string
  value: string | number
  onChange: (v: string) => void
  type?: string
  suffix?: string
  prefix?: string
  placeholder?: string
  className?: string
  step?: string
}) {
  return (
    <label className={cx('block', className)}>
      {label && <span className="block text-xs font-medium text-ink-mute mb-1.5">{label}</span>}
      <div className="relative">
        {prefix && <span className="absolute inset-y-0 left-3 flex items-center text-sm text-ink-mute">{prefix}</span>}
        <input
          type={type}
          step={step}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={cx(
            'w-full rounded-lg border border-line bg-canvas-panel text-sm text-ink',
            'px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ink/15 focus:border-ink/20',
            prefix && 'pl-7',
            suffix && 'pr-9'
          )}
        />
        {suffix && <span className="absolute inset-y-0 right-3 flex items-center text-sm text-ink-mute">{suffix}</span>}
      </div>
    </label>
  )
}

/**
 * Numeric input that lets the field go truly empty. Tracks a local draft
 * string so the user can clear it without the parent re-coercing to "0".
 * Emits 0 when the field is empty, otherwise the parsed number.
 */
export function NumberField({
  label, value, onChange, prefix, suffix, step, placeholder, className,
}: {
  label?: string
  value: number
  onChange: (v: number) => void
  prefix?: string
  suffix?: string
  step?: string
  placeholder?: string
  className?: string
}) {
  const [draft, setDraft] = useState<string>(() => initialDraft(value))
  const [focused, setFocused] = useState(false)

  // Sync from external value when not focused (e.g. reset, programmatic update).
  useEffect(() => {
    if (focused) return
    const parsed = draft === '' ? 0 : Number(draft)
    if (parsed !== value) setDraft(initialDraft(value))
  }, [value, focused, draft])

  return (
    <label className={cx('block', className)}>
      {label && <span className="block text-xs font-medium text-ink-mute mb-1.5">{label}</span>}
      <div className="relative">
        {prefix && <span className="absolute inset-y-0 left-3 flex items-center text-sm text-ink-mute">{prefix}</span>}
        <input
          type="number"
          inputMode="decimal"
          step={step}
          value={draft}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={e => {
            const next = e.target.value
            setDraft(next)
            if (next === '' || next === '-') { onChange(0); return }
            const n = Number(next)
            if (Number.isFinite(n)) onChange(n)
          }}
          placeholder={placeholder ?? '0'}
          className={cx(
            'w-full rounded-lg border border-line bg-canvas-panel text-sm text-ink',
            'px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ink/15 focus:border-ink/20',
            prefix && 'pl-7',
            suffix && 'pr-9'
          )}
        />
        {suffix && <span className="absolute inset-y-0 right-3 flex items-center text-sm text-ink-mute">{suffix}</span>}
      </div>
    </label>
  )
}

function initialDraft(v: number): string {
  if (!Number.isFinite(v) || v === 0) return ''
  return String(v)
}

export function Button({
  children, variant = 'primary', onClick, className, disabled, type = 'button', icon,
}: {
  children: React.ReactNode
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  onClick?: () => void
  className?: string
  disabled?: boolean
  type?: 'button' | 'submit'
  icon?: React.ReactNode
}) {
  const styles: Record<string, string> = {
    primary: 'bg-ink text-white hover:bg-ink-soft active:bg-black',
    secondary: 'bg-canvas-panel border border-line text-ink hover:bg-[#f4f5f8]',
    ghost: 'text-ink-mute hover:text-ink hover:bg-[#f4f5f8]',
    danger: 'bg-[#c4505b] text-white hover:bg-[#b44551]',
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-sm font-medium transition-colors',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        styles[variant], className,
      )}
    >
      {icon}
      {children}
    </button>
  )
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      className="inline-block rounded-full border-2 border-ink/15 border-t-ink animate-spin"
      style={{ width: size, height: size }}
    />
  )
}

export function Sparkline({ values, color = '#9aa6f0', height = 28, width = 80 }: { values: number[]; color?: string; height?: number; width?: number }) {
  if (values.length < 2) return <svg width={width} height={height} />
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const step = width / (values.length - 1)
  const points = values.map((v, i) => `${i * step},${height - ((v - min) / range) * (height - 4) - 2}`).join(' ')
  return (
    <svg width={width} height={height}>
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
