## Goal
Disparar às 07:29 de 02/09/2026 o e-mail de promoção dos Vídeo5678 para as galerias que têm vídeo, e auditar cada etapa do que os destinatários vão receber e usar.

## Now
.gs publicado por clasp na v67 e verificado byte a byte. ACHADO DE SEGURANCA P1: repo e PUBLICO e o deploymentId esta commitado em 5 arquivos; ?action=bookings devolve 179 clientes (nome, e-mail, WhatsApp, NOME DA BAILARINA) sem credencial nenhuma. Handoff de 02/09 respondido (P1-P4). Campanha 55/55 completa, plist removido, backup do video5678 verificado byte-a-byte. P1 (conector Drive) segue bloqueado apesar do André ter relinkado — reportar e tentar de novo numa sessão nova. INCIDENTE RESOLVIDO NA CAUSA: o PIX que falha no Mercado Pago é incidente do ASAAS (status.asaas.com, 31/08→02/09: troca do certificado de assinatura do QR; MP/Inter/PagSeguro ainda recusando em 02/09 08:40). Não é nosso código. Ação: avisar clientes (cartão no mesmo link, ou Pix por outro banco). O bug do timeout de 8 s (b60d553) é real, mas SEPARADO e não é a causa das reclamações de hoje.

## Next
1. Tirar AG-MRKRQ2JJ de campanha/destinatarios.json (GIF de outra família + e-mail duplicado da Paula).
2. AG-MRKM1BBU: manter só pri.kemelin@gmail.com (dois endereços num To: só).
3. disparar_promo.py: reserva de cota para os e-mails de venda + rechecar a janela dentro do laço + PAUSA maior.
4. agendamentos.gs: cor do subtítulo/alt legível no Outlook + linha de descadastro; redeploy.
5. Testar de verdade a trava de reenvio VIDEO_PROMO.

## Constraints
- "NUNCA escrever em /Volumes/1TBssd nem /Volumes/4TB" (exceto render em <V916_DESTINO>/<ensaio>/)
- "NEVER run git push unless the user asked for a push in this conversation"
- "só receberão quando todos puderem receber" (galerias entram no ar juntas)
- Segredos (ADMIN_SECRET, ASAAS_API_KEY, chave da service account) ficam com o André; nunca pedir o valor.
- Nunca apagar arquivo sem colar exatamente o que se perde e ter aprovação.
- E-mail para cliente sai de andreffotografia, nunca de clawthelinuxbot.

## Decisions
- DECISION (02/09/2026): o registro do pedido (VIDEO_PEDIDO) sai do caminho síncrono do checkout — começa já, espera no máximo 3 s, e segue em segundo plano via waitUntil (@vercel/functions 3.9.5); se falhar 2x, e-mail ao André com a linha pronta — porque a Vercel não tem escrita em R2/KV e o Google serializa o Apps Script (cauda 10–70 s). Risco aceito: pagamento antes da linha gravada → o webhook já manda o 🚨.
- Um envio por galeria, não um lote único — reexecutar continua de onde parou; lote único morreria no limite de 6 min do Apps Script sem saber quem recebeu.
- E-mails de venda saem do ponto idempotente do .gs (confirmBooking), não do webhook — o webhook estourava os 10 s do ASAAS.
- Join pedido↔pagamento pela planilha, não pela API: GET /v3/checkouts/{id} não existe no ASAAS (404).
- GIF do promo escolhido entre os vídeos DA GALERIA (manifesto), não da pasta do ensaio — pastas são compartilhadas por até 4 famílias.

## Facts
- Deploy do .gs: bash scripts/deploy-gs.sh "descricao" (push + versao + repontar deployment). Exige a API do Apps Script LIGADA em script.google.com/home/usersettings (feito 02/09) e clasp login (conta marquesbill@gmail.com).
- ARMADILHA do clasp: o arquivo remoto se chama Code, nao agendamentos. clasp casa por NOME - empurrar agendamentos.gs criaria um 2o arquivo com funcoes duplicadas no mesmo namespace. Por isso o deploy-gs.sh copia para Code.gs num staging. O pull escreve Code.js; o push aceita Code.gs - mesmo arquivo remoto.
- Deployments: AKfycby4...Owzz285eGQ = o de PRODUCAO (id dentro do SHEETS_SCRIPT_URL); AKfycbxC50...nQK = @HEAD, do editor, nao mexer.
- Apps Script web app: AKfycby4RQxi6a4DTR1ml-LlJkK5D4GOCPug5SIB-GmRrCa0uu2U3Dgtrj4vzgm_Owzz285eGQ (Version 66)
- Dispatcher: ~/Desktop/videos5678/campanha/disparar_promo.py · lista: destinatarios.json (56) · log: campanha.log
- Abortar: touch ~/Desktop/videos5678/campanha/ABORTAR
- launchd: ~/Library/LaunchAgents/com.andre.videos5678.campanha.plist (07:29, StartCalendarInterval = DIÁRIO)
- Cota MailApp: 84 às 01:43 E 84 às 07:29 de 02/09 — o reset NÃO é 04:00 BRT; horário real desconhecido. Campanha cortou 1 (AG-YZ3NVN7K Anna Lia Queiroz) pela RESERVA=30.
- Flash fica a 3,53 s do FIM de todo preview
- lint/typecheck do app: npm run lint (tsc --noEmit); não há test runner

