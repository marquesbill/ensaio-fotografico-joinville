/**
 * Preços por lote — FONTE ÚNICA.
 * Importado por src/App.tsx (home) e src/pages/Agendamento.tsx (checkout).
 * Antes os valores/datas estavam duplicados nos dois arquivos (risco de divergir
 * preço entre a vitrine e o checkout). Aqui é o único lugar pra editar.
 */
import { useState, useEffect } from 'react';

// Troca automática de preço entre lotes.
export const LOTE1_START_MS = new Date('2026-05-16T00:00:00-03:00').getTime();
export const LOTE2_START_MS = new Date('2026-06-01T00:00:00-03:00').getTime();

export type PkgKey = 'lembranca' | 'economico' | 'completo';

/** Preço de VENDA atual (cai no lote certo pela data). `now` é injetável p/ teste. */
export function currentTierPrices(now: number = Date.now()): Record<PkgKey, number> {
  if (now >= LOTE2_START_MS) return { lembranca: 1800, economico: 2400, completo: 2800 };
  if (now >= LOTE1_START_MS) return { lembranca: 1600, economico: 2100, completo: 2600 };
  return { lembranca: 1400, economico: 1900, completo: 2200 };
}

/** Preço CHEIO (lote final) — referência do "de R$X" riscado na home. */
export const FULL_PRICES: Record<PkgKey, number> = { lembranca: 1800, economico: 2400, completo: 2800 };

/** Próxima troca de lote (ms epoch) ou null se já no último. `now` injetável p/ teste. */
export function nextPriceSwitchMs(now: number = Date.now()): number | null {
  if (now < LOTE1_START_MS) return LOTE1_START_MS;
  if (now < LOTE2_START_MS) return LOTE2_START_MS;
  return null;
}

/** Hook: re-render quando o relógio cruza a próxima troca de lote (cliente na página). */
export function usePriceTierTick(): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const next = nextPriceSwitchMs();
    if (next == null) return;
    const ms = next - Date.now();
    if (ms > 0 && ms < 90 * 24 * 60 * 60 * 1000) {
      const t = setTimeout(() => setTick(n => n + 1), ms + 500);
      return () => clearTimeout(t);
    }
  }, []);
}
