import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';
import { createHmac } from 'crypto';

const SECRET      = process.env.ADMIN_SECRET || 'dev-secret-change-me';
const TOKEN_TTL   = 8 * 60 * 60 * 1000;
const SCRIPT_URL  = process.env.SHEETS_SCRIPT_URL!;
const resend      = new Resend(process.env.RESEND_API_KEY!);
const ANDRE_EMAIL = 'andreffotografia@gmail.com';

const PACKAGES: Record<string, { name: string; duration: number; price: number }> = {
  lembranca: { name: 'Lembrança',  duration: 30,  price: 1400 },
  economico: { name: 'Econômico',  duration: 90,  price: 1900 },
  completo:  { name: 'Completo',   duration: 120, price: 2200 },
};

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
  } catch {
    return null;
  }
}

function fmtDate(d: string) {
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

function calcEnd(time: string, dur: number) {
  const [h, m] = time.split(':').map(Number);
  const e = h * 60 + m + dur;
  return String(Math.floor(e / 60)).padStart(2, '0') + ':' + String(e % 60).padStart(2, '0');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const auth = verifyToken(req.headers.authorization as string | undefined);
  if (!auth) return res.status(401).json({ error: 'Não autorizado' });

  const { bookingId, stripeSession, name, email, whatsapp, date, time, packageKey } = req.body as {
    bookingId:     string;
    stripeSession: string;
    name:          string;
    email:         string;
    whatsapp:      string;
    date:          string;
    time:          string;
    packageKey:    string;
  };

  if (!bookingId || !stripeSession) {
    return res.status(400).json({ error: 'bookingId e stripeSession são obrigatórios' });
  }

  const pkg     = PACKAGES[packageKey] || { name: packageKey, duration: 0, price: 0 };
  const endTime = calcEnd(time, pkg.duration);

  // 1. Confirm in Sheets
  let confirmedId = bookingId;
  try {
    const r    = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action:        'confirmBooking',
        stripeSession,
        stripePayment: `admin-manual-${Date.now()}`,
      }),
    });
    const json = await r.json();
    confirmedId = json.bookingId || bookingId;
  } catch (e) {
    console.error('[admin-confirm] confirmBooking error', e);
    return res.status(500).json({ error: 'Erro ao confirmar na planilha' });
  }

  // 2. Log
  const logMsg = `${auth.user} confirmou manualmente o pagamento de ${name} — ${fmtDate(date)} ${time} (${pkg.name})`;
  await fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'addLog', message: logMsg }),
  }).catch(() => {});

  // 3. Send confirmation email to client
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
  .tag{display:inline-block;background:#7a3f8f;color:#fff;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;border-radius:20px;padding:4px 12px;margin-bottom:16px}
  h2{font-size:20px;color:#352D39;margin:0 0 20px}
  .card{background:#f9f6fc;border:1px solid #e8d8f0;border-radius:12px;padding:20px;margin-bottom:20px}
  .row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee;font-size:14px}
  .row:last-child{border:none}
  .label{color:#888}
  .value{font-weight:bold;color:#352D39}
  .id{font-size:11px;color:#aaa;text-align:center;margin-top:8px;font-family:monospace}
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
    <span class="tag">Reserva Confirmada</span>
    <h2>Olá, ${name}!</h2>
    <p style="color:#555;font-size:14px;line-height:1.6">Seu pagamento foi confirmado e seu horário está garantido. Anote os detalhes abaixo.</p>
    <div class="card">
      <div class="row"><span class="label">Data</span><span class="value">${fmtDate(date)}</span></div>
      <div class="row"><span class="label">Horário</span><span class="value">${time} – ${endTime}</span></div>
      <div class="row"><span class="label">Pacote</span><span class="value">${pkg.name}${pkg.duration ? ` (${pkg.duration}min)` : ''}</span></div>
      <div class="row"><span class="label">Local</span><span class="value">Hotel Le Village · Sala Esmeralda · Joinville/SC</span></div>
    </div>
    <p style="font-size:13px;color:#666;line-height:1.6">Em caso de dúvidas, entre em contato pelo WhatsApp <strong>(11) 5196-0627</strong>.</p>
    <p class="id">Código da reserva: ${confirmedId}</p>
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
        subject: `Reserva confirmada — ${pkg.name} · ${fmtDate(date)} às ${time}`,
        html,
      }),
      resend.emails.send({
        from:    'Ensaio Joinville <confirmacao@ensaiofotograficoemjoinville.com>',
        to:      ANDRE_EMAIL,
        subject: `[Admin] Confirmação manual: ${name} — ${fmtDate(date)} ${time}`,
        html:    `<p>${logMsg}</p>`,
      }),
    ]);
  }

  return res.status(200).json({ ok: true, bookingId: confirmedId });
}
