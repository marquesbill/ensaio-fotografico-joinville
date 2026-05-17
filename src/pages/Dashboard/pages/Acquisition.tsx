/**
 * Acquisition — Página 2 do Dashboard.
 *
 * Foca em "de onde vem o tráfego". Quebra por:
 *  - 4 KPIs: sessões, usuários, % pago, engajamento
 *  - Canais (channel groups com share visual)
 *  - Fontes (source/medium pairs)
 *  - Campanhas UTM (vazio enquanto não tiver campanha rodando)
 *  - Landing pages (com tempo médio + engagement)
 *
 * Dados via /api/admin-bookings?endpoint=ga4-acquisition&range=N.
 */

import { useEffect, useState } from 'react';
import { Users, MousePointer, Megaphone, Sparkles } from 'lucide-react';

import { KpiCard } from '../components/KpiCard';
import { ChannelBar } from '../components/ChannelBar';
import { DataTable } from '../components/DataTable';
import { DataSourceBadge } from '../components/DataSourceBadge';

type ChannelCategory = 'paid_social' | 'organic_social' | 'direct' | 'referral' | 'organic_search' | 'email' | 'paid_search' | 'other';

interface AcquisitionData {
  range: { start: string; end: string; days: number };
  fetched_at: string;
  next_refresh: string;
  kpis: {
    sessions:       { value: number; deltaPct: number | null };
    users:          { value: number; deltaPct: number | null };
    engagementRate: { value: number; deltaPct: number | null };
    paidShare:      { value: number; deltaPct: number | null };
  };
  channels: Array<{
    label: string; category: string;
    sessions: number; users: number; engagementRate: number;
  }>;
  sources: Array<{
    source: string; medium: string;
    sessions: number; users: number; engagementRate: number;
  }>;
  campaigns: Array<{
    campaign: string;
    sessions: number; users: number; engagementRate: number;
  }>;
  landingPages: Array<{
    page: string;
    sessions: number; engagementRate: number; avgSessionDuration: number;
  }>;
}

interface LeadsData {
  fetched_at: string;
  total: number;
  by_source: Record<string, number>;
  by_intent: { sim: number; nao: number; none: number };
  daily: Array<{ date: string; count: number }>;
}

const RANGE_OPTIONS = [
  { key: '7d',  label: '7 dias',  days: 7 },
  { key: '28d', label: '28 dias', days: 28 },
  { key: '90d', label: '90 dias', days: 90 },
] as const;

