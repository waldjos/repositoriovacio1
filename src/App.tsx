import { useEffect, useMemo, useRef, useState } from 'react'
import { ArchiveRestore, Check, Copy, Download, Edit3, FilePlus2, FileText, Home, Mail, Plus, ReceiptText, Save, Search, Send, Settings, Share2, Trash2, Upload, WifiOff } from 'lucide-react'
import { db, defaultCompany, ensureCompany, exportBackup, importBackup } from './db'
import { buildInvoicePdf, money, pdfFile, totals } from './pdf'
import type { BackupData, Client, Company, Invoice, InvoiceItem, InvoiceStatus } from './types'

type Mode = 'home' | 'editor' | 'settings'
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

const labels: Record<InvoiceStatus, string> = { draft: 'Borrador', issued: 'Emitida', paid: 'Pagada', cancelled: 'Anulada' }
const today = () => new Date().toISOString().slice(0, 10)
const uid = () => Math.random().toString(36).slice(2, 10)
const numberFor = (c: Company) => `${c.prefix || 'FAC'}-${String(c.nextInvoiceNumber || 1).padStart(6, '0')}`
const MAX_LOGO_BYTES = 10 * 1024 * 1024

function blank(c: Company): Invoice {
  const now = new Date().toISOString()
  return {
    number: numberFor(c), type: 'Factura', status: 'draft', date: today(), dueDate: '', city: c.city || '',
    client: { name: '', taxId: '', phone: '', email: '', address: '' },
    items: [{ id: uid(), description: '', quantity: 1, unitPrice: 0 }], discount: 0,
    taxRate: c.defaultTaxRate || 0, paymentMethod: '', notes: '', currency: c.currency || 'USD',
    createdAt: now, updatedAt: now,
  }
}

export default function App() {
  const [mode, setMode] = useState<Mode>('home')
  const [company, setCompany] = useState<Company>(defaultCompany)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [editing, setEditing] = useState<Invoice | null>(null)
  const [search, setSearch] = useState('')
  const [toast, setToast] = useState('')
  const [online, setOnline] = useState(navigator.onLine)
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null)

  const notify = (m: string) => { setToast(m); window.setTimeout(() => setToast(''), 2600) }

  async function refresh() {
    await ensureCompany()
    const [c, inv, cl] = await Promise.all([
      db.company.get(1), db.invoices.orderBy('updatedAt').reverse().toArray(), db.clients.orderBy('name').toArray()
    ])
    setCompany(c || defaultCompany); setInvoices(inv); setClients(cl)
  }

  useEffect(() => {
    refresh()
    const on = () => setOnline(true), off = () => setOnline(false)
    const beforeInstall = (e: Event) => { e.preventDefault(); setInstallPrompt(e as InstallPrompt) }
    window.addEventListener('online', on); window.addEventListener('offline', off); window.addEventListener('beforeinstallprompt', beforeInstall)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); window.removeEventListener('beforeinstallprompt', beforeInstall) }
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return invoices
    return invoices.filter(i => [i.number, i.client.name, i.client.taxId, i.status, i.date].join(' ').toLowerCase().includes(q))
  }, [invoices, search])

  const startNew = () => { setEditing(blank(company)); setMode('editor') }
  const edit = (i: Invoice) => { setEditing(structuredClone(i)); setMode('editor') }
  const duplicate = (i: Invoice) => {
    const now = new Date().toISOString()
    setEditing({ ...structuredClone(i), id: undefined, number: numberFor(company), status: 'draft', date: today(), createdAt: now, updatedAt: now, items: i.items.map(x => ({ ...x, id: uid() })) })
    setMode('editor')
  }
  const remove = async (i: Invoice) => {
    if (!i.id || !confirm(`¿Eliminar ${i.number}?`)) return
    await db.invoices.delete(i.id); await refresh(); notify('Documento eliminado.')
  }

  return <div className="app">
    <header className="top">
      <button className="brand" onClick={() => setMode('home')}><span><ReceiptText size={22}/></span><div><strong>Factura Local</strong><small>{company.name || 'Mi empresa'}</small></div></button>
      <nav>
        <button className={mode === 'home' ? 'active' : ''} onClick={() => setMode('home')}><Home size={18}/>Inicio</button>
        <button className={mode === 'settings' ? 'active' : ''} onClick={() => setMode('settings')}><Settings size={18}/>Configuración</button>
      </nav>
      <button className="primary" onClick={startNew}><Plus size={18}/>Nueva factura</button>
    </header>

    <main className="page">
      {!online && <div className="offline"><WifiOff size={16}/>Estás sin conexión. Puedes seguir trabajando porque los datos se guardan en este dispositivo.</div>}
      {mode === 'home' && <HomeView invoices={filtered} all={invoices} search={search} setSearch={setSearch} company={company} onNew={startNew} onEdit={edit} onDuplicate={duplicate} onDelete={remove}/>} 
      {mode === 'editor' && editing && <Editor invoice={editing} company={company} clients={clients} notify={notify} onBack={() => setMode('home')} onSaved={async s => { setEditing(s); await refresh(); notify(`${s.number} guardada.`) }}/>} 
      {mode === 'settings' && <SettingsView company={company} installPrompt={installPrompt} notify={notify} onChanged={refresh} onInstalled={() => setInstallPrompt(null)}/>} 
    </main>
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>
}

