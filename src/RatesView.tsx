import { useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, Calculator, RefreshCw, TrendingUp } from 'lucide-react'
import type { RateSnapshot, RateSource } from './types'
import { amountToVes, fetchLiveRates, formatRate, getCachedRates, getRateValue, pivotConversions, rateSourceLabels, refreshRatesIfDue } from './rates'
import './rates.css'

type Props = {
  onCreateInvoiceWithRate: (source: RateSource, rates: RateSnapshot) => void
  notify: (message: string) => void
}

const formatNumber = (value?: number, currency?: string) => {
  if (!Number.isFinite(value)) return 'No disponible'
  if (currency) {
    try { return new Intl.NumberFormat('es-VE', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value)) } catch { /* ignore */ }
  }
  return Number(value).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function RatesView({ onCreateInvoiceWithRate, notify }: Props) {
  const [rates, setRates] = useState<RateSnapshot | null>(getCachedRates())
  const [loading, setLoading] = useState(false)
  const [amount, setAmount] = useState('10')
  const [source, setSource] = useState<RateSource | 'ves'>('bcv_usd')
  const [customRate, setCustomRate] = useState('1')

  useEffect(() => {
    void refreshRatesIfDue().then(next => { if (next) setRates(next) })
  }, [])

  async function refresh(force = true) {
    setLoading(true)
    try {
      const next = await fetchLiveRates(force)
      setRates(next)
      notify('Tasas actualizadas.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudieron actualizar las tasas.')
    } finally {
      setLoading(false)
    }
  }

  const amountNumber = Number(String(amount).replace(/\./g, '').replace(',', '.')) || 0
  const customNumber = Number(String(customRate).replace(/\./g, '').replace(',', '.')) || 0
  const ves = useMemo(() => amountToVes(amountNumber, source, rates, customNumber), [amountNumber, source, rates, customNumber])
  const converted = useMemo(() => pivotConversions(ves, rates), [ves, rates])
  const updated = rates?.capturedAt ? new Date(rates.capturedAt).toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' }) : 'Sin actualización'

  const cards: Array<{ key: RateSource; title: string; value?: number; note: string }> = [
    { key: 'bcv_usd', title: 'Dólar BCV', value: rates?.usdBcv, note: 'Referencia oficial' },
    { key: 'bcv_eur', title: 'Euro BCV', value: rates?.eurBcv, note: 'Referencia oficial' },
    { key: 'binance', title: 'USDT Binance', value: rates?.binanceBuy, note: 'P2P · compra' },
    { key: 'usdt_average', title: 'Promedio USDT', value: rates?.usdtAverage, note: 'Binance + Bybit' },
  ]

  return <div className="ratesPage">
    <section className="ratesHero">
      <div><span>TASAS · VENEZUELA</span><h1>Convierte, compara y factura con la tasa que realmente usarás.</h1><p>Las referencias se actualizan automáticamente en las ventanas de la tarde y puedes forzar una actualización cuando lo necesites.</p></div>
      <button className="primary" disabled={loading} onClick={() => refresh(true)}><RefreshCw size={18} className={loading ? 'spin' : ''}/>{loading ? 'Actualizando…' : 'Actualizar ahora'}</button>
    </section>

    <div className="ratesMeta"><span>Última consulta: <strong>{updated}</strong></span>{Number.isFinite(rates?.brechaPct) && <span>Brecha P2P/BCV: <strong>{Number(rates?.brechaPct).toFixed(2)}%</strong></span>}<span>Fuente de mercado: <strong>usdt.com.ve</strong></span></div>

    <section className="rateCards">{cards.map(card => <article className="rateCard" key={card.key}>
      <div className="rateIcon"><TrendingUp size={18}/></div><div className="rateCardTop"><span>{card.title}</span><small>{card.note}</small></div><strong>{formatRate(card.value)}</strong>
      <button className="secondary" disabled={!card.value || !rates} onClick={() => rates && onCreateInvoiceWithRate(card.key, rates)}>Usar en factura</button>
    </article>)}</section>

    <section className="calculatorCard card">
      <div className="calculatorHead"><div><span>CALCULADORA DE CAMBIO</span><h2>Convierte cualquier monto entre VES, USD, EUR y USDT.</h2></div><Calculator size={28}/></div>
      <div className="calcGrid">
        <label className="field"><span>Monto</span><input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0,00"/></label>
        <label className="field"><span>Moneda / tasa de origen</span><select value={source} onChange={e => setSource(e.target.value as RateSource | 'ves')}>
          <option value="ves">Bolívares (VES)</option><option value="bcv_usd">USD · BCV dólar</option><option value="bcv_eur">EUR · BCV euro</option><option value="binance">USDT · Binance P2P</option><option value="usdt_average">USDT · Promedio P2P</option><option value="custom">Tasa personalizada</option>
        </select></label>
        {source === 'custom' && <label className="field"><span>Tasa personalizada (Bs por unidad)</span><input inputMode="decimal" value={customRate} onChange={e => setCustomRate(e.target.value)}/></label>}
      </div>
      <div className="conversionFlow"><div><span>Equivalente base</span><strong>{formatNumber(ves, 'VES')}</strong></div><ArrowRightLeft size={22}/><div><span>Tasa usada</span><strong>{source === 'ves' ? '1,00 Bs' : formatRate(source === 'custom' ? customNumber : getRateValue(source, rates))}</strong></div></div>
      <div className="conversionResults">
        <div><span>Bolívares</span><strong>{formatNumber(converted.VES, 'VES')}</strong></div>
        <div><span>Dólar BCV</span><strong>{formatNumber(converted.USD, 'USD')}</strong></div>
        <div><span>Euro BCV</span><strong>{formatNumber(converted.EUR, 'EUR')}</strong></div>
        <div><span>USDT Binance</span><strong>{formatNumber(converted.USDT_BINANCE)} USDT</strong></div>
        <div><span>USDT promedio</span><strong>{formatNumber(converted.USDT_AVERAGE)} USDT</strong></div>
      </div>
      <p className="ratesFootnote">Las tasas P2P son referenciales y pueden variar según monto, anunciante y método de pago. Para documentos fiscales, valida la tasa aplicable según la normativa vigente.</p>
    </section>
  </div>
}
