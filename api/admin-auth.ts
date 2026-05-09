import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateCredentials, createToken } from './_adminAuth';

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { user, pass } = req.body as { user?: string; pass?: string };
  if (!user || !pass) return res.status(400).json({ error: 'Campos obrigatórios' });

  const username = validateCredentials(user, pass);
  if (!username) return res.status(401).json({ error: 'Credenciais inválidas' });

  return res.status(200).json({ token: createToken(username), user: username });
}
