import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';
import { createHmac } from 'crypto';
import { buildBookingEmailHtml } from '../lib/emailTemplate';

const SECRET    = process.env.ADMIN_SECRET || 'dev-secret-change-me';
const TOKEN_TTL = 8 * 60 * 60 * 1000; // 8 h

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

const SCRIPT_URL  = process.env.SHEETS_SCRIPT_URL!;
const resend      = new Resend(process.env.RESEND_API_KEY!);
const ANDRE_EMAIL = 'andreffotografia@gmail.com';

const PACKAGES: Record<string, { name: string; duration: number; price: number }> = {
  lembranca: { name: 'Lembrança',  duration: 30,  price: 1400 },
  economico: { name: 'Econômico',  duration: 90,  price: 1900 },
  completo:  { name: 'Completo',   duration: 120, price: 2200 },
};

function fmtDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function calcEndTime(time: string, durationMin: number) {
  const [h, m] = time.split(':').map(Number);
  const end    = h * 60 + m + durationMin;
  return String(Math.floor(end / 60)).padStart(2, '0') + ':' + String(end % 60).padStart(2, '0');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const auth = verifyToken(req.headers.authorization as string | undefined);
  if (!auth) return res.status(401).json({ error: 'Não autorizado' });

  const {
    bookingId,
    name, email, whatsapp,
    oldDate, oldTime,
    newDate, newTime, packageKey, numBailarinas,
  } = req.body as {
    bookingId:      string;
    name:           string;
    email:          string;
    whatsapp:       string;
    oldDate:        string;
    oldTime:        string;
    newDate:        string;
    newTime:        string;
    numBailarinas?: number;
    packageKey: string;
  };

  if (!bookingId || !newDate || !newTime || !packageKey) {
    return res.status(400).json({ error: 'Campos obrigatórios faltando' });
  }

  const pkg = PACKAGES[packageKey];
  if (!pkg) return res.status(400).json({ error: 'Pacote inválido' });

  const endTime   = calcEndTime(newTime, pkg.duration);
  const sessionId = `admin-rescheduled-${Date.now()}`;

  // 1. Cancel old booking
  try {
    await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'cancelBooking', bookingId, reason: 'Remarcado pelo admin' }),
    });
  } catch (e) {
    console.error('[admin-reschedule] cancelBooking error', e);
    return res.status(500).json({ error: 'Erro ao cancelar agendamento antigo' });
  }

  // 2. Create new pending
  let newBookingId = '';
  try {
    await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'createPending',
        date: newDate, start: newTime, packageKey,
        name, email, whatsapp,
        stripeSession: sessionId,
        source: 'admin',
      }),
    });

    // 3. Confirm new booking immediately
    const r    = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'confirmBooking',
        stripeSession: sessionId,
        stripePayment: `admin-reschedule-${bookingId}`,
      }),
    });
    const json = await r.json();
    newBookingId = json.bookingId || '';
  } catch (e) {
    console.error('[admin-reschedule] create/confirm error', e);
    return res.status(500).json({ error: 'Erro ao criar novo agendamento' });
  }

  // 4. Add log
  const logMsg = `${auth.user} remarcou ensaio de ${name}: ${fmtDate(oldDate)} ${oldTime} → ${fmtDate(newDate)} ${newTime} (${pkg.name})`;
  await fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'addLog', message: logMsg, origin: 'painel' }),
  }).catch(e => console.error('[admin-reschedule] addLog error', e));

  // 5. Send email to client
  if (email) {
    const html = buildBookingEmailHtml({
      name,
      date:    newDate,
      time:    newTime,
      endTime,
      packageName:   pkg.name,
      duration:      pkg.duration,
      price:         (pkg.price || 0).toFixed(2).replace('.', ','),
      bookingId:     newBookingId,
      numBailarinas: Number(numBailarinas) || 1,
    }, 'rescheduled');

    await Promise.allSettled([
      resend.emails.send({
        from:    'Ensaio Joinville <confirmacao@ensaiofotograficoemjoinville.com>',
        to:      email,
        subject: `Ensaio remarcado — ${fmtDate(newDate)} às ${newTime}`,
        html,
      }),
      resend.emails.send({
        from:    'Ensaio Joinville <confirmacao@ensaiofotograficoemjoinville.com>',
        to:      ANDRE_EMAIL,
        subject: `[Admin] Remarcação: ${name} → ${fmtDate(newDate)} ${newTime}`,
        html:    `<p>${logMsg}</p>`,
      }),
    ]);
  }

  return res.status(200).json({ ok: true, newBookingId });
}
