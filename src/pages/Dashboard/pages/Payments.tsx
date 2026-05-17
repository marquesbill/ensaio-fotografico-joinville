/**
 * Payments — Página 5 do Dashboard.
 *
 * Mostra a fonte canônica de pagamentos: a lista de bookings do Apps
 * Script (Sheets). Status oficial vem daqui, não do GA4 (que pode perder
 * eventos de quem usa ad-blocker e contar a mais de quem cancelou depois).
 *
 * Dados via GET /api/admin-bookings (sem ?endpoint), filtra range
 * client-side por createdAt (fallback pra date da sessão).
 */

import { useEffect, useMemo, useState } from 'react';
import { DollarSign, CheckCircle2, Clock, TrendingUp } from 'lucide-react';

import { KpiCard } from '../components/KpiCard';
import { DataTable } from '../components/DataTable';
import { DataSourceBadge } from '../components/DataSourceBadge';

interface Booking {
  id:           string;
  date:         string;
  start:        string;
  end:          string;
  package:      string;
  price?:       number;
  name:         string;
  email?:       string;
  whatsapp?:    string;
  status:       string;     // "Confirmado" | "Pendente" | "Cancelado"
  createdAt?:   string;     // ISO timestamp
}

const RANGE_OPTIONS = [
  { key: '7d',  label: '7 dias',  days: 7 },
  { key: '28d', label: '28 dias', days: 28 },
  { key: '90d', label: '90 dias', days: 90 },
  { key: 'all', label: 'Tudo',    days: 99999 },
] as const;

function brl(n: number) {
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function timeAgo(iso?: string) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '—';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}

function normalizeBooking(b: Booking): Booking {
  return {
    ...b,
    date:  b.date?.includes('T')  ? b.date.split('T')[0]                : (b.date  ?? ''),
    start: b.start?.includes('T') ? b.start.split('T')[1]?.slice(0, 5)  : (b.start ?? ''),
    end:   b.end?.includes('T')   ? b.end.split('T')[1]?.slice(0, 5)    : (b.end   ?? ''),
  };
}

