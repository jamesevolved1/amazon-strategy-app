// Campaign Builder — Evolved PART 3. Top half: structure gap analysis grading
// the account against the four canonical categories with build/rebuild/retire
// cards. Bottom half: the archetype builder — pick an archetype, seed it, and
// download an upload-ready bulk CREATE file using the naming framework.

import React, { useMemo, useState } from 'react'
import { Hammer, Download, AlertTriangle, Layers, Wrench, Ban, Plus } from 'lucide-react'
import { Panel, EmptyState, Button, NumberField, cx } from '../components/ui'
import { useStore } from '../lib/store'
import { buildAuditInputs } from '../audit/inputs'
import { buildStructureReport, CATEGORY_INFO, type StructureCategory, type CardKind } from '../utils/structure'
import { ARCHETYPES, buildCampaignRows, campaignName, downloadBuildSheet, type ArchetypeId, type BuildSpec } from '../utils/campaignBuilder'
import { currencyWhole, multiplier, percent } from '../lib/format'
import type { Currency } from '../types'

const CARD_META: Record<CardKind, { icon: React.ReactNode; chip: string }> = {
  retire:  { icon: <Ban className="w-4 h-4" />,    chip: 'bg-accent-blushSoft text-[#9c4651]' },
  rebuild: { icon: <Wrench className="w-4 h-4" />, chip: 'bg-accent-goldSoft text-[#8b6a18]' },
  build:   { icon: <Plus className="w-4 h-4" />,   chip: 'bg-accent-mintSoft text-[#1f7a4a]' },
}

const CAT_DOT: Record<StructureCategory, string> = {
  performance: 'bg-[#1f7a4a]', shielding: 'bg-[#3b48a5]', research: 'bg-[#c79a2e]', ranking: 'bg-[#6b4a8a]', unknown: 'bg-ink-faint',
}

export function CampaignBuilder() {
  const { currentClient, currentBundle } = useStore()
  const [brandText, setBrandText] = useState('')

  const inputs = useMemo(() => (currentBundle ? buildAuditInputs(currentBundle) : null), [currentBundle])
  const brandTerms = useMemo(() => brandText.split(',').map(s => s.trim().toLowerCase()).filter(Boolean), [brandText])
  const report = useMemo(
    () => (inputs?.bulkStructure && currentBundle ? buildStructureReport(inputs.bulkStructure, inputs.campaigns, currentBundle.goals, brandTerms) : null),
    [inputs, currentBundle?.goals, brandTerms],
  )
  const structureSkus = useMemo(() => {
    const set = new Set<string>()
    for (const r of inputs?.bulkStructure ?? []) if (r.entity === 'Product Ad' && (r.sku || r.asin)) set.add(r.sku || r.asin!)
    return [...set]
  }, [inputs])

  if (!currentClient || !currentBundle) return <EmptyState title="No client selected" />
  const ccy = currentClient.currency as Currency

  return (
    <div className="space-y-5">
      <header>
        <div className="text-xs text-ink-faint flex items-center gap-1.5"><Hammer className="w-3.5 h-3.5" /> Campaign builder · Evolved PART 3 archetypes</div>
        <h1 className="text-xl font-semibold text-ink mt-0.5">{currentClient.name}</h1>
        <p className="text-sm text-ink-mute mt-1">Grade the account against the four canonical categories, then build what's missing — upload-ready bulk files with the naming framework baked in.</p>
      </header>

      {/* ---- Gap analysis ---- */}
      {!report ? (
        <Panel>
          <EmptyState
            title="Upload the Bulk Operations export for the gap analysis"
            description="The structure grade (Performance / Shielding / Research / Ranking, plus build-rebuild-retire calls) reads your Bulk Operations export. You can still build new campaigns below without it."
          />
        </Panel>
      ) : (
        <>
          <Panel>
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <span className="text-xs font-semibold text-ink flex items-center gap-1.5"><Layers className="w-3.5 h-3.5 text-ink-faint" /> Category mix — {report.classifiedCampaigns} campaigns, {currencyWhole(report.totalSpend, ccy)} spend</span>
              <label className="flex items-center gap-2">
                <span className="text-2xs text-ink-faint">Brand terms:</span>
                <input value={brandText} onChange={e => setBrandText(e.target.value)} placeholder="red land, rlc"
                  className="w-44 rounded-lg border border-line bg-canvas-panel text-xs text-ink px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-ink/15" />
              </label>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {report.categories.filter(c => c.category !== 'unknown').map(c => (
                <div key={c.category} className="rounded-xl border border-line px-3.5 py-3">
                  <div className="text-2xs font-medium text-ink-faint uppercase tracking-wide flex items-center gap-1.5">
                    <span className={cx('w-1.5 h-1.5 rounded-full', CAT_DOT[c.category])} />{CATEGORY_INFO[c.category].label}
                  </div>
                  <div className="text-lg font-semibold text-ink mt-1 tnum">{c.campaigns === 0 ? '—' : `${c.campaigns} · ${percent(c.spendShare, 0)}`}</div>
                  <div className="text-2xs text-ink-mute mt-0.5 tnum">{c.campaigns === 0 ? 'not running' : `${currencyWhole(c.spend, ccy)} at ${multiplier(c.roas)}`}</div>
                </div>
              ))}
            </div>
            {brandTerms.length === 0 && <p className="text-2xs text-ink-faint mt-2.5">Tip: set brand terms above so brand-defense campaigns classify as Shielding instead of Performance.</p>}
          </Panel>

          {report.cards.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-ink-faint pt-1">Build · rebuild · retire</div>
              {report.cards.map((c, i) => (
                <Panel key={i} padding="p-4">
                  <div className="flex items-start gap-3.5">
                    <span className={cx('shrink-0 w-9 h-9 rounded-lg flex items-center justify-center', CARD_META[c.kind].chip)}>{CARD_META[c.kind].icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-ink">{c.title}</span>
                        <span className="text-2xs px-1.5 py-0.5 rounded-full bg-[#f1f2f5] text-ink-mute">{CATEGORY_INFO[c.category].label}</span>
                      </div>
                      <p className="text-sm text-ink-mute mt-1 leading-relaxed">{c.detail}</p>
                    </div>
                    {c.impact > 0 && <span className={cx('shrink-0 text-2xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap', CARD_META[c.kind].chip)}>{currencyWhole(c.impact, ccy)} at stake</span>}
                  </div>
                </Panel>
              ))}
            </div>
          )}
        </>
      )}

      {/* ---- Builder ---- */}
      <BuilderForm structureSkus={structureSkus} clientName={currentClient.name} />
    </div>
  )
}

