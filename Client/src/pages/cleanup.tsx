import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { PageHeader } from '../components/PageHeader'
import { PAGE_CLASS } from '../lib/pageChrome'
import Segmented from '../components/Segmented'
import { DataGrid } from '../components/table/DataGrid'
import type { Column } from '../components/table/DataGrid'
import { RowMenu } from '../components/table/RowMenu'
import { RefreshButton } from '../components/table/TableToolbar'
import { Modal } from '../components/Modal'
import { Field } from '../components/form/Field'
import { SearchSelect } from '../components/form/SearchSelect'
import { ErrorBanner } from '../components/ErrorBanner'
import { SkeletonRows } from '../components/Skeleton'
import { EmptyState } from '../components/EmptyState'
import { inputCls } from '../lib/formStyles'
import { sameNameKey } from '../lib/names'
import { btn } from '../lib/ui'
import { toast } from '../lib/toast'
import { formatCount } from '../lib/format'
import { useConfirm } from '../lib/useConfirm'
import { RelTime } from '../components/table/RelTime'

type Kind = 'sector' | 'vertical' | 'source' | 'service-type'
type Item = { id: string; name: string; leads: number; trackerRows: number }
type Listing = { items: Item[]; suggestions: string[][]; sheetNames: string[] }
type Change = { id: string; action: 'rename' | 'merge'; summary: string; leadsMoved: number; trackerRows: number; byName: string; createdAt: string; revertedAt: string | null; revertedByName: string | null }

const KIND_LABEL: Record<Kind, { plural: string; one: string }> = {
  sector: { plural: 'Sectors', one: 'sector' },
  vertical: { plural: 'Verticals', one: 'vertical' },
  source: { plural: 'Sources', one: 'source' },
  'service-type': { plural: 'Service types', one: 'service type' },
}
const plural = (n: number, w: string) => `${formatCount(n)} ${w}${n === 1 ? '' : 's'}`

// Admin: keep the lists leads are classified by clean. Shows what uses each
// value, flags the same name written two ways and names that don't match the
// Tracker sheet, and renames or merges them (server: routes/catalog.ts) —
// leads, Tracker rows and the sector summary all follow.
export default function Cleanup() {
  const [kind, setKind] = useState<Kind>('sector')
  const [data, setData] = useState<Listing | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [token, setToken] = useState(0)
  const [renaming, setRenaming] = useState<Item | null>(null)
  const [merging, setMerging] = useState<Item | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api<Listing>(`/catalog/${kind}`, { auth: true })
      .then(d => { if (!cancelled) { setData(d); setError(null) } })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the list.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [kind, token])
  const reload = () => setToken(t => t + 1)

  const items = data?.items ?? []
  const nameOf = (id: string) => items.find(i => i.id === id)?.name ?? ''
  const twinsOf = (item: Item) => (data?.suggestions.find(g => g.includes(item.id)) ?? []).filter(id => id !== item.id).map(nameOf)
  // The sheet writes this one differently ("Oil and Gas" vs "Oil & Gas").
  const sheetSpelling = (item: Item) => data?.sheetNames.find(n => sameNameKey(n) === sameNameKey(item.name) && n !== item.name)
  const inSheet = (item: Item) => !!data?.sheetNames.some(n => n === item.name)
  const label = KIND_LABEL[kind]
  const issues = items.filter(i => twinsOf(i).length > 0 || sheetSpelling(i)).length

  const columns: Column<Item>[] = [
    {
      id: 'name', header: label.one[0].toUpperCase() + label.one.slice(1), sticky: true, className: 'min-w-[220px]',
      cell: i => {
        const twins = twinsOf(i)
        const sheet = sheetSpelling(i)
        return (
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 dark:text-gray-100">{i.name}</p>
            {twins.length > 0 && <p className="text-[11px] text-amber-600 dark:text-amber-400">Same name as {twins.map(t => `“${t}”`).join(', ')} — merge them</p>}
            {sheet && <p className="text-[11px] text-amber-600 dark:text-amber-400">The Tracker sheet writes it “{sheet}” — rename to match</p>}
          </div>
        )
      },
    },
    { id: 'leads', header: 'Leads', align: 'right', cell: i => formatCount(i.leads) },
    ...(kind === 'sector' || kind === 'vertical'
      ? [{ id: 'tracker', header: 'Tracker rows', align: 'right' as const, cell: (i: Item) => formatCount(i.trackerRows) },
         { id: 'sheet', header: 'In the sheet', cell: (i: Item) => (inSheet(i) ? <span className="text-emerald-600 dark:text-emerald-400">Yes</span> : <span className="text-gray-400">No</span>) }]
      : []),
  ]

  return (
    <div className={PAGE_CLASS}>
      <PageHeader title="Data clean-up" subtitle="Merge duplicates and match the Tracker sheet’s names, so totals add up in one place.">
        <RefreshButton onClick={reload} busy={loading} />
      </PageHeader>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          size="md"
          label="List"
          value={kind}
          onChange={k => { setKind(k); setData(null) }}
          options={(Object.keys(KIND_LABEL) as Kind[]).map(k => ({ value: k, label: KIND_LABEL[k].plural }))}
        />
        {!loading && data && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {issues > 0 ? `${plural(issues, label.one)} to look at` : `No duplicates spotted in ${label.plural.toLowerCase()}`}
          </span>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        {error && <ErrorBanner message={error} onRetry={reload} />}
        {loading && !data ? <SkeletonRows /> : items.length === 0 && !error ? (
          <EmptyState icon="inbox" title={`No ${label.plural.toLowerCase()} yet`} message="They’re created as leads are added." />
        ) : (
          <DataGrid
            columns={columns}
            rows={[...items].sort((a, b) => Number(twinsOf(b).length > 0 || !!sheetSpelling(b)) - Number(twinsOf(a).length > 0 || !!sheetSpelling(a)) || a.name.localeCompare(b.name))}
            getKey={i => i.id}
            actions={i => (
              <RowMenu label={i.name} actions={[
                { label: 'Rename…', onSelect: () => setRenaming(i) },
                items.length > 1 && { label: 'Merge into another…', onSelect: () => setMerging(i) },
              ]} />
            )}
            maxHeight="none"
          />
        )}
      </div>

      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
        Merging moves every lead onto the value you keep and turns the other off (it’s kept for history, not deleted). Renaming a sector also
        renames its Tracker rows, and adds its sector-summary row into the one with the new name — totals don’t change.
      </p>

      <History kind={kind} token={token} onReverted={reload} />

      {renaming && data && (
        <RenameModal kind={kind} item={renaming} suggestions={[...new Set([sheetSpelling(renaming), ...data.sheetNames.filter(n => !items.some(i => i.name === n))].filter((n): n is string => !!n))]}
          onClose={() => setRenaming(null)} onDone={() => { setRenaming(null); reload() }} />
      )}
      {merging && data && (
        <MergeModal kind={kind} item={merging} items={items} preferred={twinsOf(merging)} onClose={() => setMerging(null)} onDone={() => { setMerging(null); reload() }} />
      )}
    </div>
  )
}

