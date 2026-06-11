import React, { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import type { DataQualityIssue } from '../utils/pnl'
import { Pill, cx } from './ui'

export function DataQualityWarnings({ issues, defaultOpen = false }: { issues: DataQualityIssue[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  if (issues.length === 0) return null
  const critical = issues.filter(i => i.level === 'critical').length
  const warn = issues.filter(i => i.level === 'warn').length
  const info = issues.filter(i => i.level === 'info').length
  return (
    <div className="rounded-xl2 border border-line bg-canvas-panel">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3"
      >
        <div className="flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 text-[#c98a1a]" />
          <span className="text-sm font-medium text-ink">Data quality</span>
          {critical > 0 && <Pill tone="blush">{critical} critical</Pill>}
          {warn > 0 && <Pill tone="gold">{warn} warnings</Pill>}
          {info > 0 && <Pill tone="peri">{info} notes</Pill>}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-ink-faint" /> : <ChevronDown className="w-4 h-4 text-ink-faint" />}
      </button>
      {open && (
        <div className="border-t border-line px-4 py-3 space-y-2">
          {issues.map((i, idx) => (
            <div key={idx} className="flex items-start gap-2.5 text-sm">
              <span className={cx(
                'mt-1 w-1.5 h-1.5 rounded-full shrink-0',
                i.level === 'critical' ? 'bg-[#c4505b]' : i.level === 'warn' ? 'bg-[#c98a1a]' : 'bg-accent-peri',
              )} />
              <span className="text-ink-mute">
                <span className="text-ink">{i.message}</span>
                {i.count !== undefined && <span className="ml-1 text-ink-faint">· {i.count} affected</span>}
                {i.source && <span className="ml-1 text-ink-faint">· {i.source}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
