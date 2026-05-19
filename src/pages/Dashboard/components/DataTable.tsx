/**
 * DataTable — tabela compacta com hover, barra de % opcional e ordenação opcional.
 *
 * Ordenação:
 *   - Marca colunas com `sortable: true` pra habilitar click no header.
 *   - `defaultSort: { key, dir }` define ordenação inicial (default: nenhuma — usa ordem do array).
 *   - Click no header: asc → desc → unsorted (volta pra ordem original do array).
 *   - Sort numérico se Number(val) é finito; senão string compare case-insensitive.
 *   - `barColumn` sempre usa o max global das rows passadas (não muda com sort).
 */

import { useMemo, useState } from 'react';

interface Column {
  key: string;
  label: string;
  align?: 'left' | 'right';
  /** Render custom — recebe a row inteira */
  render?: (row: Record<string, unknown>) => React.ReactNode;
  /** Largura sugerida (default auto) */
  width?: string;
  /** Habilita ordenação por essa coluna */
  sortable?: boolean;
  /** Sort customizado — útil quando o valor exibido é formatado (ex: "33%").
   *  Receberá a row inteira; retornar número ou string. Se omitido, usa row[key]. */
  sortAccessor?: (row: Record<string, unknown>) => number | string;
}

type SortDir = 'asc' | 'desc';

interface Props {
  title: string;
  columns: Column[];
  rows: Array<Record<string, unknown>>;
  /** Coluna onde mostrar barra de proporção (ex: value column) */
  barColumn?: string;
  source?: string;
  loading?: boolean;
  maxRows?: number;
  /** Ordenação inicial (toggle 3-state: asc → desc → null) */
  defaultSort?: { key: string; dir: SortDir };
}

function compareValues(a: unknown, b: unknown): number {
  // Tentativa numérica primeiro — funciona pra '12%', 'R$ 1.234,56' parcialmente
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  // Fallback string case-insensitive
  return String(a ?? '').localeCompare(String(b ?? ''), 'pt-BR', { sensitivity: 'base' });
}

export function DataTable({ title, columns, rows, barColumn, source, loading, maxRows = 10, defaultSort }: Props) {
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(defaultSort ?? null);

  // Sort 3-state toggle: null → asc → desc → null
  const handleHeaderClick = (col: Column) => {
    if (!col.sortable) return;
    setSort(prev => {
      if (!prev || prev.key !== col.key) return { key: col.key, dir: 'asc' };
      if (prev.dir === 'asc') return { key: col.key, dir: 'desc' };
      return null; // 3º click: limpa sort
    });
  };

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find(c => c.key === sort.key);
    const accessor = col?.sortAccessor ?? ((r: Record<string, unknown>) => r[sort.key] as number | string);
    const mult = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((r1, r2) => compareValues(accessor(r1), accessor(r2)) * mult);
  }, [rows, sort, columns]);

  const displayed = sortedRows.slice(0, maxRows);
  // Bar usa max do dataset inteiro pra normalização ser estável durante sort
  const max = barColumn
    ? Math.max(...rows.map((r) => Number(r[barColumn]) || 0), 1)
    : 1;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-5">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h3 className="text-sm font-bold text-white">{title}</h3>
          <p className="text-[11px] text-[#d4baeb]/50 mt-0.5">
            {loading ? '…' : `${displayed.length} de ${rows.length} ${rows.length === 1 ? 'linha' : 'linhas'}`}
          </p>
        </div>
        {source && <p className="text-[9px] uppercase tracking-wider text-[#c5a3d4]/30">{source}</p>}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <div key={i} className="h-7 bg-white/[0.02] rounded animate-pulse" />)}
        </div>
      ) : (
        <div className="overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10">
                {columns.map((c) => {
                  const isSorted = sort?.key === c.key;
                  const arrow = !c.sortable ? '' : isSorted ? (sort?.dir === 'asc' ? ' ↑' : ' ↓') : ' ⇅';
                  return (
                    <th
                      key={c.key}
                      onClick={() => handleHeaderClick(c)}
                      className={`pb-2 text-[10px] font-bold uppercase tracking-widest
                        ${c.align === 'right' ? 'text-right' : 'text-left'}
                        ${c.sortable ? 'cursor-pointer select-none hover:text-white transition-colors' : ''}
                        ${isSorted ? 'text-[#e87060]' : 'text-[#c5a3d4]/60'}
                      `}
                      style={c.width ? { width: c.width } : undefined}
                      title={c.sortable ? `Ordenar por ${c.label}` : undefined}
                    >
                      {c.label}
                      {c.sortable && (
                        <span className={`ml-0.5 text-[9px] ${isSorted ? 'text-[#e87060]' : 'text-[#c5a3d4]/30'}`}>{arrow}</span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {displayed.map((row, idx) => (
                <tr key={idx} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors">
                  {columns.map((c) => {
                    const val = row[c.key];
                    return (
                      <td key={c.key} className={`py-2 ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                        {c.key === barColumn ? (
                          <div className="flex items-center justify-end gap-2">
                            <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden max-w-[60px]">
                              <div className="h-full bg-[#a578bb]/60 rounded-full" style={{ width: `${((Number(val) || 0) / max) * 100}%` }} />
                            </div>
                            <span className="tabular-nums font-semibold text-white w-12 text-right">
                              {(Number(val) || 0).toLocaleString('pt-BR')}
                            </span>
                          </div>
                        ) : c.render ? (
                          c.render(row)
                        ) : (
                          <span className={c.align === 'right' ? 'tabular-nums text-white' : 'text-[#e5d2ef]'}>
                            {String(val ?? '—')}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
