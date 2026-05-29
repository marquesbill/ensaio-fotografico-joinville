/**
 * admin-bookings.ts — Função consolidada do painel admin.
 *
 * Roteador único pra todas as ações administrativas + listagem +
 * dashboard GA4. Consolidado em uma só Serverless Function pra ficar
 * no limite de 12 do plano Hobby do Vercel.
 *
 * Endpoints (auth HMAC obrigatório):
 *   GET  /api/admin-bookings                          → lista bookings (proxy p/ Apps Script)
 *   GET  /api/admin-bookings?endpoint=ga4-dashboard   → KPIs/trend/canais/eventos do GA4
 *   GET  /api/admin-bookings?endpoint=ga4-dashboard&ping=1 → ping auth (usado pelo Dashboard)
 *
 *   POST /api/admin-bookings  { action: 'cancel'             , ... }
 *   POST /api/admin-bookings  { action: 'confirm'            , ... }  ← pagamento manual
 *   POST /api/admin-bookings  { action: 'create'             , ... }  ← novo booking pelo painel
 *   POST /api/admin-bookings  { action: 'edit'               , ... }  ← editar dados
 *   POST /api/admin-bookings  { action: 'paymentLink'        , ... }  ← gerar novo link MP
 *   POST /api/admin-bookings  { action: 'reschedule'         , ... }
 *   POST /api/admin-bookings  { action: 'resendConfirmation' , ... }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac } from 'crypto';
import { Resend } from 'resend';
import { BetaAnalyticsDataClient } from '@google-analytics/data';
import { OAuth2Client, JWT } from 'google-auth-library';

/* ───────── Config ───────── */

const SECRET          = process.env.ADMIN_SECRET || 'dev-secret-change-me';
const TOKEN_TTL       = 8 * 60 * 60 * 1000; // 8 h
const SCRIPT_URL      = process.env.SHEETS_SCRIPT_URL!;
const SITE_URL        = process.env.SITE_URL || 'https://www.ensaiofotograficoemjoinville.com';
const MP_TOKEN        = process.env.MERCADOPAGO_ACCESS_TOKEN!;
const GATEWAY         = (process.env.PAYMENT_GATEWAY || 'mp').toLowerCase();
const GA4_PROPERTY_ID = process.env.GA4_PROPERTY_ID || '494185724';

/**
 * Resolve o gateway pra uma operação de cobrança no /admin. A Mari escolhe
 * no painel (ASAAS ou MercadoPago) e o frontend manda `gateway` no body —
 * permite, ex., gerar link MP (que parcela em 6x) enquanto o parcelamento
 * ASAAS não está liberado. Sem `gateway` no request, cai no default global
 * (env PAYMENT_GATEWAY).
 */
function resolveGateway(raw: unknown): 'mp' | 'asaas' {
  const g = String(raw || '').toLowerCase();
  if (g === 'mp' || g === 'asaas') return g;
  return GATEWAY === 'asaas' ? 'asaas' : 'mp';
}

/**
 * Detecta o gateway de um `externalId` (coluna stripeSession do Sheets) pelo
 * formato do ID. Necessário pra cancelar o link ANTIGO no gateway certo
 * quando a Mari regenera a cobrança trocando de gateway (ex: link velho era
 * ASAAS, novo é MP).
 *  - ASAAS Checkout id  = UUID 8-4-4-4-12
 *  - MP preference id   = "<dígitos>-<uuid>"
 *  - ASAAS paymentLink  = alfanumérico curto (legado, ainda em trânsito)
 */
function detectGatewayFromId(externalId: string): 'mp' | 'asaas' {
  const id = String(externalId || '');
  // Checkout UUID primeiro — senão um UUID com 8 dígitos iniciais cairia no /^\d+-/.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return 'asaas';
  if (/^\d+-/.test(id)) return 'mp';
  return 'asaas';
}

/* ───────── ASAAS helpers (inlined — Vercel não bundla módulos _*.ts) ───────── */

const ASAAS_API_KEY = process.env.ASAAS_API_KEY || '';
const ASAAS_ENV     = (process.env.ASAAS_ENV || 'production').toLowerCase();
const ASAAS_BASE    = ASAAS_ENV === 'sandbox'
  ? 'https://api-sandbox.asaas.com/v3'
  : 'https://api.asaas.com/v3';

async function asaasApi<T = unknown>(
  path: string,
  init: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown } = {},
): Promise<T> {
  if (!ASAAS_API_KEY) throw new Error('ASAAS_API_KEY não configurada');
  const url = `${ASAAS_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const r = await fetch(url, {
    method: init.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      access_token:   ASAAS_API_KEY,
      'User-Agent':   'J26-EnsaioJoinville-Admin/1.0',
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await r.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* não-JSON */ }
  if (!r.ok) {
    const body = json as { errors?: Array<{ description?: string; code?: string }>; message?: string } | null;
    const apiMsg = body?.errors?.map(e => `${e.code ? `[${e.code}] ` : ''}${e.description || ''}`).filter(Boolean).join('; ')
      || body?.message
      || (typeof text === 'string' && text.length < 500 ? text : '')
      || `HTTP ${r.status}`;
    throw new Error(`[ASAAS ${r.status}] ${apiMsg}`);
  }
  return json as T;
}

// Encoder do externalReference compacto (formato `v1|...`) — mesmo de create-checkout.ts.
// Limite ASAAS é 100 chars; JSON do MP tem ~180. Por isso usamos pipe-delimited.
// REGRA: nunca trunca email — email é essencial pro Resend mandar confirmação.
// Trunca o nome até zero; se ainda assim não couber, lança erro.
function encodeAsaasRefAdmin(o: {
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
  const overhead = build('', safeEmail).length;
  const nameBudget = Math.max(0, 100 - overhead);
  ref = build(safeName.slice(0, nameBudget), safeEmail);
  if (ref.length <= 100) return ref;
  throw new Error(`Email muito longo pra checkout ASAAS (${safeEmail.length} chars). Use um email mais curto.`);
}

type AsaasCheckout = { id: string; link: string; status: string };

/**
 * Cancela um link de pagamento ASAAS.
 *  - Checkout (novo)        → POST /checkouts/{id}/cancel
 *  - Payment Link (legado)  → DELETE /paymentLinks/{id}
 * Distinção pelo formato do id (UUID = checkout). Durante a migração ainda
 * podem existir paymentLinks antigos em trânsito.
 */
async function cancelAsaasLink(id: string): Promise<void> {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    await asaasApi(`/checkouts/${id}/cancel`, { method: 'POST' });
  } else {
    await asaasApi(`/paymentLinks/${id}`, { method: 'DELETE' });
  }
}

/**
 * Cria um Checkout ASAAS pra uso administrativo (Mari gera link p/ cliente).
 * Mesmo motivo da versão do site (createAsaasCheckout em create-checkout.ts):
 * só o Checkout combina PIX + cartão parcelado na mesma página. O cliente
 * preenche os próprios dados (nome/CPF/endereço) na página hospedada.
 * Obs: o Checkout expira em no máx. 24h (o Payment Link dava 3 dias).
 */
async function createAsaasCheckoutAdmin(opts: {
  itemName: string; itemDescription?: string; value: number;
  externalReference: string; successUrl: string; cancelUrl: string;
}): Promise<AsaasCheckout> {
  // Até N x (default 6, configurável via env ASAAS_MAX_INSTALLMENTS sem deploy).
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
    minutesToExpire:   1440,
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
  return asaasApi<AsaasCheckout>('/checkouts', { method: 'POST', body });
}

/* ───────── fim ASAAS helpers ───────── */
const ANDRE_EMAIL     = 'andreffotografia@gmail.com';
const resend          = new Resend(process.env.RESEND_API_KEY!);

/* ───────── Auth (HMAC token) ───────── */

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

/* ───────── Packages (tier por lote) ───────── */

const LOTE1_START_MS = new Date('2026-05-16T00:00:00-03:00').getTime();
const LOTE2_START_MS = new Date('2026-07-01T00:00:00-03:00').getTime();
type PkgKey = 'lembranca' | 'economico' | 'completo';
type PackageDef = { name: string; duration: number; price: number; maxBailarinas: number };

function getPackages(): Record<PkgKey, PackageDef> {
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

/* ───────── Date helpers ───────── */

function fmtDate(d: string) {
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

const MONTHS_PT = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const DAYS_PT   = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
function fmtDateLong(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return `${String(d).padStart(2, '0')} de ${MONTHS_PT[m - 1]} de ${y} · ${DAYS_PT[dt.getUTCDay()]}`;
}

function calcEnd(time: string, dur: number) {
  const [h, m] = time.split(':').map(Number);
  const e = h * 60 + m + dur;
  return String(Math.floor(e / 60)).padStart(2, '0') + ':' + String(e % 60).padStart(2, '0');
}

function daysAgo(days: number): string {
  const d = new Date(); d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/* ───────── Email template (confirmação/cancelamento/remarcação) ───────── */

const HERO_IMG_URL = 'https://www.ensaiofotograficoemjoinville.com/email-hero.jpg';

const VARIANT_CFG: Record<string, { tag: string; intro: string; tagColor: string }> = {
  confirmed:   { tag: 'Reserva Confirmada', intro: 'Recebemos sua reserva. Os detalhes do seu ensaio estão registrados abaixo — guarde este e-mail para referência.', tagColor: '#7a3f8f' },
  rescheduled: { tag: 'Reserva Remarcada',  intro: 'Seu ensaio foi remarcado. Confira abaixo o novo horário e demais detalhes.', tagColor: '#7a3f8f' },
  cancelled:   { tag: 'Reserva Cancelada',  intro: 'Sua reserva foi cancelada. Os detalhes do ensaio que foi cancelado estão registrados abaixo. Em caso de dúvida, fale conosco.', tagColor: '#b91c1c' },
};

function buildBookingEmailHtml(data: {
  name: string; date: string; time: string; endTime: string;
  packageName: string; duration: number; price: string; bookingId: string;
  numBailarinas: number;
}, variant: 'confirmed' | 'rescheduled' | 'cancelled'): string {
  const cfg = VARIANT_CFG[variant];
  const firstName = String(data.name || '').trim().split(/\s+/)[0] || data.name;
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${cfg.tag}</title></head>
<body style="margin:0;padding:0;background:#f5f0fa;font-family:Georgia,'Cormorant Garamond','Times New Roman',serif;color:#1a1a1a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f0fa;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:6px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
<tr><td style="line-height:0;"><img src="${HERO_IMG_URL}" alt="" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;"></td></tr>
<tr><td style="padding:36px 40px 0;text-align:center;"><span style="display:inline-block;font-family:Georgia,'Times New Roman',serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${cfg.tagColor};border:1px solid #e8d8f0;border-radius:30px;padding:6px 16px;">${cfg.tag}</span></td></tr>
<tr><td style="padding:24px 40px 4px;text-align:center;"><p style="margin:0;font-family:Georgia,'Cormorant Garamond',serif;font-size:30px;line-height:1.2;color:#1a1a1a;font-weight:400;font-style:italic;">Olá, <strong style="font-weight:600;">${firstName}</strong>.</p></td></tr>
<tr><td style="padding:18px 56px 32px;text-align:center;"><p style="margin:0;font-family:Georgia,serif;font-size:14px;line-height:1.65;color:#555;">${cfg.intro}</p></td></tr>
<tr><td style="padding:0 40px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #eee;">
<tr><td style="padding:18px 0;border-bottom:1px solid #eee;"><p style="margin:0 0 4px;font-family:Georgia,serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">Data</p><p style="margin:0;font-family:Georgia,serif;font-size:16px;color:#1a1a1a;">${fmtDateLong(data.date)}</p></td></tr>
<tr><td style="padding:18px 0;border-bottom:1px solid #eee;"><p style="margin:0 0 4px;font-family:Georgia,serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">Horário</p><p style="margin:0;font-family:Georgia,serif;font-size:16px;color:#1a1a1a;">${data.time} — ${data.endTime}</p></td></tr>
<tr><td style="padding:18px 0;border-bottom:1px solid #eee;"><p style="margin:0 0 4px;font-family:Georgia,serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">Pacote</p><p style="margin:0;font-family:Georgia,serif;font-size:16px;color:#1a1a1a;">${data.packageName} · ${data.duration} minutos</p></td></tr>
<tr><td style="padding:18px 0;border-bottom:1px solid #eee;"><p style="margin:0 0 4px;font-family:Georgia,serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">Grupo</p><p style="margin:0;font-family:Georgia,serif;font-size:16px;color:#1a1a1a;">${data.numBailarinas} ${data.numBailarinas === 1 ? 'bailarina' : 'bailarinas'}</p></td></tr>
<tr><td style="padding:18px 0;border-bottom:1px solid #eee;"><p style="margin:0 0 4px;font-family:Georgia,serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">Local</p><p style="margin:0;font-family:Georgia,serif;font-size:16px;color:#1a1a1a;"><a href="https://www.google.com/maps/search/Hotel+Le+Village+Joinville+SC" style="color:#1a1a1a;text-decoration:none;">Hotel Le Village</a></p><p style="margin:2px 0 0;font-family:Georgia,serif;font-size:13px;color:#777;">Sala Esmeralda · Joinville · SC</p></td></tr>
<tr><td style="padding:18px 0;"><p style="margin:0 0 4px;font-family:Georgia,serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">Valor</p><p style="margin:0;font-family:Georgia,serif;font-size:18px;color:#7a3f8f;font-weight:600;">R$ ${data.price}</p></td></tr>
</table></td></tr>
<tr><td style="padding:32px 40px 24px;text-align:center;border-top:1px solid #eee;"><p style="margin:0;font-family:Georgia,serif;font-size:13px;line-height:1.6;color:#666;">Em caso de dúvida ou necessidade de remarcação, fale conosco pelo</p><p style="margin:6px 0 0;font-family:Georgia,serif;font-size:14px;line-height:1.6;"><a href="https://wa.me/5511519606272" style="color:#128C7E;text-decoration:none;font-weight:600;white-space:nowrap;">WhatsApp (11) 5196-0627</a></p></td></tr>
<tr><td style="padding:0 40px 24px;text-align:center;"><p style="margin:0;font-family:Georgia,serif;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#bbb;">Código da reserva · <span style="color:#777;font-family:monospace;letter-spacing:1px;">${data.bookingId}</span></p></td></tr>
<tr><td style="padding:20px 40px 28px;text-align:center;background:#fafafa;border-top:1px solid #eee;"><p style="margin:0;font-family:Georgia,serif;font-size:12px;color:#999;">© 2026 André Ferreira Fotografia</p><p style="margin:4px 0 0;font-family:Georgia,serif;font-size:12px;"><a href="https://www.instagram.com/affotografia" style="color:#7a3f8f;text-decoration:none;">@affotografia</a></p></td></tr>
</table></td></tr></table></body></html>`;
}

/* ───────── GA4 Dashboard ───────── */

function categorizeChannel(channel: string): string {
  const c = channel.toLowerCase();
  if (c.includes('paid social'))    return 'paid_social';
  if (c.includes('organic social')) return 'organic_social';
  if (c.includes('direct'))         return 'direct';
  if (c.includes('referral'))       return 'referral';
  if (c.includes('organic search')) return 'organic_search';
  if (c.includes('paid search'))    return 'paid_search';
  if (c.includes('email'))          return 'email';
  return 'other';
}

/**
 * Converte par `source/medium` raw do GA4 em label descritivo pra UI.
 * Vários pares descrevem a MESMA origem do ponto de vista do negócio
 * (ex: instagram.com referral, l.instagram.com referral, ig referral todos
 * representam "Instagram orgânico/link na bio"). Esse mapeamento agrupa.
 *
 * Categorias canônicas:
 *  - "Meta Ads (Instagram)" / "Meta Ads (Facebook)" — paid social
 *  - "Instagram (orgânico/bio)"                    — referral/social não-pago
 *  - "Facebook (orgânico)"
 *  - "Google Ads"                                  — paid search
 *  - "Google (busca orgânica)"                     — organic search
 *  - "Direto (URL ou link salvo)"                  — (direct)/(none) — inclui
 *                                                    quem digitou, bookmark
 *                                                    ou voltou pelo link salvo
 *  - "WhatsApp"                                    — wa.me/api.whatsapp
 *  - "Email"
 *  - "Referência (<dominio>)"                      — outros referrals
 *  - "Desconhecido"                                — (not set)
 */
function humanizeSource(source: string, medium: string): string {
  const s = String(source || '').toLowerCase().trim();
  const m = String(medium || '').toLowerCase().trim();
  const cap = (x: string) => x ? x[0].toUpperCase() + x.slice(1) : '';

  const isPaid = m === 'cpc' || m === 'paid' || m === 'paid_social' || m === 'paidsocial' || m === 'ppc';

  // Meta Ads (Instagram/Facebook pagos)
  if (isPaid && (s.includes('instagram') || s === 'ig')) return 'Meta Ads (Instagram)';
  if (isPaid && (s.includes('facebook')  || s === 'fb')) return 'Meta Ads (Facebook)';
  if (isPaid && (s === 'meta' || s === 'an'))             return 'Meta Ads';

  // Google
  if (s.includes('google')) {
    if (m === 'organic')                    return 'Google (busca orgânica)';
    if (isPaid)                             return 'Google Ads';
    if (m === 'referral')                   return 'Google (referral)';
    return `Google (${m})`;
  }

  // Instagram orgânico (link da bio, stories, posts)
  if (s.includes('instagram') || s === 'ig' || s === 'l.instagram.com' || s === 'lm.instagram.com') {
    return 'Instagram (orgânico/bio)';
  }

  // Facebook orgânico
  if (s.includes('facebook') || s === 'fb' || s === 'm.facebook.com' || s === 'l.facebook.com') {
    return 'Facebook (orgânico)';
  }

  // WhatsApp
  if (s.includes('whatsapp') || s.includes('wa.me') || s.includes('api.whatsapp')) {
    return 'WhatsApp';
  }

  // Direto — URL digitada, bookmark, link salvo, link compartilhado sem referrer
  if (s === '(direct)' || s === 'direct' || (s === '(none)' && (m === '(none)' || m === 'none'))) {
    return 'Direto (URL ou link salvo)';
  }

  // Email
  if (m === 'email') return s !== '(direct)' && s !== '(none)' ? `Email (${s})` : 'Email';

  // Outras buscas orgânicas (Bing, Yahoo, DuckDuckGo)
  if (m === 'organic') return `${cap(s)} (busca orgânica)`;

  // Não-set
  if (s === '(not set)' || s === '' || s === 'unknown') return 'Desconhecido';

  // Outros referrals — boca-a-boca via blog, parceiro, outro site
  if (m === 'referral') return `Referência (${s})`;

  // Fallback
  return `${cap(s)} · ${m}`;
}

function buildGa4Client(): BetaAnalyticsDataClient {
  const clientId     = process.env.GA4_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GA4_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GA4_OAUTH_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('OAuth GA4 não configurado (GA4_OAUTH_CLIENT_ID/CLIENT_SECRET/REFRESH_TOKEN ausentes)');
  }

  const oauth2 = new OAuth2Client(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });

  return new BetaAnalyticsDataClient({ authClient: oauth2 as unknown as never });
}

