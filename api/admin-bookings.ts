import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from './_adminAuth';

const SCRIPT_URL = process.env.SHEETS_SCRIPT_URL!;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const auth = verifyToken(req.headers.authorization);
  if (!auth) return res.status(401).json({ error: 'Não autorizado' });

  try {
    const url = `${SCRIPT_URL}?action=bookings`;
    const r   = await fetch(url);
    const json = await r.json();
    return res.status(200).json(json);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
}
