#!/usr/bin/env node
/**
 * Cria (idempotente) as linhas de entrega de galerias derivadas de uma reserva dividida —
 * caso Viviane AG-MQ4241PC → 4 famílias. Lê o payload de scripts/viviane-split-payload.json.
 *
 *   ADMIN_SECRET='...' node scripts/criar-galerias-avulsas.mjs
 *
 * Depois de criar, rode o envio normal:
 *   ADMIN_SECRET='...' node scripts/enviar-galerias.mjs <os 4 IDs>
 */
import { readFileSync } from 'node:fs';

const GS = ('https://script.google.com/macros/s/AKfycby4RQxi6a4DTR1ml-LlJkK5D4GOCPug5'
  + 'SIB-GmRrCa0uu2U3Dgtrj4vzgm_Owzz285eGQ/exec');

const secret = process.env.ADMIN_SECRET;
if (!secret) { console.error('ADMIN_SECRET não definido.'); process.exit(1); }

const payload = JSON.parse(readFileSync(new URL('./viviane-split-payload.json', import.meta.url), 'utf8'));

const r = await fetch(GS, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'criarGaleriasAvulsas', secret, ...payload }),
});
const txt = await r.text();
let resp;
try { resp = JSON.parse(txt); } catch { console.error('Resposta não é JSON:', txt.slice(0, 200)); process.exit(1); }
if (resp.error) { console.error('Erro:', resp.error); process.exit(1); }
console.log('Criadas:', resp.criados.join(', ') || '(nenhuma nova)');
console.log('Atualizadas:', resp.atualizados.join(', ') || '(nenhuma)');