function HomeView({ invoices, all, search, setSearch, company, onNew, onEdit, onDuplicate, onDelete }: {
  invoices: Invoice[]; all: Invoice[]; search: string; setSearch: (v: string) => void; company: Company;
  onNew: () => void; onEdit: (i: Invoice) => void; onDuplicate: (i: Invoice) => void; onDelete: (i: Invoice) => void
}) {
  const pending = all.filter(i => i.status === 'issued').reduce((s, i) => s + totals(i).total, 0)
  const paid = all.filter(i => i.status === 'paid').reduce((s, i) => s + totals(i).total, 0)
  return <>
    <section className="hero"><div><span>FACTURACIÓN LOCAL</span><h1>Crea, guarda y comparte facturas en segundos.</h1><p>Los documentos viven en tu dispositivo. Genera PDF y compártelo por WhatsApp, correo o cualquier app compatible.</p></div><button className="heroButton" onClick={onNew}><FilePlus2 size={20}/>Crear documento</button></section>
    <section className="metrics"><Metric label="Documentos" value={String(all.length)}/><Metric label="Por cobrar" value={money(pending, company.currency)}/><Metric label="Cobrado" value={money(paid, company.currency)}/></section>
    <section className="card">
      <div className="cardHead"><div><h2>Facturas y documentos</h2><p>Abre cualquier documento para modificarlo o compartirlo nuevamente.</p></div><button className="primary" onClick={onNew}><Plus size={18}/>Nuevo</button></div>
      <label className="search"><Search size={18}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por cliente, número, fecha o estado…"/></label>
      {invoices.length ? <div className="list">{invoices.map(i => <article className="row" key={i.id}>
        <button className="doc" onClick={() => onEdit(i)}><span className="fileIcon"><FileText size={19}/></span><span><strong>{i.number}</strong><small>{i.client.name || 'Sin cliente'} · {i.date}</small></span></button>
        <span className={`status ${i.status}`}>{labels[i.status]}</span><strong className="amount">{money(totals(i).total, i.currency)}</strong>
        <div className="actions"><button title="Editar" onClick={() => onEdit(i)}><Edit3 size={17}/></button><button title="Duplicar" onClick={() => onDuplicate(i)}><Copy size={17}/></button><button title="Eliminar" className="danger" onClick={() => onDelete(i)}><Trash2 size={17}/></button></div>
      </article>)}</div> : <div className="empty"><ReceiptText size={34}/><h3>{search ? 'Sin resultados' : 'Aún no hay facturas'}</h3><p>{search ? 'Prueba con otro término.' : 'Crea tu primer documento para comenzar.'}</p>{!search && <button className="primary" onClick={onNew}>Crear factura</button>}</div>}
    </section>
  </>
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div> }