async function handleGa4Dashboard(req: VercelRequest, res: VercelResponse) {
  if (!process.env.GA4_OAUTH_REFRESH_TOKEN) {
    return res.status(503).json({
      error:   'OAuth GA4 não configurado',
      details: 'Veja docs/ga4-oauth-setup.md',
    });
  }

  const days = Math.min(Math.max(parseInt(String(req.query.range || '28'), 10) || 28, 1), 365);
  const property = `properties/${GA4_PROPERTY_ID}`;
  const client = buildGa4Client();

  const periodCurrent  = { startDate: daysAgo(days),     endDate: 'today' };
  const periodPrevious = { startDate: daysAgo(days * 2), endDate: daysAgo(days + 1) };

  const [kpiCur, kpiPrev] = await Promise.all([
    client.runReport({
      property,
      dateRanges: [periodCurrent],
      metrics: [
        { name: 'totalUsers' }, { name: 'sessions' },
        { name: 'engagementRate' }, { name: 'newUsers' },
      ],
    }),
    client.runReport({
      property,
      dateRanges: [periodPrevious],
      metrics: [
        { name: 'totalUsers' }, { name: 'sessions' },
        { name: 'engagementRate' }, { name: 'newUsers' },
      ],
    }),
  ]);

  const curRow  = kpiCur[0].rows?.[0]?.metricValues || [];
  const prevRow = kpiPrev[0].rows?.[0]?.metricValues || [];
  const num = (i: number, src: typeof curRow) => Number(src?.[i]?.value || 0);

  const kpis = {
    totalUsers:     { value: num(0, curRow), deltaPct: pctDelta(num(0, curRow), num(0, prevRow)) },
    sessions:       { value: num(1, curRow), deltaPct: pctDelta(num(1, curRow), num(1, prevRow)) },
    engagementRate: { value: num(2, curRow), deltaPct: pctDelta(num(2, curRow), num(2, prevRow)) },
    newUsers:       { value: num(3, curRow), deltaPct: pctDelta(num(3, curRow), num(3, prevRow)) },
  };

  const [trendReport] = await client.runReport({
    property,
    dateRanges: [periodCurrent],
    dimensions: [{ name: 'date' }],
    metrics:    [{ name: 'totalUsers' }],
    orderBys:   [{ dimension: { dimensionName: 'date' } }],
  });
  const trend = (trendReport.rows || []).map((r) => {
    const raw = r.dimensionValues?.[0]?.value || '';
    const formatted = raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
    return { date: formatted, value: Number(r.metricValues?.[0]?.value || 0) };
  });

  const [channelReport] = await client.runReport({
    property,
    dateRanges: [periodCurrent],
    dimensions: [{ name: 'sessionDefaultChannelGroup' }],
    metrics:    [{ name: 'sessions' }],
    orderBys:   [{ metric: { metricName: 'sessions' }, desc: true }],
    limit:      10,
  });
  const channels = (channelReport.rows || []).map((r) => {
    const label = r.dimensionValues?.[0]?.value || 'Unknown';
    return { label, value: Number(r.metricValues?.[0]?.value || 0), category: categorizeChannel(label) };
  });

  const [eventsReport] = await client.runReport({
    property,
    dateRanges: [periodCurrent],
    dimensions: [{ name: 'eventName' }],
    metrics:    [{ name: 'eventCount' }],
    orderBys:   [{ metric: { metricName: 'eventCount' }, desc: true }],
    limit:      25,
  });
  const topEvents = (eventsReport.rows || []).map((r) => ({
    event_name: r.dimensionValues?.[0]?.value || 'unknown',
    count: Number(r.metricValues?.[0]?.value || 0),
  }));

  return res.status(200).json({
    range: { start: periodCurrent.startDate, end: 'today', days },
    fetched_at:   new Date().toISOString(),
    next_refresh: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
    kpis, trend, channels, topEvents,
  });
}

/* ───────── Google Sheets (Service Account JWT) ───────── */

const LEADS_SHEET_ID    = '1H7AT6rJ0ojyTi4zp0DG6PEUMfzdFn-lUlZ6-8fXNBqA';
const BOOKINGS_SHEET_ID = '1e8PA6anb12YRD5jn-0Ei0mM1SkaB9RkZhfsz-7qlqQA';

interface SACredentials {
  client_email: string;
  private_key:  string;
}

function loadSACredentials(): SACredentials {
  const raw = process.env.GOOGLE_SA_JSON || process.env.GOOGLE_SA_JSON_B64;
  if (!raw) throw new Error('GOOGLE_SA_JSON (ou _B64) ausente nas env vars do Vercel');

  // Suporta tanto JSON puro quanto base64 (pra contornar UIs que mexem em \n)
  let jsonStr = raw;
  if (process.env.GOOGLE_SA_JSON_B64 && !process.env.GOOGLE_SA_JSON) {
    jsonStr = Buffer.from(raw, 'base64').toString('utf8');
  }

  let creds: SACredentials;
  try {
    creds = JSON.parse(jsonStr) as SACredentials;
  } catch (e) {
    throw new Error('GOOGLE_SA_JSON não é JSON válido: ' + (e instanceof Error ? e.message : String(e)));
  }

  if (!creds.client_email || !creds.private_key) {
    throw new Error('GOOGLE_SA_JSON faltando client_email ou private_key');
  }

  // Normaliza \n literal em quebras reais (caso o paste no Vercel tenha mantido \n como texto)
  if (creds.private_key.includes('\\n')) {
    creds.private_key = creds.private_key.replace(/\\n/g, '\n');
  }

  return creds;
}

function buildSheetsAuth(scopes = ['https://www.googleapis.com/auth/spreadsheets.readonly']): JWT {
  const creds = loadSACredentials();
  return new JWT({
    email:  creds.client_email,
    key:    creds.private_key,
    scopes,
  });
}

