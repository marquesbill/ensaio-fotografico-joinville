/**
 * /api/dashboard-ga4 — busca métricas do GA4 e retorna JSON pro Dashboard.
 *
 * Autenticação: token HMAC via Authorization header (mesmo /admin).
 * Provedor de dados: Google Analytics Data API v1beta usando service account.
 *
 * Comparação automática: cada métrica compara `range` dias contra os
 * `range` dias anteriores → retorna deltaPct.
 *
 * Setup (1x):
 *  1. GCP `marketing-joinville-2026` → IAM → criar Service Account (Viewer)
 *  2. Baixar chave JSON
 *  3. Adicionar email do SA como Viewer em GA4 → Property → Gerenciamento de acesso
 *  4. Setar env var no Vercel: GA4_SERVICE_ACCOUNT_JSON (JSON inteiro, escaped)
 *  5. Setar GA4_PROPERTY_ID (= 494185724)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { BetaAnalyticsDataClient } from '@google-analytics/data';
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

/** Mapeia "primary channel grouping" do GA4 pra slug interno usado pelo ChannelBar */
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

/* ─────────────── handler ─────────────── */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Auth
  const auth = verifyToken(req.headers.authorization);
  if (!auth) return res.status(401).json({ error: 'Token inválido' });

  // Ping endpoint (used by frontend to verify token without fetching data)
  if (req.query.ping) return res.status(200).json({ ok: true, user: auth.user });

  // Validate service account env var
  if (!process.env.GA4_SERVICE_ACCOUNT_JSON) {
    return res.status(503).json({
      error: 'Service Account não configurada',
      details: 'GA4_SERVICE_ACCOUNT_JSON env var ausente. Veja docs/ga4-service-account.md',
    });
  }

  let credentials: object;
  try {
    credentials = JSON.parse(process.env.GA4_SERVICE_ACCOUNT_JSON);
  } catch {
    return res.status(500).json({ error: 'GA4_SERVICE_ACCOUNT_JSON tem JSON inválido' });
  }

  const days = Math.min(Math.max(parseInt(String(req.query.range || '28'), 10) || 28, 1), 365);
  const property = `properties/${PROPERTY_ID}`;

  try {
    const client = new BetaAnalyticsDataClient({ credentials });

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
      totalUsers: {
        value: num(0, curRow),
        deltaPct: pctDelta(num(0, curRow), num(0, prevRow)),
      },
      sessions: {
        value: num(1, curRow),
        deltaPct: pctDelta(num(1, curRow), num(1, prevRow)),
      },
      engagementRate: {
        value: num(2, curRow), // 0..1
        deltaPct: pctDelta(num(2, curRow), num(2, prevRow)),
      },
      newUsers: {
        value: num(3, curRow),
        deltaPct: pctDelta(num(3, curRow), num(3, prevRow)),
      },
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
      // GA4 retorna 'YYYYMMDD' → converte pra 'YYYY-MM-DD'
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
