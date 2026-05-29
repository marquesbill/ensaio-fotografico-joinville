/**
 * Gerador de relatório consolidado do dashboard.
 *
 * Busca em paralelo todos os endpoints que alimentam o dashboard
 * (GA4, Clarity, Sheets, Meta Ads, Geo, Economics), roda Monte Carlo
 * de projeção de receita até o fim do festival, e produz markdown
 * pra download.
 *
 * 100% no front — usa o token da sessão. Sem novo backend.
 *
 * Uso:
 *   const md = await generateFullReport(token, user);
 *   downloadMarkdown(md, reportFilename(user));
 *
 * NOTA: os tipos abaixo refletem o shape REAL dos endpoints em
 * api/admin-bookings.ts (não shapes idealizados). Se o backend mudar,
 * o renderer abaixo é defensivo — usa optional chaining + fallback "—".
 */

// Data alvo do festival — define o horizonte da projeção Monte Carlo.
const FESTIVAL_END_DATE = '2026-08-02';

// 10k iterações: tradeoff entre precisão (erro ~1/√N) e tempo no browser (~50-100ms).
const MC_ITERATIONS = 10_000;

// Janela histórica do bootstrap. 28d cobre ~4 semanas (suaviza weekly seasonality).
const MC_HISTORY_DAYS = 28;

/* ─────────────────────────── Types (shape real dos endpoints) ─────────────────────────── */

type Json = unknown;

interface DailyPoint { date: string; count: number }

interface SheetsBookings {
  fetched_at?:      string;
  total_customers?: number;
  total_ensaios?:   number;
  by_package?:      Record<string, Json>;
  by_status?:       { confirmado?: { customers: number; ensaios: number }; pendente?: { customers: number; ensaios: number } };
  by_state?:        Array<{ state: string; count: number }>;
  by_ddd?:          Array<{ ddd: string; count: number }>;
  daily?:           DailyPoint[];
  recent?:          Array<{ id: string; name: string; pacote: string; date: string; status: string; criado_em: string }>;
  error?:           string;
}

interface SheetsLeads {
  fetched_at?:  string;
  range_days?:  number | string;
  total?:       number;
  by_source?:   Json;
  by_intent?:   Json;
  by_state?:    Json;
  by_ddd?:      Json;
  daily?:       DailyPoint[];
  recent?:      Json[];
  deltas?:      Record<string, number | null>;
  error?:       string;
}

interface Economics {
  fetched_at?:    string;
  range?:         { since: string; until: string; days: number; note?: string };
  deltas_window?: { days: number; note?: string };
  revenue?:       { total: number; ensaios: number; avg_ticket: number; delta_pct?: number; ensaios_delta_pct?: number };
  costs?:         Json;
  kpis?:          { roas: number; cpa_real: number; cpa_meta: number; profit: number; breakeven?: Json };
  error?:         string;
}

interface Ga4Dashboard {
  range?:        { start: string; end: string; days: number };
  fetched_at?:   string;
  kpis?:         Record<string, { value: number; deltaPct: number }>;
  trend?:        Array<{ date: string; value: number }>;
  channels?:     Array<{ label: string; value: number; category: string }>;
  topEvents?:    Array<{ event_name: string; count: number }>;
  error?:        string;
}

interface Ga4Acquisition {
  range?:        { start: string; end: string; days: number };
  fetched_at?:   string;
  kpis?:         Record<string, { value: number; deltaPct: number }>;
  channels?:     Array<{ label: string; category: string; sessions: number; users: number; engagementRate: number }>;
  sources?:      Array<{ source: string; medium: string; label: string; sessions: number; users: number; engagementRate: number }>;
  campaigns?:    Array<{ campaign: string; sessions: number; users: number; engagementRate: number }>;
  error?:        string;
}

interface Ga4Funnel {
  fetched_at?:        string;
  range?:             { days: number };
  funnel?:            Json;
  funnel_by_origin?:  Json;
  packages?:          Array<{ id: string; selects: number; purchases: number; revenue: number }>;
  error?:             string;
}

