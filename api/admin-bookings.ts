import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac } from 'crypto';
import { BetaAnalyticsDataClient } from '@google-analytics/data';
import { OAuth2Client } from 'google-auth-library';

const SECRET    = process.env.ADMIN_SECRET || 'dev-secret-change-me';
const TOKEN_TTL = 8 * 60 * 60 * 1000; // 8 h
const SCRIPT_URL = process.env.SHEETS_SCRIPT_URL!;

const GA4_PROPERTY_ID = process.env.GA4_PROPERTY_ID || '494185724';

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

/* ───────── GA4 Dashboard helpers ───────── */

function daysAgo(days: number): string {
  const d = new Date(); d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}
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
      error: 'OAuth GA4 não configurado',
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

/* ───────── handler principal ───────── */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = verifyToken(req.headers.authorization as string | undefined);
  if (!auth) return res.status(401).json({ error: 'Não autorizado' });

  // Router por ?endpoint= (consolida funções pra ficar no limite de 12 do plano Hobby)
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

  // POST: proxy de ações específicas para o Apps Script
  // (mantemos aqui em vez de criar nova função pra não estourar
  //  o limite de 12 serverless functions do plano Hobby.)
  if (req.method === 'POST') {
    try {
      const body = req.body as { action?: string; bookingId?: string; extraCc?: string };
      if (body?.action === 'resendConfirmation') {
        if (!body.bookingId) return res.status(400).json({ error: 'bookingId obrigatório' });
        const r = await fetch(SCRIPT_URL, {
          method: 'POST',
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
      return res.status(400).json({ error: 'Ação desconhecida' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[admin-bookings] POST', msg);
      return res.status(500).json({ error: msg });
    }
  }

  if (req.method !== 'GET') return res.status(405).end();

  try {
    const url = `${SCRIPT_URL}?action=bookings&t=${Date.now()}`;
    const r   = await fetch(url, { cache: 'no-store' });
    const json = await r.json();
    return res.status(200).json(json);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
}
