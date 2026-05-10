import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac } from 'crypto';

const SECRET = process.env.ADMIN_SECRET || 'dev-secret-change-me';

const USERS: Record<string, string> = {
  andre:  '145414',
  mari:   '234237',
};

function validateCredentials(user: string, pass: string): string | null {
  // Normalize accented characters: "andré" → "andre"
  const key = user.toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const stored = USERS[key];
  if (stored && stored === pass) return key;
  return null;
}

function createToken(user: string): string {
  const iat     = Date.now();
  const payload = Buffer.from(JSON.stringify({ user, iat })).toString('base64');
  const sig     = createHmac('sha256', SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { user, pass } = req.body as { user?: string; pass?: string };
    if (!user || !pass) return res.status(400).json({ error: 'Campos obrigatórios' });

    const username = validateCredentials(user, pass);
    if (!username) return res.status(401).json({ error: 'Credenciais inválidas' });

    return res.status(200).json({ token: createToken(username), user: username });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[admin-auth]', msg);
    return res.status(500).json({ error: msg });
  }
}