async function fetchSheetRange(spreadsheetId: string, range: string): Promise<string[][]> {
  const auth = buildSheetsAuth();
  const tokenResp = await auth.getAccessToken();
  const token = typeof tokenResp === 'string' ? tokenResp : tokenResp?.token;
  if (!token) throw new Error('Não foi possível obter access token da SA');

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Sheets API ${r.status}: ${body.slice(0, 300)}`);
  }
  const json = await r.json() as { values?: string[][] };
  return json.values || [];
}

/* ───────── Brazil DDD → State mapping (geo inference de WhatsApp) ───────── */

const DDD_TO_STATE: Record<string, { state: string; region: string }> = {
  '11': { state: 'SP', region: 'São Paulo' },
  '12': { state: 'SP', region: 'Vale do Paraíba' },
  '13': { state: 'SP', region: 'Baixada Santista' },
  '14': { state: 'SP', region: 'Bauru' },
  '15': { state: 'SP', region: 'Sorocaba' },
  '16': { state: 'SP', region: 'Ribeirão Preto' },
  '17': { state: 'SP', region: 'São José do Rio Preto' },
  '18': { state: 'SP', region: 'Presidente Prudente' },
  '19': { state: 'SP', region: 'Campinas' },
  '21': { state: 'RJ', region: 'Rio de Janeiro' },
  '22': { state: 'RJ', region: 'Campos dos Goytacazes' },
  '24': { state: 'RJ', region: 'Volta Redonda' },
  '27': { state: 'ES', region: 'Vitória' },
  '28': { state: 'ES', region: 'Cachoeiro de Itapemirim' },
  '31': { state: 'MG', region: 'Belo Horizonte' },
  '32': { state: 'MG', region: 'Juiz de Fora' },
  '33': { state: 'MG', region: 'Governador Valadares' },
  '34': { state: 'MG', region: 'Uberlândia' },
  '35': { state: 'MG', region: 'Poços de Caldas' },
  '37': { state: 'MG', region: 'Divinópolis' },
  '38': { state: 'MG', region: 'Montes Claros' },
  '41': { state: 'PR', region: 'Curitiba' },
  '42': { state: 'PR', region: 'Ponta Grossa' },
  '43': { state: 'PR', region: 'Londrina' },
  '44': { state: 'PR', region: 'Maringá' },
  '45': { state: 'PR', region: 'Cascavel/Foz' },
  '46': { state: 'PR', region: 'Pato Branco' },
  '47': { state: 'SC', region: 'Joinville/Itajaí' },
  '48': { state: 'SC', region: 'Florianópolis' },
  '49': { state: 'SC', region: 'Chapecó' },
  '51': { state: 'RS', region: 'Porto Alegre' },
  '53': { state: 'RS', region: 'Pelotas' },
  '54': { state: 'RS', region: 'Caxias do Sul' },
  '55': { state: 'RS', region: 'Santa Maria' },
  '61': { state: 'DF', region: 'Brasília' },
  '62': { state: 'GO', region: 'Goiânia' },
  '63': { state: 'TO', region: 'Palmas' },
  '64': { state: 'GO', region: 'Rio Verde' },
  '65': { state: 'MT', region: 'Cuiabá' },
  '66': { state: 'MT', region: 'Rondonópolis' },
  '67': { state: 'MS', region: 'Campo Grande' },
  '68': { state: 'AC', region: 'Rio Branco' },
  '69': { state: 'RO', region: 'Porto Velho' },
  '71': { state: 'BA', region: 'Salvador' },
  '73': { state: 'BA', region: 'Ilhéus/Itabuna' },
  '74': { state: 'BA', region: 'Juazeiro' },
  '75': { state: 'BA', region: 'Feira de Santana' },
  '77': { state: 'BA', region: 'Vitória da Conquista' },
  '79': { state: 'SE', region: 'Aracaju' },
  '81': { state: 'PE', region: 'Recife' },
  '82': { state: 'AL', region: 'Maceió' },
  '83': { state: 'PB', region: 'João Pessoa' },
  '84': { state: 'RN', region: 'Natal' },
  '85': { state: 'CE', region: 'Fortaleza' },
  '86': { state: 'PI', region: 'Teresina' },
  '87': { state: 'PE', region: 'Petrolina' },
  '88': { state: 'CE', region: 'Juazeiro do Norte' },
  '89': { state: 'PI', region: 'Picos' },
  '91': { state: 'PA', region: 'Belém' },
  '92': { state: 'AM', region: 'Manaus' },
  '93': { state: 'PA', region: 'Santarém' },
  '94': { state: 'PA', region: 'Marabá' },
  '95': { state: 'RR', region: 'Boa Vista' },
  '96': { state: 'AP', region: 'Macapá' },
  '97': { state: 'AM', region: 'Coari' },
  '98': { state: 'MA', region: 'São Luís' },
  '99': { state: 'MA', region: 'Imperatriz' },
};

function extractDDD(whatsapp: string | null | undefined): string | null {
  if (!whatsapp) return null;
  const digits = String(whatsapp).replace(/\D/g, '');
  if (digits.length < 10) return null;
  // Remove código país 55 se presente (12 ou 13 dígitos totais)
  let cleaned = digits;
  if ((cleaned.length === 12 || cleaned.length === 13) && cleaned.startsWith('55')) {
    cleaned = cleaned.slice(2);
  }
  if (cleaned.length !== 10 && cleaned.length !== 11) return null;
  const ddd = cleaned.slice(0, 2);
  if (!/^[1-9][0-9]$/.test(ddd)) return null;
  // Aceita só DDDs conhecidos (filtra dígitos aleatórios)
  return DDD_TO_STATE[ddd] ? ddd : null;
}

function normalizePackage(p: string | null | undefined): 'lembranca' | 'economico' | 'completo' | 'unknown' {
  const s = String(p || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (s.startsWith('lemb')) return 'lembranca';
  if (s.startsWith('econ')) return 'economico';
  if (s.startsWith('comp')) return 'completo';
  return 'unknown';
}

function normalizeStatus(s: string | null | undefined): 'confirmado' | 'pendente' | 'cancelado' | 'other' {
  const x = String(s || '').toLowerCase();
  if (x.startsWith('confirm')) return 'confirmado';
  if (x.startsWith('pend')) return 'pendente';
  if (x.startsWith('cancel')) return 'cancelado';
  return 'other';
}

/**
 * Parser robusto pra timestamps da coluna `criado_em` no Sheets.
 *
 * Formatos vistos em produção:
 *   1. ISO 8601 normal — "2026-05-23T10:30:00.000Z" (fluxo de pagamento)
 *   2. "admin-new-{ms}"    — quando admin cria booking sem pagamento
 *      (handleCreate Path B usa esse sessionId e Apps Script aparentemente
 *      grava ele na col N por engano)
 *   3. "admin-direct-{ms}" — mesmo padrão pra confirmação direta admin
 *   4. Date inválida / vazia — retorna 0
 *
 * Retorna Unix ms timestamp, ou 0 se não parseável.
 */
function parseBookingTimestamp(raw: string | null | undefined): number {
  if (!raw) return 0;
  const s = String(raw).trim();
  // Formatos admin com timestamp embutido — extrai os dígitos após o último hífen
  const adminMatch = s.match(/^admin-(?:new|direct|manual)-(\d+)$/);
  if (adminMatch) {
    const ms = parseInt(adminMatch[1], 10);
    return Number.isFinite(ms) && ms > 0 ? ms : 0;
  }
  // Tenta parsing ISO/Date normal
  const ts = new Date(s).getTime();
  return Number.isFinite(ts) && ts > 0 ? ts : 0;
}

/* ───────── Sheets endpoints (Pagamentos + Comportamento + Aquisição) ───────── */

async function handleSheetsBookings(_req: VercelRequest, res: VercelResponse) {
  // Lê aba **Agendamentos** (transaction-level: 1 row = 1 ensaio).
  // A aba Clientes (default) tem agregados por cliente que não bateram
  // com a fonte da verdade — Agendamentos é canon.
  //
  // Estrutura (21 colunas):
  //   A:ID  B:Data  C:Início  D:Fim  E:Pacote  F:Duração  G:Valor  H:Nome
  //   I:E-mail  J:WhatsApp  K:Stripe Session  L:Stripe Payment  M:Status
  //   N:Criado em  O-U: timestamps de notificações e Nº Bailarinas
  //
  // Cancelados ignorados (user: noise, clientes que marcaram 3-4x e ficaram com 1).
  const rows = await fetchSheetRange(BOOKINGS_SHEET_ID, 'Agendamentos!A2:U1000');

  type PkgStat = { ensaios: number; customerSet: Set<string> };
  const init = (): PkgStat => ({ ensaios: 0, customerSet: new Set<string>() });

  const confByPkg = { lembranca: init(), economico: init(), completo: init(), unknown: init() };
  const pendByPkg = { lembranca: init(), economico: init(), completo: init(), unknown: init() };

  const confCustomers = new Set<string>();
  const pendCustomers = new Set<string>();
  const customersByDDD:   Record<string, Set<string>> = {};
  const customersByState: Record<string, Set<string>> = {};
  let confEnsaios = 0;
  let pendEnsaios = 0;

  // Diário de ensaios confirmados (data de criação, YYYY-MM-DD) — alimenta
  // a curva de "clientes" no gráfico Crescimento de leads em Comportamento.
  // Comparado com leads.daily, mostra a relação topo-do-funil → fechamento.
  const dailyConfirmedMap: Record<string, number> = {};

  const recent: Array<{
    id: string; name: string; pacote: string; date: string;
    status: string; criado_em: string;
  }> = [];

  for (const row of rows) {
    if (!row[0] || !String(row[0]).trim()) continue;

    const id         = String(row[0]);
    const date       = String(row[1] || '');
    const pacote     = normalizePackage(row[4]);
    const nome       = String(row[7] || '');
    const email      = String(row[8] || '').toLowerCase().trim() || `id-${id}`;
    const whatsapp   = String(row[9] || '');
    const statusRaw  = String(row[12] || '');
    const criado     = String(row[13] || '');
    const status     = normalizeStatus(statusRaw);

    if (status !== 'confirmado' && status !== 'pendente') continue;

    const bucket = status === 'confirmado' ? confByPkg : pendByPkg;
    bucket[pacote].ensaios++;
    bucket[pacote].customerSet.add(email);

    if (status === 'confirmado') {
      confEnsaios++;
      confCustomers.add(email);

      // Series diária — agrupa pelo dia da criação (coluna N do Sheets).
      // Apps Script ocasionalmente grava o sessionId admin no lugar do
      // timestamp ISO (formato "admin-new-{Date.now()}" ou "admin-direct-{ms}").
      // Esses ainda são parseáveis — o número após o prefixo é Unix ms.
      const ts = parseBookingTimestamp(criado);
      if (ts > 0) {
        const dateKey = new Date(ts).toISOString().slice(0, 10);
        dailyConfirmedMap[dateKey] = (dailyConfirmedMap[dateKey] || 0) + 1;
      }

      // DDD geo: só de confirmados (intent real de compra)
      const ddd = extractDDD(whatsapp);
      if (ddd) {
        if (!customersByDDD[ddd]) customersByDDD[ddd] = new Set();
        customersByDDD[ddd].add(email);
        const info = DDD_TO_STATE[ddd];
        if (info) {
          if (!customersByState[info.state]) customersByState[info.state] = new Set();
          customersByState[info.state].add(email);
        }
      }
    } else {
      pendEnsaios++;
      pendCustomers.add(email);
    }

    recent.push({ id, name: nome, pacote, date, status: statusRaw, criado_em: criado });
  }

  recent.sort((a, b) => {
    const ta = parseBookingTimestamp(a.criado_em);
    const tb = parseBookingTimestamp(b.criado_em);
    return tb - ta;
  });

  // by_package: número primário = confirmados; mantém pending num campo aux
  const byPackageOut = Object.fromEntries(
    (['lembranca', 'economico', 'completo', 'unknown'] as const).map(k => [k, {
      ensaios:           confByPkg[k].ensaios,
      customers:         confByPkg[k].customerSet.size,
      pending_ensaios:   pendByPkg[k].ensaios,
      pending_customers: pendByPkg[k].customerSet.size,
    }]),
  );

  const dddList = Object.entries(customersByDDD)
    .map(([ddd, set]) => {
      const info = DDD_TO_STATE[ddd] || { state: '?', region: '?' };
      return { ddd, state: info.state, region: info.region, count: set.size };
    })
    .sort((a, b) => b.count - a.count);

  const stateList = Object.entries(customersByState)
    .map(([state, set]) => ({ state, count: set.size }))
    .sort((a, b) => b.count - a.count);

  // Diário de confirmados ordenado cronologicamente — sem range filter,
  // frontend recorta pra mesma janela usada em leads.daily.
  const dailyConfirmed = Object.entries(dailyConfirmedMap)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return res.status(200).json({
    fetched_at:      new Date().toISOString(),
    next_refresh:    new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
    total_customers: confCustomers.size,
    total_ensaios:   confEnsaios,
    by_package:      byPackageOut,
    by_status: {
      confirmado: { customers: confCustomers.size, ensaios: confEnsaios },
      pendente:   { customers: pendCustomers.size, ensaios: pendEnsaios },
    },
    by_state:        stateList,
    by_ddd:          dddList,
    daily:           dailyConfirmed,
    recent:          recent.slice(0, 15),
  });
}

async function handleSheetsLeads(req: VercelRequest, res: VercelResponse) {
  const days = req.query.range
    ? Math.min(Math.max(parseInt(String(req.query.range), 10) || 28, 1), 365)
    : 0; // 0 = sem filtro (lifetime)

  const rows = await fetchSheetRange(LEADS_SHEET_ID, 'A2:F1000');

  const cutoff = days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : 0;
  // Cutoff do período ANTERIOR (mesma duração, deslocado) — pra delta total/intent.
  // Só faz sentido quando há range ativo (sem range = lifetime, não há comparação).
  const prevCutoff = days > 0 ? Date.now() - 2 * days * 24 * 60 * 60 * 1000 : 0;

  const bySource: Record<string, number> = {};
  const byIntent: Record<string, number> = { sim: 0, nao: 0, none: 0 };
  const byState:  Record<string, number> = {};
  const byDDD:    Record<string, number> = {};
  const dailyMap: Record<string, number> = {};

  // Contadores do período anterior (só pra delta — sem detalhamento)
  let totalPrev = 0;
  const byIntentPrev = { sim: 0, nao: 0, none: 0 };

  let total = 0;
  const recent: Array<{
    data_hora: string; nome: string; email: string; fonte: string; vai_joinville: string;
  }> = [];

  for (const row of rows) {
    if (!row[0]) continue;
    const dh        = row[0];
    const vai       = String(row[1] || '').toLowerCase();
    const nome      = row[2] || '';
    const whatsapp  = row[3] || '';
    const email     = row[4] || '';
    const fonte     = row[5] || 'unknown';

    const ts = new Date(dh).getTime();
    if (Number.isNaN(ts)) continue;

    // Período ANTERIOR (mesma duração que `days`, deslocado) — só conta totais.
    if (prevCutoff > 0 && ts >= prevCutoff && ts < cutoff) {
      totalPrev++;
      if (vai === 'sim') byIntentPrev.sim++;
      else if (vai.startsWith('nã') || vai === 'nao') byIntentPrev.nao++;
      else byIntentPrev.none++;
      continue;
    }

    if (cutoff > 0 && ts < cutoff) continue;

    total++;

    bySource[fonte] = (bySource[fonte] || 0) + 1;
    if (vai === 'sim') byIntent.sim++;
    else if (vai.startsWith('nã') || vai === 'nao') byIntent.nao++;
    else byIntent.none++;

    const ddd = extractDDD(whatsapp);
    if (ddd) {
      byDDD[ddd] = (byDDD[ddd] || 0) + 1;
      const stateInfo = DDD_TO_STATE[ddd];
      if (stateInfo) byState[stateInfo.state] = (byState[stateInfo.state] || 0) + 1;
    }

    const dateKey = new Date(ts).toISOString().slice(0, 10);
    dailyMap[dateKey] = (dailyMap[dateKey] || 0) + 1;

    recent.push({ data_hora: dh, nome, email, fonte, vai_joinville: vai });
  }

  recent.sort((a, b) => new Date(b.data_hora).getTime() - new Date(a.data_hora).getTime());

  const dddList = Object.entries(byDDD)
    .map(([ddd, count]) => {
      const info = DDD_TO_STATE[ddd] || { state: '?', region: '?' };
      return { ddd, state: info.state, region: info.region, count };
    })
    .sort((a, b) => b.count - a.count);

  const stateList = Object.entries(byState)
    .map(([state, count]) => ({ state, count }))
    .sort((a, b) => b.count - a.count);

  const daily = Object.entries(dailyMap)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Deltas vs período anterior (mesma duração) — só faz sentido com range ativo
  const totalDelta    = days > 0 ? pctDelta(total,        totalPrev)        : null;
  const intentSimDelta = days > 0 ? pctDelta(byIntent.sim, byIntentPrev.sim) : null;

  return res.status(200).json({
    fetched_at:   new Date().toISOString(),
    next_refresh: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
    range_days:   days || 'all',
    total,
    by_source:    bySource,
    by_intent:    byIntent,
    by_state:     stateList,
    by_ddd:       dddList,
    daily,
    recent:       recent.slice(0, 20),
    deltas: {
      total:        totalDelta,
      intent_sim:   intentSimDelta,
    },
  });
}

async function handleSheetsPing(req: VercelRequest, res: VercelResponse) {
  // Modo debug: ?range=Tabname!A1:Z5 retorna o conteúdo bruto de qualquer range
  // pra diagnosticar estrutura de aba. Aceita também ?sheet=leads|bookings.
  const debugRange = req.query.range ? String(req.query.range) : null;
  if (debugRange) {
    const sheet = String(req.query.sheet || 'bookings');
    const id = sheet === 'leads' ? LEADS_SHEET_ID : BOOKINGS_SHEET_ID;
    try {
      const rows = await fetchSheetRange(id, debugRange);
      return res.status(200).json({ ok: true, sheet_id: id, range: debugRange, rows });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Verifica env var primeiro
  let saEmail = 'unknown';
  try {
    const creds = loadSACredentials();
    saEmail = creds.client_email;
  } catch (e) {
    return res.status(200).json({
      ok:    false,
      stage: 'env_var',
      error: e instanceof Error ? e.message : String(e),
      hint:  'Vercel → Project Settings → Environment Variables → GOOGLE_SA_JSON',
    });
  }

  // Tenta ler cada planilha
  const sheets = { leads: LEADS_SHEET_ID, bookings: BOOKINGS_SHEET_ID };
  const results: Record<string, unknown> = {};

  for (const [name, id] of Object.entries(sheets)) {
    try {
      const rows = await fetchSheetRange(id, 'A1:Z3');
      results[name] = {
        ok:           true,
        sheet_id:     id,
        rows_returned: rows.length,
        headers:       rows[0]    || [],
        sample_row:    rows[1]    || null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isPermissionError = /403|PERMISSION_DENIED|permission/i.test(msg);
      results[name] = {
        ok:       false,
        sheet_id: id,
        error:    msg,
        hint:     isPermissionError
          ? `Compartilhe essa planilha com ${saEmail} (acesso leitor)`
          : 'Verifique o ID da planilha ou conexão',
      };
    }
  }

  return res.status(200).json({ ok: true, sa_email: saEmail, results });
}

/* ───────── GA4 Acquisition (página 2 do dashboard) ───────── */

async function handleGa4Acquisition(req: VercelRequest, res: VercelResponse) {
  if (!process.env.GA4_OAUTH_REFRESH_TOKEN) {
    return res.status(503).json({
      error:   'OAuth GA4 não configurado',
      details: 'Veja docs/ga4-oauth-setup.md',
    });
  }

  const days = Math.min(Math.max(parseInt(String(req.query.range || '28'), 10) || 28, 1), 365);
  const property = `properties/${GA4_PROPERTY_ID}`;
  const client = buildGa4Client();

  const periodCurrent  = { startDate: daysAgo(days),     endDate: 'today' };
  const periodPrevious = { startDate: daysAgo(days * 2), endDate: daysAgo(days + 1) };

  // KPIs totais (sessions/users/engagementRate) atual e anterior
  const [kpiCur, kpiPrev] = await Promise.all([
    client.runReport({
      property,
      dateRanges: [periodCurrent],
      metrics:    [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'engagementRate' }],
    }),
    client.runReport({
      property,
      dateRanges: [periodPrevious],
      metrics:    [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'engagementRate' }],
    }),
  ]);

  // Channels (com engagement rate por canal)
  const [channelCur, channelPrev] = await Promise.all([
    client.runReport({
      property,
      dateRanges: [periodCurrent],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics:    [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'engagementRate' }],
      orderBys:   [{ metric: { metricName: 'sessions' }, desc: true }],
    }),
    client.runReport({
      property,
      dateRanges: [periodPrevious],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics:    [{ name: 'sessions' }],
    }),
  ]);

  // Source/Medium pairs
  const [sourcesReport] = await client.runReport({
    property,
    dateRanges: [periodCurrent],
    dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
    metrics:    [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'engagementRate' }],
    orderBys:   [{ metric: { metricName: 'sessions' }, desc: true }],
    limit:      15,
  });

  // Campanhas (UTM)
  const [campaignsReport] = await client.runReport({
    property,
    dateRanges: [periodCurrent],
    dimensions: [{ name: 'sessionCampaignName' }],
    metrics:    [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'engagementRate' }],
    orderBys:   [{ metric: { metricName: 'sessions' }, desc: true }],
    limit:      10,
  });

  // Computa share de tráfego pago a partir dos canais
  const sumPaid = (rows: NonNullable<typeof channelCur[0]['rows']>) => {
    let total = 0, paid = 0;
    rows.forEach(r => {
      const label = (r.dimensionValues?.[0]?.value || '').toLowerCase();
      const s = Number(r.metricValues?.[0]?.value || 0);
      total += s;
      if (label.includes('paid')) paid += s;
    });
    return { total, paid, share: total > 0 ? paid / total : 0 };
  };
  const paidCur  = sumPaid(channelCur[0].rows || []);
  const paidPrev = sumPaid(channelPrev[0].rows || []);

  const curRow  = kpiCur[0].rows?.[0]?.metricValues || [];
  const prevRow = kpiPrev[0].rows?.[0]?.metricValues || [];
  const num = (i: number, src: typeof curRow) => Number(src?.[i]?.value || 0);

  const kpis = {
    sessions:       { value: num(0, curRow), deltaPct: pctDelta(num(0, curRow), num(0, prevRow)) },
    users:          { value: num(1, curRow), deltaPct: pctDelta(num(1, curRow), num(1, prevRow)) },
    engagementRate: { value: num(2, curRow), deltaPct: pctDelta(num(2, curRow), num(2, prevRow)) },
    paidShare:      { value: paidCur.share, deltaPct: pctDelta(paidCur.share, paidPrev.share) },
  };

  const channels = (channelCur[0].rows || []).map(r => {
    const label = r.dimensionValues?.[0]?.value || 'Unknown';
    return {
      label,
      category:       categorizeChannel(label),
      sessions:       Number(r.metricValues?.[0]?.value || 0),
      users:          Number(r.metricValues?.[1]?.value || 0),
      engagementRate: Number(r.metricValues?.[2]?.value || 0),
    };
  });

  // Sources com label humanizado — mapeia pairs source/medium do GA4 pra
  // nomes descritivos ("Meta Ads (Instagram)", "Instagram (bio orgânica)",
  // "Direto / link salvo", etc) e agrupa entradas que descrevem a MESMA
  // origem na perspectiva do negócio (ex: instagram.com referral + l.instagram.com
  // referral viram ambos "Instagram (orgânico/bio)").
  type SrcEntry = { source: string; medium: string; sessions: number; users: number; engagementRate: number; label: string };
  const rawSources: SrcEntry[] = (sourcesReport.rows || []).map(r => {
    const source = r.dimensionValues?.[0]?.value || '(none)';
    const medium = r.dimensionValues?.[1]?.value || '(none)';
    return {
      source, medium,
      label:          humanizeSource(source, medium),
      sessions:       Number(r.metricValues?.[0]?.value || 0),
      users:          Number(r.metricValues?.[1]?.value || 0),
      engagementRate: Number(r.metricValues?.[2]?.value || 0),
    };
  });
  // Agrupa por label humanizado — soma sessões/users, média ponderada pra engagementRate
  const sourcesByLabel = new Map<string, SrcEntry>();
  for (const s of rawSources) {
    const existing = sourcesByLabel.get(s.label);
    if (!existing) {
      sourcesByLabel.set(s.label, { ...s });
    } else {
      const totalSessions = existing.sessions + s.sessions;
      // engagementRate ponderado por sessions (sem isso, source pequena distorce)
      existing.engagementRate = totalSessions > 0
        ? (existing.engagementRate * existing.sessions + s.engagementRate * s.sessions) / totalSessions
        : 0;
      existing.sessions = totalSessions;
      existing.users  += s.users;
      // mantém o source/medium da maior contribuição (info de debug)
      if (s.sessions > existing.sessions / 2) {
        existing.source = s.source;
        existing.medium = s.medium;
      }
    }
  }
  const sources = Array.from(sourcesByLabel.values()).sort((a, b) => b.sessions - a.sessions);

  // Filtra "(not set)" / "(direct)" etc. — só campanhas reais
  const campaigns = (campaignsReport.rows || [])
    .filter(r => {
      const c = r.dimensionValues?.[0]?.value || '';
      return c && !c.startsWith('(');
    })
    .map(r => ({
      campaign:       r.dimensionValues?.[0]?.value || '(unknown)',
      sessions:       Number(r.metricValues?.[0]?.value || 0),
      users:          Number(r.metricValues?.[1]?.value || 0),
      engagementRate: Number(r.metricValues?.[2]?.value || 0),
    }));

  return res.status(200).json({
    range:        { start: periodCurrent.startDate, end: 'today', days },
    fetched_at:   new Date().toISOString(),
    next_refresh: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
    kpis, channels, sources, campaigns,
  });
}

/* ───────── GA4 Funnel (página 3 do dashboard) ───────── */

async function handleGa4Funnel(req: VercelRequest, res: VercelResponse) {
  if (!process.env.GA4_OAUTH_REFRESH_TOKEN) {
    return res.status(503).json({
      error:   'OAuth GA4 não configurado',
      details: 'Veja docs/ga4-oauth-setup.md',
    });
  }

  const days = Math.min(Math.max(parseInt(String(req.query.range || '28'), 10) || 28, 1), 365);
  const property = `properties/${GA4_PROPERTY_ID}`;
  const client = buildGa4Client();

  const periodCurrent  = { startDate: daysAgo(days),     endDate: 'today' };
  const periodPrevious = { startDate: daysAgo(days * 2), endDate: daysAgo(days + 1) };

  // Funnel path-based (captura todas as rotas de entrada — direta /agendamento
  // via link de bio, ads, etc. + caminho via home).
  //
  // ❌ Antes: view_item_list → select_item → begin_checkout → purchase
  //    Problema: view_item_list e select_item só disparam na home, então
  //    visitantes que vinham direto pra /agendamento ficavam de fora do funil.
  //
  // ✅ Agora: total_sessions → visited_agendamento → begin_checkout → purchase
  //    Cada step captura ambos caminhos de entrada.
  const EVENT_STEPS = ['begin_checkout', 'purchase'];

  const [
    totalCur, totalPrev,
    agendaCur, agendaPrev,
    eventCur, eventPrev,
    // ── 3 chamadas extras pra quebra POR ORIGEM ──
    // Cada uma traz o mesmo step quebrado por sessionDefaultChannelGroup —
    // assim renderizamos 1 funil por canal (Paid Social, Direct, etc).
    totalByOrigin, agendaByOrigin, eventByOrigin,
  ] = await Promise.all([
    // Sessões totais current
    client.runReport({
      property, dateRanges: [periodCurrent],
      metrics: [{ name: 'sessions' }],
    }),
    // Sessões totais previous
    client.runReport({
      property, dateRanges: [periodPrevious],
      metrics: [{ name: 'sessions' }],
    }),
    // Sessões que visitaram /agendamento current
    client.runReport({
      property, dateRanges: [periodCurrent],
      dimensions: [{ name: 'pagePath' }],
      metrics:    [{ name: 'sessions' }],
      dimensionFilter: {
        filter: { fieldName: 'pagePath', stringFilter: { value: '/agendamento' } },
      },
    }),
    // Sessões que visitaram /agendamento previous
    client.runReport({
      property, dateRanges: [periodPrevious],
      dimensions: [{ name: 'pagePath' }],
      metrics:    [{ name: 'sessions' }],
      dimensionFilter: {
        filter: { fieldName: 'pagePath', stringFilter: { value: '/agendamento' } },
      },
    }),
    // begin_checkout + purchase sessions current
    client.runReport({
      property, dateRanges: [periodCurrent],
      dimensions: [{ name: 'eventName' }],
      metrics:    [{ name: 'sessions' }],
      dimensionFilter: {
        filter: { fieldName: 'eventName', inListFilter: { values: EVENT_STEPS } },
      },
    }),
    // begin_checkout + purchase previous
    client.runReport({
      property, dateRanges: [periodPrevious],
      dimensions: [{ name: 'eventName' }],
      metrics:    [{ name: 'sessions' }],
      dimensionFilter: {
        filter: { fieldName: 'eventName', inListFilter: { values: EVENT_STEPS } },
      },
    }),
    // ── Quebras por origem (current only) ──
    // Total sessions × channel
    client.runReport({
      property, dateRanges: [periodCurrent],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics:    [{ name: 'sessions' }],
    }),
    // /agendamento × channel
    client.runReport({
      property, dateRanges: [periodCurrent],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }, { name: 'pagePath' }],
      metrics:    [{ name: 'sessions' }],
      dimensionFilter: {
        filter: { fieldName: 'pagePath', stringFilter: { value: '/agendamento' } },
      },
    }),
    // begin_checkout + purchase × channel
    client.runReport({
      property, dateRanges: [periodCurrent],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }, { name: 'eventName' }],
      metrics:    [{ name: 'sessions' }],
      dimensionFilter: {
        filter: { fieldName: 'eventName', inListFilter: { values: EVENT_STEPS } },
      },
    }),
  ]);

  const singleVal = (rows: NonNullable<typeof totalCur[0]['rows']>) =>
    Number(rows?.[0]?.metricValues?.[0]?.value || 0);
  const pathVal = (rows: NonNullable<typeof agendaCur[0]['rows']>) =>
    // Soma todas as variantes de /agendamento (path exato + query strings)
    rows.reduce((sum, r) => sum + Number(r.metricValues?.[0]?.value || 0), 0);
  const eventMap = (rows: NonNullable<typeof eventCur[0]['rows']>) => {
    const m: Record<string, number> = {};
    rows.forEach(r => {
      const name = r.dimensionValues?.[0]?.value || '';
      m[name] = Number(r.metricValues?.[0]?.value || 0);
    });
    return m;
  };

  const totalCurVal  = singleVal(totalCur[0].rows  || []);
  const totalPrevVal = singleVal(totalPrev[0].rows || []);
  const agendaCurVal  = pathVal(agendaCur[0].rows  || []);
  const agendaPrevVal = pathVal(agendaPrev[0].rows || []);
  const eventCurMap   = eventMap(eventCur[0].rows  || []);
  const eventPrevMap  = eventMap(eventPrev[0].rows || []);

  const funnel = [
    { step: 'total_sessions',       sessions: totalCurVal,            deltaPct: pctDelta(totalCurVal, totalPrevVal) },
    { step: 'visited_agendamento',  sessions: agendaCurVal,           deltaPct: pctDelta(agendaCurVal, agendaPrevVal) },
    { step: 'begin_checkout',       sessions: eventCurMap['begin_checkout'] || 0, deltaPct: pctDelta(eventCurMap['begin_checkout'] || 0, eventPrevMap['begin_checkout'] || 0) },
    { step: 'purchase',             sessions: eventCurMap['purchase']      || 0, deltaPct: pctDelta(eventCurMap['purchase']      || 0, eventPrevMap['purchase']      || 0) },
  ];

  // ── Funil quebrado por origem ────────────────────────────────────────
  //
  // Mapeia o `sessionDefaultChannelGroup` do GA4 (que retorna labels tipo
  // "Paid Social", "Organic Social", "Direct", "Referral", "Organic Search",
  // "Email", "Unassigned") pra slugs canônicos. Cada origem ganha um funil
  // próprio com os mesmos 4 steps.
  const normalizeOrigin = (ch: string): string => {
    const c = (ch || '').toLowerCase().trim();
    if (c === 'paid social' || c === 'social paid')        return 'paid_social';      // Meta Ads, etc
    if (c === 'organic social' || c === 'social')          return 'organic_social';   // Instagram bio, posts
    if (c === 'direct')                                    return 'direct';           // URL/bookmark/link salvo
    if (c === 'referral')                                  return 'referral';         // boca-a-boca, parceiros
    if (c === 'organic search')                            return 'organic_search';   // Google orgânico
    if (c === 'paid search')                               return 'paid_search';      // Google Ads
    if (c === 'email')                                     return 'email';
    return 'other';
  };

  const ORIGIN_LABELS: Record<string, string> = {
    paid_social:    'Meta Ads (anúncios)',
    organic_social: 'Instagram / Facebook (orgânico/bio)',
    direct:         'Direto (URL ou link salvo)',
    referral:       'Referência (boca-a-boca, parceiros)',
    organic_search: 'Google (busca orgânica)',
    paid_search:    'Google Ads',
    email:          'Email',
    other:          'Outros',
  };

  // 4 buckets por origem: cada step contribui pra origem dele
  type OriginBucket = { total_sessions: number; visited_agendamento: number; begin_checkout: number; purchase: number };
  const originBuckets: Record<string, OriginBucket> = {};
  const getBucket = (slug: string): OriginBucket => {
    if (!originBuckets[slug]) {
      originBuckets[slug] = { total_sessions: 0, visited_agendamento: 0, begin_checkout: 0, purchase: 0 };
    }
    return originBuckets[slug];
  };

  // Step 1: total sessions por origem
  (totalByOrigin[0].rows || []).forEach(r => {
    const slug = normalizeOrigin(r.dimensionValues?.[0]?.value || '');
    getBucket(slug).total_sessions += Number(r.metricValues?.[0]?.value || 0);
  });
  // Step 2: visited /agendamento por origem (já filtrado por pagePath na query)
  (agendaByOrigin[0].rows || []).forEach(r => {
    const slug = normalizeOrigin(r.dimensionValues?.[0]?.value || '');
    getBucket(slug).visited_agendamento += Number(r.metricValues?.[0]?.value || 0);
  });
  // Step 3+4: begin_checkout / purchase por origem
  (eventByOrigin[0].rows || []).forEach(r => {
    const slug   = normalizeOrigin(r.dimensionValues?.[0]?.value || '');
    const event  = r.dimensionValues?.[1]?.value || '';
    const value  = Number(r.metricValues?.[0]?.value || 0);
    const bucket = getBucket(slug);
    if (event === 'begin_checkout') bucket.begin_checkout += value;
    if (event === 'purchase')       bucket.purchase += value;
  });

  // Monta array final ordenado por sessions desc, omite origens sem nenhum dado
  const funnel_by_origin = Object.entries(originBuckets)
    .filter(([, b]) => b.total_sessions > 0 || b.visited_agendamento > 0 || b.begin_checkout > 0 || b.purchase > 0)
    .map(([slug, b]) => ({
      origin: slug,
      label:  ORIGIN_LABELS[slug] || slug,
      funnel: [
        { step: 'total_sessions',      sessions: b.total_sessions },
        { step: 'visited_agendamento', sessions: b.visited_agendamento },
        { step: 'begin_checkout',      sessions: b.begin_checkout },
        { step: 'purchase',            sessions: b.purchase },
      ],
      conversion_rate: b.total_sessions > 0 ? b.purchase / b.total_sessions : 0,
    }))
    .sort((a, b) => b.funnel[0].sessions - a.funnel[0].sessions);

  // 2. Per-package: itemId × selects/purchases/revenue
  // GA4 não permite eventCount (event-scoped) com itemId (item-scoped).
  // Métricas item-scoped corretas:
  //  - itemsClickedInList: units clicked in list (de select_item events)
  //  - itemPurchaseQuantity: quantidade comprada (de purchase events)
  //  - itemRevenue: receita (de purchase events)
  const [selectByPkg, purchaseByPkg] = await Promise.all([
    client.runReport({
      property,
      dateRanges: [periodCurrent],
      dimensions: [{ name: 'itemId' }],
      metrics:    [{ name: 'itemsClickedInList' }],
    }),
    client.runReport({
      property,
      dateRanges: [periodCurrent],
      dimensions: [{ name: 'itemId' }],
      metrics:    [{ name: 'itemPurchaseQuantity' }, { name: 'itemRevenue' }],
    }),
  ]);

  type PkgStats = { id: string; selects: number; purchases: number; revenue: number };
  const pkgMap: Record<string, PkgStats> = {};
  (selectByPkg.rows || []).forEach(r => {
    const id = r.dimensionValues?.[0]?.value || '';
    if (!id) return;
    pkgMap[id] = pkgMap[id] || { id, selects: 0, purchases: 0, revenue: 0 };
    pkgMap[id].selects = Number(r.metricValues?.[0]?.value || 0);
  });
  (purchaseByPkg.rows || []).forEach(r => {
    const id = r.dimensionValues?.[0]?.value || '';
    if (!id) return;
    pkgMap[id] = pkgMap[id] || { id, selects: 0, purchases: 0, revenue: 0 };
    pkgMap[id].purchases = Number(r.metricValues?.[0]?.value || 0);
    pkgMap[id].revenue   = Number(r.metricValues?.[1]?.value || 0);
  });
  // Garante 3 pacotes mesmo se não tiver dado (ordem fixa pra UI consistente)
  const PKG_ORDER = ['lembranca', 'economico', 'completo'];
  const packages = PKG_ORDER.map(id => pkgMap[id] || { id, selects: 0, purchases: 0, revenue: 0 });
  // Adiciona qualquer item_id extra que não esteja na ordem fixa (defesa)
  Object.values(pkgMap).forEach(p => {
    if (!PKG_ORDER.includes(p.id)) packages.push(p);
  });

  return res.status(200).json({
    range:        { start: periodCurrent.startDate, end: 'today', days },
    fetched_at:   new Date().toISOString(),
    next_refresh: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
    funnel,
    funnel_by_origin,
    packages,
  });
}

/* ───────── Meta Ads (custo por lead em Aquisição) ───────── */

async function handleMetaAds(req: VercelRequest, res: VercelResponse) {
  const token     = process.env.META_ADS_TOKEN;
  const accountId = process.env.META_ADS_ACCOUNT_ID;

  if (!token || !accountId) {
    return res.status(503).json({
      error:   'Meta Ads não configurado',
      details: 'META_ADS_TOKEN ou META_ADS_ACCOUNT_ID ausentes nas env vars do Vercel',
    });
  }

  const days = Math.min(Math.max(parseInt(String(req.query.range || '28'), 10) || 28, 1), 365);
  const until = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const timeRange = encodeURIComponent(JSON.stringify({ since, until }));

  const acctPath = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
  const baseUrl  = `https://graph.facebook.com/v19.0/${acctPath}/insights`;

  // Pra ads, usamos o `preview_shareable_link` que a Meta API expõe
  // nativamente — é o link público de prévia (fb.me/adspreview/...) que
  // funciona pra quem tem permissão. Tentar deep link pro Ads Manager
  // (adsmanager.facebook.com/...?selected_*_ids=) dava "Invalid request #1"
  // por causa do contexto business_id que o FB injeta no login flow.
  //
  // Pra campaigns e adsets não há preview shareable equivalente, então só
  // o nome do ad vira link clicável.
  const fields   = [
    'spend', 'impressions', 'clicks', 'actions',
    'ctr', 'cpc', 'cpm', 'reach', 'frequency',
  ].join(',');

  // Parser de actions array.
  //
  // IMPORTANTE: o Meta retorna leads/purchases em múltiplas categorias que se
  // sobrepõem — `lead` é o agregado TOTAL; `offsite_conversion.fb_pixel_lead`
  // e `onsite_conversion.lead_grouped` são subsets do mesmo evento. Somar os
  // 3 dobra ou triplica a contagem real (caso do bug 136 = 82 + 54).
  //
  // Solução: pegar o MAX entre o agregado e a soma dos subsets. Cobre os 3
  // cenários:
  //   - Só `lead` preenchido → usa lead (acontece com Lead Ads + Pixel ok)
  //   - Só subsets preenchidos → usa soma (raro, atribuição parcial)
  //   - Ambos preenchidos → usa o maior (lead deveria ser ~= soma; pequenas
  //     divergências são esperadas por causa de janelas de atribuição)
  const extractActionCount = (actions: unknown, types: string[]): number => {
    if (!Array.isArray(actions)) return 0;
    const counts: Record<string, number> = {};
    for (const a of actions as Array<{ action_type?: string; value?: string }>) {
      if (a.action_type && types.includes(a.action_type)) {
        counts[a.action_type] = (counts[a.action_type] || 0) + (Number(a.value) || 0);
      }
    }
    // Primeiro tipo da lista = agregado (`lead` ou `purchase`); resto = subsets
    const [aggregateType, ...subsetTypes] = types;
    const aggregate = counts[aggregateType] || 0;
    const subsetsSum = subsetTypes.reduce((s, t) => s + (counts[t] || 0), 0);
    return Math.max(aggregate, subsetsSum);
  };

  const fetchMeta = async (url: string) => {
    const r = await fetch(url);
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`Meta API ${r.status}: ${body.slice(0, 400)}`);
    }
    return r.json() as Promise<{ data?: Array<Record<string, unknown>> }>;
  };

  // Período anterior (pra delta vs período) — mesmo número de dias, deslocado
  const sincePrev = new Date(Date.now() - 2 * days * 86400000).toISOString().slice(0, 10);
  const untilPrev = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const timeRangePrev = encodeURIComponent(JSON.stringify({ since: sincePrev, until: untilPrev }));

  // 1. Account-level + 2. Per-campaign + 3. Per-adset + 4. Per-ad em paralelo.
  // 4 chamadas, ~500ms cada → ~500ms total porque é paralelo. Cache de 6h amortiza.
  //
  // Plus: metadata extra (5/6) com created_time pra calcular idade dos adsets/ads
  // — Meta API não expõe created_time em /insights, precisa de chamada dedicada.
  // limit alto (200) cobre conta inteira; se a conta crescer muito, paginar.
  //
  // E account-level do período ANTERIOR (7) pra computar delta_pct em spend,
  // leads, CPL, CPM, CTR, CPC. Pros níveis campaign/adset/ad ficaria pesado
  // (4 chamadas extras) e a UI das tabelas não precisa — só o card de spend.
  const metaAdsetsUrl = `https://graph.facebook.com/v19.0/${acctPath}/adsets?fields=id,created_time,start_time&limit=200&access_token=${token}`;
  const metaAdsUrl    = `https://graph.facebook.com/v19.0/${acctPath}/ads?fields=id,created_time&limit=500&access_token=${token}`;
  const [accountJson, campaignJson, adsetJson, adJson, adsetMetaJson, adMetaJson, accountPrevJson] = await Promise.all([
    fetchMeta(`${baseUrl}?fields=${fields}&time_range=${timeRange}&access_token=${token}`),
    fetchMeta(`${baseUrl}?fields=campaign_name,campaign_id,${fields}&level=campaign&time_range=${timeRange}&access_token=${token}`),
    fetchMeta(`${baseUrl}?fields=adset_name,adset_id,campaign_name,campaign_id,${fields}&level=adset&time_range=${timeRange}&access_token=${token}`),
    fetchMeta(`${baseUrl}?fields=ad_name,ad_id,adset_name,adset_id,campaign_name,campaign_id,${fields}&level=ad&time_range=${timeRange}&access_token=${token}`),
    fetchMeta(metaAdsetsUrl).catch(() => ({ data: [] })),  // metadata é nice-to-have; falha não bloqueia
    fetchMeta(metaAdsUrl).catch(()    => ({ data: [] })),
    fetchMeta(`${baseUrl}?fields=${fields}&time_range=${timeRangePrev}&access_token=${token}`).catch(() => ({ data: [] })),
  ]);

  // Mapeia metadata id → created_time pra resolver age_days nos loops abaixo
  const adsetCreatedAt: Record<string, number> = {};
  for (const m of (adsetMetaJson.data || [])) {
    const id = String(m.id || '');
    // Prefere start_time (quando a campanha efetivamente começou a rodar);
    // fallback pra created_time (quando foi criada no painel). Pra adsets
    // pausados/agendados, start_time pode estar no futuro — nesse caso
    // ainda usamos created_time como base de idade real.
    const start  = m.start_time ? new Date(String(m.start_time)).getTime()  : 0;
    const create = m.created_time ? new Date(String(m.created_time)).getTime() : 0;
    const ts = start > 0 && start <= Date.now() ? start : create;
    if (id && ts > 0) adsetCreatedAt[id] = ts;
  }
  const adCreatedAt: Record<string, number> = {};
  for (const m of (adMetaJson.data || [])) {
    const id = String(m.id || '');
    const ts = m.created_time ? new Date(String(m.created_time)).getTime() : 0;
    if (id && ts > 0) adCreatedAt[id] = ts;
  }
  // Helper: dias entre `created` e agora, ou null se não disponível
  const ageDays = (ts: number | undefined): number | null =>
    ts && ts > 0 ? Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000)) : null;

  // Meta Pixel "Lead" event types — incluindo offsite_conversion (Pixel) e onsite_conversion
  const LEAD_TYPES = [
    'lead',
    'offsite_conversion.fb_pixel_lead',
    'onsite_conversion.lead_grouped',
  ];
  const PURCHASE_TYPES = [
    'purchase',
    'offsite_conversion.fb_pixel_purchase',
    'onsite_web_purchase',
  ];

  // Imposto sobre o spend da Meta — desde 2026 (info da Elisa). O valor que
  // a Meta cobra é GROSS = net (faturado pelo gerenciador) × (1 + tax_rate).
  // Default 12,5% (configurável via env var). CPL/CPA/CPC etc usam GROSS pra
  // refletir o custo real desembolsado.
  const TAX_RATE = parseFloat(process.env.META_ADS_TAX_RATE || '0.125');

  const acct = accountJson.data?.[0] || {};
  const acctLeads     = extractActionCount(acct.actions, LEAD_TYPES);
  const acctPurchases = extractActionCount(acct.actions, PURCHASE_TYPES);
  const acctSpendNet   = Number(acct.spend) || 0;
  const acctSpendGross = acctSpendNet * (1 + TAX_RATE);
  const taxMultiplier  = 1 + TAX_RATE;

  // Período anterior — só pra deltas de KPIs principais
  const acctPrev = accountPrevJson.data?.[0] || {};
  const prevLeads     = extractActionCount(acctPrev.actions, LEAD_TYPES);
  const prevSpendNet  = Number(acctPrev.spend) || 0;
  const prevSpendGross = prevSpendNet * (1 + TAX_RATE);
  const prevCpl = prevLeads > 0 ? prevSpendGross / prevLeads : 0;
  const prevCpm = (Number(acctPrev.cpm) || 0) * taxMultiplier;
  const prevCpc = (Number(acctPrev.cpc) || 0) * taxMultiplier;
  const prevCtr = Number(acctPrev.ctr) || 0;
  const prevImpressions = Number(acctPrev.impressions) || 0;

  const curCpl = acctLeads > 0 ? acctSpendGross / acctLeads : 0;
  const curCpm = (Number(acct.cpm) || 0) * taxMultiplier;
  const curCpc = (Number(acct.cpc) || 0) * taxMultiplier;
  const curCtr = Number(acct.ctr) || 0;
  const curImpressions = Number(acct.impressions) || 0;

  const accountSummary = {
    spend:       acctSpendGross,                        // gross = principal
    spend_net:   acctSpendNet,                          // sem imposto (Meta gerenciador)
    tax_rate:    TAX_RATE,                              // 0..1
    impressions: curImpressions,
    clicks:      Number(acct.clicks)      || 0,
    ctr:         curCtr,                                // %
    cpc:         curCpc,                                // ajustado com tax
    cpm:         curCpm,
    reach:       Number(acct.reach)       || 0,
    frequency:   Number(acct.frequency)   || 0,
    leads:       acctLeads,
    purchases:   acctPurchases,
    cpl:         curCpl,
    cpa:         acctPurchases > 0 ? acctSpendGross / acctPurchases : 0,
    // Deltas vs período anterior — null se base do período anterior é 0
    // (evita Infinity% / divisão por zero). UI omite delta nesse caso.
    deltas: {
      spend:       pctDelta(acctSpendGross, prevSpendGross),
      leads:       pctDelta(acctLeads,      prevLeads),
      cpl:         pctDelta(curCpl,         prevCpl),
      cpm:         pctDelta(curCpm,         prevCpm),
      cpc:         pctDelta(curCpc,         prevCpc),
      ctr:         pctDelta(curCtr,         prevCtr),
      impressions: pctDelta(curImpressions, prevImpressions),
    },
  };

  const campaigns = (campaignJson.data || [])
    .map(c => {
      const cLeads     = extractActionCount(c.actions, LEAD_TYPES);
      const cPurchases = extractActionCount(c.actions, PURCHASE_TYPES);
      const cSpendNet   = Number(c.spend) || 0;
      const cSpendGross = cSpendNet * taxMultiplier;
      return {
        id:          String(c.campaign_id || ''),
        name:        String(c.campaign_name || '(unknown)'),
        spend:       cSpendGross,                              // gross (com imposto)
        spend_net:   cSpendNet,
        impressions: Number(c.impressions) || 0,
        clicks:      Number(c.clicks)      || 0,
        ctr:         Number(c.ctr)         || 0,
        cpc:         (Number(c.cpc) || 0) * taxMultiplier,
        cpm:         (Number(c.cpm) || 0) * taxMultiplier,
        leads:       cLeads,
        purchases:   cPurchases,
        cpl:         cLeads     > 0 ? cSpendGross / cLeads     : 0,
        cpa:         cPurchases > 0 ? cSpendGross / cPurchases : 0,
      };
    })
    .sort((a, b) => b.spend - a.spend);

  const adsets = (adsetJson.data || [])
    .map(a => {
      const aLeads     = extractActionCount(a.actions, LEAD_TYPES);
      const aPurchases = extractActionCount(a.actions, PURCHASE_TYPES);
      const aSpendNet   = Number(a.spend) || 0;
      const aSpendGross = aSpendNet * taxMultiplier;
      const aId         = String(a.adset_id || '');
      return {
        id:           aId,
        name:         String(a.adset_name || '(unknown)'),
        age_days:     ageDays(adsetCreatedAt[aId]),
        campaign_id:  String(a.campaign_id || ''),
        campaign:     String(a.campaign_name || '(unknown)'),
        spend:        aSpendGross,
        spend_net:    aSpendNet,
        impressions:  Number(a.impressions) || 0,
        clicks:       Number(a.clicks)      || 0,
        ctr:          Number(a.ctr)         || 0,
        cpc:          (Number(a.cpc) || 0) * taxMultiplier,
        cpm:          (Number(a.cpm) || 0) * taxMultiplier,
        leads:        aLeads,
        purchases:    aPurchases,
        cpl:          aLeads     > 0 ? aSpendGross / aLeads     : 0,
        cpa:          aPurchases > 0 ? aSpendGross / aPurchases : 0,
      };
    })
    .sort((a, b) => b.spend - a.spend);

  // Pré-extrai os ad_ids pra buscar preview_shareable_link em batch.
  // Meta Graph API aceita `?ids=<csv>` com até 50 IDs por requisição.
  const adRows = adJson.data || [];
  const adIds  = adRows.map(a => String(a.ad_id || '')).filter(Boolean);
  const previewLinks: Record<string, string> = {};
  for (let i = 0; i < adIds.length; i += 50) {
    const chunk = adIds.slice(i, i + 50);
    try {
      const previewUrl = `https://graph.facebook.com/v19.0/?ids=${chunk.join(',')}&fields=preview_shareable_link&access_token=${token}`;
      const r = await fetch(previewUrl);
      if (r.ok) {
        const j = await r.json() as Record<string, { preview_shareable_link?: string }>;
        for (const [id, data] of Object.entries(j)) {
          if (data?.preview_shareable_link) previewLinks[id] = data.preview_shareable_link;
        }
      }
    } catch (e) {
      console.warn('[meta-ads] preview links batch failed', e);
      // Não bloqueia o handler — só perde os links nesse chunk
    }
  }

  const ads = adRows
    .map(a => {
      const adLeads     = extractActionCount(a.actions, LEAD_TYPES);
      const adPurchases = extractActionCount(a.actions, PURCHASE_TYPES);
      const adSpendNet   = Number(a.spend) || 0;
      const adSpendGross = adSpendNet * taxMultiplier;
      const adId         = String(a.ad_id || '');
      return {
        id:           adId,
        name:         String(a.ad_name || '(unknown)'),
        age_days:     ageDays(adCreatedAt[adId]),
        url:          previewLinks[adId] || '',  // fb.me/adspreview/...
        adset_id:     String(a.adset_id || ''),
        adset:        String(a.adset_name || '(unknown)'),
        campaign_id:  String(a.campaign_id || ''),
        campaign:     String(a.campaign_name || '(unknown)'),
        spend:        adSpendGross,
        spend_net:    adSpendNet,
        impressions:  Number(a.impressions) || 0,
        clicks:       Number(a.clicks)      || 0,
        ctr:          Number(a.ctr)         || 0,
        cpc:          (Number(a.cpc) || 0) * taxMultiplier,
        cpm:          (Number(a.cpm) || 0) * taxMultiplier,
        leads:        adLeads,
        purchases:    adPurchases,
        cpl:          adLeads     > 0 ? adSpendGross / adLeads     : 0,
        cpa:          adPurchases > 0 ? adSpendGross / adPurchases : 0,
      };
    })
    .sort((a, b) => b.spend - a.spend);

  return res.status(200).json({
    range:        { since, until, days },
    fetched_at:   new Date().toISOString(),
    next_refresh: new Date(Date.now() + 6 * 3600 * 1000).toISOString(), // Meta atualiza ~hora em hora
    account:      accountSummary,
    campaigns,
    adsets,
    ads,
  });
}