function StatusPill({ status }: { status: string }) {
  const s = (status || '').toLowerCase();
  let color = 'bg-white/5 text-white/60 border-white/10';
  if (s.startsWith('confirm'))      color = 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  else if (s.startsWith('pend'))    color = 'bg-[#e87060]/15 text-[#e87060] border-[#e87060]/30';
  else if (s.startsWith('cancel'))  color = 'bg-red-500/10 text-red-300/80 border-red-500/20';
  return <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${color}`}>{status}</span>;
}

export function Payments({ token }: { token: string }) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<typeof RANGE_OPTIONS[number]['key']>('28d');
  const [refreshing, setRefreshing] = useState(false);
  const [lastFetched, setLastFetched] = useState<string | null>(null);

  const load = async (forceRefresh = false) => {
    if (!bookings.length) setLoading(true);
    if (forceRefresh) setRefreshing(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin-bookings?t=${Date.now()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`);
      const raw: Booking[] = Array.isArray(json) ? json : (json.bookings ?? []);
      setBookings(raw.map(normalizeBooking));
      setLastFetched(new Date().toISOString());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar bookings');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const filtered = useMemo(() => {
    const days = RANGE_OPTIONS.find(r => r.key === range)?.days || 28;
    if (days >= 99999) return bookings;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return bookings.filter(b => {
      const t = b.createdAt
        ? new Date(b.createdAt).getTime()
        : (b.date ? new Date(`${b.date}T12:00:00`).getTime() : 0);
      return t >= cutoff;
    });
  }, [bookings, range]);

  const stats = useMemo(() => {
    let confirmedCount = 0, pendingCount = 0, cancelledCount = 0;
    let confirmedRevenue = 0, pendingValue = 0;
    const byPackage: Record<string, { count: number; revenue: number; pending: number; pendingValue: number }> = {};

    filtered.forEach(b => {
      const price = Number(b.price) || 0;
      const status = (b.status || '').toLowerCase();
      const pkgKey = (b.package || 'unknown').toLowerCase();

      byPackage[pkgKey] = byPackage[pkgKey] || { count: 0, revenue: 0, pending: 0, pendingValue: 0 };

      if (status.startsWith('confirm')) {
        confirmedCount++;
        confirmedRevenue += price;
        byPackage[pkgKey].count++;
        byPackage[pkgKey].revenue += price;
      } else if (status.startsWith('pend')) {
        pendingCount++;
        pendingValue += price;
        byPackage[pkgKey].pending++;
        byPackage[pkgKey].pendingValue += price;
      } else if (status.startsWith('cancel')) {
        cancelledCount++;
      }
    });

    const total = confirmedCount + pendingCount + cancelledCount;
    const conversionRate = total > 0 ? confirmedCount / total : 0;

    return { confirmedCount, pendingCount, cancelledCount, total,
             confirmedRevenue, pendingValue, conversionRate, byPackage };
  }, [filtered]);

  const recent = useMemo(() => {
    return [...filtered]
      .sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      })
      .slice(0, 15);
  }, [filtered]);

  // Pra cards de pacote — fallback caso bookings tenham várias variações de label
  const pkgCard = (matchStart: string, label: string) => {
    const entry = Object.entries(stats.byPackage).find(([k]) =>
      k.toLowerCase().startsWith(matchStart.toLowerCase()) ||
      k.toLowerCase().includes(matchStart.toLowerCase().slice(0, 5))
    );
    const data = entry?.[1] || { count: 0, revenue: 0, pending: 0, pendingValue: 0 };
    return { label, ...data };
  };

  return (
    <div className="px-8 py-6 text-white max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#c5a3d4]/60">Página 5 · Pagamentos</p>
          <h1 className="font-headline text-3xl font-black mt-1">Pagamentos</h1>
          <p className="text-[#d4baeb]/60 text-sm mt-1">
            Receita confirmada, pendentes e status canônico (fonte: Sheets)
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
          sources={[{ label: 'Sheets', detail: 'bookings via Apps Script', status: error ? 'error' : 'live' }]}
          lastFetched={lastFetched}
          onRefresh={() => load(true)}
          refreshing={refreshing}
        />
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 text-amber-200 text-sm">
          <p className="font-bold">Não foi possível buscar bookings</p>
          <p className="text-amber-200/70 mt-1">{error}</p>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KpiCard
          label="Receita confirmada"
          value={loading ? '—' : brl(stats.confirmedRevenue)}
          icon={DollarSign} source="Sheets"
          hint={`${stats.confirmedCount} pagamento${stats.confirmedCount === 1 ? '' : 's'}`}
          loading={loading}
        />
        <KpiCard
          label="Confirmados"
          value={loading ? '—' : stats.confirmedCount.toLocaleString('pt-BR')}
          icon={CheckCircle2} source="Sheets"
          hint="Bookings pagos com sucesso"
          loading={loading}
        />
        <KpiCard
          label="Pendentes"
          value={loading ? '—' : stats.pendingCount.toLocaleString('pt-BR')}
          icon={Clock} source="Sheets"
          hint={`${brl(stats.pendingValue)} em aberto`}
          loading={loading}
        />
        <KpiCard
          label="Taxa de conversão"
          value={loading ? '—' : `${(stats.conversionRate * 100).toFixed(1)}%`}
          icon={TrendingUp} source="Sheets"
          hint="Confirmados / total (inclui cancelados)"
          loading={loading}
        />
      </div>

      {/* Status breakdown */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-5 mb-6">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-white">Distribuição por status</h3>
            <p className="text-[11px] text-[#d4baeb]/50 mt-0.5">
              {stats.total > 0 ? `${stats.total} booking${stats.total === 1 ? '' : 's'} no período` : 'Sem dados no período'}
            </p>
          </div>
          <p className="text-[9px] uppercase tracking-wider text-[#c5a3d4]/30">Sheets</p>
        </div>
        <div className="space-y-3">
          {loading ? (
            [...Array(3)].map((_, i) => (
              <div key={i} className="h-10 bg-white/[0.02] rounded animate-pulse" />
            ))
          ) : [
            { key: 'confirmed', label: 'Confirmados', count: stats.confirmedCount, color: '#7a3f8f' },
            { key: 'pending',   label: 'Pendentes',   count: stats.pendingCount,   color: '#e87060' },
            { key: 'cancelled', label: 'Cancelados',  count: stats.cancelledCount, color: '#71717a' },
          ].map(row => {
            const maxCount = Math.max(stats.confirmedCount, stats.pendingCount, stats.cancelledCount, 1);
            const widthPct = (row.count / maxCount) * 100;
            const sharePct = stats.total > 0 ? (row.count / stats.total) * 100 : 0;
            return (
              <div key={row.key}>
                <div className="flex items-baseline justify-between text-xs mb-1.5">
                  <span className="text-white font-semibold">{row.label}</span>
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

      {/* Per-package revenue */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-5 mb-6">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-white">Receita por pacote</h3>
            <p className="text-[11px] text-[#d4baeb]/50 mt-0.5">Soma de bookings confirmados, breakdown por pacote</p>
          </div>
          <p className="text-[9px] uppercase tracking-wider text-[#c5a3d4]/30">Sheets</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {loading ? (
            [...Array(3)].map((_, i) => (
              <div key={i} className="h-32 bg-white/[0.02] rounded-xl animate-pulse" />
            ))
          ) : [
            pkgCard('lembr', 'Lembrança'),
            pkgCard('econ',  'Econômico'),
            pkgCard('compl', 'Completo'),
          ].map(card => (
            <div key={card.label} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
              <p className="text-[11px] font-bold uppercase tracking-widest text-[#c5a3d4]/70">{card.label}</p>
              <p className="font-black text-2xl text-white tabular-nums mt-2">{brl(card.revenue)}</p>
              <p className="text-[11px] text-[#d4baeb]/50 mt-1">
                {card.count} pago{card.count === 1 ? '' : 's'}
                {card.pending > 0 && (
                  <span className="text-[#e87060]/70 ml-2">· {card.pending} pendente{card.pending === 1 ? '' : 's'}</span>
                )}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Recent transactions */}
      <DataTable
        title="Transações recentes"
        source="Sheets"
        loading={loading}
        rows={recent.map(b => ({
          createdAt: timeAgo(b.createdAt),
          name:      b.name,
          package:   b.package,
          price:     brl(Number(b.price) || 0),
          status:    b.status,
          date:      b.date && b.start ? `${b.date.split('-').reverse().join('/')} ${b.start}` : (b.date || '—'),
        }))}
        columns={[
          { key: 'createdAt', label: 'Criado',   align: 'left'  },
          { key: 'name',      label: 'Cliente',  align: 'left'  },
          { key: 'package',   label: 'Pacote',   align: 'left'  },
          { key: 'price',     label: 'Valor',    align: 'right' },
          {
            key: 'status', label: 'Status', align: 'left',
            render: (r) => <StatusPill status={String(r.status)} />,
          },
          { key: 'date',      label: 'Sessão',   align: 'left'  },
        ]}
        maxRows={15}
      />

      <p className="text-center text-[10px] text-[#c5a3d4]/30 mt-8 pb-4">
        Fonte: planilha de bookings via Apps Script · refresh manual (botão acima)
      </p>
    </div>
  );
}
