import type { VercelRequest, VercelResponse } from '@vercel/node';


const PRICE_SWITCH_MS = new Date('2026-05-16T00:00:00-03:00').getTime();
function getPackages() {
  const v2 = Date.now() >= PRICE_SWITCH_MS;
  return {
    lembranca: { name: 'Lembrança', duration: 30,  price: v2 ? 1600 : 1400, maxBailarinas: 2 },
    economico: { name: 'Econômico', duration: 60,  price: v2 ? 2100 : 1900, maxBailarinas: 3 },
    completo:  { name: 'Completo',  duration: 120, price: v2 ? 2600 : 2200, maxBailarinas: 4 },
  };
}
type PkgKey = 'lembranca' | 'economico' | 'completo';

const SCRIPT_URL = process.env.SHEETS_SCRIPT_URL!;
const SITE_URL   = process.env.SITE_URL || 'https://www.ensaiofotograficoemjoinville.com';
const MP_TOKEN   = process.env.MERCADOPAGO_ACCESS_TOKEN!;


export default async function handler(req: VercelRequest, res: VercelResponse) {
  const PACKAGES = getPackages();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  if (!MP_TOKEN) {
    return res.status(500).json({ error: 'MERCADOPAGO_ACCESS_TOKEN não configurada' });
  }

  const { date, time, packageKey, name, email, whatsapp, instagram, instagramBailarina, nomeBailarina, numBailarinas } = req.body as {
    date: string; time: string; packageKey: PkgKey;
    name: string; email: string; whatsapp: string;
    instagram?: string; instagramBailarina?: string; nomeBailarina?: string;
    numBailarinas?: number;
  };

  if (!date || !time || !packageKey || !name || !email || !whatsapp) {
    return res.status(400).json({ error: 'Campos obrigatórios faltando' });
  }
  const pkgInfo = PACKAGES[packageKey];
  if (!pkgInfo) return res.status(400).json({ error: 'Pacote inválido' });
  const nb = Number(numBailarinas);
  if (!Number.isInteger(nb) || nb < 1 || nb > pkgInfo.maxBailarinas) {
    return res.status(400).json({ error: `Nº Bailarinas deve estar entre 1 e ${pkgInfo.maxBailarinas} para o pacote ${pkgInfo.name}` });
  }

  const pkg = PACKAGES[packageKey];
  if (!pkg) return res.status(400).json({ error: 'Pacote inválido' });

  try {
    // 0. Pre-flight: confirma que o slot ainda está livre antes
    //    de criar a preference (evita ordem de pagamento órfã se
    //    alguém reservou nos últimos segundos).
    try {
      const slotsRes  = await fetch(`${SCRIPT_URL}?action=slots&date=${encodeURIComponent(date)}&package=${encodeURIComponent(packageKey)}&t=${Date.now()}`, { cache: 'no-store' });
      const slotsJson = await slotsRes.json() as { slots?: string[] };
      const livres    = Array.isArray(slotsJson.slots) ? slotsJson.slots : [];
      if (!livres.includes(time)) {
        return res.status(409).json({ error: 'Esse horário acabou de ser reservado por outra pessoa. Por favor, escolha outro.' });
      }
    } catch (e) {
      console.error('[create-checkout] pre-flight slot check failed', e);
      // Em caso de falha do pre-flight, deixa o fluxo seguir — createPending
      // ainda revalida lá no Apps Script e barra a duplicação.
    }

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
        external_reference: JSON.stringify({ date, time, packageKey, name, email, whatsapp, numBailarinas: nb }),
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
        instagram: instagram || '',
        instagramBailarina: instagramBailarina || '',
        nomeBailarina: nomeBailarina || '',
        numBailarinas: nb,
        stripeSession: pref.id,   // reusing field — stores MP preference ID
        source: 'site',
      }),
    });

    return res.status(200).json({ preferenceId: pref.id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[create-checkout]', msg);
    return res.status(500).json({ error: msg });
  }
}
