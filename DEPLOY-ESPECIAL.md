# Deploy + Teste E2E — Pacote Especial

Feature na branch `feat/pacote-especial` (5 commits, em cima do roadmap). Dois deploys
independentes: **Apps Script** (você, manual) e **Vercel** (push do git). Faça na ordem
abaixo — o Apps Script primeiro, senão o backend rejeita o Especial.

---

## Passo 1 — Deploy do Apps Script (`agendamentos.gs`)

1. Abra o **editor do Apps Script** do projeto da planilha.
2. Cole o `apps-script/agendamentos.gs` atualizado (arquivo inteiro) por cima do que está lá.
   - Se preferir aplicar só o que mudou, são estas funções: **`createPending`**,
     **`computeAvailableSlots`**, **`getBookingsForDate`**, **`processReminders`**,
     **`doGet`** (nova ação `especialById`), **`getEspecialPublic`** (nova) e o header do
     **`initSheets`**.
3. **Salvar** → **Implantar → Gerenciar implantações → (edita a ativa) → Nova versão → Implantar.**
4. Pronto. As colunas novas ("Valores Pagadores", "Links Pagadores") se auto-criam na
   primeira criação de Especial — **não precisa rodar `initSheets`** nem mexer na planilha.

> ✅ **Seguro:** o caminho dos 3 pacotes fixos não mudou. O Especial é um branch aditivo.
> Deployar isto **não quebra** agendamentos existentes.

---

## Passo 2 — Deploy Vercel (frontend + API)

A branch `feat/pacote-especial` está **em cima do roadmap** — então subir ela leva o
roadmap **junto**. Duas opções:

- **Subir tudo (recomendado se o roadmap já vai também):**
  `git checkout main && git merge feat/pacote-especial && git push`
- **Só quando você decidir** — nada sobe sem esse push. Aguarde ~90s pós-push (deploy Vercel).

**Env vars** (já devem existir — confirme em Vercel → Settings → Environment Variables):
`ADMIN_SECRET` (assina o token da página pública), `SHEETS_SCRIPT_URL`, `SITE_URL`,
`ASAAS_API_KEY` / MP token (os que os 3 pacotes já usam).

---

## Passo 3 — Teste E2E (sem gastar de verdade, quase tudo)

### 3.1 Criar um Especial de teste
1. `/admin` → login → botão **"Especial"**.
2. Preencha: seu nome/e-mail, **2 pagadores** com valores **pequenos mas reais** (ex:
   **R$5 + R$5** — evita mínimo do gateway), duração curta (ex: 1h), uma data/hora livres.
3. **Criar Especial + gerar 2 links** → deve abrir o modal com:
   - os **2 links de pagamento** (um por pagador), e
   - a seção **"Página do grupo"** com o link público (copie).

### 3.2 Conferir a planilha
- Uma linha nova: `Pacote = especial`, `Duração (min)` e `Valor (R$)` = soma (R$10),
  `Nomes/Valores/Links Pagadores` preenchidos, `Status = Pendente`.

### 3.3 Conferir a página pública (sem pagar)
- Abra o **link do grupo** → deve mostrar os 2 pagadores, botões **Pagar**, e
  **"0 de 2 pagaram"** + total R$10.
- **Segurança do token:** troque 1 caractere do `?t=...` na URL → deve dar **"Link inválido"** (403).

### 3.4 Conferir o bloqueio de agenda
- Tente criar um agendamento **normal** que **sobreponha** o horário do Especial → o slot
  deve aparecer **bloqueado** (não listado).

### 3.5 (Opcional) Pagamento real de 1 parcela via PIX
- Pague **1** dos links de R$5 (PIX é o mais rápido/barato).
- Em ~segundos o webhook confirma → a **página pública** mostra esse pagador **✅ Pago** e
  **"1 de 2 pagaram"**; a linha na planilha vira **"Pago Parcial"**.
- Pague o segundo → status **"Confirmado"**; a agenda continua bloqueada.

### 3.6 Conferir que NÃO auto-expira
- Deixe um Especial pendente. Diferente dos 3 pacotes, ele **não** deve virar "Expirado"
  sozinho nem disparar e-mail de lembrete (é gerenciado por você/Mari).

### 3.7 Limpeza
- Cancele o(s) Especial(is) de teste no admin.
- Se pagou os R$10 de teste, estorne pelo painel do ASAAS/MP se quiser.

---

## Rollback (se algo der errado)

- **Vercel:** Vercel → Deployments → o deploy anterior → **Promote to Production** (ou
  `git revert` do merge + push).
- **Apps Script:** Gerenciar implantações → versão anterior. As mudanças são
  retrocompatíveis, então reverter não afeta os 3 pacotes.

---

## Checklist rápido
- [ ] `agendamentos.gs` deployado (Nova versão no Apps Script)
- [ ] Vercel deployado (push/merge)
- [ ] `ADMIN_SECRET` / `SHEETS_SCRIPT_URL` / `SITE_URL` presentes
- [ ] Especial de teste criado → 2 links + link do grupo
- [ ] Planilha com a linha `especial` correta
- [ ] Página pública abre com token certo / **bloqueia** token errado
- [ ] Slot do Especial bloqueia a agenda
- [ ] (opcional) 1 PIX pago → página mostra ✅ e "1 de 2"
- [ ] Especial de teste cancelado/limpo
