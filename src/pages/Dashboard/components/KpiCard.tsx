/**
 * KpiCard — card grande de KPI com valor, label, tendência e nota de fonte.
 *
 * Design objetivo:
 *  - Número GRANDE e legível (font-bold 4xl)
 *  - Label curto acima
 *  - Indicador de tendência (▲ ▼ →) com cor semântica
 *  - Nota de fonte sempre presente no rodapé (small, low contrast)
 */

import type { LucideIcon } from 'lucide-react';
import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';

interface Props {
  label: string;
  value: string | number;
  /** Variação percentual vs período anterior (ex: 23.5 = +23.5%). null = sem comparação */
  deltaPct?: number | null;
  /** Texto do período comparado (ex: "vs 28 dias anteriores") */
  deltaLabel?: string;
  /** Ícone opcional no canto superior direito */
  icon?: LucideIcon;
  /** Nota de fonte (sempre visível em rodapé) */
  source?: string;
  /** Hint contextual de baixa importância — formata e explica o que é a métrica */
  hint?: string;
  /** Estado de loading enquanto API busca dados */
  loading?: boolean;
}

export function KpiCard({ label, value, deltaPct, deltaLabel, icon: Icon, source, hint, loading }: Props) {
  const delta = deltaPct ?? null;
  const trendUp = delta !== null && delta > 0;
  const trendDown = delta !== null && delta < 0;

  return (
    <div className="relative rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-5 hover:bg-white/[0.05] transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <p className="text-[11px] font-bold uppercase tracking-widest text-purple-300/80">{label}</p>
        {Icon && <Icon className="w-4 h-4 text-purple-300/40" />}
      </div>

      {/* Valor principal */}
      <div className="flex items-baseline gap-2">
        <span className="text-4xl font-black tabular-nums text-white tracking-tight">
          {loading ? <span className="inline-block w-20 h-9 bg-white/5 rounded animate-pulse" /> : value}
        </span>
        {delta !== null && !loading && (
          <span className={`inline-flex items-center gap-0.5 text-xs font-bold tabular-nums px-1.5 py-0.5 rounded
            ${trendUp ? 'bg-emerald-500/15 text-emerald-300' : trendDown ? 'bg-red-500/15 text-red-300' : 'bg-white/5 text-white/50'}`}>
            {trendUp ? <ArrowUp className="w-3 h-3" /> : trendDown ? <ArrowDown className="w-3 h-3" /> : <ArrowRight className="w-3 h-3" />}
            {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>

      {/* Hint + delta label */}
      <div className="mt-2 space-y-1">
        {deltaLabel && delta !== null && (
          <p className="text-[11px] text-purple-200/50">{deltaLabel}</p>
        )}
        {hint && <p className="text-[11px] text-purple-200/40 leading-tight">{hint}</p>}
      </div>

      {/* Source — bottom-right, always visible */}
      {source && (
        <p className="absolute bottom-2 right-3 text-[9px] uppercase tracking-wider text-purple-300/30 font-medium">
          {source}
        </p>
      )}
    </div>
  );
}
