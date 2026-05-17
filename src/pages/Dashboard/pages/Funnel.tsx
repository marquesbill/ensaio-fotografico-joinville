/**
 * Funnel — Página 3 do Dashboard.
 *
 * Mostra o funil GA4 Enhanced Ecommerce:
 *   view_item_list → select_item → begin_checkout → purchase
 *
 * Pra cada step: número absoluto + queda vs step anterior + comparação
 * vs período anterior.
 *
 * Também quebra por pacote (Lembrança / Econômico / Completo) com
 * selects, purchases, taxa de conversão e receita.
 *
 * Dados via /api/admin-bookings?endpoint=ga4-funnel&range=N.
 */

import { useEffect, useState } from 'react';
import { Eye, MousePointerClick, ShoppingCart, CheckCircle2 } from 'lucide-react';

import { KpiCard } from '../components/KpiCard';
import { DataSourceBadge } from '../components/DataSourceBadge';

interface FunnelStep {
  step: string;       // 'view_item_list' | 'select_item' | 'begin_checkout' | 'purchase'
  sessions: number;
  eventCount: number;
  users: number;
  deltaPct: number | null;
}

interface PackageStats {
  id: string;        // 'lembranca' | 'economico' | 'completo'
  selects: number;
  purchases: number;
  revenue: number;
}

interface FunnelData {
  range: { start: string; end: string; days: number };
  fetched_at: string;
  next_refresh: string;
  funnel: FunnelStep[];
  packages: PackageStats[];
}

const RANGE_OPTIONS = [
  { key: '7d',  label: '7 dias',  days: 7 },
  { key: '28d', label: '28 dias', days: 28 },
  { key: '90d', label: '90 dias', days: 90 },
] as const;

const STEP_META: Record<string, { label: string; hint: string; icon: typeof Eye }> = {
  view_item_list:  { label: 'Visualizou pacotes', hint: 'Sessões que viram a seção de preços',           icon: Eye },
  select_item:     { label: 'Selecionou pacote',  hint: 'Sessões que clicaram em "Selecionar"',          icon: MousePointerClick },
  begin_checkout:  { label: 'Iniciou checkout',   hint: 'Sessões que avançaram pra tela de pagamento',   icon: ShoppingCart },
  purchase:        { label: 'Comprou',            hint: 'Sessões com purchase event confirmado (paid)',  icon: CheckCircle2 },
};

const PKG_META: Record<string, { label: string; sublabel: string }> = {
  lembranca: { label: 'Lembrança', sublabel: '30 min · até 2 pessoas' },
  economico: { label: 'Econômico', sublabel: '60 min · até 3 pessoas' },
  completo:  { label: 'Completo',  sublabel: '120 min · até 4 pessoas' },
};

