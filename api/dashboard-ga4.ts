/**
 * /api/dashboard-ga4 — busca métricas do GA4 e retorna JSON pro Dashboard.
 *
 * Autenticação dupla:
 *  1. Token HMAC do admin (mesma do /admin) — só usuários da whitelist passam
 *  2. OAuth refresh token pessoal — autoriza o backend a ler o GA4 como o André
 *
 * Por que OAuth e não Service Account:
 *  GA4 com property em conta Gmail pessoal NÃO aceita adicionar service accounts.
 *  É limitação documentada da Google: SA só funciona em GA4 quando a Account é
 *  Workspace organization. Como André usa Gmail pessoal, OAuth é o único caminho.
 *
 * Como funciona:
 *  - Setup 1x: script local (`scripts/setup-ga4-oauth.mjs`) abre browser, usuário
 *    aprova consent, captura refresh_token.
 *  - Env vars: GA4_OAUTH_CLIENT_ID + GA4_OAUTH_CLIENT_SECRET + GA4_OAUTH_REFRESH_TOKEN
 *  - Cada request: pega access_token (vida 1h) trocando refresh_token, chama GA4.
 *  - Refresh token: dura ~6 meses sem uso, então rodando o cron 12h ele NUNCA expira.
 *
 * Comparação automática: cada métrica compara `range` dias contra os
 * `range` dias anteriores → retorna deltaPct.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { BetaAnalyticsDataClient } from '@google-analytics/data';
import { OAuth2Client } from 'google-auth-library';
import { verifyToken } from './_adminAuth';

const PROPERTY_ID = process.env.GA4_PROPERTY_ID || '494185724';

/* ─────────────── helpers ─────────────── */

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
  if (c.includes('paid social')) return 'paid_social';
  if (c.includes('organic social')) return 'organic_social';
  if (c.includes('direct')) return 'direct';
  if (c.includes('referral')) return 'referral';
  if (c.includes('organic search')) return 'organic_search';
  if (c.includes('paid search')) return 'paid_search';
  if (c.includes('email')) return 'email';
  return 'other';
}

/** Constrói cliente GA4 usando refresh token via OAuth */
function buildGa4Client(): BetaAnalyticsDataClient {
  const clientId     = process.env.GA4_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GA4_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GA4_OAUTH_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('OAuth não configurado (GA4_OAUTH_CLIENT_ID, GA4_OAUTH_CLIENT_SECRET, GA4_OAUTH_REFRESH_TOKEN)');
  }

  const oauth2 = new OAuth2Client(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });

  // BetaAnalyticsDataClient aceita um authClient pré-configurado
  // @ts-expect-error - tipos do GA4 SDK não expõem o construtor com authClient explícito
  return new BetaAnalyticsDataClient({ authClient: oauth2 });
}

/* ─────────────── handler ─────────────── */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Auth: token HMAC do admin
  const auth = verifyToken(req.headers.authorization);
  if (!auth) return res.status(401).json({ error: 'Token inválido' });

  if (req.query.ping) return res.status(200).json({ ok: true, user: auth.user });

  // Verifica config OAuth
  if (!process.env.GA4_OAUTH_REFRESH_TOKEN) {
    return res.status(503).json({
      error: 'OAuth GA4 não configurado',
      details: 'Refresh token ausente. Veja docs/ga4-oauth-setup.md (setup 1x, ~10min).',
    });
  }

  const days = Math.min(Math.max(parseInt(String(req.query.range || '28'), 10) || 28, 1), 365);
  const property = `properties/${PROPERTY_ID}`;

  try {
    const client = buildGa4Client();

    const periodCurrent  = { startDate: daysAgo(days), endDate: 'today' };
    const periodPrevious = { startDate: daysAgo(days * 2), endDate: daysAgo(days + 1) };

    // 1. KPIs (current + previous para delta)
    const [kpiCur, kpiPrev] = await Promise.all([
      client.runReport({
        property,
        dateRanges: [periodCurrent],
        metrics: [
          { name: 'totalUsers' },
          { name: 'sessions' },
          { name: 'engagementRate' },
          { name: 'newUsers' },
        ],
      }),
      client.runReport({
        property,
        dateRanges: [periodPrevious],
        metrics: [
          { name: 'totalUsers' },
          { name: 'sessions' },
          { name: 'engagementRate' },
          { name: 'newUsers' },
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

    // 2. Tendência diária de usuários
    const [trendReport] = await client.runReport({
      property,
      dateRanges: [periodCurrent],
      dimensions: [{ name: 'date' }],
      metrics:    [{ name: 'totalUsers' }],
      orderBys:   [{ dimension: { dimensionName: 'date' } }],
    });
    const trend = (trendReport.rows || []).map((r) => {
      const raw = r.dimensionValues?.[0]?.value || '';
      const formatted = raw.length === 8
        ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
        : raw;
      return { date: formatted, value: Number(r.metricValues?.[0]?.value || 0) };
    });

    // 3. Canais (Session default channel group)
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
      return {
        label,
        value: Number(r.metricValues?.[0]?.value || 0),
        category: categorizeChannel(label),
      };
    });

    // 4. Top events
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
      fetched_at: new Date().toISOString(),
      next_refresh: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
      kpis,
      trend,
      channels,
      topEvents,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[dashboard-ga4]', msg);
    return res.status(500).json({ error: msg });
  }
}
