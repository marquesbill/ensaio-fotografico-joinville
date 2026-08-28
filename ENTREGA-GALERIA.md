# Galeria de Entrega — configuração e runbook

Sistema de entrega das fotos do J26: portão de aceite → galeria → pesquisa no download.
**Ainda não está no ar** (nada deployado até 13/08/2026).

> **Impressão saiu do escopo (13/08).** Decisão do André: a galeria agora é só entrega das
> imagens; venda de impressão fica para outro momento. Todo o código de impressão, pedido,
> preço e Checkout ASAAS foi removido — não há resto para reativar, seria reconstruir.

---

## Infraestrutura

| Peça | Valor |
|---|---|
| Bucket R2 | `j26-galerias` (Standard, Eastern North America) |
| Conta Cloudflare | Andreffotografia@gmail.com · account `b4861f03aae81f6d56040894944fabb8` |
| URL pública das imagens | `https://pub-144050c98b964bdc95d46793863feff0.r2.dev` |
| S3 API (upload) | `https://b4861f03aae81f6d56040894944fabb8.r2.cloudflarestorage.com/j26-galerias` |
| Caminho de cada foto | `<URL pública>/<Galeria Pasta>/<arquivo>` — ex.: `.../AG-MQTN2R0O/001.jpg` |
| Miniatura da grade | `<URL pública>/<Galeria Pasta>/t/<arquivo>` — mesmo nome, subpasta `t/` |

**Decisão do André (13/08):** as URLs das imagens são públicas. A galeria é compartilhada
exclusivamente com o responsável; repasses feitos por ele são responsabilidade dele.
Custo em uso previsto: R$ 0 (faixa gratuita de 10 GB e 10 M leituras/mês).

⚠️ A URL `r2.dev` é *rate-limited* e a Cloudflare não a recomenda para produção. Se as
galerias engasgarem sob carga, a saída é um domínio próprio na Cloudflare (exige mover o DNS,
hoje fora da Cloudflare) ou um Worker servindo do bucket privado.

## Fluxo do cliente

1. **Portão 1** (`/galeria/:id?t=token`) — agradecimento + Termos e Condições (Contrato J26) +
   CPF do responsável + "menor de 18?" (se sim: nome e nascimento da bailarina) +
   checkbox **desmarcado** de autorização de imagem. Autorizar ou não **não afeta** o acesso.
2. **Galeria** — grade e visualizador em tela cheia (setas, teclado e swipe).
3. **Portão 2** (primeiro toque em "Baixar") — 2 perguntas de múltipla escolha; respondidas,
   libera o link de download em alta (álbum do Lightroom, coluna `Galeria Link`).
Ambos os portões são **idempotentes e com estado no servidor**: aceitou/respondeu uma vez,
nunca mais aparece — em qualquer aparelho. Não aceitou, aparece sempre.

## Peças no código

| Camada | Arquivo |
|---|---|
| Página pública | `src/pages/Galeria.tsx` (+ rota `/galeria/:id` em `src/main.tsx`) |
| Endpoint | `api/galeria.ts` — token HMAC `galeria:<id>`; GET estado, POST aceite/pesquisa |
| Planilha | `apps-script/agendamentos.gs` — `getGaleriaById`, `recordGaleriaAceite`, `recordGaleriaPesquisa`, `logGaleriaAcesso` |
| Preparação das fotos | `scripts/preparar-galerias.py` |

Demo clicável sem backend: `/galeria/demo?t=x`.

## Colunas novas em "Agendamentos" (auto-criadas, sem `initSheets`)

`Galeria Pasta` · `Galeria Fotos` (arquivos separados por `|`) · `Galeria Link` ·
`Galeria Aceite` · `Galeria CPF` · `Galeria IP` · `Galeria Autoriza` · `Galeria Menor` ·
`Galeria Bailarina` · `Galeria Nascimento` · `Galeria Pesquisa` · `Pesquisa Origem` ·
`Pesquisa Decisão`

Aba nova **"Galeria Log"**: Timestamp · Evento · ID · Detalhe · IP · Dispositivo.
É dela que sai a estatística de acesso (hora, origem por IP, aparelho).

## Preparar e subir as fotos

