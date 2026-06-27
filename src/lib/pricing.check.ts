/**
 * Self-check do caminho de dinheiro. NÃO é importado pelo app (fora do bundle).
 * Rodar:  ./node_modules/.bin/tsx src/lib/pricing.check.ts
 * Garante que os valores por lote batem com o que estava duplicado em App+Agendamento
 * antes do dedup — se alguém mexer num número errado, isto quebra.
 */
import assert from 'node:assert';
import { LOTE1_START_MS, LOTE2_START_MS, currentTierPrices, nextPriceSwitchMs, FULL_PRICES } from './pricing';

// Lote 0 (antes de 16/05): 1400 / 1900 / 2200
assert.deepStrictEqual(currentTierPrices(LOTE1_START_MS - 1), { lembranca: 1400, economico: 1900, completo: 2200 });
// Lote 1 (16/05–31/05): 1600 / 2100 / 2600
assert.deepStrictEqual(currentTierPrices(LOTE1_START_MS), { lembranca: 1600, economico: 2100, completo: 2600 });
// Lote 2 (01/06 em diante): 1800 / 2400 / 2800
assert.deepStrictEqual(currentTierPrices(LOTE2_START_MS), { lembranca: 1800, economico: 2400, completo: 2800 });
// Preço cheio = lote 2
assert.deepStrictEqual(FULL_PRICES, { lembranca: 1800, economico: 2400, completo: 2800 });

// Próxima troca de lote
assert.strictEqual(nextPriceSwitchMs(LOTE1_START_MS - 1), LOTE1_START_MS);
assert.strictEqual(nextPriceSwitchMs(LOTE1_START_MS), LOTE2_START_MS);
assert.strictEqual(nextPriceSwitchMs(LOTE2_START_MS), null);

console.log('✓ pricing self-check OK — lotes 0/1/2, full e nextPriceSwitch conferem');