interface Ga4Engagement {
  fetched_at?:   string;
  range?:        { days: number };
  kpis?:         Record<string, { value: number; deltaPct: number }>;
  scrollDepth?:  Json;
  forms?:        Json;
  faq?:          Json;
  topEvents?:    Array<{ event_name: string; count: number }>;
  error?:        string;
}

interface Ga4Behavior {
  fetched_at?:        string;
  range?:             { days: number };
  devices?:           Json;
  new_vs_returning?:  Json;
  hours?:             Json;
  peak_hour?:         Json;
  days_of_week?:      Json;
  cities?:            Array<{ city: string; country: string; sessions: number }>;
  error?:             string;
}

interface ClarityInsights {
  fetched_at?:  string;
  metrics?:     Json;
  kpis?:        Json;
  cache_hit?:   boolean;
  error?:       string;
}

interface MetaAds {
  fetched_at?:  string;
  range?:       { since: string; until: string; days: number };
  account?:     Json;
  campaigns?:   Json[];
  adsets?:      Json[];
  ads?:         Json[];
  error?:       string;
}

interface GeoBrazil {
  fetched_at?:  string;
  states?:      Record<string, { leads: number; clientes: number; sessions: number; impressions: number }>;
  sources?:     Json;
  errors?:      Json;
  error?:       string;
}

export interface FullReportData {
  ga4Dashboard:    Ga4Dashboard | null;
  ga4Acquisition:  Ga4Acquisition | null;
  ga4Funnel:       Ga4Funnel | null;
  ga4Engagement:   Ga4Engagement | null;
  ga4Behavior:     Ga4Behavior | null;
  clarity:         ClarityInsights | null;
  sheetsBookings:  SheetsBookings | null;
  sheetsLeads:     SheetsLeads | null;
  economics:       Economics | null;
  geoBrazil:       GeoBrazil | null;
  metaAds:         MetaAds | null;
  errors:          Record<string, string>;
}

export interface MonteCarloResult {
  daysRemaining:   number;
  targetDate:      string;
  iterations:      number;
  historyDays:     number;
  avgTicket:       number;
  bookings: { p10: number; p50: number; p90: number; mean: number; min: number; max: number };
  revenue:  { p10: number; p50: number; p90: number; mean: number; min: number; max: number };
  totalProjected: { p10: number; p50: number; p90: number; mean: number };
  note?:           string;
}

/* ─────────────────────────── Fetch all data ─────────────────────────── */

