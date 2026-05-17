/**
 * Overview — Visão Geral do Dashboard.
 *
 * Mostra os indicadores principais de marketing: usuários, sessões,
 * engajamento, leads. Tendência ao longo do tempo. Top canais e top eventos.
 *
 * Dados vêm de /api/dashboard-ga4 (que busca via Google Analytics Data API).
 * Quando service account ainda não estiver configurado, exibe estado pendente
 * com dados ilustrativos.
 */

import { useEffect, useState } from 'react';
import { Users, MousePointer, Sparkles, UserPlus } from 'lucide-react';

import { KpiCard } from '../components/KpiCard';
import { TrendChart } from '../components/TrendChart';
import { ChannelBar } from '../components/ChannelBar';
import { DataTable } from '../components/DataTable';
import { DataSourceBadge } from '../components/DataSourceBadge';

interface OverviewData {
  range: { start: string; end: string; days: number };
  fetched_at: string;
  next_refresh: string;
  kpis: {
    totalUsers: { value: number; deltaPct: number | null };
    sessions:   { value: number; deltaPct: number | null };
    engagementRate: { value: number; deltaPct: number | null }; // 0..1
    newUsers:   { value: number; deltaPct: number | null };
  };
  trend: Array<{ date: string; value: number }>;
  channels: Array<{ label: string; value: number; category: string }>;
  topEvents: Array<{ event_name: string; count: number }>;
}

const RANGE_OPTIONS = [
  { key: '7d',  label: '7 dias',  days: 7 },
  { key: '28d', label: '28 dias', days: 28 },
  { key: '90d', label: '90 dias', days: 90 },
] as const;

export function Overview({ token }: { token: string }) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<typeof RANGE_OPTIONS[number]['key']>('28d');
  const [refreshing, setRefreshing] = useState(false);

  const load = async (forceRefresh = false) => {
    setLoading(!data); // skeleton só na primeira vez
    if (forceRefresh) setRefreshing(true);
    setError(null);
    try {
      const days = RANGE_OPTIONS.find((r) => r.key === range)?.days || 28;
      const r = await fetch(`/api/dashboard-ga4?range=${days}${forceRefresh ? '&refresh=1' : ''}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`);
      setData(json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar dados');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [range]);

  return (
    <div className="px-8 py-6 text-white max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-purple-300/60">Página 1 · Overview</p>
          <h1 className="font-headline text-3xl font-black mt-1">Visão Geral</h1>
          <p className="text-purple-200/60 text-sm mt-1">
            Como os visitantes estão chegando e se engajando com o site
          </p>
        </div>

        {/* Range picker */}
        <div className="flex items-center gap-1 p-1 rounded-lg bg-white/[0.04] border border-white/[0.08]">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setRange(opt.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors
                ${range === opt.key ? 'bg-purple-500/20 text-white' : 'text-purple-200/60 hover:text-white'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Source badge */}
      <div className="mb-6">
        <DataSourceBadge
          sources={[{ label: 'GA4', detail: 'property 494185724', status: error ? 'error' : 'live' }]}
          lastFetched={data?.fetched_at}
          nextRefresh={data?.next_refresh}
          onRefresh={() => load(true)}
          refreshing={refreshing}
        />
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-6 p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 text-amber-200 text-sm">
          <p className="font-bold">Não foi possível buscar dados ao vivo</p>
          <p className="text-amber-200/70 mt-1">{error}</p>
          <p className="text-amber-200/50 text-xs mt-2 leading-relaxed">
            Configuração necessária: criar Service Account no GCP <code className="bg-amber-500/10 px-1 rounded">marketing-joinville-2026</code>,
            adicionar como Viewer na property GA4, e setar env var <code className="bg-amber-500/10 px-1 rounded">GA4_SERVICE_ACCOUNT_JSON</code> no Vercel.
            Veja docs/ga4-service-account.md.
          </p>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KpiCard
          label="Usuários"
          value={data ? data.kpis.totalUsers.value.toLocaleString('pt-BR') : '—'}
          deltaPct={data?.kpis.totalUsers.deltaPct ?? null}
          deltaLabel={`vs ${RANGE_OPTIONS.find((r) => r.key === range)?.label} anteriores`}
          icon={Users} source="GA4"
          hint="Pessoas únicas que visitaram o site"
          loading={loading}
        />
        <KpiCard
          label="Sessões"
          value={data ? data.kpis.sessions.value.toLocaleString('pt-BR') : '—'}
          deltaPct={data?.kpis.sessions.deltaPct ?? null}
          deltaLabel={`vs ${RANGE_OPTIONS.find((r) => r.key === range)?.label} anteriores`}
          icon={MousePointer} source="GA4"
          hint="Visitas (1 usuário pode ter várias)"
          loading={loading}
        />
        <KpiCard
          label="Engajamento"
          value={data ? `${(data.kpis.engagementRate.value * 100).toFixed(1)}%` : '—'}
          deltaPct={data?.kpis.engagementRate.deltaPct ?? null}
          deltaLabel={`vs ${RANGE_OPTIONS.find((r) => r.key === range)?.label} anteriores`}
          icon={Sparkles} source="GA4"
          hint="% sessões com >10s ou múltiplas páginas"
          loading={loading}
        />
        <KpiCard
          label="Novos usuários"
          value={data ? data.kpis.newUsers.value.toLocaleString('pt-BR') : '—'}
          deltaPct={data?.kpis.newUsers.deltaPct ?? null}
          deltaLabel={`vs ${RANGE_OPTIONS.find((r) => r.key === range)?.label} anteriores`}
          icon={UserPlus} source="GA4"
          hint="Primeiro acesso ao site"
          loading={loading}
        />
      </div>

      {/* Trend + Channels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-6">
        <div className="lg:col-span-2">
          <TrendChart
            data={data?.trend || []}
            title="Tendência de Usuários"
            metricLabel="Usuários ativos"
            color="purple" source="GA4"
            loading={loading}
          />
        </div>
        <ChannelBar
          title="De onde vem o tráfego"
          data={data?.channels || []}
          unit="sessões"
          source="GA4"
          loading={loading}
        />
      </div>

      {/* Top events */}
      <div className="grid grid-cols-1 gap-3">
        <DataTable
          title="Eventos mais frequentes"
          source="GA4"
          loading={loading}
          rows={(data?.topEvents || []).map((e) => ({ event_name: e.event_name, count: e.count }))}
          columns={[
            { key: 'event_name', label: 'Evento', align: 'left' },
            { key: 'count',      label: 'Quantidade', align: 'right' },
          ]}
          barColumn="count"
          maxRows={15}
        />
      </div>

      {/* Footer note */}
      <p className="text-center text-[10px] text-purple-300/30 mt-8 pb-4">
        Dados via Google Analytics Data API · refresh automático a cada 12h ·
        BigQuery export (dados granulares) a partir de 17/mai
      </p>
    </div>
  );
}
