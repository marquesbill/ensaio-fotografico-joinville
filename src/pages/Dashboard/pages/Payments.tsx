/**
 * Payments — Página 5 do Dashboard.
 *
 * Fonte canon: planilha agendamentos (Apps Script sheet 1o5qmsX...).
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
  revenue: { total: number; ensaios: number; avg_ticket: number };
  costs: {
    meta_ads: { gross: number; net: number; tax_rate: number; error: string | null };
    elisa:    { total: number; per_ensaio: number };
    mari:     { fixed: number; commission: number; total: number; per_ensaio: number };
    total:    number;
  };
  kpis: {
    roas:     number;
    cpa_real: number;
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
            { label: 'Sheets',   detail: 'agendamentos · 1o5qmsX...',     status: error ? 'error' : 'live' },
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

      {/* Lifetime banner — destaca total de ensaios fechados */}
      <div className="mb-6 rounded-2xl border border-[#7a3f8f]/30 bg-gradient-to-r from-[#7a3f8f]/15 via-[#7a3f8f]/5 to-[#e87060]/10 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-[#c5a3d4]/70 font-bold">
              Total de ensaios fechados · histórico completo
            </p>
            <p className="font-black text-4xl md:text-5xl text-white tabular-nums mt-1">
              {loading ? '—' : (data?.total_ensaios ?? 0).toLocaleString('pt-BR')}
            </p>
            <p className="text-[11px] text-[#d4baeb]/50 mt-1">
              de {loading ? '—' : (data?.total_customers ?? 0).toLocaleString('pt-BR')} clientes únicos
            </p>
          </div>
          <div className="flex items-baseline gap-8 text-sm">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/40 font-semibold">Pendentes</p>
              <p className="text-[#e87060] font-black tabular-nums text-2xl mt-0.5">
                {loading ? '—' : (data?.by_status.pendente.customers ?? 0).toLocaleString('pt-BR')}
              </p>
              <p className="text-[9px] text-[#e87060]/60 mt-0.5">
                {loading ? '—' : (data?.by_status.pendente.ensaios ?? 0)} ensaios em aberto
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/40 font-semibold">Taxa fechamento</p>
              <p className="text-white font-black tabular-nums text-2xl mt-0.5">
                {loading ? '—' : `${(closingRate * 100).toFixed(1)}%`}
              </p>
              <p className="text-[9px] text-white/30 mt-0.5">confirmados / ativos</p>
            </div>
          </div>
        </div>
      </div>

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
function fmtBRLPrecise(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
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

  const taxPct = (costs.meta_ads.tax_rate * 100).toFixed(1);

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
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-5">
        {/* ROAS — KPI principal */}
        <div className="lg:col-span-1 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-[10px] uppercase tracking-widest text-[#c5a3d4]/60 font-bold flex items-center gap-1.5">
            <Target className="w-3 h-3" /> ROAS
          </p>
          <p className="font-black tabular-nums text-4xl mt-1" style={{ color: roasColor }}>
            {kpis.roas.toFixed(2)}x
          </p>
          <p className="text-[11px] text-[#d4baeb]/60 mt-1.5 leading-tight">
            {kpis.roas >= 1 ? (
              <>Cada R$ 1 investido<br/>retorna <strong>{fmtBRLPrecise(kpis.roas)}</strong></>
            ) : (
              <>Faltam <strong className="text-white">{kpis.breakeven.ensaios_needed} ensaios</strong> a ticket médio<br/>pra se pagar ({fmtBRL(revenue.avg_ticket)}/ensaio)</>
            )}
          </p>
          {/* Barra de progresso pra break-even */}
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden mt-2">
            <div className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${kpis.breakeven.progress_pct}%`,
                background: roasColor,
              }}
            />
          </div>
        </div>

        {/* 3 KPIs */}
        <KpiCard
          label="Receita realizada"
          value={fmtBRL(revenue.total)}
          icon={TrendingUp} source="Sheets"
          hint={`${revenue.ensaios} ensaios · ticket médio ${fmtBRL(revenue.avg_ticket)}`}
          loading={false}
        />
        <KpiCard
          label="Custo total"
          value={fmtBRL(costs.total)}
          icon={Wallet} source="Meta + Sheets"
          hint={`Meta ${fmtBRL(costs.meta_ads.gross)} + Elisa ${fmtBRL(costs.elisa.total)} + Mari ${fmtBRL(costs.mari.total)}`}
          loading={false}
        />
        <KpiCard
          label="CPA real"
          value={revenue.ensaios > 0 ? fmtBRL(kpis.cpa_real) : '—'}
          icon={Target} source="Calculado"
          hint={`Custo total / ${revenue.ensaios} ensaios. Versão só Meta: ${fmtBRL(kpis.cpa_meta)}`}
          loading={false}
        />
      </div>

      {/* Breakdown dos custos — barra empilhada visual + tabela */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
        <div className="flex items-baseline justify-between mb-3">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#c5a3d4]/70">Breakdown de custos</p>
          <p className="text-[10px] text-[#c5a3d4]/40 tabular-nums">{fmtBRL(costs.total)} total</p>
        </div>

        {/* Barra empilhada */}
        <div className="flex h-2 rounded-full overflow-hidden bg-white/5 mb-3">
          {[
            { label: 'Meta',  value: costs.meta_ads.gross, color: '#7a3f8f' },
            { label: 'Elisa', value: costs.elisa.total,    color: '#a578bb' },
            { label: 'Mari',  value: costs.mari.total,     color: '#e87060' },
          ].map(seg => {
            const pct = costs.total > 0 ? (seg.value / costs.total) * 100 : 0;
            return (
              <div key={seg.label}
                className="h-full transition-all duration-500"
                style={{ width: `${pct}%`, background: seg.color }}
                title={`${seg.label}: ${fmtBRL(seg.value)} (${pct.toFixed(0)}%)`}
              />
            );
          })}
        </div>

        {/* 3 colunas: Meta · Elisa · Mari */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div>
            <p className="flex items-center gap-1.5 mb-1">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#7a3f8f' }} />
              <span className="text-white font-bold">Meta Ads</span>
              <span className="ml-auto tabular-nums text-white">{fmtBRL(costs.meta_ads.gross)}</span>
            </p>
            <p className="text-[10px] text-[#c5a3d4]/50 leading-relaxed pl-4">
              {fmtBRL(costs.meta_ads.net)} no gerenciador + {taxPct}% imposto.<br/>
              CPA só Meta: <span className="text-white">{fmtBRL(kpis.cpa_meta)}</span>
            </p>
          </div>
          <div>
            <p className="flex items-center gap-1.5 mb-1">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#a578bb' }} />
              <span className="text-white font-bold">Elisa</span>
              <span className="ml-auto tabular-nums text-white">{fmtBRL(costs.elisa.total)}</span>
            </p>
            <p className="text-[10px] text-[#c5a3d4]/50 leading-relaxed pl-4">
              Fixo do projeto.<br/>
              Por ensaio: <span className="text-white">{fmtBRL(costs.elisa.per_ensaio)}</span>
            </p>
          </div>
          <div>
            <p className="flex items-center gap-1.5 mb-1">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#e87060' }} />
              <span className="text-white font-bold">Mari</span>
              <span className="ml-auto tabular-nums text-white">{fmtBRL(costs.mari.total)}</span>
            </p>
            <p className="text-[10px] text-[#c5a3d4]/50 leading-relaxed pl-4">
              {fmtBRL(costs.mari.fixed)} fixo + {fmtBRL(costs.mari.commission)} comissão escalonada.<br/>
              <span className="text-[#c5a3d4]/40">5% até 15 · 8% até 30 · 10% 31+</span>
            </p>
          </div>
        </div>
      </div>

      {/* Resultado final */}
      <div className="mt-3 pt-3 border-t border-white/[0.06] flex items-baseline justify-between flex-wrap gap-2">
        <span className="text-[11px] text-[#d4baeb]/60">
          Lucro / prejuízo acumulado:
        </span>
        <span className="font-black tabular-nums text-lg" style={{
          color: kpis.profit >= 0 ? '#4ade80' : '#f87171',
        }}>
          {kpis.profit >= 0 ? '+' : ''}{fmtBRL(kpis.profit)}
        </span>
      </div>
    </div>
  );
}
