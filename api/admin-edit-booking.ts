import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac } from 'crypto';

const SECRET     = process.env.ADMIN_SECRET || 'dev-secret-change-me';
const TOKEN_TTL  = 8 * 60 * 60 * 1000;
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const auth = verifyToken(req.headers.authorization as string | undefined);
  if (!auth) return res.status(401).json({ error: 'Não autorizado' });

  const {
    bookingId, name, email, whatsapp,
    instagram, instagramBailarina, nomeBailarina,
  } = req.body as {
    bookingId:            string;
    name:                 string;
    email:                string;
    whatsapp?:            string;
    instagram?:           string;
    instagramBailarina?:  string;
    nomeBailarina?:       string;
  };

  if (!bookingId || !name || !email) {
    return res.status(400).json({ error: 'Campos obrigatórios faltando' });
  }

  try {
    const r = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action:             'editBooking',
        bookingId,
        name,
        email,
        whatsapp:           whatsapp           || '',
        instagram:          instagram          || '',
        instagramBailarina: instagramBailarina || '',
        nomeBailarina:      nomeBailarina      || '',
      }),
    });

    const json = await r.json() as { ok?: boolean; error?: string };
    if (!json.ok) throw new Error(json.error || 'Erro ao editar');

    // Log
    await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action:  'addLog',
        message: `${auth.user} editou dados do agendamento ${bookingId} (${name})`,
        origin:  'painel',
      }),
    }).catch(() => {});

    return res.status(200).json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[admin-edit-booking]', msg);
    return res.status(500).json({ error: msg });
  }
}
