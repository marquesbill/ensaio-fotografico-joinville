import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';
import { verifyToken } from './_adminAuth';

const SCRIPT_URL  = process.env.SHEETS_SCRIPT_URL!;
const resend      = new Resend(process.env.RESEND_API_KEY!);
const ANDRE_EMAIL = 'andreffotografia@gmail.com';

function fmtDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const auth = verifyToken(req.headers.authorization);
  if (!auth) return res.status(401).json({ error: 'Não autorizado' });

  const { bookingId, reason, name, email, date, time, packageName } = req.body as {
    bookingId: string;
    reason:    string;
    name:      string;
    email:     string;
    date:      string;
    time:      string;
    packageName: string;
  };

  if (!bookingId || !reason) return res.status(400).json({ error: 'bookingId e reason são obrigatórios' });

  // 1. Cancel in Sheets
  try {
    await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'cancelBooking', bookingId, reason }),
    });
  } catch (e) {
    console.error('[admin-cancel] cancelBooking error', e);
    return res.status(500).json({ error: 'Erro ao cancelar na planilha' });
  }

  // 2. Add log
  const logMsg = `${auth.user} cancelou ensaio de ${name} (${fmtDate(date)} ${time}) — motivo: ${reason}`;
  await fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'addLog', message: logMsg }),
  }).catch(e => console.error('[admin-cancel] addLog error', e));

  // 3. Send cancellation email to client
  if (email) {
    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><style>
  body{font-family:Georgia,serif;background:#f5f0fa;margin:0;padding:0}
  .wrap{max-width:560px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10)}
  .header{background:linear-gradient(135deg,#7a3f8f,#e87060);padding:32px;text-align:center}
  .header h1{color:#fff;font-size:22px;margin:0 0 4px}
  .header p{color:rgba(255,255,255,.85);font-size:13px;margin:0}
  .body{padding:32px}
  .tag{display:inline-block;background:#e87060;color:#fff;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;border-radius:20px;padding:4px 12px;margin-bottom:16px}
  h2{font-size:20px;color:#352D39;margin:0 0 20px}
  .card{background:#f9f6fc;border:1px solid #e8d8f0;border-radius:12px;padding:20px;margin-bottom:20px}
  .row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee;font-size:14px}
  .row:last-child{border:none}
  .label{color:#888}
  .value{font-weight:bold;color:#352D39}
  .footer{background:#f9f6fc;padding:20px 32px;text-align:center;font-size:12px;color:#aaa;border-top:1px solid #eee}
  .footer a{color:#7a3f8f}
</style></head>
<body>
<div class="wrap">
  <div class="header">
    <h1>Ensaio Fotográfico em Joinville</h1>
    <p>André Ferreira · @affotografia</p>
  </div>
  <div class="body">
    <span class="tag">Ensaio Cancelado</span>
    <h2>Olá, ${name}!</h2>
    <p style="color:#555;font-size:14px;line-height:1.6">Infelizmente seu ensaio agendado precisou ser cancelado. Veja os detalhes abaixo.</p>
    <div class="card">
      <div class="row"><span class="label">Data</span><span class="value">${fmtDate(date)}</span></div>
      <div class="row"><span class="label">Horário</span><span class="value">${time}</span></div>
      <div class="row"><span class="label">Pacote</span><span class="value">${packageName}</span></div>
      <div class="row"><span class="label">Motivo</span><span class="value">${reason}</span></div>
    </div>
    <p style="font-size:13px;color:#666;line-height:1.6">Em caso de dúvidas ou para reagendamento, entre em contato pelo WhatsApp <strong>(11) 5196-0627</strong>.</p>
  </div>
  <div class="footer">
    © 2026 André Ferreira Fotografia · Joinville, SC<br>
    <a href="https://www.instagram.com/affotografia">@affotografia</a>
  </div>
</div>
</body></html>`;

    await Promise.allSettled([
      resend.emails.send({
        from:    'Ensaio Joinville <confirmacao@ensaiofotograficoemjoinville.com>',
        to:      email,
        subject: `Cancelamento de ensaio — ${fmtDate(date)} às ${time}`,
        html,
      }),
      resend.emails.send({
        from:    'Ensaio Joinville <confirmacao@ensaiofotograficoemjoinville.com>',
        to:      ANDRE_EMAIL,
        subject: `[Admin] Cancelamento: ${name} — ${fmtDate(date)} ${time}`,
        html:    `<p>${logMsg}</p>`,
      }),
    ]);
  }

  return res.status(200).json({ ok: true });
}
