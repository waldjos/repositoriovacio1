import jsPDF from 'jspdf'
import { money, totals } from './pdf'
import { paymentMethodLabels } from './payments'
import type { Company, Invoice, Payment } from './types'

export type ReceiptBalances = { before: number; after: number }

export function paymentReceiptNumber(payment: Payment) {
  const compact = payment.key.replace(/[^a-z0-9]/gi, '').slice(0, 10).toUpperCase()
  return `REC-${compact || String(payment.id || Date.now())}`
}

export function buildPaymentReceiptPdf(payment: Payment, invoice: Invoice, company: Company, balances: ReceiptBalances) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const blue = [37, 99, 235] as [number, number, number]
  const navy = [11, 22, 51] as [number, number, number]
  const cyan = [6, 182, 212] as [number, number, number]
  const ink = [24, 36, 57] as [number, number, number]
  const muted = [104, 117, 138] as [number, number, number]
  const soft = [245, 248, 253] as [number, number, number]
  const line = [225, 232, 243] as [number, number, number]
  const pageW = 595
  const receiptNumber = paymentReceiptNumber(payment)
  const invoiceTotal = totals(invoice).total
  const settled = balances.after <= 0.005

  doc.setFillColor(...navy)
  doc.roundedRect(28, 24, pageW - 56, 126, 16, 16, 'F')
  doc.setFillColor(...blue)
  doc.roundedRect(28, 24, 7, 126, 4, 4, 'F')
  doc.setFillColor(...cyan)
  doc.circle(535, 39, 4, 'F')

  if (company.logoDataUrl) {
    try {
      doc.setFillColor(255, 255, 255)
      doc.roundedRect(43, 41, 78, 68, 10, 10, 'F')
      doc.addImage(company.logoDataUrl, 'PNG', 50, 48, 64, 54, undefined, 'FAST')
    } catch { /* ignore invalid logo */ }
  }

  const companyX = company.logoDataUrl ? 139 : 46
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text(company.name || 'Mi empresa', companyX, 58)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.4)
  const companyLines = [company.taxId && `RIF/RUC: ${company.taxId}`, company.phone, company.email, company.address].filter(Boolean)
  companyLines.slice(0, 4).forEach((value, index) => doc.text(String(value), companyX, 76 + index * 11))

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(19)
  doc.text('RECIBO DE PAGO', 548, 58, { align: 'right' })
  doc.setFontSize(9.5)
  doc.text(receiptNumber, 548, 76, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.4)
  doc.text(`Fecha de pago: ${payment.date}`, 548, 94, { align: 'right' })

  doc.setFillColor(255, 255, 255)
  const badge = settled ? 'FACTURA CANCELADA' : 'ABONO REGISTRADO'
  const badgeW = Math.max(92, doc.getTextWidth(badge) + 22)
  doc.roundedRect(548 - badgeW, 112, badgeW, 22, 11, 11, 'F')
  doc.setTextColor(...navy)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.4)
  doc.text(badge, 548 - badgeW / 2, 126.5, { align: 'center' })

  doc.setFillColor(...soft)
  doc.roundedRect(28, 170, 539, 92, 13, 13, 'F')
  doc.setTextColor(...blue)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.text('RECIBIDO DE', 44, 191)
  doc.setTextColor(...ink)
  doc.setFontSize(13)
  doc.text(invoice.client.name || 'Cliente', 44, 211)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.3)
  doc.setTextColor(...muted)
  const clientLines = [invoice.client.taxId && `RIF/RUC/C.I.: ${invoice.client.taxId}`, invoice.client.phone, invoice.client.email].filter(Boolean)
  clientLines.slice(0, 3).forEach((value, index) => doc.text(String(value), 44, 228 + index * 11))

  doc.setTextColor(...blue)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.text('DOCUMENTO ASOCIADO', 374, 191)
  doc.setTextColor(...ink)
  doc.setFontSize(11)
  doc.text(invoice.number, 551, 211, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...muted)
  doc.setFontSize(8.2)
  doc.text(`Total: ${money(invoiceTotal, invoice.currency)}`, 551, 229, { align: 'right' })
  doc.text(`Moneda: ${invoice.currency}`, 551, 244, { align: 'right' })

  doc.setFillColor(...navy)
  doc.roundedRect(28, 282, 539, 116, 15, 15, 'F')
  doc.setTextColor(...cyan)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.3)
  doc.text('MONTO RECIBIDO', 48, 307)
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(28)
  doc.text(money(payment.amountApplied, payment.invoiceCurrency), 48, 342)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(203, 217, 240)
  doc.text(`${paymentMethodLabels[payment.method]} · Equivalente ${money(payment.amountVes, 'VES')}`, 48, 365)
  if (payment.invoiceCurrency.toUpperCase() !== 'VES' && payment.rateValue) {
    doc.text(`Tasa registrada: ${payment.rateValue.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs por ${payment.invoiceCurrency}`, 48, 382)
  }

  const detailY = 424
  doc.setTextColor(...blue)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('DETALLE DEL MOVIMIENTO', 28, detailY)
  const details = [
    ['Método de pago', paymentMethodLabels[payment.method]],
    ['Fecha real del ingreso', payment.date],
    ['Referencia', payment.reference || 'No indicada'],
    ['Equivalente en bolívares', money(payment.amountVes, 'VES')],
  ]
  details.forEach(([label, value], index) => {
    const y = detailY + 22 + index * 28
    doc.setFillColor(index % 2 ? 250 : 247, index % 2 ? 252 : 249, 255)
    doc.roundedRect(28, y - 15, 539, 24, 7, 7, 'F')
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...muted)
    doc.setFontSize(8.3)
    doc.text(label, 42, y)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...ink)
    doc.text(String(value), 551, y, { align: 'right', maxWidth: 320 })
  })

  const balanceY = 572
  doc.setFillColor(239, 246, 255)
  doc.roundedRect(28, balanceY, 539, 94, 13, 13, 'F')
  doc.setTextColor(...blue)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.text('ESTADO DE LA CUENTA DESPUÉS DE ESTE PAGO', 44, balanceY + 21)
  const balanceRows = [
    ['Saldo antes del pago', money(balances.before, invoice.currency)],
    ['Monto aplicado', money(payment.amountApplied, invoice.currency)],
    ['Saldo restante', money(Math.max(0, balances.after), invoice.currency)],
  ]
  balanceRows.forEach(([label, value], index) => {
    const y = balanceY + 43 + index * 17
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...muted)
    doc.setFontSize(8.4)
    doc.text(label, 44, y)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(index === 2 ? blue[0] : ink[0], index === 2 ? blue[1] : ink[1], index === 2 ? blue[2] : ink[2])
    doc.text(value, 551, y, { align: 'right' })
  })

  if (payment.notes) {
    doc.setTextColor(...blue)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.text('OBSERVACIÓN', 28, 698)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...muted)
    doc.setFontSize(8.2)
    doc.text(doc.splitTextToSize(payment.notes, 520), 28, 715)
  }

  doc.setDrawColor(...line)
  doc.line(28, 781, 567, 781)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.4)
  doc.setTextColor(...muted)
  doc.text('Comprobante administrativo generado al registrar el pago en ZiviFactura.', 28, 798)
  const footerPrefix = 'Zivi Dynamics C.A. · '
  doc.text(footerPrefix, 390, 798)
  const linkX = 390 + doc.getTextWidth(footerPrefix)
  doc.setTextColor(...blue)
  doc.textWithLink('zividynamics.com', linkX, 798, { url: 'https://zividynamics.com' })
  return doc
}

export function downloadPaymentReceipt(payment: Payment, invoice: Invoice, company: Company, balances: ReceiptBalances) {
  const doc = buildPaymentReceiptPdf(payment, invoice, company, balances)
  doc.save(`${paymentReceiptNumber(payment)}-${payment.invoiceNumber}.pdf`)
}
