import Dexie, { type EntityTable } from 'dexie'
import type { BackupData, Client, Company, Invoice, Payment, Product } from './types'

class InvoiceDB extends Dexie {
  company!: EntityTable<Company, 'id'>
  clients!: EntityTable<Client, 'id'>
  products!: EntityTable<Product, 'id'>
  invoices!: EntityTable<Invoice, 'id'>
  payments!: EntityTable<Payment, 'id'>

  constructor() {
    super('FacturaLocalDB')
    this.version(1).stores({
      company: 'id',
      clients: '++id, name, taxId, phone, email',
      products: '++id, name, price',
      invoices: '++id, number, status, date, client.name, updatedAt'
    })
    this.version(2).stores({
      company: 'id',
      clients: '++id, name, taxId, phone, email',
      products: '++id, name, price',
      invoices: '++id, number, status, date, client.name, updatedAt',
      payments: '++id, &key, invoiceNumber, date, method, updatedAt'
    })
    this.version(3).stores({
      company: 'id, name',
      clients: '++id, companyId, name, taxId, phone, email',
      products: '++id, companyId, name, price',
      invoices: '++id, companyId, number, status, date, client.name, updatedAt, publicShareId',
      payments: '++id, &key, companyId, invoiceNumber, date, method, updatedAt'
    }).upgrade(async tx => {
      await tx.table('clients').toCollection().modify(row => { if (!row.companyId) row.companyId = 1 })
      await tx.table('products').toCollection().modify(row => { if (!row.companyId) row.companyId = 1 })
      await tx.table('invoices').toCollection().modify(row => { if (!row.companyId) row.companyId = 1 })
      await tx.table('payments').toCollection().modify(row => { if (!row.companyId) row.companyId = 1 })
    })
  }
}

export const db = new InvoiceDB()

export const defaultCompany: Company = {
  id: 1,
  name: 'Mi empresa',
  taxId: '',
  phone: '',
  email: '',
  address: '',
  city: '',
  currency: 'USD',
  defaultTaxRate: 0,
  nextInvoiceNumber: 1,
  prefix: 'FAC',
  mobilePaymentBank: '',
  mobilePaymentPhone: '',
  mobilePaymentId: '',
  bankName: '',
  bankAccountType: '',
  bankAccountNumber: '',
  bankAccountHolder: '',
  binanceId: '',
  paymentNotes: '',
}

export async function ensureCompany() {
  const existing = await db.company.get(1)
  if (!existing) await db.company.put(defaultCompany)
}

export async function createCompany(name = 'Nuevo negocio') {
  const rows = await db.company.toArray()
  const id = Math.max(0, ...rows.map(row => Number(row.id) || 0)) + 1
  const company: Company = { ...defaultCompany, id, name, nextInvoiceNumber: 1 }
  await db.company.put(company)
  return company
}

export async function exportBackup(): Promise<BackupData> {
  return {
    version: 3,
    exportedAt: new Date().toISOString(),
    company: await db.company.toArray(),
    clients: await db.clients.toArray(),
    products: await db.products.toArray(),
    invoices: await db.invoices.toArray(),
    payments: await db.payments.toArray(),
  }
}

export async function importBackup(data: BackupData) {
  if (!data || ![1, 2, 3].includes(data.version) || !Array.isArray(data.invoices)) {
    throw new Error('El archivo de respaldo no es compatible.')
  }
  await db.transaction('rw', db.company, db.clients, db.products, db.invoices, db.payments, async () => {
    await Promise.all([db.company.clear(), db.clients.clear(), db.products.clear(), db.invoices.clear(), db.payments.clear()])
    if (data.company?.length) await db.company.bulkPut(data.company)
    if (data.clients?.length) await db.clients.bulkPut(data.clients.map(row => ({ ...row, companyId: row.companyId || 1 })))
    if (data.products?.length) await db.products.bulkPut(data.products.map(row => ({ ...row, companyId: row.companyId || 1 })))
    if (data.invoices?.length) await db.invoices.bulkPut(data.invoices.map(row => ({ ...row, companyId: row.companyId || 1 })))
    if (data.payments?.length) await db.payments.bulkPut(data.payments.map(row => ({ ...row, companyId: row.companyId || 1 })))
  })
  await ensureCompany()
}
