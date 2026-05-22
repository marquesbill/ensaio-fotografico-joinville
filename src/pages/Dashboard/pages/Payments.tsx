/**
 * Payments — Página 5 do Dashboard.
 *
 * Fonte canon: planilha agendamentos (Apps Script sheet 1e8PA6...).
 * 1 row = 1 cliente, com `Qtd ensaios` agregado e `Status atual`.
 *
 * Foco em CONTAGEM de pacotes fechados (sem R$). Receita/finanças
 * são tratadas no Sharp.
 *
 * Sem range picker — o sheet é customer-aggregate, range não se aplica
 * bem. Lifetime view por default.
 */

import { useEffect, useState } from 'react';
import { Package, CheckCircle2, Clock, TrendingUp, Users, Wallet, Target } from 'lucide-react';

import { KpiCard } from '../components/KpiCard';
import { DataSourceBadge } from '../components/DataSourceBadge';
import { DeltaBadge } from '../components/DeltaBadge';

interface PackageStat { customers: number; ensaios: number }

interface BookingsData {
  fetched_at: string;
  next_refresh: string;
  total_customers: number;
  total_ensaios: number;
  by_package: {
    lembranca: PackageStat;
    economico: PackageStat;
    completo:  PackageStat;
    unknown:   PackageStat;
  };
  by_status: {
    confirmado: PackageStat;
    pendente:   PackageStat;
  };
  recent: Array<{
    name: string;
    pacote: string;
    ultima_data: string;
    qtd: number;
    status: string;
  }>;
}

interface EconomicsData {
  fetched_at: string;
  deltas_window?: { days: number; note: string };
  revenue: { total: number; ensaios: number; avg_ticket: number; delta_pct?: number | null; ensaios_delta_pct?: number | null };
  costs: {
    meta_ads: { gross: number; net: number; tax_rate: number; error: string | null; delta_pct?: number | null };
    elisa:    { total: number; per_ensaio: number };
    mari:     { fixed: number; commission: number; total: number; per_ensaio: number };
    total:    number;
    total_delta_pct?: number | null;
  };
  kpis: {
    roas:     number;
    roas_delta_pct?: number | null;
    cpa_real: number;
    cpa_real_delta_pct?: number | null;
    cpa_meta: number;
    profit:   number;
    breakeven: { deficit: number; ensaios_needed: number; progress_pct: number };
  };
}

const PKG_META: Record<string, { label: string; sublabel: string }> = {
  lembranca: { label: 'Lembrança', sublabel: '30 min · até 2 pessoas' },
  economico: { label: 'Econômico', sublabel: '60 min · até 3 pessoas' },
  completo:  { label: 'Completo',  sublabel: '120 min · até 4 pessoas' },
};

