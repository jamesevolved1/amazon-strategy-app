import React, { useRef, useState } from 'react'
import { Check, FileSpreadsheet, Upload, AlertTriangle, Trash2 } from 'lucide-react'
import { Panel, Pill, Button, EmptyState, cx, Spinner } from '../components/ui'
import { useStore } from '../lib/store'
import { relativeTime } from '../lib/format'
import {
  parseAdvertisedProduct, parseBulkCampaigns, parseBulkStructure, parseBusinessReport, parseCogsMapping,
  parseFeePreview, parseMasterProfit, parseOptimizationSchedule, parsePlacement, parseRestock,
  parseSearchTerm, parseStorageFee, parseStrategyDoc, parseTargeting,
  type ParseResult,
} from '../utils/parsers'
import type { ReportKey } from '../types'

interface ReportTile {
  key: ReportKey
  title: string
  blurb: string
  parser: (file: File) => Promise<ParseResult<unknown>>
  required: boolean
}

const TILES: ReportTile[] = [
  { key: 'masterProfit',         title: 'Master Profit Matrix',    blurb: 'Sales, units, fees, COGS, ad spend per SKU.', parser: parseMasterProfit, required: true },
  { key: 'bulkCampaigns',        title: 'Bulk Campaign Export',     blurb: 'SP / SB / SD tabs with campaign performance.', parser: parseBulkCampaigns, required: true },
  { key: 'businessReport',       title: 'Business Report',          blurb: 'Daily or SKU sessions, page views, sales.', parser: parseBusinessReport, required: false },
  { key: 'advertisedProduct',    title: 'Advertised Product Report', blurb: 'Ad spend & sales rolled up by ASIN.', parser: parseAdvertisedProduct, required: false },
  { key: 'feePreview',           title: 'Fee Preview Report',       blurb: 'Per-unit referral and FBA fee estimates.', parser: parseFeePreview, required: false },
  { key: 'storageFee',           title: 'Monthly Storage Fee',      blurb: 'Per-ASIN monthly storage cost.', parser: parseStorageFee, required: false },
  { key: 'cogsMapping',          title: 'COGS Mapping',             blurb: 'SKU → unit cost. Used when Master Profit lacks COGS.', parser: parseCogsMapping, required: false },
  { key: 'strategyDoc',          title: 'Client Strategy Doc · Report tab', blurb: 'Daily totals feeding the Performance Review scorecard.', parser: parseStrategyDoc, required: false },
  { key: 'optimizationSchedule', title: 'Optimization Schedule CSV', blurb: 'Scheduled tasks to import into the Optimization Calendar.', parser: parseOptimizationSchedule, required: false },
]

// PPC Audit intake-gate sources — required tiers are enforced by the audit
// gate itself (see src/audit/gate.ts), not by this page's required counter.
const AUDIT_TILES: ReportTile[] = [
  { key: 'searchTerm',    title: 'SP Search Term Report',      blurb: 'Customer search terms — feeds harvest & negative mining.', parser: parseSearchTerm, required: false },
  { key: 'targeting',     title: 'SP Targeting Report',        blurb: 'Keyword/PT performance — feeds bid rules.', parser: parseTargeting, required: false },
  { key: 'placement',     title: 'SP Placement Report',        blurb: 'Top of Search / Rest of Search / Product Pages splits.', parser: parsePlacement, required: false },
  { key: 'bulkStructure', title: 'Bulk Operations Export',     blurb: 'Full SP structure: entities, bids, match types, negatives, IDs.', parser: parseBulkStructure, required: false },
  { key: 'restock',       title: 'Restock Recommendations',    blurb: 'Inventory position — gates aggressive scale recommendations.', parser: parseRestock, required: false },
]

