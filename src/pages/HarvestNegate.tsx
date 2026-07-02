// Harvest & Negate — Evolved §2.6 / §6.14 search-term mining. Reads the SP
// Search Term report (+ Bulk Operations export for IDs & dedupe), proposes
// exact-match graduations and negative-exacts, and exports one bulk workbook:
// upload-ready rows + a "Needs new campaign" sheet for the Campaign Builder.

import React, { useMemo, useState } from 'react'
import { Sprout, Ban, Download, Check, X, ChevronDown, ChevronRight, Upload } from 'lucide-react'
import { Panel, EmptyState, Button, NumberField, cx } from '../components/ui'
import { useStore, cryptoRandomId } from '../lib/store'
import { buildAuditInputs } from '../audit/inputs'
import { mineSearchTerms, defaultHarvestSettings, type HarvestCandidate, type NegateCandidate, type HarvestSettings } from '../utils/harvest'
import { downloadHarvestSheet } from '../utils/harvestExport'
import { currency, currencyWhole, multiplier, num } from '../lib/format'
import type { ChangeLogEntry, Currency } from '../types'

interface Decision { denied?: boolean; bid?: number; note?: string }

export function HarvestNegate() {
  const { currentClient, currentBundle, addChangeLogEntries } = useStore()
  const [settings, setSettings] = useState<HarvestSettings>(() => defaultHarvestSettings(currentBundle?.goals.targetRoas ?? 4))
  const [brandText, setBrandText] = useState('')
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [exported, setExported] = useState<{ uploadRows: number; needsCampaign: number } | null>(null)

  const inputs = useMemo(() => (currentBundle ? buildAuditInputs(currentBundle) : null), [currentBundle])

  const effSettings: HarvestSettings = useMemo(
    () => ({ ...settings, brandTerms: brandText.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) }),
    [settings, brandText],
  )
  const result = useMemo(
    () => (inputs?.searchTerms ? mineSearchTerms(inputs.searchTerms, inputs.bulkStructure, effSettings) : null),
    [inputs, effSettings],
  )

  if (!currentClient || !currentBundle) return <EmptyState title="No client selected" />
  const client = currentClient
  const ccy = client.currency as Currency

  const setDec = (key: string, patch: Decision) => setDecisions(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }))
  const hKey = (h: HarvestCandidate) => `h:${h.term}`
  const nKey = (n: NegateCandidate) => `n:${n.term}:${n.campaignName}:${n.adGroupName}`

  const approvedHarvests = (result?.harvests ?? []).filter(h => !decisions[hKey(h)]?.denied)
  const approvedNegatives = (result?.negatives ?? []).filter(n => !decisions[nKey(n)]?.denied)

  function exportAll() {
    if (!result) return
    const slug = client.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'client'
    const stamp = new Date().toISOString().slice(0, 10)
    const summary = downloadHarvestSheet({
      harvests: approvedHarvests.map(h => ({ candidate: h, bid: decisions[hKey(h)]?.bid ?? h.suggestedBid })),
      negatives: approvedNegatives,
    }, `${slug}-harvest-negate-${stamp}.xlsx`)

    const batchId = cryptoRandomId()
    const now = new Date().toISOString()
    const log: ChangeLogEntry[] = [
      ...approvedHarvests.map((h): ChangeLogEntry => ({
        id: cryptoRandomId(), date: now, marketplace: client.marketplace,
        entityKind: h.isAsin ? 'target' : 'keyword',
        campaignId: h.home?.campaignId ?? '', text: h.term, matchType: 'exact',
        action: 'harvest', fromBid: 0, toBid: decisions[hKey(h)]?.bid ?? h.suggestedBid,
        note: decisions[hKey(h)]?.note, batchId,
      })),
      ...approvedNegatives.map((n): ChangeLogEntry => ({
        id: cryptoRandomId(), date: now, marketplace: client.marketplace,
        entityKind: n.isAsin ? 'target' : 'keyword',
        campaignId: n.campaignId ?? '', text: n.term, matchType: 'negativeExact',
        action: 'negative', fromBid: 0, toBid: null,
        note: decisions[nKey(n)]?.note, batchId,
      })),
    ]
    addChangeLogEntries(log)
    setExported(summary)
  }

  const hasReport = !!inputs?.searchTerms?.length

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs text-ink-faint flex items-center gap-1.5"><Sprout className="w-3.5 h-3.5" /> Harvest &amp; negate · Evolved §6.14 search-term mining</div>
          <h1 className="text-xl font-semibold text-ink mt-0.5">{client.name}</h1>
          <p className="text-sm text-ink-mute mt-1">Graduate proven search terms to exact match (and negate the seed in every source), and cut zero-order spend with negative exacts.</p>
        </div>
        {hasReport && result && (
          <Button variant="primary" icon={<Download className="w-3.5 h-3.5" />} disabled={approvedHarvests.length + approvedNegatives.length === 0} onClick={exportAll}>
            Export {approvedHarvests.length + approvedNegatives.length} approved
          </Button>
        )}
      </header>

      {!hasReport ? (
        <Panel>
          <EmptyState
            title="Upload the SP Search Term report first"
            description="Go to Upload Reports → PPC Audit reports and add the Sponsored Products Search Term report (last 30–60 days). Add the Bulk Operations export too for an upload-ready file with campaign IDs."
            action={<Button variant="secondary" icon={<Upload className="w-3.5 h-3.5" />} onClick={() => { location.hash = '/upload' }}>Go to Upload Reports</Button>}
          />
        </Panel>
      ) : result && (
        <>
          {/* Settings */}
          <Panel>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-ink">Rules &amp; thresholds</span>
              <span className="text-2xs text-ink-faint">Evolved PPC methodology · §2.6 / §6.14 — override any value</span>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 items-end">
              <NumberField label="Target ROAS" value={settings.targetRoas} onChange={v => setSettings(s => ({ ...s, targetRoas: v }))} step="0.1" suffix="×" />
              <NumberField label="Orders to harvest ≥" value={settings.minOrdersToHarvest} onChange={v => setSettings(s => ({ ...s, minOrdersToHarvest: v }))} step="1" />
              <NumberField label="Harvest ROAS floor" value={settings.harvestRoasFloor} onChange={v => setSettings(s => ({ ...s, harvestRoasFloor: v }))} step="0.1" suffix="×" />
              <NumberField label="Negate: clicks >" value={settings.minClicksToNegate} onChange={v => setSettings(s => ({ ...s, minClicksToNegate: v }))} step="1" />
              <NumberField label="Negate: spend >" value={settings.minSpendToNegate} onChange={v => setSettings(s => ({ ...s, minSpendToNegate: v }))} step="1" prefix="$" />
              <NumberField label="Min CPC" value={settings.minCpc} onChange={v => setSettings(s => ({ ...s, minCpc: v }))} step="0.05" prefix="$" />
              <NumberField label="Max CPC" value={settings.maxCpc} onChange={v => setSettings(s => ({ ...s, maxCpc: v }))} step="0.25" prefix="$" />
              <label className="block">
                <span className="block text-xs font-medium text-ink-mute mb-1.5">Brand terms (never negated)</span>
                <input value={brandText} onChange={e => setBrandText(e.target.value)} placeholder="red land, rlc" className="w-full rounded-lg border border-line bg-canvas-panel text-sm text-ink px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ink/15" />
              </label>
            </div>
            {!result.hasIds && (
              <p className="text-2xs text-[#8b6a18] mt-2.5">No Bulk Operations export uploaded — rows export with names only (not upload-ready) and existing exacts can't be deduped. Upload it under Upload Reports for a ready-to-upload file.</p>
            )}
          </Panel>

          {/* Summary */}
          <div className="flex items-center justify-between flex-wrap gap-3 rounded-xl2 border border-line bg-canvas-panel px-4 py-3">
            <div className="text-sm text-ink-mute">
              <span className="font-medium text-[#1f7a4a]">{result.harvests.length} to harvest</span><span className="mx-1.5 text-ink-faint">·</span>
              <span className="font-medium text-[#9c4651]">{result.negatives.length} to negate</span><span className="mx-1.5 text-ink-faint">·</span>
              <span>{currencyWhole(result.wastedSpend, ccy)} wasted spend flagged</span><span className="mx-1.5 text-ink-faint">·</span>
              <span className="text-ink-faint">{num(result.termsScanned)} terms scanned</span>
            </div>
            {exported && (
              <span className="text-2xs text-[#1f7a4a] inline-flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> Exported — {exported.uploadRows} upload rows{exported.needsCampaign > 0 ? `, ${exported.needsCampaign} need a new campaign (see the second sheet)` : ''}
              </span>
            )}
          </div>

          {/* Harvests */}
          {result.harvests.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-ink-faint pt-1">Graduate to exact — winners found by discovery</div>
              {result.harvests.map(h => (
                <HarvestRow key={hKey(h)} h={h} dec={decisions[hKey(h)]} ccy={ccy}
                  onDeny={() => setDec(hKey(h), { denied: !decisions[hKey(h)]?.denied })}
                  onBid={v => setDec(hKey(h), { bid: v })}
                  onNote={v => setDec(hKey(h), { note: v })} />
              ))}
            </div>
          )}

          {/* Negatives */}
          {result.negatives.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-ink-faint pt-1">Negate — zero-order spend</div>
              {result.negatives.map(n => (
                <NegateRow key={nKey(n)} n={n} dec={decisions[nKey(n)]} ccy={ccy}
                  onDeny={() => setDec(nKey(n), { denied: !decisions[nKey(n)]?.denied })}
                  onNote={v => setDec(nKey(n), { note: v })} />
              ))}
            </div>
          )}

          {result.harvests.length === 0 && result.negatives.length === 0 && (
            <Panel><EmptyState title="Nothing to mine right now" description="No search terms cleared the harvest or negate thresholds. Loosen the rules above, or come back with more data." /></Panel>
          )}
        </>
      )}
    </div>
  )
}

