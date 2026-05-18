/**
 * ASAAS — helpers compartilhados (HTTP client + criação de Link de Pagamento).
 *
 * Por que Link de Pagamento e não Fatura (POST /v3/payments)?
 *  - Fatura exige `customer` com CPF/CNPJ válido. Nosso form de Agendamento
 *    não coleta CPF, e adicionar esse campo aumenta atrito.
 *  - Link de Pagamento (POST /v3/paymentLinks) coleta CPF/dados de cobrança
 *    na própria página hospedada pela ASAAS — mesma UX do MP, sem mudar form.
 *
 * Feature flag: process.env.PAYMENT_GATEWAY = 'mp' (default) | 'asaas'.
 * Quando flag = 'asaas', create-checkout retorna `{ paymentLinkUrl }`; o front
 * faz window.location = url e o cliente paga na página da ASAAS.
 *
 * Sandbox vs Produção:
 *  - ASAAS_ENV=sandbox  → https://api-sandbox.asaas.com/v3
 *  - ASAAS_ENV=production (ou ausente) → https://api.asaas.com/v3
 */

const ASAAS_API_KEY = process.env.ASAAS_API_KEY || '';
const ASAAS_ENV     = (process.env.ASAAS_ENV || 'production').toLowerCase();
const ASAAS_BASE    = ASAAS_ENV === 'sandbox'
  ? 'https://api-sandbox.asaas.com/v3'
  : 'https://api.asaas.com/v3';

export function asaasEnabled() {
  return Boolean(ASAAS_API_KEY);
}

export function asaasIsSandbox() {
  return ASAAS_ENV === 'sandbox';
}

/**
 * Cliente HTTP minimalista para ASAAS. Levanta erro com mensagem útil
 * (ASAAS retorna `errors: [{code, description}]` no payload).
 */
