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
import { Package, CheckCircle2, Clock, TrendingUp, Users } from 'lucide-react';

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

const PKG_META: Record<string, { label: string; sublabel: string }> = {
  lembranca: { label: 'Lembrança', sublabel: '30 min · até 2 pessoas' },
  economico: { label: 'Econômico', sublabel: '60 min · até 3 pessoas' },
  completo:  { label: 'Completo',  sublabel: '120 min · até 4 pessoas' },
};

export function Payments({ token }: { token: string }) {
  const [data, setData] = useState<BookingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (forceRefresh = false) => {
    if (!data) setLoading(true);
    if (forceRefresh) setRefreshing(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin-bookings?endpoint=sheets-bookings&t=${Date.now()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`);
      setData(json);
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
          sources={[{ label: 'Sheets', detail: 'agendamentos · 1o5qmsX...', status: error ? 'error' : 'live' }]}
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
        Fonte: planilha agendamentos canon · 1 row = 1 cliente · Qtd ensaios agregado
        <br/>
        Receita e dados financeiros: tratados no Sharp.
      </p>
    </div>
  );
}