/* ───────── Economics (ROAS + CPA real em Pagamentos) ─────────
 *
 * Combina spend gross do Meta + custos fixos da equipe + comissão escalonada
 * da Mari pra calcular:
 *   - receita realizada (ensaios confirmados, soma dos valores efetivos)
 *   - custo total
 *   - ROAS (receita / custo)
 *   - CPA real (custo / ensaios)
 *   - break-even (quantos ensaios faltam pra ROAS = 1)
 *
 * Custos da equipe vêm de env vars:
 *   ELISA_TOTAL_COST=7500
 *   MARI_FIXED_COST=4200
 * Imposto Meta vem de META_ADS_TAX_RATE (default 0.125).
 *
 * Comissão da Mari (hardcoded no código porque é regra de negócio específica,
 * pode virar env JSON se mudar): 5% nos primeiros 15, 8% nos próximos 15
 * (até o 30º), 10% do 31º em diante. Aplicada sobre o preço efetivo pago
 * (coluna G da aba Agendamentos). Ordem cronológica por `criado_em`.
 */

// Custos fixos default (override via env). Hardcoded como fallback porque
// são os valores combinados em maio/2026 — facilita testes locais sem .env.
const ELISA_TOTAL_DEFAULT = 7500;
const MARI_FIXED_DEFAULT  = 4200;

interface ConfirmedBooking { id: string; createdAt: number; price: number; package: string }

function calcMariCommission(bookings: ConfirmedBooking[]): { total: number; perBooking: Array<{ id: string; rate: number; commission: number }> } {
  // Comissão escalonada — taxa cresce conforme volume acumulado da Mari.
  // Pos 1..15 → 5% · 16..30 → 8% · 31+ → 10%. Aplica sobre o valor pago
  // (coluna G), não sobre o preço de catálogo — assim já considera descontos
  // que ela eventualmente faça no fechamento.
  const tiers = [
    { upTo: 15,       rate: 0.05 },
    { upTo: 30,       rate: 0.08 },
    { upTo: Infinity, rate: 0.10 },
  ];
  const sorted = [...bookings].sort((a, b) => a.createdAt - b.createdAt);
  let total = 0;
  const perBooking = sorted.map((b, idx) => {
    const pos = idx + 1;
    const tier = tiers.find(t => pos <= t.upTo) || tiers[tiers.length - 1];
    const commission = b.price * tier.rate;
    total += commission;
    return { id: b.id, rate: tier.rate, commission };
  });
  return { total, perBooking };
}

