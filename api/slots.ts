import type { VercelRequest, VercelResponse } from '@vercel/node';

const SCRIPT_URL = process.env.SHEETS_SCRIPT_URL!;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { date } = req.query as Record<string, string>;
  if (!date) return res.status(400).json({ error: 'date é obrigatório' });

  try {
    const url = `${SCRIPT_URL}?action=allSlots&date=${encodeURIComponent(date)}`;
    const response = await fetch(url);
    const text = await response.text();
    const json = JSON.parse(text);
    return res.status(200).json(json);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
}
