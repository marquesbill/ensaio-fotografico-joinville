/**
 * DataTable — tabela compacta com hover, ordenação visual e barra de % opcional.
 */

interface Column {
  key: string;
  label: string;
  align?: 'left' | 'right';
  /** Render custom — recebe a row inteira */
  render?: (row: Record<string, unknown>) => React.ReactNode;
  /** Largura sugerida (default auto) */
  width?: string;
}

interface Props {
  title: string;
  columns: Column[];
  rows: Array<Record<string, unknown>>;
  /** Coluna onde mostrar barra de proporção (ex: value column) */
  barColumn?: string;
  source?: string;
  loading?: boolean;
  maxRows?: number;
}

export function DataTable({ title, columns, rows, barColumn, source, loading, maxRows = 10 }: Props) {
  const displayed = rows.slice(0, maxRows);
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
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className={`pb-2 text-[10px] font-bold uppercase tracking-widest text-[#c5a3d4]/60 ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                    style={c.width ? { width: c.width } : undefined}
                  >
                    {c.label}
                  </th>
                ))}
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