function Editor({ invoice: initial, company, clients, notify, onBack, onSaved }: { invoice: Invoice; company: Company; clients: Client[]; notify: (m: string) => void; onBack: () => void; onSaved: (i: Invoice) => void }) {
  const [invoice, setInvoice] = useState(initial)
  const [saving, setSaving] = useState(false)
  const sum = totals(invoice)
  useEffect(() => setInvoice(initial), [initial])
  const set = <K extends keyof Invoice>(k: K, v: Invoice[K]) => setInvoice(p => ({ ...p, [k]: v }))
  const setClient = (k: keyof Invoice['client'], v: string) => setInvoice(p => ({ ...p, client: { ...p.client, [k]: v } }))
  const setItem = (id: string, patch: Partial<InvoiceItem>) => setInvoice(p => ({ ...p, items: p.items.map(x => x.id === id ? { ...x, ...patch } : x) }))

  async function save(status?: InvoiceStatus) {
    if (!invoice.client.name.trim()) return notify('Escribe el nombre del cliente.')
    const validItems = invoice.items.filter(x => x.description.trim())
    if (!validItems.length) return notify('Agrega al menos un producto o servicio.')
    setSaving(true)
    try {
      let existing: Client | undefined
      if (invoice.client.taxId) existing = await db.clients.where('taxId').equals(invoice.client.taxId.trim()).first()
      if (!existing) existing = clients.find(c => c.name.toLowerCase() === invoice.client.name.trim().toLowerCase())
      const clientPayload: Client = { ...invoice.client, id: existing?.id, createdAt: existing?.createdAt || new Date().toISOString() }
      const clientId = existing?.id ? (await db.clients.put(clientPayload), existing.id) : Number(await db.clients.add(clientPayload))
      const payload: Invoice = { ...invoice, clientId, status: status || invoice.status, items: validItems, updatedAt: new Date().toISOString() }
      let id = invoice.id
      if (id) await db.invoices.put(payload)
      else { id = Number(await db.invoices.add(payload)); await db.company.update(1, { nextInvoiceNumber: (company.nextInvoiceNumber || 1) + 1 }) }
      const saved = { ...payload, id }; setInvoice(saved); onSaved(saved)
    } finally { setSaving(false) }
  }

  const download = () => buildInvoicePdf(invoice, company).save(`${invoice.number}.pdf`)
  const message = `Hola ${invoice.client.name}. Te comparto ${invoice.type.toLowerCase()} ${invoice.number} por un total de ${money(sum.total, invoice.currency)}. Gracias por tu preferencia.`

  const share = async () => {
    if (!invoice.client.name.trim()) return notify('Completa el cliente antes de compartir.')
    const file = pdfFile(invoice, company)
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
    if (navigator.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
      try { await navigator.share({ title: `${invoice.type} ${invoice.number}`, text: message, files: [file] }) } catch { }
    } else { download(); notify('PDF descargado. Puedes adjuntarlo manualmente.') }
  }

  const whatsapp = async () => {
    if (!invoice.client.name.trim()) return notify('Completa el cliente antes de compartir.')
    const file = pdfFile(invoice, company)
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
    if (navigator.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
      try {
        await navigator.share({ title: `${invoice.type} ${invoice.number}`, text: message, files: [file] })
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }
    const phone = invoice.client.phone.replace(/\D/g, '')
    const text = encodeURIComponent(message)
    download()
    window.open(phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`, '_blank', 'noopener,noreferrer')
    notify('Tu navegador no permite adjuntar el PDF directamente. Se descargó el archivo para que puedas adjuntarlo.')
  }

  const email = () => {
    const subject = encodeURIComponent(`${invoice.type} ${invoice.number}`)
    const body = encodeURIComponent(`Hola ${invoice.client.name},\n\nTe comparto ${invoice.type.toLowerCase()} ${invoice.number} por un total de ${money(sum.total, invoice.currency)}.\n\nSaludos.`)
    location.href = `mailto:${invoice.client.email}?subject=${subject}&body=${body}`
  }

  return <div className="editorGrid">
    <section className="editorMain">
      <div className="editorHead"><button className="back" onClick={onBack}>← Volver</button><div><span>DOCUMENTO</span><h1>{invoice.number}</h1></div><span className={`status ${invoice.status}`}>{labels[invoice.status]}</span></div>
      <section className="card formCard"><h2>1. Datos del documento</h2><div className="grid4">
        <Field label="Tipo"><select value={invoice.type} onChange={e => set('type', e.target.value as Invoice['type'])}><option>Factura</option><option>Proforma</option><option>Presupuesto</option></select></Field>
        <Field label="Número"><input value={invoice.number} onChange={e => set('number', e.target.value)}/></Field>
        <Field label="Fecha"><input type="date" value={invoice.date} onChange={e => set('date', e.target.value)}/></Field>
        <Field label="Estado"><select value={invoice.status} onChange={e => set('status', e.target.value as InvoiceStatus)}><option value="draft">Borrador</option><option value="issued">Emitida</option><option value="paid">Pagada</option><option value="cancelled">Anulada</option></select></Field>
      </div></section>
      <section className="card formCard"><h2>2. Cliente</h2>{clients.length > 0 && <Field label="Cliente guardado"><select defaultValue="" onChange={e => { const c = clients.find(x => String(x.id) === e.target.value); if (c) setInvoice(p => ({ ...p, clientId: c.id, client: { name: c.name, taxId: c.taxId, phone: c.phone, email: c.email, address: c.address } })) }}><option value="">Seleccionar…</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
        <div className="grid2"><Field label="Nombre / razón social"><input value={invoice.client.name} onChange={e => setClient('name', e.target.value)}/></Field><Field label="RIF / RUC / C.I."><input value={invoice.client.taxId} onChange={e => setClient('taxId', e.target.value)}/></Field><Field label="Teléfono"><input value={invoice.client.phone} onChange={e => setClient('phone', e.target.value)} placeholder="Incluye código de país"/></Field><Field label="Correo"><input type="email" value={invoice.client.email} onChange={e => setClient('email', e.target.value)}/></Field><Field label="Dirección" wide><input value={invoice.client.address} onChange={e => setClient('address', e.target.value)}/></Field></div>
      </section>
      <section className="card formCard"><h2>3. Productos o servicios</h2><div className="items"><div className="itemLabels"><span>Descripción</span><span>Cant.</span><span>Precio</span><span>Total</span><span></span></div>{invoice.items.map(item => <div className="item" key={item.id}><input value={item.description} onChange={e => setItem(item.id, { description: e.target.value })} placeholder="Descripción"/><NumericInput value={item.quantity} onChange={value => setItem(item.id, { quantity: value })}/><NumericInput value={item.unitPrice} onChange={value => setItem(item.id, { unitPrice: value })}/><strong>{money(item.quantity * item.unitPrice, invoice.currency)}</strong><button className="danger icon" disabled={invoice.items.length === 1} onClick={() => set('items', invoice.items.filter(x => x.id !== item.id))}><Trash2 size={17}/></button></div>)}</div><button className="secondary add" onClick={() => set('items', [...invoice.items, { id: uid(), description: '', quantity: 1, unitPrice: 0 }])}><Plus size={18}/>Agregar línea</button></section>
      <section className="card formCard"><h2>4. Pago y notas</h2><div className="grid2"><Field label="Forma de pago"><input value={invoice.paymentMethod} onChange={e => set('paymentMethod', e.target.value)} placeholder="Efectivo, transferencia, tarjeta…"/></Field><Field label="Moneda"><select value={invoice.currency} onChange={e => set('currency', e.target.value)}><option>USD</option><option>EUR</option><option>VES</option><option>COP</option></select></Field><Field label="Descuento"><NumericInput value={invoice.discount} onChange={value => set('discount', value)}/></Field><Field label="IVA / impuesto %"><NumericInput value={invoice.taxRate} onChange={value => set('taxRate', value)}/></Field><Field label="Observaciones" wide><textarea rows={3} value={invoice.notes} onChange={e => set('notes', e.target.value)}/></Field></div></section>
    </section>
    <aside className="summary card"><span>RESUMEN</span><Line label="Subtotal" value={money(sum.subtotal, invoice.currency)}/><Line label="Descuento" value={`- ${money(sum.discount, invoice.currency)}`}/><Line label={`Impuesto ${invoice.taxRate}%`} value={money(sum.tax, invoice.currency)}/><div className="total"><span>Total</span><strong>{money(sum.total, invoice.currency)}</strong></div><button className="primary full" disabled={saving} onClick={() => save('issued')}><Check size={18}/>{saving ? 'Guardando…' : 'Guardar y emitir'}</button><button className="secondary full" disabled={saving} onClick={() => save('draft')}><Save size={18}/>Guardar borrador</button><hr/><button className="secondary full" onClick={share}><Share2 size={18}/>Compartir PDF</button><button className="secondary full whatsapp" onClick={whatsapp}><Send size={18}/>Enviar por WhatsApp</button><button className="secondary full" onClick={email}><Mail size={18}/>Preparar correo</button><button className="ghost full" onClick={download}><Download size={18}/>Descargar PDF</button><small>En móviles compatibles, WhatsApp recibe el mensaje y el PDF juntos mediante el menú de compartir del sistema.</small></aside>
  </div>
}

function NumericInput({ value, onChange, min = 0, step = '0.01' }: { value: number; onChange: (value: number) => void; min?: number; step?: string }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(String(value))

  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(String(value))
  }, [value])

  return <input
    ref={inputRef}
    type="number"
    inputMode="decimal"
    min={min}
    step={step}
    value={draft}
    onFocus={() => { if (Number(draft) === 0) setDraft('') }}
    onChange={e => {
      const raw = e.target.value
      setDraft(raw)
      if (raw.trim() === '') return
      const parsed = Number(raw)
      if (Number.isFinite(parsed)) onChange(Math.max(min, parsed))
    }}
    onBlur={() => {
      const parsed = Number(draft)
      const next = draft.trim() === '' || !Number.isFinite(parsed) ? min : Math.max(min, parsed)
      onChange(next)
      setDraft(String(next))
    }}
  />
}

function Line({ label, value }: { label: string; value: string }) { return <div className="line"><span>{label}</span><strong>{value}</strong></div> }
function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) { return <label className={`field ${wide ? 'wide' : ''}`}><span>{label}</span>{children}</label> }

function SettingsView({ company, installPrompt, notify, onChanged, onInstalled }: { company: Company; installPrompt: InstallPrompt | null; notify: (m: string) => void; onChanged: () => void; onInstalled: () => void }) {
  const [form, setForm] = useState(company)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => setForm(company), [company])
  async function save() { await db.company.put({ ...form, id: 1, nextInvoiceNumber: Math.max(1, Number(form.nextInvoiceNumber) || 1), defaultTaxRate: Math.max(0, Number(form.defaultTaxRate) || 0) }); await onChanged(); notify('Configuración guardada.') }
  function logo(file?: File) {
    if (!file) return
    if (!file.type.startsWith('image/')) return notify('Selecciona un archivo de imagen válido.')
    if (file.size > MAX_LOGO_BYTES) return notify('Usa un logo de hasta 10 MB.')
    const r = new FileReader()
    r.onload = () => { setForm(p => ({ ...p, logoDataUrl: String(r.result) })); notify('Logo cargado.') }
    r.readAsDataURL(file)
  }
  async function backup() { const data = await exportBackup(); const b = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = `factura-local-backup-${today()}.json`; a.click(); URL.revokeObjectURL(u); notify('Respaldo exportado.') }
  async function restore(file?: File) { if (!file) return; try { const data = JSON.parse(await file.text()) as BackupData; if (!confirm('Esto reemplazará los datos locales actuales. ¿Continuar?')) return; await importBackup(data); await onChanged(); notify('Respaldo restaurado.') } catch { notify('El archivo de respaldo no es válido.') } }
  async function install() { if (!installPrompt) return notify('Usa “Agregar a pantalla de inicio” desde el menú del navegador.'); await installPrompt.prompt(); await installPrompt.userChoice; onInstalled() }
  async function persist() { if (!navigator.storage?.persist) return notify('Este navegador no ofrece esta función.'); notify(await navigator.storage.persist() ? 'Almacenamiento persistente activado.' : 'El navegador no concedió persistencia.') }

  return <div className="settingsGrid"><section className="card formCard"><div className="cardHead"><div><h1>Configuración de empresa</h1><p>Estos datos aparecerán en tus documentos PDF.</p></div></div><div className="logoRow"><div className="logoPreview">{form.logoDataUrl ? <img src={form.logoDataUrl} alt="Logo"/> : <ReceiptText size={30}/>}</div><label className="secondary file"><Upload size={18}/>Subir logo<input type="file" accept="image/*" onChange={e => logo(e.target.files?.[0])}/></label><small>PNG, JPG o imagen compatible · máximo 10 MB</small></div><div className="grid2"><Field label="Empresa"><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></Field><Field label="RIF / RUC"><input value={form.taxId} onChange={e => setForm({ ...form, taxId: e.target.value })}/></Field><Field label="Teléfono"><input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}/></Field><Field label="Correo"><input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}/></Field><Field label="Dirección" wide><input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })}/></Field><Field label="Ciudad"><input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })}/></Field><Field label="Moneda"><select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}><option>USD</option><option>EUR</option><option>VES</option><option>COP</option></select></Field><Field label="Impuesto predeterminado %"><NumericInput value={form.defaultTaxRate} onChange={value => setForm({ ...form, defaultTaxRate: value })}/></Field><Field label="Prefijo"><input value={form.prefix} onChange={e => setForm({ ...form, prefix: e.target.value.toUpperCase().slice(0, 8) })}/></Field><Field label="Próximo número"><NumericInput value={form.nextInvoiceNumber} min={1} step="1" onChange={value => setForm({ ...form, nextInvoiceNumber: Math.round(value) })}/></Field></div><button className="primary" onClick={save}><Save size={18}/>Guardar configuración</button></section>
    <aside className="tools"><section className="card tool"><ArchiveRestore/><h2>Copia de seguridad</h2><p>Exporta facturas, clientes y configuración a un archivo JSON.</p><button className="secondary full" onClick={backup}><Download size={18}/>Exportar respaldo</button><button className="secondary full" onClick={() => fileRef.current?.click()}><ArchiveRestore size={18}/>Restaurar respaldo</button><input ref={fileRef} hidden type="file" accept="application/json" onChange={e => restore(e.target.files?.[0])}/></section><section className="card tool"><Download/><h2>Instalar PWA</h2><p>Agrega la aplicación a la pantalla de inicio y úsala como una app.</p><button className="primary full" onClick={install}><Download size={18}/>Instalar</button></section><section className="card tool"><Save/><h2>Conservar datos</h2><p>Solicita prioridad para que el navegador no elimine el almacenamiento local automáticamente.</p><button className="secondary full" onClick={persist}><Check size={18}/>Solicitar persistencia</button></section></aside>
  </div>
}