## Done
- Campanha 100% completa (55/55) — RESULT: AG-YZ3NVN7K (Anna Lia Queiroz) enviada manualmente 02/09 16:35 via chamada direta a ?action=videoPromo (bypassando só a RESERVA do dispatcher, a trava server-side continua intacta); resposta {"ok":true,"destino":"hosanaqueirozpedagoga@gmail.com","videos":28}.
- Cota MailApp: 84 (07:29, antes da campanha) → ~30 (depois) → 27 (16:32) — RESULT: a cota é COMPARTILHADA com o sistema de agendamento normal (não só video5678); ~3 e-mails de outra atividade a consumiram entre a manhã e a tarde.
- launchd com.andre.videos5678.campanha REMOVIDO (bootout + rm do plist) — RESULT: `launchctl print` confirma "Could not find service"; não roda mais amanhã.
- Backup verificado de video5678 → /Volumes/4TB/video5678-backup-2026-09-02/ (autorizado pelo André, resposta P4 "(b)") — RESULT: rsync --checksum + verificação sha256 arquivo a arquivo: 1759 previews + 4 masters 4K, 0 faltando, 0 extra, 0 hash diferente.
- Conta certa para o clasp identificada — RESULT: aba do Apps Script logada como marquesbill@gmail.com (André Ferreira), via Chrome.
- 6802f82 publicado (push autorizado "dá o push"), Vercel=success 02/09 12:35:41 — RESULT: POST /api/videos-checkout ao vivo em 4,21 s e 3,75 s (antes: 40 s). Linhas VIDEO_PEDIDO de a9a359b7/f9f5c842 a confirmar na aba Log quando o Drive voltar.
- Push de main para origin em 02/09/2026 ~12:25 (autorizado: "dá o push, sem aviso") — RESULT: b175f48..b60d553, 7 commits; para a Vercel só api/videos-checkout.ts e vercel.json mudam. Deploy confirmado: Vercel=success 02/09 12:18:56; prova ao vivo POST /api/videos-checkout → 200 em 40,15 s (retry executou).
- Latência real do POST addLog do Apps Script (baseline limpo, 02/09/2026 ~03:35) — RESULT: mediana 6,77 s, 3 de 6 acima dos 8 s do timeout do checkout, máx 69,72 s (essa falhou). O custo está em abrir a planilha, não no addLog (que é só getSheet + appendRow). Sob concorrência piora muito: com carga minha as esperas foram de 50-73 s.
- Auditoria adversarial wf_914efab2-600 — RESULT: 8 agentes, 0 erros; 3 bloqueadores, 1 deles (VIDEOS_GALERIA_TESTE) refutado por mim: checkout devolve valor 120, não 5.
- Verificação própria do GIF de cada uma das 56 — RESULT: 1 errada (AG-MRKRQ2JJ aponta _MG_9959_(2), que não está no manifesto dela).
- Trava de horário provada — RESULT: rodar --enviar às 01:43 imprimiu "FORA DA JANELA" e não enviou nada.
- Trava de reenvio provada em dado vivo — RESULT: linha VIDEO_PROMO gravada para AG-TESTE-TRAVA aparece em videoPromoStatus.jaEnviados; o predicado da trava é o mesmo. Descoberta: o curl que voltou VAZIO gravou assim mesmo (2 linhas) — o 404 do redirect acontece DEPOIS da execução, então o retry do dispatcher só é seguro por causa da trava.
- Token dos 55 links validado ao vivo — RESULT: 55/55 aceitos (PUT em /api/galeria: 405 = token ok, 403 = ruim) e o id dentro de cada link bate com o do destinatário.
- GIF de cada uma das 55 conferido contra o manifesto da própria galeria — RESULT: 55/55 pertencem à dona.
- Preflight com a lista corrigida — RESULT: 55 prontos, 0 fora, cota 84.
- VIDEOS_GALERIA_TESTE — RESULT: refutado, /api/videos-checkout devolve valor 120 para AG-MSFYY8ET, não 5.

