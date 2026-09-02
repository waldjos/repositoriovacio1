const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024

function byteLengthFromBase64(value = '') {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor(value.length * 0.75) - padding)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Método no permitido.' })
  }

  const apiKey = process.env.RESEND_API_KEY
  const configuredRecipient = process.env.BACKUP_EMAIL
  const allowClientRecipient = process.env.ALLOW_CLIENT_BACKUP_EMAIL === 'true'
  const sender = process.env.EMAIL_FROM || 'ZiviFactura <onboarding@resend.dev>'

  if (!apiKey) return res.status(503).json({ error: 'El correo automático todavía no tiene configurada la clave RESEND_API_KEY.' })

  const body = req.body || {}
  const recipient = configuredRecipient || (allowClientRecipient ? body.requestedRecipient : '')
  if (!recipient) return res.status(503).json({ error: 'Configura BACKUP_EMAIL en Vercel para activar los respaldos automáticos.' })

  const attachments = Array.isArray(body.attachments) ? body.attachments.slice(0, 3) : []
  const totalBytes = attachments.reduce((sum, item) => sum + byteLengthFromBase64(item?.content), 0)
  if (totalBytes > MAX_ATTACHMENT_BYTES) return res.status(413).json({ error: 'El respaldo supera el tamaño permitido para correo.' })

  const safeNumber = String(body.invoiceNumber || 'Documento').replace(/[<>]/g, '')
  const safeClient = String(body.clientName || 'Cliente').replace(/[<>]/g, '')
  const safeStatus = String(body.status || '').replace(/[<>]/g, '')
  const safeCurrency = String(body.currency || '').replace(/[<>]/g, '')

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: sender,
      to: [recipient],
      subject: `Respaldo ZiviFactura · ${safeNumber}`,
      html: `
        <div style="font-family:Arial,sans-serif;color:#172033;line-height:1.5">
          <h2 style="margin-bottom:6px">Respaldo automático de ZiviFactura</h2>
          <p style="margin-top:0">Se guardó una copia del documento <strong>${safeNumber}</strong>.</p>
          <table style="border-collapse:collapse;font-size:14px">
            <tr><td style="padding:4px 18px 4px 0;color:#64748b">Cliente</td><td><strong>${safeClient}</strong></td></tr>
            <tr><td style="padding:4px 18px 4px 0;color:#64748b">Estado</td><td>${safeStatus}</td></tr>
            <tr><td style="padding:4px 18px 4px 0;color:#64748b">Moneda</td><td>${safeCurrency}</td></tr>
          </table>
          <p>Se adjuntan el PDF y una copia liviana de la base local para recuperación.</p>
          <p style="font-size:12px;color:#94a3b8">Generado automáticamente por ZiviFactura · Zivi Dynamics C.A.</p>
        </div>`,
      attachments: attachments.map(item => ({
        filename: String(item.filename || 'archivo'),
        content: String(item.content || ''),
      })),
    }),
  })

  const result = await response.json().catch(() => ({}))
  if (!response.ok) return res.status(response.status).json({ error: result?.message || 'No se pudo enviar el respaldo.' })
  return res.status(200).json({ ok: true, id: result?.id || null })
}