function BuilderForm({ structureSkus, clientName }: { structureSkus: string[]; clientName: string }) {
  const [archetype, setArchetype] = useState<ArchetypeId>('exact_performance')
  const [brandPrefix, setBrandPrefix] = useState(() => clientName.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 4))
  const [detail, setDetail] = useState('')
  const [skuText, setSkuText] = useState(() => structureSkus.slice(0, 3).join(', '))
  const [dailyBudget, setDailyBudget] = useState(20)
  const [defaultBid, setDefaultBid] = useState(0.75)
  const [kwText, setKwText] = useState('')
  const [done, setDone] = useState<string[] | null>(null)

  const a = ARCHETYPES.find(x => x.id === archetype)!
  const spec: BuildSpec = useMemo(() => ({
    archetype, brandPrefix, detail,
    skus: skuText.split(/[\n,]+/).map(s => s.trim()).filter(Boolean),
    dailyBudget, defaultBid,
    keywords: kwText.split(/\n+/).map(line => {
      const m = line.trim().match(/^(.*?)(?:[,\t]\s*\$?(\d+(?:\.\d+)?))?$/)
      return m && m[1] ? { text: m[1].trim(), bid: m[2] ? parseFloat(m[2]) : 0 } : null
    }).filter((k): k is { text: string; bid: number } => !!k && !!k.text),
  }), [archetype, brandPrefix, detail, skuText, dailyBudget, defaultBid, kwText])

  const preview = useMemo(() => buildCampaignRows(spec, stamp()), [spec])
  const canBuild = spec.skus.length > 0 && (!a.keywordsRequired || spec.keywords.length > 0) && brandPrefix.trim() && detail.trim()

  function build() {
    const slug = clientName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'client'
    downloadBuildSheet([preview], `${slug}-new-campaigns-${new Date().toISOString().slice(0, 10)}.xlsx`)
    setDone(preview.campaigns)
  }

  return (
    <Panel>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-ink">Build a new campaign</span>
        <span className="text-2xs text-ink-faint">naming: {'{Brand} | {Category} | {Type} | {Detail}'}</span>
      </div>

      {/* Archetype picker */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 mb-4">
        {ARCHETYPES.map(x => (
          <button key={x.id} onClick={() => { setArchetype(x.id); setDone(null) }}
            className={cx('text-left rounded-xl border px-3.5 py-3 transition-colors',
              archetype === x.id ? 'border-ink/40 bg-[#f4f5f8] ring-1 ring-ink/20' : 'border-line hover:bg-[#f7f8fa]')}>
            <div className="text-sm font-medium text-ink">{x.label}</div>
            <div className="text-2xs text-ink-mute mt-0.5 leading-relaxed">{x.description}</div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 items-end">
        <label className="block">
          <span className="block text-xs font-medium text-ink-mute mb-1.5">Brand prefix</span>
          <input value={brandPrefix} onChange={e => setBrandPrefix(e.target.value)} placeholder="RLC"
            className="w-full rounded-lg border border-line bg-canvas-panel text-sm text-ink px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ink/15" />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-ink-mute mb-1.5">Detail (product line)</span>
          <input value={detail} onChange={e => setDetail(e.target.value)} placeholder="Sheets"
            className="w-full rounded-lg border border-line bg-canvas-panel text-sm text-ink px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ink/15" />
        </label>
        <NumberField label="Daily budget" value={dailyBudget} onChange={setDailyBudget} step="5" prefix="$" />
        <NumberField label="Default bid" value={defaultBid} onChange={setDefaultBid} step="0.05" prefix="$" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
        <label className="block">
          <span className="block text-xs font-medium text-ink-mute mb-1.5">SKUs (comma or line separated)</span>
          <textarea value={skuText} onChange={e => setSkuText(e.target.value)} rows={3} placeholder="SHEET-Q-WHT, SHEET-K-WHT"
            className="w-full resize-y rounded-lg border border-line bg-canvas-panel text-sm text-ink px-3 py-2 leading-relaxed focus:outline-none focus:ring-2 focus:ring-ink/15" />
          {structureSkus.length > 0 && <span className="block text-2xs text-ink-faint mt-1">{structureSkus.length} SKUs found in the bulk export — prefilled the first few.</span>}
        </label>
        {a.id !== 'auto_research' && (
          <label className="block">
            <span className="block text-xs font-medium text-ink-mute mb-1.5">
              {a.isProductTargeting ? 'ASINs to target (one per line, optional ", bid")' : 'Keywords (one per line, optional ", bid")'}
            </span>
            <textarea value={kwText} onChange={e => setKwText(e.target.value)} rows={3}
              placeholder={a.isProductTargeting ? 'B0ABC12345, 0.90' : 'percale cotton sheets queen, 1.43\norganic cotton sheets'}
              className="w-full resize-y rounded-lg border border-line bg-canvas-panel text-sm text-ink px-3 py-2 leading-relaxed focus:outline-none focus:ring-2 focus:ring-ink/15" />
            <span className="block text-2xs text-ink-faint mt-1">Tip: paste terms from the Harvest &amp; Negate "Needs new campaign" sheet. Lines without a bid use the default bid.</span>
          </label>
        )}
      </div>

      {preview.warnings.length > 0 && (
        <div className="mt-3 rounded-xl2 border border-accent-gold/30 bg-accent-goldSoft/40 px-4 py-2.5 space-y-0.5">
          {preview.warnings.map((w, i) => (
            <p key={i} className="text-2xs text-[#8b6a18] flex items-center gap-1.5"><AlertTriangle className="w-3 h-3 shrink-0" /> {w}</p>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between flex-wrap gap-3 border-t border-line pt-3.5">
        <div className="text-sm text-ink-mute min-w-0">
          <span className="text-2xs text-ink-faint block">Creates</span>
          <span className="font-medium text-ink truncate block">
            {archetype === 'ranking_skw' && spec.keywords.length > 1
              ? `${spec.keywords.length} campaigns — ${campaignName(spec)} | {keyword}`
              : campaignName(spec) || '—'}
          </span>
          <span className="text-2xs text-ink-faint">{preview.rows.length} bulk rows · {spec.skus.length} SKU{spec.skus.length === 1 ? '' : 's'}{a.id !== 'auto_research' ? ` · ${spec.keywords.length} ${a.isProductTargeting ? 'ASIN' : 'keyword'}${spec.keywords.length === 1 ? '' : 's'}` : ''}</span>
        </div>
        <div className="flex items-center gap-2">
          {done && <span className="text-2xs text-[#1f7a4a]">Downloaded — {done.length} campaign{done.length === 1 ? '' : 's'}</span>}
          <Button variant="primary" icon={<Download className="w-3.5 h-3.5" />} disabled={!canBuild} onClick={build}>
            Download bulk file
          </Button>
        </div>
      </div>
    </Panel>
  )
}

function stamp(): string {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}