async function fetchEndpoint<T>(
  endpoint: string,
  token: string,
): Promise<{ data: T | null; error: string | null }> {
  try {
    const r = await fetch(`/api/admin-bookings?endpoint=${endpoint}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await r.json() as { error?: string };
    if (!r.ok) return { data: null, error: json.error || `HTTP ${r.status}` };
    return { data: json as T, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function fetchAllReportData(token: string): Promise<FullReportData> {
  // Tudo em paralelo. Falhas individuais não derrubam o resto.
  const [
    ga4Dashboard, ga4Acquisition, ga4Funnel, ga4Engagement, ga4Behavior,
    clarity, sheetsBookings, sheetsLeads, economics, geoBrazil, metaAds,
  ] = await Promise.all([
    fetchEndpoint<Ga4Dashboard>('ga4-dashboard', token),
    fetchEndpoint<Ga4Acquisition>('ga4-acquisition', token),
    fetchEndpoint<Ga4Funnel>('ga4-funnel', token),
    fetchEndpoint<Ga4Engagement>('ga4-engagement', token),
    fetchEndpoint<Ga4Behavior>('ga4-behavior', token),
    fetchEndpoint<ClarityInsights>('clarity-insights', token),
    fetchEndpoint<SheetsBookings>('sheets-bookings', token),
    fetchEndpoint<SheetsLeads>('sheets-leads', token),
    fetchEndpoint<Economics>('economics', token),
    fetchEndpoint<GeoBrazil>('geo-brazil', token),
    fetchEndpoint<MetaAds>('meta-ads', token),
  ]);

  const errors: Record<string, string> = {};
  const collect = (key: string, r: { error: string | null }) => {
    if (r.error) errors[key] = r.error;
  };
  collect('ga4-dashboard', ga4Dashboard);
  collect('ga4-acquisition', ga4Acquisition);
  collect('ga4-funnel', ga4Funnel);
  collect('ga4-engagement', ga4Engagement);
  collect('ga4-behavior', ga4Behavior);
  collect('clarity-insights', clarity);
  collect('sheets-bookings', sheetsBookings);
  collect('sheets-leads', sheetsLeads);
  collect('economics', economics);
  collect('geo-brazil', geoBrazil);
  collect('meta-ads', metaAds);

  return {
    ga4Dashboard:   ga4Dashboard.data,
    ga4Acquisition: ga4Acquisition.data,
    ga4Funnel:      ga4Funnel.data,
    ga4Engagement:  ga4Engagement.data,
    ga4Behavior:    ga4Behavior.data,
    clarity:        clarity.data,
    sheetsBookings: sheetsBookings.data,
    sheetsLeads:    sheetsLeads.data,
    economics:      economics.data,
    geoBrazil:      geoBrazil.data,
    metaAds:        metaAds.data,
    errors,
  };
}

/* ─────────────────────────── Monte Carlo ─────────────────────────── */

/**
 * Constrói série diária de ensaios confirmados a partir do daily array
 * de sheets-bookings. Preenche dias sem ensaios com 0 (distribuição
 * fiel à variância real — sem o 0-pad, sortear só de dias-com-venda
 * superestima).
 */
function buildDailySeries(
  daily: DailyPoint[] | undefined,
  historyDays: number,
): number[] {
  if (!daily || daily.length === 0) return [];
  // Mapeia date → count pra lookup O(1)
  const byDate: Record<string, number> = {};
  for (const p of daily) byDate[p.date] = p.count;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const series: number[] = [];
  for (let i = historyDays - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const iso = d.toISOString().slice(0, 10);
    series.push(byDate[iso] || 0);
  }
  return series;
}

export function runMonteCarlo(data: FullReportData): MonteCarloResult {
  const target = new Date(FESTIVAL_END_DATE + 'T23:59:59-03:00').getTime();
  const now = Date.now();
  const daysRemaining = Math.max(0, Math.ceil((target - now) / 86400000));

  const series = buildDailySeries(data.sheetsBookings?.daily, MC_HISTORY_DAYS);
  const avgTicket = data.economics?.revenue?.avg_ticket || 1600;
  const confirmedToDate = data.economics?.revenue?.ensaios ?? data.sheetsBookings?.total_ensaios ?? 0;

  if (daysRemaining === 0 || series.length === 0) {
    return {
      daysRemaining,
      targetDate: FESTIVAL_END_DATE,
      iterations: 0,
      historyDays: series.length,
      avgTicket,
      bookings: { p10: 0, p50: 0, p90: 0, mean: 0, min: 0, max: 0 },
      revenue:  { p10: 0, p50: 0, p90: 0, mean: 0, min: 0, max: 0 },
      totalProjected: { p10: confirmedToDate, p50: confirmedToDate, p90: confirmedToDate, mean: confirmedToDate },
      note: daysRemaining === 0
        ? 'Festival já passou — sem projeção futura'
        : 'Sem série diária histórica em sheets-bookings.daily',
    };
  }

  // Bootstrap: cada iteração sorteia `daysRemaining` dias com reposição.
  const results: number[] = new Array(MC_ITERATIONS);
  for (let i = 0; i < MC_ITERATIONS; i++) {
    let total = 0;
    for (let d = 0; d < daysRemaining; d++) {
      total += series[Math.floor(Math.random() * series.length)];
    }
    results[i] = total;
  }
  results.sort((a, b) => a - b);

  const pct = (q: number) => results[Math.min(results.length - 1, Math.floor(MC_ITERATIONS * q))];
  const mean = results.reduce((s, n) => s + n, 0) / MC_ITERATIONS;

  const b = {
    p10: pct(0.10), p50: pct(0.50), p90: pct(0.90),
    mean,
    min: results[0], max: results[results.length - 1],
  };
  const r = {
    p10: b.p10 * avgTicket, p50: b.p50 * avgTicket, p90: b.p90 * avgTicket,
    mean: b.mean * avgTicket,
    min: b.min * avgTicket, max: b.max * avgTicket,
  };

  return {
    daysRemaining,
    targetDate: FESTIVAL_END_DATE,
    iterations: MC_ITERATIONS,
    historyDays: series.length,
    avgTicket,
    bookings: b,
    revenue:  r,
    totalProjected: {
      p10:  confirmedToDate + b.p10,
      p50:  confirmedToDate + b.p50,
      p90:  confirmedToDate + b.p90,
      mean: confirmedToDate + b.mean,
    },
  };
}

/* ─────────────────────────── Markdown helpers ─────────────────────────── */

const fmtBRL = (n: number | undefined | null): string =>
  n == null ? '—' : 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n: number | undefined | null): string =>
  n == null ? '—' : Math.round(n).toLocaleString('pt-BR');
const fmtPct = (n: number | undefined | null, digits = 1): string =>
  n == null ? '—' : (n * 100).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits }) + '%';
const fmtDelta = (n: number | undefined | null): string => {
  if (n == null) return '—';
  const arrow = n > 0 ? '▲' : n < 0 ? '▼' : '•';
  const sign  = n > 0 ? '+' : '';
  return `${arrow} ${sign}${(n * 100).toFixed(1)}%`;
};

function section(title: string, body: string): string {
  return `\n## ${title}\n\n${body}\n`;
}

function table(headers: string[], rows: Array<Array<string | number>>): string {
  if (rows.length === 0) return '_Sem dados_';
  const head = `| ${headers.join(' | ')} |`;
  const sep  = `|${headers.map(() => '---').join('|')}|`;
  const body = rows.map(r => `| ${r.map(c => String(c)).join(' | ')} |`).join('\n');
  return `${head}\n${sep}\n${body}`;
}

function kvList(pairs: Array<[string, string]>): string {
  return pairs.map(([k, v]) => `- **${k}:** ${v}`).join('\n');
}

function jsonBlock(label: string, value: Json): string {
  if (value == null) return `_${label}: sem dados_`;
  if (Array.isArray(value) && value.length === 0) return `_${label}: vazio_`;
  if (typeof value === 'object' && Object.keys(value as Record<string, unknown>).length === 0) {
    return `_${label}: vazio_`;
  }
  return `### ${label}\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function unavailable(d: { error?: string } | null): string {
  return `_Indisponível: ${d?.error ?? 'sem resposta'}_`;
}

/* ─────────────────────────── Section builders ─────────────────────────── */

function buildGa4DashboardSection(d: Ga4Dashboard | null): string {
  if (!d || d.error) return unavailable(d);
  const kpisRows = Object.entries(d.kpis || {}).map(([k, v]) => [k, fmtInt(v.value), fmtDelta(v.deltaPct)]);
  const channelsRows = (d.channels || []).slice(0, 10).map(c => [c.label, c.category, fmtInt(c.value)]);
  const eventsRows = (d.topEvents || []).slice(0, 15).map(e => [e.event_name, fmtInt(e.count)]);
  return [
    `_Janela: últimos ${d.range?.days ?? '?'}d · fetched_at: ${d.fetched_at ?? '?'}_`,
    '',
    '### KPIs principais',
    table(['Métrica', 'Valor', 'Δ vs período anterior'], kpisRows),
    '',
    '### Canais',
    table(['Canal', 'Categoria', 'Sessões'], channelsRows),
    '',
    '### Top eventos',
    table(['Evento', 'Contagem'], eventsRows),
  ].join('\n');
}

function buildAcquisitionSection(d: Ga4Acquisition | null): string {
  if (!d || d.error) return unavailable(d);
  const kpisRows = Object.entries(d.kpis || {}).map(([k, v]) => [k, fmtInt(v.value), fmtDelta(v.deltaPct)]);
  const channelsRows = (d.channels || []).map(c => [
    c.label, c.category, fmtInt(c.sessions), fmtInt(c.users), fmtPct(c.engagementRate),
  ]);
  const sourcesRows = (d.sources || []).slice(0, 15).map(s => [
    s.label, fmtInt(s.sessions), fmtInt(s.users), fmtPct(s.engagementRate),
  ]);
  const campaignsRows = (d.campaigns || []).map(c => [
    c.campaign, fmtInt(c.sessions), fmtInt(c.users), fmtPct(c.engagementRate),
  ]);
  return [
    `_Janela: últimos ${d.range?.days ?? '?'}d · fetched_at: ${d.fetched_at ?? '?'}_`,
    '',
    '### KPIs',
    table(['Métrica', 'Valor', 'Δ'], kpisRows),
    '',
    '### Canais',
    table(['Canal', 'Categoria', 'Sessões', 'Usuários', 'Engajamento'], channelsRows),
    '',
    '### Sources (top 15)',
    table(['Origem', 'Sessões', 'Usuários', 'Engajamento'], sourcesRows),
    '',
    '### Campanhas UTM',
    table(['Campanha', 'Sessões', 'Usuários', 'Engajamento'], campaignsRows),
  ].join('\n');
}

function buildFunnelSection(d: Ga4Funnel | null): string {
  if (!d || d.error) return unavailable(d);
  const pkgs = (d.packages || []).map(p => [
    p.id, fmtInt(p.selects), fmtInt(p.purchases), fmtBRL(p.revenue),
  ]);
  return [
    `_Janela: ${d.range?.days ?? '?'}d · fetched_at: ${d.fetched_at ?? '?'}_`,
    '',
    '### Por pacote',
    table(['Pacote', 'Selects', 'Purchases', 'Receita'], pkgs),
    '',
    jsonBlock('Funil (steps)', d.funnel ?? null),
    '',
    jsonBlock('Funil por origem', d.funnel_by_origin ?? null),
  ].join('\n');
}

function buildEngagementSection(d: Ga4Engagement | null): string {
  if (!d || d.error) return unavailable(d);
  const kpisRows = Object.entries(d.kpis || {}).map(([k, v]) => [k, fmtInt(v.value), fmtDelta(v.deltaPct)]);
  const eventsRows = (d.topEvents || []).slice(0, 20).map(e => [e.event_name, fmtInt(e.count)]);
  return [
    `_Janela: ${d.range?.days ?? '?'}d · fetched_at: ${d.fetched_at ?? '?'}_`,
    '',
    '### KPIs',
    table(['Métrica', 'Valor', 'Δ'], kpisRows),
    '',
    '### Top eventos',
    table(['Evento', 'Contagem'], eventsRows),
    '',
    jsonBlock('Scroll depth', d.scrollDepth ?? null),
    '',
    jsonBlock('Forms', d.forms ?? null),
    '',
    jsonBlock('FAQ', d.faq ?? null),
  ].join('\n');
}

function buildBehaviorSection(d: Ga4Behavior | null): string {
  if (!d || d.error) return unavailable(d);
  const citiesRows = (d.cities || []).slice(0, 15).map(c => [
    [c.country, c.city].filter(Boolean).join(' / '), fmtInt(c.sessions),
  ]);
  return [
    `_Janela: ${d.range?.days ?? '?'}d · fetched_at: ${d.fetched_at ?? '?'}_`,
    '',
    jsonBlock('Devices', d.devices ?? null),
    '',
    jsonBlock('Novos vs recorrentes', d.new_vs_returning ?? null),
    '',
    jsonBlock('Horário pico', d.peak_hour ?? null),
    '',
    jsonBlock('Sessões por hora', d.hours ?? null),
    '',
    jsonBlock('Sessões por dia da semana', d.days_of_week ?? null),
    '',
    '### Top cidades',
    table(['Local', 'Sessões'], citiesRows),
  ].join('\n');
}

function buildClaritySection(d: ClarityInsights | null): string {
  if (!d || d.error) return unavailable(d);
  return [
    `_fetched_at: ${d.fetched_at ?? '?'} · cache_hit: ${d.cache_hit ?? '?'}_`,
    '',
    jsonBlock('KPIs', d.kpis ?? null),
    '',
    jsonBlock('Métricas (frictions)', d.metrics ?? null),
  ].join('\n');
}

function buildBookingsSection(d: SheetsBookings | null): string {
  if (!d || d.error) return unavailable(d);
  const totalsBlock = kvList([
    ['Clientes únicos', fmtInt(d.total_customers)],
    ['Ensaios totais',  fmtInt(d.total_ensaios)],
    ['Confirmados',     fmtInt(d.by_status?.confirmado?.ensaios)],
    ['Pendentes',       fmtInt(d.by_status?.pendente?.ensaios)],
  ]);
  const recentRows = (d.recent || []).slice(0, 25).map(r => [
    r.id, r.name, r.pacote, r.date, r.status, r.criado_em,
  ]);
  const stateRows = (d.by_state || []).slice(0, 10).map(s => [s.state, fmtInt(s.count)]);
  const dailyRows = (d.daily || []).slice(-30).map(p => [p.date, fmtInt(p.count)]);
  return [
    `_fetched_at: ${d.fetched_at ?? '?'}_`,
    '',
    '### Totais',
    totalsBlock,
    '',
    jsonBlock('Por pacote', d.by_package ?? null),
    '',
    '### Top estados',
    table(['UF', 'Clientes'], stateRows),
    '',
    '### Série diária (últimos 30 pontos)',
    table(['Data', 'Ensaios'], dailyRows),
    '',
    '### Recentes (até 25)',
    table(['ID', 'Cliente', 'Pacote', 'Data', 'Status', 'Criado em'], recentRows),
  ].join('\n');
}

function buildLeadsSection(d: SheetsLeads | null): string {
  if (!d || d.error) return unavailable(d);
  const summary = kvList([
    ['Total',  fmtInt(d.total)],
    ['Janela', d.range_days == null ? '—' : String(d.range_days)],
    ['Δ total', fmtDelta(d.deltas?.total ?? null)],
    ['Δ intent sim', fmtDelta(d.deltas?.intent_sim ?? null)],
  ]);
  const dailyRows = (d.daily || []).slice(-30).map(p => [p.date, fmtInt(p.count)]);
  return [
    `_fetched_at: ${d.fetched_at ?? '?'}_`,
    '',
    '### Resumo',
    summary,
    '',
    jsonBlock('Por source', d.by_source ?? null),
    '',
    jsonBlock('Por intent', d.by_intent ?? null),
    '',
    '### Diário (últimos 30 pontos)',
    table(['Data', 'Leads'], dailyRows),
  ].join('\n');
}

function buildEconomicsSection(d: Economics | null): string {
  if (!d || d.error) return unavailable(d);
  const rev = kvList([
    ['Receita total',  fmtBRL(d.revenue?.total)],
    ['Nº ensaios',     fmtInt(d.revenue?.ensaios)],
    ['Ticket médio',   fmtBRL(d.revenue?.avg_ticket)],
    ['Δ receita',      fmtDelta(d.revenue?.delta_pct ?? null)],
    ['Δ ensaios',      fmtDelta(d.revenue?.ensaios_delta_pct ?? null)],
  ]);
  const margins = kvList([
    ['ROAS',           d.kpis?.roas != null ? d.kpis.roas.toFixed(2) + 'x' : '—'],
    ['CPA real',       fmtBRL(d.kpis?.cpa_real)],
    ['CPA Meta',       fmtBRL(d.kpis?.cpa_meta)],
    ['Profit',         fmtBRL(d.kpis?.profit)],
  ]);
  return [
    `_Janela: ${d.range?.since ?? '?'} → ${d.range?.until ?? '?'} (${d.range?.days ?? '?'}d) · fetched_at: ${d.fetched_at ?? '?'}_`,
    `_Δ window: ${d.deltas_window?.note ?? '—'}_`,
    '',
    '### Receita',
    rev,
    '',
    '### Margens / KPIs',
    margins,
    '',
    jsonBlock('Custos (breakdown)', d.costs ?? null),
    '',
    jsonBlock('Break-even', d.kpis?.breakeven ?? null),
  ].join('\n');
}

function buildGeoSection(d: GeoBrazil | null): string {
  if (!d || d.error) return unavailable(d);
  const rows = Object.entries(d.states ?? {})
    .filter(([, v]) => v.leads + v.clientes + v.sessions + v.impressions > 0)
    .sort((a, b) => (b[1].clientes + b[1].leads) - (a[1].clientes + a[1].leads))
    .map(([uf, v]) => [uf, fmtInt(v.clientes), fmtInt(v.leads), fmtInt(v.sessions), fmtInt(v.impressions)]);
  return [
    `_fetched_at: ${d.fetched_at ?? '?'}_`,
    '',
    table(['UF', 'Clientes', 'Leads', 'Sessões', 'Impressões'], rows),
  ].join('\n');
}

function buildMetaAdsSection(d: MetaAds | null): string {
  if (!d || d.error) return unavailable(d);
  return [
    `_Janela: ${d.range?.since ?? '?'} → ${d.range?.until ?? '?'} (${d.range?.days ?? '?'}d) · fetched_at: ${d.fetched_at ?? '?'}_`,
    '',
    jsonBlock('Account summary', d.account ?? null),
    '',
    jsonBlock('Campanhas', d.campaigns ?? null),
    '',
    jsonBlock('Ad sets', d.adsets ?? null),
    '',
    jsonBlock('Ads', d.ads ?? null),
  ].join('\n');
}

function buildMonteCarloSection(mc: MonteCarloResult): string {
  const header = kvList([
    ['Alvo',                  mc.targetDate],
    ['Dias restantes',        String(mc.daysRemaining)],
    ['Iterações',             fmtInt(mc.iterations)],
    ['Histórico bootstrap',   `${mc.historyDays} dias`],
    ['Ticket médio assumido', fmtBRL(mc.avgTicket)],
  ]);
  if (mc.note) return `${header}\n\n_${mc.note}_`;

  const bookingsTable = table(
    ['Cenário', 'Novos ensaios projetados'],
    [
      ['P10 (pessimista)', fmtInt(mc.bookings.p10)],
      ['P50 (mediano)',    fmtInt(mc.bookings.p50)],
      ['P90 (otimista)',   fmtInt(mc.bookings.p90)],
      ['Média',            fmtInt(mc.bookings.mean)],
      ['Min/Max amostral', `${fmtInt(mc.bookings.min)} / ${fmtInt(mc.bookings.max)}`],
    ],
  );
  const revenueTable = table(
    ['Cenário', 'Receita projetada do período'],
    [
      ['P10 (pessimista)', fmtBRL(mc.revenue.p10)],
      ['P50 (mediano)',    fmtBRL(mc.revenue.p50)],
      ['P90 (otimista)',   fmtBRL(mc.revenue.p90)],
      ['Média',            fmtBRL(mc.revenue.mean)],
    ],
  );
  const totalTable = table(
    ['Cenário', 'Total acumulado (confirmados + projeção)'],
    [
      ['P10',   fmtInt(mc.totalProjected.p10)],
      ['P50',   fmtInt(mc.totalProjected.p50)],
      ['P90',   fmtInt(mc.totalProjected.p90)],
      ['Média', fmtInt(mc.totalProjected.mean)],
    ],
  );
  return [
    header,
    '',
    `### Novos ensaios (próximos ${mc.daysRemaining} dias)`,
    bookingsTable,
    '',
    '### Receita projetada (do período)',
    revenueTable,
    '',
    `### Total acumulado até ${mc.targetDate}`,
    totalTable,
    '',
    `> **Método:** Bootstrap dos últimos ${mc.historyDays} dias da série diária de ensaios confirmados (\`sheets-bookings.daily\`). Cada uma das ${fmtInt(mc.iterations)} iterações sorteia ${mc.daysRemaining} dias com reposição e soma. Receita = nº ensaios × ticket médio atual.`,
    `> **Limitação:** assume estabilidade de conversão e mix. Não modela sazonalidade explícita, lotes de preço futuros (LOTE2 em 2026-06-01), nem efeito de campanhas em curso.`,
  ].join('\n');
}

export function buildMarkdownReport(data: FullReportData, mc: MonteCarloResult, generatedBy: string): string {
  const now = new Date();
  const timestamp = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const iso = now.toISOString();
  const errorCount = Object.keys(data.errors).length;
  const errorBlock = errorCount === 0
    ? '_Todas as fontes responderam com sucesso._'
    : '```\n' + Object.entries(data.errors).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n```';

  return [
    `# Relatório J26 — Marketing & Operações`,
    ``,
    `**Gerado em:** ${timestamp} (BRT) · \`${iso}\``,
    `**Por:** ${generatedBy}`,
    `**Fontes:** GA4 · Microsoft Clarity · Google Sheets (Agendamentos + Leads) · Meta Ads · Geo (agregado)`,
    ``,
    `---`,
    section('Resumo executivo', [
      `- **Confirmados até hoje:** ${fmtInt(data.economics?.revenue?.ensaios ?? data.sheetsBookings?.total_ensaios)} ensaios`,
      `- **Receita acumulada:** ${fmtBRL(data.economics?.revenue?.total)}`,
      `- **Ticket médio:** ${fmtBRL(data.economics?.revenue?.avg_ticket)}`,
      `- **ROAS:** ${data.economics?.kpis?.roas != null ? data.economics.kpis.roas.toFixed(2) + 'x' : '—'}`,
      `- **Projeção Monte Carlo (P50):** ${fmtInt(mc.totalProjected.p50)} ensaios totais até ${mc.targetDate} (${fmtBRL(mc.revenue.p50)} de receita adicional)`,
      ``,
      `_Detalhamento por seção abaixo. Cada bloco inclui o timestamp da coleta da fonte (\`fetched_at\`)._`,
    ].join('\n')),
    section('Erros / fontes indisponíveis', errorBlock),
    section('1. GA4 — Visão geral', buildGa4DashboardSection(data.ga4Dashboard)),
    section('2. GA4 — Aquisição',    buildAcquisitionSection(data.ga4Acquisition)),
    section('3. GA4 — Funil',        buildFunnelSection(data.ga4Funnel)),
    section('4. GA4 — Engajamento',  buildEngagementSection(data.ga4Engagement)),
    section('5. GA4 — Comportamento', buildBehaviorSection(data.ga4Behavior)),
    section('6. Microsoft Clarity',  buildClaritySection(data.clarity)),
    section('7. Sheets — Agendamentos', buildBookingsSection(data.sheetsBookings)),
    section('8. Sheets — Leads',     buildLeadsSection(data.sheetsLeads)),
    section('9. Economia (Receita × Custos)', buildEconomicsSection(data.economics)),
    section('10. Geo Brasil',         buildGeoSection(data.geoBrazil)),
    section('11. Meta Ads',           buildMetaAdsSection(data.metaAds)),
    section('12. Projeção Monte Carlo', buildMonteCarloSection(mc)),
    ``,
    `---`,
    ``,
    `_Relatório gerado automaticamente · \`${iso}\`_`,
    ``,
  ].join('\n');
}

/* ─────────────────────────── Public API ─────────────────────────── */

export async function generateFullReport(token: string, generatedBy: string): Promise<string> {
  const data = await fetchAllReportData(token);
  const mc   = runMonteCarlo(data);
  return buildMarkdownReport(data, mc, generatedBy);
}

export function downloadMarkdown(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function reportFilename(generatedBy: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `relatorio-j26-${generatedBy}-${stamp}.md`;
}