function brl(n: number) {
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function Funnel({ token }: { token: string }) {
  const [data, setData] = useState<FunnelData | null>(null);
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
      const r = await fetch(`/api/admin-bookings?endpoint=ga4-funnel&range=${days}${forceRefresh ? '&refresh=1' : ''}`, {
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

  const funnel = data?.funnel || [];
  const topSessions = funnel[0]?.sessions || 0;
  const finalSessions = funnel[funnel.length - 1]?.sessions || 0;
  const overallConv = topSessions > 0 ? (finalSessions / topSessions) * 100 : 0;

  const pickStep = (name: string) => funnel.find(s => s.step === name);

  return (
    <div className="px-8 py-6 text-white max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#c5a3d4]/60">Página 3 · Funil</p>
          <h1 className="font-headline text-3xl font-black mt-1">Funil de Pacotes</h1>
          <p className="text-[#d4baeb]/60 text-sm mt-1">
            Onde os visitantes caem fora no caminho até a compra
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
        </div>
      )}

      {/* KPIs — um por etapa do funil */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {['view_item_list', 'select_item', 'begin_checkout', 'purchase'].map((stepKey) => {
          const s = pickStep(stepKey);
          const meta = STEP_META[stepKey];
          return (
            <KpiCard
              key={stepKey}
              label={meta.label}
              value={s ? s.sessions.toLocaleString('pt-BR') : '—'}
              deltaPct={s?.deltaPct ?? null}
              deltaLabel={`vs ${RANGE_OPTIONS.find((r) => r.key === range)?.label} anteriores`}
              icon={meta.icon} source="GA4"
              hint={meta.hint}
              loading={loading}
            />
          );
        })}
      </div>

      {/* Funnel viz — bars proporcionais com drop-off entre etapas */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-5 mb-6">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-white">Funil de conversão</h3>
            <p className="text-[11px] text-[#d4baeb]/50 mt-0.5">
              {topSessions > 0
                ? `${overallConv.toFixed(2)}% das sessões que viram pacotes acabaram comprando`
                : 'Aguardando dados de visualização de pacotes…'}
            </p>
          </div>
          <p className="text-[9px] uppercase tracking-wider text-[#c5a3d4]/30">GA4</p>
        </div>

        <div className="space-y-4">
          {loading ? (
            [...Array(4)].map((_, i) => (
              <div key={i} className="h-10 bg-white/[0.02] rounded animate-pulse" />
            ))
          ) : funnel.map((step, idx) => {
            const meta = STEP_META[step.step] || { label: step.step, hint: '', icon: Eye };
            const widthPct = topSessions > 0 ? (step.sessions / topSessions) * 100 : 0;
            const prevSessions = idx > 0 ? funnel[idx - 1].sessions : null;
            const dropPct = prevSessions !== null && prevSessions > 0
              ? ((prevSessions - step.sessions) / prevSessions) * 100
              : null;
            const fromTopPct = topSessions > 0 ? (step.sessions / topSessions) * 100 : 0;

            return (
              <div key={step.step}>
                <div className="flex items-baseline justify-between text-xs mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] text-[#c5a3d4]/40 tabular-nums w-5">{idx + 1}.</span>
                    <span className="text-white font-semibold truncate">{meta.label}</span>
                    <span className="text-[10px] text-[#c5a3d4]/50 truncate hidden sm:inline">· {meta.hint}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="tabular-nums text-white font-bold">
                      {step.sessions.toLocaleString('pt-BR')}
                    </span>
                    <span className="text-[10px] text-[#c5a3d4]/60 tabular-nums w-12 text-right">
                      {fromTopPct.toFixed(1)}%
                    </span>
                  </div>
                </div>
                <div className="h-5 bg-white/[0.04] rounded overflow-hidden relative">
                  <div
                    className="h-full rounded transition-all duration-500"
                    style={{
                      width:      `${Math.max(widthPct, step.sessions > 0 ? 2 : 0)}%`,
                      background: 'linear-gradient(90deg, #7a3f8f 0%, #e87060 100%)',
                    }}
                  />
                </div>
                {dropPct !== null && idx < funnel.length && (
                  <p className="text-[10px] text-amber-300/70 mt-1 ml-7">
                    ↓ {dropPct.toFixed(1)}% caem fora aqui
                    {prevSessions !== null && (
                      <span className="text-[#c5a3d4]/40 ml-2">
                        ({(prevSessions - step.sessions).toLocaleString('pt-BR')} sessões)
                      </span>
                    )}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Per-package breakdown */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-5">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-white">Desempenho por pacote</h3>
            <p className="text-[11px] text-[#d4baeb]/50 mt-0.5">Selects e compras por item</p>
          </div>
          <p className="text-[9px] uppercase tracking-wider text-[#c5a3d4]/30">GA4 · itemId</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {loading ? (
            [...Array(3)].map((_, i) => (
              <div key={i} className="h-40 bg-white/[0.02] rounded-xl animate-pulse" />
            ))
          ) : (data?.packages || []).map(pkg => {
            const meta = PKG_META[pkg.id] || { label: pkg.id, sublabel: '' };
            const convPct = pkg.selects > 0 ? (pkg.purchases / pkg.selects) * 100 : 0;
            return (
              <div key={pkg.id} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
                <p className="text-[11px] font-bold uppercase tracking-widest text-[#c5a3d4]/70">{meta.label}</p>
                <p className="text-[10px] text-[#c5a3d4]/40 mt-0.5">{meta.sublabel}</p>

                <div className="mt-3 space-y-2">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[11px] text-[#d4baeb]/60">Selects</span>
                    <span className="tabular-nums text-white font-bold text-lg">
                      {pkg.selects.toLocaleString('pt-BR')}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-[11px] text-[#d4baeb]/60">Compras</span>
                    <span className="tabular-nums text-white font-bold text-lg">
                      {pkg.purchases.toLocaleString('pt-BR')}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between pt-2 border-t border-white/[0.06]">
                    <span className="text-[11px] text-[#d4baeb]/60">Taxa select→compra</span>
                    <span className="tabular-nums text-[#e87060] font-bold">
                      {pkg.selects > 0 ? `${convPct.toFixed(1)}%` : '—'}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-[11px] text-[#d4baeb]/60">Receita</span>
                    <span className="tabular-nums text-white font-semibold text-sm">
                      {pkg.revenue > 0 ? brl(pkg.revenue) : '—'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer note */}
      <p className="text-center text-[10px] text-[#c5a3d4]/30 mt-8 pb-4">
        Dados via Google Analytics Data API (Enhanced Ecommerce) · refresh automático a cada 12h
      </p>
    </div>
  );
}