function HarvestRow({ h, dec, ccy, onDeny, onBid, onNote }: {
  h: HarvestCandidate; dec?: Decision; ccy: Currency
  onDeny: () => void; onBid: (v: number) => void; onNote: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const denied = dec?.denied
  return (
    <Panel padding="p-4" className={cx(denied && 'opacity-60')}>
      <div className="flex items-start gap-3.5">
        <span className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center bg-accent-mintSoft text-[#1f7a4a]"><Sprout className="w-4 h-4" /></span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cx('text-sm font-semibold text-ink', denied && 'line-through')}>{h.term}</span>
            {h.isAsin && <span className="text-2xs px-1.5 py-0.5 rounded-full bg-[#f1f2f5] text-ink-mute">ASIN</span>}
            {h.isBrand && <span className="text-2xs px-1.5 py-0.5 rounded-full bg-accent-periSoft text-[#3b48a5]">brand</span>}
            <span className="text-2xs text-ink-faint tnum">{h.orders} orders · {multiplier(h.roas)} · {currency(h.spend, ccy)} → {currency(h.sales, ccy)}</span>
          </div>
          <p className="text-xs text-ink-mute mt-1">{h.reason}</p>
          <p className="text-2xs mt-1">
            {h.home
              ? <span className="text-ink-faint">→ lands in <span className="text-ink-mute font-medium">{h.home.campaignName} / {h.home.adGroupName}</span>{h.home.campaignId ? '' : ' (no IDs — names only)'}; seed negated in {h.sources.length} source{h.sources.length === 1 ? '' : 's'}</span>
              : <span className="text-[#8b6a18]">→ no exact home found — exports to the "Needs new campaign" sheet for the Campaign Builder</span>}
          </p>
          <button onClick={() => setOpen(o => !o)} className="mt-1.5 inline-flex items-center gap-1 text-2xs text-ink-faint hover:text-ink">
            {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />} {h.sources.length} source{h.sources.length === 1 ? '' : 's'}
          </button>
          {open && (
            <div className="mt-1.5 space-y-1">
              {h.sources.map((s, i) => (
                <div key={i} className="text-2xs text-ink-mute tnum">
                  {s.campaignName} / {s.adGroupName} <span className="text-ink-faint">({s.matchType} · {s.targeting})</span> — {s.orders} orders, {currency(s.spend, ccy)}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="shrink-0 w-24">
          <NumberField label="Exact bid" value={dec?.bid ?? h.suggestedBid} onChange={onBid} step="0.05" prefix="$" />
        </div>
      </div>
      <div className="mt-3 flex items-start gap-2">
        <button onClick={onDeny}
          className={cx('shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors',
            denied ? 'bg-accent-blushSoft text-[#9c4651] border-[#9c4651]/30' : 'border-line text-ink-mute hover:text-ink hover:bg-[#f4f5f8]')}>
          {denied ? <><X className="w-3.5 h-3.5" /> Excluded</> : <><Check className="w-3.5 h-3.5" /> Included</>}
        </button>
        <textarea defaultValue={dec?.note ?? ''} onBlur={e => onNote(e.target.value)} rows={1}
          placeholder="Add a note"
          className="flex-1 min-w-0 resize-y rounded-lg border border-line bg-canvas-panel text-xs text-ink px-2.5 py-1.5 leading-relaxed focus:outline-none focus:ring-2 focus:ring-ink/15" />
      </div>
    </Panel>
  )
}

function NegateRow({ n, dec, ccy, onDeny, onNote }: {
  n: NegateCandidate; dec?: Decision; ccy: Currency
  onDeny: () => void; onNote: (v: string) => void
}) {
  const denied = dec?.denied
  return (
    <Panel padding="p-4" className={cx(denied && 'opacity-60')}>
      <div className="flex items-start gap-3.5">
        <span className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center bg-accent-blushSoft text-[#9c4651]"><Ban className="w-4 h-4" /></span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cx('text-sm font-semibold text-ink', denied && 'line-through')}>{n.term}</span>
            {n.isAsin && <span className="text-2xs px-1.5 py-0.5 rounded-full bg-[#f1f2f5] text-ink-mute">ASIN</span>}
            <span className="text-2xs text-ink-faint tnum">{n.reason}</span>
          </div>
          <p className="text-2xs text-ink-faint mt-1">negative exact in <span className="text-ink-mute font-medium">{n.campaignName} / {n.adGroupName}</span>{n.campaignId ? '' : ' (no IDs — names only)'} <span className="text-ink-faint">(matched via {n.matchType} · {n.targeting})</span></p>
        </div>
        <div className="flex items-start gap-2 shrink-0">
          <button onClick={onDeny}
            className={cx('inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors',
              denied ? 'bg-accent-blushSoft text-[#9c4651] border-[#9c4651]/30' : 'border-line text-ink-mute hover:text-ink hover:bg-[#f4f5f8]')}>
            {denied ? <><X className="w-3.5 h-3.5" /> Excluded</> : <><Check className="w-3.5 h-3.5" /> Included</>}
          </button>
        </div>
      </div>
      <div className="mt-2.5">
        <textarea defaultValue={dec?.note ?? ''} onBlur={e => onNote(e.target.value)} rows={1}
          placeholder="Add a note"
          className="w-full resize-y rounded-lg border border-line bg-canvas-panel text-xs text-ink px-2.5 py-1.5 leading-relaxed focus:outline-none focus:ring-2 focus:ring-ink/15" />
      </div>
    </Panel>
  )
}
