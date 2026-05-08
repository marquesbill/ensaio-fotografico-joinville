import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';

const SCRIPT_URL = process.env.SHEETS_SCRIPT_URL!;
const SITE_URL   = process.env.SITE_URL || 'https://www.ensaiofotograficoemjoinville.com';

const PACKAGES = {
  lembranca: { name: 'Lembrança',  duration: 30,  price: 140000 },
  economico: { name: 'Econômico',  duration: 90,  price: 190000 },
  completo:  { name: 'Completo',   duration: 120, price: 220000 },
} as const;
type PkgKey = keyof typeof PACKAGES;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  // Init Stripe here (not at module level) so missing env var returns JSON, not HTML
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'STRIPE_SECRET_KEY não configurada' });
  }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
    // 1. Create Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'brl',
          unit_amount: pkg.price,
          product_data: {
            name: `Ensaio Fotográfico em Joinville — Pacote ${pkg.name}`,
            description: `${date.split('-').reverse().join('/')} às ${time} · ${pkg.duration} min`,
            images: [`${SITE_URL}/logo-b.png`],
          },
        },
      }],
      customer_email: email,
      metadata: { date, time, packageKey, name, email, whatsapp },
      success_url: `${SITE_URL}/agendamento/sucesso?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${SITE_URL}/agendamento?cancelado=1`,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // 30 min
    });

    // 2. Mark slot as Pending in Sheets
    await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'createPending',
        date, start: time, packageKey, name, email, whatsapp,
        stripeSession: session.id,
      }),
    });

    return res.status(200).json({ url: session.url });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[create-checkout]', msg);
    return res.status(500).json({ error: msg });
  }
}
