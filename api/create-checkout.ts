import type { VercelRequest, VercelResponse } from '@vercel/node';

// ─── ASAAS helpers (inlined) ───────────────────────────────────
// Inlined em vez de import './_asaas' porque o Vercel serverless bundler
// não inclui módulos prefixados com `_` no output da function (mesmo padrão
// que `_adminAuth.ts` orfão e admin-bookings.ts re-implementa inline).
const ASAAS_API_KEY = process.env.ASAAS_API_KEY || '';
const ASAAS_ENV     = (process.env.ASAAS_ENV || 'production').toLowerCase();
const ASAAS_BASE    = ASAAS_ENV === 'sandbox'
  ? 'https://api-sandbox.asaas.com/v3'
  : 'https://api.asaas.com/v3';

function asaasEnabled() { return Boolean(ASAAS_API_KEY); }

async function asaas<T = unknown>(
  path: string,
  init: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown } = {},
): Promise<T> {
  if (!ASAAS_API_KEY) throw new Error('ASAAS_API_KEY não configurada');
  const url = `${ASAAS_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: init.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      access_token:   ASAAS_API_KEY,
      'User-Agent':   'J26-EnsaioJoinville/1.0',
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* response não-JSON */ }
  if (!res.ok) {
    const body = json as { errors?: Array<{ description?: string; code?: string }>; message?: string } | null;
    const apiMsg = body?.errors?.map(e => `${e.code ? `[${e.code}] ` : ''}${e.description || ''}`).filter(Boolean).join('; ')
      || body?.message
      || (typeof text === 'string' && text.length < 500 ? text : '')
      || `HTTP ${res.status}`;
    throw new Error(`[ASAAS ${res.status}] ${apiMsg}`);
  }
  return json as T;
}

type AsaasCheckout = { id: string; link: string; status: string };

// Encode booking metadata em string compacta pipe-delimited (limite ASAAS = 100 chars).
// REGRA: nunca trunca email — email é essencial pro Resend mandar confirmação.
// Trunca o nome até zero; se ainda assim não couber, lança erro pra create-checkout
// retornar 400 e cliente saber que precisa ajustar.
function encodeAsaasRef(o: {
  date: string; time: string; packageKey: string; numBailarinas: number;
  name: string; email: string; whatsapp: string;
}): string {
  const pkg = o.packageKey.charAt(0);
  const safeName  = String(o.name || '').replace(/\|/g, ' ');
  const safeEmail = String(o.email || '').replace(/\|/g, '_');
  const build = (n: string, e: string) =>
    `v1|${o.date}|${o.time}|${pkg}|${o.numBailarinas}|${o.whatsapp}|${n}|${e}`;
  let ref = build(safeName, safeEmail);
  if (ref.length <= 100) return ref;
  // Trunca nome até caber, mantendo email íntegro
  const overhead = build('', safeEmail).length;
  const nameBudget = Math.max(0, 100 - overhead);
  ref = build(safeName.slice(0, nameBudget), safeEmail);
  if (ref.length <= 100) return ref;
  // Mesmo com nome vazio não couber — email + whatsapp + data é > 100 chars.
  // Bloqueia checkout: cliente precisa email mais curto (improvável mas possível).
  throw new Error(`Email muito longo pra checkout ASAAS (${safeEmail.length} chars). Use um email mais curto.`);
}

// Cria um Checkout ASAAS (página de cobrança hospedada). Substitui o Payment
// Link porque SÓ o Checkout combina multi-método (PIX + cartão) COM parcelamento
// — o Payment Link obriga a escolher um ou outro (não dá pra ter PIX + 6x na
// mesma página). Com chargeTypes ['DETACHED','INSTALLMENT'] o cliente, ao
// escolher cartão, vê o seletor de 1x até maxInstallments; PIX segue à vista.
// "Sem juros pro cliente" — a ASAAS desconta a taxa de parcelamento do líquido
// do lojista. Obs: o Checkout NÃO suporta boleto (billingTypes só CREDIT_CARD/PIX).
async function createAsaasCheckout(opts: {
  itemName: string; itemDescription?: string; value: number;
  externalReference: string; successUrl: string; cancelUrl: string;
}): Promise<AsaasCheckout> {
  // Até N x (default 6, configurável via env ASAAS_MAX_INSTALLMENTS sem deploy).
  // ASAAS aceita até 21 parcelas; cap defensivo em 12.
  const maxInstallments = Math.min(
    Math.max(parseInt(process.env.ASAAS_MAX_INSTALLMENTS || '6', 10) || 6, 1),
    12,
  );
  type Body = {
    billingTypes:      string[];
    chargeTypes:       string[];
    minutesToExpire:   number;
    externalReference: string;
    callback:          { successUrl: string; cancelUrl: string };
    items:             Array<{ name: string; description: string; quantity: number; value: number }>;
    installment:       { maxInstallmentCount: number };
  };
  const body: Body = {
    billingTypes:      ['CREDIT_CARD', 'PIX'],
    chargeTypes:       ['DETACHED', 'INSTALLMENT'],
    minutesToExpire:   1440,   // 24h (máximo do Checkout) — janela pro cliente pagar
    externalReference: opts.externalReference,
    callback:          { successUrl: opts.successUrl, cancelUrl: opts.cancelUrl },
    items: [{
      name:        opts.itemName,
      description: opts.itemDescription || '',
      quantity:    1,
      value:       opts.value,
    }],
    installment:       { maxInstallmentCount: maxInstallments },
  };
  return asaas<AsaasCheckout>('/checkouts', { method: 'POST', body });
}
// ─── fim ASAAS helpers ─────────────────────────────────────────


const LOTE1_START_MS = new Date('2026-05-16T00:00:00-03:00').getTime();
const LOTE2_START_MS = new Date('2026-07-01T00:00:00-03:00').getTime();
function getPackages() {
  const now = Date.now();
  if (now >= LOTE2_START_MS) {
    return {
      lembranca: { name: 'Lembrança', duration: 30,  price: 1800, maxBailarinas: 2 },
      economico: { name: 'Econômico', duration: 60,  price: 2400, maxBailarinas: 3 },
      completo:  { name: 'Completo',  duration: 120, price: 2800, maxBailarinas: 4 },
    };
  }
  if (now >= LOTE1_START_MS) {
    return {
      lembranca: { name: 'Lembrança', duration: 30,  price: 1600, maxBailarinas: 2 },
      economico: { name: 'Econômico', duration: 60,  price: 2100, maxBailarinas: 3 },
      completo:  { name: 'Completo',  duration: 120, price: 2600, maxBailarinas: 4 },
    };
  }
  return {
    lembranca: { name: 'Lembrança', duration: 30,  price: 1400, maxBailarinas: 2 },
    economico: { name: 'Econômico', duration: 60,  price: 1900, maxBailarinas: 3 },
    completo:  { name: 'Completo',  duration: 120, price: 2200, maxBailarinas: 4 },
  };
}
type PkgKey = 'lembranca' | 'economico' | 'completo';

const SCRIPT_URL = process.env.SHEETS_SCRIPT_URL!;
const SITE_URL   = process.env.SITE_URL || 'https://www.ensaiofotograficoemjoinville.com';
const MP_TOKEN   = process.env.MERCADOPAGO_ACCESS_TOKEN!;

// Feature flag: 'mp' (default) ou 'asaas'. Permite alternar sem deploy.
// Quando 'asaas': cria Link de Pagamento ASAAS e retorna { paymentLinkUrl }.
// Quando 'mp':    cria Preference MP e retorna { preferenceId } (Brick).
const GATEWAY = (process.env.PAYMENT_GATEWAY || 'mp').toLowerCase();


export default async function handler(req: VercelRequest, res: VercelResponse) {
  const PACKAGES = getPackages();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  if (GATEWAY === 'asaas' && !asaasEnabled()) {
    return res.status(500).json({ error: 'PAYMENT_GATEWAY=asaas mas ASAAS_API_KEY não configurada' });
  }
  if (GATEWAY === 'mp' && !MP_TOKEN) {
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

    // 1. Cria a ordem de pagamento — branch pelo gateway ativo.
    //    Em ambos os casos guardamos um identificador na coluna `stripeSession`
    //    do Sheets (campo legado reusado). Para MP é o preferenceId; para ASAAS
    //    é o checkout.id (que o webhook pareia via payment.checkoutSession).
    let externalId: string;          // ID que vai pro Sheets (preferenceId | checkoutId)
    let mpPreferenceId: string | null = null;
    let asaasPaymentLinkUrl: string | null = null;   // resposta usa a chave `paymentLinkUrl`

    // MP aceita externalReference grande; ASAAS limita a 100 chars (encoded compact).
    const mpExternalReference    = JSON.stringify({ date, time, packageKey, name, email, whatsapp, numBailarinas: nb });
    const asaasExternalReference = encodeAsaasRef({ date, time, packageKey, numBailarinas: nb, name, email, whatsapp });

    if (GATEWAY === 'asaas') {
      const checkout = await createAsaasCheckout({
        itemName:          `Pacote ${pkg.name}`,   // ASAAS limita item.name a 30 chars
        itemDescription:   `${date.split('-').reverse().join('/')} às ${time} · ${pkg.duration} min · ${nb} ${nb === 1 ? 'bailarina' : 'bailarinas'}`,
        value:             pkg.price,
        externalReference: asaasExternalReference,
        successUrl:        `${SITE_URL}/agendamento/sucesso`,
        cancelUrl:         `${SITE_URL}/agendamento?cancelado=1`,
      });
      externalId           = checkout.id;
      asaasPaymentLinkUrl  = checkout.link;
    } else {
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
          external_reference: mpExternalReference,
          notification_url: `${SITE_URL}/api/webhook`,
          expires: true,
          expiration_date_to: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        }),
      });

      const pref = await prefRes.json() as { id?: string; init_point?: string; message?: string };
      if (!pref.id || !pref.init_point) {
        throw new Error(pref.message || 'Erro ao criar preferência Mercado Pago');
      }
      externalId      = pref.id;
      mpPreferenceId  = pref.id;
    }

    // 2. Mark slot as Pending in Sheets — se falhar, rollback do paymentLink.
    // Cenário evitado: link de pagamento válido fica órfão (sem pending no Sheets).
    // Cliente paga → webhook não acha pending → confirmBooking falha → cliente
    // pagou sem reserva. Aqui invalidamos o link se o Sheets não confirmar criação.
    try {
      const pendingRes = await fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'createPending',
          date, start: time, packageKey, name, email, whatsapp,
          instagram: instagram || '',
          instagramBailarina: instagramBailarina || '',
          nomeBailarina: nomeBailarina || '',
          numBailarinas: nb,
          stripeSession: externalId,   // legacy field — MP preferenceId OR ASAAS checkout id
          gateway: GATEWAY,            // novo: indica qual gateway gerou esse pending
          source: 'site',
        }),
      });
      if (!pendingRes.ok) throw new Error(`Sheets HTTP ${pendingRes.status}`);
    } catch (pendingErr) {
      // Rollback: tenta invalidar o link no gateway pra evitar pagamento órfão.
      const errMsg = pendingErr instanceof Error ? pendingErr.message : String(pendingErr);
      console.error(`[create-checkout] createPending FAILED após paymentLink criado: ${errMsg} — rollback...`);
      if (GATEWAY === 'asaas' && externalId) {
        await asaas(`/checkouts/${externalId}/cancel`, { method: 'POST' })
          .catch(e => console.error('[create-checkout] rollback ASAAS falhou:', e instanceof Error ? e.message : e));
      } else if (GATEWAY === 'mp' && externalId) {
        await fetch(`https://api.mercadopago.com/checkout/preferences/${externalId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MP_TOKEN}` },
          body: JSON.stringify({
            expires:            true,
            expiration_date_to: new Date(Date.now() - 60 * 1000).toISOString(),
          }),
        }).catch(e => console.error('[create-checkout] rollback MP falhou:', e instanceof Error ? e.message : e));
      }
      // Re-throw — frontend mostra erro pro cliente, que pode tentar de novo
      throw new Error('Erro ao reservar slot. Tente novamente.');
    }

    // 3. Resposta: shape depende do gateway.
    if (GATEWAY === 'asaas') {
      return res.status(200).json({ paymentLinkUrl: asaasPaymentLinkUrl, gateway: 'asaas' });
    }
    return res.status(200).json({ preferenceId: mpPreferenceId, gateway: 'mp' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[create-checkout]', msg);
    return res.status(500).json({ error: msg });
  }
}