```bash
python3 scripts/preparar-galerias.py            # relatório do pareamento (não escreve nada)
python3 scripts/preparar-galerias.py --gerar    # gera as imagens de tela em ./staging
```

⚠️ **As contagens de foto anteriores a 13/08 estavam dobradas.** O SSD é volume externo, então o
macOS deixa um AppleDouble `._nome.jpg` ao lado de cada arquivo — 1.328 deles. O script contava
os dois. Medido em 13/08: **1.328 fotos reais em 36 pastas**, não 2.656. Na prática:
Larissa 87 (não 174), Daniela+Lorena 69 (não 138). A projeção de ~3.300 no total vira ~1.650 —
perto da estimativa original do André, de 1.400. Esses arquivos também matavam o `sips`
(exit 13); hoje `_fotos()` os descarta.

Gera, para cada foto, **duas** saídas — ambas a partir do original, nunca uma da outra:

| Saída | Onde | Tamanho | Serve para |
|---|---|---|---|
| Tela | `staging/<AG-ID>/001.jpg` | 2048 px · q82 | lightbox, ao abrir a foto |
| Miniatura | `staging/<AG-ID>/t/001.jpg` | 640 px · q70 | a grade |

Mais `staging/planilha.csv` com `ID · Galeria Pasta · Galeria Fotos` para colar na planilha.
**Não altera os originais**, e pula o que já existe — dá para interromper e retomar.

⚠️ **Suba as duas pastas.** A grade carrega só as miniaturas: sem a subpasta `t/` no bucket,
a galeria puxa os arquivos de 2048 px — numa galeria de 138 fotos são ~80 MB no celular.
A página tem fallback (usa a de tela se a miniatura faltar), então o sintoma não é erro na
tela: é lentidão. Subir sem `t/` significa reprocessar e re-subir tudo depois.

Com `--zip`, gera também `staging/<AG-ID>/fotos.zip` — os **originais em resolução cheia**,
renomeados na mesma numeração da grade (a cliente vê a foto 007 na tela e acha `007.jpg` no
zip). Sem compressão (`ZIP_STORED`): JPEG já vem comprimido, DEFLATE gastaria minutos por
galeria para ganhar quase nada. São ~20 GB no total, por isso é uma flag separada.

O zip é escrito como `fotos.zip.parcial` e só recebe o nome final quando termina — execução
interrompida nunca deixa um zip truncado passando por bom. Refaz sozinho se a **quantidade**
de fotos mudar; se você trocar uma foto mantendo o total, apague o zip à mão.

## O download em alta

`<R2_PUBLIC_URL>/<Galeria Pasta>/fotos.zip`, montado por `_galeriaDownloadUrl` no `.gs`.
A coluna **`Galeria Link` virou OVERRIDE**: vazia, vale o padrão acima; preenchida, manda ela.
Assim não há 50 URLs para digitar à mão. O Lightroom saiu do desenho.

## Gerar o link de uma galeria

Não havia como obter a URL de uma galeria — o token nunca era exposto em lugar nenhum.

```bash
ADMIN_SECRET='<o mesmo da Vercel>' node scripts/link-galeria.mjs AG-MRPA5ISK
```

Aceita vários IDs de uma vez. O segredo vem do ambiente e nunca por argumento (argv aparece
no `ps`). Trocar `ADMIN_SECRET` na Vercel invalida todos os links já enviados.

## Upload para o R2

```bash
rclone copy staging r2:j26-galerias --exclude "planilha.csv" --progress --transfers 8
```

⚠️ O `--exclude "planilha.csv"` não é opcional: o bucket é público e esse arquivo lista IDs de
reserva e nomes de arquivo de todas as clientes.

Para subir **uma** galeria: `rclone copy staging/AG-XXXX r2:j26-galerias/AG-XXXX --progress`.

## Analytics da galeria (Clarity + GA4)

Nada novo foi instalado: o `index.html` já carrega o Clarity (`ws5wo65fne`) e o GA4
(`G-MZ7W1XRY73`), e `src/lib/analytics.ts` já tinha o helper `track`. A galeria só passou
a chamá-lo. O gate `__skipAnalytics` do `index.html` cobre `/admin` e `/dashboard` — **a
galeria é rastreada** (se você e a Mari abrirem galerias para conferir, entram na conta).

