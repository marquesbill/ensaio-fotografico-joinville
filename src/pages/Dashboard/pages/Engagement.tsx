/**
 * Engagement — Página 4 do Dashboard.
 *
 * Mede engajamento qualitativo: tempo de sessão, scroll depth, formulários,
 * FAQ. Complementa o Funil (que diz ONDE caem) explicando POR QUE caem.
 *
 * Dados via /api/admin-bookings?endpoint=ga4-engagement&range=N.
 */

import { useEffect, useState } from 'react';
import { Clock, Sparkles, Layers, LogOut as Bounce } from 'lucide-react';

import { KpiCard } from '../components/KpiCard';
import { DataTable } from '../components/DataTable';
import { DataSourceBadge } from '../components/DataSourceBadge';

interface EngagementData {
  range: { start: string; end: string; days: number };
  fetched_at: string;
  next_refresh: string;
  kpis: {
    avgSessionDuration: { value: number; deltaPct: number | null }; // seconds
    engagementRate:     { value: number; deltaPct: number | null }; // 0..1
    pagesPerSession:    { value: number; deltaPct: number | null };
    bounceRate:         { value: number; deltaPct: number | null }; // 0..1
  };
  scrollDepth: Array<{ depth: number; sessions: number }>;
  forms: {
    hero:   { started: number; attempt: number; success: number; error: number; blocked: number };
    footer: { started: number; attempt: number; success: number; error: number; blocked: number };
  };
  faq: Array<{ idx: number; opens: number }>;
  topEvents: Array<{ event_name: string; count: number }>;
}

const RANGE_OPTIONS = [
  { key: '7d',  label: '7 dias',  days: 7 },
  { key: '28d', label: '28 dias', days: 28 },
  { key: '90d', label: '90 dias', days: 90 },
] as const;

// Mantém sincronizado com src/App.tsx FAQ array
const FAQ_QUESTIONS = [
  'Quando serão os ensaios?',
  'Onde serão feitas as fotos?',
  'Quem pode fazer o ensaio?',
  'Quanto tempo dura o ensaio?',
  'O que eu vou receber?',
  'Serão quantos lotes?',
  'Quais são as formas de pagamento?',
  'Tem pacote especial para grupos?',
];