## Open items
- SEGURANCA P1 (medido 02/09 17:35): github.com/marquesbill/ensaio-fotografico-joinville e PUBLICO e contem o deploymentId do Apps Script em docs/STATE.md, scripts/criar-galerias-avulsas.mjs, scripts/enviar-galerias.mjs, scripts/preparar-galerias.py e agora scripts/deploy-gs.sh. ?action=bookings nesse endpoint devolve 179 registros com email, name, whatsapp, nomeBailarina, instagram - SEM credencial. Opcoes: (a) tornar o repo privado (1 clique, mas historico ja clonado permanece), (b) exigir segredo nas acoes sensiveis do doGet e redeployar, (c) criar deployment novo + trocar SHEETS_SCRIPT_URL na Vercel e nos scripts locais. Decisao do Andre.
- Backup 302GB "edição join26" em /Volumes/1TBssd (o verdadeiro acervo grande, distinto dos 1,5GB de video5678) — status de backup DESCONHECIDO; /Volumes/4TB/join26 tem 1,0TB mas não confirmei se é cópia atual disso ou algo diferente. Perguntar ao André antes de tocar (fora do escopo autorizado em P4, que foi só video5678).
- Conector Google Drive continua invalid_grant mesmo após o André relinkar (testado 02/09 16:32). Tentar de novo numa sessão NOVA — pode ser cache do token desta sessão.
- clasp: André vai rodar `clasp login` com marquesbill@gmail.com. Depois disso falta criar .clasp.json (scriptId 1CfNosMdFMB7axBKsWCE4ii7KB_Yt4wn9E2ae5WhPcuy0Tj40DKevmFaB) e resolver o mapeamento pro arquivo único agendamentos.gs.
- Deploy do apps-script/agendamentos.gs: 4 ajustes (alt legível com imagem bloqueada, subtítulo sem rgba que o Outlook descarta, linha de descadastro). clasp não está autenticado; autenticar é consentimento OAuth, que só o André dá.
- Geradores dos GIFs da campanha (gif_promo.py, gerar_promos.py) sumiram do scratchpad — reescrever escolhendo o vídeo pelo MANIFESTO da galeria, nunca pela pasta do ensaio (foi essa a origem do GIF da Liz na peça da Paula).
- launchd com.andre.videos5678.campanha é DIÁRIO (StartCalendarInterval Hour+Minute). Inofensivo (trava + preflight barram), mas remover depois do lote: launchctl bootout gui/501/com.andre.videos5678.campanha
- LIMPEZA pendente (Drive com token expirado): ~28 linhas DIAG_LATENCIA + 2 AG-TESTE-TRAVA + 4 VIDEO_PEDIDO dos checkouts de diagnóstico e475efa9, 6fff4eea, a9a359b7, f9f5c842 (galeria inexistente, não afeta ninguém real).
- Deletar ou manter videos5678/saidas/promo/ (~17 renders, ~6 MB) — perguntado 2x, sem resposta.
- Marca d'água "Paula Garcia" nos vídeos da Liz (AG-7NKQ2WLZ) e da Letícia (AG-X4RB8JDM): 4 galerias apontam para a mesma pasta em dados/galeria_ensaio_pasta.json e marca.py tira o nome do basename. Já está no ar. Corrigir mapa + re-renderizar na semana.
- Galerias levam 4–7 s para abrir (Apps Script lê a planilha inteira); cache proposto, não construído.
- Redirect do Apps Script devolve 404 ~1 em 6 — todo cliente precisa de retry.
- 7 galerias passam do teto de 50 vídeos do checkout (api/videos-checkout.ts): 85, 81, 68, 57, 54, 53, 52.

## Failed attempts
- ATTEMPT 1 [L1]: medir a latência do addLog com 30 requisições em 6 threads -> 30/30 TimeoutError. Confundidor: o Apps Script serializa execuções (LockService + fila do Google), então minha própria carga criou a fila. Medição inválida.
- ATTEMPT 2 [L1]: 12 compras simuladas com a lógica nova, sem descanso -> 7/12 falharam, esperas de 50-73 s. Ainda contaminado pela carga anterior.
- ATTEMPT 3 [L2]: 60 s de descanso + 6 amostras espaçadas 30 s -> baseline limpo: mediana 6,77 s, 3/6 acima de 8 s, uma de 69,72 s que falhou. A latência é alta DE VERDADE, não era só minha carga.
