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
import { CheckCircle2, Clock, TrendingUp } from 'lucide-react';

import { KpiCard } from '../components/KpiCard';
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

interface PingResult {
  ok: boolean;
  sa_email?: string;
  stage?: string;
  error?: string;
  hint?: string;
  results?: Record<string, {
    ok: boolean;
    sheet_id: string;
    rows_returned?: number;
    headers?: string[];
    sample_row?: string[] | null;
    error?: string;
    hint?: string;
  }>;
}

function SheetsSetupStatus({ token }: { token: string }) {
  const [ping, setPing] = useState<PingResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin-bookings?endpoint=sheets-ping', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(setPing)
      .catch(e => setPing({ ok: false, error: e instanceof Error ? e.message : String(e) }))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <p className="text-[10px] uppercase tracking-widest text-[#c5a3d4]/50 font-bold">Verificando integração…</p>
        <div className="mt-2 h-10 bg-white/[0.03] rounded animate-pulse" />
      </div>
    );
  }

  if (!ping) return null;

  // Env var problem
  if (ping.stage === 'env_var' || (!ping.ok && !ping.results)) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-5">
        <p className="text-[10px] uppercase tracking-widest text-red-300/70 font-bold">❌ Env var não configurada</p>
        <p className="text-sm text-white font-semibold mt-1">{ping.error}</p>
        {ping.hint && <p className="text-[11px] text-[#d4baeb]/60 mt-1.5">{ping.hint}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 space-y-4">
      <div>
        <p className="text-[10px] uppercase tracking-widest text-[#c5a3d4]/70 font-bold">Integração com planilhas</p>
        <p className="text-[11px] text-[#d4baeb]/50 mt-1">SA: <code className="font-mono text-[10px] text-[#c5a3d4]/80">{ping.sa_email}</code></p>
      </div>

      {ping.results && Object.entries(ping.results).map(([name, r]) => (
        <div key={name} className={`rounded-xl border p-3 ${r.ok ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
          <div className="flex items-baseline justify-between mb-1">
            <p className="text-sm font-bold text-white">
              {r.ok ? '✅' : '⚠️'} Planilha <span className="capitalize">{name}</span>
            </p>
            <code className="text-[9px] text-white/30 font-mono truncate ml-2">{r.sheet_id}</code>
          </div>
          {r.ok ? (
            <>
              <p className="text-[11px] text-[#d4baeb]/60 mb-1.5">
                {r.rows_returned} linhas lidas · {(r.headers || []).length} colunas
              </p>
              <details className="text-[10px]">
                <summary className="text-emerald-300/80 cursor-pointer hover:text-emerald-200">Ver cabeçalhos</summary>
                <div className="mt-2 p-2 rounded bg-black/30 font-mono text-[10px] text-white/80 leading-relaxed">
                  {(r.headers || []).map((h, i) => (
                    <div key={i}>{i + 1}. {h}</div>
                  ))}
                </div>
              </details>
            </>
          ) : (
            <>
              <p className="text-[11px] text-amber-200 mb-1">{r.error}</p>
              {r.hint && (
                <p className="text-[11px] text-[#d4baeb]/70 mt-1.5">
                  💡 {r.hint}
                </p>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function normalizeBooking(b: Booking): Booking {
  return {
    ...b,
    date:  b.date?.includes('T')  ? b.date.split('T')[0]                : (b.date  ?? ''),
    start: b.start?.includes('T') ? b.start.split('T')[1]?.slice(0, 5)  : (b.start ?? ''),
    end:   b.end?.includes('T')   ? b.end.split('T')[1]?.slice(0, 5)    : (b.end   ?? ''),
  };
}

function computeStats(bookings: Booking[]) {
  let confirmedCount = 0, pendingCount = 0;
  const byPackage: Record<string, { count: number; pending: number }> = {};

  // Cancelados ignorados intencionalmente: maioria são clientes que marcaram
  // 3-4 vezes e ficaram com 1. A estatística não agrega valor aqui.

  bookings.forEach(b => {
    const status = (b.status || '').toLowerCase();
    const pkgKey = (b.package || 'unknown').toLowerCase();

    byPackage[pkgKey] = byPackage[pkgKey] || { count: 0, pending: 0 };

    if (status.startsWith('confirm')) {
      confirmedCount++;
      byPackage[pkgKey].count++;
    } else if (status.startsWith('pend')) {
      pendingCount++;
      byPackage[pkgKey].pending++;
    }
  });

  const total = confirmedCount + pendingCount;
  // Taxa de "fechamento": % das reservas tentadas que viraram pagamento.
  // Não confundir com conversion-rate de marketing (leads → reserva), que vai
  // ser adicionado quando integrarmos a planilha de leads.
  const closingRate = total > 0 ? confirmedCount / total : 0;

  return { confirmedCount, pendingCount, total, closingRate, byPackage };
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

  const lifetimeStats = useMemo(() => computeStats(bookings), [bookings]);
  const stats         = useMemo(() => computeStats(filtered), [filtered]);

  // Pra cards de pacote — fallback caso bookings tenham várias variações de label
  const pkgCard = (matchStart: string, label: string) => {
    const entry = Object.entries(stats.byPackage).find(([k]) =>
      k.toLowerCase().startsWith(matchStart.toLowerCase()) ||
      k.toLowerCase().includes(matchStart.toLowerCase().slice(0, 5))
    );
    const data = entry?.[1] || { count: 0, pending: 0, cancelled: 0 };
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

      {/* Total acumulado — sempre histórico completo, ignora o range picker */}
      <div className="mb-6 rounded-2xl border border-[#7a3f8f]/30 bg-gradient-to-r from-[#7a3f8f]/15 via-[#7a3f8f]/5 to-[#e87060]/10 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-[#c5a3d4]/70 font-bold">
              Total acumulado · desde o lançamento
            </p>
            <p className="font-black text-3xl md:text-4xl text-white tabular-nums mt-1">
              {loading ? '—' : `${lifetimeStats.confirmedCount.toLocaleString('pt-BR')} pacotes fechados`}
            </p>
            <p className="text-[11px] text-[#d4baeb]/50 mt-1">Reservas confirmadas · todas as datas</p>
          </div>
          <div className="flex items-baseline gap-8 text-sm">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/40 font-semibold">Pendentes</p>
              <p className="text-[#e87060] font-black tabular-nums text-2xl mt-0.5">
                {loading ? '—' : lifetimeStats.pendingCount.toLocaleString('pt-BR')}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/40 font-semibold">Taxa de fechamento</p>
              <p className="text-white font-black tabular-nums text-2xl mt-0.5">
                {loading ? '—' : `${(lifetimeStats.closingRate * 100).toFixed(1)}%`}
              </p>
              <p className="text-[9px] text-white/30 mt-0.5">confirmados / reservas iniciadas</p>
            </div>
          </div>
        </div>
      </div>

      {/* Header da seção "no período" */}
      <p className="mb-3 text-[11px] uppercase tracking-widest text-[#c5a3d4]/50 font-bold">
        No período · {RANGE_OPTIONS.find(r => r.key === range)?.label}
      </p>

      {/* KPIs (filtrados pelo range) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <KpiCard
          label="Pacotes fechados"
          value={loading ? '—' : stats.confirmedCount.toLocaleString('pt-BR')}
          icon={CheckCircle2} source="Sheets"
          hint="Reservas confirmadas no período"
          loading={loading}
        />
        <KpiCard
          label="Pendentes"
          value={loading ? '—' : stats.pendingCount.toLocaleString('pt-BR')}
          icon={Clock} source="Sheets"
          hint="Aguardando pagamento"
          loading={loading}
        />
        <KpiCard
          label="Taxa de fechamento"
          value={loading ? '—' : `${(stats.closingRate * 100).toFixed(1)}%`}
          icon={TrendingUp} source="Sheets"
          hint="Confirmados / (Confirmados + Pendentes)"
          loading={loading}
        />
      </div>

      {/* Status breakdown — confirmados vs pendentes (cancelados ignorados) */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-5 mb-6">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-white">Confirmados vs Pendentes</h3>
            <p className="text-[11px] text-[#d4baeb]/50 mt-0.5">
              {stats.total > 0 ? `${stats.total} reserva${stats.total === 1 ? '' : 's'} no período` : 'Sem dados no período'}
            </p>
          </div>
          <p className="text-[9px] uppercase tracking-wider text-[#c5a3d4]/30">Sheets</p>
        </div>
        <div className="space-y-3">
          {loading ? (
            [...Array(2)].map((_, i) => (
              <div key={i} className="h-10 bg-white/[0.02] rounded animate-pulse" />
            ))
          ) : [
            { key: 'confirmed', label: 'Confirmados', count: stats.confirmedCount, color: '#7a3f8f' },
            { key: 'pending',   label: 'Pendentes',   count: stats.pendingCount,   color: '#e87060' },
          ].map(row => {
            const maxCount = Math.max(stats.confirmedCount, stats.pendingCount, 1);
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

      {/* Pacotes fechados por tipo */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-5 mb-6">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-white">Pacotes por tipo</h3>
            <p className="text-[11px] text-[#d4baeb]/50 mt-0.5">Quantos confirmados de cada pacote</p>
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
              <p className="font-black text-3xl text-white tabular-nums mt-2">{card.count}</p>
              <p className="text-[11px] text-[#d4baeb]/50 mt-1">
                fechado{card.count === 1 ? '' : 's'}
                {card.pending > 0 && (
                  <span className="text-[#e87060]/70 ml-2">· {card.pending} pendente{card.pending === 1 ? '' : 's'}</span>
                )}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Diagnóstico da integração de planilhas */}
      <SheetsSetupStatus token={token} />

      <p className="text-center text-[10px] text-[#c5a3d4]/30 mt-8 pb-4">
        Fonte: planilha de bookings via Apps Script · refresh manual
      </p>
    </div>
  );
}
