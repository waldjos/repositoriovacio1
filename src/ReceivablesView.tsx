import { useEffect, useMemo, useState } from 'react'
import { Clock3, DollarSign, RefreshCw, TrendingUp, WalletCards } from 'lucide-react'
import { db } from './db'
import { money, totals } from './pdf'
import { balanceForInvoice, currentReceivableRate, appliedForInvoice, receivableBalanceVes, paymentMethodLabels } from './payments'
import { fetchLiveRates, getCachedRates, pivotConversions, rateSourceLabels, refreshRatesIfDue } from './rates'
import type { Invoice, Payment, RateSnapshot } from './types'
import './receivables.css'

type AgingKey = 'fresh' | 'mid' | 'old'

function daysOpen(invoice: Invoice) {
  const raw = invoice.dueDate || invoice.date
  const start = new Date(`${raw}T12:00:00`)
  if (Number.isNaN(start.getTime())) return 0
  const today = new Date()
  const current = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12)
  return Math.max(0, Math.floor((current.getTime() - start.getTime()) / 86_400_000))
}

function agingKey(days: number): AgingKey {
  if (days <= 7) return 'fresh'
  if (days <= 30) return 'mid'
  return 'old'
}

function rateLabel(invoice: Invoice) {
  if (invoice.currency.toUpperCase() === 'VES') return 'Bolívares'
  if (invoice.rateSource === 'custom') return 'Tasa personalizada fija'
  if (invoice.rateSource && invoice.rateSource !== 'none') return `${rateSourceLabels[invoice.rateSource]} vigente`
  if (invoice.currency.toUpperCase() === 'EUR') return 'BCV euro vigente'
  if (invoice.currency.toUpperCase() === 'USDT') return 'USDT Binance vigente'
  if (invoice.currency.toUpperCase() === 'USD') return 'BCV dólar vigente'
  return `Referencia actual ${invoice.currency}`
}

