/**
 * Behavior — Página 6 do Dashboard.
 *
 * Contexto da audiência: device, recorrência, horários, geografia.
 *
 * Dados de 3 fontes:
 *   1. GA4 (?endpoint=ga4-behavior) — device, new/returning, hours, days, cities
 *   2. Sheets bookings (lifetime) — DDD dos clientes que já fecharam ensaio
 *   3. Sheets leads — DDD de quem entrou no funil
 *
 * DDD é inferido do WhatsApp e mapeado pra estado/região brasileira.
 * Cobertura forte porque é onde o pessoal escreve número real
 * (lifetime ~99% de números BR válidos).
 */

import { useEffect, useState } from 'react';
import { Smartphone, RefreshCcw, Clock, MapPin } from 'lucide-react';

import { KpiCard } from '../components/KpiCard';
import { DataSourceBadge } from '../components/DataSourceBadge';

interface BehaviorData {
  range: { start: string; end: string; days: number };
  fetched_at: string;
  next_refresh: string;
  devices: Array<{
    device:   string;
    sessions: number;
    share:    number;
    deltaPct: number | null;
  }>;
  new_vs_returning: {
    new:       { count: number; share: number };
    returning: { count: number; share: number };
  };
  hours: Array<{ hour: number; sessions: number }>;
  peak_hour: { hour: number; sessions: number };
  days_of_week: Array<{ day: number; name: string; sessions: number }>;
  cities: Array<{ city: string; country: string; sessions: number }>;
}

interface DDDEntry { ddd: string; state: string; region: string; count: number }
interface StateEntry { state: string; count: number }

interface SheetsBookingsData {
  total_customers: number;
  total_ensaios:   number;
  by_state:        StateEntry[];
  by_ddd:          DDDEntry[];
}

interface SheetsLeadsData {
  total:    number;
  by_state: StateEntry[];
  by_ddd:   DDDEntry[];
}

const RANGE_OPTIONS = [
  { key: '7d',  label: '7 dias',  days: 7 },
  { key: '28d', label: '28 dias', days: 28 },
  { key: '90d', label: '90 dias', days: 90 },
] as const;

const DEVICE_LABELS: Record<string, string> = {
  mobile:     'Mobile',
  desktop:    'Desktop',
  tablet:     'Tablet',
  'smart tv': 'Smart TV',
};

const DEVICE_COLORS: Record<string, string> = {
  mobile:     '#7a3f8f',
  desktop:    '#e87060',
  tablet:     '#c5a3d4',
  'smart tv': '#a578bb',
};

function fmtHour(h: number) {
  return `${String(h).padStart(2, '0')}h`;
}

