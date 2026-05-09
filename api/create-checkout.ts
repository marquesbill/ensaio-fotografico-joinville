import type { VercelRequest, VercelResponse } from '@vercel/node';

const SCRIPT_URL = process.env.SHEETS_SCRIPT_URL!;
const SITE_URL   = process.env.SITE_URL || 'https://www.ensaiofotograficoemjoinville.com';
const MP_TOKEN   = process.env.MERCADOPAGO_ACCESS_TOKEN!;

const PACKAGES = {
  lembranca: { name: 'Lembrança',  duration: 30,  price: 1400 },
  economico: { name: 'Econômico',  duration: 90,  price: 1900 },
  completo:  { name: 'Completo',   duration: 120, price: 2200 },
} as const;
type PkgKey = keyof typeof PACKAGES;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  if (!MP_TOKEN) {
    return res.status(500).json({ error: 'MERCADOPAGO_ACCESS_TOKEN não configurada' });
  }

  const { date, time, packageKey, name, email, whatsapp } = req.body as {
    date: string; time: string; packageKey: PkgKey;
    name: string; email: string; whatsapp: string;
  };

  if (!date || !time || !packageKey || !name || !email || !whatsapp) {
    return res.status(400).json({ error: 'Campos obrigatórios faltando' });
  }

  const pkg = PACKAGES[packageKey];
  if (!pkg) return res.status(400).json({ error: 'Pacote inválido' });

  try {
    // 1. Create Mercado Pago preference
    const prefRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${MP_TOKEN}`,
      },
      body: JSON.stringify({
        items: [{
          title:       `Ensaio Fotográfico em Joinville — Pacote ${pkg.name}`,
          description: `${date.split('-').reverse().join('/')} às ${time} · ${pkg.duration} min`,
          quantity:    1,
          unit_price:  pkg.price,
          currency_id: 'BRL',
        }],
        payer: { email },
        back_urls: {
          success: `${SITE_URL}/agendamento/sucesso`,
          failure: `${SITE_URL}/agendamento?cancelado=1`,
          pending: `${SITE_URL}/agendamento/sucesso`,
        },
        auto_return: 'approved',
        payment_methods: {
          installments: 6,
        },
        external_reference: JSON.stringify({ date, time, packageKey, name, email, whatsapp }),
        notification_url: `${SITE_URL}/api/webhook`,
        expires: true,
        expiration_date_to: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      }),
    });

    const pref = await prefRes.json() as { id?: string; init_point?: string; message?: string };
    if (!pref.id || !pref.init_point) {
      throw new Error(pref.message || 'Erro ao criar preferência Mercado Pago');
    }

    // 2. Mark slot as Pending in Sheets
    await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'createPending',
        date, start: time, packageKey, name, email, whatsapp,
        stripeSession: pref.id,   // reusing field — stores MP preference ID
      }),
    });

    return res.status(200).json({ preferenceId: pref.id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[create-checkout]', msg);
    return res.status(500).json({ error: msg });
  }
}
