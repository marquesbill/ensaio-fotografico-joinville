import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac } from 'crypto';
import { waitUntil } from '@vercel/functions';
import { Resend } from 'resend';

// ── Checkout dos Vídeos 5678 ────────────────────────────────────────────────
// POST { id, t, numeros: ["004","017",...] } → { url } (Checkout ASAAS).
// O preço é recalculado AQUI a partir da quantidade — o front só exibe; o que
// vale é o servidor. A lista de números vai no addLog (auditoria) e na
// description do item; a entrega do 4K é manual, disparada pelo pagamento.

const SCRIPT_URL = process.env.SHEETS_SCRIPT_URL!;
const ANDRE_EMAIL = 'andreffotografia@gmail.com';
const FROM_EMAIL  = 'Ensaio Joinville <confirmacao@ensaiofotograficoemjoinville.com>';
const resend = new Resend(process.env.RESEND_API_KEY!);
const R2_BASE    = 'https://pub-144050c98b964bdc95d46793863feff0.r2.dev';
const SITE       = 'https://www.ensaiofotograficoemjoinville.com';

// INLINE (não importar de _*.ts — o bundler da Vercel não inclui e a função crasha).
const SECRET = process.env.ADMIN_SECRET || 'dev-secret-change-me';
const galeriaToken = (id: string) =>
  createHmac('sha256', SECRET).update('galeria:' + id).digest('hex').slice(0, 24);

/** Curva fechada com o André (27/08/2026): tabela até 6; do 7º em diante +R$60/vídeo. */
const TABELA = [0, 120, 220, 320, 400, 460, 520];
export function precoVideos(n: number): number {
  if (n <= 0) return 0;
  return n <= 6 ? TABELA[n] : 520 + 60 * (n - 6);
}

// GALERIA DE TESTE — R$5 fixo, qualquer quantidade (André, 31/08/2026).
// Existe só para o André exercer o fluxo de pagamento ASAAS ponta a ponta com
// dinheiro real sem gastar R$120. NAO e uma galeria de cliente.
// REMOVER depois do teste: enquanto este ID existir, quem tiver o link dele
// compra vídeo a R$5. O ID é de uma galeria criada só para isso — nenhuma
// cliente o recebe.
const GALERIA_TESTE = process.env.VIDEOS_GALERIA_TESTE || '';
const PRECO_TESTE = 5;

/* ── ASAAS (inline, mesmo padrão de admin-bookings.ts) ── */
const ASAAS_API_KEY = process.env.ASAAS_API_KEY || '';
const ASAAS_BASE = (process.env.ASAAS_ENV || 'production').toLowerCase() === 'sandbox'
  ? 'https://api-sandbox.asaas.com/v3'
  : 'https://api.asaas.com/v3';

