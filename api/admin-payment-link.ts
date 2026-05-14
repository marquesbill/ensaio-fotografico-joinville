import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac } from 'crypto';

const SECRET     = process.env.ADMIN_SECRET || 'dev-secret-change-me';
const TOKEN_TTL  = 8 * 60 * 60 * 1000;
const SCRIPT_URL = process.env.SHEETS_SCRIPT_URL!;
const SITE_URL   = process.env.SITE_URL || 'https://www.ensaiofotograficoemjoinville.com';
const MP_TOKEN   = process.env.MERCADOPAGO_ACCESS_TOKEN!;

const PACKAGES = {
  lembranca: { name: 'Lembrança',  duration: 30,  price: 1400, maxBailarinas: 2 },
  economico: { name: 'Econômico',  duration: 90,  price: 1900, maxBailarinas: 3 },
  completo:  { name: 'Completo',   duration: 120, price: 2200, maxBailarinas: 4 },
} as const;
type PkgKey = keyof typeof PACKAGES;

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

  const { bookingId, name, email, whatsapp, instagram, instagramBailarina, nomeBailarina, numBailarinas,
          date, time, packageKey } = req.body as {
    bookingId:           string;
    name:                string;
    email:               string;
    whatsapp:            string;
    instagram?:          string;
    instagramBailarina?: string;
    nomeBailarina?:      string;
    numBailarinas?:      number;
    date:                string;
    time:                string;
    packageKey:          PkgKey;
  };

  if (!bookingId || !date || !time || !packageKey || !name || !email) {
    return res.status(400).json({ error: 'Campos obrigatórios faltando' });
  }

  const pkg = PACKAGES[packageKey];
  if (!pkg) return res.status(400).json({ error: 'Pacote inválido' });

  // numBailarinas opcional para clientes do painel ainda em cache antigo;
  // default = 1 quando não enviado.
  let nb = 1;
  if (numBailarinas !== undefined && numBailarinas !== null && String(numBailarinas) !== '') {
    const parsed = Number(numBailarinas);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > pkg.maxBailarinas) {
      return res.status(400).json({ error: `Nº Bailarinas deve estar entre 1 e ${pkg.maxBailarinas} para o pacote ${pkg.name}` });
    }
    nb = parsed;
  }

  try {
    // 1. Create new MP preference with 7-day expiry
    const expiry = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const prefRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${MP_TOKEN}`,
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
        auto_return:     'approved',
        payment_methods: { installments: 6 },
        external_reference: JSON.stringify({ date, time, packageKey, name, email, whatsapp, numBailarinas: nb }),
        notification_url:   `${SITE_URL}/api/webhook`,
        expires:              true,
        expiration_date_to:   expiry,
      }),
    });

    const pref = await prefRes.json() as { id?: string; init_point?: string; message?: string };
    if (!pref.id || !pref.init_point) {
      throw new Error(pref.message || 'Erro ao criar preferência MP');
    }

    // 2. Cancel old pending booking
    await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action:    'cancelBooking',
        bookingId,
        reason:    'Novo link de pagamento gerado pelo admin',
      }),
    }).catch(e => console.error('[admin-payment-link] cancel error', e));

    // 3. Create new pending with fresh preference ID (webhook will confirm via this ID)
    await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action:        'createPending',
        date, start: time, packageKey,
        name, email, whatsapp,
        instagram: instagram || '',
        instagramBailarina: instagramBailarina || '',
        nomeBailarina: nomeBailarina || '',
        numBailarinas: nb,
        stripeSession: pref.id,
        source:        'admin',
      }),
    }).catch(e => console.error('[admin-payment-link] createPending error', e));

    // 4. Log
    await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action:  'addLog',
        message: `${auth.user} gerou novo link de pagamento para ${name} (${date} ${time})`,
        origin:  'painel',
      }),
    }).catch(() => {});

    return res.status(200).json({ url: pref.init_point });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[admin-payment-link]', msg);
    return res.status(500).json({ error: msg });
  }
}
