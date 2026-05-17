/**
 * ChannelBar — barra horizontal ordenada por valor (Top N canais/fontes).
 *
 * Mais legível que pie chart pra quem não é técnico:
 *  - Ordem visual clara (maior → menor)
 *  - Valor absoluto + percentual ao lado
 *  - Não pede "decodificar fatia"
 */

interface Row {
  label: string;
  value: number;
  /** Categoria pra colorir (paid_social, organic_social, direct, referral, organic_search, other) */
  category?: 'paid_social' | 'organic_social' | 'direct' | 'referral' | 'organic_search' | 'email' | 'paid_search' | 'other';
}

interface Props {
  title: string;
  data: Row[];
  /** Unidade pra mostrar (ex: "sessões", "usuários") */
  unit?: string;
  /** Fonte */
  source?: string;
  loading?: boolean;
}

const CATEGORY_COLORS: Record<string, string> = {
  paid_social:    '#7a3f8f', // roxo (ads pagos)
  organic_social: '#c5a3d4', // roxo claro
  direct:         '#6ee7b7', // verde
  referral:       '#e87060', // laranja
  organic_search: '#60a5fa', // azul
  email:          '#f472b6', // rosa
  paid_search:    '#fbbf24', // amarelo
  other:          '#71717a', // cinza
};

export function ChannelBar({ title, data, unit = '', source, loading }: Props) {
  const total = data.reduce((sum, r) => sum + r.value, 0);
  const sorted = [...data].sort((a, b) => b.value - a.value);
  const max = sorted[0]?.value || 1;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-5">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h3 className="text-sm font-bold text-white">{title}</h3>
          <p className="text-[11px] text-[#d4baeb]/50 mt-0.5">{total.toLocaleString('pt-BR')} {unit} total</p>
        </div>
        {source && <p className="text-[9px] uppercase tracking-wider text-[#c5a3d4]/30">{source}</p>}
      </div>

      <div className="space-y-2.5">
        {loading ? (
          [...Array(5)].map((_, i) => (
            <div key={i} className="h-7 bg-white/[0.02] rounded animate-pulse" />
          ))
        ) : sorted.map((row) => {
          const pct = total > 0 ? (row.value / total) * 100 : 0;
          const barWidth = (row.value / max) * 100;
          const color = CATEGORY_COLORS[row.category || 'other'];
          return (
            <div key={row.label} className="group">
              <div className="flex items-baseline justify-between text-xs mb-1">
                <span className="text-white font-medium truncate flex-1 mr-2">{row.label}</span>
                <span className="tabular-nums text-[#d4baeb]/70">
                  <span className="text-white font-semibold">{row.value.toLocaleString('pt-BR')}</span>
                  <span className="text-[#c5a3d4]/50 ml-1.5">({pct.toFixed(1)}%)</span>
                </span>
              </div>
              <div className="h-2 bg-white/[0.05] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500 group-hover:brightness-110"
                  style={{ width: `${barWidth}%`, background: color }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
