/**
 * Leads — leads nativos do Meta (Instant Forms / Lead Ads).
 *
 * Lista os leads capturados via formulário nativo do Facebook/Instagram,
 * com barra de segmentação (estado/campanha/conjunto/criativo + busca livre)
 * e copiar-para-área-de-transferência (linha a linha ou tudo de uma vez).
 *
 * Dados via /api/admin-bookings?endpoint=meta-leads&range=N (cap de 90 dias).
 */

import { useEffect, useMemo, useState } from 'react';
import { Users, Calendar, TrendingUp, MapPin, Copy, Check } from 'lucide-react';

import { KpiCard } from '../components/KpiCard';
import { DataSourceBadge } from '../components/DataSourceBadge';

interface MetaLead {
  id: string;
  createdAt: string;
  name: string;
  phone: string;
  email: string;
  estado: string;
  cidade: string;
  extra: Record<string, string>;
  campaign: string;
  adset: string;
  ad: string;
}

interface MetaLeadsData {
  configured: boolean;
  details?: string;
  rangeDays?: number;
  total?: number;
  leads?: MetaLead[];
}

const RANGE_OPTIONS = [
  { key: '7d',  label: '7d',  days: 7 },
  { key: '14d', label: '14d', days: 14 },
  { key: '28d', label: '28d', days: 28 },
  { key: '60d', label: '60d', days: 60 },
  { key: '90d', label: '90d', days: 90 },
] as const;

const TODOS = '';

