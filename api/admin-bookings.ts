import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac } from 'crypto';

const SECRET    = process.env.ADMIN_SECRET || 'dev-secret-change-me';
const TOKEN_TTL = 8 * 60 * 60 * 1000; // 8 h
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

  const auth = verifyToken(req.headers.authorization as string | undefined);
  if (!auth) return res.status(401).json({ error: 'Não autorizado' });

  // POST: proxy de ações específicas para o Apps Script
  // (mantemos aqui em vez de criar nova função pra não estourar
  //  o limite de 12 serverless functions do plano Hobby.)
  if (req.method === 'POST') {
    try {
      const body = req.body as { action?: string; bookingId?: string; extraCc?: string };
      if (body?.action === 'resendConfirmation') {
        if (!body.bookingId) return res.status(400).json({ error: 'bookingId obrigatório' });
        const r = await fetch(SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({
            action:    'resendConfirmation',
            bookingId: body.bookingId,
            extraCc:   body.extraCc || '',
          }),
        });
        const json = await r.json();
        if (json && json.error) return res.status(400).json(json);
        return res.status(200).json(json);
      }
      return res.status(400).json({ error: 'Ação desconhecida' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[admin-bookings] POST', msg);
      return res.status(500).json({ error: msg });
    }
  }

  if (req.method !== 'GET') return res.status(405).end();

  try {
    const url = `${SCRIPT_URL}?action=bookings&t=${Date.now()}`;
    const r   = await fetch(url, { cache: 'no-store' });
    const json = await r.json();
    return res.status(200).json(json);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
}
