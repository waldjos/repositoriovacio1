import Dexie, { type EntityTable } from 'dexie'
import type { BackupData, Client, Company, Invoice, Product } from './types'

class InvoiceDB extends Dexie {
  company!: EntityTable<Company, 'id'>
  clients!: EntityTable<Client, 'id'>
  products!: EntityTable<Product, 'id'>
  invoices!: EntityTable<Invoice, 'id'>

  constructor() {
    super('FacturaLocalDB')
    this.version(1).stores({
      company: 'id',
      clients: '++id, name, taxId, phone, email',
      products: '++id, name, price',
      invoices: '++id, number, status, date, client.name, updatedAt'
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
    version: 1,
    exportedAt: new Date().toISOString(),
    company: await db.company.toArray(),
    clients: await db.clients.toArray(),
    products: await db.products.toArray(),
    invoices: await db.invoices.toArray(),
  }
}

export async function importBackup(data: BackupData) {
  if (!data || data.version !== 1 || !Array.isArray(data.invoices)) {
    throw new Error('El archivo de respaldo no es compatible.')
  }
  await db.transaction('rw', db.company, db.clients, db.products, db.invoices, async () => {
    await Promise.all([db.company.clear(), db.clients.clear(), db.products.clear(), db.invoices.clear()])
    if (data.company?.length) await db.company.bulkPut(data.company)
    if (data.clients?.length) await db.clients.bulkPut(data.clients)
    if (data.products?.length) await db.products.bulkPut(data.products)
    if (data.invoices?.length) await db.invoices.bulkPut(data.invoices)
  })
  await ensureCompany()
}
