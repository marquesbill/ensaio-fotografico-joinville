import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';
import { createHmac } from 'crypto';
import { buildBookingEmailHtml } from './_emailTemplate';

const PACKAGES: Record<string, { name: string; duration: number; price: number }> = {
  lembranca: { name: 'Lembrança',  duration: 30,  price: 1400 },
  economico: { name: 'Econômico',  duration: 90,  price: 1900 },
  completo:  { name: 'Completo',   duration: 120, price: 2200 },
};

const SECRET     = process.env.ADMIN_SECRET || 'dev-secret-change-me';
const TOKEN_TTL  = 8 * 60 * 60 * 1000; // 8 h
const SCRIPT_URL = process.env.SHEETS_SCRIPT_URL!;

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

  const auth = verifyToken(req.headers.authorization as string | undefined);
  if (!auth) return res.status(401).json({ error: 'Não autorizado' });

  const { bookingId, reason, name, email, date, time, endTime, packageKey, packageName, numBailarinas } = req.body as {
    bookingId:      string;
    reason:         string;
    name:           string;
    email:          string;
    date:           string;
    time:           string;
    endTime?:       string;
    packageKey?:    string;
    packageName?:   string;
    numBailarinas?: number;
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
    body: JSON.stringify({ action: 'addLog', message: logMsg, origin: 'painel' }),
  }).catch(e => console.error('[admin-cancel] addLog error', e));

  // 3. Send cancellation email to client
  if (email) {
    const pkg = (packageKey && PACKAGES[packageKey]) || { name: packageName || '—', duration: 0, price: 0 };
    const html = buildBookingEmailHtml({
      name, date, time,
      endTime: endTime || time,
      packageName:   pkg.name,
      duration:      pkg.duration,
      price:         (pkg.price || 0).toFixed(2).replace('.', ','),
      bookingId,
      numBailarinas: Number(numBailarinas) || 1,
    }, 'cancelled');

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
