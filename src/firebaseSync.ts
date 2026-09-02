import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore'
import { db, defaultCompany } from './db'
import { firestore } from './firebase'
import type { Client, Company, Invoice, Payment, Product } from './types'

export type SyncState = 'idle' | 'syncing' | 'synced' | 'error'

type StatusCallback = (state: SyncState, message?: string) => void

let activeUid: string | null = null
let applyingRemote = false
let syncTimer: number | undefined
let statusCallback: StatusCallback | null = null

const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const safeKey = (value: string) => encodeURIComponent(value.trim().toLowerCase()).slice(0, 900) || 'sin-id'
const invoiceKey = (invoice: Invoice) => safeKey(invoice.number)
const clientKey = (client: Client) => safeKey(client.taxId || client.email || client.phone || client.name || String(client.id || 'cliente'))
const productKey = (product: Product) => safeKey(product.name || String(product.id || 'producto'))
const paymentKey = (payment: Payment) => safeKey(payment.key)

function companyForCloud(company: Company) {
  const copy = clean(company) as Company
  delete copy.logoDataUrl
  return copy
}

function isDefaultCompany(company?: Company) {
  if (!company) return true
  return !company.taxId && !company.phone && !company.email && !company.address && (!company.name || company.name === defaultCompany.name)
}

async function pushCompany(uid: string) {
  if (!firestore) return
  const company = await db.company.get(1)
  if (!company) return
  await setDoc(doc(firestore, 'users', uid, 'company', 'main'), companyForCloud(company), { merge: true })
}

async function pushInvoices(uid: string) {
  if (!firestore) return
  const invoices = await db.invoices.toArray()
  await Promise.all(invoices.map(invoice => setDoc(doc(firestore, 'users', uid, 'invoices', invoiceKey(invoice)), clean({ ...invoice, id: undefined }), { merge: true })))
}

async function pushClients(uid: string) {
  if (!firestore) return
  const clients = await db.clients.toArray()
  await Promise.all(clients.map(client => setDoc(doc(firestore, 'users', uid, 'clients', clientKey(client)), clean({ ...client, id: undefined }), { merge: true })))
}

async function pushProducts(uid: string) {
  if (!firestore) return
  const products = await db.products.toArray()
  await Promise.all(products.map(product => setDoc(doc(firestore, 'users', uid, 'products', productKey(product)), clean({ ...product, id: undefined }), { merge: true })))
}

async function pushPayments(uid: string) {
  if (!firestore) return
  const payments = await db.payments.toArray()
  await Promise.all(payments.map(payment => setDoc(doc(firestore, 'users', uid, 'payments', paymentKey(payment)), clean({ ...payment, id: undefined }), { merge: true })))
}

async function pullCompany(uid: string) {
  if (!firestore) return
  const snapshot = await getDoc(doc(firestore, 'users', uid, 'company', 'main'))
  if (!snapshot.exists()) return
  const remote = snapshot.data() as Company
  const local = await db.company.get(1)
  if (isDefaultCompany(local)) await db.company.put({ ...defaultCompany, ...remote, id: 1, logoDataUrl: local?.logoDataUrl })
}

async function pullInvoices(uid: string) {
  if (!firestore) return
  const snapshots = await getDocs(collection(firestore, 'users', uid, 'invoices'))
  const localInvoices = await db.invoices.toArray()
  const byNumber = new Map(localInvoices.map(invoice => [invoice.number, invoice]))
  for (const snapshot of snapshots.docs) {
    const remote = snapshot.data() as Invoice
    if (!remote.number) continue
    const local = byNumber.get(remote.number)
    if (!local) { await db.invoices.add({ ...remote, id: undefined }); continue }
    const remoteTime = Date.parse(remote.updatedAt || remote.createdAt || '') || 0
    const localTime = Date.parse(local.updatedAt || local.createdAt || '') || 0
    if (remoteTime > localTime && local.id) await db.invoices.put({ ...remote, id: local.id })
  }
}

async function pullClients(uid: string) {
  if (!firestore) return
  const snapshots = await getDocs(collection(firestore, 'users', uid, 'clients'))
  const locals = await db.clients.toArray()
  for (const snapshot of snapshots.docs) {
    const remote = snapshot.data() as Client
    const match = locals.find(client => (remote.taxId && client.taxId === remote.taxId) || (remote.email && client.email === remote.email) || client.name.toLowerCase() === remote.name?.toLowerCase())
    if (!match) await db.clients.add({ ...remote, id: undefined })
  }
}

async function pullProducts(uid: string) {
  if (!firestore) return
  const snapshots = await getDocs(collection(firestore, 'users', uid, 'products'))
  const locals = await db.products.toArray()
  for (const snapshot of snapshots.docs) {
    const remote = snapshot.data() as Product
    if (!remote.name) continue
    const match = locals.find(product => product.name.toLowerCase() === remote.name.toLowerCase())
    if (!match) await db.products.add({ ...remote, id: undefined })
  }
}