async function asaasApi<T = unknown>(path: string, body: unknown): Promise<T> {
  if (!ASAAS_API_KEY) throw new Error('ASAAS_API_KEY não configurada');
  const r = await fetch(`${ASAAS_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', access_token: ASAAS_API_KEY,
      'User-Agent': 'J26-EnsaioJoinville-Videos/1.0' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* não-JSON */ }
  if (!r.ok) {
    const b = json as { errors?: Array<{ description?: string; code?: string }> } | null;
    const msg = b?.errors?.map(e => e.description || e.code || '').filter(Boolean).join('; ')
      || `HTTP ${r.status}`;
    throw new Error(`[ASAAS] ${msg}`);
  }
  return json as T;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET ?id&t → { email } da dona da galeria (personaliza a promessa de entrega no carrinho).
  if (req.method === 'GET') {
    const id = String(req.query.id || '').trim();
    const t  = String(req.query.t  || '').trim();
    if (!id || t !== galeriaToken(id)) return res.status(403).json({ error: 'Link inválido.' });
    try {
      const r = await fetch(`${SCRIPT_URL}?secret=${encodeURIComponent(SECRET)}&action=bookings&t=${Date.now()}`, { cache: 'no-store' });
      const all = await r.json() as Array<{ id: string; email?: string }>;
      const email = String(all.find(b => b.id === id)?.email || '').trim();
      return res.status(200).json({ email });
    } catch {
      return res.status(200).json({ email: '' });   // cosmético: sem e-mail, frase genérica
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const body = (req.body ?? {}) as { id?: unknown; t?: unknown; numeros?: unknown };
  const id = String(body.id || '').trim();
  const t  = String(body.t  || '').trim();
  if (!id || t !== galeriaToken(id)) return res.status(403).json({ error: 'Link inválido.' });

  const numeros = Array.isArray(body.numeros)
    ? [...new Set(body.numeros.map(v => String(v)))].filter(v => /^\d{3}$/.test(v)).sort()
    : [];
  if (numeros.length < 1 || numeros.length > 50) {
    return res.status(400).json({ error: 'Selecione de 1 a 50 vídeos.' });
  }

  try {
    // Só vende o que existe: o índice no R2 é a fonte da verdade dos vídeos.
    const idx = await fetch(`${R2_BASE}/${id}/v/index.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!idx.ok) return res.status(404).json({ error: 'Esta galeria não tem vídeos.' });
    const { videos } = await idx.json() as { videos: string[] };
    const invalidos = numeros.filter(n => !videos.includes(n));
    if (invalidos.length) {
      return res.status(400).json({ error: `Vídeo(s) inexistente(s): ${invalidos.join(', ')}.` });
    }

    const n     = numeros.length;
    const teste = !!GALERIA_TESTE && id === GALERIA_TESTE;
    const valor = teste ? PRECO_TESTE : precoVideos(n);
    const lista = numeros.join(',');
    const galeriaUrl = `${SITE}/galeria/${id}?t=${t}`;

    // externalReference ≤100 chars (regra ASAAS): a lista de vídeos NÃO vai
    // aqui (>20 vídeos estourava o limite e truncava em silêncio) — só no
    // addLog e na description (480 chars, sempre cabe até 50 vídeos).
    const ref = `v5678|${id}|${n}`;

    const checkout = await asaasApi<{ id: string; link: string }>('/checkouts', {
      billingTypes:      ['CREDIT_CARD', 'PIX'],
      chargeTypes:       ['DETACHED', 'INSTALLMENT'],
      minutesToExpire:   1440,
      externalReference: ref,
      callback:          { successUrl: `${galeriaUrl}&videos=pago`, cancelUrl: galeriaUrl },
      items: [{
        name:        `Vídeos 5678 — ${n} ${n === 1 ? 'vídeo' : 'vídeos'}`,
        description: `Ensaio Fotográfico em Joinville 2026 · fotos ${lista}`.slice(0, 480),
        quantity:    1,
        value:       valor,
      }],
      installment: { maxInstallmentCount: Math.min(Math.max(parseInt(process.env.ASAAS_MAX_INSTALLMENTS || '6', 10) || 6, 1), 12) },
    });

    // REGISTRO DO PEDIDO — é a chave de junção do webhook, não rastreio.
    // O ASAAS não devolve NADA do checkout junto com o pagamento (medido em
    // produção, 01/09/2026: payment.externalReference e payment.description
    // chegam vazios, e GET /v3/checkouts/{id} não existe). O que sobrevive é
    // payment.checkoutSession == checkout.id — então o id vai para a coluna
    // "Booking ID" da aba Log, no formato legado que o doPost já aceita, e o
    // confirmBooking do Apps Script casa por ele (aba Log, Ação VIDEO_PEDIDO).
    // detail = galeria|fotos|valor|qtd[|TESTE] — o .gs faz split('|').
    // Falha ALTA de propósito: sem esta linha a venda fica órfã em silêncio;
    // melhor a cliente ver "tente de novo" do que pagar num pedido que não
    // existe em lugar nenhum. O checkout órfão no ASAAS expira sozinho em
    // 1440 min (minutesToExpire acima).
    // A PLANILHA SAIU DO CAMINHO DA COMPRA. Medido em 02/09/2026: o addLog do
    // Apps Script tem mediana de 2,6 s mas cauda de 10–70 s (o Google serializa
    // execuções do mesmo script; sob concorrência as esperas foram de 50–73 s).
    // Antes a cliente esperava essa cauda inteira olhando um spinner. Agora:
    //   - a gravação começa já;
    //   - se terminar em até 3 s, ela recebe o link com a linha já gravada;
    //   - se não, recebe o link aos 3 s e a gravação continua em segundo plano
    //     (waitUntil segura a função viva até o fim; maxDuration 60 no vercel.json).
    // Se as duas tentativas falharem, e-mail para o André com a linha pronta
    // para colar na aba Log — e, se ela pagar antes disso, o webhook já dispara
    // o alerta 🚨 dele quando o confirmBooking não acha o VIDEO_PEDIDO.
    const linha    = `${id}|${lista}|${valor}|${n}${teste ? '|TESTE' : ''}`;
    const registro = registrarPedido(checkout.id, linha);
    await Promise.race([registro, new Promise(r => setTimeout(r, 3000))]);
    waitUntil(registro);

    return res.status(200).json({ url: checkout.link, valor });
  } catch (e) {
    console.error('[videos-checkout]', e);
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Erro inesperado.' });
  }
}


