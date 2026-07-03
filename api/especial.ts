import type { VercelRequest, VercelResponse } from '@vercel/node';
import { especialToken } from './_especial';

const SCRIPT_URL = process.env.SHEETS_SCRIPT_URL!;

// Endpoint PÚBLICO (sem auth de admin) da página compartilhável do Especial.
// Protegido por token: /api/especial?id=<id>&t=<token>. Sem o token certo → 403.
// Só expõe os dados que o grupo precisa (nomes, valores, links, pago?).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const id = String(req.query.id || '').trim();
  const t  = String(req.query.t  || '').trim();
  if (!id || !t) return res.status(400).json({ error: 'Link inválido (faltam parâmetros).' });
  if (t !== especialToken(id)) return res.status(403).json({ error: 'Link inválido.' });

  try {
    const r = await fetch(
      `${SCRIPT_URL}?action=especialById&id=${encodeURIComponent(id)}&t=${Date.now()}`,
      { cache: 'no-store' },
    );
    const data = await r.json() as { error?: string } | null;
    if (!data || (data as { error?: string }).error) {
      return res.status(404).json({ error: 'Especial não encontrado.' });
    }
    return res.status(200).json(data);
  } catch (e) {
    console.error('[api/especial]', e);
    return res.status(500).json({ error: 'Erro ao carregar.' });
  }
}
