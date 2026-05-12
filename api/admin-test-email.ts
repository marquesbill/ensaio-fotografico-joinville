// Endpoint de diagnóstico: dispara um email de confirmação SAMPLE
// usando exatamente o mesmo caminho (Gmail SMTP) do webhook real.
// Útil para verificar se a entrega de emails está funcionando.
//
// Uso (no console do navegador, autenticado no /admin):
//   await fetch('/api/admin-test-email', {
//     method: 'POST',
//     headers: { Authorization: 'Bearer ' + localStorage.getItem('adminToken') }
//   }).then(r => r.json())
import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';
import { createHmac } from 'crypto';

const SECRET       = process.env.ADMIN_SECRET || 'dev-secret-change-me';
const TOKEN_TTL    = 8 * 60 * 60 * 1000;
const GMAIL_USER   = process.env.GMAIL_USER!;
const GMAIL_PASS   = process.env.GMAIL_APP_PASSWORD!;
const ANDRE_EMAIL  = 'andreffotografia@gmail.com';
const EMAIL_BG_URL = 'https://www.ensaiofotograficoemjoinville.com/email-bg3.jpg';

function verifyToken(authHeader?: string): { user: string; iat: number } | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    const dot = token.lastIndexOf('.');
    if (dot === -1) return null;
    const payload  = token.slice(0, dot);
    const sig      = token.slice(dot + 1);
    const expected = createHmac('sha256', SECRET).update(payload).digest('hex');
    if (expected !== sig) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64').toString()) as { user: string; iat: number };
    if (Date.now() - data.iat > TOKEN_TTL) return null;
    return data;
  } catch { return null; }
}

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: { user: GMAIL_USER, pass: GMAIL_PASS },
});

function fmtDate(s: string) {
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const auth = verifyToken(req.headers.authorization as string | undefined);
  if (!auth) return res.status(401).json({ error: 'Não autorizado' });

  // Sample data
  const data = {
    name: 'TESTE — André',
    date: '2026-07-28',
    time: '14:00',
    endTime: '16:00',
    packageName: 'Completo',
    duration: 120,
    price: '2200,00',
    bookingId: 'AG-TESTE-XYZ',
    numBailarinas: 2,
  };

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><style>
  body{font-family:Georgia,serif;background:#f5f0fa;margin:0;padding:0}
  .header{background:linear-gradient(135deg,#7a3f8f,#e87060);padding:32px 32px 24px;text-align:center}
  .header h1{color:#fff;font-size:22px;margin:0 0 4px;letter-spacing:.5px}
  .header p{color:rgba(255,255,255,.85);font-size:13px;margin:0}
  .body{padding:32px}
  .tag{display:inline-block;background:#7a3f8f;color:#fff;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;border-radius:20px;padding:4px 12px;margin-bottom:16px}
  h2{font-size:20px;color:#352D39;margin:0 0 20px}
  .card{background:rgba(249,246,252,0.88);border:1px solid #e8d8f0;border-radius:12px;padding:20px;margin-bottom:20px}
  .row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #eee;font-size:14px}
  .row:last-child{border:none}
  .label{color:#888}
  .value{font-weight:bold;color:#352D39}
  .id{font-size:11px;color:#aaa;text-align:center;margin-top:8px;font-family:monospace}
  .footer{background:rgba(249,246,252,0.88);padding:20px 32px;text-align:center;font-size:12px;color:#aaa;border-top:1px solid #eee}
  .footer a{color:#7a3f8f}
  .test-banner{background:#fef3c7;border:1px solid #fbbf24;color:#92400e;padding:12px;text-align:center;font-size:12px;font-weight:bold}
</style></head>
<body>
<div style="max-width:560px;margin:32px auto;background-color:#fff;background-image:url('${EMAIL_BG_URL}');background-size:cover;background-position:center;background-repeat:no-repeat;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10)">
  <div class="test-banner">⚠️ ESTE É UM EMAIL DE TESTE — não é uma reserva real</div>
  <div class="header">
    <h1>Ensaio Fotográfico em Joinville</h1>
    <p>André Ferreira · @affotografia</p>
  </div>
  <div class="body">
    <span class="tag">Reserva Confirmada</span>
    <h2>Olá, ${data.name}!</h2>
    <p style="color:#555;font-size:14px;line-height:1.6">Seu pagamento foi aprovado e seu horário está garantido. Anote os detalhes abaixo.</p>
    <div class="card">
      <div class="row"><span class="label">Data:</span><span class="value">${fmtDate(data.date)}</span></div>
      <div class="row"><span class="label">Horário:</span><span class="value">${data.time} – ${data.endTime}</span></div>
      <div class="row"><span class="label">Pacote:</span><span class="value">${data.packageName} (${data.duration}min)</span></div>
      <div class="row"><span class="label">Nº Bailarinas:</span><span class="value">${data.numBailarinas}</span></div>
      <div class="row"><span class="label">Local:</span><span class="value">Hotel Le Village · Sala Esmeralda · Joinville/SC</span></div>
      <div class="row"><span class="label">Valor pago:</span><span class="value">R$ ${data.price}</span></div>
    </div>
    <p style="font-size:13px;color:#666;line-height:1.6">Em caso de dúvidas ou necessidade de remarcação, entre em contato pelo WhatsApp (11) 5196-0627.</p>
    <p class="id">Código da reserva: ${data.bookingId}</p>
  </div>
  <div class="footer">
    © 2026 André Ferreira Fotografia · Joinville, SC<br>
    <a href="https://www.instagram.com/affotografia">@affotografia</a>
  </div>
</div>
</body></html>`;

  try {
    const info = await transporter.sendMail({
      from:    `"Ensaio Joinville" <${GMAIL_USER}>`,
      to:      ANDRE_EMAIL,
      subject: `[TESTE] Reserva confirmada — Completo · 28/07/2026 às 14:00`,
      html,
    });
    return res.status(200).json({
      ok:        true,
      sentTo:    ANDRE_EMAIL,
      from:      GMAIL_USER,
      messageId: info.messageId,
      accepted:  info.accepted,
      rejected:  info.rejected,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[admin-test-email]', msg);
    return res.status(500).json({ error: msg });
  }
}