**Eventos** (mesmos nomes nos dois; o GA4 recebe também os parâmetros):

| Evento | Quando | Parâmetros (GA4) |
|---|---|---|
| `galeria_abriu` | a galeria carrega | `fotos`, `aceitou`, `respondeu` |
| `galeria_aceite` | passou o portão 1 | `menor`, `autoriza` |
| `galeria_foto_aberta` | abriu uma foto | `foto` (posição) |
| `galeria_pesquisa_vista` | portão 2 apareceu | — |
| `galeria_pesquisa_ok` | respondeu as 2 perguntas | `origem`, `decisao` |
| `galeria_download` | abriu o link em alta | — |
| `video_aberto` | abriu um Vídeo5678 (inclusive ao navegar entre vídeos) | `foto` |
| `video_carrinho_poe` / `video_carrinho_tira` | mexeu no carrinho de vídeos | `foto` |
| `video_checkout` | clicou em pagar | `qtd` |
| `video_pago` | voltou do ASAAS com `?videos=pago` | — |

**Tags de segmentação no Clarity:** `pagina=galeria`, `galeria_id`, `galeria_fotos`,
`galeria_pacote`, `galeria_menor`, `galeria_autoriza`, `pesquisa_origem`, `pesquisa_decisao`,
`galeria_videos` (quantos vídeos a galeria tem) e `video_comprou`.

⚠️ Dois cuidados que já custaram dado errado (27/08/2026):
1. `galeria_abriu` só dispara depois que o índice de vídeos chega (`videosProntos`) —
   antes disso `galeria_videos` saía 0 em galeria que TEM vídeo.
2. **Nunca** chamar `track.*` dentro do updater de um `setState`: o React invoca a
   função duas vezes (sempre, em StrictMode) e o evento vai duplicado para o GA4.
   Dispare antes do `setState`.

Os overlays novos (player, carrinho, tabela) nascem com `data-clarity-mask` na raiz —
eles mostram fotos e miniaturas das bailarinas.

### Privacidade — leia antes de assistir gravação

O Clarity grava a tela. Por padrão (modo **Balanced**) ele mascara caixas de input e números,
mas **não mascara imagens nem texto do corpo da página**. Sem intervenção, as gravações da
galeria conteriam os retratos das bailarinas e o nome da cliente.

Por isso levam `data-clarity-mask="true"`: a grade de fotos, o lightbox, o `<h1>` com o nome
da cliente, o "Olá, <nome>" e o bloco da autorização (que interpola o nome da menor).
CPF, nome e nascimento digitados já são mascarados pelo Clarity em todos os modos, por serem
`<input>` — isso é do produto, não configuração nossa.

Nenhum evento ou tag carrega nome, CPF ou data de nascimento. O único identificador enviado
é `galeria_id` (o código da reserva), que é o que permite ligar uma gravação a uma cliente.

⚠️ Dois pontos que dependem de você, não de código:
1. A documentação da Microsoft diz, literalmente: *"Clarity shouldn't be used on any
   websites/apps targeting users under the age of 18."* O site é contratado por adultos
   responsáveis, então não é o caso vedado — mas vale saber que a restrição existe.
2. O modo de mascaramento é ajustável em **Settings > Masking** no painel do Clarity.
   Trocar para **Strict** mascara tudo por padrão. As máscaras acima valem em qualquer modo.

## Pendências antes de ir ao ar

1. Deploy do `.gs` (nova versão do Web App) + Script Property **`R2_PUBLIC_URL`** =
   `https://pub-144050c98b964bdc95d46793863feff0.r2.dev`
2. Terminar a edição (29 de 52 pastas prontas em 13/08) e rodar o upload.
3. Preencher `Galeria Link` de cada reserva com o álbum do Lightroom.
4. Decidir os dois casos em aberto: a pasta compartilhada **Daniela Alvim + Lorena Ramos**
   (duas reservas, 138 fotos) e os **Especiais** (uma galeria, várias pagadoras).
5. Push para a Vercel (front + `api/galeria.ts`).
