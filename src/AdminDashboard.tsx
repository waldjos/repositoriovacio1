import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Calculator, CircleDollarSign, RefreshCw, WalletCards } from 'lucide-react'
import { db } from './db'
import { money, totals } from './pdf'
import { fetchLiveRates, getCachedRates, pivotConversions, refreshRatesIfDue } from './rates'
import type { Invoice, RateSnapshot } from './types'
import './admin.css'

type AdminView = 'income' | 'stats'
type Period = 'month' | '30d' | 'year' | 'all'

type PaymentKey = 'mobile' | 'transfer' | 'binance' | 'cash' | 'zelle' | 'card' | 'other' | 'unspecified'

const PAYMENT_LABELS: Record<PaymentKey, string> = {
  mobile: 'Pago móvil',
  transfer: 'Transferencia',
  binance: 'Binance / USDT',
  cash: 'Efectivo',
  zelle: 'Zelle',
  card: 'Tarjeta / POS',
  other: 'Otro',
  unspecified: 'No especificado',
}

function normalizeText(value = '') {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function paymentCategory(invoice: Invoice): PaymentKey {
  const value = normalizeText(invoice.paymentMethod || '')
  if (!value) return 'unspecified'
  if (value.includes('pago movil') || value.includes('pago-movil') || value.includes('pagomovil')) return 'mobile'
  if (value.includes('transfer')) return 'transfer'
  if (value.includes('binance') || value.includes('usdt') || value.includes('crypto')) return 'binance'
  if (value.includes('efectivo') || value.includes('cash')) return 'cash'
  if (value.includes('zelle')) return 'zelle'
  if (value.includes('tarjeta') || value.includes('pos') || value.includes('debito') || value.includes('credito')) return 'card'
  return 'other'
}

function invoiceDate(invoice: Invoice) {
  const parsed = new Date(`${invoice.date || invoice.updatedAt.slice(0, 10)}T12:00:00`)
  return Number.isNaN(parsed.getTime()) ? new Date(invoice.updatedAt) : parsed
}

function inPeriod(invoice: Invoice, period: Period) {
  if (period === 'all') return true
  const date = invoiceDate(invoice)
  const now = new Date()
  if (period === 'month') return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
  if (period === 'year') return date.getFullYear() === now.getFullYear()
  const limit = new Date(now)
  limit.setDate(limit.getDate() - 30)
  return date >= limit
}

function currentRateForCurrency(currency: string, rates: RateSnapshot | null) {
  if (!rates) return 0
  const code = currency.toUpperCase()
  if (code === 'USD') return Number(rates.usdBcv) || 0
  if (code === 'EUR') return Number(rates.eurBcv) || 0
  if (code === 'USDT') return Number(rates.binanceBuy || rates.usdtAverage) || 0
  return 0
}

function invoiceVes(invoice: Invoice, rates: RateSnapshot | null) {
  const total = totals(invoice).total
  const currency = invoice.currency.toUpperCase()
  if (currency === 'VES') return { value: total, approximate: false }
  const frozen = Number(invoice.rateValue) || 0
  if (frozen) return { value: total * frozen, approximate: false }
  const current = currentRateForCurrency(currency, rates)
  if (current) return { value: total * current, approximate: true }
  return { value: undefined, approximate: false }
}

function formatNumber(value?: number, suffix = '') {
  if (!Number.isFinite(value)) return 'No disponible'
  return `${Number(value).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${suffix}`
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(date: Date) {
  return date.toLocaleDateString('es-VE', { month: 'short', year: '2-digit' }).replace('.', '')
}

export default function AdminDashboard({ view }: { view: AdminView }) {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [rates, setRates] = useState<RateSnapshot | null>(getCachedRates())
  const [period, setPeriod] = useState<Period>('month')
  const [loading, setLoading] = useState(false)

  async function load(forceRates = false) {
    setLoading(true)
    try {
      const [rows, nextRates] = await Promise.all([
        db.invoices.orderBy('updatedAt').reverse().toArray(),
        forceRates ? fetchLiveRates(true).catch(() => getCachedRates()) : refreshRatesIfDue(),
      ])
      setInvoices(rows)
      if (nextRates) setRates(nextRates)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load(false) }, [])

  const paid = useMemo(() => invoices.filter(invoice => invoice.status === 'paid' && inPeriod(invoice, period)), [invoices, period])

  const summary = useMemo(() => {
    let totalVes = 0
    let approximate = 0
    let missing = 0
    const original = new Map<string, number>()
    const paymentMap = new Map<PaymentKey, { count: number; ves: number }>()

    paid.forEach(invoice => {
      const total = totals(invoice).total
      original.set(invoice.currency, (original.get(invoice.currency) || 0) + total)
      const converted = invoiceVes(invoice, rates)
      if (converted.value != null) {
        totalVes += converted.value
        if (converted.approximate) approximate += 1
      } else {
        missing += 1
      }
      const key = paymentCategory(invoice)
      const current = paymentMap.get(key) || { count: 0, ves: 0 }
      current.count += 1
      if (converted.value != null) current.ves += converted.value
      paymentMap.set(key, current)
    })

    const equivalents = pivotConversions(totalVes, rates)
    const payments = (Object.keys(PAYMENT_LABELS) as PaymentKey[])
      .map(key => ({ key, label: PAYMENT_LABELS[key], ...(paymentMap.get(key) || { count: 0, ves: 0 }) }))
      .filter(item => item.count > 0)
      .sort((a, b) => b.count - a.count)
    return { totalVes, approximate, missing, original, equivalents, payments }
  }, [paid, rates])

  const trend = useMemo(() => {
    const now = new Date()
    const months = Array.from({ length: 6 }, (_, index) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1)
      return { key: monthKey(d), label: monthLabel(d), value: 0 }
    })
    const map = new Map(months.map(item => [item.key, item]))
    invoices.filter(invoice => invoice.status === 'paid').forEach(invoice => {
      const slot = map.get(monthKey(invoiceDate(invoice)))
      const converted = invoiceVes(invoice, rates)
      if (slot && converted.value != null) slot.value += converted.value
    })
    return months
  }, [invoices, rates])

  const maxTrend = Math.max(...trend.map(item => item.value), 1)
  const originalTotals = [...summary.original.entries()].map(([currency, value]) => money(value, currency)).join(' · ') || '0,00'
  const average = paid.length ? summary.totalVes / paid.length : 0
  const updated = rates?.capturedAt ? new Date(rates.capturedAt).toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' }) : 'Sin tasa disponible'

  return <main className="adminPage">
    <section className="adminHero">
      <div><span>ZIVIFACTURA · ADMINISTRACIÓN</span><h1>{view === 'income' ? 'Ingresos y equivalentes' : 'Estadísticas de cobro'}</h1><p>{view === 'income' ? 'Convierte tus facturas pagadas a bolívares y compáralas con las tasas actuales de USD, EUR y USDT.' : 'Mide cuántos cobros recibiste por cada medio de pago y cuánto representaron en bolívares.'}</p></div>
      <button className="secondary" disabled={loading} onClick={() => void load(true)}><RefreshCw size={17} className={loading ? 'spin' : ''}/>{loading ? 'Actualizando…' : 'Actualizar datos'}</button>
    </section>

    <section className="adminFilters">
      <div className="periodTabs" aria-label="Período">
        <button className={period === 'month' ? 'active' : ''} onClick={() => setPeriod('month')}>Este mes</button>
        <button className={period === '30d' ? 'active' : ''} onClick={() => setPeriod('30d')}>Últimos 30 días</button>
        <button className={period === 'year' ? 'active' : ''} onClick={() => setPeriod('year')}>Este año</button>
        <button className={period === 'all' ? 'active' : ''} onClick={() => setPeriod('all')}>Todo</button>
      </div>
      <span>Última tasa: <strong>{updated}</strong></span>
    </section>

    {view === 'income' ? <>
      <section className="incomePrimary">
        <article className="incomeMainCard"><div className="adminIcon"><CircleDollarSign/></div><span>INGRESOS PAGADOS · BASE BS</span><strong>{money(summary.totalVes, 'VES')}</strong><small>{paid.length} factura{paid.length === 1 ? '' : 's'} pagada{paid.length === 1 ? '' : 's'} · Original: {originalTotals}</small></article>
        <div className="incomeEquivalents">
          <article><span>USD · BCV</span><strong>{summary.equivalents.USD != null ? money(summary.equivalents.USD, 'USD') : 'N/D'}</strong></article>
          <article><span>EUR · BCV</span><strong>{summary.equivalents.EUR != null ? money(summary.equivalents.EUR, 'EUR') : 'N/D'}</strong></article>
          <article><span>USDT · Binance</span><strong>{formatNumber(summary.equivalents.USDT_BINANCE, ' USDT')}</strong></article>
          <article><span>USDT · Promedio</span><strong>{formatNumber(summary.equivalents.USDT_AVERAGE, ' USDT')}</strong></article>
        </div>
      </section>

      <section className="adminGrid">
        <article className="card adminCard"><div className="adminCardHead"><div><span>CONTROL DE INGRESOS</span><h2>Calidad del cálculo</h2></div><Calculator size={22}/></div><div className="adminRows"><div><span>Facturas pagadas</span><strong>{paid.length}</strong></div><div><span>Ticket promedio</span><strong>{money(average, 'VES')}</strong></div><div><span>Usaron tasa actual como aproximación</span><strong>{summary.approximate}</strong></div><div><span>Sin conversión posible</span><strong>{summary.missing}</strong></div></div><p className="adminNote">Si una factura conserva su tasa de cobro, ZiviFactura usa esa tasa histórica. Si no la tiene, usa la tasa actual solo como aproximación.</p></article>
        <article className="card adminCard"><div className="adminCardHead"><div><span>ÚLTIMOS 6 MESES</span><h2>Tendencia en bolívares</h2></div><BarChart3 size={22}/></div><div className="trendList">{trend.map(item => <div className="trendRow" key={item.key}><span>{item.label}</span><div><i style={{ width: `${Math.max(item.value ? 4 : 0, (item.value / maxTrend) * 100)}%` }}/></div><strong>{money(item.value, 'VES')}</strong></div>)}</div></article>
      </section>
    </> : <>
      <section className="statsMetrics">
        <article><WalletCards/><span>Cobros registrados</span><strong>{paid.length}</strong></article>
        <article><CircleDollarSign/><span>Total equivalente</span><strong>{money(summary.totalVes, 'VES')}</strong></article>
        <article><Calculator/><span>Ticket promedio</span><strong>{money(average, 'VES')}</strong></article>
      </section>

      <section className="card paymentStats"><div className="adminCardHead"><div><span>MÉTODOS DE PAGO</span><h2>Cómo estás recibiendo tus ingresos</h2><p>Se clasifica el texto de “Forma de pago” de cada factura pagada.</p></div><BarChart3 size={24}/></div>{summary.payments.length ? <div className="paymentStatGrid">{summary.payments.map(item => <article key={item.key}><div><span>{item.label}</span><strong>{item.count}</strong></div><small>{item.count === 1 ? '1 operación' : `${item.count} operaciones`}</small><b>{money(item.ves, 'VES')}</b></article>)}</div> : <div className="adminEmpty">Todavía no hay cobros pagados en este período.</div>}</section>

      <section className="card adminCard"><div className="adminCardHead"><div><span>DISTRIBUCIÓN</span><h2>Participación por número de operaciones</h2></div></div><div className="distributionList">{summary.payments.map(item => { const pct = paid.length ? (item.count / paid.length) * 100 : 0; return <div key={item.key}><span>{item.label}</span><div><i style={{ width: `${pct}%` }}/></div><strong>{pct.toFixed(1)}%</strong></div>})}</div><p className="adminNote">Para que estas estadísticas sean consistentes, escribe la forma de pago de manera clara: Pago móvil, Transferencia, Binance/USDT, Efectivo, Zelle o Tarjeta/POS. Los demás textos se agrupan como “Otro”.</p></section>
    </>}

    <p className="adminFootnote">Los reportes se basan en facturas marcadas como pagadas y en la fecha del documento. No sustituyen una conciliación bancaria o contable formal.</p>
  </main>
}