export function Payments({ token }: { token: string }) {
  const [data, setData] = useState<BookingsData | null>(null);
  const [economics, setEconomics] = useState<EconomicsData | null>(null);
  const [economicsError, setEconomicsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (forceRefresh = false) => {
    if (!data) setLoading(true);
    if (forceRefresh) setRefreshing(true);
    setError(null);
    setEconomicsError(null);
    try {
      const t = Date.now();
      const [rBookings, rEcon] = await Promise.all([
        fetch(`/api/admin-bookings?endpoint=sheets-bookings&t=${t}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/admin-bookings?endpoint=economics&t=${t}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      const jBookings = await rBookings.json();
      if (!rBookings.ok) throw new Error(jBookings.error || `HTTP ${rBookings.status}`);
      setData(jBookings);

      // Economics é complementar — falha não derruba a página inteira
      const jEcon = await rEcon.json();
      if (!rEcon.ok) {
        setEconomicsError(jEcon.error || `HTTP ${rEcon.status}`);
        setEconomics(null);
      } else {
        setEconomics(jEcon);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar bookings');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const totalActive = (data?.by_status.confirmado.customers || 0) + (data?.by_status.pendente.customers || 0);
  const closingRate = totalActive > 0
    ? (data?.by_status.confirmado.customers || 0) / totalActive
    : 0;

  return (
    <div className="px-8 py-6 text-white max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#c5a3d4]/60">Página 5 · Pagamentos</p>
          <h1 className="font-headline text-3xl font-black mt-1">Pagamentos</h1>
          <p className="text-[#d4baeb]/60 text-sm mt-1">
            Pacotes fechados · fonte: planilha agendamentos (canon)
          </p>
        </div>
      </div>

      <div className="mb-6">
        <DataSourceBadge
          sources={[
            { label: 'Sheets',   detail: 'agendamentos · 1e8PA6...',     status: error ? 'error' : 'live' },
            { label: 'Meta Ads', detail: 'spend gross · custos equipe',   status: economicsError ? 'error' : (economics ? 'live' : 'stale') },
          ]}
          lastFetched={data?.fetched_at}
          nextRefresh={data?.next_refresh}
          onRefresh={() => load(true)}
          refreshing={refreshing}
        />
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 text-amber-200 text-sm">
          <p className="font-bold">Não foi possível ler a planilha de agendamentos</p>
          <p className="text-amber-200/70 mt-1">{error}</p>
        </div>
      )}

      {/* ───────── Economia da campanha (ROAS + CPA real) ───────── */}
      <EconomicsBlock economics={economics} error={economicsError} loading={loading} />

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KpiCard
          label="Pacotes fechados"
          value={loading ? '—' : (data?.by_status.confirmado.ensaios ?? 0).toLocaleString('pt-BR')}
          icon={Package} source="Sheets"
          hint={`${data?.by_status.confirmado.customers ?? 0} clientes confirmados`}
          loading={loading}
        />
        <KpiCard
          label="Clientes únicos"
          value={loading ? '—' : (data?.total_customers ?? 0).toLocaleString('pt-BR')}
          icon={Users} source="Sheets"
          hint="Pessoas que já fizeram ao menos 1 ensaio"
          loading={loading}
        />
        <KpiCard
          label="Em aberto"
          value={loading ? '—' : (data?.by_status.pendente.customers ?? 0).toLocaleString('pt-BR')}
          icon={Clock} source="Sheets"
          hint={`${data?.by_status.pendente.ensaios ?? 0} ensaios aguardando pgmto`}
          loading={loading}
        />
        <KpiCard
          label="Taxa de fechamento"
          value={loading ? '—' : `${(closingRate * 100).toFixed(1)}%`}
          icon={TrendingUp} source="Sheets"
          hint="Confirmados / (Confirmados + Pendentes)"
          loading={loading}
        />
      </div>

      {/* Status breakdown */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-5 mb-6">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-white">Confirmados vs Pendentes</h3>
            <p className="text-[11px] text-[#d4baeb]/50 mt-0.5">Por número de clientes (cancelados ignorados)</p>
          </div>
          <p className="text-[9px] uppercase tracking-wider text-[#c5a3d4]/30">Sheets</p>
        </div>
        <div className="space-y-3">
          {loading ? (
            [...Array(2)].map((_, i) => (
              <div key={i} className="h-10 bg-white/[0.02] rounded animate-pulse" />
            ))
          ) : [
            { key: 'confirmed', label: 'Confirmados', count: data?.by_status.confirmado.customers ?? 0, ensaios: data?.by_status.confirmado.ensaios ?? 0, color: '#7a3f8f' },
            { key: 'pending',   label: 'Pendentes',   count: data?.by_status.pendente.customers ?? 0, ensaios: data?.by_status.pendente.ensaios ?? 0, color: '#e87060' },
          ].map(row => {
            const max = Math.max(
              data?.by_status.confirmado.customers ?? 0,
              data?.by_status.pendente.customers ?? 0,
              1,
            );
            const widthPct = (row.count / max) * 100;
            const sharePct = totalActive > 0 ? (row.count / totalActive) * 100 : 0;
            return (
              <div key={row.key}>
                <div className="flex items-baseline justify-between text-xs mb-1.5">
                  <span className="text-white font-semibold">
                    {row.label}
                    <span className="text-[10px] text-[#c5a3d4]/50 ml-2">{row.ensaios} ensaios</span>
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="tabular-nums text-white font-bold">{row.count.toLocaleString('pt-BR')}</span>
                    <span className="text-[10px] text-[#c5a3d4]/60 tabular-nums w-12 text-right">{sharePct.toFixed(0)}%</span>
                  </div>
                </div>
                <div className="h-4 bg-white/[0.04] rounded overflow-hidden">
                  <div className="h-full rounded transition-all duration-500"
                    style={{ width: `${Math.max(widthPct, row.count > 0 ? 2 : 0)}%`, background: row.color }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Pacotes por tipo */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-5">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-white">Pacotes por tipo</h3>
            <p className="text-[11px] text-[#d4baeb]/50 mt-0.5">Clientes e ensaios por pacote escolhido</p>
          </div>
          <p className="text-[9px] uppercase tracking-wider text-[#c5a3d4]/30">Sheets</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {loading ? (
            [...Array(3)].map((_, i) => (
              <div key={i} className="h-36 bg-white/[0.02] rounded-xl animate-pulse" />
            ))
          ) : (['lembranca', 'economico', 'completo'] as const).map(key => {
            const stat = data?.by_package[key] || { customers: 0, ensaios: 0 };
            const meta = PKG_META[key];
            return (
              <div key={key} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
                <p className="text-[11px] font-bold uppercase tracking-widest text-[#c5a3d4]/70">{meta.label}</p>
                <p className="text-[10px] text-[#c5a3d4]/40 mt-0.5">{meta.sublabel}</p>
                <p className="font-black text-3xl text-white tabular-nums mt-3">{stat.ensaios}</p>
                <p className="text-[11px] text-[#d4baeb]/50 mt-1">
                  ensaio{stat.ensaios === 1 ? '' : 's'}
                  <span className="text-[#c5a3d4]/40 ml-2">· {stat.customers} cliente{stat.customers === 1 ? '' : 's'}</span>
                </p>
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-center text-[10px] text-[#c5a3d4]/30 mt-8 pb-4">
        Fonte: planilha agendamentos canon · aba <strong>Agendamentos</strong> · 1 row = 1 ensaio
        <br/>
        Cancelados ignorados. Receita e dados financeiros: tratados no Sharp.
      </p>
    </div>
  );
}

/* ───────── Economia da campanha (ROAS + CPA real + breakdown custos) ───────── */

function fmtBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

function EconomicsBlock({
  economics, error, loading,
}: {
  economics: EconomicsData | null;
  error:     string | null;
  loading:   boolean;
}) {
  if (loading && !economics) {
    return <div className="mb-6 h-48 rounded-2xl bg-white/[0.02] animate-pulse" />;
  }
  if (error && !economics) {
    return (
      <div className="mb-6 p-4 rounded-xl border border-dashed border-blue-500/30 bg-blue-500/5 text-blue-200/80 text-sm">
        <p className="font-bold">Economia da campanha indisponível</p>
        <p className="text-blue-200/60 mt-1 text-[11px]">{error}</p>
        <p className="text-blue-200/40 mt-1.5 text-[10px]">
          Verifique env vars: META_ADS_TOKEN, ELISA_TOTAL_COST, MARI_FIXED_COST, META_ADS_TAX_RATE
        </p>
      </div>
    );
  }
  if (!economics) return null;

  const { revenue, costs, kpis } = economics;
  const roasState =
    kpis.roas >= 1.5 ? 'great' :
    kpis.roas >= 1.0 ? 'good'  :
    kpis.roas >= 0.5 ? 'ok'    : 'bad';
  const roasColor = roasState === 'great' ? '#4ade80'
                  : roasState === 'good'  ? '#86efac'
                  : roasState === 'ok'    ? '#fbbf24'
                  :                          '#f87171';

  return (
    <div className="mb-6 rounded-2xl border border-[#7a3f8f]/30 bg-gradient-to-br from-[#7a3f8f]/15 via-[#0a0a14]/20 to-[#e87060]/10 p-5">
      <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Wallet className="w-4 h-4" /> Economia da campanha
          </h3>
          <p className="text-[11px] text-[#d4baeb]/50 mt-0.5">
            Receita realizada vs custos totais (Meta + Elisa + Mari incl. comissões)
          </p>
        </div>
        <p className="text-[9px] uppercase tracking-wider text-[#c5a3d4]/30">lifetime · Sheets + Meta</p>
      </div>

      {/* Topo: ROAS gigante + 3 KPIs auxiliares */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* ROAS — KPI principal (só número + barra de progresso pra break-even) */}
        <div className="lg:col-span-1 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-[10px] uppercase tracking-widest text-[#c5a3d4]/60 font-bold flex items-center gap-1.5">
            <Target className="w-3 h-3" /> ROAS
          </p>
          <p className="font-black tabular-nums text-4xl mt-1 flex items-baseline gap-2" style={{ color: roasColor }}>
            {kpis.roas.toFixed(2)}x
            <DeltaBadge value={kpis.roas_delta_pct ?? null} size="sm" title={economics.deltas_window?.note} />
          </p>
          {/* Barra de progresso pra break-even — visual auxiliar, mantém */}
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden mt-3">
            <div className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${kpis.breakeven.progress_pct}%`,
                background: roasColor,
              }}
            />
          </div>
        </div>

        {/* 3 KPIs — KpiCard agora com deltaPct + invertedDelta onde aplicável */}
        <KpiCard
          label="Receita realizada"
          value={fmtBRL(revenue.total)}
          deltaPct={revenue.delta_pct ?? null}
          deltaLabel={economics.deltas_window?.note}
          icon={TrendingUp} source="Sheets"
          loading={false}
        />
        <KpiCard
          label="Custo equipe + ads"
          value={fmtBRL(costs.total)}
          deltaPct={costs.total_delta_pct ?? null}
          deltaLabel={economics.deltas_window?.note}
          invertedDelta  /* subir = vermelho (custo aumentou) */
          icon={Wallet} source="Meta + Sheets"
          loading={false}
        />
        <KpiCard
          label="CPA real"
          value={revenue.ensaios > 0 ? fmtBRL(kpis.cpa_real) : '—'}
          deltaPct={kpis.cpa_real_delta_pct ?? null}
          deltaLabel={economics.deltas_window?.note}
          invertedDelta  /* CPA descer = melhor */
          icon={Target} source="Calculado"
          loading={false}
        />
      </div>
    </div>
  );
}
