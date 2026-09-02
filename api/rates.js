const SOURCE_URL = 'https://www.usdt.com.ve/api/v1/rates/current'
const BCV_URL = 'https://www.bcv.org.ve/'

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
  const block = html.match(new RegExp(`id=["']${id}["'][\\s\\S]{0,1600}?<strong[^>]*>\\s*([^<]+)`, 'i'))
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

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Método no permitido.' })
  }

  try {
    const [marketResponse, official] = await Promise.all([
      fetch(SOURCE_URL, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(9000),
      }),
      fetchOfficialBcv(),
    ])

    if (!marketResponse.ok) throw new Error(`Fuente de tasas respondió ${marketResponse.status}`)
    const payload = await marketResponse.json()
    const data = payload?.data || {}

    const binanceBuy = parseLocalizedNumber(data?.binance?.buy_rate)
    const binanceSell = parseLocalizedNumber(data?.binance?.sell_rate)
    const bybitBuy = parseLocalizedNumber(data?.bybit?.buy_rate)
    const bybitSell = parseLocalizedNumber(data?.bybit?.sell_rate)
    const usdBcv = official.usd || parseLocalizedNumber(data?.bcv?.rate)
    const eurBcv = official.eur
    const p2pValues = [binanceBuy, bybitBuy].filter(value => Number.isFinite(value))
    const usdtAverage = p2pValues.length ? p2pValues.reduce((sum, value) => sum + value, 0) / p2pValues.length : null
    const brechaPct = usdBcv && usdtAverage ? ((usdtAverage - usdBcv) / usdBcv) * 100 : parseLocalizedNumber(data?.brecha_pct)

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
        sourceCapturedAt: data?.captured_at || null,
      },
      meta: {
        marketSource: 'usdt.com.ve',
        officialSource: 'Banco Central de Venezuela',
        attribution: 'https://www.usdt.com.ve',
      },
    })
  } catch (error) {
    return res.status(502).json({
      success: false,
      error: error instanceof Error ? error.message : 'No se pudieron obtener las tasas.',
    })
  }
}