async function handleEconomics(req: VercelRequest, res: VercelResponse) {
  // 1. Bookings confirmados (Sheets) — fonte da verdade pra receita e nº ensaios.
  //    Lê a aba Agendamentos direto (mesmo padrão de handleSheetsBookings).
  const rows = await fetchSheetRange(BOOKINGS_SHEET_ID, 'Agendamentos!A2:U1000');
  const confirmed: ConfirmedBooking[] = [];
  for (const row of rows) {
    if (!row[0] || !String(row[0]).trim()) continue;
    if (normalizeStatus(String(row[12] || '')) !== 'confirmado') continue;
    const valor = parseFloat(String(row[6] || '').replace(/[^\d,.-]/g, '').replace(',', '.')) || 0;
    if (valor <= 0) continue; // ignora rows sem valor (provavelmente teste/admin manual)
    const createdAt = parseBookingTimestamp(String(row[13] || ''));
    confirmed.push({
      id:        String(row[0]),
      createdAt,
      price:     valor,
      package:   normalizePackage(row[4]),
    });
  }

  const revenue = confirmed.reduce((s, b) => s + b.price, 0);
  const nEnsaios = confirmed.length;

  // 2. Meta spend gross (com imposto). Reusa lógica de handleMetaAds mas com
  //    range customizável (default ano cheio pra lifetime do festival 2026).
  const days = Math.min(Math.max(parseInt(String(req.query.range || '365'), 10) || 365, 1), 365);
  const until = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const taxRate = parseFloat(process.env.META_ADS_TAX_RATE || '0.125');

  // Janela "recente" pra calcular deltas — usa ~14 dias (suficiente pra
  // tendência sem ser tão curto que vire ruído). Configurável via env.
  const recentDays = Math.min(Math.max(parseInt(process.env.ECONOMICS_RECENT_DAYS || '14', 10), 1), 90);
  const nowMs = Date.now();
  const recentCutoff = nowMs - recentDays * 86400000;
  const prevCutoff   = nowMs - 2 * recentDays * 86400000;

  // Receita e ensaios em 2 janelas: últimos N dias vs N dias anteriores.
  let revenueRecent = 0, revenuePrev = 0;
  let ensaiosRecent = 0, ensaiosPrev = 0;
  for (const b of confirmed) {
    if (b.createdAt >= recentCutoff) {
      revenueRecent += b.price; ensaiosRecent++;
    } else if (b.createdAt >= prevCutoff) {
      revenuePrev += b.price; ensaiosPrev++;
    }
  }
  const revenueDelta = pctDelta(revenueRecent, revenuePrev);
  const ensaiosDelta = pctDelta(ensaiosRecent, ensaiosPrev);

  let metaSpendNet = 0;
  let metaSpendGross = 0;
  let metaSpendRecent = 0;  // últimos recentDays — pra delta
  let metaSpendPrev   = 0;
  let metaError: string | null = null;
  const metaToken     = process.env.META_ADS_TOKEN;
  const metaAccountId = process.env.META_ADS_ACCOUNT_ID;
  if (metaToken && metaAccountId) {
    const acctPath = metaAccountId.startsWith('act_') ? metaAccountId : `act_${metaAccountId}`;
    const sinceRecent = new Date(nowMs - recentDays * 86400000).toISOString().slice(0, 10);
    const sincePrev2  = new Date(nowMs - 2 * recentDays * 86400000).toISOString().slice(0, 10);
    const tr       = encodeURIComponent(JSON.stringify({ since,        until }));
    const trRecent = encodeURIComponent(JSON.stringify({ since: sinceRecent, until }));
    const trPrev   = encodeURIComponent(JSON.stringify({ since: sincePrev2,  until: sinceRecent }));
    const mkUrl = (timeRange: string) =>
      `https://graph.facebook.com/v19.0/${acctPath}/insights?fields=spend&time_range=${timeRange}&access_token=${metaToken}`;
    try {
      const [rTotal, rRecent, rPrev] = await Promise.all([
        fetch(mkUrl(tr)),
        fetch(mkUrl(trRecent)),
        fetch(mkUrl(trPrev)),
      ]);
      if (rTotal.ok) {
        const j = await rTotal.json() as { data?: Array<{ spend?: string }> };
        metaSpendNet = Number(j.data?.[0]?.spend) || 0;
        metaSpendGross = metaSpendNet * (1 + taxRate);
      } else {
        metaError = `Meta API ${rTotal.status}`;
      }
      if (rRecent.ok) {
        const j = await rRecent.json() as { data?: Array<{ spend?: string }> };
        metaSpendRecent = (Number(j.data?.[0]?.spend) || 0) * (1 + taxRate);
      }
      if (rPrev.ok) {
        const j = await rPrev.json() as { data?: Array<{ spend?: string }> };
        metaSpendPrev = (Number(j.data?.[0]?.spend) || 0) * (1 + taxRate);
      }
    } catch (e) {
      metaError = e instanceof Error ? e.message : 'Erro Meta API';
    }
  } else {
    metaError = 'META_ADS_TOKEN ou META_ADS_ACCOUNT_ID ausentes';
  }

  const metaSpendDelta = pctDelta(metaSpendRecent, metaSpendPrev);

  // 3. Custos da equipe.
  const elisaTotal = parseFloat(process.env.ELISA_TOTAL_COST || String(ELISA_TOTAL_DEFAULT));
  const mariFixed  = parseFloat(process.env.MARI_FIXED_COST  || String(MARI_FIXED_DEFAULT));
  const { total: mariCommission, perBooking: mariPerBooking } = calcMariCommission(confirmed);
  const mariTotal = mariFixed + mariCommission;

  const totalCost = metaSpendGross + elisaTotal + mariTotal;

  // 4. KPIs derivados.
  const roas       = totalCost > 0 ? revenue / totalCost : 0;
  const cpaReal    = nEnsaios > 0 ? totalCost / nEnsaios : 0;
  const cpaMeta    = nEnsaios > 0 ? metaSpendGross / nEnsaios : 0;
  const avgTicket  = nEnsaios > 0 ? revenue / nEnsaios : 0;

  // Break-even: se ROAS < 1, quantos ensaios faltam (em ticket médio atual)
  //   pra zerar o saldo. Se ROAS >= 1, já passou — mostra lucro acumulado.
  const deficit = Math.max(0, totalCost - revenue);
  const ensaiosToBreakeven = avgTicket > 0 && deficit > 0
    ? Math.ceil(deficit / avgTicket)
    : 0;

  // Deltas derivados (ROAS, CPA) calculados sobre as janelas recentes.
  // Pra ROAS recente: usa receita recente / spend recente; idem pra prev.
  // Custos fixos (Elisa/Mari) são proporcionalizados por dias na janela —
  // assumimos que esses custos rolam continuamente (mensal).
  const recentRatio = recentDays / 30; // fração de mês na janela
  const fixedCostRecent = (elisaTotal + mariFixed) * recentRatio;
  // Comissão Mari recente: só dos ensaios na janela recente
  const recentBookings = confirmed.filter(b => b.createdAt >= recentCutoff);
  const recentCommission = recentBookings.reduce((s, b, idx) => {
    const pos = confirmed.findIndex(c => c.id === b.id) + 1;
    const rate = pos <= 15 ? 0.05 : pos <= 30 ? 0.08 : 0.10;
    return s + b.price * rate;
  }, 0);
  const prevBookings = confirmed.filter(b => b.createdAt >= prevCutoff && b.createdAt < recentCutoff);
  const prevCommission = prevBookings.reduce((s, b) => {
    const pos = confirmed.findIndex(c => c.id === b.id) + 1;
    const rate = pos <= 15 ? 0.05 : pos <= 30 ? 0.08 : 0.10;
    return s + b.price * rate;
  }, 0);
  const totalCostRecent = metaSpendRecent + fixedCostRecent + recentCommission;
  const totalCostPrev   = metaSpendPrev   + fixedCostRecent + prevCommission;

  const roasRecent = totalCostRecent > 0 ? revenueRecent / totalCostRecent : 0;
  const roasPrev   = totalCostPrev   > 0 ? revenuePrev   / totalCostPrev   : 0;
  const roasDelta  = pctDelta(roasRecent, roasPrev);

  const cpaRecent  = ensaiosRecent > 0 ? totalCostRecent / ensaiosRecent : 0;
  const cpaPrev    = ensaiosPrev   > 0 ? totalCostPrev   / ensaiosPrev   : 0;
  const cpaDelta   = pctDelta(cpaRecent, cpaPrev);

  const totalCostDelta = pctDelta(totalCostRecent, totalCostPrev);

  return res.status(200).json({
    fetched_at:   new Date().toISOString(),
    next_refresh: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
    range:        { since, until, days, note: 'Lifetime do festival 2026 por default' },
    // `deltas_window`: janela recente comparada vs período anterior de mesma duração.
    // Permite UI mostrar "+12%" ou "-5%" pra indicar tendência de curto prazo
    // independente do range "lifetime" usado pros números absolutos.
    deltas_window: { days: recentDays, note: `Últimos ${recentDays}d vs ${recentDays}d anteriores` },
    revenue: {
      total:    revenue,
      ensaios:  nEnsaios,
      avg_ticket: avgTicket,
      delta_pct:         revenueDelta,
      ensaios_delta_pct: ensaiosDelta,
    },
    costs: {
      meta_ads: {
        gross:    metaSpendGross,
        net:      metaSpendNet,
        tax_rate: taxRate,
        error:    metaError,
        delta_pct: metaSpendDelta,
      },
      elisa: {
        total: elisaTotal,
        per_ensaio: nEnsaios > 0 ? elisaTotal / nEnsaios : 0,
      },
      mari: {
        fixed:        mariFixed,
        commission:   mariCommission,
        total:        mariTotal,
        per_ensaio:   nEnsaios > 0 ? mariTotal / nEnsaios : 0,
        breakdown:    mariPerBooking.slice(0, 50), // até 50 pra payload não inflar
      },
      total: totalCost,
      total_delta_pct: totalCostDelta,
    },
    kpis: {
      roas,                                // > 1 = lucro
      roas_delta_pct:    roasDelta,
      cpa_real: cpaReal,                   // custo total / ensaios
      cpa_real_delta_pct: cpaDelta,        // INVERTED — subir é ruim
      cpa_meta: cpaMeta,                   // só Meta / ensaios
      profit:   revenue - totalCost,       // pode ser negativo
      breakeven: {
        deficit,                            // R$ que falta pra zerar
        ensaios_needed: ensaiosToBreakeven, // a ticket médio atual
        progress_pct:   totalCost > 0 ? Math.min(100, (revenue / totalCost) * 100) : 0,
      },
    },
  });
}

/* ───────── GA4 Behavior (página 6 do dashboard) ───────── */

async function handleGa4Behavior(req: VercelRequest, res: VercelResponse) {
  if (!process.env.GA4_OAUTH_REFRESH_TOKEN) {
    return res.status(503).json({
      error:   'OAuth GA4 não configurado',
      details: 'Veja docs/ga4-oauth-setup.md',
    });
  }

  const days = Math.min(Math.max(parseInt(String(req.query.range || '28'), 10) || 28, 1), 365);
  const property = `properties/${GA4_PROPERTY_ID}`;
  const client = buildGa4Client();

  const periodCurrent  = { startDate: daysAgo(days), endDate: 'today' };
  const periodPrevious = { startDate: daysAgo(days * 2), endDate: daysAgo(days + 1) };

  const [
    devicesCur, devicesPrev,
    newReturning, newReturningPrev,
    hourReport,
    dayOfWeekReport,
    cityReport,
  ] = await Promise.all([
    // Device — current
    client.runReport({
      property, dateRanges: [periodCurrent],
      dimensions: [{ name: 'deviceCategory' }],
      metrics:    [{ name: 'sessions' }],
      orderBys:   [{ metric: { metricName: 'sessions' }, desc: true }],
    }),
    // Device — previous (pra delta)
    client.runReport({
      property, dateRanges: [periodPrevious],
      dimensions: [{ name: 'deviceCategory' }],
      metrics:    [{ name: 'sessions' }],
    }),
    // New vs Returning — current
    client.runReport({
      property, dateRanges: [periodCurrent],
      dimensions: [{ name: 'newVsReturning' }],
      metrics:    [{ name: 'sessions' }],
    }),
    // New vs Returning — previous (pra delta no card "Recorrentes")
    client.runReport({
      property, dateRanges: [periodPrevious],
      dimensions: [{ name: 'newVsReturning' }],
      metrics:    [{ name: 'sessions' }],
    }),
    // Hour of day (0-23)
    client.runReport({
      property, dateRanges: [periodCurrent],
      dimensions: [{ name: 'hour' }],
      metrics:    [{ name: 'sessions' }],
      orderBys:   [{ dimension: { dimensionName: 'hour' } }],
    }),
    // Day of week (0=Sunday..6=Saturday)
    client.runReport({
      property, dateRanges: [periodCurrent],
      dimensions: [{ name: 'dayOfWeek' }],
      metrics:    [{ name: 'sessions' }],
      orderBys:   [{ dimension: { dimensionName: 'dayOfWeek' } }],
    }),
    // City (top 20)
    client.runReport({
      property, dateRanges: [periodCurrent],
      dimensions: [{ name: 'city' }, { name: 'country' }],
      metrics:    [{ name: 'sessions' }],
      orderBys:   [{ metric: { metricName: 'sessions' }, desc: true }],
      limit:      20,
    }),
  ]);

  const parseRows = (rows: NonNullable<typeof devicesCur[0]['rows']>): Record<string, number> => {
    const m: Record<string, number> = {};
    rows.forEach(r => {
      const k = r.dimensionValues?.[0]?.value || 'unknown';
      m[k] = Number(r.metricValues?.[0]?.value || 0);
    });
    return m;
  };

  const deviceCur  = parseRows(devicesCur[0].rows  || []);
  const devicePrev = parseRows(devicesPrev[0].rows || []);
  const totalCur   = Object.values(deviceCur).reduce((s, n) => s + n, 0);
  const totalPrev  = Object.values(devicePrev).reduce((s, n) => s + n, 0);

  const devices = ['mobile', 'desktop', 'tablet', 'smart tv'].map(key => {
    const cur  = deviceCur[key]  || 0;
    const prev = devicePrev[key] || 0;
    return {
      device:   key,
      sessions: cur,
      share:    totalCur  > 0 ? cur / totalCur   : 0,
      prevSessions: prev,
      prevShare:    totalPrev > 0 ? prev / totalPrev : 0,
      deltaPct: pctDelta(cur, prev),
    };
  }).filter(d => d.sessions > 0 || d.prevSessions > 0);

  const nrMap = parseRows(newReturning[0].rows || []);
  const newCount  = nrMap['new']       || 0;
  const retCount  = nrMap['returning'] || 0;
  const nrTotal   = newCount + retCount;

  // Delta vs período anterior pro share de "returning". Usa share (não count
  // absoluto) porque o user quer saber se a PROPORÇÃO de recorrentes mudou,
  // não se o volume total cresceu.
  const nrMapPrev = parseRows(newReturningPrev[0].rows || []);
  const retCountPrev = nrMapPrev['returning'] || 0;
  const nrTotalPrev  = (nrMapPrev['new'] || 0) + retCountPrev;
  const retSharePrev = nrTotalPrev > 0 ? retCountPrev / nrTotalPrev : 0;
  const retShareCur  = nrTotal > 0 ? retCount / nrTotal : 0;
  const returningDelta = pctDelta(retShareCur, retSharePrev);

  const hourMap = parseRows(hourReport[0].rows || []);
  const hours = Array.from({ length: 24 }, (_, h) => ({
    hour:     h,
    sessions: hourMap[String(h)] || hourMap[String(h).padStart(2, '0')] || 0,
  }));
  const peakHour = hours.reduce((max, h) => h.sessions > max.sessions ? h : max, hours[0]);

  const dowMap = parseRows(dayOfWeekReport[0].rows || []);
  const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const daysOfWeek = Array.from({ length: 7 }, (_, d) => ({
    day:      d,
    name:     dayNames[d],
    sessions: dowMap[String(d)] || 0,
  }));

  const cities = (cityReport.rows || []).map(r => ({
    city:     r.dimensionValues?.[0]?.value || '(unknown)',
    country:  r.dimensionValues?.[1]?.value || '(unknown)',
    sessions: Number(r.metricValues?.[0]?.value || 0),
  }));

  return res.status(200).json({
    range:        { start: periodCurrent.startDate, end: 'today', days },
    fetched_at:   new Date().toISOString(),
    next_refresh: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
    devices,
    new_vs_returning: {
      new:       { count: newCount, share: nrTotal > 0 ? newCount / nrTotal : 0 },
      returning: { count: retCount, share: nrTotal > 0 ? retCount / nrTotal : 0, deltaPct: returningDelta },
    },
    hours,
    peak_hour:   peakHour,
    days_of_week: daysOfWeek,
    cities,
  });
}

/* ───────── GA4 Engagement (página 4 do dashboard) ───────── */

async function handleGa4Engagement(req: VercelRequest, res: VercelResponse) {
  if (!process.env.GA4_OAUTH_REFRESH_TOKEN) {
    return res.status(503).json({
      error:   'OAuth GA4 não configurado',
      details: 'Veja docs/ga4-oauth-setup.md',
    });
  }

  const days = Math.min(Math.max(parseInt(String(req.query.range || '28'), 10) || 28, 1), 365);
  const property = `properties/${GA4_PROPERTY_ID}`;
  const client = buildGa4Client();

  const periodCurrent  = { startDate: daysAgo(days),     endDate: 'today' };
  const periodPrevious = { startDate: daysAgo(days * 2), endDate: daysAgo(days + 1) };

  const SCROLL_EVENTS = ['scroll_depth_25', 'scroll_depth_50', 'scroll_depth_75', 'scroll_depth_100'];
  const FORM_EVENTS = [
    'hero_form_started', 'hero_form_submit_attempt', 'hero_form_submit_success', 'hero_form_submit_error', 'hero_form_submit_blocked_validation',
    'footer_form_started', 'footer_form_submit_attempt', 'footer_form_submit_success', 'footer_form_submit_error', 'footer_form_submit_blocked_validation',
  ];

  const [kpiCur, kpiPrev, scrollReport, formsReport, faqReport, eventsReport] = await Promise.all([
    // KPIs atuais
    client.runReport({
      property,
      dateRanges: [periodCurrent],
      metrics: [
        { name: 'averageSessionDuration' },
        { name: 'engagementRate' },
        { name: 'screenPageViewsPerSession' },
        { name: 'bounceRate' },
      ],
    }),
    // KPIs anteriores
    client.runReport({
      property,
      dateRanges: [periodPrevious],
      metrics: [
        { name: 'averageSessionDuration' },
        { name: 'engagementRate' },
        { name: 'screenPageViewsPerSession' },
        { name: 'bounceRate' },
      ],
    }),
    // Scroll depth (4 thresholds) — só sessions (1 sessão = 1 pessoa que
    // alcançou aquela profundidade, métrica que importa pra essa viz)
    client.runReport({
      property,
      dateRanges: [periodCurrent],
      dimensions: [{ name: 'eventName' }],
      metrics:    [{ name: 'sessions' }],
      dimensionFilter: {
        filter: { fieldName: 'eventName', inListFilter: { values: SCROLL_EVENTS } },
      },
    }),
    // Formulários (hero + footer) — só sessions
    client.runReport({
      property,
      dateRanges: [periodCurrent],
      dimensions: [{ name: 'eventName' }],
      metrics:    [{ name: 'sessions' }],
      dimensionFilter: {
        filter: { fieldName: 'eventName', inListFilter: { values: FORM_EVENTS } },
      },
    }),
    // FAQ opens — só eventCount (display "Aberturas" = quantas vezes
    // a pergunta foi clicada total). 1 sessão pode abrir várias FAQs.
    client.runReport({
      property,
      dateRanges: [periodCurrent],
      dimensions: [{ name: 'eventName' }],
      metrics:    [{ name: 'eventCount' }],
      dimensionFilter: {
        filter: {
          fieldName:    'eventName',
          stringFilter: { matchType: 'BEGINS_WITH', value: 'faq_open_' },
        },
      },
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
      limit: 20,
    }),
    // Top custom events — só eventCount
    client.runReport({
      property,
      dateRanges: [periodCurrent],
      dimensions: [{ name: 'eventName' }],
      metrics:    [{ name: 'eventCount' }],
      orderBys:   [{ metric: { metricName: 'eventCount' }, desc: true }],
      limit:      25,
    }),
  ]);

  const curRow  = kpiCur[0].rows?.[0]?.metricValues  || [];
  const prevRow = kpiPrev[0].rows?.[0]?.metricValues || [];
  const num = (i: number, src: typeof curRow) => Number(src?.[i]?.value || 0);

  const kpis = {
    avgSessionDuration: { value: num(0, curRow), deltaPct: pctDelta(num(0, curRow), num(0, prevRow)) },
    engagementRate:     { value: num(1, curRow), deltaPct: pctDelta(num(1, curRow), num(1, prevRow)) },
    pagesPerSession:    { value: num(2, curRow), deltaPct: pctDelta(num(2, curRow), num(2, prevRow)) },
    bounceRate:         { value: num(3, curRow), deltaPct: pctDelta(num(3, curRow), num(3, prevRow)) },
  };

  // Scroll depth — map por depth value
  const scrollMap: Record<string, number> = {};
  (scrollReport[0].rows || []).forEach(r => {
    const name = r.dimensionValues?.[0]?.value || '';
    scrollMap[name] = Number(r.metricValues?.[0]?.value || 0);
  });
  const scrollDepth = SCROLL_EVENTS.map(name => ({
    depth:    parseInt(name.replace('scroll_depth_', ''), 10),
    sessions: scrollMap[name] || 0,
  }));

  // Formulários — map por evento (sessions count)
  const formMap: Record<string, number> = {};
  (formsReport[0].rows || []).forEach(r => {
    const name = r.dimensionValues?.[0]?.value || '';
    formMap[name] = Number(r.metricValues?.[0]?.value || 0);
  });
  const forms = {
    hero: {
      started: formMap['hero_form_started'] || 0,
      attempt: formMap['hero_form_submit_attempt'] || 0,
      success: formMap['hero_form_submit_success'] || 0,
      error:   formMap['hero_form_submit_error']   || 0,
      blocked: formMap['hero_form_submit_blocked_validation'] || 0,
    },
    footer: {
      started: formMap['footer_form_started'] || 0,
      attempt: formMap['footer_form_submit_attempt'] || 0,
      success: formMap['footer_form_submit_success'] || 0,
      error:   formMap['footer_form_submit_error']   || 0,
      blocked: formMap['footer_form_submit_blocked_validation'] || 0,
    },
  };

  // FAQ — parse index from event name
  const faq = (faqReport[0].rows || []).map(r => {
    const name = r.dimensionValues?.[0]?.value || '';
    const idx  = parseInt(name.replace('faq_open_', ''), 10);
    return {
      idx,
      opens: Number(r.metricValues?.[0]?.value || 0),
    };
  }).filter(f => !Number.isNaN(f.idx)).sort((a, b) => a.idx - b.idx);

  // Top events
  const topEvents = (eventsReport[0].rows || []).map(r => ({
    event_name: r.dimensionValues?.[0]?.value || 'unknown',
    count:      Number(r.metricValues?.[0]?.value || 0),
  }));

  return res.status(200).json({
    range:        { start: periodCurrent.startDate, end: 'today', days },
    fetched_at:   new Date().toISOString(),
    next_refresh: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
    kpis, scrollDepth, forms, faq, topEvents,
  });
}

