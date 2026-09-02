import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { Company, Invoice } from './types'

export function money(value: number, currency = 'USD') {
  try {
    return new Intl.NumberFormat('es', { style: 'currency', currency }).format(value)
  } catch {
    return `${currency} ${value.toFixed(2)}`
  }
}

export function totals(invoice: Invoice) {
  const subtotal = invoice.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  const discount = Math.min(Math.max(invoice.discount || 0, 0), subtotal)
  const taxable = subtotal - discount
  const tax = taxable * (Math.max(invoice.taxRate || 0, 0) / 100)
  return { subtotal, discount, tax, total: taxable + tax }
}

const statusLabel = (status: Invoice['status']) => ({ draft: 'BORRADOR', issued: 'POR COBRAR', paid: 'PAGADA', cancelled: 'ANULADA' }[status])

export function buildInvoicePdf(invoice: Invoice, company: Company) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const { subtotal, discount, tax, total } = totals(invoice)
  const teal = [15, 118, 110] as [number, number, number]
  const tealDark = [10, 88, 82] as [number, number, number]
  const ink = [26, 39, 46] as [number, number, number]
  const muted = [103, 116, 124] as [number, number, number]
  const soft = [243, 248, 247] as [number, number, number]
  const pageW = 595

  doc.setFillColor(...tealDark)
  doc.roundedRect(28, 24, pageW - 56, 118, 14, 14, 'F')

  if (company.logoDataUrl) {
    try {
      doc.setFillColor(255, 255, 255)
      doc.roundedRect(42, 40, 82, 70, 10, 10, 'F')
      doc.addImage(company.logoDataUrl, 'PNG', 49, 47, 68, 56, undefined, 'FAST')
    } catch { /* ignore invalid logo */ }
  }

  const companyX = company.logoDataUrl ? 140 : 46
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(19)
  doc.text(company.name || 'Mi empresa', companyX, 58)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  const companyLines = [company.taxId && `RIF/RUC: ${company.taxId}`, company.phone, company.email, company.address, company.city].filter(Boolean)
  companyLines.slice(0, 4).forEach((line, index) => doc.text(String(line), companyX, 76 + index * 11))

  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.text(invoice.type.toUpperCase(), 548, 54, { align: 'right' })
  doc.setFontSize(10)
  doc.text(invoice.number, 548, 72, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.text(`Fecha: ${invoice.date}`, 548, 89, { align: 'right' })
  if (invoice.dueDate) doc.text(`Vence: ${invoice.dueDate}`, 548, 102, { align: 'right' })

  const badgeText = statusLabel(invoice.status)
  const badgeWidth = Math.max(72, doc.getTextWidth(badgeText) + 22)
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(548 - badgeWidth, 113, badgeWidth, 20, 10, 10, 'F')
  doc.setTextColor(...tealDark)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.text(badgeText, 548 - badgeWidth / 2, 126.5, { align: 'center' })

  doc.setFillColor(...soft)
  doc.roundedRect(28, 160, pageW - 56, 92, 12, 12, 'F')
  doc.setTextColor(...tealDark)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('FACTURADO A', 44, 181)
  doc.setTextColor(...ink)
  doc.setFontSize(13)
  doc.text(invoice.client.name || 'Cliente', 44, 201)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...muted)
  const clientLines = [invoice.client.taxId && `RIF/RUC/C.I.: ${invoice.client.taxId}`, invoice.client.phone, invoice.client.email, invoice.client.address].filter(Boolean)
  clientLines.slice(0, 3).forEach((line, index) => doc.text(String(line), 44, 218 + index * 12))

  doc.setTextColor(...tealDark)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('RESUMEN', 382, 181)
  doc.setTextColor(...ink)
  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'normal')
  doc.text('Moneda', 382, 201)
  doc.text(invoice.currency, 548, 201, { align: 'right' })
  doc.text('Forma de pago', 382, 218)
  doc.text(invoice.paymentMethod || 'No indicada', 548, 218, { align: 'right', maxWidth: 125 })

  autoTable(doc, {
    startY: 274,
    margin: { left: 28, right: 28 },
    head: [['Cant.', 'Descripción', 'P. unitario', 'Total']],
    body: invoice.items.map((item) => [
      item.quantity.toLocaleString('es'),
      item.description,
      money(item.unitPrice, invoice.currency),
      money(item.quantity * item.unitPrice, invoice.currency),
    ]),
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: { top: 10, right: 8, bottom: 10, left: 8 }, textColor: ink, lineColor: [226, 233, 232], lineWidth: { bottom: 0.6 } },
    headStyles: { fillColor: teal, textColor: [255, 255, 255], fontStyle: 'bold', lineWidth: 0 },
    alternateRowStyles: { fillColor: [249, 251, 251] },
    columnStyles: { 0: { cellWidth: 48 }, 1: { cellWidth: 274 }, 2: { cellWidth: 95, halign: 'right' }, 3: { cellWidth: 100, halign: 'right', fontStyle: 'bold' } },
  })

  const tableEnd = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
  const summaryY = tableEnd + 24
  const summaryX = 344
  const summaryW = 223

  doc.setFillColor(...soft)
  doc.roundedRect(summaryX, summaryY, summaryW, 112, 12, 12, 'F')
  doc.setFontSize(9)
  doc.setTextColor(...muted)
  const rows = [
    ['Subtotal', money(subtotal, invoice.currency)],
    ['Descuento', `- ${money(discount, invoice.currency)}`],
    [`IVA / Impuesto ${invoice.taxRate}%`, money(tax, invoice.currency)],
  ]
  rows.forEach(([label, value], index) => {
    const y = summaryY + 24 + index * 20
    doc.setFont('helvetica', 'normal')
    doc.text(label, summaryX + 14, y)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...ink)
    doc.text(value, summaryX + summaryW - 14, y, { align: 'right' })
    doc.setTextColor(...muted)
  })
  doc.setDrawColor(210, 223, 221)
  doc.line(summaryX + 14, summaryY + 76, summaryX + summaryW - 14, summaryY + 76)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...tealDark)
  doc.text('TOTAL', summaryX + 14, summaryY + 98)
  doc.text(money(total, invoice.currency), summaryX + summaryW - 14, summaryY + 98, { align: 'right' })

  const infoY = Math.max(summaryY + 136, 600)
  if (invoice.notes) {
    doc.setTextColor(...tealDark)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text('OBSERVACIONES', 28, infoY)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...muted)
    doc.setFontSize(8.5)
    doc.text(doc.splitTextToSize(invoice.notes, 300), 28, infoY + 16)
  }

  doc.setDrawColor(225, 232, 231)
  doc.line(28, 781, 567, 781)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.8)
  doc.setTextColor(...muted)
  const footerPrefix = 'Generado con ZiviFactura · Zivi Dynamics C.A. · RIF J-508175123 · '
  doc.text(footerPrefix, 28, 802)
  const linkX = 28 + doc.getTextWidth(footerPrefix)
  doc.setTextColor(...tealDark)
  doc.textWithLink('zividynamics.com', linkX, 802, { url: 'https://zividynamics.com' })
  return doc
}

export function pdfFile(invoice: Invoice, company: Company) {
  const doc = buildInvoicePdf(invoice, company)
  const blob = doc.output('blob')
  return new File([blob], `${invoice.number}.pdf`, { type: 'application/pdf' })
}
