/**
 * DataSourceBadge — informa fonte do dado, última atualização e próxima.
 * Sempre visível em cada página, no header.
 */

import { Database, RefreshCw, Clock } from 'lucide-react';

interface Props {
  /** Última vez que os dados foram puxados */
  lastFetched?: Date | string | null;
  /** Próxima atualização agendada (ex: Date.now() + 12*3600*1000) */
  nextRefresh?: Date | string | null;
  /** Fontes de dados ativas (badges) */
  sources: Array<{
    label: string;       // ex: "GA4"
    detail?: string;     // ex: "Ensaios Joinville 2026 · 494185724"
    status?: 'live' | 'stale' | 'error';
  }>;
  /** Callback de refresh manual (opcional) */
  onRefresh?: () => void;
  refreshing?: boolean;
}

function formatRelative(d: Date | string | null | undefined): string {
  if (!d) return 'nunca';
  const date = typeof d === 'string' ? new Date(d) : d;
  const diff = Date.now() - date.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const days = Math.floor(h / 24);
  return `há ${days}d`;
}

function formatUntil(d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  const diff = date.getTime() - Date.now();
  if (diff < 0) return 'pendente';
  const min = Math.floor(diff / 60000);
  if (min < 60) return `em ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `em ${h}h`;
  return `em ${Math.floor(h / 24)}d`;
}

export function DataSourceBadge({ lastFetched, nextRefresh, sources, onRefresh, refreshing }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[10px]">
      {/* Fontes */}
      {sources.map((s, i) => {
        const dotColor = s.status === 'error' ? 'bg-red-400' : s.status === 'stale' ? 'bg-amber-400' : 'bg-emerald-400';
        return (
          <div key={i} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.04] border border-white/[0.08]">
            <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
            <Database className="w-3 h-3 text-[#c5a3d4]/50" />
            <span className="text-[#e5d2ef] font-semibold tracking-wide">{s.label}</span>
            {s.detail && <span className="text-[#c5a3d4]/40 font-mono">{s.detail}</span>}
          </div>
        );
      })}

      {/* Última atualização */}
      <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.04] border border-white/[0.08] text-[#d4baeb]/60">
        <Clock className="w-3 h-3" />
        <span>Atualizado <span className="text-white/80 font-semibold">{formatRelative(lastFetched)}</span></span>
        {nextRefresh && <span className="text-[#c5a3d4]/40">· próximo {formatUntil(nextRefresh)}</span>}
      </div>

      {/* Refresh manual */}
      {onRefresh && (
        <button
          onClick={onRefresh} disabled={refreshing}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#7a3f8f]/10 hover:bg-[#7a3f8f]/20 border border-[#a578bb]/20 text-[#d4baeb] transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
          <span>Atualizar</span>
        </button>
      )}
    </div>
  );
}
