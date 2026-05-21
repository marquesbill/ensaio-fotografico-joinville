/**
 * DeltaBadge — pílula compacta com seta + cor semântica + percentual.
 *
 * Usado em cards customizados (banners, blocos especiais) que não são KpiCard.
 * O KpiCard já tem essa lógica embutida; aqui é a versão standalone.
 *
 * Cores:
 *   delta > +threshold  → verde   (bom) | vermelho (se inverted)
 *   delta < -threshold  → vermelho (ruim) | verde (se inverted)
 *   |delta| ≤ threshold → dourado (zona neutra — ruído estatístico)
 *   delta = null/NaN    → não renderiza nada
 *
 * Threshold default 1% (variações menores são ruído pra a maioria das métricas).
 *
 * `inverted`: pra métricas onde subir é RUIM (CPL, CPC, CPM, CPA, bounce, custo).
 */

import { ArrowUp, ArrowDown, ArrowRight } from 'lucide-react';

interface Props {
  /** Variação percentual (ex: 23.5 = +23.5%). null/NaN/undefined = não renderiza */
  value: number | null | undefined;
  /** Quando true, valores positivos viram vermelhos (descer = bom) */
  inverted?: boolean;
  /** Variação mínima pra colorir verde/vermelho. Default 1%. */
  threshold?: number;
  /** Variantes de tamanho — default "md" */
  size?: 'sm' | 'md';
  /** Tooltip opcional explicando o período de comparação */
  title?: string;
}

export function DeltaBadge({ value, inverted = false, threshold = 1, size = 'md', title }: Props) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;

  const abs = Math.abs(value);
  const isNeutral = abs <= threshold;
  const isPositive = value > 0;
  const isGood = !isNeutral && (inverted ? !isPositive : isPositive);
  const isBad  = !isNeutral && (inverted ? isPositive  : !isPositive);

  // Estilos por estado
  const colorClasses = isNeutral
    ? 'bg-amber-400/15 text-amber-300'
    : isGood
      ? 'bg-emerald-500/15 text-emerald-300'
      : isBad
        ? 'bg-red-500/15 text-red-300'
        : 'bg-white/5 text-white/50';

  const sizeClasses = size === 'sm'
    ? 'text-[10px] px-1 py-0 gap-0.5'
    : 'text-xs px-1.5 py-0.5 gap-0.5';

  const iconSize = size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3';

  const Arrow = isNeutral
    ? ArrowRight
    : isPositive
      ? ArrowUp
      : ArrowDown;

  return (
    <span
      className={`inline-flex items-center font-bold tabular-nums rounded ${colorClasses} ${sizeClasses}`}
      title={title}
    >
      <Arrow className={iconSize} />
      {abs.toFixed(abs >= 10 ? 0 : 1)}%
    </span>
  );
}