function fmtDuration(sec: number) {
  if (sec < 1) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function FormFunnel({ title, data }: { title: string; data: { started: number; attempt: number; success: number; error: number; blocked: number } }) {
  const conv = data.started > 0 ? (data.success / data.started) * 100 : 0;
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
      <p className="text-[11px] font-bold uppercase tracking-widest text-[#c5a3d4]/70">{title}</p>
      <div className="mt-3 space-y-1.5">
        {[
          { label: 'Iniciou (focou em campo)',   value: data.started },
          { label: 'Tentou submeter',            value: data.attempt },
          { label: 'Enviou com sucesso',         value: data.success },
          { label: 'Bloqueado por validação',    value: data.blocked },
          { label: 'Erro de rede',               value: data.error },
        ].map(row => {
          const widthPct = data.started > 0 ? (row.value / data.started) * 100 : 0;
          return (
            <div key={row.label}>
              <div className="flex items-baseline justify-between text-[11px] mb-0.5">
                <span className="text-[#d4baeb]/70 truncate">{row.label}</span>
                <span className="tabular-nums text-white font-semibold">{row.value.toLocaleString('pt-BR')}</span>
              </div>
              <div className="h-1.5 bg-white/5 rounded overflow-hidden">
                <div
                  className="h-full rounded"
                  style={{
                    width:      `${Math.max(widthPct, row.value > 0 ? 2 : 0)}%`,
                    background: 'linear-gradient(90deg, #7a3f8f 0%, #e87060 100%)',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 pt-3 border-t border-white/[0.06] flex items-baseline justify-between">
        <span className="text-[11px] text-[#d4baeb]/60">Taxa start→sucesso</span>
        <span className="tabular-nums text-[#e87060] font-bold">
          {data.started > 0 ? `${conv.toFixed(1)}%` : '—'}
        </span>
      </div>
    </div>
  );
}

export function Engagement({ token }: { token: string }) {
  const [data, setData] = useState<EngagementData | null>(null);
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
      const r = await fetch(`/api/admin-bookings?endpoint=ga4-engagement&range=${days}${forceRefresh ? '&refresh=1' : ''}`, {
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

  const scrollTop = data?.scrollDepth?.[0]?.sessions || 0;

  return (
    <div className="px-8 py-6 text-white max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#c5a3d4]/60">Página 4 · Engajamento</p>
          <h1 className="font-headline text-3xl font-black mt-1">Engajamento</h1>
          <p className="text-[#d4baeb]/60 text-sm mt-1">
            Como visitantes interagem com o conteúdo (scroll, formulário, FAQ)
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
          sources={[{ label: 'GA4', detail: 'property 494185724', status: error ? 'error' : 'live' }]}
          lastFetched={data?.fetched_at}
          nextRefresh={data?.next_refresh}
          onRefresh={() => load(true)}
          refreshing={refreshing}
        />
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 text-amber-200 text-sm">
          <p className="font-bold">Não foi possível buscar dados ao vivo</p>
          <p className="text-amber-200/70 mt-1">{error}</p>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KpiCard
          label="Tempo médio na sessão"
          value={data ? fmtDuration(data.kpis.avgSessionDuration.value) : '—'}
          deltaPct={data?.kpis.avgSessionDuration.deltaPct ?? null}
          deltaLabel={`vs ${RANGE_OPTIONS.find((r) => r.key === range)?.label} anteriores`}
          icon={Clock} source="GA4"
          hint="Quanto tempo em média gente fica no site"
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
          label="Páginas/sessão"
          value={data ? data.kpis.pagesPerSession.value.toFixed(1) : '—'}
          deltaPct={data?.kpis.pagesPerSession.deltaPct ?? null}
          deltaLabel={`vs ${RANGE_OPTIONS.find((r) => r.key === range)?.label} anteriores`}
          icon={Layers} source="GA4"
          hint="Profundidade de navegação por visita"
          loading={loading}
        />
        <KpiCard
          label="Taxa de rejeição"
          value={data ? `${(data.kpis.bounceRate.value * 100).toFixed(1)}%` : '—'}
          deltaPct={data?.kpis.bounceRate.deltaPct ?? null}
          deltaLabel={`vs ${RANGE_OPTIONS.find((r) => r.key === range)?.label} anteriores`}
          icon={Bounce} source="GA4"
          hint="% sessões <10s ou 1 só pageview (menor = melhor)"
          loading={loading}
        />
      </div>

      {/* Scroll depth */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-5 mb-6">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-white">Profundidade de scroll</h3>
            <p className="text-[11px] text-[#d4baeb]/50 mt-0.5">
              Quantas sessões chegaram em cada % da página
            </p>
          </div>
          <p className="text-[9px] uppercase tracking-wider text-[#c5a3d4]/30">GA4</p>
        </div>
        <div className="space-y-3">
          {loading ? (
            [...Array(4)].map((_, i) => (
              <div key={i} className="h-10 bg-white/[0.02] rounded animate-pulse" />
            ))
          ) : (data?.scrollDepth || []).map((s) => {
            const widthPct = scrollTop > 0 ? (s.sessions / scrollTop) * 100 : 0;
            const sharePct = scrollTop > 0 ? (s.sessions / scrollTop) * 100 : 0;
            return (
              <div key={s.depth}>
                <div className="flex items-baseline justify-between text-xs mb-1.5">
                  <span className="text-white font-semibold">
                    Alcançou {s.depth}% da página
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="tabular-nums text-white font-bold">
                      {s.sessions.toLocaleString('pt-BR')}
                    </span>
                    <span className="text-[10px] text-[#c5a3d4]/60 tabular-nums w-12 text-right">
                      {sharePct.toFixed(0)}%
                    </span>
                  </div>
                </div>
                <div className="h-4 bg-white/[0.04] rounded overflow-hidden">
                  <div
                    className="h-full rounded transition-all duration-500"
                    style={{
                      width:      `${Math.max(widthPct, s.sessions > 0 ? 2 : 0)}%`,
                      background: 'linear-gradient(90deg, #7a3f8f 0%, #e87060 100%)',
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Forms (hero + footer) */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-5 mb-6">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-white">Formulários</h3>
            <p className="text-[11px] text-[#d4baeb]/50 mt-0.5">
              Funil de cada formulário: focar campo → tentar → enviar
            </p>
          </div>
          <p className="text-[9px] uppercase tracking-wider text-[#c5a3d4]/30">GA4 · custom events</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {loading ? (
            [...Array(2)].map((_, i) => (
              <div key={i} className="h-48 bg-white/[0.02] rounded-xl animate-pulse" />
            ))
          ) : (
            <>
              <FormFunnel title="Hero (acima da dobra)" data={data?.forms.hero || { started: 0, attempt: 0, success: 0, error: 0, blocked: 0 }} />
              <FormFunnel title="Footer (perto do mapa)" data={data?.forms.footer || { started: 0, attempt: 0, success: 0, error: 0, blocked: 0 }} />
            </>
          )}
        </div>
      </div>

      {/* FAQ + Top events */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <DataTable
          title="FAQ — perguntas mais abertas"
          source="GA4"
          loading={loading}
          rows={(data?.faq || []).map((f) => ({
            num:      `${f.idx + 1}.`,
            question: FAQ_QUESTIONS[f.idx] || `Pergunta #${f.idx + 1}`,
            opens:    f.opens,
          }))}
          columns={[
            { key: 'num',      label: '#',        align: 'left',  width: '32px' },
            { key: 'question', label: 'Pergunta', align: 'left'  },
            { key: 'opens',    label: 'Aberturas', align: 'right' },
          ]}
          barColumn="opens"
          maxRows={8}
        />
        <DataTable
          title="Eventos mais frequentes"
          source="GA4"
          loading={loading}
          rows={(data?.topEvents || []).map((e) => ({
            event_name: e.event_name,
            count:      e.count,
          }))}
          columns={[
            { key: 'event_name', label: 'Evento',     align: 'left'  },
            { key: 'count',      label: 'Quantidade', align: 'right' },
          ]}
          barColumn="count"
          maxRows={20}
        />
      </div>

      <p className="text-center text-[10px] text-[#c5a3d4]/30 mt-8 pb-4">
        Dados via Google Analytics Data API · refresh automático a cada 12h
      </p>
    </div>
  );
}