/* ───────── Clarity Insights (sinais de fricção — complementa GA4 Engagement) ───────── */

// Cache em memória — Clarity tem limite duro de 10 req/dia por projeto.
// Estratégia anti-rate-limit em 3 camadas:
//   1. TTL longo de 12h → no máx 2 req/dia em condições normais (margem 80%)
//   2. lastGood map → sobrevive expiração; serve dados velhos se a próxima
//      tentativa de refresh bater 429, em vez de quebrar o card no front
//   3. cold-start re-fetcha (sem persistência externa); tolerável porque
//      eventos de cold start em dia normal são raros (~1-2x)
type ClarityCacheEntry = { data: unknown; expiresAt: number };
const clarityCache    = new Map<string, ClarityCacheEntry>();
const clarityLastGood = new Map<string, { data: unknown; fetchedAt: number }>();
const CLARITY_CACHE_TTL_MS = 12 * 3600 * 1000;

interface ClarityMetricRow {
  metricName?: string;
  information?: Array<Record<string, string | number>>;
}

async function handleClarityInsights(req: VercelRequest, res: VercelResponse) {
  const token = process.env.CLARITY_API_TOKEN;
  if (!token) {
    return res.status(503).json({
      error:   'Clarity API não configurado',
      details: 'Adicione CLARITY_API_TOKEN nas env vars da Vercel (gere em clarity.microsoft.com → Settings → Data Export)',
    });
  }

  // Clarity Data Export API aceita só 1/2/3 dias. Default 3 (janela máxima).
  const numOfDays = Math.min(Math.max(parseInt(String(req.query.days || '3'), 10) || 3, 1), 3);
  const forceRefresh = req.query.refresh === '1';
  const cacheKey = `clarity:${numOfDays}`;

  const cached = clarityCache.get(cacheKey);
  if (cached && !forceRefresh && cached.expiresAt > Date.now()) {
    return res.status(200).json({
      ...(cached.data as Record<string, unknown>),
      cache_hit: true,
    });
  }

  const url = `https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=${numOfDays}`;
  const r = await fetch(url, {
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!r.ok) {
    // Stale-while-error: rate limit (429) ou outro erro temporário?
    // Se temos último resultado bom em memória, retorna ele com flag stale.
    // Card no front continua aparecendo (não quebra com banner amarelo).
    const lastGood = clarityLastGood.get(cacheKey);
    if (lastGood) {
      console.warn(`[clarity] API ${r.status} — servindo cache stale de ${new Date(lastGood.fetchedAt).toISOString()}`);
      return res.status(200).json({
        ...(lastGood.data as Record<string, unknown>),
        cache_hit:     true,
        stale:         true,
        stale_reason:  r.status === 429 ? 'rate_limit' : `http_${r.status}`,
        stale_since:   new Date(lastGood.fetchedAt).toISOString(),
      });
    }
    // Sem fallback — erro real
    const body = await r.text();
    const msg = r.status === 429
      ? 'Clarity rate limit excedido (10 req/dia). Volte amanhã ou aguarde o cache renovar.'
      : `Clarity API ${r.status}: ${body.slice(0, 400)}`;
    throw new Error(msg);
  }

  const raw = await r.json() as ClarityMetricRow[];

  // Normaliza metricName (case-insensitive, sem espaço/underscore) pra lookup robusto
  const norm = (s: string) => s.toLowerCase().replace(/[\s_-]/g, '');
  const byMetric: Record<string, ClarityMetricRow['information']> = {};
  if (Array.isArray(raw)) {
    raw.forEach(m => {
      if (m.metricName) byMetric[norm(m.metricName)] = m.information || [];
    });
  }

  // Extrai counts de fricção. Estrutura real (confirmada em produção):
  // { sessionsCount: "216", sessionsWithMetricPercentage: 0, sessionsWithoutMetricPercentage: 100,
  //   pagesViews: "0", subTotal: "0" }
  // O percentage já vem em 0..100; normalizamos pra 0..1 pro frontend.
  const frictionPct = (metricKey: string) => {
    const info = byMetric[metricKey]?.[0];
    if (!info) return { pct: 0, sessions: 0, total: 0 };
    const pctRaw   = Number(info.sessionsWithMetricPercentage) || 0; // 0..100
    const total    = Number(info.sessionsCount)                || 0;
    const sessions = Math.round(total * pctRaw / 100);
    return {
      pct:      pctRaw / 100, // 0..1
      sessions,
      total,
    };
  };

  const rageClicks      = frictionPct('rageclickcount');
  const deadClicks      = frictionPct('deadclickcount');
  const excessiveScroll = frictionPct('excessivescroll');
  const quickBacks      = frictionPct('quickbackclick');
  const scriptErrors    = frictionPct('scripterrorcount');
  const errorClicks     = frictionPct('errorclickcount');

  // Traffic — sessões reais + bot count + pages/sessão
  // Estrutura esperada (sample doc):
  // { totalSessionCount: "9554", totalBotSessionCount: "8369", distantUserCount, PagesPerSessionPercentage: 1.09 }
  const trafficInfo = byMetric['traffic']?.[0];
  const sessions       = Number(trafficInfo?.totalSessionCount)        || 0;
  const botSessions    = Number(trafficInfo?.totalBotSessionCount)     || 0;
  const pagesPerSession = Number(trafficInfo?.PagesPerSessionPercentage) || 0;

  // Scroll depth médio (campo exato vem do log defensivo abaixo)
  const scrollInfo = byMetric['scrolldepth']?.[0];
  const averageScrollDepth = Number(scrollInfo?.averageScrollDepth) || 0;

  // Engagement time (active vs total)
  const engageInfo = byMetric['engagementtime']?.[0];
  const totalTime  = Number(engageInfo?.totalTime)  || 0;
  const activeTime = Number(engageInfo?.activeTime) || 0;

  // Log defensivo — confirma a estrutura real dos 3 metrics novos
  console.log('[clarity] traffic row:', JSON.stringify(trafficInfo));
  console.log('[clarity] scrolldepth row:', JSON.stringify(scrollInfo));
  console.log('[clarity] engagementtime row:', JSON.stringify(engageInfo));

  const payload = {
    range:        { days: numOfDays, note: 'Clarity API limita a janela máxima a 3 dias' },
    fetched_at:   new Date().toISOString(),
    next_refresh: new Date(Date.now() + CLARITY_CACHE_TTL_MS).toISOString(),
    friction: {
      rageClicks,
      deadClicks,
      excessiveScroll,
      quickBacks,
      scriptErrors,
      errorClicks,
    },
    kpis: {
      sessions,           // real users count
      botSessions,        // bots excluded
      pagesPerSession,    // ratio (PagesPerSessionPercentage é misleading no doc — é ratio mesmo)
      averageScrollDepth, // 0..100
      activeTime,         // ms ou s (frontend formata via fmtClarityTime)
      totalTime,
    },
  };

  const now = Date.now();
  clarityCache.set(cacheKey, {
    data:      payload,
    expiresAt: now + CLARITY_CACHE_TTL_MS,
  });
  clarityLastGood.set(cacheKey, { data: payload, fetchedAt: now });  // pra stale-while-error

  return res.status(200).json({ ...payload, cache_hit: false });
}

/* ───────── Geo Brasil (mapa por UF — agregação multi-fonte) ───────── */

// Normaliza nome de estado (GA4/Meta retornam variantes) pra UF de 2 letras.
// GA4 dimension `region` pra Brasil retorna "State of São Paulo", "São Paulo",
// "Federal District", etc. Meta breakdown=region retorna nomes em português ou inglês.
const BR_STATE_NAME_TO_UF: Record<string, string> = {
  'acre': 'AC',
  'alagoas': 'AL',
  'amapa': 'AP', 'amapá': 'AP',
  'amazonas': 'AM',
  'bahia': 'BA',
  'ceara': 'CE', 'ceará': 'CE',
  'distrito federal': 'DF', 'federal district': 'DF',
  'espirito santo': 'ES', 'espírito santo': 'ES',
  'goias': 'GO', 'goiás': 'GO',
  'maranhao': 'MA', 'maranhão': 'MA',
  'mato grosso': 'MT',
  'mato grosso do sul': 'MS',
  'minas gerais': 'MG',
  'para': 'PA', 'pará': 'PA',
  'paraiba': 'PB', 'paraíba': 'PB',
  'parana': 'PR', 'paraná': 'PR',
  'pernambuco': 'PE',
  'piaui': 'PI', 'piauí': 'PI',
  'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN',
  'rio grande do sul': 'RS',
  'rondonia': 'RO', 'rondônia': 'RO',
  'roraima': 'RR',
  'santa catarina': 'SC',
  'sao paulo': 'SP', 'são paulo': 'SP',
  'sergipe': 'SE',
  'tocantins': 'TO',
};

function nameToUF(raw: string): string | null {
  if (!raw) return null;
  // Strip "State of ", lowercase, trim
  const cleaned = raw.toLowerCase().replace(/^state of /, '').trim();
  if (BR_STATE_NAME_TO_UF[cleaned]) return BR_STATE_NAME_TO_UF[cleaned];
  // Talvez já seja UF de 2 letras
  if (/^[A-Z]{2}$/.test(raw.toUpperCase())) return raw.toUpperCase();
  return null;
}

const ALL_UF = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
  'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
];

async function handleGeoBrazil(req: VercelRequest, res: VercelResponse) {
  const days = Math.min(Math.max(parseInt(String(req.query.range || '28'), 10) || 28, 1), 365);

  // Fontes em paralelo. Cada uma falha de forma independente.
  const [leadsResult, bookingsResult, sessionsResult, impressionsResult] = await Promise.allSettled([
    aggregateLeadsByUF(days),
    aggregateBookingsByUF(),
    aggregateSessionsByUF(days),
    aggregateImpressionsByUF(days),
  ]);

  const states: Record<string, { leads: number; clientes: number; sessions: number; impressions: number }> = {};
  ALL_UF.forEach(uf => { states[uf] = { leads: 0, clientes: 0, sessions: 0, impressions: 0 }; });

  const leads       = leadsResult.status       === 'fulfilled' ? leadsResult.value       : {};
  const clientes    = bookingsResult.status    === 'fulfilled' ? bookingsResult.value    : {};
  const sessions    = sessionsResult.status    === 'fulfilled' ? sessionsResult.value    : {};
  const impressions = impressionsResult.status === 'fulfilled' ? impressionsResult.value : {};

  Object.entries(leads).forEach(([uf, n])       => { if (states[uf]) states[uf].leads       = n; });
  Object.entries(clientes).forEach(([uf, n])    => { if (states[uf]) states[uf].clientes    = n; });
  Object.entries(sessions).forEach(([uf, n])    => { if (states[uf]) states[uf].sessions    = n; });
  Object.entries(impressions).forEach(([uf, n]) => { if (states[uf]) states[uf].impressions = n; });

  const sources = {
    leads:       leadsResult.status       === 'fulfilled',
    clientes:    bookingsResult.status    === 'fulfilled',
    sessions:    sessionsResult.status    === 'fulfilled',
    impressions: impressionsResult.status === 'fulfilled',
  };
  const errors = {
    leads:       leadsResult.status       === 'rejected' ? String(leadsResult.reason)       : null,
    clientes:    bookingsResult.status    === 'rejected' ? String(bookingsResult.reason)    : null,
    sessions:    sessionsResult.status    === 'rejected' ? String(sessionsResult.reason)    : null,
    impressions: impressionsResult.status === 'rejected' ? String(impressionsResult.reason) : null,
  };

  return res.status(200).json({
    range:        { days },
    fetched_at:   new Date().toISOString(),
    next_refresh: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
    states,
    sources,
    errors,
  });
}

async function aggregateLeadsByUF(days: number): Promise<Record<string, number>> {
  const rows = await fetchSheetRange(LEADS_SHEET_ID, 'A2:F1000');
  const cutoff = days > 0 ? Date.now() - days * 86400000 : 0;
  const byState: Record<string, number> = {};

  for (const row of rows) {
    if (!row[0]) continue;
    const ts = new Date(row[0]).getTime();
    if (Number.isNaN(ts)) continue;
    if (cutoff > 0 && ts < cutoff) continue;

    const ddd = extractDDD(String(row[3] || ''));
    if (!ddd) continue;
    const info = DDD_TO_STATE[ddd];
    if (!info) continue;
    byState[info.state] = (byState[info.state] || 0) + 1;
  }
  return byState;
}

async function aggregateBookingsByUF(): Promise<Record<string, number>> {
  const rows = await fetchSheetRange(BOOKINGS_SHEET_ID, 'Agendamentos!A2:U1000');
  const customersByState: Record<string, Set<string>> = {};

  for (const row of rows) {
    if (!row[0] || !String(row[0]).trim()) continue;
    const email     = String(row[8] || '').toLowerCase().trim() || `id-${row[0]}`;
    const whatsapp  = String(row[9] || '');
    const statusRaw = String(row[12] || '');
    const status    = normalizeStatus(statusRaw);
    if (status !== 'confirmado') continue; // só clientes confirmados (intent real)

    const ddd = extractDDD(whatsapp);
    if (!ddd) continue;
    const info = DDD_TO_STATE[ddd];
    if (!info) continue;
    if (!customersByState[info.state]) customersByState[info.state] = new Set();
    customersByState[info.state].add(email);
  }

  const result: Record<string, number> = {};
  Object.entries(customersByState).forEach(([uf, set]) => { result[uf] = set.size; });
  return result;
}

async function aggregateSessionsByUF(days: number): Promise<Record<string, number>> {
  if (!process.env.GA4_OAUTH_REFRESH_TOKEN) throw new Error('GA4 OAuth não configurado');
  const property = `properties/${GA4_PROPERTY_ID}`;
  const client = buildGa4Client();

  const [report] = await client.runReport({
    property,
    dateRanges: [{ startDate: daysAgo(days), endDate: 'today' }],
    dimensions: [{ name: 'country' }, { name: 'region' }],
    metrics:    [{ name: 'sessions' }],
    dimensionFilter: {
      filter: { fieldName: 'country', stringFilter: { matchType: 'EXACT', value: 'Brazil' } },
    },
    limit: 100,
  });

  const byState: Record<string, number> = {};
  (report.rows || []).forEach(r => {
    const regionName = r.dimensionValues?.[1]?.value || '';
    const sessions   = Number(r.metricValues?.[0]?.value || 0);
    const uf = nameToUF(regionName);
    if (uf) byState[uf] = (byState[uf] || 0) + sessions;
  });
  return byState;
}

