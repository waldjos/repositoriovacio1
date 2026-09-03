import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, CircleDollarSign, Download, ExternalLink, FileCheck2, Plus, ReceiptText, Trash2, WalletCards, XCircle } from 'lucide-react'
import { db } from './db'
import { getActiveCompanyId } from './companyScope'
import { firebaseAuth } from './firebase'
import { money, totals } from './pdf'
import { fetchLiveRates, getCachedRates, refreshRatesIfDue } from './rates'
import { appliedForInvoice, balanceForInvoice, paymentAmountVes, paymentKey, paymentMethodLabels, paymentMethodOptions, reconcileInvoiceStatus, suggestedPaymentRate } from './payments'
import { paymentProofFileUrl, setPaymentProofStatus, subscribePaymentProofs, type PaymentProofSubmission } from './paymentProofs'
import { downloadPaymentReceipt, type ReceiptBalances } from './receipt'
import type { Company, Invoice, Payment, PaymentMethodKey, RateSnapshot } from './types'
import './admin.css'

type PaymentDraft = {
  invoiceNumber: string
  amount: string
  method: PaymentMethodKey
  date: string
  rate: string
  reference: string
  notes: string
}

const today = () => new Date().toISOString().slice(0, 10)
const numberValue = (raw: string) => {
  let value = raw.trim().replace(/\s/g, '').replace(/[^0-9,.-]/g, '')
  const comma = value.lastIndexOf(',')
  const dot = value.lastIndexOf('.')
  if (comma >= 0 && dot >= 0) value = comma > dot ? value.replace(/\./g, '').replace(',', '.') : value.replace(/,/g, '')
  else if (comma >= 0) value = value.replace(',', '.')
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}
const displayNumber = (value: number) => value.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function PaymentsView() {
  const companyId = getActiveCompanyId()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [company, setCompany] = useState<Company | null>(null)
  const [proofs, setProofs] = useState<PaymentProofSubmission[]>([])
  const [activeProofId, setActiveProofId] = useState('')
  const [rates, setRates] = useState<RateSnapshot | null>(getCachedRates())
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [draft, setDraft] = useState<PaymentDraft>({ invoiceNumber: '', amount: '', method: 'mobile', date: today(), rate: '', reference: '', notes: '' })
  const ownerUid = firebaseAuth?.currentUser?.uid || ''

  async function load(forceRates = false) {
    const [invoiceRows, paymentRows, companyRow, nextRates] = await Promise.all([
      db.invoices.orderBy('updatedAt').reverse().toArray(),
      db.payments.orderBy('date').reverse().toArray(),
      db.company.get(companyId),
      forceRates ? fetchLiveRates(true).catch(() => getCachedRates()) : refreshRatesIfDue(),
    ])
    setInvoices(invoiceRows.filter(row => (row.companyId || 1) === companyId))
    setPayments(paymentRows.filter(row => (row.companyId || 1) === companyId))
    setCompany(companyRow || null)
    if (nextRates) setRates(nextRates)
  }

  useEffect(() => { void load(false) }, [])
  useEffect(() => ownerUid ? subscribePaymentProofs(ownerUid, setProofs) : () => undefined, [ownerUid])

  const eligible = useMemo(() => invoices.filter(invoice => invoice.status !== 'draft' && invoice.status !== 'cancelled'), [invoices])
  const selected = eligible.find(invoice => invoice.number === draft.invoiceNumber)
  const applied = selected ? appliedForInvoice(selected.number, payments) : 0
  const balance = selected ? balanceForInvoice(selected, payments) : 0
  const invoiceTotal = selected ? totals(selected).total : 0
  const rateNumber = numberValue(draft.rate)
  const amountNumber = numberValue(draft.amount)
  const amountVes = selected ? paymentAmountVes(amountNumber, selected.currency, rateNumber) : 0
  const visibleProofs = proofs.filter(proof => (proof.companyId || 1) === companyId && (proof.status === 'pending' || proof.status === 'reviewing'))

  function chooseInvoice(number: string) {
    const invoice = eligible.find(item => item.number === number)
    if (!invoice) return setDraft(current => ({ ...current, invoiceNumber: number }))
    const suggested = suggestedPaymentRate(invoice, rates)
    const outstanding = balanceForInvoice(invoice, payments)
    setDraft(current => ({ ...current, invoiceNumber: number, amount: outstanding ? String(outstanding) : '', rate: suggested ? String(suggested) : '' }))
  }

  function changeMethod(method: PaymentMethodKey) {
    if (!selected) return setDraft(current => ({ ...current, method }))
    let nextRate = suggestedPaymentRate(selected, rates)
    if (method === 'binance' && ['USD', 'USDT'].includes(selected.currency.toUpperCase())) nextRate = Number(rates?.binanceBuy || rates?.usdtAverage) || nextRate
    setDraft(current => ({ ...current, method, rate: nextRate ? String(nextRate) : current.rate }))
  }

  function balancesForReceipt(payment: Payment, invoice: Invoice): ReceiptBalances {
    const total = totals(invoice).total
    const ordered = payments
      .filter(item => item.invoiceNumber === invoice.number)
      .slice()
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    let appliedBefore = 0
    for (const item of ordered) {
      if (item.key === payment.key) break
      appliedBefore += Number(item.amountApplied) || 0
    }
    const before = Math.max(0, total - appliedBefore)
    return { before, after: Math.max(0, before - (Number(payment.amountApplied) || 0)) }
  }

  function downloadReceipt(payment: Payment) {
    const invoice = invoices.find(item => item.number === payment.invoiceNumber)
    if (!invoice || !company) return setMessage('No se pudo preparar el recibo porque faltan datos de la empresa o de la factura.')
    downloadPaymentReceipt(payment, invoice, company, balancesForReceipt(payment, invoice))
    setMessage('Recibo de pago generado nuevamente.')
  }

  async function openProof(proof: PaymentProofSubmission) {
    try {
      const url = await paymentProofFileUrl(proof.storagePath)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      setMessage('No se pudo abrir la imagen del comprobante. Intenta actualizar la pantalla.')
    }
  }

  async function useProof(proof: PaymentProofSubmission) {
    const invoice = eligible.find(item => item.number === proof.invoiceNumber)
    if (!invoice) return setMessage(`No encontré ${proof.invoiceNumber} dentro del negocio activo.`)
    let nextRate = suggestedPaymentRate(invoice, rates)
    if (proof.paymentMethod === 'binance' && ['USD', 'USDT'].includes(invoice.currency.toUpperCase())) nextRate = Number(rates?.binanceBuy || rates?.usdtAverage) || nextRate
    const proofCurrency = (proof.amountCurrency || '').toUpperCase()
    const invoiceCurrency = invoice.currency.toUpperCase()
    let amountApplied = Number(proof.amountPaid) || 0

    if (proofCurrency !== invoiceCurrency) {
      if (proofCurrency === 'VES' && invoiceCurrency !== 'VES' && nextRate > 0) amountApplied = amountApplied / nextRate
      else if (invoiceCurrency === 'VES' && proofCurrency === 'VES') amountApplied = Number(proof.amountPaid) || 0
      else return setMessage(`El cliente reportó ${proof.amountCurrency}. Revisa el voucher y coloca manualmente el monto aplicado en ${invoice.currency}.`)
    }

    setActiveProofId(proof.id)
    setDraft({
      invoiceNumber: invoice.number,
      amount: displayNumber(amountApplied),
      method: proof.paymentMethod,
      date: proof.paymentDate || today(),
      rate: invoiceCurrency === 'VES' ? '1' : nextRate ? String(nextRate) : '',
      reference: proof.reference || '',
      notes: [proof.note, `Comprobante recibido desde el enlace de ${invoice.number}.`].filter(Boolean).join(' '),
    })
    if (ownerUid) await setPaymentProofStatus(ownerUid, proof.id, 'reviewing').catch(() => undefined)
    setMessage('Comprobante cargado en el formulario. Revisa monto, tasa y referencia antes de registrar el cobro.')
    document.querySelector('.paymentFormCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function rejectProof(proof: PaymentProofSubmission) {
    if (!ownerUid || !confirm(`¿Descartar el comprobante recibido para ${proof.invoiceNumber}?`)) return
    await setPaymentProofStatus(ownerUid, proof.id, 'rejected')
    if (activeProofId === proof.id) setActiveProofId('')
    setMessage('Comprobante descartado. No se registró ningún cobro.')
  }

  async function registerPayment() {
    if (!selected) return setMessage('Selecciona una factura.')
    if (amountNumber <= 0) return setMessage('Escribe un monto válido.')
    if (amountNumber > balance + 0.005) return setMessage(`El abono supera el saldo pendiente de ${money(balance, selected.currency)}.`)
    if (selected.currency.toUpperCase() !== 'VES' && rateNumber <= 0) return setMessage('Indica la tasa usada para convertir este cobro a bolívares.')
    setSaving(true)
    try {
      const now = new Date().toISOString()
      const proofId = activeProofId || undefined
      const payment: Payment = {
        companyId,
        key: paymentKey(),
        invoiceNumber: selected.number,
        invoiceCurrency: selected.currency,
        amountApplied: amountNumber,
        method: draft.method,
        date: draft.date || today(),
        reference: draft.reference.trim() || undefined,
        notes: draft.notes.trim() || undefined,
        rateValue: selected.currency.toUpperCase() === 'VES' ? 1 : rateNumber,
        amountVes,
        rateCapturedAt: rates?.capturedAt || now,
        rateSnapshot: rates ? { ...rates } : undefined,
        proofSubmissionId: proofId,
        createdAt: now,
        updatedAt: now,
      }
      await db.payments.add(payment)
      await reconcileInvoiceStatus(selected)
      if (proofId && ownerUid) await setPaymentProofStatus(ownerUid, proofId, 'processed').catch(() => undefined)
      const receiptBalances = { before: balance, after: Math.max(0, balance - amountNumber) }
      if (company) downloadPaymentReceipt(payment, selected, company, receiptBalances)
      const baseMessage = amountNumber + 0.005 >= balance ? 'Cobro completo registrado. La factura quedó pagada.' : 'Abono registrado. La factura mantiene saldo pendiente.'
      setMessage(company ? `${baseMessage} Se generó automáticamente el recibo PDF.` : baseMessage)
      setActiveProofId('')
      setDraft({ invoiceNumber: '', amount: '', method: 'mobile', date: today(), rate: '', reference: '', notes: '' })
      await load(false)
    } finally {
      setSaving(false)
    }
  }

  async function removePayment(payment: Payment) {
    if (!payment.id || !confirm('¿Eliminar este cobro? El saldo de la factura se recalculará.')) return
    const invoice = invoices.find(item => item.number === payment.invoiceNumber)
    await db.payments.delete(payment.id)
    if (invoice) await reconcileInvoiceStatus(invoice)
    setMessage('Cobro eliminado y saldo recalculado.')
    await load(false)
  }

  const totalLedgerVes = payments.reduce((sum, payment) => sum + (Number(payment.amountVes) || 0), 0)
  const partialInvoices = eligible.filter(invoice => {
    const paid = appliedForInvoice(invoice.number, payments)
    return paid > 0 && balanceForInvoice(invoice, payments) > 0.005
  }).length

  return <main className="adminPage">
    <section className="adminHero paymentsHero">
      <div><span>ZIVIFACTURA · CAJA</span><h1>Cobros, abonos y saldos</h1><p>Registra cada ingreso del negocio activo por separado. Los clientes pueden enviar su voucher directamente desde el enlace compartido.</p></div>
      <button className="secondary" onClick={() => void load(true)}>Actualizar tasas</button>
    </section>

    <section className="statsMetrics paymentMetrics">
      <article><WalletCards/><span>Movimientos registrados</span><strong>{payments.length}</strong></article>
      <article><CircleDollarSign/><span>Ingresos registrados en Bs</span><strong>{money(totalLedgerVes, 'VES')}</strong></article>
      <article><ReceiptText/><span>Facturas con abonos parciales</span><strong>{partialInvoices}</strong></article>
    </section>

    {ownerUid && <section className="card proofInbox">
      <div className="adminCardHead"><div><span>COMPROBANTES RECIBIDOS</span><h2>Pagos enviados a este negocio</h2><p>Estos vouchers todavía no modifican Caja. Abre el comprobante, valida el pago y luego cárgalo en el formulario para registrarlo.</p></div><FileCheck2 size={24}/></div>
      {visibleProofs.length ? <div className="proofInboxList">{visibleProofs.map(proof => <article key={proof.id} className={activeProofId === proof.id ? 'active' : ''}>
        <div className="proofMain"><strong>{proof.invoiceNumber} · {proof.clientName || 'Cliente'}</strong><span>{proof.paymentDate || 'Sin fecha'} · {paymentMethodLabels[proof.paymentMethod] || 'Otro método'} · {proof.reference ? `Ref. ${proof.reference}` : 'Sin referencia'}</span><small>El cliente reportó {money(Number(proof.amountPaid) || 0, proof.amountCurrency || 'VES')}</small></div>
        <span className={`proofStatus ${proof.status}`}>{proof.status === 'reviewing' ? 'En revisión' : 'Pendiente'}</span>
        <div className="proofActions"><button className="secondary" onClick={() => void openProof(proof)}><ExternalLink size={15}/>Ver voucher</button><button className="primary" onClick={() => void useProof(proof)}><FileCheck2 size={15}/>Usar en cobro</button><button className="danger icon" title="Descartar comprobante" onClick={() => void rejectProof(proof)}><XCircle size={17}/></button></div>
      </article>)}</div> : <div className="adminEmpty">No tienes comprobantes pendientes para este negocio.</div>}
    </section>}

    <section className="paymentsLayout">
      <section className="card paymentFormCard">
        <div className="adminCardHead"><div><span>NUEVO MOVIMIENTO</span><h2>Registrar cobro o abono</h2><p>El monto se aplica al saldo en la moneda de la factura. La tasa queda congelada en este movimiento y al guardar se descarga un recibo.</p></div><Plus size={24}/></div>
        {activeProofId && <div className="proofLoaded"><FileCheck2 size={17}/><span>Estás registrando un cobro a partir de un comprobante enviado por el cliente. Confirma los datos antes de guardar.</span></div>}
        <div className="paymentFormGrid">
          <label className="field wide"><span>Factura</span><select value={draft.invoiceNumber} onChange={event => { setActiveProofId(''); chooseInvoice(event.target.value) }}><option value="">Seleccionar factura…</option>{eligible.map(invoice => { const outstanding = balanceForInvoice(invoice, payments); const hasLedger = appliedForInvoice(invoice.number, payments) > 0; return <option value={invoice.number} key={invoice.number}>{invoice.number} · {invoice.client.name || 'Sin cliente'} · saldo {money(outstanding, invoice.currency)}{invoice.status === 'paid' && !hasLedger ? ' · pagada sin movimientos' : ''}</option> })}</select></label>
          {selected && <div className="paymentInvoiceSummary wide"><div><span>Total</span><strong>{money(invoiceTotal, selected.currency)}</strong></div><div><span>Abonado</span><strong>{money(applied, selected.currency)}</strong></div><div><span>Saldo</span><strong>{money(balance, selected.currency)}</strong></div></div>}
          <label className="field"><span>Monto aplicado ({selected?.currency || 'moneda factura'})</span><input inputMode="decimal" value={draft.amount} onChange={event => setDraft(current => ({ ...current, amount: event.target.value }))} placeholder="0,00"/></label>
          <label className="field"><span>Método de pago</span><select value={draft.method} onChange={event => changeMethod(event.target.value as PaymentMethodKey)}>{paymentMethodOptions.map(option => <option value={option.key} key={option.key}>{option.label}</option>)}</select></label>
          <label className="field"><span>Fecha real del ingreso</span><input type="date" value={draft.date} onChange={event => setDraft(current => ({ ...current, date: event.target.value }))}/></label>
          <label className="field"><span>Tasa usada (Bs por {selected?.currency || 'unidad'})</span><input inputMode="decimal" value={draft.rate} disabled={selected?.currency.toUpperCase() === 'VES'} onChange={event => setDraft(current => ({ ...current, rate: event.target.value }))} placeholder="0,00"/></label>
          <label className="field"><span>Referencia</span><input value={draft.reference} onChange={event => setDraft(current => ({ ...current, reference: event.target.value }))} placeholder="N.º operación, comprobante…"/></label>
          <label className="field"><span>Equivalente registrado</span><input value={selected ? money(amountVes, 'VES') : ''} readOnly placeholder="Bs 0,00"/></label>
          <label className="field wide"><span>Nota</span><textarea rows={2} value={draft.notes} onChange={event => setDraft(current => ({ ...current, notes: event.target.value }))} placeholder="Observación opcional sobre este cobro"/></label>
        </div>
        {message && <div className="paymentMessage"><CheckCircle2 size={17}/>{message}</div>}
        <button className="primary full" disabled={saving || !selected} onClick={() => void registerPayment()}>{saving ? 'Registrando…' : 'Registrar movimiento y generar recibo'}</button>
      </section>

      <section className="card ledgerCard">
        <div className="adminCardHead"><div><span>LIBRO DE CAJA</span><h2>Últimos movimientos</h2><p>Cada fila representa dinero realmente registrado como ingreso. Puedes volver a descargar el recibo en cualquier momento.</p></div></div>
        {payments.length ? <div className="ledgerList">{payments.slice(0, 30).map(payment => { const invoice = invoices.find(item => item.number === payment.invoiceNumber); return <article key={payment.key}><div className="ledgerMain"><strong>{paymentMethodLabels[payment.method]}</strong><span>{payment.date} · {payment.invoiceNumber} · {invoice?.client.name || 'Cliente'}</span>{payment.reference && <small>Ref. {payment.reference}</small>}{payment.proofSubmissionId && <small>✓ Comprobante recibido desde el enlace</small>}</div><div className="ledgerAmounts"><strong>{money(payment.amountApplied, payment.invoiceCurrency)}</strong><span>{money(payment.amountVes, 'VES')}</span></div><div className="actions"><button title="Descargar recibo" onClick={() => downloadReceipt(payment)}><Download size={16}/></button><button className="danger" title="Eliminar cobro" onClick={() => void removePayment(payment)}><Trash2 size={16}/></button></div></article>})}</div> : <div className="adminEmpty">Todavía no has registrado cobros en este negocio.</div>}
      </section>
    </section>

    <p className="adminFootnote">Los comprobantes enviados por clientes permanecen pendientes hasta que tú los revises. Solo al registrar el movimiento se modifica Caja, se descuenta el saldo de la factura y se genera el recibo.</p>
  </main>
}
