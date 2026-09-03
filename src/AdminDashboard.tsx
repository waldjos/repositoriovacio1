import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Calculator, CircleDollarSign, RefreshCw, WalletCards } from 'lucide-react'
import { db } from './db'
import { getActiveCompanyId } from './companyScope'
import { money, totals } from './pdf'
import { fetchLiveRates, getCachedRates, pivotConversions, refreshRatesIfDue } from './rates'
import { appliedForInvoice, balanceForInvoice, legacyPaymentMethod, paymentMethodLabels, currentRateForCurrency } from './payments'
import type { Invoice, Payment, PaymentMethodKey, RateSnapshot } from './types'
import './admin.css'

type AdminView = 'income' | 'stats'
type Period = 'today' | 'month' | '30d' | 'year' | 'all'

type CashMovement = {
  key: string
  invoiceNumber: string
  date: string
  method: PaymentMethodKey
  amount: number
  currency: string
  ves: number
  legacy?: boolean
}

function recordDate(raw: string) {
  const parsed = new Date(`${raw}T12:00:00`)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

function inPeriod(dateRaw: string, period: Period) {
  if (period === 'all') return true
  const date = recordDate(dateRaw)
  const now = new Date()
  if (period === 'today') return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
  if (period === 'month') return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
  if (period === 'year') return date.getFullYear() === now.getFullYear()
  const limit = new Date(now)
  limit.setDate(limit.getDate() - 30)
  return date >= limit
}

function invoiceVes(invoice: Invoice, rates: RateSnapshot | null) {
  const total = totals(invoice).total
  if (invoice.currency.toUpperCase() === 'VES') return total
  const rate = Number(invoice.rateValue) || currentRateForCurrency(invoice.currency, rates)
  return rate ? total * rate : 0
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(date: Date) {
  return date.toLocaleDateString('es-VE', { month: 'short', year: '2-digit' }).replace('.', '')
}

function formatNumber(value?: number, suffix = '') {
  if (!Number.isFinite(value)) return 'No disponible'
  return `${Number(value).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${suffix}`
}

export default function AdminDashboard({ view }: { view: AdminView }) {
  const companyId = getActiveCompanyId()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [rates, setRates] = useState<RateSnapshot | null>(getCachedRates())
  const [period, setPeriod] = useState<Period>('today')
  const [loading, setLoading] = useState(false)

  async function load(forceRates = false) {
    setLoading(true)
    try {
      const [invoiceRows, paymentRows, nextRates] = await Promise.all([
        db.invoices.orderBy('updatedAt').reverse().toArray(),
        db.payments.orderBy('date').reverse().toArray(),
        forceRates ? fetchLiveRates(true).catch(() => getCachedRates()) : refreshRatesIfDue(),
      ])
      setInvoices(invoiceRows.filter(row => (row.companyId || 1) === companyId))
      setPayments(paymentRows.filter(row => (row.companyId || 1) === companyId))
      if (nextRates) setRates(nextRates)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load(false) }, [])

  const invoiceMap = useMemo(() => new Map(invoices.map(invoice => [invoice.number, invoice])), [invoices])

  const allMovements = useMemo<CashMovement[]>(() => {
    const actual: CashMovement[] = payments.map(payment => ({
      key: payment.key,
      invoiceNumber: payment.invoiceNumber,
      date: payment.date,
      method: payment.method,
      amount: payment.amountApplied,
      currency: payment.invoiceCurrency,
      ves: Number(payment.amountVes) || 0,
    }))
    const invoicesWithLedger = new Set(payments.map(payment => payment.invoiceNumber))
    const legacy: CashMovement[] = invoices
      .filter(invoice => invoice.status === 'paid' && !invoicesWithLedger.has(invoice.number))
      .map(invoice => ({
        key: `legacy-${invoice.number}`,
        invoiceNumber: invoice.number,
        date: invoice.date,
        method: legacyPaymentMethod(invoice),
        amount: totals(invoice).total,
        currency: invoice.currency,
        ves: invoiceVes(invoice, rates),
        legacy: true,
      }))
    return [...actual, ...legacy]
  }, [invoices, payments, rates])

  const movements = useMemo(() => allMovements.filter(movement => inPeriod(movement.date, period)), [allMovements, period])

  const summary = useMemo(() => {
    const totalVes = movements.reduce((sum, movement) => sum + movement.ves, 0)
    const original = new Map<string, number>()
    const methodMap = new Map<PaymentMethodKey, { count: number; ves: number }>()
    movements.forEach(movement => {
      original.set(movement.currency, (original.get(movement.currency) || 0) + movement.amount)
      const current = methodMap.get(movement.method) || { count: 0, ves: 0 }
      current.count += 1
      current.ves += movement.ves
      methodMap.set(movement.method, current)
    })
    const paymentsByMethod = (Object.keys(paymentMethodLabels) as PaymentMethodKey[])
      .map(key => ({ key, label: paymentMethodLabels[key], ...(methodMap.get(key) || { count: 0, ves: 0 }) }))
      .filter(item => item.count > 0)
      .sort((a, b) => b.count - a.count)
    return {
      totalVes,
      original,
      paymentsByMethod,
      equivalents: pivotConversions(totalVes, rates),
      legacyCount: movements.filter(movement => movement.legacy).length,
    }
  }, [movements, rates])

  const trend = useMemo(() => {
    const now = new Date()
    const months = Array.from({ length: 6 }, (_, index) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1)
      return { key: monthKey(d), label: monthLabel(d), value: 0 }
    })
    const map = new Map(months.map(item => [item.key, item]))
    allMovements.forEach(movement => {
      const slot = map.get(monthKey(recordDate(movement.date)))
      if (slot) slot.value += movement.ves
    })
    return months
  }, [allMovements])

  const partialCount = useMemo(() => invoices.filter(invoice => {
    const applied = appliedForInvoice(invoice.number, payments)
    return applied > 0 && balanceForInvoice(invoice, payments) > 0.005
  }).length, [invoices, payments])

  const outstandingVes = useMemo(() => invoices.filter(invoice => invoice.status === 'issued').reduce((sum, invoice) => {
    const balance = balanceForInvoice(invoice, payments)
    if (!balance) return sum
    if (invoice.currency.toUpperCase() === 'VES') return sum + balance
    const rate = Number(invoice.rateValue) || currentRateForCurrency(invoice.currency, rates)
    return sum + (rate ? balance * rate : 0)
  }, 0), [invoices, payments, rates])

  const movementHistory = useMemo(() => movements.slice().sort((a, b) => {
    const byDate = Date.parse(`${b.date}T12:00:00`) - Date.parse(`${a.date}T12:00:00`)
    if (byDate) return byDate
    return b.key.localeCompare(a.key)
  }), [movements])

  const maxTrend = Math.max(...trend.map(item => item.value), 1)
  const originalTotals = [...summary.original.entries()].map(([currency, value]) => money(value, currency)).join(' · ') || '0,00'
  const average = movements.length ? summary.totalVes / movements.length : 0
  const updated = rates?.capturedAt ? new Date(rates.capturedAt).toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' }) : 'Sin tasa disponible'

  return <main className="adminPage">
    <section className="adminHero">
      <div><span>ZIVIFACTURA · ADMINISTRACIÓN</span><h1>{view === 'income' ? 'Ingresos y equivalentes' : 'Estadísticas de cobro'}</h1><p>{view === 'income' ? 'Los ingresos se calculan desde cada cobro o abono registrado en el negocio activo. Cada abono también reduce automáticamente su cuenta por cobrar.' : 'Analiza los cobros del negocio activo por método de pago y equivalente en bolívares.'}</p></div>
      <button className="secondary" disabled={loading} onClick={() => void load(true)}><RefreshCw size={17} className={loading ? 'spin' : ''}/>{loading ? 'Actualizando…' : 'Actualizar datos'}</button>
    </section>

    <section className="adminFilters">
      <div className="periodTabs" aria-label="Período">
        <button className={period === 'today' ? 'active' : ''} onClick={() => setPeriod('today')}>Hoy</button>
        <button className={period === 'month' ? 'active' : ''} onClick={() => setPeriod('month')}>Este mes</button>
        <button className={period === '30d' ? 'active' : ''} onClick={() => setPeriod('30d')}>Últimos 30 días</button>
        <button className={period === 'year' ? 'active' : ''} onClick={() => setPeriod('year')}>Este año</button>
        <button className={period === 'all' ? 'active' : ''} onClick={() => setPeriod('all')}>Todo</button>
      </div>
      <span>Última tasa: <strong>{updated}</strong></span>
    </section>

    {view === 'income' ? <>
      <section className="incomePrimary">
        <article className="incomeMainCard"><div className="adminIcon"><CircleDollarSign/></div><span>{period === 'today' ? 'INGRESOS DE HOY · BASE BS' : 'INGRESOS REGISTRADOS · BASE BS'}</span><strong>{money(summary.totalVes, 'VES')}</strong><small>{movements.length} movimiento{movements.length === 1 ? '' : 's'} de caja · Original: {originalTotals}</small></article>
        <div className="incomeEquivalents">
          <article><span>USD · BCV</span><strong>{summary.equivalents.USD != null ? money(summary.equivalents.USD, 'USD') : 'N/D'}</strong></article>
          <article><span>EUR · BCV</span><strong>{summary.equivalents.EUR != null ? money(summary.equivalents.EUR, 'EUR') : 'N/D'}</strong></article>
          <article><span>USDT · Binance</span><strong>{formatNumber(summary.equivalents.USDT_BINANCE, ' USDT')}</strong></article>
          <article><span>USDT · Promedio</span><strong>{formatNumber(summary.equivalents.USDT_AVERAGE, ' USDT')}</strong></article>
        </div>
      </section>

      <section className="statsMetrics adminIncomeMetrics">
        <article><WalletCards/><span>Movimientos del período</span><strong>{movements.length}</strong></article>
        <article><CircleDollarSign/><span>Por cobrar después de abonos</span><strong>{money(outstandingVes, 'VES')}</strong></article>
        <article><Calculator/><span>Facturas parciales</span><strong>{partialCount}</strong></article>
      </section>

      <section className="card adminCard cashHistoryCard">
        <div className="adminCardHead"><div><span>HISTORIAL DE TRANSACCIONES</span><h2>Cobros y abonos del período</h2><p>Cada movimiento aumenta los ingresos de Caja y, al mismo tiempo, disminuye el saldo pendiente de la factura asociada.</p></div><WalletCards size={22}/></div>
        {movementHistory.length ? <div className="cashHistoryList">{movementHistory.map(movement => {
          const invoice = invoiceMap.get(movement.invoiceNumber)
          const client = invoice?.client.name || 'Cliente'
          const currentBalance = invoice ? balanceForInvoice(invoice, payments) : 0
          return <article key={movement.key}>
            <div className="cashHistoryMain"><strong>{client}</strong><span>{movement.invoiceNumber} · {movement.date} · {paymentMethodLabels[movement.method]}</span>{movement.legacy && <small>Registro histórico sin movimiento individual de Caja</small>}</div>
            <div className="cashHistoryPaid"><span>{movement.legacy ? 'Cobrado' : 'Abono recibido'}</span><strong>{money(movement.amount, movement.currency)}</strong><small>{money(movement.ves, 'VES')} equivalente</small></div>
            <div className="cashHistoryBalance"><span>Saldo actual factura</span><strong>{invoice ? money(currentBalance, invoice.currency) : 'N/D'}</strong><small>{currentBalance <= 0.005 ? 'Factura pagada' : 'Pendiente por cobrar'}</small></div>
          </article>
        })}</div> : <div className="adminEmpty">No hay cobros ni abonos registrados en este período.</div>}
      </section>

      <section className="adminGrid">
        <article className="card adminCard"><div className="adminCardHead"><div><span>CONTROL DE CAJA</span><h2>Calidad del registro</h2></div><Calculator size={22}/></div><div className="adminRows"><div><span>Ticket promedio por movimiento</span><strong>{money(average, 'VES')}</strong></div><div><span>Movimientos históricos heredados</span><strong>{summary.legacyCount}</strong></div><div><span>Facturas con saldo parcial</span><strong>{partialCount}</strong></div><div><span>Saldo por cobrar después de abonos</span><strong>{money(outstandingVes, 'VES')}</strong></div></div><p className="adminNote">Las facturas antiguas marcadas como pagadas y sin movimientos de caja se conservan como registros históricos. Los nuevos reportes usan los cobros y abonos reales.</p></article>
        <article className="card adminCard"><div className="adminCardHead"><div><span>ÚLTIMOS 6 MESES</span><h2>Tendencia de ingresos</h2></div><BarChart3 size={22}/></div><div className="trendList">{trend.map(item => <div className="trendRow" key={item.key}><span>{item.label}</span><div><i style={{ width: `${Math.max(item.value ? 4 : 0, (item.value / maxTrend) * 100)}%` }}/></div><strong>{money(item.value, 'VES')}</strong></div>)}</div></article>
      </section>
    </> : <>
      <section className="statsMetrics">
        <article><WalletCards/><span>Cobros y abonos</span><strong>{movements.length}</strong></article>
        <article><CircleDollarSign/><span>Total equivalente</span><strong>{money(summary.totalVes, 'VES')}</strong></article>
        <article><Calculator/><span>Ticket promedio</span><strong>{money(average, 'VES')}</strong></article>
      </section>

      <section className="card paymentStats"><div className="adminCardHead"><div><span>MÉTODOS DE PAGO</span><h2>Cómo estás recibiendo tus ingresos</h2><p>Cada abono cuenta como una operación independiente, incluso cuando pertenece a la misma factura.</p></div><BarChart3 size={24}/></div>{summary.paymentsByMethod.length ? <div className="paymentStatGrid">{summary.paymentsByMethod.map(item => <article key={item.key}><div><span>{item.label}</span><strong>{item.count}</strong></div><small>{item.count === 1 ? '1 operación' : `${item.count} operaciones`}</small><b>{money(item.ves, 'VES')}</b></article>)}</div> : <div className="adminEmpty">Todavía no hay movimientos de caja en este período.</div>}</section>

      <section className="card adminCard"><div className="adminCardHead"><div><span>DISTRIBUCIÓN</span><h2>Participación por número de operaciones</h2></div></div><div className="distributionList">{summary.paymentsByMethod.map(item => { const pct = movements.length ? (item.count / movements.length) * 100 : 0; return <div key={item.key}><span>{item.label}</span><div><i style={{ width: `${pct}%` }}/></div><strong>{pct.toFixed(1)}%</strong></div>})}</div><p className="adminNote">Pago móvil, transferencia, Binance/USDT, efectivo, Zelle y tarjeta/POS quedan normalizados desde el momento de registrar el cobro.</p></section>
    </>}

    <p className="adminFootnote">Los reportes administrativos se construyen con el libro de caja de ZiviFactura del negocio activo. No sustituyen una conciliación bancaria o contable formal.</p>
  </main>
}
