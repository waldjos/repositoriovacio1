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

export async function exportBackup(): Promise<BackupData> {
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    company: await db.company.toArray(),
    clients: await db.clients.toArray(),
    products: await db.products.toArray(),
    invoices: await db.invoices.toArray(),
    payments: await db.payments.toArray(),
  }
}

export async function importBackup(data: BackupData) {
  if (!data || ![1, 2].includes(data.version) || !Array.isArray(data.invoices)) {
    throw new Error('El archivo de respaldo no es compatible.')
  }
  await db.transaction('rw', db.company, db.clients, db.products, db.invoices, db.payments, async () => {
    await Promise.all([db.company.clear(), db.clients.clear(), db.products.clear(), db.invoices.clear(), db.payments.clear()])
    if (data.company?.length) await db.company.bulkPut(data.company)
    if (data.clients?.length) await db.clients.bulkPut(data.clients)
    if (data.products?.length) await db.products.bulkPut(data.products)
    if (data.invoices?.length) await db.invoices.bulkPut(data.invoices)
    if (data.payments?.length) await db.payments.bulkPut(data.payments)
  })
  await ensureCompany()
}
