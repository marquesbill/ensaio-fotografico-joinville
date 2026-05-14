import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';
import { createHmac } from 'crypto';
import { buildBookingEmailHtml } from '../lib/emailTemplate';

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

  const { bookingId, stripeSession, name, email, whatsapp, date, time, packageKey, numBailarinas } = req.body as {
    bookingId:      string;
    stripeSession:  string;
    name:           string;
    email:          string;
    whatsapp:       string;
    date:           string;
    time:           string;
    packageKey:     string;
    numBailarinas?: number;
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
    body: JSON.stringify({ action: 'addLog', message: logMsg, origin: 'painel' }),
  }).catch(() => {});

  // 3. Send confirmation email to client
  if (email) {
    const html = buildBookingEmailHtml({
      name, date, time, endTime,
      packageName: pkg.name,
      duration:    pkg.duration,
      price:       (pkg.price || 0).toFixed(2).replace('.', ','),
      bookingId:   confirmedId,
      numBailarinas: Number(numBailarinas) || 1,
    }, 'confirmed');

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
