import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';
import { createHmac } from 'crypto';

// ─── ASAAS decoder (inlined) ───────────────────────────────────
// Decodifica o externalReference compacto (formato `v1|...`) que veio do
// paymentLink criado em create-checkout. Inlined porque o Vercel serverless
// bundler não inclui módulos `_*.ts` (mesmo padrão do _adminAuth.ts órfão).
function decodeAsaasRef(raw: string): {
  date: string; time: string; packageKey: string; numBailarinas: number;
  name: string; email: string; whatsapp: string;
} {
  const packageMap: Record<string, string> = { l: 'lembranca', e: 'economico', c: 'completo' };
  if (raw.startsWith('v1|')) {
    const parts = raw.split('|'); // ['v1', date, time, p, b, w, n, e]
    return {
      date:          parts[1] || '',
      time:          parts[2] || '',
      packageKey:    packageMap[parts[3] || ''] || parts[3] || '',
      numBailarinas: Number(parts[4]) || 1,
      whatsapp:      parts[5] || '',
      name:          parts[6] || '',
      email:         parts[7] || '',
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let p: any = {};
  try { p = JSON.parse(raw || '{}'); } catch { /* corrupto */ }
  return {
    date:          p.date || p.d || '',
    time:          p.time || p.t || '',
    packageKey:    p.packageKey || packageMap[p.p || ''] || p.p || '',
    numBailarinas: Number(p.numBailarinas ?? p.b) || 1,
    name:          p.name || p.n || '',
    email:         p.email || p.e || '',
    whatsapp:      p.whatsapp || p.w || '',
  };
}
// ─── fim ASAAS decoder ─────────────────────────────────────────



const LOTE1_START_MS = new Date('2026-05-16T00:00:00-03:00').getTime();
const LOTE2_START_MS = new Date('2026-06-01T00:00:00-03:00').getTime();
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

function fmtDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

// Template de email (inline; antes era módulo compartilhado mas Vercel
// não estava bundlando da pasta lib/).
const HERO_IMG_URL = 'https://www.ensaiofotograficoemjoinville.com/email-hero.jpg';
const MONTHS_PT = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const DAYS_PT   = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];

function fmtDateLong(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return `${String(d).padStart(2, '0')} de ${MONTHS_PT[m - 1]} de ${y} · ${DAYS_PT[dt.getUTCDay()]}`;
}

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

const MP_TOKEN          = process.env.MERCADOPAGO_ACCESS_TOKEN!;
const SCRIPT_URL        = process.env.SHEETS_SCRIPT_URL!;
const ASAAS_WEBHOOK_TOK = process.env.ASAAS_WEBHOOK_TOKEN || '';
// API key do ASAAS (mesma env que o admin-bookings usa) — permite verificar o
// pagamento direto na API em vez de depender só do token do header do webhook.
const ASAAS_API_KEY = process.env.ASAAS_API_KEY || '';
const ASAAS_BASE    = (process.env.ASAAS_ENV || 'production').toLowerCase() === 'sandbox'
  ? 'https://api-sandbox.asaas.com/v3'
  : 'https://api.asaas.com/v3';
const ANDRE_EMAIL   = 'andreffotografia@gmail.com';
const MARIANE_EMAIL = 'mariane.sslourenco@gmail.com';
const FROM_EMAIL    = 'Ensaio Joinville <confirmacao@ensaiofotograficoemjoinville.com>';

const resend = new Resend(process.env.RESEND_API_KEY!);

// ── Especial (multi-pagador): link do grupo + e-mails por pagador ──────────
// INLINE (não importar de _*.ts — o bundler da Vercel não inclui). especialToken
// e o builder abaixo são cópias em sincronia com api/admin-bookings.ts / especial.ts.
const SITE_URL = process.env.SITE_URL || 'https://www.ensaiofotograficoemjoinville.com';
const ESP_SECRET = process.env.ADMIN_SECRET || 'dev-secret-change-me';
function especialToken(id: string): string {
  return createHmac('sha256', ESP_SECRET).update('especial:' + id).digest('hex').slice(0, 24);
}
const ESPECIAL_VARIANT = {
  partPaid:     { tag: 'Pagamento confirmado', color: '#0f7b3f', partLabel: 'Sua parte (paga)',
                  intro: 'Recebemos o seu pagamento — a sua parte no ensaio está confirmada! Assim que todos do grupo pagarem, o ensaio é confirmado e você recebe a confirmação final.' },
  allConfirmed: { tag: 'Ensaio confirmado', color: '#0f7b3f', partLabel: 'Sua parte',
                  intro: 'Todos os pagadores do grupo concluíram o pagamento — o ensaio está confirmado! Nos vemos no dia. 💜' },
};
function buildEspecialEmailHtml(variant: 'partPaid' | 'allConfirmed', d: {
  payerName: string; date: string; time: string; endTime: string; duration: number;
  numBailarinas: number; partValue: string; groupUrl?: string; bookingId: string;
}): string {
  const cfg = ESPECIAL_VARIANT[variant];
  const firstName = String(d.payerName || '').trim().split(/\s+/)[0] || 'você';
  const row = (label: string, value: string) =>
    `<tr><td style="padding:16px 0;border-bottom:1px solid #eee;"><p style="margin:0 0 4px;font-family:Georgia,serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">${label}</p><p style="margin:0;font-family:Georgia,serif;font-size:16px;color:#1a1a1a;">${value}</p></td></tr>`;
  const groupRow = d.groupUrl
    ? `<tr><td style="padding:8px 40px 28px;text-align:center;border-top:1px solid #eee;"><p style="margin:0 0 8px;font-family:Georgia,serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">Página do grupo</p><p style="margin:0;"><a href="${d.groupUrl}" style="color:#7a3f8f;text-decoration:none;font-size:13px;word-break:break-all;">${d.groupUrl}</a></p></td></tr>`
    : '';
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${cfg.tag}</title></head>
<body style="margin:0;padding:0;background:#f5f0fa;font-family:Georgia,'Cormorant Garamond','Times New Roman',serif;color:#1a1a1a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f0fa;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:6px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
<tr><td style="line-height:0;"><img src="${HERO_IMG_URL}" alt="" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;"></td></tr>
<tr><td style="padding:36px 40px 0;text-align:center;"><span style="display:inline-block;font-family:Georgia,'Times New Roman',serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${cfg.color};border:1px solid #e8d8f0;border-radius:30px;padding:6px 16px;">${cfg.tag}</span></td></tr>
<tr><td style="padding:24px 40px 4px;text-align:center;"><p style="margin:0;font-family:Georgia,'Cormorant Garamond',serif;font-size:30px;line-height:1.2;color:#1a1a1a;font-weight:400;font-style:italic;">Olá, <strong style="font-weight:600;">${firstName}</strong>.</p></td></tr>
<tr><td style="padding:18px 56px 28px;text-align:center;"><p style="margin:0;font-family:Georgia,serif;font-size:14px;line-height:1.65;color:#555;">${cfg.intro}</p></td></tr>
<tr><td style="padding:0 40px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #eee;">
${row('Data', fmtDateLong(d.date))}
${row('Horário', `${d.time} — ${d.endTime}`)}
${row('Duração', `${d.duration} minutos`)}
${row('Grupo', `${d.numBailarinas} ${d.numBailarinas === 1 ? 'bailarina' : 'bailarinas'}`)}
${d.partValue ? `<tr><td style="padding:16px 0;"><p style="margin:0 0 4px;font-family:Georgia,serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">${cfg.partLabel}</p><p style="margin:0;font-family:Georgia,serif;font-size:18px;color:#7a3f8f;font-weight:600;">R$ ${d.partValue}</p></td></tr>` : ''}
</table></td></tr>
${groupRow}
<tr><td style="padding:28px 40px 24px;text-align:center;border-top:1px solid #eee;"><p style="margin:0;font-family:Georgia,serif;font-size:13px;line-height:1.6;color:#666;">Dúvidas? Fale com a gente pelo</p><p style="margin:6px 0 0;"><a href="https://wa.me/5511519606272" style="color:#128C7E;text-decoration:none;font-weight:600;white-space:nowrap;">WhatsApp (11) 5196-0627</a></p></td></tr>
<tr><td style="padding:0 40px 24px;text-align:center;"><p style="margin:0;font-family:Georgia,serif;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#bbb;">Código do ensaio · <span style="color:#777;font-family:monospace;letter-spacing:1px;">${d.bookingId}</span></p></td></tr>
<tr><td style="padding:20px 40px 28px;text-align:center;background:#fafafa;border-top:1px solid #eee;"><p style="margin:0;font-family:Georgia,serif;font-size:12px;color:#999;">© 2026 André Ferreira Fotografia</p><p style="margin:4px 0 0;font-family:Georgia,serif;font-size:12px;"><a href="https://www.instagram.com/affotografia" style="color:#7a3f8f;text-decoration:none;">@affotografia</a></p></td></tr>
</table></td></tr></table></body></html>`;
}
// Envia e-mails do Especial em série (Resend 2/s) com BCC André+Mari. Não lança.
async function sendEspecialEmails(sends: Array<{ to: string; subject: string; html: string }>): Promise<void> {
  for (const s of sends) {
    if (!s.to) continue;
    try {
      const { error } = await resend.emails.send({
        from: FROM_EMAIL, to: s.to, bcc: [ANDRE_EMAIL, MARIANE_EMAIL], subject: s.subject, html: s.html,
      });
      if (error) console.error('[webhook] Resend especial error', s.to, error);
    } catch (e) { console.error('[webhook] Resend especial throw', s.to, e); }
    await new Promise(r => setTimeout(r, 550));
  }
}

// Throttle de alertas operacionais (por instância warm): evita email-bomb —
// um atacante anônimo num endpoint público não pode transformar cada request
// num email pro André. 1 alerta por tipo a cada 15min é suficiente pra
// diagnóstico; o resto fica nos logs da Vercel.
const ALERT_THROTTLE_MS = 15 * 60 * 1000;
const lastAlertAt: Record<string, number> = {};
function alertAllowed(kind: string): boolean {
  const now = Date.now();
  if (now - (lastAlertAt[kind] || 0) < ALERT_THROTTLE_MS) return false;
  lastAlertAt[kind] = now;
  return true;
}

// ─── Tipo unificado pós-normalização ───────────────────────────
// Independente do gateway, mapeamos para essa forma antes de continuar.
type NormalizedPayment = {
  gateway:        'mp' | 'asaas';
  externalSlotId: string;          // pareia com o `stripeSession` no Sheets
  paymentId:      string;          // ID interno do gateway (pra log)
  externalRef:    string;          // JSON com meta do booking
  installments:   number;
  billingType?:   string;          // PIX | CREDIT_CARD | BOLETO | UNDEFINED (ASAAS); ausente em MP
  amount:         number;          // valor desse pagamento específico em REAIS
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const PACKAGES = getPackages();
  // GET é aceito porque a IPN do MP pode chegar via GET (e o "simular" do painel).
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).end();

  // Detecta o gateway pelo formato do payload:
  //  - ASAAS                 → body JSON `{ event, payment }`
  //  - MP "Webhook" (painel) → body JSON `{ type: 'payment', data: { id } }`
  //  - MP "IPN" (disparada pelo notification_url da preference) → query string
  //    `?topic=payment&id=123` (às vezes `?type=payment&data.id=123`), body vazio.
  //    Antes só tratávamos o formato Webhook → as IPN do MP caíam em "payload
  //    desconhecido" e o pagamento NUNCA confirmava sozinho (reserva ficava
  //    pending → 30min → confirmação manual). Agora tratamos os dois.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = req.body as any;
  const q = (req.query || {}) as Record<string, string | string[]>;
  const qStr = (k: string): string => {
    const v = q[k];
    return Array.isArray(v) ? String(v[0] ?? '') : (v != null ? String(v) : '');
  };
  const mpTopic   = qStr('topic') || qStr('type');
  const mpQueryId = qStr('id') || qStr('data.id');
  const isAsaas   = typeof body?.event === 'string' && body?.payment;
  const isMp      = body?.type === 'payment' || (mpTopic === 'payment' && !!mpQueryId);

  let normalized: NormalizedPayment;

  if (isAsaas) {
    const evt = body.event as string;
    // Payload bruto do webhook — espelha o GET /v3/payments/{id} (doc ASAAS),
    // mas sozinho NÃO é fonte de verdade: quem conhece a URL pode forjá-lo.
    const payloadPay = (body.payment || {}) as {
      id?: string; status?: string; paymentLink?: string; checkoutSession?: string;
      externalReference?: string; installmentCount?: number; billingType?: string;
      value?: number;
    };

    // Apenas eventos definitivos de confirmação avançam o fluxo:
    //  - PAYMENT_CONFIRMED → cartão capturado (PIX NÃO passa por esse evento)
    //  - PAYMENT_RECEIVED  → PIX/boleto pago (e cartão na liquidação, D+32)
    // Outros eventos (CREATED, AUTHORIZED, OVERDUE…) são apenas reconhecidos.
    if (evt !== 'PAYMENT_CONFIRMED' && evt !== 'PAYMENT_RECEIVED') {
      return res.status(200).json({ received: true, event: evt, status: payloadPay?.status });
    }

    const paymentId = String(payloadPay.id || '');
    // IDs ASAAS são curtos e alfanuméricos (ex.: pay_080225913252). Validar o
    // formato AQUI bloqueia injeção de HTML em emails/logs e payloads-lixo
    // antes de gastar qualquer chamada à API.
    if (!paymentId || !/^[A-Za-z0-9_-]{1,64}$/.test(paymentId)) {
      console.warn('[webhook] ASAAS event com payment.id ausente/inválido — ignorando');
      return res.status(200).json({ received: true, ignored: true, reason: 'missing or invalid payment id' });
    }

    // ── Verificação robusta: a fonte da verdade é a API do ASAAS ──
    // Antes, o header asaas-access-token PRECISAVA bater com ASAAS_WEBHOOK_TOKEN,
    // senão 401 — e com o token divergido TODA confirmação era rejeitada (e após
    // 15 falhas consecutivas a ASAAS interrompe a fila e para de enviar).
    // Agora o token é só um sinal: o pagamento é re-buscado na API do ASAAS com
    // a nossa API key. Payload forjado não confirma nada — status e
    // checkoutSession/paymentLink saem da API, não do payload (id aleatório → 404).
    const gotTok  = String(req.headers['asaas-access-token'] || '');
    const tokenOk = !!ASAAS_WEBHOOK_TOK && gotTok === ASAAS_WEBHOOK_TOK;
    if (!tokenOk) {
      console.warn(`[webhook] ASAAS token ${ASAAS_WEBHOOK_TOK ? 'mismatch' : 'não configurado no servidor'} — validando via API`);
    }

    type AsaasPayment = {
      id?: string; status?: string; value?: number; billingType?: string;
      checkoutSession?: string | null; paymentLink?: string | null;
      externalReference?: string | null; installmentNumber?: number;
    };
    // verified = objeto veio da API · not_found = 404 (forjado ou ASAAS_ENV errado)
    // unavailable = API fora do ar / sem API key (token decide o fallback abaixo)
    let apiPay: AsaasPayment | null = null;
    let apiState: 'verified' | 'not_found' | 'unavailable' = 'unavailable';
    let lastVerifyError = ASAAS_API_KEY ? '' : 'ASAAS_API_KEY ausente';
    if (ASAAS_API_KEY) {
      // 2 tentativas com timeout curto: sem AbortSignal, uma API pendurada
      // estouraria o budget da função → não-200 → conta pras 15 falhas que
      // interrompem a fila da ASAAS (o incidente original, de novo).
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const r = await fetch(`${ASAAS_BASE}/payments/${encodeURIComponent(paymentId)}`, {
            headers: { access_token: ASAAS_API_KEY, 'User-Agent': 'J26-EnsaioJoinville-Webhook/1.0' },
            signal:  AbortSignal.timeout(3000),
          });
          if (r.status === 404) { apiState = 'not_found'; break; }
          if (r.status >= 400 && r.status < 500) {
            // 4xx determinístico (401/403 key errada, 429 rate-limit): retry
            // imediato não resolve e só amplifica custo — registra e sai.
            lastVerifyError = `HTTP ${r.status}`;
            break;
          }
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          apiPay   = await r.json() as AsaasPayment;
          apiState = 'verified';
          lastVerifyError = '';
          break;
        } catch (e) {
          lastVerifyError = e instanceof Error ? e.message : String(e);
          console.error(`[webhook] ASAAS API verify ${attempt}/2 falhou:`, lastVerifyError);
          if (attempt < 2) await new Promise(r => setTimeout(r, 400));
        }
      }
    } else {
      console.error('[webhook] ASAAS_API_KEY ausente — sem verificação via API');
    }

    if (apiState === 'not_found') {
      // Payment não existe nessa conta/ambiente: payload forjado OU ASAAS_ENV/
      // ASAAS_API_KEY apontando pra conta/ambiente errado. Não confirma nada.
      console.warn(`[webhook] ASAAS payment ${paymentId} não existe na API (tokenOk=${tokenOk}) — ignorando`);
      if (tokenOk && alertAllowed('not_found_authentic')) {
        // Token bateu → o evento É da ASAAS, então o 404 é problema NOSSO de
        // config — sem alerta isso viraria perda silenciosa de TODA confirmação.
        const { error } = await resend.emails.send({
          from: FROM_EMAIL, to: ANDRE_EMAIL,
          subject: `⚠️ Webhook ASAAS autêntico mas payment ${paymentId} não existe na API`,
          html: `<p>Chegou um webhook ASAAS <strong>autenticado pelo token</strong> (evento ${evt}), mas o GET /payments/${paymentId} retornou 404. Isso indica <strong>ASAAS_ENV ou ASAAS_API_KEY apontando pra conta/ambiente errado</strong> no Vercel — enquanto isso, confirmações reais estão sendo descartadas.</p>
<p><strong>Ação:</strong> confira ASAAS_ENV (production?) e ASAAS_API_KEY no Vercel. Alertas deste tipo são limitados a 1 a cada 15min; veja os logs da Vercel pra lista completa.</p>`,
        });
        if (error) console.error('[webhook] alerta André (not_found) falhou', error);
      }
      return res.status(200).json({ received: true, ignored: true, reason: 'payment not found in ASAAS API' });
    }

    if (apiState === 'unavailable' && !tokenOk) {
      // Dupla falha: não dá pra autenticar pelo token NEM verificar na API.
      // 200 (não 5xx) pra não derrubar a fila da ASAAS; o lembrete de 30min é o
      // backstop natural se essa confirmação se perder. Alerta o André por email
      // — com throttle, porque este caminho é alcançável por request forjado
      // (paymentId já passou na validação de formato, então é seguro interpolar).
      console.error(`[webhook] ASAAS payment ${paymentId}: API indisponível (${lastVerifyError}) E token inválido — evento descartado`);
      if (alertAllowed('unverifiable')) {
        const { error } = await resend.emails.send({
          from: FROM_EMAIL, to: ANDRE_EMAIL,
          subject: `⚠️ Webhook ASAAS não verificável — payment ${paymentId}`,
          html: `<p>Chegou um webhook ASAAS (<strong>${evt}</strong>) mas a verificação na API do ASAAS falhou (<code>${lastVerifyError || 'sem detalhe'}</code>) e o token de autenticação não bate — o evento foi descartado por segurança.</p>
<p><strong>Payment ID:</strong> ${paymentId}<br>
<strong>Ação:</strong> confira o pagamento no painel ASAAS e, se estiver pago, confirme manualmente no painel admin. Se isso se repetir, confira ASAAS_API_KEY e ASAAS_WEBHOOK_TOKEN no Vercel. Alertas deste tipo são limitados a 1 a cada 15min; veja os logs da Vercel.</p>`,
        });
        if (error) console.error('[webhook] alerta André (unverifiable) falhou', error);
      }
      return res.status(200).json({ received: true, ignored: true, reason: 'unverifiable: API unavailable and token mismatch' });
    }

    // Daqui pra baixo: ou a API confirmou o pagamento (verified), ou o token
    // bateu (gateway autêntico) e a API está fora — usa o payload como fallback.
    const pay = apiState === 'verified' ? (apiPay as AsaasPayment) : payloadPay;

    if (apiState === 'verified') {
      // O status REAL na API decide — não o nome do evento (forjável).
      // CONFIRMED = cartão capturado · RECEIVED = PIX/boleto pago (cartão D+32)
      // RECEIVED_IN_CASH = baixa manual ("recebido em dinheiro") no painel ASAAS.
      const PAID = ['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'];
      if (!PAID.includes(String(pay.status || ''))) {
        console.warn(`[webhook] ASAAS payment ${paymentId} status=${pay.status} (não pago) — evento ${evt} ignorado`);
        return res.status(200).json({ received: true, status: pay.status, ignored: true });
      }
    }

    // Pareamento com o pending no Sheets (coluna stripeSession):
    //  - Checkout (atual)      → payment.checkoutSession (UUID)
    //  - Payment Link (legado) → payment.paymentLink
    // Quando verificado, vem da API — payload forjado não escolhe o booking.
    // O externalReference do payment NÃO é confiável: o Checkout não o propaga
    // pro payment (vem null) — a meta do booking vem da resposta do confirmBooking.
    const slotId = pay.checkoutSession || pay.paymentLink || '';
    if (!slotId) {
      console.error(`[webhook] ASAAS payment ${paymentId} sem checkoutSession nem paymentLink`);
      // 200 (não 400): 4xx repetido faz a ASAAS marcar o webhook como interrompido.
      return res.status(200).json({ received: true, ignored: true, reason: 'no slot id' });
    }

    // ── Vídeo5678: pedido de vídeos, não reserva — decidido DENTRO do
    // confirmBooking, mais abaixo. Não há como decidir aqui: o payment do
    // ASAAS chega sem externalReference e sem description do checkout (medido
    // em produção em 01/09/2026, ref="" desc="") e GET /v3/checkouts/{id} não
    // existe. O que sobrevive é payment.checkoutSession == checkout.id, que o
    // videos-checkout.ts grava na coluna "Booking ID" da aba Log; o Apps
    // Script casa por ele quando não acha reserva e devolve video5678:true.

    normalized = {
      gateway:        'asaas',
      externalSlotId: String(slotId),             // checkoutSession OU paymentLink
      paymentId,
      externalRef:    pay.externalReference || '',
      // A API não retorna installmentCount (só installmentNumber, nº da parcela);
      // o payload do webhook pode trazer — melhor esforço, só cosmético no email.
      installments:   Number(payloadPay.installmentCount) || 1,
      billingType:    pay.billingType,
      amount:         Number(pay.value) || 0,
    };
  } else if (isMp) {
    // Webhook → body.data.id · IPN → id na query string.
    const paymentId = body?.data?.id || mpQueryId;
    if (!paymentId) {
      // Ex.: IPN com topic=merchant_order (sem id de pagamento). Ack e ignora —
      // o MP também manda a notificação topic=payment, que traz o id certo.
      return res.status(200).json({ received: true, ignored: true, reason: 'no payment id' });
    }

    let payment: {
      status: string; preference_id: string; id: number;
      external_reference?: string; installments?: number;
      transaction_amount?: number;
    };
    try {
      const r = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${MP_TOKEN}` },
      });
      // Sem essa checagem, um 401/5xx do MP era parseado como JSON de erro,
      // status ficava undefined ≠ 'approved' e respondíamos 200 — o MP não
      // refazia o retry e o pagamento nunca confirmava sozinho.
      if (!r.ok) throw new Error(`MP API ${r.status}`);
      payment = await r.json();
    } catch (err) {
      console.error('[webhook] failed to fetch MP payment', err);
      return res.status(500).json({ error: 'Failed to fetch payment' });
    }

    if (payment.status !== 'approved') {
      return res.status(200).json({ received: true, status: payment.status });
    }

    normalized = {
      gateway:        'mp',
      externalSlotId: payment.preference_id,
      paymentId:      String(payment.id),
      externalRef:    payment.external_reference || '',
      installments:   payment.installments || 1,
      amount:         Number(payment.transaction_amount) || 0,
    };
  } else {
    // payload desconhecido — loga a FORMA (sem dados sensíveis) pra diagnóstico
    // e dá ack pra evitar retries infinitos do gateway.
    console.warn('[webhook] payload não reconhecido', JSON.stringify({
      method:    req.method,
      queryKeys: Object.keys(q),
      topic:     mpTopic || undefined,
      bodyType:  typeof body,
      bodyKeys:  body && typeof body === 'object' ? Object.keys(body).slice(0, 10) : undefined,
    }));
    return res.status(200).json({ received: true, ignored: true });
  }

  // Meta do booking (data/horário/pacote/cliente) usada nos e-mails.
  // FONTE PRIMÁRIA = resposta do confirmBooking (lê a linha da planilha, sempre
  // completa) — sobrescrita logo abaixo. O bloco a seguir é só FALLBACK caso o
  // confirmBooking falhe: aí o alerta pro André ainda tem algum dado.
  //  - MP:    external_reference é JSON canônico.
  //  - ASAAS: o Checkout NÃO propaga externalReference pro payment (vem null) —
  //           pra Checkout esse fallback fica vazio; o confirmBooking preenche.
  // `valor` é o valor PAGO em REAIS (lido da coluna 'Valor (R$)' da planilha) —
  // pode ser custom (desconto do admin) ou padrão do catálogo. Fica 0 se a meta
  // do confirmBooking não preencher; aí caímos no fallback pkg.price.
  const meta: { date: string; time: string; packageKey: string; name: string; email: string; whatsapp: string; numBailarinas: number; valor: number } = {
    date: '', time: '', packageKey: '', name: '', email: '', whatsapp: '', numBailarinas: 1, valor: 0,
  };
  if (normalized.gateway === 'asaas') {
    Object.assign(meta, decodeAsaasRef(normalized.externalRef));
  } else {
    try {
      const j = JSON.parse(normalized.externalRef || '{}') as Partial<typeof meta>;
      meta.date = j.date || ''; meta.time = j.time || ''; meta.packageKey = j.packageKey || '';
      meta.name = j.name || ''; meta.email = j.email || ''; meta.whatsapp = j.whatsapp || '';
      meta.numBailarinas = Number(j.numBailarinas) || 1;
    } catch {
      console.warn('[webhook] external_reference inválido — meta virá do confirmBooking');
    }
  }

  // 1. Confirm booking in Sheets — retry 3x + alerta crítico se falhar.
  // Cenário evitado: cliente paga, Apps Script timeout, webhook segue
  // sem confirmar → cliente recebe email "confirmado" mas Sheets fica
  // pending → cliente chega no dia sem reserva.
  let bookingId = '';
  let confirmFailed: string | null = null;
  let alreadyConfirmed = false;
  // Multi-pagador: tracks partial vs full confirm. Se este pagamento NÃO fechou
  // o split (fullyConfirmed=false), webhook segura os e-mails de "Reserva
  // confirmada" e dispara só notificação interna pra Mari (X/N pagos).
  let fullyConfirmed = true;  // default true pra compat (single-pagador sempre fecha)
  let paidCount     = 1;
  let totalSessions = 1;
  let paidPayerName = '';            // nome do pagador que acabou de pagar
  let pendingPayerNames: string[] = []; // nomes que ainda faltam pagar
  // Especial: dados p/ e-mails por pagador (sua parte confirmada / ensaio confirmado).
  let paidPayerEmail = '';
  let isEspecial     = false;
  let espEnd         = '';
  let espDuration    = 0;
  let espPayerNames:  string[] = [];
  let espPayerEmails: string[] = [];
  let espPayerValues: string[] = [];
  // ORÇAMENTO DE TEMPO. O ASAAS espera 10 s pela resposta e depois devolve 408
  // "Read timed out" (docs.asaas.com/docs/erro-read-timed-out); 15 falhas
  // consecutivas pausam a fila de webhooks. Em 01/09/2026 uma execução real
  // gastou 11,85 s — 8,0 s do timeout abaixo + 0,5 s de backoff + o resto — e
  // levou 408 mesmo tendo respondido 200: a resposta chegou tarde demais.
  // Três tentativas eram contraproducentes: o ASAAS JÁ reentrega o evento por
  // conta própria, então o retry interno não ganha nada e produz exatamente o
  // 408 que causa a reentrega. Uma tentativa curta cabe no orçamento; se o Apps
  // Script estiver lento, o alerta 🚨 abaixo avisa o André e a reentrega do
  // ASAAS tenta de novo com a função descansada.
  // 7 s: o caminho de compra de vídeo no Apps Script (varre a aba Log e grava
  // VIDEO_PAGO) mediu 2,6–5,6 s em 01/09/2026; com 4 s o webhook desistia em
  // metade dos casos. Acima disso o próprio ASAAS reentrega e o .gs é
  // idempotente — nada se perde, só o log fica mais feio.
  const CONFIRM_TENTATIVAS = 1;
  const CONFIRM_TIMEOUT_MS = 7000;
  for (let attempt = 1; attempt <= CONFIRM_TENTATIVAS; attempt++) {
    try {
      const r = await fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action:        'confirmBooking',
          stripeSession: normalized.externalSlotId,
          stripePayment: normalized.paymentId,
          gateway:       normalized.gateway,
          origin:        'webhook',   // pagamento via gateway — log mostra origem real
        }),
        // Apps Script lento não pode estourar o budget da função (não-200 pra
        // ASAAS conta pras 15 falhas que interrompem a fila).
        signal: AbortSignal.timeout(CONFIRM_TIMEOUT_MS),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json() as {
        error?: string;
        bookingId?: string; alreadyConfirmed?: boolean; fullyConfirmed?: boolean;
        paidCount?: number; totalSessions?: number;
        paidPayerName?: string; pendingPayerNames?: string[];
        date?: string; start?: string; end?: string; name?: string; email?: string;
        whatsapp?: string; package?: string; numBailarinas?: number; valor?: number;
        paidPayerEmail?: string; isEspecial?: boolean; duration?: number;
        payerNames?: string[]; payerEmails?: string[]; payerValues?: string[];
        // Vídeo5678: o .gs não achou reserva mas achou VIDEO_PEDIDO com este
        // checkout.id na aba Log — já gravou o VIDEO_PAGO (idempotente) e devolve
        // o pedido. Não é reserva: nada abaixo deste ponto se aplica.
        video5678?: boolean; galeria?: string; fotos?: string; qtd?: number;
        valorVideo?: number; teste?: boolean; alreadyPaid?: boolean;
      };
      // Apps Script devolve erros como HTTP 200 + {error} (ContentService não
      // controla o status) — ex.: 'Session não encontrada'. Sem essa checagem,
      // o fluxo seguia como sucesso com meta vazia.
      if (json.error) throw new Error(String(json.error));
      if (json.video5678) {
        // Compra de vídeo. O e-mail à Mari NÃO sai daqui: o .gs manda no mesmo
        // ponto idempotente em que grava o VIDEO_PAGO (uma vez só, mesmo se este
        // webhook estourar o timeout e o ASAAS reentregar — aí vem alreadyPaid).
        const galId = String(json.galeria || '');
        console.log(`[webhook][v5678] ${galId} ${json.qtd} vídeo(s) payment=${normalized.paymentId}${json.alreadyPaid ? ' (já pago)' : ''}`);
        return res.status(200).json({ received: true, video5678: true, galeria: galId, alreadyPaid: !!json.alreadyPaid });
      }
      bookingId        = json.bookingId || '';
      alreadyConfirmed = json.alreadyConfirmed === true;
      // fullyConfirmed undefined → assume true (compat com Apps Script antigo
      // que não retornava esse campo — sempre fechava na 1ª session).
      fullyConfirmed   = json.fullyConfirmed !== false;
      paidCount        = json.paidCount     || 1;
      totalSessions    = json.totalSessions || 1;
      paidPayerName    = json.paidPayerName || '';
      pendingPayerNames = Array.isArray(json.pendingPayerNames) ? json.pendingPayerNames : [];
      paidPayerEmail   = json.paidPayerEmail || '';
      isEspecial       = json.isEspecial === true;
      espEnd           = json.end || '';
      espDuration      = Number(json.duration) || 0;
      espPayerNames    = Array.isArray(json.payerNames)  ? json.payerNames  : [];
      espPayerEmails   = Array.isArray(json.payerEmails) ? json.payerEmails : [];
      espPayerValues   = Array.isArray(json.payerValues) ? json.payerValues : [];
      // confirmBooking lê a linha da planilha — fonte autoritativa da meta.
      // Sobrescreve o fallback (essencial pro Checkout ASAAS, que vem sem ref).
      if (json.date)          meta.date          = json.date;
      if (json.start)         meta.time          = json.start;
      if (json.package)       meta.packageKey    = json.package;
      if (json.name)          meta.name          = json.name;
      if (json.email)         meta.email         = json.email;
      if (json.whatsapp)      meta.whatsapp      = String(json.whatsapp);
      if (json.numBailarinas) meta.numBailarinas = Number(json.numBailarinas) || meta.numBailarinas;
      if (json.valor)         meta.valor         = Number(json.valor) || 0;
      confirmFailed = null;
      break;
    } catch (e) {
      confirmFailed = e instanceof Error ? e.message : String(e);
      console.error(`[webhook] confirmBooking attempt ${attempt}/${CONFIRM_TENTATIVAS} failed:`, confirmFailed);
      // Erros determinísticos do Apps Script (a linha não existe — ex.: link
      // de split regenerado, pending apagado) não mudam com retry; insistir só
      // atrasa a resposta e, no replay pós-reativação da fila, multiplica
      // chamadas e alertas.
      if (/Session não encontrada|Planilha vazia/i.test(confirmFailed)) break;
      if (attempt < CONFIRM_TENTATIVAS) await new Promise(r => setTimeout(r, 500 * attempt));
    }
  }

  // Meta consolidada — pkg/endTime calculados DEPOIS do confirmBooking sobrescrever.
  const { date, time, packageKey, name, email, whatsapp, numBailarinas, valor } = meta;
  const pkg = PACKAGES[packageKey] || { name: packageKey, duration: 0, price: 0 };
  const [sh, sm] = (time || '00:00').split(':').map(Number);
  const endMin   = sh * 60 + sm + pkg.duration;
  const endTime  = String(Math.floor(endMin / 60)).padStart(2, '0') + ':' + String(endMin % 60).padStart(2, '0');
  // priceFinal = valor PAGO (lido do Sheet via confirmBooking); fallback pro
  // catálogo se a planilha não preencher (booking antigo / outro caminho).
  // É essa variável que vai nos e-mails de confirmação ao cliente/admin.
  const priceFinal = (valor && valor > 0) ? valor : pkg.price;
  if (confirmFailed) {
    // Tentativas falharam — alerta urgente pro admin investigar manual.
    // Continua o fluxo de emails pra não confundir cliente que JÁ PAGOU.
    const { error } = await resend.emails.send({
      from:    FROM_EMAIL,
      to:      ANDRE_EMAIL,
      subject: `🚨 URGENTE: pagamento OK mas Sheets não confirmou — ${name} ${date} ${time}`,
      html: `<p><strong>O cliente já pagou mas o confirmBooking falhou.</strong> Confirme manualmente no Sheets pra evitar duplo agendamento.</p>
<p><strong>Cliente:</strong> ${name}<br>
<strong>Email:</strong> ${email}<br>
<strong>WhatsApp:</strong> ${whatsapp}<br>
<strong>Data:</strong> ${date} ${time}<br>
<strong>Pacote:</strong> ${pkg.name} (R$ ${priceFinal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})<br>
<strong>Gateway:</strong> ${normalized.gateway.toUpperCase()}<br>
<strong>Payment ID:</strong> ${normalized.paymentId}<br>
<strong>External Slot ID:</strong> ${normalized.externalSlotId}<br>
<strong>Último erro:</strong> ${confirmFailed}</p>
<p>Ação: abre o Sheets de Agendamentos, busca a linha com stripeSession = <code>${normalized.externalSlotId}</code>, muda status pra Confirmado e preenche stripePayment.</p>`,
    });
    if (error) console.error('[webhook] CRITICAL: confirmBooking failed AND admin alert failed', error);

    // Sem meta nenhuma (Checkout ASAAS não tem externalReference de fallback,
    // então 'Session não encontrada' deixa name/email vazios), os emails de
    // "Reserva confirmada" abaixo seriam lixo sem destinatário — e no replay
    // pós-reativação da fila virariam uma rajada. O alerta acima já cobre.
    if (!email && !name) {
      return res.status(200).json({ received: true, confirmFailed: true, reason: 'no booking meta' });
    }
  }

  // Idempotência: se a reserva JÁ estava Confirmada antes deste evento, um
  // webhook anterior já confirmou e enviou os e-mails. A ASAAS dispara
  // PAYMENT_CONFIRMED e depois PAYMENT_RECEIVED pro mesmo cartão (e reenvia em
  // retry); sem essa guarda o cliente/André/Mari receberiam e-mails duplicados.
  if (!confirmFailed && alreadyConfirmed) {
    console.log(`[webhook] booking ${bookingId} já confirmado — pula e-mails (${normalized.gateway}/${normalized.paymentId})`);
    return res.status(200).json({ received: true, alreadyConfirmed: true });
  }

  // ── Pagamento PARCIAL (multi-pagador) ──
  // Algum split-link pagou mas ainda falta(m) pagador(es). Notifica só Mari
  // (sem mandar "Reserva confirmada" pro cliente — esse vai sair quando o
  // último pagador fechar). André recebe quando fecha 100% pra não inflar
  // inbox com pings parciais.
  if (!confirmFailed && !fullyConfirmed) {
    console.log(`[webhook] booking ${bookingId} pagamento PARCIAL ${paidCount}/${totalSessions} — só notifica Mari`);
    try {
      const valorPago = (Number(normalized.amount) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      // Quem acabou de pagar e quem ainda falta — o ponto central do pedido:
      // Mari precisa saber QUEM falta pagar de QUAL ensaio.
      const quemPagou = paidPayerName ? `<strong>${paidPayerName}</strong>` : 'Um dos pagadores';
      const faltam    = pendingPayerNames.length > 0
        ? pendingPayerNames.map(n => n || '(sem nome)').join(', ')
        : `${totalSessions - paidCount} pagador(es)`;
      const { data: partialSent, error: partialErr } = await resend.emails.send({
        from:    FROM_EMAIL,
        to:      MARIANE_EMAIL,
        subject: `💰 ${paidPayerName || 'Pagamento parcial'} pagou — ${name} (${paidCount}/${totalSessions}) · ${pkg.name}`,
        html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;">
<h2 style="color:#7a3f8f;margin:0 0 12px;">Pagamento parcial recebido</h2>
<p>${quemPagou} pagou a parte do split. Reserva ainda <strong>não está confirmada</strong>.</p>
<p style="background:#fef3c7;border-radius:8px;padding:10px 12px;margin:12px 0;">
  <strong>Ainda falta(m) pagar:</strong> ${faltam}
</p>
<p><strong>Cliente:</strong> ${name}<br>
<strong>E-mail:</strong> ${email}<br>
<strong>WhatsApp:</strong> ${whatsapp || '—'}<br>
<strong>Data:</strong> ${fmtDate(date)} · ${time}–${endTime}<br>
<strong>Pacote:</strong> ${pkg.name}<br>
<strong>Status do split:</strong> <span style="font-weight:700;color:#7a3f8f;">${paidCount}/${totalSessions} pagos</span><br>
<strong>Valor recebido agora:</strong> R$ ${valorPago}<br>
<strong>Gateway:</strong> ${normalized.gateway.toUpperCase()} · Payment: ${normalized.paymentId}</p>
<p style="font-size:12px;color:#6b7280;">O e-mail final "Reserva confirmada" só vai pro cliente quando todos os pagadores fecharem.</p>
</div>`,
      });
      // O SDK do Resend v6 NUNCA lança — falhas voltam em {error}. Sem esse
      // check, um 422/429 sumia sem deixar rastro nos logs.
      if (partialErr) console.error('[webhook] Resend Mari (partial) error', partialErr);
      else console.log(`[webhook] email parcial Mari enviado (${partialSent?.id}) — booking ${bookingId} ${paidCount}/${totalSessions}`);
    } catch (e) {
      console.error('[webhook] Resend Mari (partial) error', e);
    }
    // Especial: o pagador que acabou de pagar recebe "sua parte confirmada"
    // (BCC André+Mari). A confirmação do ensaio inteiro sai quando o último fecha.
    if (isEspecial && paidPayerEmail) {
      const groupUrl = bookingId ? `${SITE_URL}/especial/${bookingId}?t=${especialToken(bookingId)}` : undefined;
      await sendEspecialEmails([{
        to:      paidPayerEmail,
        subject: `Sua parte no ensaio de ${fmtDate(date)} está confirmada`,
        html:    buildEspecialEmailHtml('partPaid', {
          payerName: paidPayerName, date, time, endTime: espEnd || endTime,
          duration: espDuration || pkg.duration, numBailarinas: Number(numBailarinas) || 1,
          partValue: (Number(normalized.amount) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          groupUrl, bookingId,
        }),
      }]);
    }
    return res.status(200).json({ received: true, partial: true, paidCount, totalSessions });
  }

  // 2. Send confirmation email to client
  // Resend limita a 2 req/s — os sends abaixo são sequenciais com pausa
  // pra não tomar 429 (que o SDK devolve em {error}, sem retry automático).
  const emailLog: Record<string, string> = {};
  if (isEspecial) {
    // Especial: cada pagador + o contato principal recebem "ensaio confirmado"
    // (SEM valor total — cada um vê só a própria parte), BCC André+Mari. As
    // notificações internas de André/Mari abaixo seguem com o total.
    const groupUrl = bookingId ? `${SITE_URL}/especial/${bookingId}?t=${especialToken(bookingId)}` : undefined;
    const nb   = Number(numBailarinas) || 1;
    const seen = new Set<string>();
    const sends: Array<{ to: string; subject: string; html: string }> = [];
    espPayerEmails.forEach((pe, i) => {
      const to = String(pe || '').trim().toLowerCase();
      if (!to || seen.has(to)) return;
      seen.add(to);
      sends.push({
        to: pe.trim(),
        subject: `Ensaio de ${fmtDate(date)} confirmado!`,
        html: buildEspecialEmailHtml('allConfirmed', {
          payerName: espPayerNames[i] || '', date, time, endTime: espEnd || endTime,
          duration: espDuration || pkg.duration, numBailarinas: nb,
          partValue: (parseFloat(String(espPayerValues[i] || '0')) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          groupUrl, bookingId,
        }),
      });
    });
    if (email && !seen.has(email.trim().toLowerCase())) {
      sends.push({
        to: email,
        subject: `Ensaio de ${fmtDate(date)} confirmado!`,
        html: buildEspecialEmailHtml('allConfirmed', {
          payerName: name, date, time, endTime: espEnd || endTime,
          duration: espDuration || pkg.duration, numBailarinas: nb, partValue: '', groupUrl, bookingId,
        }),
      });
    }
    await sendEspecialEmails(sends);
    emailLog.cliente = `especial: ${sends.length} enviados`;
  } else {
    const htmlBody = buildBookingEmailHtml({
      name, date, time, endTime,
      packageName: pkg.name, duration: pkg.duration,
      price: priceFinal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      bookingId,
      numBailarinas,
    }, 'confirmed');
    try {
      const { data: sent, error } = await resend.emails.send({
        from:    FROM_EMAIL,
        to:      email,
        subject: `Reserva confirmada — ${pkg.name} · ${date.split('-').reverse().join('/')} às ${time}`,
        html:    htmlBody,
      });
      emailLog.cliente = error ? `ERRO: ${error.message || error.name}` : (sent?.id || 'ok');
      if (error) console.error('[webhook] Resend client error', error);
    } catch (e) {
      console.error('[webhook] Resend client error', e);
    }
    await new Promise(r => setTimeout(r, 600));
  }

  // 3. Notify André
  try {
    const { data: sentAndre, error: errAndre } = await resend.emails.send({
      from:    FROM_EMAIL,
      to:      ANDRE_EMAIL,
      subject: `Nova reserva: ${name} — ${pkg.name} ${date.split('-').reverse().join('/')} ${time}`,
      html:    `<p><strong>Nova reserva confirmada</strong><br>
Cliente: ${name}<br>E-mail: ${email}<br>WhatsApp: ${whatsapp}<br>
Data: ${fmtDate(date)}<br>Horário: ${time}–${endTime}<br>
Pacote: ${pkg.name}<br>Nº Bailarinas: ${numBailarinas}<br>Valor: R$ ${priceFinal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<br>
Parcelas: ${normalized.installments}x<br>
${normalized.billingType ? `Método: ${normalized.billingType}<br>` : ''}
Booking ID: ${bookingId}<br>Gateway: ${normalized.gateway.toUpperCase()} · Payment: ${normalized.paymentId}</p>`,
    });
    emailLog.andre = errAndre ? `ERRO: ${errAndre.message || errAndre.name}` : (sentAndre?.id || 'ok');
    if (errAndre) console.error('[webhook] Resend andre error', errAndre);
  } catch (e) {
    console.error('[webhook] Resend andre error', e);
  }
  await new Promise(r => setTimeout(r, 600));

  // 4. Notify Mariane
  try {
    const marianeHtml = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
  <tr><td style="background:linear-gradient(135deg,#7a3f8f,#e87060);padding:20px 28px;">
    <h2 style="color:#ffffff;margin:0;font-size:17px;">✅ Pagamento confirmado!</h2>
    <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px;">O cliente concluiu o pagamento do link que você gerou.</p>
  </td></tr>
  <tr><td style="padding:24px 28px;">
    <table width="100%" style="border-collapse:collapse;">
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;width:120px;">Cliente</td>
          <td style="font-weight:600;font-size:13px;">${name}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">E-mail</td>
          <td style="font-size:13px;">${email}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">WhatsApp</td>
          <td style="font-weight:600;font-size:14px;color:#7a3f8f;">${whatsapp || '—'}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">Pacote</td>
          <td style="font-size:13px;">${pkg.name}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">Data</td>
          <td style="font-size:13px;">${fmtDate(date)} às ${time} – ${endTime}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;border-top:1px solid #e5e7eb;">Valor pago</td>
          <td style="font-weight:700;font-size:14px;color:#7a3f8f;border-top:1px solid #e5e7eb;">R$ ${priceFinal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${normalized.installments > 1 ? ` em ${normalized.installments}x` : ''}</td></tr>
    </table>
    <p style="font-size:12px;color:#9ca3af;margin-top:16px;border-top:1px solid #f0f0f0;padding-top:12px;">
      Booking ID: ${bookingId}
    </p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;

    const { data: sentMari, error: errMari } = await resend.emails.send({
      from:    FROM_EMAIL,
      to:      MARIANE_EMAIL,
      subject: `✅ ${name} concluiu o pagamento — ${pkg.name} · ${fmtDate(date)} às ${time}`,
      html:    marianeHtml,
    });
    emailLog.mari = errMari ? `ERRO: ${errMari.message || errMari.name}` : (sentMari?.id || 'ok');
    if (errMari) console.error('[webhook] Resend mariane error', errMari);
  } catch (e) {
    console.error('[webhook] Resend mariane error', e);
  }

  // Log estruturado do happy path — responde "o evento chegou? confirmou?
  // enviou os emails?" direto nos logs da Vercel, sem precisar do código.
  console.log('[webhook] OK', JSON.stringify({
    gateway: normalized.gateway, paymentId: normalized.paymentId,
    slotId: normalized.externalSlotId, bookingId,
    confirmFailed: confirmFailed || false, emails: emailLog,
  }));

  return res.status(200).json({ received: true });
}