export default function ReceivablesView() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [rates, setRates] = useState<RateSnapshot | null>(getCachedRates())
  const [loading, setLoading] = useState(false)

  async function load(forceRates = false) {
    setLoading(true)
    try {
      const [invoiceRows, paymentRows, nextRates] = await Promise.all([
        db.invoices.orderBy('date').toArray(),
        db.payments.toArray(),
        forceRates ? fetchLiveRates(true).catch(() => getCachedRates()) : refreshRatesIfDue(),
      ])
      setInvoices(invoiceRows)
      setPayments(paymentRows)
      if (nextRates) setRates(nextRates)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load(false)
    const timer = window.setInterval(() => {
      void refreshRatesIfDue().then(next => { if (next) setRates(next) })
    }, 15 * 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const openRows = useMemo(() => invoices
    .filter(invoice => invoice.status === 'issued')
    .map(invoice => {
      const total = totals(invoice).total
      const paid = appliedForInvoice(invoice.number, payments)
      const balance = balanceForInvoice(invoice, payments)
      const rate = currentReceivableRate(invoice, rates)
      const ves = receivableBalanceVes(invoice, payments, rates)
      const days = daysOpen(invoice)
      const invoicePayments = payments
        .filter(payment => payment.invoiceNumber === invoice.number)
        .slice()
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
      let running = total
      const history = invoicePayments.map(payment => {
        const before = running
        running = Math.max(0, running - (Number(payment.amountApplied) || 0))
        return { payment, before, after: running }
      }).reverse()
      return { invoice, total, paid, balance, rate, ves, days, history }
    })
    .filter(row => row.balance > 0.005)
    .sort((a, b) => b.days - a.days), [invoices, payments, rates])

  const summary = useMemo(() => {
    const nominal = new Map<string, number>()
    let ves = 0
    let missingRate = 0
    const aging: Record<AgingKey, { count: number; ves: number }> = {
      fresh: { count: 0, ves: 0 }, mid: { count: 0, ves: 0 }, old: { count: 0, ves: 0 },
    }
    openRows.forEach(row => {
      const currency = row.invoice.currency.toUpperCase()
      nominal.set(currency, (nominal.get(currency) || 0) + row.balance)
      if (row.rate) ves += row.ves
      else missingRate += 1
      const slot = aging[agingKey(row.days)]
      slot.count += 1
      slot.ves += row.ves
    })
    return { nominal, ves, missingRate, aging, equivalents: pivotConversions(ves, rates) }
  }, [openRows, rates])

  const nominalText = [...summary.nominal.entries()].map(([currency, value]) => money(value, currency)).join(' · ') || '0,00'
  const updated = rates?.capturedAt ? new Date(rates.capturedAt).toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' }) : 'Sin tasa disponible'

  return <main className="receivablesPage">
    <section className="receivablesHero">
      <div><span>ZIVIFACTURA · CUENTAS POR COBRAR</span><h1>Mantén la deuda en dólares y mira cuánto representa hoy en bolívares.</h1><p>El monto original de cada factura nunca se altera. Cada abono queda en el historial y se resta automáticamente del saldo pendiente antes de calcular su valoración actual.</p></div>
      <button className="secondary" disabled={loading} onClick={() => void load(true)}><RefreshCw size={17} className={loading ? 'spin' : ''}/>{loading ? 'Actualizando…' : 'Actualizar valoración'}</button>
    </section>

    <section className="receivableSummary">
      <article className="receivablePrimary"><WalletCards/><span>SALDO NOMINAL PENDIENTE</span><strong>{nominalText}</strong><small>{openRows.length} factura{openRows.length === 1 ? '' : 's'} abierta{openRows.length === 1 ? '' : 's'}. Este saldo ya descuenta todos los abonos registrados.</small></article>
      <div className="receivableKpis">
        <article><span>Equivalente hoy</span><strong>{money(summary.ves, 'VES')}</strong><small>Valoración dinámica</small></article>
        <article><span>Equiv. USD BCV</span><strong>{summary.equivalents.USD != null ? money(summary.equivalents.USD, 'USD') : 'N/D'}</strong><small>Sobre el total valorizado</small></article>
        <article><span>Equiv. EUR BCV</span><strong>{summary.equivalents.EUR != null ? money(summary.equivalents.EUR, 'EUR') : 'N/D'}</strong><small>Sobre el total valorizado</small></article>
        <article><span>Sin tasa disponible</span><strong>{summary.missingRate}</strong><small>Revisar moneda o referencia</small></article>
      </div>
    </section>

    <section className="receivableMeta"><span>Última actualización de tasas: <strong>{updated}</strong></span><span>La valoración cambia; <strong>la factura no.</strong></span></section>

    <section className="agingGrid">
      <article><Clock3/><span>0–7 días</span><strong>{summary.aging.fresh.count}</strong><small>{money(summary.aging.fresh.ves, 'VES')}</small></article>
      <article><Clock3/><span>8–30 días</span><strong>{summary.aging.mid.count}</strong><small>{money(summary.aging.mid.ves, 'VES')}</small></article>
      <article><TrendingUp/><span>Más de 30 días</span><strong>{summary.aging.old.count}</strong><small>{money(summary.aging.old.ves, 'VES')}</small></article>
    </section>

    <section className="card receivableListCard">
      <div className="receivableListHead"><div><span>DETALLE</span><h2>Facturas pendientes</h2><p>Los abonos registrados en Caja se descuentan automáticamente y quedan visibles como historial de movimientos de cada factura.</p></div><DollarSign size={24}/></div>
      {openRows.length ? <div className="receivableList">{openRows.map(row => <article key={row.invoice.number}>
        <div className="receivableTopRow">
          <div className="receivableDoc"><strong>{row.invoice.number}</strong><span>{row.invoice.client.name || 'Sin cliente'}</span><small>{row.days} día{row.days === 1 ? '' : 's'} pendiente{row.days === 1 ? '' : 's'}</small></div>
          <div className="receivableAmounts"><span>Factura <b>{money(row.total, row.invoice.currency)}</b></span>{row.paid > 0 && <span>Abonado <b>{money(row.paid, row.invoice.currency)}</b></span>}<span>Saldo <strong>{money(row.balance, row.invoice.currency)}</strong></span></div>
          <div className="receivableToday"><span>Valor hoy</span><strong>{row.rate ? money(row.ves, 'VES') : 'Sin tasa'}</strong><small>{rateLabel(row.invoice)}{row.rate ? ` · ${row.rate.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs` : ''}</small></div>
        </div>
        {row.history.length > 0 && <div className="receivableHistory"><div className="receivableHistoryTitle"><strong>Historial de abonos</strong><span>{row.history.length} movimiento{row.history.length === 1 ? '' : 's'}</span></div>{row.history.map(({ payment, before, after }) => <div className="receivableHistoryRow" key={payment.key}><div><strong>{payment.date}</strong><span>{paymentMethodLabels[payment.method]}{payment.reference ? ` · Ref. ${payment.reference}` : ''}</span></div><div><span>Abono</span><strong>- {money(payment.amountApplied, row.invoice.currency)}</strong></div><div><span>Saldo</span><strong>{money(after, row.invoice.currency)}</strong><small>Antes: {money(before, row.invoice.currency)}</small></div></div>)}</div>}
      </article>)}</div> : <div className="adminEmpty">No tienes facturas pendientes por cobrar.</div>}
    </section>

    <p className="adminFootnote">Esta pantalla es una valoración administrativa dinámica de cuentas por cobrar. No reescribe el monto ni la tasa congelada dentro del PDF emitido.</p>
  </main>
}