async function aggregateImpressionsByUF(days: number): Promise<Record<string, number>> {
  const token     = process.env.META_ADS_TOKEN;
  const accountId = process.env.META_ADS_ACCOUNT_ID;
  if (!token || !accountId) throw new Error('META_ADS_TOKEN ou META_ADS_ACCOUNT_ID ausentes');

  const until = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
  const acctPath = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
  const url = `https://graph.facebook.com/v19.0/${acctPath}/insights?fields=impressions&breakdowns=region&time_range=${timeRange}&access_token=${token}`;

  const r = await fetch(url);
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Meta API ${r.status}: ${body.slice(0, 200)}`);
  }
  const json = await r.json() as { data?: Array<{ region?: string; impressions?: string }> };

  const byState: Record<string, number> = {};
  (json.data || []).forEach(row => {
    const uf = nameToUF(row.region || '');
    if (!uf) return;
    byState[uf] = (byState[uf] || 0) + (Number(row.impressions) || 0);
  });
  return byState;
}

/* ───────── Action handlers (POST body { action: '...', ... }) ───────── */

async function handleCancel(req: VercelRequest, res: VercelResponse, auth: { user: string }) {
  const PACKAGES = getPackages();
  const { bookingId, reason, name, email, date, time, endTime, packageKey, packageName, numBailarinas } = req.body as {
    bookingId:      string; reason: string;
    name:           string; email: string;
    date:           string; time:  string;
    endTime?:       string;
    packageKey?:    string; packageName?: string;
    numBailarinas?: number;
  };

  if (!bookingId || !reason) return res.status(400).json({ error: 'bookingId e reason são obrigatórios' });

  try {
    await fetch(SCRIPT_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'cancelBooking', bookingId, reason }),
    });
  } catch (e) {
    console.error('[admin-bookings/cancel] cancelBooking error', e);
    return res.status(500).json({ error: 'Erro ao cancelar na planilha' });
  }

  const logMsg = `${auth.user} cancelou ensaio de ${name} (${fmtDate(date)} ${time}) — motivo: ${reason}`;
  await fetch(SCRIPT_URL, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'addLog', message: logMsg, origin: 'painel' }),
  }).catch(e => console.error('[admin-bookings/cancel] addLog error', e));

  if (email) {
    const pkg = (packageKey && PACKAGES[packageKey as PkgKey]) || { name: packageName || '—', duration: 0, price: 0 };
    const html = buildBookingEmailHtml({
      name, date, time,
      endTime:       endTime || time,
      packageName:   pkg.name,
      duration:      pkg.duration,
      price:         (pkg.price || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      bookingId,
      numBailarinas: Number(numBailarinas) || 1,
    }, 'cancelled');

    await Promise.allSettled([
      resend.emails.send({
        from:    'Ensaio Joinville <confirmacao@ensaiofotograficoemjoinville.com>',
        to:      email,
        subject: `Cancelamento de ensaio — ${fmtDate(date)} às ${time}`,
        html,
      }),
      resend.emails.send({
        from:    'Ensaio Joinville <confirmacao@ensaiofotograficoemjoinville.com>',
        to:      ANDRE_EMAIL,
        subject: `[Admin] Cancelamento: ${name} — ${fmtDate(date)} ${time}`,
        html:    `<p>${logMsg}</p>`,
      }),
    ]);
  }

  return res.status(200).json({ ok: true });
}

async function handleConfirm(req: VercelRequest, res: VercelResponse, auth: { user: string }) {
  const PACKAGES = getPackages();
  const { bookingId, stripeSession, name, email, date, time, packageKey, numBailarinas } = req.body as {
    bookingId:      string; stripeSession: string;
    name:           string; email: string; whatsapp?: string;
    date:           string; time:  string;
    packageKey:     string; numBailarinas?: number;
  };

  if (!bookingId || !stripeSession) {
    return res.status(400).json({ error: 'bookingId e stripeSession são obrigatórios' });
  }

  const pkg     = PACKAGES[packageKey as PkgKey] || { name: packageKey, duration: 0, price: 0 };
  const endTime = calcEnd(time, pkg.duration);

  let confirmedId = bookingId;
  try {
    const r = await fetch(SCRIPT_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action:        'confirmBooking',
        stripeSession,
        stripePayment: `admin-manual-${Date.now()}`,
      }),
    });
    const json = await r.json();
    confirmedId = json.bookingId || bookingId;
  } catch (e) {
    console.error('[admin-bookings/confirm] confirmBooking error', e);
    return res.status(500).json({ error: 'Erro ao confirmar na planilha' });
  }

  const logMsg = `${auth.user} confirmou manualmente o pagamento de ${name} — ${fmtDate(date)} ${time} (${pkg.name})`;
  await fetch(SCRIPT_URL, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'addLog', message: logMsg, origin: 'painel' }),
  }).catch(() => {});

  if (email) {
    const html = buildBookingEmailHtml({
      name, date, time, endTime,
      packageName: pkg.name,
      duration:    pkg.duration,
      price:       (pkg.price || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      bookingId:   confirmedId,
      numBailarinas: Number(numBailarinas) || 1,
    }, 'confirmed');

    await Promise.allSettled([
      resend.emails.send({
        from:    'Ensaio Joinville <confirmacao@ensaiofotograficoemjoinville.com>',
        to:      email,
        subject: `Reserva confirmada — ${pkg.name} · ${fmtDate(date)} às ${time}`,
        html,
      }),
      resend.emails.send({
        from:    'Ensaio Joinville <confirmacao@ensaiofotograficoemjoinville.com>',
        to:      ANDRE_EMAIL,
        subject: `[Admin] Confirmação manual: ${name} — ${fmtDate(date)} ${time}`,
        html:    `<p>${logMsg}</p>`,
      }),
    ]);
  }

  return res.status(200).json({ ok: true, bookingId: confirmedId });
}

async function handleCreate(req: VercelRequest, res: VercelResponse, auth: { user: string }) {
  const PACKAGES = getPackages();
  const { name, email, whatsapp, instagram, instagramBailarina, nomeBailarina, numBailarinas,
          date, time, packageKey, confirm, customValue, splitCount, payerNames } = req.body as {
    name: string; email: string; whatsapp: string;
    instagram?: string; instagramBailarina?: string; nomeBailarina?: string; numBailarinas?: number;
    date: string; time: string; packageKey: PkgKey; confirm: boolean;
    customValue?: number;
    splitCount?: number;      // 1 (default) ou até pkg.maxBailarinas — multi-pagador
    payerNames?: string[];    // nome de cada pagador (paralelo aos links do split)
  };

  if (!name || !email || !date || !time || !packageKey) {
    return res.status(400).json({ error: 'Campos obrigatórios faltando' });
  }

  const pkg = PACKAGES[packageKey];
  if (!pkg) return res.status(400).json({ error: 'Pacote inválido' });

  const nb = Number(numBailarinas);
  if (!Number.isInteger(nb) || nb < 1 || nb > pkg.maxBailarinas) {
    return res.status(400).json({ error: `Nº Bailarinas deve estar entre 1 e ${pkg.maxBailarinas} para o pacote ${pkg.name}` });
  }

  // Multi-pagador: valida splitCount contra pkg.maxBailarinas. 1 = comportamento
  // antigo (1 link com valor cheio). Sem campo → default 1 (compat).
  let split = 1;
  if (splitCount !== undefined && splitCount !== null) {
    if (typeof splitCount !== 'number' || !Number.isInteger(splitCount) || splitCount < 1) {
      return res.status(400).json({ error: 'splitCount inválido' });
    }
    if (splitCount > pkg.maxBailarinas) {
      return res.status(400).json({ error: `splitCount máximo pro pacote ${pkg.name} é ${pkg.maxBailarinas}` });
    }
    split = splitCount;
  }

  // Nomes dos pagadores (1 por link). Normaliza pra array de tamanho `split`:
  // entradas faltantes viram '' (link fica sem nome — fallback "Pagador N").
  const names: string[] = Array.from({ length: split }, (_, i) =>
    (Array.isArray(payerNames) && typeof payerNames[i] === 'string' ? payerNames[i].trim() : '')
  );

  // Admin pode customizar valor (descontos especiais). Em REAIS, mesma unidade
  // de pkg.price. Sanity: número finito >= 0 e <= pkg.price (não permitimos
  // cobrar ACIMA do catálogo via descontos).
  //
  // IMPORTANTE: se admin ENVIOU um customValue mas é inválido (NaN, negativo,
  // ou > catálogo), RETORNA 400 em vez de cair em pkg.price silenciosamente.
  // Fallback silencioso é o bug que fazia Mari achar que aplicou desconto e
  // o ASAAS cobrar o valor cheio. Só usa catálogo se admin NÃO mandou o campo.
  let chargeValue: number;
  if (customValue === undefined || customValue === null) {
    chargeValue = pkg.price;
  } else if (typeof customValue !== 'number' || !isFinite(customValue)) {
    return res.status(400).json({ error: `Valor inválido: ${String(customValue)}. Use um número inteiro em reais (ex: 1400).` });
  } else if (customValue < 0) {
    return res.status(400).json({ error: 'Valor não pode ser negativo.' });
  } else if (customValue > pkg.price) {
    return res.status(400).json({ error: `Valor (R$ ${customValue}) acima do catálogo (R$ ${pkg.price}). Desconto só pra baixo.` });
  } else {
    chargeValue = customValue;
  }
  console.log(`[admin-bookings/create] chargeValue=${chargeValue} (pkg.price=${pkg.price}, customValue=${customValue})`);

  const endTime = calcEnd(time, pkg.duration);
  const logUser = auth.user;

  // Pre-flight: confirma que o slot ainda está livre antes de qualquer escrita
  try {
    const slotsRes  = await fetch(`${SCRIPT_URL}?action=slots&date=${encodeURIComponent(date)}&package=${encodeURIComponent(packageKey)}&t=${Date.now()}`, { cache: 'no-store' });
    const slotsJson = await slotsRes.json() as { slots?: string[] };
    const livres    = Array.isArray(slotsJson.slots) ? slotsJson.slots : [];
    if (!livres.includes(time)) {
      return res.status(409).json({ error: 'Esse horário não está mais disponível. Atualize a lista e escolha outro.' });
    }
  } catch (e) {
    console.error('[admin-bookings/create] pre-flight slot check failed', e);
  }

  // Path A: gera link(s) de pagamento — gateway escolhido pela Mari no painel
  // (req.body.gateway); fallback no default global PAYMENT_GATEWAY.
  //
  // Multi-pagador: se split > 1, cria N links em paralelo, cada um pagando
  // chargeValue/N (arredondado a 2 casas; ajustes de centavos vão pro último
  // link). Todos os N session IDs vão pra "Stripe Session" comma-separated.
  if (!confirm) {
    try {
      const gw = resolveGateway((req.body as { gateway?: string }).gateway);

      // Distribuição dos valores: split-1 chunks iguais, último absorve o resto
      // pra fechar exatamente em chargeValue (evita perda de centavo).
      const linkValues: number[] = [];
      if (split === 1) {
        linkValues.push(chargeValue);
      } else {
        const each = Math.floor((chargeValue / split) * 100) / 100;  // 2 decimais p/ baixo
        for (let i = 0; i < split - 1; i++) linkValues.push(each);
        linkValues.push(Number((chargeValue - each * (split - 1)).toFixed(2)));  // resto
      }

      const createOneLink = async (partValue: number, idx: number): Promise<{ url: string; id: string }> => {
        // Nome do pagador desse link (vazio → "pagador N/total" genérico).
        const payerName = names[idx] || '';
        const partLabel = split > 1
          ? (payerName ? ` · ${payerName}` : ` (pagador ${idx + 1}/${split})`)
          : '';
        const dateLabel = `${date.split('-').reverse().join('/')} às ${time}`;
        if (gw === 'asaas') {
          // ASAAS itemName limita 30 chars: prioriza o nome do pagador (é o que
          // a Mari precisa ver pra saber de quem é o link). Sem nome → "Pacote X".
          const asaasItemName = (split > 1 && payerName)
            ? `${pkg.name}: ${payerName}`.slice(0, 30)
            : `Pacote ${pkg.name}`.slice(0, 30);
          const checkout = await createAsaasCheckoutAdmin({
            itemName:          asaasItemName,
            itemDescription:   `${dateLabel} · ${pkg.duration} min · ${nb} ${nb === 1 ? 'bailarina' : 'bailarinas'}${partLabel}`,
            value:             partValue,
            externalReference: encodeAsaasRefAdmin({ date, time, packageKey, numBailarinas: nb, name, email, whatsapp }),
            successUrl:        `${SITE_URL}/agendamento/sucesso`,
            cancelUrl:         `${SITE_URL}/agendamento?cancelado=1`,
          });
          return { url: checkout.link, id: checkout.id };
        }
        // Mercado Pago — title aceita mais chars; coloca o nome direto.
        const mpTitle = (split > 1 && payerName)
          ? `Ensaio Joinville — ${pkg.name} · ${payerName}`
          : `Ensaio Joinville — ${pkg.name}${partLabel}`;
        const expiry = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
        const prefRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MP_TOKEN}` },
          body: JSON.stringify({
            items: [{
              title:       mpTitle,
              description: `${dateLabel} · ${pkg.duration} min`,
              quantity:    1,
              unit_price:  partValue,
              currency_id: 'BRL',
            }],
            payer: { email },
            back_urls: {
              success: `${SITE_URL}/agendamento/sucesso`,
              failure: `${SITE_URL}/agendamento?cancelado=1`,
              pending: `${SITE_URL}/agendamento/sucesso`,
            },
            auto_return:        'approved',
            payment_methods:    { installments: 6 },
            external_reference: JSON.stringify({ date, time, packageKey, name, email, whatsapp }),
            notification_url:   `${SITE_URL}/api/webhook`,
            expires:              true,
            expiration_date_to:   expiry,
          }),
        });
        const pref = await prefRes.json() as { id?: string; init_point?: string; message?: string };
        if (!pref.id || !pref.init_point) throw new Error(pref.message || 'Erro ao criar preferência MP');
        return { url: pref.init_point, id: pref.id };
      };

      // Em paralelo. Se algum falhar, cancela os criados antes de propagar erro.
      const createdLinks: Array<{ url: string; id: string }> = [];
      try {
        const results = await Promise.all(linkValues.map((v, i) => createOneLink(v, i)));
        createdLinks.push(...results);
      } catch (linkErr) {
        const msg = linkErr instanceof Error ? linkErr.message : String(linkErr);
        // Best-effort rollback dos links que JÁ subiram nesse Promise.all (alguns
        // podem ter resolved antes do reject — promises resolved não populam
        // createdLinks mas o gateway ja tem os links órfãos). Sem como pegar os
        // resolved-then-rejected aqui; log o erro e ajusta com retry do admin.
        console.error('[admin-bookings/create] falha criando split links:', msg);
        throw new Error(`Erro ao criar links: ${msg}`);
      }

      const sessionsJoined = createdLinks.map(l => l.id).join(',');
      const primaryExternalId = createdLinks[0].id;

      // Tenta criar pending — se falhar, rollback de TODOS os links no gateway
      let pendingJson: { bookingId?: string };
      try {
        const pendingRes = await fetch(SCRIPT_URL, {
          method: 'POST', headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({
            action: 'createPending',
            date, start: time, packageKey, name, email, whatsapp,
            instagram:          instagram || '',
            instagramBailarina: instagramBailarina || '',
            nomeBailarina:      nomeBailarina || '',
            numBailarinas:      nb,
            stripeSession:      sessionsJoined,
            gateway:            gw,
            source:             'admin',
            customValue:        chargeValue,
            payerNames:         names,   // 1 nome por link (paralelo a sessionsJoined)
          }),
        });
        if (!pendingRes.ok) throw new Error(`Sheets HTTP ${pendingRes.status}`);
        pendingJson = await pendingRes.json() as { bookingId?: string };
      } catch (pendingErr) {
        const errMsg = pendingErr instanceof Error ? pendingErr.message : String(pendingErr);
        console.error(`[admin-bookings/create] createPending FAILED após ${createdLinks.length} link(s) criado(s): ${errMsg} — rollback...`);
        await Promise.allSettled(createdLinks.map(l => {
          if (gw === 'asaas') return cancelAsaasLink(l.id);
          return fetch(`https://api.mercadopago.com/checkout/preferences/${l.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MP_TOKEN}` },
            body: JSON.stringify({
              expires:            true,
              expiration_date_to: new Date(Date.now() - 60 * 1000).toISOString(),
            }),
          });
        }));
        throw new Error('Erro ao criar pending. Link(s) cancelado(s) — tente novamente.');
      }
      const bookingId = pendingJson.bookingId || '';

      const logSplit = split > 1 ? ` (${split} pagadores: R$ ${linkValues.map(v => v.toFixed(2)).join(' + R$ ')})` : '';
      await fetch(SCRIPT_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'addLog', message: `${logUser} criou agendamento pendente para ${name} (${date} ${time}) e gerou link de pgmto (${gw})${logSplit}`, origin: 'painel' }),
      }).catch(() => {});

      // Response: mantém `paymentUrl` (compat single-pagador) + adiciona
      // `paymentUrls` (array com todos) + `paymentParts` (URL + valor + ID).
      return res.status(200).json({
        bookingId,
        paymentUrl:  createdLinks[0].url,
        paymentUrls: createdLinks.map(l => l.url),
        paymentParts: createdLinks.map((l, i) => ({ url: l.url, sessionId: l.id, value: linkValues[i], payerName: names[i] || '' })),
        splitCount:  split,
        externalId:  primaryExternalId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[admin-bookings/create] link path', msg);
      return res.status(500).json({ error: msg });
    }
  }

  // Path B: confirma imediatamente (pagamento manual / cash)
  const sessionId = `admin-new-${Date.now()}`;
  try {
    await fetch(SCRIPT_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'createPending',
        date, start: time, packageKey, name, email, whatsapp,
        instagram:          instagram || '',
        instagramBailarina: instagramBailarina || '',
        nomeBailarina:      nomeBailarina || '',
        numBailarinas:      nb,
        stripeSession:      sessionId,
        source:             'admin',
        customValue:        chargeValue,
      }),
    });

    const confRes  = await fetch(SCRIPT_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action:        'confirmBooking',
        stripeSession: sessionId,
        stripePayment: `admin-direct-${Date.now()}`,
      }),
    });
    const confJson  = await confRes.json() as { bookingId?: string };
    const bookingId = confJson.bookingId || '';

    const logMsg = `${logUser} criou e confirmou agendamento de ${name} — ${fmtDate(date)} ${time} (${pkg.name})`;
    await fetch(SCRIPT_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'addLog', message: logMsg, origin: 'painel' }),
    }).catch(() => {});

    if (email) {
      const html = buildBookingEmailHtml({
        name, date, time, endTime,
        packageName: pkg.name,
        duration:    pkg.duration,
        price:       chargeValue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        bookingId,
        numBailarinas: nb,
      }, 'confirmed');

      await Promise.allSettled([
        resend.emails.send({
          from:    'Ensaio Joinville <confirmacao@ensaiofotograficoemjoinville.com>',
          to:      email,
          subject: `Reserva confirmada — ${pkg.name} · ${fmtDate(date)} às ${time}`,
          html,
        }),
        resend.emails.send({
          from:    'Ensaio Joinville <confirmacao@ensaiofotograficoemjoinville.com>',
          to:      ANDRE_EMAIL,
          subject: `[Admin] Novo agendamento direto: ${name} — ${fmtDate(date)} ${time}`,
          html:    `<p>${logMsg}</p>`,
        }),
      ]);
    }

    return res.status(200).json({ ok: true, bookingId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[admin-bookings/create] confirm path', msg);
    return res.status(500).json({ error: msg });
  }
}

async function handleEdit(req: VercelRequest, res: VercelResponse, auth: { user: string }) {
  const { bookingId, name, email, whatsapp, instagram, instagramBailarina, nomeBailarina, numBailarinas } = req.body as {
    bookingId: string; name: string; email: string;
    whatsapp?: string; instagram?: string; instagramBailarina?: string; nomeBailarina?: string; numBailarinas?: number;
  };

  if (!bookingId || !name || !email) {
    return res.status(400).json({ error: 'Campos obrigatórios faltando' });
  }

  let nb: number | undefined;
  if (numBailarinas !== undefined && numBailarinas !== null && String(numBailarinas) !== '') {
    nb = Number(numBailarinas);
    if (!Number.isInteger(nb) || nb < 1 || nb > 9) {
      return res.status(400).json({ error: 'Nº Bailarinas deve ser um inteiro entre 1 e 9' });
    }
  }

  try {
    const r = await fetch(SCRIPT_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action:             'editBooking',
        bookingId,
        name,
        email,
        whatsapp:           whatsapp           || '',
        instagram:          instagram          || '',
        instagramBailarina: instagramBailarina || '',
        nomeBailarina:      nomeBailarina      || '',
        ...(nb !== undefined ? { numBailarinas: nb } : {}),
      }),
    });

    const json = await r.json() as { ok?: boolean; error?: string };
    if (!json.ok) throw new Error(json.error || 'Erro ao editar');

    await fetch(SCRIPT_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action:  'addLog',
        message: `${auth.user} editou dados do agendamento ${bookingId} (${name})`,
        origin:  'painel',
      }),
    }).catch(() => {});

    return res.status(200).json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[admin-bookings/edit]', msg);
    return res.status(500).json({ error: msg });
  }
}

