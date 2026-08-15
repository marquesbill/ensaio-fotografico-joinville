#!/usr/bin/env node
/**
 * Imprime a URL da galeria de uma ou mais reservas.
 *
 *   ADMIN_SECRET='...' node scripts/link-galeria.mjs AG-MRPA5ISK
 *   ADMIN_SECRET='...' node scripts/link-galeria.mjs AG-MRPA5ISK AG-MQTN2R0O ...
 *
 * O token é o MESMO que api/galeria.ts confere:
 *   HMAC-SHA256('galeria:' + id, ADMIN_SECRET) em hex, 24 primeiros caracteres.
 * Mudou o ADMIN_SECRET na Vercel? Todos os links já enviados param de valer.
 *
 * O segredo vem do AMBIENTE, nunca por argumento: argv aparece no `ps` para
 * qualquer processo da máquina.
 */
import { createHmac } from 'node:crypto';

const ids    = process.argv.slice(2);
const secret = process.env.ADMIN_SECRET;
const base   = (process.env.SITE_URL || 'https://www.ensaiofotograficoemjoinville.com')
  .replace(/\/+$/, '');

if (!ids.length) {
  console.error('uso: ADMIN_SECRET=... node scripts/link-galeria.mjs <AG-ID> [AG-ID...]');
  process.exit(1);
}
if (!secret) {
  console.error('ADMIN_SECRET não definido. Use o MESMO valor que está na Vercel —');
  console.error('com outro segredo o link é gerado, mas a página responde 403.');
  process.exit(1);
}

for (const id of ids) {
  const t = createHmac('sha256', secret).update('galeria:' + id).digest('hex').slice(0, 24);
  console.log(`${id}\t${base}/galeria/${id}?t=${t}`);
}
