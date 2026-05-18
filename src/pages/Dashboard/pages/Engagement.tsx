/**
 * Engagement — Página 4 do Dashboard.
 *
 * Mede engajamento qualitativo: tempo de sessão, scroll depth, formulários,
 * FAQ. Complementa o Funil (que diz ONDE caem) explicando POR QUE caem.
 *
 * Dados via /api/admin-bookings?endpoint=ga4-engagement&range=N.
 */

import { useEffect, useState } from 'react';
import { Clock, Sparkles, Layers, LogOut as Bounce, Zap, MousePointerClick, MoveVertical, Undo2, AlertTriangle, AlertCircle, Users, BookOpen, MoveDown, Timer } from 'lucide-react';

import { KpiCard } from '../components/KpiCard';
import { DataTable } from '../components/DataTable';
import { DataSourceBadge } from '../components/DataSourceBadge';
import { BrazilMap } from '../components/BrazilMap';

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

interface ClarityFrictionMetric {
  pct:      number; // 0..1
  sessions: number;
  total:    number;
}

interface ClarityData {
  range:        { days: number; note: string };
  fetched_at:   string;
  next_refresh: string;
  friction: {
    rageClicks:      ClarityFrictionMetric;
    deadClicks:      ClarityFrictionMetric;
    excessiveScroll: ClarityFrictionMetric;
    quickBacks:      ClarityFrictionMetric;
    scriptErrors:    ClarityFrictionMetric;
    errorClicks:     ClarityFrictionMetric;
  };
  kpis: {
    sessions:           number;
    botSessions:        number;
    pagesPerSession:    number;
    averageScrollDepth: number; // 0..100
    activeTime:         number; // seconds (assume)
    totalTime:          number;
  };
  cache_hit?: boolean;
}

type GeoMetric = 'leads' | 'clientes' | 'sessions' | 'impressions';

interface GeoBrazilData {
  range:        { days: number };
  fetched_at:   string;
  next_refresh: string;
  states:       Record<string, { leads: number; clientes: number; sessions: number; impressions: number }>;
  sources:      Record<GeoMetric, boolean>;
  errors:       Record<GeoMetric, string | null>;
}

const GEO_METRICS: Array<{ key: GeoMetric; label: string; tooltipLabel: string }> = [
  { key: 'leads',       label: 'Leads',       tooltipLabel: 'leads'       },
  { key: 'clientes',    label: 'Clientes',    tooltipLabel: 'clientes'    },
  { key: 'sessions',    label: 'Sessões',     tooltipLabel: 'sessões'     },
  { key: 'impressions', label: 'Impressões',  tooltipLabel: 'impressões'  },
];

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

