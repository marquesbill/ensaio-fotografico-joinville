import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';
import { createHmac } from 'crypto';

const SECRET      = process.env.ADMIN_SECRET || 'dev-secret-change-me';
const TOKEN_TTL   = 8 * 60 * 60 * 1000;
const SCRIPT_URL  = process.env.SHEETS_SCRIPT_URL!;
const SITE_URL    = process.env.SITE_URL || 'https://www.ensaiofotograficoemjoinville.com';
const MP_TOKEN    = process.env.MERCADOPAGO_ACCESS_TOKEN!;
const resend      = new Resend(process.env.RESEND_API_KEY!);
const ANDRE_EMAIL = 'andreffotografia@gmail.com';

const PACKAGES = {
  lembranca: { name: 'Lembrança',  duration: 30,  price: 1400 },
  economico: { name: 'Econômico',  duration: 90,  price: 1900 },
  completo:  { name: 'Completo',   duration: 120, price: 2200 },
} as const;
type PkgKey = keyof typeof PACKAGES;

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

  const { name, email, whatsapp, instagram, instagramBailarina, nomeBailarina, numBailarinas,
          date, time, packageKey, confirm } = req.body as {
    name:                string;
    email:               string;
    whatsapp:            string;
    instagram?:          string;
    instagramBailarina?: string;
    nomeBailarina?:      string;
    numBailarinas?:      number;
    date:                string;
    time:                string;
    packageKey:          PkgKey;
    confirm:             boolean;
  };

  if (!name || !email || !date || !time || !packageKey) {
    return res.status(400).json({ error: 'Campos obrigatórios faltando' });
  }
  const nb = Number(numBailarinas);
  if (!Number.isInteger(nb) || nb < 1 || nb > 9) {
    return res.status(400).json({ error: 'Nº Bailarinas deve ser um inteiro entre 1 e 9' });
  }

  const pkg = PACKAGES[packageKey];
  if (!pkg) return res.status(400).json({ error: 'Pacote inválido' });

  const endTime  = calcEnd(time, pkg.duration);
  const logUser  = auth.user;

  // ── Path A: generate payment link (3-day MP preference) ──────
  if (!confirm) {
    try {
      const expiry = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      const prefRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MP_TOKEN}` },
        body: JSON.stringify({
          items: [{
            title:       `Ensaio Fotográfico em Joinville — Pacote ${pkg.name}`,
            description: `${date.split('-').reverse().join('/')} às ${time} · ${pkg.duration} min`,
            quantity:    1,
            unit_price:  pkg.price,
            currency_id: 'BRL',
          }],
          payer: { email },
          back_urls: {
            success: `${SITE_URL}/agendamento/sucesso`,
            failure: `${SITE_URL}/agendamento?cancelado=1`,
            pending: `${SITE_URL}/agendamento/sucesso`,
          },
          auto_return:     'approved',
          payment_methods: { installments: 6 },
          external_reference: JSON.stringify({ date, time, packageKey, name, email, whatsapp }),
          notification_url:   `${SITE_URL}/api/webhook`,
          expires:              true,
          expiration_date_to:   expiry,
        }),
      });
      const pref = await prefRes.json() as { id?: string; init_point?: string; message?: string };
      if (!pref.id || !pref.init_point) throw new Error(pref.message || 'Erro ao criar preferência MP');

      // Create pending booking in Sheets
      const pendingRes = await fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'createPending',
          date, start: time, packageKey, name, email, whatsapp,
          instagram: instagram || '',
          instagramBailarina: instagramBailarina || '',
          nomeBailarina: nomeBailarina || '',
          numBailarinas: nb,
          stripeSession: pref.id,
          source: 'admin',
        }),
      });
      const pendingJson = await pendingRes.json() as { bookingId?: string };
      const bookingId   = pendingJson.bookingId || '';

      await fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'addLog', message: `${logUser} criou agendamento pendente para ${name} (${date} ${time}) e gerou link de pgmto`, origin: 'painel' }),
      }).catch(() => {});

      return res.status(200).json({ bookingId, paymentUrl: pref.init_point });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[admin-create-booking] link path', msg);
      return res.status(500).json({ error: msg });
    }
  }

  // ── Path B: confirm immediately (manual / cash payment) ──────
  const sessionId = `admin-new-${Date.now()}`;
  try {
    // 1. Create pending
    await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'createPending',
        date, start: time, packageKey, name, email, whatsapp,
        instagram: instagram || '',
        instagramBailarina: instagramBailarina || '',
        nomeBailarina: nomeBailarina || '',
        numBailarinas: nb,
        stripeSession: sessionId,
        source: 'admin',
      }),
    });

    // 2. Confirm immediately
    const confRes  = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action:        'confirmBooking',
        stripeSession: sessionId,
        stripePayment: `admin-direct-${Date.now()}`,
      }),
    });
    const confJson = await confRes.json() as { bookingId?: string };
    const bookingId = confJson.bookingId || '';

    // 3. Log
    const logMsg = `${logUser} criou e confirmou agendamento de ${name} — ${fmtDate(date)} ${time} (${pkg.name})`;
    await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'addLog', message: logMsg, origin: 'painel' }),
    }).catch(() => {});

    // 4. Confirmation email to client
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
    <p style="color:#555;font-size:14px;line-height:1.6">Seu agendamento está confirmado. Anote os detalhes abaixo.</p>
    <div class="card">
      <div class="row"><span class="label">Data</span><span class="value">${fmtDate(date)}</span></div>
      <div class="row"><span class="label">Horário</span><span class="value">${time} – ${endTime}</span></div>
      <div class="row"><span class="label">Pacote</span><span class="value">${pkg.name} (${pkg.duration}min)</span></div>
      <div class="row"><span class="label">Local</span><span class="value">Hotel Le Village · Sala Esmeralda · Joinville/SC</span></div>
    </div>
    <p style="font-size:13px;color:#666;line-height:1.6">Em caso de dúvidas, entre em contato pelo WhatsApp <strong>(11) 5196-0627</strong>.</p>
    <p class="id">Código da reserva: ${bookingId}</p>
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
          subject: `[Admin] Novo agendamento direto: ${name} — ${fmtDate(date)} ${time}`,
          html:    `<p>${logMsg}</p>`,
        }),
      ]);
    }

    return res.status(200).json({ ok: true, bookingId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[admin-create-booking] confirm path', msg);
    return res.status(500).json({ error: msg });
  }
}
