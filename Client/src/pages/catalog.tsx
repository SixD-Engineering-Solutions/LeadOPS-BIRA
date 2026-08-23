import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { Location, Plant, Contact, Vertical, Sector } from '../lib/api'

const inputCls = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'
const btnCls = 'rounded-xl bg-gradient-to-r from-rose-400 to-orange-400 px-5 py-2 text-sm font-semibold text-white transition hover:from-rose-500 hover:to-orange-500 disabled:opacity-60'

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{title}</h3>
      <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
      {children}
    </div>
  )
}

export default function Catalog() {
  const [locations, setLocations] = useState<Location[]>([])
  const [plants, setPlants] = useState<Plant[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [verticals, setVerticals] = useState<Vertical[]>([])
  const [sectors, setSectors] = useState<Sector[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // form states
  const [loc, setLoc] = useState({ city: '', state: '', country: '', address: '' })
  const [plant, setPlant] = useState({ plantName: '', companyName: '', locationId: '', plantCode: '' })
  const [contact, setContact] = useState({ plantId: '', contactPersonName: '', designation: '', contactPersonNumber: '', alternateNumber: '', mailId: '', isPrimaryContact: false })
  const [vert, setVert] = useState({ verticalName: '', description: '' })
  const [sect, setSect] = useState({ sectorName: '', description: '' })

  async function loadAll() {
    setLoading(true)
    try {
      const [l, p, c, v, s] = await Promise.all([
        api<{ locations: Location[] }>('/locations', { auth: true }),
        api<{ plants: Plant[] }>('/plants', { auth: true }),
        api<{ contacts: Contact[] }>('/contacts', { auth: true }),
        api<{ verticals: Vertical[] }>('/verticals', { auth: true }),
        api<{ sectors: Sector[] }>('/sectors', { auth: true }),
      ])
      setLocations(l.locations); setPlants(p.plants); setContacts(c.contacts); setVerticals(v.verticals); setSectors(s.sectors)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data.')
    } finally { setLoading(false) }
  }
  useEffect(() => { loadAll() }, [])

  async function submit(name: string, path: string, body: object, key: string, onOk: (data: unknown) => void, reset: () => void) {
    setBusy(name); setError(null)
    try {
      const data = await api<Record<string, unknown>>(path, { method: 'POST', auth: true, body })
      onOk(data[key]); reset()
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not add ${name}.`)
    } finally { setBusy(null) }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="mb-5">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Setup</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Add the reference data that leads are built from. Everyone can view and add here.</p>
      </div>

      {error && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">{error}</div>}
      {loading && <p className="mb-5 text-sm text-gray-400 dark:text-gray-500">Loading…</p>}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Location */}
        <Section title="Location" subtitle="A city/site. Plants belong to a location.">
          <form onSubmit={e => { e.preventDefault(); if (!loc.city) return; submit('location', '/locations', loc, 'location', d => setLocations(p => [d as Location, ...p]), () => setLoc({ city: '', state: '', country: '', address: '' })) }} className="grid grid-cols-2 gap-2">
            <input value={loc.city} onChange={e => setLoc({ ...loc, city: e.target.value })} placeholder="City *" className={inputCls} />
            <input value={loc.state} onChange={e => setLoc({ ...loc, state: e.target.value })} placeholder="State" className={inputCls} />
            <input value={loc.country} onChange={e => setLoc({ ...loc, country: e.target.value })} placeholder="Country" className={inputCls} />
            <input value={loc.address} onChange={e => setLoc({ ...loc, address: e.target.value })} placeholder="Address" className={inputCls} />
            <div className="col-span-2"><button disabled={busy === 'location'} className={btnCls}>{busy === 'location' ? 'Saving…' : 'Add Location'}</button></div>
          </form>
          <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">{locations.length} location(s): {locations.slice(0, 6).map(l => l.city).join(', ')}</p>
        </Section>

        {/* Plant */}
        <Section title="Plant" subtitle="A factory/site under a location.">
          <form onSubmit={e => { e.preventDefault(); if (!plant.plantName || !plant.locationId) return; submit('plant', '/plants', plant, 'plant', d => setPlants(p => [d as Plant, ...p]), () => setPlant({ plantName: '', companyName: '', locationId: '', plantCode: '' })) }} className="grid grid-cols-2 gap-2">
            <input value={plant.plantName} onChange={e => setPlant({ ...plant, plantName: e.target.value })} placeholder="Plant name *" className={inputCls} />
            <input value={plant.companyName} onChange={e => setPlant({ ...plant, companyName: e.target.value })} placeholder="Company" className={inputCls} />
            <select value={plant.locationId} onChange={e => setPlant({ ...plant, locationId: e.target.value })} className={inputCls}>
              <option value="">Location *…</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.city}{l.state ? `, ${l.state}` : ''}</option>)}
            </select>
            <input value={plant.plantCode} onChange={e => setPlant({ ...plant, plantCode: e.target.value })} placeholder="Plant code" className={inputCls} />
            <div className="col-span-2"><button disabled={busy === 'plant' || locations.length === 0} className={btnCls}>{busy === 'plant' ? 'Saving…' : 'Add Plant'}</button></div>
          </form>
          <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">{plants.length} plant(s){locations.length === 0 ? ' — add a location first' : ''}</p>
        </Section>

        {/* Contact */}
        <Section title="Contact" subtitle="A person at a plant.">
          <form onSubmit={e => { e.preventDefault(); if (!contact.plantId || !contact.contactPersonName) return; submit('contact', '/contacts', contact, 'contact', d => setContacts(p => [d as Contact, ...p]), () => setContact({ plantId: '', contactPersonName: '', designation: '', contactPersonNumber: '', alternateNumber: '', mailId: '', isPrimaryContact: false })) }} className="grid grid-cols-2 gap-2">
            <select value={contact.plantId} onChange={e => setContact({ ...contact, plantId: e.target.value })} className={`${inputCls} col-span-2`}>
              <option value="">Plant *…</option>
              {plants.map(p => <option key={p.id} value={p.id}>{p.plantName}</option>)}
            </select>
            <input value={contact.contactPersonName} onChange={e => setContact({ ...contact, contactPersonName: e.target.value })} placeholder="Name *" className={inputCls} />
            <input value={contact.designation} onChange={e => setContact({ ...contact, designation: e.target.value })} placeholder="Designation" className={inputCls} />
            <input value={contact.contactPersonNumber} onChange={e => setContact({ ...contact, contactPersonNumber: e.target.value })} placeholder="Phone" className={inputCls} />
            <input value={contact.alternateNumber} onChange={e => setContact({ ...contact, alternateNumber: e.target.value })} placeholder="Alternate phone" className={inputCls} />
            <input value={contact.mailId} onChange={e => setContact({ ...contact, mailId: e.target.value })} placeholder="Email" className={`${inputCls} col-span-2`} />
            <label className="col-span-2 flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
              <input type="checkbox" checked={contact.isPrimaryContact} onChange={e => setContact({ ...contact, isPrimaryContact: e.target.checked })} className="h-4 w-4 accent-orange-400" />
              Primary contact
            </label>
            <div className="col-span-2"><button disabled={busy === 'contact' || plants.length === 0} className={btnCls}>{busy === 'contact' ? 'Saving…' : 'Add Contact'}</button></div>
          </form>
          <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">{contacts.length} contact(s){plants.length === 0 ? ' — add a plant first' : ''}</p>
        </Section>

        {/* Vertical + Sector */}
        <Section title="Verticals & Sectors" subtitle="Lookup lists used when tagging a lead.">
          <form onSubmit={e => { e.preventDefault(); if (!vert.verticalName) return; submit('vertical', '/verticals', vert, 'vertical', d => setVerticals(p => [d as Vertical, ...p]), () => setVert({ verticalName: '', description: '' })) }} className="mb-3 grid grid-cols-2 gap-2">
            <input value={vert.verticalName} onChange={e => setVert({ ...vert, verticalName: e.target.value })} placeholder="Vertical name *" className={inputCls} />
            <input value={vert.description} onChange={e => setVert({ ...vert, description: e.target.value })} placeholder="Description" className={inputCls} />
            <div className="col-span-2"><button disabled={busy === 'vertical'} className={btnCls}>{busy === 'vertical' ? 'Saving…' : 'Add Vertical'}</button></div>
          </form>
          <p className="mb-4 text-xs text-gray-400 dark:text-gray-500">{verticals.length}: {verticals.slice(0, 6).map(v => v.verticalName).join(', ')}</p>

          <form onSubmit={e => { e.preventDefault(); if (!sect.sectorName) return; submit('sector', '/sectors', sect, 'sector', d => setSectors(p => [d as Sector, ...p]), () => setSect({ sectorName: '', description: '' })) }} className="grid grid-cols-2 gap-2">
            <input value={sect.sectorName} onChange={e => setSect({ ...sect, sectorName: e.target.value })} placeholder="Sector name *" className={inputCls} />
            <input value={sect.description} onChange={e => setSect({ ...sect, description: e.target.value })} placeholder="Description" className={inputCls} />
            <div className="col-span-2"><button disabled={busy === 'sector'} className={btnCls}>{busy === 'sector' ? 'Saving…' : 'Add Sector'}</button></div>
          </form>
          <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">{sectors.length}: {sectors.slice(0, 6).map(s => s.sectorName).join(', ')}</p>
        </Section>
      </div>
    </div>
  )
}