// Grava o VIDEO_PEDIDO na aba Log. Nunca lança: quem chama já respondeu (ou vai
// responder) à cliente. 25 s cobre toda a distribuição que teve sucesso na
// medição de 02/09; a 2ª tentativa é para o 404 esporádico do redirect do
// Google (~1 em 6). Repetir pode duplicar a linha — o Apps Script GRAVA mesmo
// quando a resposta se perde — e duplicata é inofensiva: confirmBooking casa
// por checkout.id e pega a primeira.
async function registrarPedido(checkoutId: string, linha: string): Promise<void> {
  let ultimoErro = 'sem resposta';
  for (const ms of [25000, 20000]) {
    try {
      const rl = await fetch(SCRIPT_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },
        signal: AbortSignal.timeout(ms),
        body: JSON.stringify({ secret: SECRET, action: 'addLog', logAction: 'VIDEO_PEDIDO',
          bookingId: checkoutId, detail: linha, origin: 'videos5678' }),
      });
      // Apps Script devolve erro como HTTP 200 + {error} — checar os dois.
      const jl = await rl.json().catch(() => ({ error: 'resposta inválida' })) as { error?: string };
      if (rl.ok && !jl.error) return;
      ultimoErro = jl.error || `HTTP ${rl.status}`;
    } catch (e) {
      ultimoErro = e instanceof Error ? e.message : String(e);
    }
  }
  console.error(`[videos-checkout] VIDEO_PEDIDO NÃO gravado ${checkoutId}: ${ultimoErro}`);
  // Último recurso: a linha inteira no e-mail. Sem isto, a cliente paga e a
  // venda fica órfã — ninguém sabe qual galeria nem quais vídeos.
  const { error } = await resend.emails.send({
    from: FROM_EMAIL, to: ANDRE_EMAIL,
    subject: `⚠️ Vídeo5678: pedido NÃO registrado na planilha — ${checkoutId}`,
    html: `<p>O Apps Script não respondeu em duas tentativas (<code>${ultimoErro}</code>). O checkout do ASAAS existe e a cliente pode pagar normalmente — mas sem esta linha a venda fica órfã.</p>
<p><strong>Cole na aba Log</strong> (Ação · Booking ID · Detalhe · Origem):</p>
<p><code>VIDEO_PEDIDO</code> · <code>${checkoutId}</code> · <code>${linha}</code> · <code>videos5678</code></p>`,
  }).catch(e => ({ error: e }));
  if (error) console.error('[videos-checkout] e-mail de pedido órfão falhou', error);
}