async function handlePaymentLink(req: VercelRequest, res: VercelResponse, auth: { user: string }) {
  const PACKAGES = getPackages();
  const { bookingId, name, email, whatsapp, instagram, instagramBailarina, nomeBailarina, numBailarinas,
          date, time, packageKey, oldStripeSession, customValue } = req.body as {
    bookingId: string; name: string; email: string; whatsapp: string;
    instagram?: string; instagramBailarina?: string; nomeBailarina?: string; numBailarinas?: number;
    date: string; time: string; packageKey: PkgKey;
    oldStripeSession?: string; // ID do link antigo (pra cancelar via API)
    customValue?: number;       // valor customizado pra desconto (REAIS)
  };

  if (!bookingId || !date || !time || !packageKey || !name || !email) {
    return res.status(400).json({ error: 'Campos obrigatórios faltando' });
  }

  const pkg = PACKAGES[packageKey];
  if (!pkg) return res.status(400).json({ error: 'Pacote inválido' });

  // Admin pode customizar valor (descontos). Em REAIS. Sanity igual ao handleCreate.
  // Mesma regra: rejeita inválidos em vez de cair em catálogo silenciosamente.
  let chargeValue: number;
  if (customValue === undefined || customValue === null) {
    chargeValue = pkg.price;
  } else if (typeof customValue !== 'number' || !isFinite(customValue)) {
    return res.status(400).json({ error: `Valor inválido: ${String(customValue)}. Use um número inteiro em reais (ex: 1400).` });
  } else if (customValue < 0) {
    return res.status(400).json({ error: 'Valor não pode ser negativo.' });
  } else if (customValue > pkg.price) {
    return res.status(400).json({ error: `Valor (R$ ${customValue}) acima do catálogo (R$ ${pkg.price}). Desconto só pra baixo.` });
  } else {
    chargeValue = customValue;
  }
  console.log(`[admin-bookings/paymentLink] chargeValue=${chargeValue} (pkg.price=${pkg.price}, customValue=${customValue})`);

  let nb = 1;
  if (numBailarinas !== undefined && numBailarinas !== null && String(numBailarinas) !== '') {
    const parsed = Number(numBailarinas);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > pkg.maxBailarinas) {
      return res.status(400).json({ error: `Nº Bailarinas deve estar entre 1 e ${pkg.maxBailarinas} para o pacote ${pkg.name}` });
    }
    nb = parsed;
  }

  // Gateway escolhido pela Mari no painel pro link NOVO; fallback no default.
  const gw = resolveGateway((req.body as { gateway?: string }).gateway);

  try {
    // 0. Cancela link de pagamento ANTIGO no gateway antes de criar o novo.
    //    Evita cenário: Mariane gera link novo, mas cliente paga pelo link
    //    antigo (que ele já tinha no email) → webhook não acha pending →
    //    cliente paga e não confirma → Mariane gera mais um → cliente paga 2x.
    //
    //    O link antigo pode ser de gateway DIFERENTE do novo (ex: regerar um
    //    link ASAAS como MP) — detecta pelo formato do ID, não pelo gw novo.
    //    Best-effort: erro não bloqueia (link antigo já pode estar expirado/inválido).
    //    "admin-{tipo}-{ts}" não vai pra gateway (são confirmações manuais).
    if (oldStripeSession && !oldStripeSession.startsWith('admin-')) {
      const oldGateway = detectGatewayFromId(oldStripeSession);
      if (oldGateway === 'asaas') {
        try {
          await cancelAsaasLink(oldStripeSession);
          console.log(`[handlePaymentLink] cancelled old ASAAS link ${oldStripeSession}`);
        } catch (e) {
          console.warn(`[handlePaymentLink] failed to cancel old ASAAS link (best-effort): ${e instanceof Error ? e.message : e}`);
        }
      } else if (oldGateway === 'mp') {
        // MP preference não é deletável, só pode ter expiration alterada.
        // Força expiration retroativa (1 min atrás) — efetivamente invalida.
        try {
          await fetch(`https://api.mercadopago.com/checkout/preferences/${oldStripeSession}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MP_TOKEN}` },
            body: JSON.stringify({
              expires:            true,
              expiration_date_to: new Date(Date.now() - 60 * 1000).toISOString(),
            }),
          });
          console.log(`[handlePaymentLink] expired old MP preference ${oldStripeSession}`);
        } catch (e) {
          console.warn(`[handlePaymentLink] failed to expire old MP preference (best-effort): ${e instanceof Error ? e.message : e}`);
        }
      }
    }

    // 1. Cria link de pagamento — gateway escolhido pela Mari (gw).
    //    Em ambos os casos guardamos `externalId` no Sheets (campo legado
    //    `stripeSession`) que o webhook usa pra parear o pagamento.
    let url:        string;
    let externalId: string;

    if (gw === 'asaas') {
      const checkout = await createAsaasCheckoutAdmin({
        itemName:          `Pacote ${pkg.name}`,   // ASAAS limita item.name a 30 chars
        itemDescription:   `${date.split('-').reverse().join('/')} às ${time} · ${pkg.duration} min · ${nb} ${nb === 1 ? 'bailarina' : 'bailarinas'}`,
        value:             chargeValue,
        externalReference: encodeAsaasRefAdmin({ date, time, packageKey, numBailarinas: nb, name, email, whatsapp }),
        successUrl:        `${SITE_URL}/agendamento/sucesso`,
        cancelUrl:         `${SITE_URL}/agendamento?cancelado=1`,
      });
      url        = checkout.link;
      externalId = checkout.id;
    } else {
      const expiry = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      const prefRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MP_TOKEN}` },
        body: JSON.stringify({
          items: [{
            title:       `Ensaio Fotográfico em Joinville — Pacote ${pkg.name}`,
            description: `${date.split('-').reverse().join('/')} às ${time} · ${pkg.duration} min`,
            quantity:    1,
            unit_price:  chargeValue,
            currency_id: 'BRL',
          }],
          payer: { email },
          back_urls: {
            success: `${SITE_URL}/agendamento/sucesso`,
            failure: `${SITE_URL}/agendamento?cancelado=1`,
            pending: `${SITE_URL}/agendamento/sucesso`,
          },
          auto_return:        'approved',
          payment_methods:    { installments: 6 },
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
      url        = pref.init_point;
      externalId = pref.id;
    }

    // 2. Cancela pending antigo
    await fetch(SCRIPT_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'cancelBooking',
        bookingId,
        reason: 'Novo link de pagamento gerado pelo admin',
      }),
    }).catch(e => console.error('[admin-bookings/paymentLink] cancel error', e));

    // 3. Cria novo pending com nova preference/paymentLink (webhook confirma via esse ID).
    //    Se falhar, rollback do link novo pra evitar pagamento órfão.
    try {
      const pendingRes = await fetch(SCRIPT_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'createPending',
          date, start: time, packageKey,
          name, email, whatsapp,
          instagram:          instagram || '',
          instagramBailarina: instagramBailarina || '',
          nomeBailarina:      nomeBailarina || '',
          numBailarinas:      nb,
          stripeSession:      externalId,    // MP preferenceId OR ASAAS checkout id
          gateway:            gw,
          source:             'admin',
          customValue:        chargeValue,   // preserva desconto admin no novo pending
        }),
      });
      if (!pendingRes.ok) throw new Error(`Sheets HTTP ${pendingRes.status}`);
    } catch (pendingErr) {
      const errMsg = pendingErr instanceof Error ? pendingErr.message : String(pendingErr);
      console.error(`[admin-bookings/paymentLink] createPending FAILED — rollback novo link: ${errMsg}`);
      if (gw === 'asaas' && externalId) {
        await cancelAsaasLink(externalId)
          .catch(e => console.error('[admin-bookings/paymentLink] rollback ASAAS falhou:', e instanceof Error ? e.message : e));
      } else if (gw === 'mp' && externalId) {
        await fetch(`https://api.mercadopago.com/checkout/preferences/${externalId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MP_TOKEN}` },
          body: JSON.stringify({
            expires:            true,
            expiration_date_to: new Date(Date.now() - 60 * 1000).toISOString(),
          }),
        }).catch(e => console.error('[admin-bookings/paymentLink] rollback MP falhou:', e instanceof Error ? e.message : e));
      }
      throw new Error('Erro ao recriar pending. Novo link foi cancelado — tente novamente.');
    }

    // 4. Log
    await fetch(SCRIPT_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action:  'addLog',
        message: `${auth.user} gerou novo link de pagamento (${gw}) para ${name} (${date} ${time})`,
        origin:  'painel',
      }),
    }).catch(() => {});

    return res.status(200).json({ url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[admin-bookings/paymentLink]', msg);
    return res.status(500).json({ error: msg });
  }
}

async function handleReschedule(req: VercelRequest, res: VercelResponse, auth: { user: string }) {
  const PACKAGES = getPackages();
  const { bookingId, name, email, whatsapp, oldDate, oldTime, newDate, newTime, packageKey, numBailarinas } = req.body as {
    bookingId: string; name: string; email: string; whatsapp: string;
    oldDate: string; oldTime: string; newDate: string; newTime: string;
    numBailarinas?: number; packageKey: string;
  };

  if (!bookingId || !newDate || !newTime || !packageKey) {
    return res.status(400).json({ error: 'Campos obrigatórios faltando' });
  }

  const pkg = PACKAGES[packageKey as PkgKey];
  if (!pkg) return res.status(400).json({ error: 'Pacote inválido' });

  const endTime   = calcEnd(newTime, pkg.duration);
  const sessionId = `admin-rescheduled-${Date.now()}`;

  // 1. Cancela antigo
  try {
    await fetch(SCRIPT_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'cancelBooking', bookingId, reason: 'Remarcado pelo admin' }),
    });
  } catch (e) {
    console.error('[admin-bookings/reschedule] cancelBooking error', e);
    return res.status(500).json({ error: 'Erro ao cancelar agendamento antigo' });
  }

  // 2. Cria novo pending + confirma imediatamente
  let newBookingId = '';
  try {
    await fetch(SCRIPT_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'createPending',
        date: newDate, start: newTime, packageKey,
        name, email, whatsapp,
        stripeSession: sessionId,
        source:        'admin',
      }),
    });

    const r = await fetch(SCRIPT_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action:        'confirmBooking',
        stripeSession: sessionId,
        stripePayment: `admin-reschedule-${bookingId}`,
      }),
    });
    const json = await r.json();
    newBookingId = json.bookingId || '';
  } catch (e) {
    console.error('[admin-bookings/reschedule] create/confirm error', e);
    return res.status(500).json({ error: 'Erro ao criar novo agendamento' });
  }

  // 3. Log
  const logMsg = `${auth.user} remarcou ensaio de ${name}: ${fmtDate(oldDate)} ${oldTime} → ${fmtDate(newDate)} ${newTime} (${pkg.name})`;
  await fetch(SCRIPT_URL, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'addLog', message: logMsg, origin: 'painel' }),
  }).catch(e => console.error('[admin-bookings/reschedule] addLog error', e));

  // 4. Email
  if (email) {
    const html = buildBookingEmailHtml({
      name,
      date:    newDate,
      time:    newTime,
      endTime,
      packageName:   pkg.name,
      duration:      pkg.duration,
      price:         (pkg.price || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      bookingId:     newBookingId,
      numBailarinas: Number(numBailarinas) || 1,
    }, 'rescheduled');

    await Promise.allSettled([
      resend.emails.send({
        from:    'Ensaio Joinville <confirmacao@ensaiofotograficoemjoinville.com>',
        to:      email,
        subject: `Ensaio remarcado — ${fmtDate(newDate)} às ${newTime}`,
        html,
      }),
      resend.emails.send({
        from:    'Ensaio Joinville <confirmacao@ensaiofotograficoemjoinville.com>',
        to:      ANDRE_EMAIL,
        subject: `[Admin] Remarcação: ${name} → ${fmtDate(newDate)} ${newTime}`,
        html:    `<p>${logMsg}</p>`,
      }),
    ]);
  }

  return res.status(200).json({ ok: true, newBookingId });
}

/**
 * Multi-pagador: regenera UMA das sessions do split (sem mexer nas outras).
 * Mari clica "Regerar link do pagador X" → cancela o link antigo no gateway
 * + cria novo com mesmo valor + atualiza ID na Sheet via regenerateSplitLink.
 *
 * Falha se a session antiga já estava paga (validado também no Apps Script).
 */
async function handleRegenerateSplitLink(req: VercelRequest, res: VercelResponse, auth: { user: string }) {
  const { bookingId, oldStripeSession, gateway, partValue,
          date, time, packageKey, numBailarinas, name, email, whatsapp, payerName } = req.body as {
    bookingId: string; oldStripeSession: string;
    gateway?: 'mp' | 'asaas'; partValue: number;
    date: string; time: string; packageKey: PkgKey; numBailarinas?: number;
    name: string; email: string; whatsapp?: string;
    payerName?: string;   // nome do pagador desse link (pra carregar no item)
  };

  if (!bookingId || !oldStripeSession || !date || !time || !packageKey || !name || !email) {
    return res.status(400).json({ error: 'Campos obrigatórios faltando' });
  }
  if (typeof partValue !== 'number' || !isFinite(partValue) || partValue <= 0) {
    return res.status(400).json({ error: 'partValue inválido' });
  }

  const PACKAGES = getPackages();
  const pkg = PACKAGES[packageKey];
  if (!pkg) return res.status(400).json({ error: 'Pacote inválido' });

  const nb = Number(numBailarinas) || 1;
  const gw = resolveGateway(gateway);

  try {
    // 1. Cancela o link antigo no gateway (best-effort; pode já estar expirado).
    //    "admin-{tipo}-{ts}" não vai pra gateway (são confirmações manuais).
    if (!oldStripeSession.startsWith('admin-')) {
      const oldGateway = detectGatewayFromId(oldStripeSession);
      if (oldGateway === 'asaas') {
        try { await cancelAsaasLink(oldStripeSession); }
        catch (e) { console.warn('[regenerateSplitLink] cancel ASAAS antigo falhou:', e instanceof Error ? e.message : e); }
      } else if (oldGateway === 'mp') {
        try {
          await fetch(`https://api.mercadopago.com/checkout/preferences/${oldStripeSession}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MP_TOKEN}` },
            body: JSON.stringify({
              expires:            true,
              expiration_date_to: new Date(Date.now() - 60 * 1000).toISOString(),
            }),
          });
        } catch (e) { console.warn('[regenerateSplitLink] expire MP antigo falhou:', e instanceof Error ? e.message : e); }
      }
    }

    // 2. Cria novo link no gateway escolhido pela Mari (default: ASAAS).
    let newUrl: string;
    let newId:  string;
    const pName    = (payerName || '').trim();
    const dateLbl  = `${date.split('-').reverse().join('/')} às ${time}`;
    if (gw === 'asaas') {
      const asaasItemName = pName
        ? `${pkg.name}: ${pName}`.slice(0, 30)
        : `Pacote ${pkg.name}`.slice(0, 30);
      const checkout = await createAsaasCheckoutAdmin({
        itemName:          asaasItemName,
        itemDescription:   `${dateLbl} · ${pkg.duration} min · ${nb} ${nb === 1 ? 'bailarina' : 'bailarinas'}${pName ? ` · ${pName}` : ''} (link regerado)`,
        value:             partValue,
        externalReference: encodeAsaasRefAdmin({ date, time, packageKey, numBailarinas: nb, name, email, whatsapp: whatsapp || '' }),
        successUrl:        `${SITE_URL}/agendamento/sucesso`,
        cancelUrl:         `${SITE_URL}/agendamento?cancelado=1`,
      });
      newUrl = checkout.link;
      newId  = checkout.id;
    } else {
      const expiry = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      const prefRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MP_TOKEN}` },
        body: JSON.stringify({
          items: [{
            title:       pName ? `Ensaio Joinville — ${pkg.name} · ${pName}` : `Ensaio Joinville — ${pkg.name} (link regerado)`,
            description: `${dateLbl} · ${pkg.duration} min`,
            quantity:    1,
            unit_price:  partValue,
            currency_id: 'BRL',
          }],
          payer: { email },
          back_urls: {
            success: `${SITE_URL}/agendamento/sucesso`,
            failure: `${SITE_URL}/agendamento?cancelado=1`,
            pending: `${SITE_URL}/agendamento/sucesso`,
          },
          auto_return:        'approved',
          payment_methods:    { installments: 6 },
          external_reference: JSON.stringify({ date, time, packageKey, name, email, whatsapp: whatsapp || '' }),
          notification_url:   `${SITE_URL}/api/webhook`,
          expires:              true,
          expiration_date_to:   expiry,
        }),
      });
      const pref = await prefRes.json() as { id?: string; init_point?: string; message?: string };
      if (!pref.id || !pref.init_point) throw new Error(pref.message || 'Erro ao criar preferência MP');
      newUrl = pref.init_point;
      newId  = pref.id;
    }

    // 3. Atualiza Sheet — substitui oldId pelo newId na coluna "Stripe Session"
    try {
      const updRes = await fetch(SCRIPT_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action:           'regenerateSplitLink',
          bookingId,
          oldStripeSession,
          newStripeSession: newId,
        }),
      });
      if (!updRes.ok) throw new Error(`Sheets HTTP ${updRes.status}`);
      const updJson = await updRes.json() as { error?: string };
      if (updJson.error) throw new Error(updJson.error);
    } catch (updErr) {
      const errMsg = updErr instanceof Error ? updErr.message : String(updErr);
      console.error('[regenerateSplitLink] update sheet FAILED — rollback novo link:', errMsg);
      if (gw === 'asaas') {
        await cancelAsaasLink(newId).catch(() => {});
      } else {
        await fetch(`https://api.mercadopago.com/checkout/preferences/${newId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MP_TOKEN}` },
          body: JSON.stringify({
            expires:            true,
            expiration_date_to: new Date(Date.now() - 60 * 1000).toISOString(),
          }),
        }).catch(() => {});
      }
      throw new Error('Erro ao atualizar Sheet. Link novo cancelado — tente de novo.');
    }

    await fetch(SCRIPT_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action:  'addLog',
        message: `${auth.user} regerou link individual de ${name} (${bookingId}) — gateway ${gw}, R$ ${partValue.toFixed(2)}`,
        origin:  'painel',
      }),
    }).catch(() => {});

    return res.status(200).json({ url: newUrl, sessionId: newId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[regenerateSplitLink]', msg);
    return res.status(500).json({ error: msg });
  }
}

async function handleResendConfirmation(req: VercelRequest, res: VercelResponse) {
  const body = req.body as { bookingId?: string; extraCc?: string };
  if (!body.bookingId) return res.status(400).json({ error: 'bookingId obrigatório' });
  const r = await fetch(SCRIPT_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({
      action:    'resendConfirmation',
      bookingId: body.bookingId,
      extraCc:   body.extraCc || '',
    }),
  });
  const json = await r.json();
  if (json && json.error) return res.status(400).json(json);
  return res.status(200).json(json);
}

/* ───────── handler principal ───────── */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = verifyToken(req.headers.authorization as string | undefined);
  if (!auth) return res.status(401).json({ error: 'Não autorizado' });

  // ── GA4 endpoints (GET ?endpoint=ga4-xxx) ──
  const endpoint = String(req.query.endpoint || '');
  if (endpoint === 'ga4-dashboard') {
    if (req.query.ping) return res.status(200).json({ ok: true, user: auth.user });
    try {
      return await handleGa4Dashboard(req, res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[admin-bookings/ga4-dashboard]', msg);
      return res.status(500).json({ error: msg });
    }
  }
  if (endpoint === 'ga4-acquisition') {
    try {
      return await handleGa4Acquisition(req, res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[admin-bookings/ga4-acquisition]', msg);
      return res.status(500).json({ error: msg });
    }
  }
  if (endpoint === 'ga4-funnel') {
    try {
      return await handleGa4Funnel(req, res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[admin-bookings/ga4-funnel]', msg);
      return res.status(500).json({ error: msg });
    }
  }
  if (endpoint === 'ga4-engagement') {
    try {
      return await handleGa4Engagement(req, res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[admin-bookings/ga4-engagement]', msg);
      return res.status(500).json({ error: msg });
    }
  }
  if (endpoint === 'ga4-behavior') {
    try {
      return await handleGa4Behavior(req, res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[admin-bookings/ga4-behavior]', msg);
      return res.status(500).json({ error: msg });
    }
  }
  if (endpoint === 'meta-ads') {
    try {
      return await handleMetaAds(req, res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[admin-bookings/meta-ads]', msg);
      return res.status(500).json({ error: msg });
    }
  }
  if (endpoint === 'economics') {
    try {
      return await handleEconomics(req, res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[admin-bookings/economics]', msg);
      return res.status(500).json({ error: msg });
    }
  }
  if (endpoint === 'clarity-insights') {
    try {
      return await handleClarityInsights(req, res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[admin-bookings/clarity-insights]', msg);
      return res.status(500).json({ error: msg });
    }
  }
  if (endpoint === 'geo-brazil') {
    try {
      return await handleGeoBrazil(req, res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[admin-bookings/geo-brazil]', msg);
      return res.status(500).json({ error: msg });
    }
  }
  if (endpoint === 'sheets-ping') {
    try {
      return await handleSheetsPing(req, res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[admin-bookings/sheets-ping]', msg);
      return res.status(500).json({ error: msg });
    }
  }
  if (endpoint === 'sheets-bookings') {
    try {
      return await handleSheetsBookings(req, res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[admin-bookings/sheets-bookings]', msg);
      return res.status(500).json({ error: msg });
    }
  }
  if (endpoint === 'sheets-leads') {
    try {
      return await handleSheetsLeads(req, res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[admin-bookings/sheets-leads]', msg);
      return res.status(500).json({ error: msg });
    }
  }

  // ── POST: roteador por body.action ──
  if (req.method === 'POST') {
    try {
      const body = req.body as { action?: string };
      switch (body?.action) {
        case 'cancel':             return await handleCancel(req, res, auth);
        case 'confirm':            return await handleConfirm(req, res, auth);
        case 'create':             return await handleCreate(req, res, auth);
        case 'edit':               return await handleEdit(req, res, auth);
        case 'paymentLink':        return await handlePaymentLink(req, res, auth);
        case 'regenerateSplitLink': return await handleRegenerateSplitLink(req, res, auth);
        case 'reschedule':         return await handleReschedule(req, res, auth);
        case 'resendConfirmation': return await handleResendConfirmation(req, res);
        default:                   return res.status(400).json({ error: 'Ação desconhecida' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[admin-bookings] POST', msg);
      return res.status(500).json({ error: msg });
    }
  }

  if (req.method !== 'GET') return res.status(405).end();

  // ── GET default: lista de bookings ──
  try {
    const url  = `${SCRIPT_URL}?action=bookings&t=${Date.now()}`;
    const r    = await fetch(url, { cache: 'no-store' });
    const json = await r.json();
    return res.status(200).json(json);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
}