function fmtDuration(sec: number) {
  if (sec < 1) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function shortenPath(path: string, max = 38) {
  if (path.length <= max) return path;
  return path.slice(0, max - 1) + '…';
}

export function Acquisition({ token }: { token: string }) {
  const [data, setData] = useState<AcquisitionData | null>(null);
  const [leads, setLeads] = useState<LeadsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<typeof RANGE_OPTIONS[number]['key']>('28d');
  const [refreshing, setRefreshing] = useState(false);

  const load = async (forceRefresh = false) => {
    setLoading(!data);
    if (forceRefresh) setRefreshing(true);
    setError(null);
    try {
      const days = RANGE_OPTIONS.find((r) => r.key === range)?.days || 28;
      const refresh = forceRefresh ? `&refresh=${Date.now()}` : '';
      const [rGa4, rLeads] = await Promise.all([
        fetch(`/api/admin-bookings?endpoint=ga4-acquisition&range=${days}${refresh}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/admin-bookings?endpoint=sheets-leads&range=${days}${refresh}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      const [jGa4, jLeads] = await Promise.all([rGa4.json(), rLeads.json()]);
      if (!rGa4.ok) throw new Error(jGa4.error || `GA4 HTTP ${rGa4.status}`);
      if (!rLeads.ok) throw new Error(jLeads.error || `Leads HTTP ${rLeads.status}`);
      setData(jGa4);
      setLeads(jLeads);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar dados');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [range]);

  const channelsForBar = (data?.channels || []).map(c => ({
    label:    c.label,
    value:    c.sessions,
    category: c.category as ChannelCategory,
  }));

  return (
    <div className="px-8 py-6 text-white max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#c5a3d4]/60">Página 2 · Aquisição</p>
          <h1 className="font-headline text-3xl font-black mt-1">Aquisição</h1>
          <p className="text-[#d4baeb]/60 text-sm mt-1">
            De onde vem o tráfego e qual canal traz a melhor qualidade
          </p>
        </div>

        {/* Range picker */}
        <div className="flex items-center gap-1 p-1 rounded-lg bg-white/[0.04] border border-white/[0.08]">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setRange(opt.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors
                ${range === opt.key ? 'bg-[#7a3f8f]/20 text-white' : 'text-[#d4baeb]/60 hover:text-white'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Source badge */}
      <div className="mb-6">
        <DataSourceBadge
          sources={[
            { label: 'GA4',    detail: 'tráfego + canais',         status: error ? 'error' : 'live' },
            { label: 'Sheets', detail: 'leads · captura de form',  status: 'live' },
          ]}
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
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
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
          label="Usuários"
          value={data ? data.kpis.users.value.toLocaleString('pt-BR') : '—'}
          deltaPct={data?.kpis.users.deltaPct ?? null}
          deltaLabel={`vs ${RANGE_OPTIONS.find((r) => r.key === range)?.label} anteriores`}
          icon={Users} source="GA4"
          hint="Pessoas únicas no período"
          loading={loading}
        />
        <KpiCard
          label="Tráfego pago"
          value={data ? `${(data.kpis.paidShare.value * 100).toFixed(0)}%` : '—'}
          deltaPct={data?.kpis.paidShare.deltaPct ?? null}
          deltaLabel={`vs ${RANGE_OPTIONS.find((r) => r.key === range)?.label} anteriores`}
          icon={Megaphone} source="GA4"
          hint="% sessões de paid_social + paid_search"
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
      </div>

      {/* Leads no período — métrica de captura crítica pra avaliar campanha */}
      <div className="rounded-2xl border border-[#7a3f8f]/30 bg-gradient-to-r from-[#7a3f8f]/10 via-transparent to-[#e87060]/10 p-5 mb-6">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-[#c5a3d4]/70 font-bold">Leads capturados no período</p>
            <p className="font-black text-4xl text-white tabular-nums mt-1">
              {loading ? '—' : (leads?.total ?? 0).toLocaleString('pt-BR')}
            </p>
            <p className="text-[11px] text-[#d4baeb]/50 mt-1">
              {leads ? `~${(leads.total / Math.max(RANGE_OPTIONS.find(r => r.key === range)?.days || 28, 1)).toFixed(1)} leads/dia em média` : ''}
            </p>
          </div>
          <div className="flex items-baseline gap-6 text-sm">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/40 font-semibold">Hero</p>
              <p className="text-white font-black tabular-nums text-2xl mt-0.5">
                {loading ? '—' : (leads?.by_source.hero ?? 0).toLocaleString('pt-BR')}
              </p>
              <p className="text-[9px] text-white/30 mt-0.5">acima da dobra</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/40 font-semibold">Footer</p>
              <p className="text-white font-black tabular-nums text-2xl mt-0.5">
                {loading ? '—' : (leads?.by_source.footer ?? 0).toLocaleString('pt-BR')}
              </p>
              <p className="text-[9px] text-white/30 mt-0.5">perto do mapa</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[#e87060]/80 font-semibold">High intent 🔥</p>
              <p className="text-[#e87060] font-black tabular-nums text-2xl mt-0.5">
                {loading ? '—' : (leads?.by_intent.sim ?? 0).toLocaleString('pt-BR')}
              </p>
              <p className="text-[9px] text-[#e87060]/60 mt-0.5">"Vai pra Joinville: Sim"</p>
            </div>
          </div>
        </div>
        {/* Daily leads trend (compact sparkline) */}
        {leads && leads.daily.length > 0 && (
          <div className="mt-2 flex items-end gap-0.5 h-10 border-t border-white/[0.06] pt-2">
            {leads.daily.map(d => {
              const max = Math.max(...leads.daily.map(x => x.count), 1);
              const heightPct = (d.count / max) * 100;
              return (
                <div key={d.date} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                  <div className="w-full rounded-t" style={{ height: `${Math.max(heightPct, d.count > 0 ? 4 : 0)}%`, background: '#7a3f8f' }} />
                  <div className="absolute -top-7 px-1.5 py-0.5 rounded bg-black/80 text-[9px] text-white opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-10">
                    {d.date.slice(5)}: {d.count}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Channels (full width) */}
      <div className="grid grid-cols-1 gap-3 mb-6">
        <ChannelBar
          title="Distribuição por canal"
          data={channelsForBar}
          unit="sessões"
          source="GA4"
          loading={loading}
        />
      </div>

      {/* Sources + Campaigns side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-6">
        <DataTable
          title="Fontes (source / medium)"
          source="GA4"
          loading={loading}
          rows={(data?.sources || []).map((s) => ({
            source:     s.source,
            medium:     s.medium,
            sessions:   s.sessions,
            engagement: `${(s.engagementRate * 100).toFixed(0)}%`,
          }))}
          columns={[
            { key: 'source',     label: 'Fonte',   align: 'left'  },
            { key: 'medium',     label: 'Médio',   align: 'left'  },
            { key: 'sessions',   label: 'Sessões', align: 'right' },
            { key: 'engagement', label: 'Engaj.',  align: 'right' },
          ]}
          barColumn="sessions"
          maxRows={15}
        />
        <DataTable
          title="Campanhas (UTM)"
          source="GA4"
          loading={loading}
          rows={(data?.campaigns || []).map((c) => ({
            campaign:   c.campaign,
            sessions:   c.sessions,
            engagement: `${(c.engagementRate * 100).toFixed(0)}%`,
          }))}
          columns={[
            { key: 'campaign',   label: 'Campanha', align: 'left'  },
            { key: 'sessions',   label: 'Sessões',  align: 'right' },
            { key: 'engagement', label: 'Engaj.',   align: 'right' },
          ]}
          barColumn="sessions"
          maxRows={10}
        />
      </div>

      {/* Landing pages */}
      <div className="grid grid-cols-1 gap-3">
        <DataTable
          title="Páginas de entrada (landing pages)"
          source="GA4"
          loading={loading}
          rows={(data?.landingPages || []).map((p) => ({
            page:       shortenPath(p.page),
            sessions:   p.sessions,
            engagement: `${(p.engagementRate * 100).toFixed(0)}%`,
            duration:   fmtDuration(p.avgSessionDuration),
          }))}
          columns={[
            { key: 'page',       label: 'Página',       align: 'left'  },
            { key: 'sessions',   label: 'Sessões',      align: 'right' },
            { key: 'engagement', label: 'Engaj.',       align: 'right' },
            { key: 'duration',   label: 'Tempo médio',  align: 'right' },
          ]}
          barColumn="sessions"
          maxRows={10}
        />
      </div>

      {/* Footer note */}
      <p className="text-center text-[10px] text-[#c5a3d4]/30 mt-8 pb-4">
        Dados via Google Analytics Data API · refresh automático a cada 12h
      </p>
    </div>
  );
}