/** dd/mm hh:mm — compacto pra coluna de tabela. */
function fmtShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** dd/mm/yyyy hh:mm — formato completo pro texto copiado. */
function fmtFull(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Normaliza telefone BR pra link wa.me (assume DDI 55 quando ausente). */
function waLink(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  return `https://wa.me/${digits.startsWith('55') ? digits : `55${digits}`}`;
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Monta o texto copiável de um lead — omite linhas vazias. */
function leadText(lead: MetaLead): string {
  const lines: string[] = [];
  if (lead.name)   lines.push(`Nome: ${lead.name}`);
  if (lead.phone)  lines.push(`WhatsApp: ${lead.phone}`);
  if (lead.email)  lines.push(`E-mail: ${lead.email}`);
  if (lead.estado) lines.push(`Estado: ${lead.estado}`);
  if (lead.cidade) lines.push(`Cidade: ${lead.cidade}`);
  if (lead.campaign && lead.campaign !== '—') lines.push(`Campanha: ${lead.campaign}`);
  if (lead.adset    && lead.adset    !== '—') lines.push(`Conjunto: ${lead.adset}`);
  if (lead.ad       && lead.ad       !== '—') lines.push(`Criativo: ${lead.ad}`);
  Object.entries(lead.extra || {}).forEach(([k, v]) => { if (v) lines.push(`${cap(k)}: ${v}`); });
  lines.push(`Data: ${fmtFull(lead.createdAt)}`);
  return lines.join('\n');
}

/** Opções de <select> com contagem, ordenadas alfabeticamente. Vazio/"—" ficam fora. */
function buildOptions(leads: MetaLead[], key: 'estado' | 'campaign' | 'adset' | 'ad') {
  const counts = new Map<string, number>();
  leads.forEach((l) => {
    const v = (l[key] || '').trim();
    if (!v || v === '—') return;
    counts.set(v, (counts.get(v) || 0) + 1);
  });
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
    .map(([value, count]) => ({ value, label: `${value} (${count})` }));
}

function CopyButton({ text, label, copiedKey, active, onCopy }: {
  text: string; label: string; copiedKey: string; active: string | null; onCopy: (key: string, text: string) => void;
}) {
  const copied = active === copiedKey;
  return (
    <button
      onClick={() => onCopy(copiedKey, text)}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold whitespace-nowrap transition-colors
        ${copied ? 'bg-emerald-500/15 text-emerald-300' : 'bg-[#7a3f8f]/10 hover:bg-[#7a3f8f]/20 text-[#d4baeb]'}`}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? 'Copiado!' : label}
    </button>
  );
}

export function Leads({ token }: { token: string }) {
  const [data, setData] = useState<MetaLeadsData | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState<typeof RANGE_OPTIONS[number]['key']>('28d');

  const [estadoFilter, setEstadoFilter]     = useState(TODOS);
  const [campaignFilter, setCampaignFilter] = useState(TODOS);
  const [adsetFilter, setAdsetFilter]       = useState(TODOS);
  const [adFilter, setAdFilter]             = useState(TODOS);
  const [search, setSearch]                 = useState('');

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const load = async (forceRefresh = false) => {
    setLoading(!data);
    if (forceRefresh) setRefreshing(true);
    setError(null);
    try {
      const days = RANGE_OPTIONS.find((r) => r.key === range)?.days || 28;
      const refresh = forceRefresh ? `&refresh=${Date.now()}` : '';
      const r = await fetch(`/api/admin-bookings?endpoint=meta-leads&range=${days}${refresh}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`);
      setData(json);
      setFetchedAt(new Date());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar leads');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [range]);

  const leads = data?.leads || [];

  const kpis = useMemo(() => {
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
    const todayMs = startToday.getTime();
    const now = Date.now();
    let hoje = 0, last7 = 0;
    const estados = new Set<string>();
    leads.forEach((l) => {
      const t = new Date(l.createdAt).getTime();
      if (t >= todayMs) hoje++;
      if (now - t <= 7 * 86400000) last7++;
      if (l.estado && l.estado !== '—') estados.add(l.estado);
    });
    return { total: data?.total ?? leads.length, hoje, last7, estadosCount: estados.size };
  }, [leads, data]);

  const estadoOptions   = useMemo(() => buildOptions(leads, 'estado'),   [leads]);
  const campaignOptions = useMemo(() => buildOptions(leads, 'campaign'), [leads]);
  const adsetOptions    = useMemo(() => buildOptions(leads, 'adset'),    [leads]);
  const adOptions       = useMemo(() => buildOptions(leads, 'ad'),       [leads]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((l) => {
      if (estadoFilter && l.estado !== estadoFilter) return false;
      if (campaignFilter && l.campaign !== campaignFilter) return false;
      if (adsetFilter && l.adset !== adsetFilter) return false;
      if (adFilter && l.ad !== adFilter) return false;
      if (q) {
        const hay = `${l.name} ${l.phone} ${l.email}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [leads, estadoFilter, campaignFilter, adsetFilter, adFilter, search]);

  const handleCopy = (key: string, text: string) => {
    navigator.clipboard.writeText(text)
      .then(() => {
        setCopiedKey(key);
        setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 2000);
      })
      .catch(() => { /* clipboard indisponível — sem feedback, sem crash */ });
  };

  const showPermissionHint = !!error && /403|leads_retrieval/i.test(error);

  return (
    <div className="px-8 py-6 text-white max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#c5a3d4]/60">Leads · Meta Instant Forms</p>
          <h1 className="font-headline text-3xl font-black mt-1">Leads</h1>
          <p className="text-[#d4baeb]/60 text-sm mt-1">
            Leads capturados via formulário nativo do Facebook/Instagram
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
          sources={[{ label: 'Meta Leads', detail: 'Instant Forms', status: error ? 'error' : (data?.configured ? 'live' : 'stale') }]}
          lastFetched={fetchedAt}
          onRefresh={() => load(true)}
          refreshing={refreshing}
        />
      </div>

      {/* Não configurado */}
      {!loading && data && data.configured === false && (
        <div className="mb-6 p-4 rounded-xl border border-white/10 bg-white/[0.03] text-[#d4baeb]/80 text-sm">
          <p className="font-bold text-white">Meta Leads não configurado</p>
          <p className="text-[#d4baeb]/60 mt-1">{data.details}</p>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="mb-6 p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 text-amber-200 text-sm">
          <p className="font-bold">Não foi possível buscar os leads</p>
          <p className="text-amber-200/70 mt-1">{error}</p>
          {showPermissionHint && (
            <p className="text-amber-200/50 mt-2 text-[11px]">
              O token da Meta precisa da permissão leads_retrieval (Business Manager → Usuários do sistema → token com leads_retrieval + acesso à Página).
            </p>
          )}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KpiCard
          label="Leads no período"
          value={data ? kpis.total.toLocaleString('pt-BR') : '—'}
          icon={Users} source="Meta"
          hint={`Últimos ${data?.rangeDays ?? RANGE_OPTIONS.find((r) => r.key === range)?.days} dias`}
          loading={loading}
        />
        <KpiCard
          label="Leads hoje"
          value={data ? kpis.hoje.toLocaleString('pt-BR') : '—'}
          icon={Calendar} source="Meta"
          hint="Desde 00:00 de hoje"
          loading={loading}
        />
        <KpiCard
          label="Últimos 7 dias"
          value={data ? kpis.last7.toLocaleString('pt-BR') : '—'}
          icon={TrendingUp} source="Meta"
          hint="Janela móvel de 7 dias"
          loading={loading}
        />
        <KpiCard
          label="Estados distintos"
          value={data ? kpis.estadosCount.toLocaleString('pt-BR') : '—'}
          icon={MapPin} source="Meta"
          hint="UFs com pelo menos 1 lead"
          loading={loading}
        />
      </div>

      {/* Filter bar */}
      {!loading && leads.length > 0 && (
        <div className="mb-4 p-3 rounded-xl border border-white/[0.08] bg-white/[0.03] flex flex-wrap items-center gap-2">
          <select
            value={estadoFilter} onChange={(e) => setEstadoFilter(e.target.value)}
            className="bg-white/[0.05] border border-white/[0.1] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-[#a578bb]"
          >
            <option value={TODOS}>Estado: Todos</option>
            {estadoOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select
            value={campaignFilter} onChange={(e) => setCampaignFilter(e.target.value)}
            className="bg-white/[0.05] border border-white/[0.1] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-[#a578bb] max-w-[220px]"
          >
            <option value={TODOS}>Campanha: Todas</option>
            {campaignOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select
            value={adsetFilter} onChange={(e) => setAdsetFilter(e.target.value)}
            className="bg-white/[0.05] border border-white/[0.1] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-[#a578bb] max-w-[220px]"
          >
            <option value={TODOS}>Conjunto: Todos</option>
            {adsetOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select
            value={adFilter} onChange={(e) => setAdFilter(e.target.value)}
            className="bg-white/[0.05] border border-white/[0.1] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-[#a578bb] max-w-[220px]"
          >
            <option value={TODOS}>Criativo: Todos</option>
            {adOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input
            type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar nome, telefone ou e-mail..."
            className="flex-1 min-w-[180px] bg-white/[0.05] border border-white/[0.1] rounded-lg px-2.5 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-[#a578bb]"
          />
        </div>
      )}

      {/* Table */}
      {!loading && leads.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-5">
          <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
            <div>
              <h3 className="text-sm font-bold text-white">Leads</h3>
              <p className="text-[11px] text-[#d4baeb]/50 mt-0.5">
                {filtered.length} de {leads.length} {leads.length === 1 ? 'lead' : 'leads'}
              </p>
            </div>
            <CopyButton
              text={filtered.map(leadText).join('\n---\n')}
              label={`Copiar todos (${filtered.length})`}
              copiedKey="all"
              active={copiedKey}
              onCopy={handleCopy}
            />
          </div>

          <div className="overflow-auto max-h-[560px] rounded-lg border border-white/[0.06]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-[#150c26]">
                <tr className="border-b border-white/10">
                  {['Data', 'Nome', 'WhatsApp', 'E-mail', 'Estado', 'Cidade', 'Campanha', 'Conjunto', 'Criativo', ''].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-[#c5a3d4]/60 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-6 text-center text-white/30">Nenhum lead corresponde aos filtros.</td>
                  </tr>
                ) : (
                  filtered.map((l) => {
                    const wa = waLink(l.phone);
                    return (
                      <tr key={l.id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors">
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums text-white/70">{fmtShort(l.createdAt)}</td>
                        <td className="px-3 py-2 text-[#e5d2ef] max-w-[160px] truncate" title={l.name}>{l.name || '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {wa
                            ? <a href={wa} target="_blank" rel="noopener noreferrer" className="text-emerald-300 hover:text-emerald-200 underline decoration-dotted underline-offset-2">{l.phone}</a>
                            : <span className="text-white/40">—</span>}
                        </td>
                        <td className="px-3 py-2 max-w-[180px] truncate" title={l.email}>{l.email || '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{l.estado || '—'}</td>
                        <td className="px-3 py-2 max-w-[140px] truncate" title={l.cidade}>{l.cidade || '—'}</td>
                        <td className="px-3 py-2 max-w-[160px] truncate" title={l.campaign}>{l.campaign}</td>
                        <td className="px-3 py-2 max-w-[160px] truncate" title={l.adset}>{l.adset}</td>
                        <td className="px-3 py-2 max-w-[160px] truncate" title={l.ad}>{l.ad}</td>
                        <td className="px-3 py-2">
                          <CopyButton text={leadText(l)} label="Copiar" copiedKey={l.id} active={copiedKey} onCopy={handleCopy} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Vazio — configurado, sem erro, mas 0 leads no período */}
      {!loading && data?.configured && leads.length === 0 && !error && (
        <div className="p-6 rounded-xl border border-white/10 bg-white/[0.03] text-center text-[#d4baeb]/50 text-sm">
          Nenhum lead nativo do Meta no período selecionado.
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => <div key={i} className="h-8 bg-white/[0.02] rounded animate-pulse" />)}
        </div>
      )}

      <p className="text-center text-[10px] text-[#c5a3d4]/30 mt-8 pb-4">
        Dados via Meta Graph API · Instant Forms (Lead Ads)
      </p>
    </div>
  );
}
