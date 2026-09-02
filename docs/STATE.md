## Goal
Disparar às 07:29 de 02/09/2026 o e-mail de promoção dos Vídeo5678 para as galerias que têm vídeo, e auditar cada etapa do que os destinatários vão receber e usar.

## Now
INCIDENTE: clientes recebem erro ao pagar. Medido que ~metade das chamadas de registro do pedido estoura o timeout de 8 s. Correção pronta e commitada, NÃO publicada (falta o André pedir o push).

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
- Um envio por galeria, não um lote único — reexecutar continua de onde parou; lote único morreria no limite de 6 min do Apps Script sem saber quem recebeu.
- E-mails de venda saem do ponto idempotente do .gs (confirmBooking), não do webhook — o webhook estourava os 10 s do ASAAS.
- Join pedido↔pagamento pela planilha, não pela API: GET /v3/checkouts/{id} não existe no ASAAS (404).
- GIF do promo escolhido entre os vídeos DA GALERIA (manifesto), não da pasta do ensaio — pastas são compartilhadas por até 4 famílias.

## Facts
- Apps Script web app: AKfycby4RQxi6a4DTR1ml-LlJkK5D4GOCPug5SIB-GmRrCa0uu2U3Dgtrj4vzgm_Owzz285eGQ (Version 66)
- Dispatcher: ~/Desktop/videos5678/campanha/disparar_promo.py · lista: destinatarios.json (56) · log: campanha.log
- Abortar: touch ~/Desktop/videos5678/campanha/ABORTAR
- launchd: ~/Library/LaunchAgents/com.andre.videos5678.campanha.plist (07:29, StartCalendarInterval = DIÁRIO)
- Cota MailApp medida 01:43 de 02/09: 84 restantes; reset da Google à meia-noite do Pacífico = 04:00 BRT
- Flash fica a 3,53 s do FIM de todo preview
- lint/typecheck do app: npm run lint (tsc --noEmit); não há test runner

## Done
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
- Deploy do apps-script/agendamentos.gs: 4 ajustes (alt legível com imagem bloqueada, subtítulo sem rgba que o Outlook descarta, linha de descadastro). clasp não está autenticado; autenticar é consentimento OAuth, que só o André dá.
- Geradores dos GIFs da campanha (gif_promo.py, gerar_promos.py) sumiram do scratchpad — reescrever escolhendo o vídeo pelo MANIFESTO da galeria, nunca pela pasta do ensaio (foi essa a origem do GIF da Liz na peça da Paula).
- launchd com.andre.videos5678.campanha é DIÁRIO (StartCalendarInterval Hour+Minute). Inofensivo (trava + preflight barram), mas remover depois do lote: launchctl bootout gui/501/com.andre.videos5678.campanha
- 2 linhas de teste AG-TESTE-TRAVA na aba Log (galeria inexistente, não afeta ninguém real).
- Deletar ou manter videos5678/saidas/promo/ (~17 renders, ~6 MB) — perguntado 2x, sem resposta.
- Marca d'água "Paula Garcia" nos vídeos da Liz (AG-7NKQ2WLZ) e da Letícia (AG-X4RB8JDM): 4 galerias apontam para a mesma pasta em dados/galeria_ensaio_pasta.json e marca.py tira o nome do basename. Já está no ar. Corrigir mapa + re-renderizar na semana.
- Galerias levam 4–7 s para abrir (Apps Script lê a planilha inteira); cache proposto, não construído.
- Redirect do Apps Script devolve 404 ~1 em 6 — todo cliente precisa de retry.
- 7 galerias passam do teto de 50 vídeos do checkout (api/videos-checkout.ts): 85, 81, 68, 57, 54, 53, 52.

## Failed attempts
- ATTEMPT 1 [L1]: medir a latência do addLog com 30 requisições em 6 threads -> 30/30 TimeoutError. Confundidor: o Apps Script serializa execuções (LockService + fila do Google), então minha própria carga criou a fila. Medição inválida.
- ATTEMPT 2 [L1]: 12 compras simuladas com a lógica nova, sem descanso -> 7/12 falharam, esperas de 50-73 s. Ainda contaminado pela carga anterior.
- ATTEMPT 3 [L2]: 60 s de descanso + 6 amostras espaçadas 30 s -> baseline limpo: mediana 6,77 s, 3/6 acima de 8 s, uma de 69,72 s que falhou. A latência é alta DE VERDADE, não era só minha carga.
