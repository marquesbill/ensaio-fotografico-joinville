#!/usr/bin/env node
/**
 * Envia o e-mail de entrega da galeria (link + agradecimento) para reservas confirmadas.
 * Idempotente no servidor: quem já recebeu não é reenviado, mesmo rodando de novo.
 *
 *   ADMIN_SECRET='...' node scripts/enviar-galerias.mjs --teste seu@email.com AG-XXXX  # 1 envio de teste pro seu email, NÃO marca como enviado
 *   ADMIN_SECRET='...' node scripts/enviar-galerias.mjs AG-XXXX AG-YYYY                 # envia de verdade só pra esses IDs
 *   ADMIN_SECRET='...' node scripts/enviar-galerias.mjs --todos                        # busca a aba Galerias agora e envia pra quem tem foto e ainda não recebeu
 *
 * --todos nunca hardcoda uma contagem — busca a lista de verdade na hora, porque o número
 * de galerias prontas muda a cada sessão de trabalho.
 *
 * ADMIN_SECRET (o MESMO da Vercel / Script Property) é obrigatório: o Web App do Apps Script
 * é uma URL pública sem login, e sem esse segredo qualquer um que a descobrisse conseguiria
 * mandar o link (com token) da galeria de um cliente pro próprio e-mail. Vem do AMBIENTE,
 * nunca por argumento — argv aparece no `ps` para qualquer processo da máquina.
 */
const GS = ('https://script.google.com/macros/s/AKfycby4RQxi6a4DTR1ml-LlJkK5D4GOCPug5'
  + 'SIB-GmRrCa0uu2U3Dgtrj4vzgm_Owzz285eGQ/exec');

const secret = process.env.ADMIN_SECRET;
if (!secret) {
  console.error('ADMIN_SECRET não definido. Use o MESMO valor que está na Vercel / Script Property.');
  process.exit(1);
}

async function gs(action, body) {
  const r = await fetch(GS, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, secret, ...body }),
  });
  const txt = await r.text();
  try { return JSON.parse(txt); }
  catch { throw new Error('Resposta não é JSON: ' + txt.slice(0, 200)); }
}

const args = process.argv.slice(2);
const testeIdx = args.indexOf('--teste');
let testTo;
if (testeIdx !== -1) {
  testTo = args[testeIdx + 1];
  if (!testTo || testTo.startsWith('--')) { console.error('--teste precisa de um e-mail depois.'); process.exit(1); }
  args.splice(testeIdx, 2);
}
const todosIdx = args.indexOf('--todos');
const todos = todosIdx !== -1;
if (todos) args.splice(todosIdx, 1);

let ids = args;
if (todos) {
  const { rows } = await gs('listGalerias', {});
  ids = rows.map((r) => r.id);
  console.log(`--todos: ${ids.length} galerias com fotos na aba Galerias agora.`);
}
if (!ids.length) {
  console.error('uso: ADMIN_SECRET=... node scripts/enviar-galerias.mjs [--teste seu@email] <AG-ID...> | --todos');
  process.exit(1);
}

console.log(`Enviando para ${ids.length} reserva(s)`
  + (testTo ? ` — MODO TESTE: tudo vai pra ${testTo}, nada fica marcado como enviado.` : ' — ENVIO REAL.') + '\n');

const resp = await gs('sendGaleriaEmails', { ids, testTo });
if (!resp.ok) {
  console.error('Erro:', resp.error || JSON.stringify(resp));
  process.exit(1);
}
console.log(`${resp.enviados}/${resp.total} enviados. Cota de e-mail restante antes do envio: ${resp.cotaRestanteAntes}.\n`);
for (const r of resp.resultados) {
  console.log(r.ok ? `✓ ${r.id} → ${r.destino}${r.teste ? ' (teste)' : ''}` : `✗ ${r.id} — ${r.motivo}`);
}
