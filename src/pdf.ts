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

export function buildInvoicePdf(invoice: Invoice, company: Company) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const { subtotal, discount, tax, total } = totals(invoice)
  const teal = [15, 118, 110] as [number, number, number]

  if (company.logoDataUrl) {
    try { doc.addImage(company.logoDataUrl, 'PNG', 42, 36, 84, 52, undefined, 'FAST') } catch { /* ignore invalid logo */ }
  }

  doc.setTextColor(...teal)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text(company.name || 'Mi empresa', company.logoDataUrl ? 140 : 42, 58)
  doc.setTextColor(70)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  const companyLines = [company.taxId && `RIF/RUC: ${company.taxId}`, company.phone, company.email, company.address, company.city].filter(Boolean)
  companyLines.forEach((line, index) => doc.text(String(line), company.logoDataUrl ? 140 : 42, 75 + index * 12))

  doc.setTextColor(...teal)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.text(invoice.type.toUpperCase(), 553, 52, { align: 'right' })
  doc.setFontSize(10)
  doc.setTextColor(80)
  doc.text(invoice.number, 553, 70, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.text(`Fecha: ${invoice.date}`, 553, 86, { align: 'right' })
  if (invoice.dueDate) doc.text(`Vence: ${invoice.dueDate}`, 553, 100, { align: 'right' })

  doc.setDrawColor(220)
  doc.line(42, 128, 553, 128)

  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...teal)
  doc.setFontSize(10)
  doc.text('CLIENTE', 42, 152)
  doc.setTextColor(45)
  doc.setFontSize(12)
  doc.text(invoice.client.name || 'Cliente', 42, 170)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  const clientLines = [invoice.client.taxId && `RIF/RUC/C.I.: ${invoice.client.taxId}`, invoice.client.phone, invoice.client.email, invoice.client.address].filter(Boolean)
  clientLines.forEach((line, index) => doc.text(String(line), 42, 186 + index * 12))

  autoTable(doc, {
    startY: 238,
    head: [['Cant.', 'Descripción', 'P. Unit.', 'P. Total']],
    body: invoice.items.map((item) => [
      item.quantity.toString(),
      item.description,
      money(item.unitPrice, invoice.currency),
      money(item.quantity * item.unitPrice, invoice.currency),
    ]),
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 7, lineColor: [225, 230, 230] },
    headStyles: { fillColor: teal, textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 48 }, 2: { cellWidth: 84, halign: 'right' }, 3: { cellWidth: 88, halign: 'right' } },
  })

  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 22
  const xLabel = 390
  const xValue = 553
  doc.setFontSize(9)
  doc.setTextColor(85)
  const summary = [
    ['Subtotal', money(subtotal, invoice.currency)],
    ['Descuento', money(discount, invoice.currency)],
    [`IVA / Impuesto ${invoice.taxRate}%`, money(tax, invoice.currency)],
  ]
  summary.forEach(([label, value], index) => {
    doc.text(label, xLabel, finalY + index * 18)
    doc.text(value, xValue, finalY + index * 18, { align: 'right' })
  })
  doc.setDrawColor(...teal)
  doc.line(xLabel, finalY + 58, xValue, finalY + 58)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...teal)
  doc.setFontSize(13)
  doc.text('TOTAL', xLabel, finalY + 78)
  doc.text(money(total, invoice.currency), xValue, finalY + 78, { align: 'right' })

  const bottomY = Math.max(finalY + 118, 610)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...teal)
  doc.text('FORMA DE PAGO', 42, bottomY)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(70)
  doc.text(invoice.paymentMethod || 'No indicada', 42, bottomY + 15)

  if (invoice.notes) {
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...teal)
    doc.text('OBSERVACIONES', 42, bottomY + 44)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(70)
    doc.text(doc.splitTextToSize(invoice.notes, 500), 42, bottomY + 59)
  }

  const footerY = 806
  const footerPrefix = 'Creado por Zivi Dynamics C.A. · RIF: J-508175123 · '
  const website = 'zividynamics.com'
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(120)
  doc.text(footerPrefix, 42, footerY)
  const linkX = 42 + doc.getTextWidth(footerPrefix)
  doc.setTextColor(...teal)
  doc.textWithLink(website, linkX, footerY, { url: 'https://zividynamics.com' })
  doc.setDrawColor(...teal)
  doc.line(linkX, footerY + 1.5, linkX + doc.getTextWidth(website), footerY + 1.5)
  return doc
}

export function pdfFile(invoice: Invoice, company: Company) {
  const doc = buildInvoicePdf(invoice, company)
  const blob = doc.output('blob')
  return new File([blob], `${invoice.number}.pdf`, { type: 'application/pdf' })
}