// Clarity pode retornar tempo em segundos OU milissegundos — auto-detecta:
// se > 86400 (1 dia em segundos) assume ms e divide. Funciona pra ranges
// até 24h por sessão; nesse projeto sessão média <5min, então safe.
function fmtClarityTime(raw: number): string {
  if (!raw || raw < 0.001) return '—';
  const sec = raw > 86400 ? raw / 1000 : raw;
  return fmtDuration(sec);
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
  const [clarity, setClarity] = useState<ClarityData | null>(null);
  const [clarityError, setClarityError] = useState<string | null>(null);
  const [geo, setGeo] = useState<GeoBrazilData | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoMetric, setGeoMetric] = useState<GeoMetric>('leads');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<typeof RANGE_OPTIONS[number]['key']>('28d');
  const [refreshing, setRefreshing] = useState(false);

  const load = async (forceRefresh = false) => {
    setLoading(!data);
    if (forceRefresh) setRefreshing(true);
    setError(null);
    setClarityError(null);
    setGeoError(null);
    const days = RANGE_OPTIONS.find((r) => r.key === range)?.days || 28;
    const refreshQs = forceRefresh ? '&refresh=1' : '';

    // GA4 (principal) — falha bloqueia a página
    try {
      const r = await fetch(`/api/admin-bookings?endpoint=ga4-engagement&range=${days}${refreshQs}`, {
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

    // Clarity (complementar) — falha só esconde a seção, não bloqueia GA4.
    // Janela fixa em 3d (limite da API), independe do seletor 7d/28d/90d.
    try {
      const r = await fetch(`/api/admin-bookings?endpoint=clarity-insights&days=3${refreshQs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`);
      setClarity(json);
    } catch (e: unknown) {
      setClarityError(e instanceof Error ? e.message : 'Erro ao carregar Clarity');
      setClarity(null);
    }

    // Geo Brasil (complementar) — falha só esconde o mapa
    try {
      const r = await fetch(`/api/admin-bookings?endpoint=geo-brazil&range=${days}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`);
      setGeo(json);
    } catch (e: unknown) {
      setGeoError(e instanceof Error ? e.message : 'Erro ao carregar dados geográficos');
      setGeo(null);
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
          sources={[
            { label: 'GA4',     detail: 'property 494185724', status: error        ? 'error' : 'live' },
            { label: 'Clarity', detail: 'project ws5wo65fne · janela 3d', status: clarityError ? 'error' : clarity ? 'live' : 'stale' },
          ]}
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

      {/* KPIs Clarity (4 cards complementares) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KpiCard
          label="Sessões"
          value={clarity ? clarity.kpis.sessions.toLocaleString('pt-BR') : '—'}
          icon={Users} source="Clarity"
          hint={clarity ? `${clarity.kpis.botSessions.toLocaleString('pt-BR')} sessões de bot excluídas` : 'Sessões reais (bots já excluídos)'}
          loading={!clarity && !clarityError}
        />
        <KpiCard
          label="Páginas por sessão"
          value={clarity ? clarity.kpis.pagesPerSession.toFixed(2).replace('.', ',') : '—'}
          icon={BookOpen} source="Clarity"
          hint="Média de páginas vistas por sessão"
          loading={!clarity && !clarityError}
        />
        <KpiCard
          label="Profundidade de rolagem"
          value={clarity ? `${clarity.kpis.averageScrollDepth.toFixed(2).replace('.', ',')}%` : '—'}
          icon={MoveDown} source="Clarity"
          hint="Média do quanto o usuário rola na página"
          loading={!clarity && !clarityError}
        />
        <KpiCard
          label="Tempo ativo gasto"
          value={clarity ? fmtClarityTime(clarity.kpis.activeTime) : '—'}
          icon={Timer} source="Clarity"
          hint={clarity ? `de ${fmtClarityTime(clarity.kpis.totalTime)} tempo total` : 'Tempo de interação ativa (active vs total)'}
          loading={!clarity && !clarityError}
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

      {/* ───────── Sinais de fricção (Clarity) ───────── */}
      <div className="mt-8">
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <h2 className="font-headline text-xl font-black text-white">Sinais de fricção</h2>
            <p className="text-[#d4baeb]/60 text-xs mt-0.5">
              Onde o usuário tem dificuldade — clicks frustrados, scroll excessivo, errors. Via Microsoft Clarity.
            </p>
          </div>
          <p className="text-[10px] uppercase tracking-wider text-[#c5a3d4]/40 whitespace-nowrap ml-4">
            últimos 3 dias · limite da API
          </p>
        </div>

        {clarityError && (
          <div className="mb-4 p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 text-amber-200 text-sm">
            <p className="font-bold">Clarity indisponível</p>
            <p className="text-amber-200/70 mt-1">{clarityError}</p>
            <p className="text-amber-200/50 text-xs mt-2">
              Verifique se <code className="px-1 bg-amber-500/10 rounded">CLARITY_API_TOKEN</code> está configurado nas env vars da Vercel.
            </p>
          </div>
        )}

        {!clarityError && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <KpiCard
              label="Rage clicks"
              value={clarity ? `${(clarity.friction.rageClicks.pct * 100).toFixed(1)}%` : '—'}
              icon={Zap} source="Clarity"
              hint={clarity ? `${clarity.friction.rageClicks.sessions.toLocaleString('pt-BR')} de ${clarity.friction.rageClicks.total.toLocaleString('pt-BR')} sessões — clicks rápidos repetidos (frustração)` : 'Clicks rápidos repetidos no mesmo lugar — indica frustração'}
              loading={!clarity && !clarityError}
            />
            <KpiCard
              label="Dead clicks"
              value={clarity ? `${(clarity.friction.deadClicks.pct * 100).toFixed(1)}%` : '—'}
              icon={MousePointerClick} source="Clarity"
              hint={clarity ? `${clarity.friction.deadClicks.sessions.toLocaleString('pt-BR')} de ${clarity.friction.deadClicks.total.toLocaleString('pt-BR')} sessões — clicaram em algo que não respondeu` : 'Clicks em elementos que não respondem — UX quebrada'}
              loading={!clarity && !clarityError}
            />
            <KpiCard
              label="Excessive scroll"
              value={clarity ? `${(clarity.friction.excessiveScroll.pct * 100).toFixed(1)}%` : '—'}
              icon={MoveVertical} source="Clarity"
              hint={clarity ? `${clarity.friction.excessiveScroll.sessions.toLocaleString('pt-BR')} de ${clarity.friction.excessiveScroll.total.toLocaleString('pt-BR')} sessões — não acharam o que procuravam` : 'Sessões com scroll demais — não acharam o que procuravam'}
              loading={!clarity && !clarityError}
            />
            <KpiCard
              label="Quick backs"
              value={clarity ? `${(clarity.friction.quickBacks.pct * 100).toFixed(1)}%` : '—'}
              icon={Undo2} source="Clarity"
              hint={clarity ? `${clarity.friction.quickBacks.sessions.toLocaleString('pt-BR')} de ${clarity.friction.quickBacks.total.toLocaleString('pt-BR')} sessões — voltaram rápido (página decepcionou)` : 'Voltaram pra trás em <5s — página decepcionou'}
              loading={!clarity && !clarityError}
            />
            <KpiCard
              label="Script errors"
              value={clarity ? `${(clarity.friction.scriptErrors.pct * 100).toFixed(1)}%` : '—'}
              icon={AlertTriangle} source="Clarity"
              hint={clarity ? `${clarity.friction.scriptErrors.sessions.toLocaleString('pt-BR')} de ${clarity.friction.scriptErrors.total.toLocaleString('pt-BR')} sessões com JS error` : 'Sessões com erro de JavaScript — bug em produção'}
              loading={!clarity && !clarityError}
            />
            <KpiCard
              label="Error clicks"
              value={clarity ? `${(clarity.friction.errorClicks.pct * 100).toFixed(1)}%` : '—'}
              icon={AlertCircle} source="Clarity"
              hint={clarity ? `${clarity.friction.errorClicks.sessions.toLocaleString('pt-BR')} de ${clarity.friction.errorClicks.total.toLocaleString('pt-BR')} sessões — click que disparou erro` : 'Click que disparou erro visível na tela'}
              loading={!clarity && !clarityError}
            />
          </div>
        )}

        <div className="mt-4 flex items-center justify-between text-[10px] text-[#c5a3d4]/40">
          <p>
            Para ver session recordings + heatmaps:{' '}
            <a
              href="https://clarity.microsoft.com/projects/view/ws5wo65fne/dashboard"
              target="_blank" rel="noopener noreferrer"
              className="text-[#c5a3d4]/70 hover:text-white underline"
            >
              abrir Clarity ↗
            </a>
          </p>
          {clarity?.cache_hit && <p>cache hit · próx. fetch em ~6h</p>}
        </div>
      </div>

      {/* ───────── Geografia (Brasil) ───────── */}
      <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-5">
        <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
          <div>
            <h2 className="font-headline text-xl font-black text-white">Geografia (Brasil)</h2>
            <p className="text-[#d4baeb]/60 text-xs mt-0.5">
              Distribuição por estado · escolha a métrica abaixo
            </p>
          </div>
          <p className="text-[10px] uppercase tracking-wider text-[#c5a3d4]/40 whitespace-nowrap">
            Leads/Clientes via DDD · Sessões GA4 · Impressões Meta Ads
          </p>
        </div>

        {/* Radio buttons de métrica */}
        <div className="flex flex-wrap gap-2 mb-5">
          {GEO_METRICS.map(m => {
            const available = geo?.sources?.[m.key] !== false;
            const isSelected = geoMetric === m.key;
            return (
              <button
                key={m.key}
                onClick={() => available && setGeoMetric(m.key)}
                disabled={!available}
                className={`px-3 py-2 rounded-lg text-xs font-bold transition-all border
                  ${isSelected
                    ? 'bg-[#7a3f8f]/30 border-[#7a3f8f]/60 text-white'
                    : available
                      ? 'bg-white/[0.02] border-white/10 text-[#d4baeb]/70 hover:bg-white/[0.05] hover:text-white'
                      : 'bg-white/[0.01] border-white/[0.05] text-[#d4baeb]/30 cursor-not-allowed'
                  }`}
              >
                <span className={`inline-block w-2 h-2 rounded-full mr-2 ${isSelected ? 'bg-[#e87060]' : 'bg-white/20'}`} />
                {m.label}
                {!available && <span className="ml-1.5 text-[9px] opacity-60">indisponível</span>}
              </button>
            );
          })}
        </div>

        {geoError && (
          <div className="mb-4 p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 text-amber-200 text-sm">
            <p className="font-bold">Mapa indisponível</p>
            <p className="text-amber-200/70 mt-1">{geoError}</p>
          </div>
        )}

        {!geoError && (
          <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-5">
            <BrazilMap
              data={Object.fromEntries(
                Object.entries(geo?.states || {}).map(([uf, v]) => [uf, v[geoMetric]])
              )}
              metricLabel={GEO_METRICS.find(m => m.key === geoMetric)?.tooltipLabel}
            />

            {/* Top 8 estados */}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-[#c5a3d4]/70 mb-3">
                Top estados · {GEO_METRICS.find(m => m.key === geoMetric)?.label.toLowerCase()}
              </p>
              <div className="space-y-1.5">
                {Object.entries(geo?.states || {})
                  .map(([uf, v]) => ({ uf, value: v[geoMetric] }))
                  .filter(e => e.value > 0)
                  .sort((a, b) => b.value - a.value)
                  .slice(0, 8)
                  .map(({ uf, value }, i, arr) => {
                    const max = arr[0]?.value || 1;
                    return (
                      <div key={uf}>
                        <div className="flex items-baseline justify-between text-xs mb-0.5">
                          <span className="text-white font-semibold tabular-nums">{i + 1}. {uf}</span>
                          <span className="tabular-nums text-white font-bold">{value.toLocaleString('pt-BR')}</span>
                        </div>
                        <div className="h-1 bg-white/5 rounded overflow-hidden">
                          <div
                            className="h-full rounded"
                            style={{
                              width: `${(value / max) * 100}%`,
                              background: 'linear-gradient(90deg, #7a3f8f 0%, #e87060 100%)',
                            }}
                          />
                        </div>
                      </div>
                    );
                  })
                }
                {Object.values(geo?.states || {}).every(v => v[geoMetric] === 0) && (
                  <p className="text-[#d4baeb]/40 text-xs italic">Sem dados pra essa métrica no período.</p>
                )}
              </div>

              {geo?.errors?.[geoMetric] && (
                <p className="mt-3 text-[10px] text-amber-300/70 leading-tight">
                  ⚠ {geo.errors[geoMetric]}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <p className="text-center text-[10px] text-[#c5a3d4]/30 mt-8 pb-4">
        GA4 Data API (12h) · Clarity Live Insights (6h, máx 3 dias · 10 req/dia) · Geo (12h)
      </p>
    </div>
  );
}
