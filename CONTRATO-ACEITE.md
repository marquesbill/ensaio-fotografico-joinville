# Aceite de Contrato no Fluxo de Agendamento (Opção A)

**No ar desde 2026-07-17** (commits `2a1aa09` + `a3c3357`; Apps Script **Version 42**).
O cliente lê e aceita o contrato **antes** de chegar ao pagamento — o link de
pagamento só é revelado depois do aceite registrado.

---

## O fluxo (booking normal, 1 pagador)

1. Mari cria o agendamento no painel `/admin`, como sempre.
2. O sistema gera o link ASAAS (igual antes) **e** o **link de aceite**
   `https://…/contrato/<bookingId>?t=<token>`.
3. **O cliente recebe automaticamente por e-mail** ("Reserva recebida", casca
   Georgia/roxo) o resumo da reserva + botão **"Ler contrato e concluir o
   pagamento"** → página de aceite. BCC André+Mari. O modal do painel também
   mostra o link, para reenvio por WhatsApp.
4. Na página `/contrato/:id`: resumo da reserva + texto integral do contrato +
   campo de **CPF** (validado por dígito verificador) + checkbox "Li e concordo".
5. Ao aceitar: gravamos na linha do booking **data/hora + versão do contrato,
   CPF, IP + user-agent** (colunas `Aceite Contrato` / `Aceite CPF` / `Aceite IP`)
   e um evento `CONTRATO_ACEITO` no Log. Só então aparece **"Ir para pagamento"**
   com o link ASAAS.

Aceite = assinatura eletrônica simples (art. 107 CC + MP 2.200-2/2001).
A **versão** do texto aceito fica no registro (`… | v2026-07-17`).

## O que fica FORA deste fluxo (de propósito)

- **Especial** — tem os próprios e-mails e página do grupo; sem aceite digital.
- **Split >1 não-especial** — a página de aceite só revela o 1º link; segue manual.
- **Termo de imagem do menor** — papel, assinado no dia (decisão jurídica).
- **Bookings retroativos** — "de acordo" por WhatsApp com PDF anexo.

## Peças (onde mexer)

| Peça | Arquivo | Nota |
|---|---|---|
| Página pública | `src/pages/Contrato.tsx` | Texto do contrato vive AQUI (const `CONTRATO`) + rota em `src/main.tsx`. Demo sem backend: `/contrato/demo?t=x` |
| Endpoint | `api/contrato.ts` | GET resumo/POST aceite; token HMAC `contrato:<id>` (`ADMIN_SECRET`); valida CPF; `CONTRACT_VERSION` |
| Token + e-mail + resposta | `api/admin-bookings.ts` | `contratoToken()` (duplicado em `api/contrato.ts` — manter em sincronia; NUNCA importar de `_*.ts`), `buildContratoEmailHtml()`, envio no `handleCreate`, `contratoUrl` na resposta |
| Modal da Mari | `src/pages/Admin.tsx` | `PaymentLinkModal` — bloco "Link de aceite" só p/ single-pagador não-especial |
| Planilha | `apps-script/agendamentos.gs` | `getContratoById` + `recordContractAcceptance` (idempotente: não sobrescreve aceite existente) + ações no `doGet`/`doPost`. Colunas `Aceite *` auto-criam no 1º aceite (`_ensureColumn`) — não precisa `initSheets` |

## Para atualizar o TEXTO do contrato (pós-advogado)

1. Edite a const `CONTRATO` em `src/pages/Contrato.tsx`.
2. Suba a `CONTRACT_VERSION` em `api/contrato.ts` (ex.: `2026-07-25`).
3. Push (Vercel). O `.gs` **não** precisa de novo deploy — a versão só transita.
   Aceites antigos continuam válidos com a versão que registraram.

## Deploy do `.gs` (quando mexer nele)

Editor Apps Script → colar/ajustar → **verificar `getValue()` do Monaco antes de
salvar** (lição do V40: paste às vezes não pega) → Deploy → Gerenciar implantações
→ editar a ativa → **New version** → Deploy. O Deployment ID (`…Owzz285eGQ`)
não muda — a URL usada pela Vercel permanece.

## Pendências conhecidas

- Texto v2026-07-17 pendente de revisão do advogado (top 3: genitor único vs.
  duplo no termo de imagem; percentuais 4.4/3.2; log do aceite — CPF já coberto).
- Reenvio do e-mail de aceite não tem botão próprio (a Mari copia o link do modal).