export async function asaas<T = unknown>(
  path: string,
  init: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown } = {},
): Promise<T> {
  if (!ASAAS_API_KEY) throw new Error('ASAAS_API_KEY não configurada');
  const url = `${ASAAS_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: init.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      access_token:   ASAAS_API_KEY,
      'User-Agent':   'J26-EnsaioJoinville/1.0',
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* response não-JSON */ }

  if (!res.ok) {
    const body = json as { errors?: Array<{ description?: string; code?: string }>; message?: string } | null;
    const apiMsg = body?.errors?.map(e => `${e.code ? `[${e.code}] ` : ''}${e.description || ''}`).filter(Boolean).join('; ')
      || body?.message
      || (typeof text === 'string' && text.length < 500 ? text : '')
      || `HTTP ${res.status}`;
    throw new Error(`[ASAAS ${res.status}] ${apiMsg}`);
  }
  return json as T;
}

/**
 * Cria um Link de Pagamento "detached" (avulso, 1 cobrança).
 *
 * Mapeamento canon ↔ ASAAS:
 *  - `name`              → título exibido pro cliente
 *  - `description`       → subtítulo (data/horário/duração)
 *  - `value`             → valor em R$ (number)
 *  - `billingType`       → 'UNDEFINED' = deixa o cliente escolher (PIX | Boleto | Cartão)
 *  - `chargeType`        → 'DETACHED'  = uma cobrança avulsa (não recorrente)
 *  - `dueDateLimitDays`  → janela de pagamento; usamos 1 dia (alinha com expires_at do MP de 30min,
 *                          mas a ASAAS exige inteiro de dias; menor valor permitido é 1)
 *  - `endDate`           → última data em que o link aceita novos pagamentos
 *  - `externalReference` → JSON com nossos metadados (date/time/packageKey/...) — necessário
 *                          pro webhook saber qual booking confirmar
 *  - `callback.successUrl` → onde o cliente cai depois de pagar
 *  - `callback.autoRedirect` → redireciona automaticamente após pagamento confirmado
 *  - `notificationDisabled: true` → desliga emails da ASAAS (já enviamos via Resend)
 *
 * Retorna `{ id, url }`. A URL é o `invoiceUrl` equivalente — onde redirecionar o cliente.
 */
export type AsaasPaymentLink = {
  id: string;
  url: string;
  active?: boolean;
  name?: string;
  value?: number;
  externalReference?: string;
  endDate?: string;
};

/**
 * Encode booking metadata into a compact pipe-delimited string for ASAAS
 * `externalReference` (max 100 chars). JSON tem overhead alto demais (~76 chars
 * só de chaves/aspas/colons antes de dados); pipe-delimited cabe sempre.
 *
 * Formato: `v1|<date>|<time>|<packageKey[0]>|<numBailarinas>|<whatsapp>|<name>|<email>`
 * Exemplo: `v1|2026-07-20|09:00|l|1|47999999999|Maria Silva|m@silva.com` (~58 chars)
 *
 * Budget breakdown (chars):
 *  - prefix "v1" + 7 pipes:               9
 *  - date (YYYY-MM-DD):                  10
 *  - time (HH:MM):                        5
 *  - packageKey (1 char):                 1
 *  - numBailarinas (1 char):              1
 *  - whatsapp (11):                      11
 *  - sobra pra name + email:             63 chars
 *
 * Se ainda passar de 100 (nomes/emails extremos), truncamos name primeiro.
 */
export function encodeAsaasRef(o: {
  date: string; time: string; packageKey: string; numBailarinas: number;
  name: string; email: string; whatsapp: string;
}): string {
  const pkg = o.packageKey.charAt(0); // l|e|c
  // `name` e `email` não podem conter `|` (substituímos por espaço/`_` por segurança).
  const safeName  = String(o.name || '').replace(/\|/g, ' ');
  const safeEmail = String(o.email || '').replace(/\|/g, '_');
  const build = (n: string, e: string) =>
    `v1|${o.date}|${o.time}|${pkg}|${o.numBailarinas}|${o.whatsapp}|${n}|${e}`;

  let ref = build(safeName, safeEmail);
  if (ref.length <= 100) return ref;

  // Trunca name agressivamente até caber. Email tem prioridade (precisa ser válido).
  const overhead = build('', '').length + safeEmail.length;  // tudo menos name
  const nameBudget = Math.max(0, 100 - overhead);
  ref = build(safeName.slice(0, nameBudget), safeEmail);
  if (ref.length <= 100) return ref;

  // Caso extremo: trunca email tb. Pior cenário: emails podem ficar inválidos —
  // o webhook deve usar paymentLink.id como matcher primário e ignorar email
  // quebrado (deixa pro Apps Script lookup futuro).
  return build('', safeEmail.slice(0, Math.max(0, 100 - build('', '').length)));
}

/**
 * Decoder reverso. Aceita tanto formato `v1|...` (ASAAS) quanto JSON antigo
 * (legacy). Devolve forma canônica com strings vazias quando faltam campos.
 */
export function decodeAsaasRef(raw: string): {
  date: string; time: string; packageKey: string; numBailarinas: number;
  name: string; email: string; whatsapp: string;
} {
  const packageMap: Record<string, string> = { l: 'lembranca', e: 'economico', c: 'completo' };

  if (raw.startsWith('v1|')) {
    const parts = raw.split('|'); // ['v1', date, time, p, b, w, n, e]
    return {
      date:          parts[1] || '',
      time:          parts[2] || '',
      packageKey:    packageMap[parts[3] || ''] || parts[3] || '',
      numBailarinas: Number(parts[4]) || 1,
      whatsapp:      parts[5] || '',
      name:          parts[6] || '',
      email:         parts[7] || '',
    };
  }

  // Fallback: tenta JSON (compat com pacotes legados ou MP-style)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let p: any = {};
  try { p = JSON.parse(raw || '{}'); } catch { /* corrupto */ }
  return {
    date:          p.date || p.d || '',
    time:          p.time || p.t || '',
    packageKey:    p.packageKey || packageMap[p.p || ''] || p.p || '',
    numBailarinas: Number(p.numBailarinas ?? p.b) || 1,
    name:          p.name || p.n || '',
    email:         p.email || p.e || '',
    whatsapp:      p.whatsapp || p.w || '',
  };
}

export async function createAsaasPaymentLink(opts: {
  name: string;            // título do link (visível pro cliente)
  description?: string;    // subtítulo
  value: number;           // R$
  externalReference: string; // formato `v1|...` (use encodeAsaasRef)
  successUrl: string;
}): Promise<AsaasPaymentLink> {
  // Janela de pagamento: hoje + 1 dia (corresponde ao slot ainda estar "pending"
  // no Sheets; depois disso o Apps Script o libera por timeout).
  const endDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Callback (redirect pós-pagamento) exige domínio cadastrado em "Minha Conta
  // > Informações" no painel ASAAS. Sem isso a API rejeita com
  // "invalid_object: Não há nenhum domínio configurado em sua conta".
  // Setamos ASAAS_USE_CALLBACK=true quando o domínio estiver pronto.
  const useCallback = (process.env.ASAAS_USE_CALLBACK || 'false').toLowerCase() === 'true';

  type Body = {
    name: string; description: string; billingType: string; chargeType: string;
    value: number; dueDateLimitDays: number; endDate: string;
    externalReference: string; notificationDisabled: boolean;
    callback?: { successUrl: string; autoRedirect: boolean };
  };
  const body: Body = {
    name:                opts.name,
    description:         opts.description || '',
    billingType:         'UNDEFINED', // cliente escolhe PIX/Boleto/Cartão
    chargeType:          'DETACHED',  // cobrança única, não recorrente
    value:               opts.value,
    dueDateLimitDays:    1,
    endDate,
    externalReference:   opts.externalReference,
    notificationDisabled: true,
  };
  if (useCallback) {
    body.callback = { successUrl: opts.successUrl, autoRedirect: true };
  }

  return asaas<AsaasPaymentLink>('/paymentLinks', { method: 'POST', body });
}

/**
 * Busca um pagamento por ID. Usado no webhook pra obter `externalReference`
 * (o webhook payload já inclui o payment inteiro, mas em casos de re-check
 * ou debug é útil ter o fetch também).
 */
export type AsaasPayment = {
  id: string;
  status: string;             // 'PENDING' | 'CONFIRMED' | 'RECEIVED' | 'OVERDUE' | 'REFUNDED' | ...
  customer: string;
  value: number;
  netValue?: number;
  billingType: string;        // 'PIX' | 'CREDIT_CARD' | 'BOLETO' | 'UNDEFINED'
  externalReference?: string;
  installmentCount?: number;
  paymentLink?: string;       // id do paymentLink que originou
  dateCreated?: string;
  confirmedDate?: string;
  paymentDate?: string;
};

export async function fetchAsaasPayment(id: string): Promise<AsaasPayment> {
  return asaas<AsaasPayment>(`/payments/${id}`);
}
