# Setup GA4 OAuth para o Dashboard

**Setup único, ~10 minutos.** Conecta o dashboard ao GA4 usando OAuth (não service account, porque GA4 com conta Gmail pessoal bloqueia SA — limitação documentada da Google).

## Por que OAuth e não Service Account

Tentamos service account primeiro mas GA4 rejeitou:
- Service account email não é reconhecido como "Conta do Google" válida
- Google Group como intermediário também é rejeitado ("Falha ao registrar usuários")
- Isso acontece porque a **property GA4 está em conta Gmail pessoal** (não Workspace org)

OAuth resolve: o backend autentica como **você** (André) e usa seu acesso pra ler GA4. É o mesmo padrão que Looker Studio, Hotjar, etc. usam.

## 1. Criar OAuth Client no GCP

1. Abrir [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials?project=marketing-joinville-2026)
2. Garantir que está no projeto **`marketing-joinville-2026`**
3. Se aparecer "Configure consent screen" antes, clica e configura:
   - User type: **External**
   - App name: `J26 Dashboard Marketing`
   - User support email: `marquesbill@gmail.com`
   - Developer contact email: `marquesbill@gmail.com`
   - **Salvar e continuar** nas próximas telas (pode deixar tudo default)
   - Na tela "Test users", adicionar `marquesbill@gmail.com` (você é o "tester")
   - **Publish app** (no canto superior) — torna o app utilizável fora do modo teste. Como vai usar só você, fica em "Testing" mode também funciona.

4. De volta em **Credentials**, clicar **+ CREATE CREDENTIALS** → **OAuth client ID**
5. Application type: **Web application**
6. Name: `J26 Dashboard OAuth Client`
7. **Authorized redirect URIs:** adicionar
   ```
   http://localhost:8765/oauth-callback
   ```
8. **CREATE** → modal mostra **Client ID** e **Client Secret** — copie os dois

## 2. Habilitar a Google Analytics Data API

1. [console.cloud.google.com/apis/library/analyticsdata.googleapis.com](https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com?project=marketing-joinville-2026)
2. Botão **ENABLE** (se já estiver habilitada, vai mostrar "API Enabled" com check verde)

## 3. Rodar o script de OAuth dance local

Abra o terminal do projeto e rode (substitua os valores):

```bash
GA4_OAUTH_CLIENT_ID="seu-client-id.apps.googleusercontent.com" \
GA4_OAUTH_CLIENT_SECRET="seu-client-secret" \
node scripts/setup-ga4-oauth.mjs
```

O que acontece:
- Browser abre automaticamente no consent screen do Google
- Aparece "J26 Dashboard Marketing quer acessar sua conta"
  - **Verás warning "App not verified"** porque está em modo Testing
  - Clica em **Advanced** → **Go to J26 Dashboard Marketing (unsafe)** — é seu próprio app, é safe
- Aprova o acesso ao Google Analytics (read-only)
- Página de sucesso aparece no browser
- Terminal mostra o **GA4_OAUTH_REFRESH_TOKEN**

## 4. Setar 4 env vars no Vercel

[vercel.com/marquesbill/ensaio-fotografico-joinville/settings/environment-variables](https://vercel.com)

| Nome | Valor | Ambientes |
|---|---|---|
| `GA4_PROPERTY_ID` | `494185724` | Production, Preview, Development |
| `GA4_OAUTH_CLIENT_ID` | (do passo 1) | Production, Preview, Development |
| `GA4_OAUTH_CLIENT_SECRET` | (do passo 1) | Production, Preview, Development |
| `GA4_OAUTH_REFRESH_TOKEN` | (do passo 3, output do script) | Production, Preview, Development |

## 5. Redeploy

```bash
git commit --allow-empty -m "trigger redeploy after env vars"
git push origin main
```

Ou Vercel → Deployments → último → ⋯ → Redeploy.

## 6. Testar

1. `https://ensaiofotograficoemjoinville.com/dashboard`
2. Login com `andre/145414` ou `elisa/234241`
3. KPIs e gráficos devem carregar com dados reais do GA4

---

## FAQ

**Q: O refresh token expira?**
R: Sim, mas só se ficar **6 meses sem uso**. Como o dashboard chama o GA4 toda vez que você abrir, na prática nunca expira. Se ficar muito tempo sem usar, é só rodar o script de novo (30s).

**Q: O que a Elisa vê?**
R: O mesmo que você (KPIs de GA4). Ela usa as creds dela (`elisa/234241`) e o backend usa o refresh token do André (seu) pra buscar dados. Ela nunca vê o token, nem o acesso direto ao GA4.

**Q: Como revogar o acesso se necessário?**
R: [myaccount.google.com/permissions](https://myaccount.google.com/permissions) → remover "J26 Dashboard Marketing". Token vira inválido na hora.

**Q: A Google notifica quando alguém usa esse OAuth?**
R: Sim, você recebe email "Acesso concedido a J26 Dashboard Marketing" quando o token é criado. Depois, sem notificações (uso normal).

**Q: O dashboard precisa ficar logado o tempo todo?**
R: Não. O backend tem o refresh token guardado em env var. Cada vez que o dashboard chama `/api/dashboard-ga4`, o backend troca refresh_token por access_token (válido 1h) e chama GA4. Tudo server-side.
