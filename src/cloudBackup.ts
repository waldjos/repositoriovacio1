import { db, exportBackup } from './db'
import { pdfFile } from './pdf'
import type { BackupData, Company, Invoice } from './types'

let backupTimer: number | undefined
let pendingInvoiceNumber = ''

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function lightweightBackup(data: BackupData): BackupData {
  return {
    ...data,
    company: data.company.map(company => ({ ...company, logoDataUrl: undefined })),
  }
}

async function postBackup(company: Company, invoice: Invoice) {
  if (!navigator.onLine || !company.email) return

  const pdf = pdfFile(invoice, company)
  const fullBackup = lightweightBackup(await exportBackup())
  const json = new Blob([JSON.stringify(fullBackup, null, 2)], { type: 'application/json' })
  const [pdfBase64, jsonBase64] = await Promise.all([blobToBase64(pdf), blobToBase64(json)])

  const response = await fetch('/api/backup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestedRecipient: company.email,
      invoiceNumber: invoice.number,
      invoiceType: invoice.type,
      clientName: invoice.client.name,
      status: invoice.status,
      total: invoice.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
      currency: invoice.currency,
      attachments: [
        { filename: `${invoice.number}.pdf`, content: pdfBase64 },
        { filename: `zivifactura-respaldo-${new Date().toISOString().slice(0, 10)}.json`, content: jsonBase64 },
      ],
    }),
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error || `No se pudo crear el respaldo (${response.status}).`)
  }
}

async function sendLatestBackup(number: string) {
  const [company, invoice] = await Promise.all([
    db.company.get(1),
    db.invoices.where('number').equals(number).last(),
  ])
  if (!company || !invoice) return
  await postBackup(company, invoice)
}

function schedule(number: string) {
  if (!number) return
  pendingInvoiceNumber = number
  if (backupTimer) window.clearTimeout(backupTimer)
  backupTimer = window.setTimeout(() => {
    const current = pendingInvoiceNumber
    pendingInvoiceNumber = ''
    sendLatestBackup(current).catch(error => console.warn('[ZiviFactura] Respaldo automático pendiente:', error))
  }, 1800)
}

export function initAutomaticBackup() {
  db.invoices.hook('creating', (_primaryKey, invoice) => schedule(invoice.number))
  db.invoices.hook('updating', (_changes, _primaryKey, invoice) => schedule(invoice.number))
}