function RenameModal({ kind, item, suggestions, onClose, onDone }: { kind: Kind; item: Item; suggestions: string[]; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(item.name)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const one = KIND_LABEL[kind].one

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Enter the new name.'); return }
    setSaving(true)
    setError(null)
    try {
      const r = await api<{ renamed: string; from: string; trackerRows: number }>(`/catalog/${kind}/${item.id}/rename`, { method: 'POST', auth: true, body: { name: name.trim() } })
      toast(`Renamed “${r.from}” to “${r.renamed}”${r.trackerRows ? ` · ${plural(r.trackerRows, 'Tracker row')} updated` : ''}`)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename.')
      setSaving(false)
    }
  }

  return (
    <Modal title={`Rename ${one}`} subtitle={`“${item.name}” · ${plural(item.leads, 'lead')}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="New name" error={error ?? undefined}>
          <input value={name} onChange={e => { setName(e.target.value); setError(null) }} autoFocus aria-invalid={!!error || undefined} className={inputCls(!!error)} />
        </Field>
        {suggestions.length > 0 && (
          <div>
            <p className="mb-1.5 text-[11px] font-medium text-gray-500 dark:text-gray-400">Names the Tracker sheet uses</p>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map(s => (
                <button key={s} type="button" onClick={() => setName(s)} className={`rounded-full border px-2.5 py-1 text-xs ${name === s ? 'border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-500/50 dark:bg-orange-500/10 dark:text-orange-300' : 'border-gray-200 text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:text-gray-300'}`}>{s}</button>
              ))}
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={btn('secondary', 'md')}>Cancel</button>
          <button type="submit" disabled={saving || name.trim() === item.name} className={btn('primary', 'md')}>{saving ? 'Renaming…' : 'Rename'}</button>
        </div>
      </form>
    </Modal>
  )
}

function MergeModal({ kind, item, items, preferred, onClose, onDone }: { kind: Kind; item: Item; items: Item[]; preferred: string[]; onClose: () => void; onDone: () => void }) {
  const others = items.filter(i => i.id !== item.id)
  const [toId, setToId] = useState(() => others.find(o => preferred.includes(o.name))?.id ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const one = KIND_LABEL[kind].one
  const target = others.find(o => o.id === toId)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!toId) { setError(`Choose the ${one} to keep.`); return }
    setSaving(true)
    setError(null)
    try {
      const r = await api<{ kept: string; leadsMoved: number; trackerRows: number }>(`/catalog/${kind}/merge`, { method: 'POST', auth: true, body: { fromIds: [item.id], toId } })
      toast(`Merged “${item.name}” into “${r.kept}” · ${plural(r.leadsMoved, 'lead')} moved${r.trackerRows ? `, ${plural(r.trackerRows, 'Tracker row')} updated` : ''}`)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not merge.')
      setSaving(false)
    }
  }

  return (
    <Modal title={`Merge “${item.name}”`} subtitle={`Move its ${plural(item.leads, 'lead')} onto another ${one}, then turn it off.`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label={`Keep this ${one}`} error={error ?? undefined} required>
          <SearchSelect
            value={toId}
            onChange={v => { setToId(v); setError(null) }}
            options={others.map(o => ({ value: o.id, label: o.name, hint: plural(o.leads, 'lead') }))}
            emptyLabel={`Choose a ${one}…`}
            invalid={!!error}
            label={`${one} to keep`}
          />
        </Field>
        {target && (
          <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-gray-800/60 dark:text-gray-300">
            “{item.name}” ({plural(item.leads, 'lead')}{kind === 'sector' || kind === 'vertical' ? `, ${plural(item.trackerRows, 'Tracker row')}` : ''}) becomes
            “{target.name}”. “{item.name}” is then turned off and no longer offered.
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={btn('secondary', 'md')}>Cancel</button>
          <button type="submit" disabled={saving || !toId} className={btn('primary', 'md')}>{saving ? 'Merging…' : 'Merge'}</button>
        </div>
      </form>
    </Modal>
  )
}

// Every rename and merge made here, newest first, with who did it. The
// newest change still in force can be reverted — the server puts back exactly
// what it changed (list values, leads, Tracker rows, sector summary).
function History({ kind, token, onReverted }: { kind: Kind; token: number; onReverted: () => void }) {
  const [changes, setChanges] = useState<Change[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmDialog, confirm] = useConfirm()

  useEffect(() => {
    let cancelled = false
    api<{ changes: Change[] }>(`/catalog/${kind}/history`, { auth: true })
      .then(d => { if (!cancelled) { setChanges(d.changes); setError(null) } })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the history.') })
    return () => { cancelled = true }
  }, [kind, token])

  const latestLive = changes?.find(c => !c.revertedAt)?.id

  async function revert(c: Change) {
    const ok = await confirm({
      title: 'Revert this change?',
      message: (
        <>
          <p className="font-medium text-gray-800 dark:text-gray-100">{c.summary}</p>
          <p className="mt-2">Everything it changed is put back as it was: the names{c.leadsMoved ? `, the ${plural(c.leadsMoved, 'lead')} it moved` : ''}{c.trackerRows ? ` and the ${plural(c.trackerRows, 'Tracker row')} it updated` : ''}.</p>
        </>
      ),
      confirmLabel: 'Revert',
    })
    if (!ok) return
    setBusyId(c.id)
    try {
      await api(`/catalog/changes/${c.id}/revert`, { method: 'POST', auth: true })
      toast(`Reverted · ${c.summary}`)
      onReverted()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not revert.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="mt-8">
      <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">History</h2>
      <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">Every rename and merge made here. The latest one can be reverted — undo them newest first.</p>
      {error && <ErrorBanner message={error} onRetry={onReverted} className="mb-3" />}
      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        {changes === null ? <SkeletonRows rows={2} compact /> : changes.length === 0 ? (
          <p className="px-5 py-4 text-sm text-gray-500 dark:text-gray-400">No changes made to this list yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {changes.map(c => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${c.revertedAt ? 'text-gray-400 line-through decoration-gray-300 dark:text-gray-500' : 'text-gray-900 dark:text-gray-100'}`}>{c.summary}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {c.byName} · <RelTime ts={c.createdAt} />
                    {c.leadsMoved > 0 && ` · ${plural(c.leadsMoved, 'lead')} moved`}
                    {c.trackerRows > 0 && ` · ${plural(c.trackerRows, 'Tracker row')}`}
                    {c.revertedAt && <> · Reverted by {c.revertedByName ?? 'an admin'} <RelTime ts={c.revertedAt} /></>}
                  </p>
                </div>
                {!c.revertedAt && (
                  c.id === latestLive
                    ? <button type="button" onClick={() => revert(c)} disabled={busyId === c.id} className={btn('secondary', 'sm')}>{busyId === c.id ? 'Reverting…' : 'Revert'}</button>
                    : <span className="text-[11px] text-gray-400">Revert newer changes first</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {confirmDialog}
    </section>
  )
}
