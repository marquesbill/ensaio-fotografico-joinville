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
import { OAuth2Client } from 'google-auth-library';

/* ───────── Config ───────── */

const SECRET          = process.env.ADMIN_SECRET || 'dev-secret-change-me';
const TOKEN_TTL       = 8 * 60 * 60 * 1000; // 8 h
const SCRIPT_URL      = process.env.SHEETS_SCRIPT_URL!;
const SITE_URL        = process.env.SITE_URL || 'https://www.ensaiofotograficoemjoinville.com';
const MP_TOKEN        = process.env.MERCADOPAGO_ACCESS_TOKEN!;
const GA4_PROPERTY_ID = process.env.GA4_PROPERTY_ID || '494185724';
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

  // Landing pages
  const [landingReport] = await client.runReport({
    property,
    dateRanges: [periodCurrent],
    dimensions: [{ name: 'landingPage' }],
    metrics:    [
      { name: 'sessions' },
      { name: 'engagementRate' },
      { name: 'averageSessionDuration' },
    ],
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

  const sources = (sourcesReport.rows || []).map(r => ({
    source:         r.dimensionValues?.[0]?.value || '(none)',
    medium:         r.dimensionValues?.[1]?.value || '(none)',
    sessions:       Number(r.metricValues?.[0]?.value || 0),
    users:          Number(r.metricValues?.[1]?.value || 0),
    engagementRate: Number(r.metricValues?.[2]?.value || 0),
  }));

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

  const landingPages = (landingReport.rows || []).map(r => ({
    page:                r.dimensionValues?.[0]?.value || '/',
    sessions:            Number(r.metricValues?.[0]?.value || 0),
    engagementRate:      Number(r.metricValues?.[1]?.value || 0),
    avgSessionDuration:  Number(r.metricValues?.[2]?.value || 0),
  }));

  return res.status(200).json({
    range:        { start: periodCurrent.startDate, end: 'today', days },
    fetched_at:   new Date().toISOString(),
    next_refresh: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
    kpis, channels, sources, campaigns, landingPages,
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

  // GA4 Enhanced Ecommerce funnel: view_item_list → select_item → begin_checkout → purchase
  const STEP_EVENTS = ['view_item_list', 'select_item', 'begin_checkout', 'purchase'];

  // 1. Funnel atual + anterior (sessions per step + eventCount)
  const [stepCur, stepPrev] = await Promise.all([
    client.runReport({
      property,
      dateRanges: [periodCurrent],
      dimensions: [{ name: 'eventName' }],
      metrics:    [{ name: 'sessions' }, { name: 'eventCount' }, { name: 'totalUsers' }],
      dimensionFilter: {
        filter: {
          fieldName:    'eventName',
          inListFilter: { values: STEP_EVENTS },
        },
      },
    }),
    client.runReport({
      property,
      dateRanges: [periodPrevious],
      dimensions: [{ name: 'eventName' }],
      metrics:    [{ name: 'sessions' }],
      dimensionFilter: {
        filter: {
          fieldName:    'eventName',
          inListFilter: { values: STEP_EVENTS },
        },
      },
    }),
  ]);

  type StepData = { sessions: number; eventCount: number; users: number };
  const parseSteps = (rows: NonNullable<typeof stepCur[0]['rows']>, hasEvent = true, hasUsers = true) => {
    const m: Record<string, StepData> = {};
    rows.forEach(r => {
      const name = r.dimensionValues?.[0]?.value || '';
      m[name] = {
        sessions:   Number(r.metricValues?.[0]?.value || 0),
        eventCount: hasEvent ? Number(r.metricValues?.[1]?.value || 0) : 0,
        users:      hasUsers ? Number(r.metricValues?.[2]?.value || 0) : 0,
      };
    });
    return m;
  };
  const curMap  = parseSteps(stepCur[0].rows || [], true,  true);
  const prevMap = parseSteps(stepPrev[0].rows || [], false, false);

  const funnel = STEP_EVENTS.map(name => {
    const cur  = curMap[name]  || { sessions: 0, eventCount: 0, users: 0 };
    const prev = prevMap[name] || { sessions: 0, eventCount: 0, users: 0 };
    return {
      step:       name,
      sessions:   cur.sessions,
      eventCount: cur.eventCount,
      users:      cur.users,
      deltaPct:   pctDelta(cur.sessions, prev.sessions),
    };
  });

  // 2. Per-package: select_item events por itemId
  const [selectByPkg, purchaseByPkg] = await Promise.all([
    client.runReport({
      property,
      dateRanges: [periodCurrent],
      dimensions: [{ name: 'itemId' }],
      metrics:    [{ name: 'eventCount' }],
      dimensionFilter: {
        filter: {
          fieldName:    'eventName',
          stringFilter: { value: 'select_item' },
        },
      },
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
    packages,
  });
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
      price:         (pkg.price || 0).toFixed(2).replace('.', ','),
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
      price:       (pkg.price || 0).toFixed(2).replace('.', ','),
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
          date, time, packageKey, confirm } = req.body as {
    name: string; email: string; whatsapp: string;
    instagram?: string; instagramBailarina?: string; nomeBailarina?: string; numBailarinas?: number;
    date: string; time: string; packageKey: PkgKey; confirm: boolean;
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

  // Path A: gera link de pagamento (preferência MP 3 dias)
  if (!confirm) {
    try {
      const expiry = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      const prefRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MP_TOKEN}` },
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

      const pendingRes = await fetch(SCRIPT_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'createPending',
          date, start: time, packageKey, name, email, whatsapp,
          instagram:          instagram || '',
          instagramBailarina: instagramBailarina || '',
          nomeBailarina:      nomeBailarina || '',
          numBailarinas:      nb,
          stripeSession:      pref.id,
          source:             'admin',
        }),
      });
      const pendingJson = await pendingRes.json() as { bookingId?: string };
      const bookingId   = pendingJson.bookingId || '';

      await fetch(SCRIPT_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'addLog', message: `${logUser} criou agendamento pendente para ${name} (${date} ${time}) e gerou link de pgmto`, origin: 'painel' }),
      }).catch(() => {});

      return res.status(200).json({ bookingId, paymentUrl: pref.init_point });
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
        price:       pkg.price.toFixed(2).replace('.', ','),
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
          date, time, packageKey } = req.body as {
    bookingId: string; name: string; email: string; whatsapp: string;
    instagram?: string; instagramBailarina?: string; nomeBailarina?: string; numBailarinas?: number;
    date: string; time: string; packageKey: PkgKey;
  };

  if (!bookingId || !date || !time || !packageKey || !name || !email) {
    return res.status(400).json({ error: 'Campos obrigatórios faltando' });
  }

  const pkg = PACKAGES[packageKey];
  if (!pkg) return res.status(400).json({ error: 'Pacote inválido' });

  let nb = 1;
  if (numBailarinas !== undefined && numBailarinas !== null && String(numBailarinas) !== '') {
    const parsed = Number(numBailarinas);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > pkg.maxBailarinas) {
      return res.status(400).json({ error: `Nº Bailarinas deve estar entre 1 e ${pkg.maxBailarinas} para o pacote ${pkg.name}` });
    }
    nb = parsed;
  }

  try {
    // 1. Cria nova MP preference com 3-day expiry
    const expiry = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const prefRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MP_TOKEN}` },
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

    // 2. Cancela pending antigo
    await fetch(SCRIPT_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'cancelBooking',
        bookingId,
        reason: 'Novo link de pagamento gerado pelo admin',
      }),
    }).catch(e => console.error('[admin-bookings/paymentLink] cancel error', e));

    // 3. Cria novo pending com nova preference (webhook confirma via esse ID)
    await fetch(SCRIPT_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'createPending',
        date, start: time, packageKey,
        name, email, whatsapp,
        instagram:          instagram || '',
        instagramBailarina: instagramBailarina || '',
        nomeBailarina:      nomeBailarina || '',
        numBailarinas:      nb,
        stripeSession:      pref.id,
        source:             'admin',
      }),
    }).catch(e => console.error('[admin-bookings/paymentLink] createPending error', e));

    // 4. Log
    await fetch(SCRIPT_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action:  'addLog',
        message: `${auth.user} gerou novo link de pagamento para ${name} (${date} ${time})`,
        origin:  'painel',
      }),
    }).catch(() => {});

    return res.status(200).json({ url: pref.init_point });
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
      price:         (pkg.price || 0).toFixed(2).replace('.', ','),
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
