import React, { useMemo } from 'react'
import { CheckCircle2, CircleDashed, FileWarning, ShieldCheck, Upload, XCircle } from 'lucide-react'
import { Panel, Pill, Button, EmptyState, SectionHeader } from '../components/ui'
import { DataQualityWarnings } from '../components/DataQualityWarnings'
import { useStore } from '../lib/store'
import { relativeTime } from '../lib/format'
import { buildAuditInputs } from '../audit/inputs'
import { evaluateGate, type GateResult } from '../audit/gate'

export function PpcAudit() {
  const { currentClient, currentBundle } = useStore()

  if (!currentClient || !currentBundle) {
    return <EmptyState title="No client selected" description="Add a client before running a PPC audit." />
  }

  const inputs = useMemo(() => buildAuditInputs(currentBundle), [currentBundle])
  const gate = useMemo(() => evaluateGate(inputs), [inputs])

  return (
    <div className="space-y-5">
      <SectionHeader
        title="PPC Audit"
        sub="Stage 1 — Report Intake & Data Validation Gate. The deep dive unlocks when the gate passes."
        right={<GateDecisionPill gate={gate} />}
      />

      <GatePanel gate={gate} />

      {gate.issues.length > 0 && <DataQualityWarnings issues={gate.issues} defaultOpen={gate.decision === 'not-ready'} />}

      <Panel>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-sm font-semibold text-ink">Stage 2 — Deep Dive + Growth Plan</div>
            <p className="text-xs text-ink-mute mt-1 max-w-xl">
              Economics engine, threshold rules, search-term mining, structure gap analysis, goal reality
              check, and the prioritized action plan — runs only when the gate passes.
            </p>
            {gate.blockedDecisions.length > 0 && (
              <ul className="mt-3 space-y-1">
                {gate.blockedDecisions.map((b, i) => (
                  <li key={i} className="text-2xs text-ink-faint flex items-center gap-1.5">
                    <FileWarning className="w-3 h-3 shrink-0 text-[#c98a1a]" /> {b}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Button disabled={gate.decision === 'not-ready'}>
            Run deep dive
          </Button>
        </div>
        {gate.decision === 'not-ready' && gate.minimumNextUpload && (
          <div className="mt-4 rounded-lg bg-accent-goldSoft/50 px-3 py-2 text-xs text-[#8b6a18]">
            Minimum next upload: <span className="font-semibold">{gate.minimumNextUpload}</span> — add it on the Upload Reports page.
          </div>
        )}
      </Panel>
    </div>
  )
}

function GateDecisionPill({ gate }: { gate: GateResult }) {
  if (gate.decision === 'ready') return <Pill tone="mint" className="px-3 py-1"><ShieldCheck className="w-3 h-3" /> Ready for Full Deep Dive</Pill>
  if (gate.decision === 'ready-with-limits') return <Pill tone="gold" className="px-3 py-1"><ShieldCheck className="w-3 h-3" /> Ready With Limits</Pill>
  return <Pill tone="blush" className="px-3 py-1"><XCircle className="w-3 h-3" /> Not Ready — Missing Required Data</Pill>
}

function GatePanel({ gate }: { gate: GateResult }) {
  const required = gate.received.filter(r => r.tier === 'required')
  const scale = gate.received.filter(r => r.tier === 'scale')
  return (
    <Panel padding="p-0">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between">
        <div className="text-sm font-semibold text-ink">Reports received</div>
        <div className="text-2xs text-ink-faint">
          {required.filter(r => r.present).length}/{required.length} required · {scale.filter(r => r.present).length}/{scale.length} for scale decisions
        </div>
      </div>
      <div className="divide-y divide-line">
        {[...required, ...scale].map(item => (
          <div key={item.slot} className="px-4 py-2.5 flex items-center gap-3">
            {item.present
              ? <CheckCircle2 className="w-4 h-4 shrink-0 text-[#1f7a4a]" />
              : <CircleDashed className="w-4 h-4 shrink-0 text-ink-faint" />}
            <div className="flex-1 min-w-0">
              <div className="text-sm text-ink flex items-center gap-2">
                {item.label}
                {item.tier === 'scale' && <Pill tone="peri">scale</Pill>}
              </div>
              {item.present ? (
                <div className="text-2xs text-ink-faint truncate">
                  {item.rows != null && <>{item.rows.toLocaleString()} rows · </>}
                  {item.fileName}{item.uploadedAt && <> · {relativeTime(item.uploadedAt)}</>}
                </div>
              ) : (
                <div className="text-2xs text-ink-faint">Missing</div>
              )}
            </div>
            {!item.present && (
              <a href="#/upload" className="text-2xs text-[#3b48a5] hover:underline flex items-center gap-1 shrink-0">
                <Upload className="w-3 h-3" /> Upload
              </a>
            )}
          </div>
        ))}
      </div>
    </Panel>
  )
}