async function pullPayments(uid: string) {
  if (!firestore) return
  const snapshots = await getDocs(collection(firestore, 'users', uid, 'payments'))
  const locals = await db.payments.toArray()
  const byKey = new Map(locals.map(payment => [payment.key, payment]))
  for (const snapshot of snapshots.docs) {
    const remote = snapshot.data() as Payment
    if (!remote.key || !remote.invoiceNumber) continue
    const local = byKey.get(remote.key)
    if (!local) { await db.payments.add({ ...remote, id: undefined }); continue }
    const remoteTime = Date.parse(remote.updatedAt || remote.createdAt || '') || 0
    const localTime = Date.parse(local.updatedAt || local.createdAt || '') || 0
    if (remoteTime > localTime && local.id) await db.payments.put({ ...remote, id: local.id })
  }
}

export async function syncFirebaseNow(uid = activeUid || '') {
  if (!firestore || !uid || !navigator.onLine) return
  statusCallback?.('syncing', 'Sincronizando con Firebase…')
  applyingRemote = true
  try {
    await Promise.all([pullCompany(uid), pullInvoices(uid), pullClients(uid), pullProducts(uid), pullPayments(uid)])
  } finally {
    applyingRemote = false
  }
  try {
    await Promise.all([pushCompany(uid), pushInvoices(uid), pushClients(uid), pushProducts(uid), pushPayments(uid)])
    await setDoc(doc(firestore, 'users', uid, 'meta', 'sync'), { lastSyncAt: new Date().toISOString() }, { merge: true })
    statusCallback?.('synced', 'Datos sincronizados')
  } catch (error) {
    console.warn('[ZiviFactura] Firebase sync:', error)
    statusCallback?.('error', 'No se pudo sincronizar. Se mantiene la copia local.')
  }
}

function scheduleSync() {
  if (applyingRemote || !activeUid) return
  if (syncTimer) window.clearTimeout(syncTimer)
  syncTimer = window.setTimeout(() => { if (activeUid) void syncFirebaseNow(activeUid) }, 900)
}

async function removeInvoice(uid: string, invoice?: Invoice) {
  if (!firestore || !invoice?.number) return
  await deleteDoc(doc(firestore, 'users', uid, 'invoices', invoiceKey(invoice)))
}
async function removeClient(uid: string, client?: Client) {
  if (!firestore || !client) return
  await deleteDoc(doc(firestore, 'users', uid, 'clients', clientKey(client)))
}
async function removeProduct(uid: string, product?: Product) {
  if (!firestore || !product) return
  await deleteDoc(doc(firestore, 'users', uid, 'products', productKey(product)))
}
async function removePayment(uid: string, payment?: Payment) {
  if (!firestore || !payment?.key) return
  await deleteDoc(doc(firestore, 'users', uid, 'payments', paymentKey(payment)))
}

// Dexie keeps the app local-first. These hooks simply queue cloud synchronization.
db.company.hook('creating', () => scheduleSync())
db.company.hook('updating', () => scheduleSync())
db.clients.hook('creating', () => scheduleSync())
db.clients.hook('updating', () => scheduleSync())
db.products.hook('creating', () => scheduleSync())
db.products.hook('updating', () => scheduleSync())
db.invoices.hook('creating', () => scheduleSync())
db.invoices.hook('updating', () => scheduleSync())
db.payments.hook('creating', () => scheduleSync())
db.payments.hook('updating', () => scheduleSync())

db.invoices.hook('deleting', (_key, invoice) => { if (!applyingRemote && activeUid) void removeInvoice(activeUid, invoice).finally(scheduleSync) })
db.clients.hook('deleting', (_key, client) => { if (!applyingRemote && activeUid) void removeClient(activeUid, client).finally(scheduleSync) })
db.products.hook('deleting', (_key, product) => { if (!applyingRemote && activeUid) void removeProduct(activeUid, product).finally(scheduleSync) })
db.payments.hook('deleting', (_key, payment) => { if (!applyingRemote && activeUid) void removePayment(activeUid, payment).finally(scheduleSync) })

export function startFirebaseSync(uid: string, callback?: StatusCallback) {
  activeUid = uid
  statusCallback = callback || null
  const online = () => void syncFirebaseNow(uid)
  const visibility = () => { if (document.visibilityState === 'visible') void syncFirebaseNow(uid) }
  window.addEventListener('online', online)
  document.addEventListener('visibilitychange', visibility)
  void syncFirebaseNow(uid)
  const interval = window.setInterval(() => void syncFirebaseNow(uid), 60_000)
  return () => {
    if (activeUid === uid) activeUid = null
    statusCallback = null
    window.clearInterval(interval)
    window.removeEventListener('online', online)
    document.removeEventListener('visibilitychange', visibility)
  }
}