export function UploadReports() {
  const { currentClient, currentBundle, setReport, clearReport, clearAllReports, addTask } = useStore()
  const [busyKey, setBusyKey] = useState<ReportKey | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)

  if (!currentClient || !currentBundle) return <EmptyState title="No client selected" description="Add a client before uploading reports." />

  const required = TILES.filter(t => t.required)
  const presentRequired = required.filter(t => currentBundle.reports[t.key]).length

  const upload = async (tile: ReportTile, file: File) => {
    setBusyKey(tile.key); setLastError(null)
    try {
      const result = await tile.parser(file)
      setReport(tile.key, {
        key: tile.key,
        name: tile.title,
        uploadedAt: new Date().toISOString(),
        fileName: file.name,
        parsed: result.data,
        rowCount: result.rowCount,
        warnings: result.warnings,
      })
      // If this is an optimization schedule, import as tasks.
      if (tile.key === 'optimizationSchedule') {
        const data = result.data as { tasks?: Array<{ title: string; detail?: string; due: string; category?: string }> }
        for (const t of (data.tasks ?? [])) {
          addTask({ title: t.title, detail: t.detail, due: t.due, category: t.category, completed: false })
        }
      }
    } catch (e: unknown) {
      setLastError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-ink">Upload reports</h1>
          <p className="text-sm text-ink-mute mt-0.5">
            Master workbook and bulk campaign export upload separately. {presentRequired === required.length
              ? 'All required sources present.'
              : `${presentRequired}/${required.length} required sources present.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Pill tone={presentRequired === required.length ? 'mint' : 'gold'}>
            {presentRequired}/{required.length} required
          </Pill>
          <Button variant="ghost" icon={<Trash2 className="w-4 h-4" />} onClick={() => { if (confirm('Clear all uploaded reports for this client?')) clearAllReports() }}>
            Clear all
          </Button>
        </div>
      </header>

      {lastError && (
        <div className="rounded-lg bg-accent-blushSoft border border-accent-blush/30 px-4 py-2.5 text-sm text-[#9c4651] flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {lastError}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {TILES.map(tile => {
          const r = currentBundle.reports[tile.key]
          return (
            <Tile
              key={tile.key}
              tile={tile}
              report={r}
              busy={busyKey === tile.key}
              onUpload={(f) => upload(tile, f)}
              onClear={() => clearReport(tile.key)}
            />
          )
        })}
      </div>

      <header className="pt-2">
        <h2 className="text-base font-semibold text-ink">PPC Audit reports</h2>
        <p className="text-xs text-ink-mute mt-0.5">
          Sources for the deep-dive intake gate. The <a className="text-[#3b48a5] hover:underline" href="#/audit">PPC Audit page</a> shows
          exactly what's still missing and what each report unlocks.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {AUDIT_TILES.map(tile => {
          const r = currentBundle.reports[tile.key]
          return (
            <Tile
              key={tile.key}
              tile={tile}
              report={r}
              busy={busyKey === tile.key}
              onUpload={(f) => upload(tile, f)}
              onClear={() => clearReport(tile.key)}
            />
          )
        })}
      </div>
    </div>
  )
}

function Tile({ tile, report, busy, onUpload, onClear }: {
  tile: ReportTile
  report?: import('../types').UploadedReport
  busy: boolean
  onUpload: (f: File) => void
  onClear: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  return (
    <Panel padding="p-0" className="overflow-hidden">
      <div
        onDragOver={e => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => {
          e.preventDefault(); setDrag(false)
          const f = e.dataTransfer.files?.[0]
          if (f) onUpload(f)
        }}
        className={cx('p-4 transition-colors', drag && 'bg-accent-periSoft/30')}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-accent-periSoft text-[#3b48a5] flex items-center justify-center">
              <FileSpreadsheet className="w-4 h-4" />
            </span>
            <div>
              <div className="text-sm font-semibold text-ink leading-tight">{tile.title}</div>
              <div className="text-2xs text-ink-faint mt-0.5">{tile.blurb}</div>
            </div>
          </div>
          {tile.required && <Pill tone={report ? 'mint' : 'gold'}>{report ? 'Loaded' : 'Required'}</Pill>}
        </div>

        <div className="mt-4">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv,.xlsm,.xlsb"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); if (inputRef.current) inputRef.current.value = '' }}
          />
          {busy ? (
            <div className="flex items-center gap-2 text-sm text-ink-mute"><Spinner /> Parsing…</div>
          ) : report ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Check className="w-4 h-4 text-[#1f7a4a]" />
                <span className="truncate text-ink">{report.fileName}</span>
              </div>
              <div className="flex items-center gap-3 text-2xs text-ink-faint">
                <span>{report.rowCount ?? 0} rows</span>
                <span>· {relativeTime(report.uploadedAt)}</span>
              </div>
              {(report.warnings && report.warnings.length > 0) && (
                <div className="mt-1 text-2xs text-[#8b6a18] bg-accent-goldSoft/50 rounded-md px-2 py-1.5">
                  {report.warnings.join(' · ')}
                </div>
              )}
              <div className="flex items-center gap-2 pt-1">
                <Button variant="secondary" onClick={() => inputRef.current?.click()} icon={<Upload className="w-3.5 h-3.5" />}>Replace</Button>
                <Button variant="ghost" onClick={onClear}>Remove</Button>
              </div>
            </div>
          ) : (
            <Button variant="secondary" onClick={() => inputRef.current?.click()} icon={<Upload className="w-3.5 h-3.5" />} className="w-full justify-center">
              Choose file
            </Button>
          )}
        </div>
      </div>
    </Panel>
  )
}
