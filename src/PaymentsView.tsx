import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, CircleDollarSign, Plus, ReceiptText, Trash2, WalletCards } from 'lucide-react'
import { db } from './db'
import { money, totals } from './pdf'
import { fetchLiveRates, getCachedRates, refreshRatesIfDue } from './rates'
import { appliedForInvoice, balanceForInvoice, paymentAmountVes, paymentKey, paymentMethodLabels, paymentMethodOptions, reconcileInvoiceStatus, suggestedPaymentRate } from './payments'
import type { Invoice, Payment, PaymentMethodKey, RateSnapshot } from './types'
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
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [rates, setRates] = useState<RateSnapshot | null>(getCachedRates())
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [draft, setDraft] = useState<PaymentDraft>({ invoiceNumber: '', amount: '', method: 'mobile', date: today(), rate: '', reference: '', notes: '' })

  async function load(forceRates = false) {
    const [invoiceRows, paymentRows, nextRates] = await Promise.all([
      db.invoices.orderBy('updatedAt').reverse().toArray(),
      db.payments.orderBy('date').reverse().toArray(),
      forceRates ? fetchLiveRates(true).catch(() => getCachedRates()) : refreshRatesIfDue(),
    ])
    setInvoices(invoiceRows)
    setPayments(paymentRows)
    if (nextRates) setRates(nextRates)
  }

  useEffect(() => { void load(false) }, [])

  const eligible = useMemo(() => invoices.filter(invoice => invoice.status !== 'draft' && invoice.status !== 'cancelled'), [invoices])
  const selected = eligible.find(invoice => invoice.number === draft.invoiceNumber)
  const applied = selected ? appliedForInvoice(selected.number, payments) : 0
  const balance = selected ? balanceForInvoice(selected, payments) : 0
  const invoiceTotal = selected ? totals(selected).total : 0
  const rateNumber = numberValue(draft.rate)
  const amountNumber = numberValue(draft.amount)
  const amountVes = selected ? paymentAmountVes(amountNumber, selected.currency, rateNumber) : 0

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

  async function registerPayment() {
    if (!selected) return setMessage('Selecciona una factura.')
    if (amountNumber <= 0) return setMessage('Escribe un monto válido.')
    if (amountNumber > balance + 0.005) return setMessage(`El abono supera el saldo pendiente de ${money(balance, selected.currency)}.`)
    if (selected.currency.toUpperCase() !== 'VES' && rateNumber <= 0) return setMessage('Indica la tasa usada para convertir este cobro a bolívares.')
    setSaving(true)
    try {
      const now = new Date().toISOString()
      const payment: Payment = {
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
        createdAt: now,
        updatedAt: now,
      }
      await db.payments.add(payment)
      await reconcileInvoiceStatus(selected)
      setMessage(amountNumber + 0.005 >= balance ? 'Cobro completo registrado. La factura quedó pagada.' : 'Abono registrado. La factura mantiene saldo pendiente.')
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
      <div><span>ZIVIFACTURA · CAJA</span><h1>Cobros, abonos y saldos</h1><p>Registra cada ingreso por separado. Una factura puede recibir varios pagos, en fechas y métodos distintos, hasta completar su saldo.</p></div>
      <button className="secondary" onClick={() => void load(true)}>Actualizar tasas</button>
    </section>

    <section className="statsMetrics paymentMetrics">
      <article><WalletCards/><span>Movimientos registrados</span><strong>{payments.length}</strong></article>
      <article><CircleDollarSign/><span>Ingresos registrados en Bs</span><strong>{money(totalLedgerVes, 'VES')}</strong></article>
      <article><ReceiptText/><span>Facturas con abonos parciales</span><strong>{partialInvoices}</strong></article>
    </section>

    <section className="paymentsLayout">
      <section className="card paymentFormCard">
        <div className="adminCardHead"><div><span>NUEVO MOVIMIENTO</span><h2>Registrar cobro o abono</h2><p>El monto se aplica al saldo en la moneda de la factura. La tasa queda congelada en este movimiento.</p></div><Plus size={24}/></div>
        <div className="paymentFormGrid">
          <label className="field wide"><span>Factura</span><select value={draft.invoiceNumber} onChange={event => chooseInvoice(event.target.value)}><option value="">Seleccionar factura…</option>{eligible.map(invoice => { const outstanding = balanceForInvoice(invoice, payments); const hasLedger = appliedForInvoice(invoice.number, payments) > 0; return <option value={invoice.number} key={invoice.number}>{invoice.number} · {invoice.client.name || 'Sin cliente'} · saldo {money(outstanding, invoice.currency)}{invoice.status === 'paid' && !hasLedger ? ' · pagada sin movimientos' : ''}</option> })}</select></label>
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
        <button className="primary full" disabled={saving || !selected} onClick={() => void registerPayment()}>{saving ? 'Registrando…' : 'Registrar movimiento'}</button>
      </section>

      <section className="card ledgerCard">
        <div className="adminCardHead"><div><span>LIBRO DE CAJA</span><h2>Últimos movimientos</h2><p>Cada fila representa dinero realmente registrado como ingreso.</p></div></div>
        {payments.length ? <div className="ledgerList">{payments.slice(0, 30).map(payment => { const invoice = invoices.find(item => item.number === payment.invoiceNumber); return <article key={payment.key}><div className="ledgerMain"><strong>{paymentMethodLabels[payment.method]}</strong><span>{payment.date} · {payment.invoiceNumber} · {invoice?.client.name || 'Cliente'}</span>{payment.reference && <small>Ref. {payment.reference}</small>}</div><div className="ledgerAmounts"><strong>{money(payment.amountApplied, payment.invoiceCurrency)}</strong><span>{money(payment.amountVes, 'VES')}</span></div><button className="danger icon" title="Eliminar cobro" onClick={() => void removePayment(payment)}><Trash2 size={16}/></button></article>})}</div> : <div className="adminEmpty">Todavía no has registrado cobros. Selecciona una factura y registra el primer ingreso.</div>}
      </section>
    </section>

    <p className="adminFootnote">La caja usa la fecha real de cada movimiento y conserva la tasa utilizada en ese momento. El saldo se calcula en la moneda original de la factura.</p>
  </main>
}
