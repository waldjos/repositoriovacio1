const SOURCE_URL = 'https://www.usdt.com.ve/api/v1/rates/current'
const BCV_URL = 'https://www.bcv.org.ve/'
const DOLAR_API_EUR_URL = 'https://ve.dolarapi.com/v1/euros/oficial'
const DOLAR_API_USD_URL = 'https://ve.dolarapi.com/v1/dolares/oficial'

function parseLocalizedNumber(value) {
  if (value == null) return null
  const raw = String(value).trim().replace(/\s/g, '')
  if (!raw) return null
  let normalized = raw
  const comma = normalized.lastIndexOf(',')
  const dot = normalized.lastIndexOf('.')
  if (comma >= 0 && dot >= 0) {
    normalized = comma > dot
      ? normalized.replace(/\./g, '').replace(',', '.')
      : normalized.replace(/,/g, '')
  } else if (comma >= 0) {
    normalized = normalized.replace(',', '.')
  }
  normalized = normalized.replace(/[^0-9.-]/g, '')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function extractBcvRate(html, id) {
  const block = html.match(new RegExp(`id=["']${id}["'][\\s\\S]{0,2000}?<strong[^>]*>\\s*([^<]+)`, 'i'))
  return block ? parseLocalizedNumber(block[1]) : null
}

async function fetchOfficialBcv() {
  try {
    const response = await fetch(BCV_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ZiviFactura/1.0; +https://zivi-factura.vercel.app)',
        'Accept-Language': 'es-VE,es;q=0.9',
      },
      signal: AbortSignal.timeout(9000),
    })
    if (!response.ok) return { usd: null, eur: null }
    const html = await response.text()
    return {
      usd: extractBcvRate(html, 'dolar'),
      eur: extractBcvRate(html, 'euro'),
    }
  } catch {
    return { usd: null, eur: null }
  }
}

async function fetchDolarApiRate(url) {
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(7000),
    })
    if (!response.ok) return { rate: null, updatedAt: null }
    const data = await response.json()
    const rate = parseLocalizedNumber(data?.promedio ?? data?.venta ?? data?.compra)
    return { rate, updatedAt: data?.fechaActualizacion || null }
  } catch {
    return { rate: null, updatedAt: null }
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Método no permitido.' })
  }

  try {
    const [marketResponse, official, fallbackEur, fallbackUsd] = await Promise.all([
      fetch(SOURCE_URL, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(9000),
      }),
      fetchOfficialBcv(),
      fetchDolarApiRate(DOLAR_API_EUR_URL),
      fetchDolarApiRate(DOLAR_API_USD_URL),
    ])

    if (!marketResponse.ok) throw new Error(`Fuente de tasas respondió ${marketResponse.status}`)
    const payload = await marketResponse.json()
    const data = payload?.data || {}

    const binanceBuy = parseLocalizedNumber(data?.binance?.buy_rate)
    const binanceSell = parseLocalizedNumber(data?.binance?.sell_rate)
    const bybitBuy = parseLocalizedNumber(data?.bybit?.buy_rate)
    const bybitSell = parseLocalizedNumber(data?.bybit?.sell_rate)

    // Preferimos el BCV directo. Si el sitio oficial bloquea la consulta del servidor,
    // usamos proveedores que replican expresamente la cotización oficial BCV.
    const usdBcv = official.usd || parseLocalizedNumber(data?.bcv?.rate) || fallbackUsd.rate
    const eurBcv = official.eur || fallbackEur.rate
    const p2pValues = [binanceBuy, bybitBuy].filter(value => Number.isFinite(value))
    const usdtAverage = p2pValues.length ? p2pValues.reduce((sum, value) => sum + value, 0) / p2pValues.length : null
    const brechaPct = usdBcv && usdtAverage ? ((usdtAverage - usdBcv) / usdBcv) * 100 : parseLocalizedNumber(data?.brecha_pct)

    const officialFallbackUsed = (!official.eur && Boolean(fallbackEur.rate)) || (!official.usd && !parseLocalizedNumber(data?.bcv?.rate) && Boolean(fallbackUsd.rate))

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=1800')
    return res.status(200).json({
      success: true,
      data: {
        usdBcv,
        eurBcv,
        binanceBuy,
        binanceSell,
        bybitBuy,
        bybitSell,
        usdtAverage,
        brechaPct,
        capturedAt: new Date().toISOString(),
        sourceCapturedAt: data?.captured_at || fallbackEur.updatedAt || fallbackUsd.updatedAt || null,
      },
      meta: {
        marketSource: 'usdt.com.ve',
        officialSource: officialFallbackUsed ? 'BCV · respaldo DolarApi' : 'Banco Central de Venezuela',
        attribution: officialFallbackUsed ? 'BCV / DolarApi.com / usdt.com.ve' : 'BCV / usdt.com.ve',
      },
    })
  } catch (error) {
    return res.status(502).json({
      success: false,
      error: error instanceof Error ? error.message : 'No se pudieron obtener las tasas.',
    })
  }
}
