# Setup GA4 Service Account para o Dashboard

Setup único pra dar acesso ao Dashboard às métricas do GA4 via API.
Estimativa: 5 minutos.

## 1. Criar Service Account no GCP

1. Abrir [console.cloud.google.com/iam-admin/serviceaccounts](https://console.cloud.google.com/iam-admin/serviceaccounts?project=marketing-joinville-2026)
2. Garantir que o projeto selecionado é **`marketing-joinville-2026`** (não o `dashboard-joinville-2026` financeiro)
3. Botão **CREATE SERVICE ACCOUNT**
4. Preencher:
   - **Service account name:** `dashboard-ga4-reader`
   - **Description:** Read-only access to GA4 property for marketing dashboard
5. Clicar **CREATE AND CONTINUE**
6. **Grant access:** pular (não precisa de IAM role no projeto GCP — só na property GA4)
7. Clicar **DONE**

## 2. Baixar a chave JSON

1. Na lista de service accounts, clicar em `dashboard-ga4-reader@...`
2. Aba **KEYS** → **ADD KEY** → **Create new key** → tipo **JSON**
3. Salva um arquivo `marketing-joinville-2026-xxxxx.json` no computador
4. Abrir o arquivo num editor de texto e copiar o conteúdo inteiro (vai virar env var)

## 3. Dar acesso ao Service Account na property GA4

1. Pegar o email do service account (formato `dashboard-ga4-reader@marketing-joinville-2026.iam.gserviceaccount.com`)
2. Abrir [analytics.google.com/analytics/web/](https://analytics.google.com/analytics/web/) → property **Ensaios Joinville 2026**
3. Admin (engrenagem) → **Property** → **Gerenciamento de acesso à propriedade**
4. Botão **+** (canto superior direito) → **Adicionar usuários**
5. Email: `dashboard-ga4-reader@marketing-joinville-2026.iam.gserviceaccount.com`
6. Marcar **Viewer** (só leitura)
7. **Notify new users by email:** desmarcar (é service account, não recebe email)
8. **Adicionar**

## 4. Setar env vars no Vercel

1. Abrir [vercel.com/marquesbill/ensaio-fotografico-joinville/settings/environment-variables](https://vercel.com)
2. Adicionar duas variáveis:

| Nome | Valor | Ambientes |
|---|---|---|
| `GA4_PROPERTY_ID` | `494185724` | Production, Preview, Development |
| `GA4_SERVICE_ACCOUNT_JSON` | (cola o JSON inteiro do arquivo baixado no passo 2) | Production, Preview, Development |

⚠️ **Importante sobre o JSON:** cole o conteúdo cru (inclusive `\n` dentro de `private_key`). Vercel aceita strings multi-linha.

## 5. Redeploy

Como env vars novas, Vercel não rebuilda automaticamente. Force um redeploy:

```bash
git commit --allow-empty -m "trigger redeploy after env vars"
git push origin main
```

Ou no painel Vercel: **Deployments → ... → Redeploy**.

## 6. Testar

1. Acessar `https://ensaiofotograficoemjoinville.com/dashboard`
2. Login com `andre/145414` (ou `elisa/234241`)
3. Os KPIs e gráficos devem carregar com dados reais do GA4

Se aparecer "Service Account não configurada", verifique env vars.
Se aparecer "Permissão negada", verifique que o service account foi adicionado como Viewer na property GA4.

---

## FAQ

**Q: Quanto custa?**
R: Zero. GA4 Data API é gratuita até 200K requests/dia/property. Vamos usar ~5/dia.

**Q: O service account pode ver dados financeiros?**
R: Não. Ele só tem Viewer **na property GA4 específica**. Não tem acesso ao Apps Script, Sheets, Stripe nem ao projeto GCP `dashboard-joinville-2026`.

**Q: E a Elisa, vai ver tudo?**
R: Sim, ela tem login (`elisa/234241`) que dá acesso ao `/admin` (booking) e `/dashboard` (marketing). Para restringir só marketing à Elisa, vamos adicionar verificação de role no próximo step.
