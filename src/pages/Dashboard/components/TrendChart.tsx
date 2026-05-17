/**
 * TrendChart — area chart de série temporal com toolip rica e fonte visível.
 *
 * Recebe array { date: 'YYYY-MM-DD', value: number } e renderiza linha + área
 * com gradient. Eixo X formatado em "dd/mm" para clareza pt-BR.
 */

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface Point {
  date: string; // 'YYYY-MM-DD'
  value: number;
  /** Valor opcional do período anterior para overlay comparativo */
  prevValue?: number;
}

interface Props {
  data: Point[];
  /** Título do chart */
  title: string;
  /** Nome da métrica (legend + tooltip) */
  metricLabel: string;
  /** Cor base (tailwind purple/orange/emerald) */
  color?: 'purple' | 'orange' | 'emerald';
  /** Fonte do dado (mostrado discretamente) */
  source?: string;
  loading?: boolean;
}

const COLORS = {
  purple:  { stroke: '#c5a3d4', fill: '#7a3f8f' },
  orange:  { stroke: '#fb923c', fill: '#f97316' },
  emerald: { stroke: '#6ee7b7', fill: '#10b981' },
};

function formatDate(d: string) {
  const [, m, day] = d.split('-');
  return `${day}/${m}`;
}
function formatNumber(n: number) {
  return n.toLocaleString('pt-BR');
}

export function TrendChart({ data, title, metricLabel, color = 'purple', source, loading }: Props) {
  const c = COLORS[color];

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-5">
      {/* Header */}
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h3 className="text-sm font-bold text-white">{title}</h3>
          <p className="text-[11px] text-[#d4baeb]/50 mt-0.5">{metricLabel} · {data.length} pontos diários</p>
        </div>
        {source && <p className="text-[9px] uppercase tracking-wider text-[#c5a3d4]/30">{source}</p>}
      </div>

      {/* Chart */}
      <div className="h-56 -ml-2">
        {loading ? (
          <div className="h-full w-full bg-white/[0.02] rounded animate-pulse" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 5, right: 12, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`grad-${color}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"  stopColor={c.fill} stopOpacity={0.45} />
                  <stop offset="100%" stopColor={c.fill} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#ffffff10" vertical={false} />
              <XAxis
                dataKey="date" tickFormatter={formatDate}
                stroke="#ffffff30" fontSize={10} tickLine={false} axisLine={false}
              />
              <YAxis
                stroke="#ffffff30" fontSize={10} tickLine={false} axisLine={false}
                tickFormatter={formatNumber} width={45}
              />
              <Tooltip
                cursor={{ stroke: '#ffffff20', strokeWidth: 1 }}
                contentStyle={{
                  background: 'rgba(15,10,31,0.95)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelStyle={{ color: '#c5a3d4', fontWeight: 700 }}
                itemStyle={{ color: '#fff' }}
                labelFormatter={(d) => formatDate(d as string)}
                formatter={(v: number) => [formatNumber(v), metricLabel]}
              />
              {data[0]?.prevValue !== undefined && (
                <Area
                  type="monotone" dataKey="prevValue" stroke="#ffffff20" strokeDasharray="3 3"
                  fill="transparent" name={`${metricLabel} (anterior)`}
                />
              )}
              <Area
                type="monotone" dataKey="value" stroke={c.stroke} strokeWidth={2}
                fill={`url(#grad-${color})`} name={metricLabel}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