export function Behavior({ token }: { token: string }) {
  const [ga4, setGa4] = useState<BehaviorData | null>(null);
  const [bookings, setBookings] = useState<SheetsBookingsData | null>(null);
  const [leads, setLeads] = useState<SheetsLeadsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<typeof RANGE_OPTIONS[number]['key']>('28d');
  const [refreshing, setRefreshing] = useState(false);

  const load = async (forceRefresh = false) => {
    if (!ga4) setLoading(true);
    if (forceRefresh) setRefreshing(true);
    setError(null);
    try {
      const days = RANGE_OPTIONS.find(r => r.key === range)?.days || 28;
      const refresh = forceRefresh ? `&refresh=${Date.now()}` : '';
      const [r1, r2, r3] = await Promise.all([
        fetch(`/api/admin-bookings?endpoint=ga4-behavior&range=${days}${refresh}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/admin-bookings?endpoint=sheets-bookings${refresh}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/admin-bookings?endpoint=sheets-leads&range=${days}${refresh}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      const [j1, j2, j3] = await Promise.all([r1.json(), r2.json(), r3.json()]);
      if (!r1.ok) throw new Error(`GA4: ${j1.error || r1.status}`);
      if (!r2.ok) throw new Error(`Bookings: ${j2.error || r2.status}`);
      if (!r3.ok) throw new Error(`Leads: ${j3.error || r3.status}`);
      setGa4(j1);
      setBookings(j2);
      setLeads(j3);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar dados');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [range]);

  const mobileShare = ga4?.devices.find(d => d.device === 'mobile')?.share ?? 0;
  const returningShare = ga4?.new_vs_returning.returning.share ?? 0;
  const topState = bookings?.by_state[0];

  const hoursMax = Math.max(...(ga4?.hours.map(h => h.sessions) || [1]), 1);
  const daysMax = Math.max(...(ga4?.days_of_week.map(d => d.sessions) || [1]), 1);

  return (
    <div className="px-8 py-6 text-white max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#c5a3d4]/60">Página 6 · Comportamento</p>
          <h1 className="font-headline text-3xl font-black mt-1">Comportamento</h1>
          <p className="text-[#d4baeb]/60 text-sm mt-1">
            Quem é a audiência: device, recorrência, horários, geografia via DDD
          </p>
        </div>

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

      <div className="mb-6">
        <DataSourceBadge
          sources={[
            { label: 'GA4',    detail: 'device · horas · recorrência',  status: error ? 'error' : 'live' },
            { label: 'Sheets', detail: 'DDD via WhatsApp (lifetime)',   status: 'live' },
          ]}
          lastFetched={ga4?.fetched_at}
          nextRefresh={ga4?.next_refresh}
          onRefresh={() => load(true)}
          refreshing={refreshing}
        />
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 text-amber-200 text-sm">
          <p className="font-bold">Não foi possível buscar dados</p>
          <p className="text-amber-200/70 mt-1">{error}</p>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KpiCard
          label="Mobile"
          value={loading ? '—' : `${(mobileShare * 100).toFixed(0)}%`}
          icon={Smartphone} source="GA4"
          hint="% sessões em celular"
          loading={loading}
        />
        <KpiCard
          label="Recorrentes"
          value={loading ? '—' : `${(returningShare * 100).toFixed(0)}%`}
          icon={RefreshCcw} source="GA4"
          hint="% sessões de usuários que já visitaram antes"
          loading={loading}
        />
        <KpiCard
          label="Pico horário"
          value={loading || !ga4?.peak_hour ? '—' : fmtHour(ga4.peak_hour.hour)}
          icon={Clock} source="GA4"
          hint={ga4?.peak_hour ? `${ga4.peak_hour.sessions} sessões nesse horário` : ''}
          loading={loading}
        />
        <KpiCard
          label="Top estado (clientes)"
          value={loading || !topState ? '—' : topState.state}
          icon={MapPin} source="Sheets"
          hint={topState ? `${topState.count} cliente${topState.count === 1 ? '' : 's'} com DDD desse estado` : ''}
          loading={loading}
        />
      </div>

      {/* Device + Recorrência (side-by-side) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-6">
        {/* Device breakdown */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-sm font-bold text-white">Device</h3>
            <p className="text-[9px] uppercase tracking-wider text-[#c5a3d4]/30">GA4</p>
          </div>
          <div className="space-y-2.5">
            {loading ? (
              [...Array(2)].map((_, i) => <div key={i} className="h-8 bg-white/[0.02] rounded animate-pulse" />)
            ) : (ga4?.devices || []).map(d => {
              const max = Math.max(...(ga4?.devices.map(x => x.sessions) || [1]), 1);
              const widthPct = (d.sessions / max) * 100;
              return (
                <div key={d.device}>
                  <div className="flex items-baseline justify-between text-xs mb-1">
                    <span className="text-white font-medium capitalize">{DEVICE_LABELS[d.device] || d.device}</span>
                    <span className="tabular-nums">
                      <span className="text-white font-semibold">{d.sessions.toLocaleString('pt-BR')}</span>
                      <span className="text-[#c5a3d4]/50 ml-1.5">({(d.share * 100).toFixed(0)}%)</span>
                    </span>
                  </div>
                  <div className="h-2 bg-white/[0.04] rounded overflow-hidden">
                    <div className="h-full rounded transition-all duration-500"
                      style={{ width: `${widthPct}%`, background: DEVICE_COLORS[d.device] || '#a578bb' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* New vs Returning */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-sm font-bold text-white">Novos vs Recorrentes</h3>
            <p className="text-[9px] uppercase tracking-wider text-[#c5a3d4]/30">GA4</p>
          </div>
          <div className="space-y-2.5">
            {loading ? (
              [...Array(2)].map((_, i) => <div key={i} className="h-8 bg-white/[0.02] rounded animate-pulse" />)
            ) : (
              <>
                {[
                  { key: 'new',       label: 'Novos',       data: ga4?.new_vs_returning.new,       color: '#7a3f8f' },
                  { key: 'returning', label: 'Recorrentes', data: ga4?.new_vs_returning.returning, color: '#e87060' },
                ].map(row => (
                  <div key={row.key}>
                    <div className="flex items-baseline justify-between text-xs mb-1">
                      <span className="text-white font-medium">{row.label}</span>
                      <span className="tabular-nums">
                        <span className="text-white font-semibold">{(row.data?.count ?? 0).toLocaleString('pt-BR')}</span>
                        <span className="text-[#c5a3d4]/50 ml-1.5">({((row.data?.share ?? 0) * 100).toFixed(0)}%)</span>
                      </span>
                    </div>
                    <div className="h-2 bg-white/[0.04] rounded overflow-hidden">
                      <div className="h-full rounded"
                        style={{ width: `${(row.data?.share ?? 0) * 100}%`, background: row.color }} />
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Geografia via DDD — Clientes vs Leads side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-6">
        <GeoCard
          title="Clientes por estado"
          subtitle="DDD do WhatsApp · planilha agendamentos (lifetime)"
          source="Sheets"
          states={bookings?.by_state || []}
          ddds={bookings?.by_ddd || []}
          loading={loading}
        />
        <GeoCard
          title="Leads por estado"
          subtitle={`DDD do WhatsApp · período de ${RANGE_OPTIONS.find(r => r.key === range)?.label}`}
          source="Sheets"
          states={leads?.by_state || []}
          ddds={leads?.by_ddd || []}
          loading={loading}
        />
      </div>

      {/* Hora do dia (24 bars) */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-5 mb-6">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-white">Sessões por hora do dia</h3>
            <p className="text-[11px] text-[#d4baeb]/50 mt-0.5">
              Quando o pessoal entra no site (horário do usuário, agregado)
            </p>
          </div>
          <p className="text-[9px] uppercase tracking-wider text-[#c5a3d4]/30">GA4</p>
        </div>
        <div className="flex items-end gap-1 h-32">
          {loading ? (
            <div className="w-full h-full bg-white/[0.02] rounded animate-pulse" />
          ) : (ga4?.hours || []).map(h => {
            const heightPct = (h.sessions / hoursMax) * 100;
            const isPeak = h.hour === ga4?.peak_hour.hour;
            return (
              <div key={h.hour} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                <div
                  className="w-full rounded-t transition-all duration-300"
                  style={{
                    height:     `${Math.max(heightPct, h.sessions > 0 ? 4 : 0)}%`,
                    background: isPeak ? '#e87060' : '#7a3f8f',
                  }}
                />
                <span className="text-[9px] text-[#c5a3d4]/40 mt-1 tabular-nums">
                  {h.hour % 3 === 0 ? fmtHour(h.hour) : ''}
                </span>
                <div className="absolute -top-8 px-2 py-1 rounded bg-black/80 text-[10px] text-white tabular-nums opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-10">
                  {fmtHour(h.hour)}: {h.sessions}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Dia da semana */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-5 mb-6">
        <div className="flex items-baseline justify-between mb-4">
          <h3 className="text-sm font-bold text-white">Sessões por dia da semana</h3>
          <p className="text-[9px] uppercase tracking-wider text-[#c5a3d4]/30">GA4</p>
        </div>
        <div className="flex items-end gap-2 h-24">
          {loading ? (
            <div className="w-full h-full bg-white/[0.02] rounded animate-pulse" />
          ) : (ga4?.days_of_week || []).map(d => {
            const heightPct = (d.sessions / daysMax) * 100;
            return (
              <div key={d.day} className="flex-1 flex flex-col items-center justify-end h-full">
                <span className="text-[10px] text-[#c5a3d4]/60 tabular-nums mb-1">{d.sessions}</span>
                <div className="w-full rounded-t transition-all duration-300"
                  style={{ height: `${Math.max(heightPct, d.sessions > 0 ? 4 : 0)}%`, background: '#7a3f8f' }} />
                <span className="text-[10px] text-white/60 mt-1">{d.name}</span>
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-center text-[10px] text-[#c5a3d4]/30 mt-8 pb-4">
        Geografia inferida do DDD do WhatsApp (~99% precisão pra origem do número).
        Cidades do GA4 são aproximadas via IP.
      </p>
    </div>
  );
}

/* Componente reusável pro card de geografia */
function GeoCard({
  title, subtitle, source, states, ddds, loading,
}: {
  title: string; subtitle: string; source: string;
  states: StateEntry[]; ddds: DDDEntry[]; loading: boolean;
}) {
  const total = states.reduce((s, e) => s + e.count, 0);
  const max = states[0]?.count || 1;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-5">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h3 className="text-sm font-bold text-white">{title}</h3>
          <p className="text-[11px] text-[#d4baeb]/50 mt-0.5">{subtitle}</p>
        </div>
        <p className="text-[9px] uppercase tracking-wider text-[#c5a3d4]/30">{source}</p>
      </div>
      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <div key={i} className="h-7 bg-white/[0.02] rounded animate-pulse" />)}
        </div>
      ) : states.length === 0 ? (
        <p className="text-[11px] text-[#c5a3d4]/40 italic">Sem dados de DDD no período</p>
      ) : (
        <div className="space-y-2">
          {states.slice(0, 10).map(s => {
            const widthPct = (s.count / max) * 100;
            const sharePct = total > 0 ? (s.count / total) * 100 : 0;
            // Pega o DDD principal desse estado (maior count)
            const topDDD = ddds.find(d => d.state === s.state);
            return (
              <div key={s.state}>
                <div className="flex items-baseline justify-between text-xs mb-1">
                  <span className="text-white font-medium">
                    <span className="font-bold">{s.state}</span>
                    {topDDD && <span className="text-[10px] text-[#c5a3d4]/50 ml-2">({topDDD.region})</span>}
                  </span>
                  <span className="tabular-nums">
                    <span className="text-white font-semibold">{s.count}</span>
                    <span className="text-[#c5a3d4]/50 ml-1.5">({sharePct.toFixed(0)}%)</span>
                  </span>
                </div>
                <div className="h-2 bg-white/[0.04] rounded overflow-hidden">
                  <div className="h-full rounded"
                    style={{ width: `${widthPct}%`, background: '#7a3f8f' }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
