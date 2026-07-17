import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac } from 'crypto';

const SCRIPT_URL = process.env.SHEETS_SCRIPT_URL!;

// INLINE (não importar de _*.ts — o bundler da Vercel não inclui e a função crasha).
// Token do link de aceite: derivado do id do booking. Mesmo esquema do especialToken,
// prefixo 'contrato:' pra ser um token distinto. Duplicado em api/admin-bookings.ts.
const SECRET = process.env.ADMIN_SECRET || 'dev-secret-change-me';
function contratoToken(id: string): string {
  return createHmac('sha256', SECRET).update('contrato:' + id).digest('hex').slice(0, 24);
}

// Versão do contrato que está no ar (o texto vive em src/pages/Contrato.tsx).
// Fica gravada no log de aceite — é o que amarra "o cliente aceitou ESTA versão".
export const CONTRACT_VERSION = '2026-07-17';

// CPF: valida os 2 dígitos verificadores (não é só contar 11 números).
function isValidCPF(raw: string): boolean {
  const cpf = String(raw || '').replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const dv = (base: string, factor: number) => {
    let sum = 0;
    for (const d of base) sum += Number(d) * factor--;
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(cpf.slice(0, 9), 10) === Number(cpf[9]) && dv(cpf.slice(0, 10), 11) === Number(cpf[10]);
}

// Mock pra demo local (sem Apps Script): /api/contrato?id=demo&t=<qualquer>
const DEMO = {
  clientName: 'Maria Clara Ribeiro', date: '2026-07-28', start: '14:10', end: '14:40',
  packageName: 'Lembrança', value: 1800, payUrl: 'https://www.asaas.com/c/demo-link', accepted: false,
};

// Endpoint PÚBLICO (sem auth de admin) da página de aceite do contrato.
// Protegido por token: /api/contrato?id=<id>&t=<token>.
//   GET  → resumo do booking + versão do contrato + já aceito?
//   POST { cpf } → valida, registra o aceite (nome/CPF/data/hora/IP) e devolve o link de pagamento.
// Regra Opção A: o link de pagamento só é devolvido DEPOIS do aceite registrado.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const id = String(req.query.id || '').trim();
  const t  = String(req.query.t  || '').trim();
  if (!id || !t) return res.status(400).json({ error: 'Link inválido (faltam parâmetros).' });

  const isDemo = id === 'demo';
  if (!isDemo && t !== contratoToken(id)) return res.status(403).json({ error: 'Link inválido.' });

  if (req.method === 'GET') {
    if (isDemo) return res.status(200).json({ ...DEMO, contractVersion: CONTRACT_VERSION });
    try {
      const r = await fetch(
        `${SCRIPT_URL}?action=contratoById&id=${encodeURIComponent(id)}&t=${Date.now()}`,
        { cache: 'no-store' },
      );
      const txt = await r.text();
      let data: { error?: string; payUrl?: string } | null = null;
      try { data = JSON.parse(txt); } catch { return res.status(502).json({ error: 'Planilha respondeu inválido.' }); }
      if (!data || data.error) return res.status(404).json({ error: 'Agendamento não encontrado.' });
      return res.status(200).json({ ...data, contractVersion: CONTRACT_VERSION });
    } catch (e) {
      console.error('[api/contrato GET]', e);
      return res.status(500).json({ error: 'Erro ao carregar.' });
    }
  }

  if (req.method === 'POST') {
    const cpf = String((req.body as { cpf?: string })?.cpf || '').replace(/\D/g, '');
    if (!isValidCPF(cpf)) return res.status(400).json({ error: 'CPF inválido.' });

    const fwd = req.headers['x-forwarded-for'];
    const ip  = (Array.isArray(fwd) ? fwd[0] : fwd || '').split(',')[0].trim() || 'desconhecido';
    const ua  = String(req.headers['user-agent'] || '').slice(0, 200);

    if (isDemo) return res.status(200).json({ payUrl: DEMO.payUrl });
    try {
      const r = await fetch(`${SCRIPT_URL}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'recordContractAcceptance', id, cpf, ip, userAgent: ua, contractVersion: CONTRACT_VERSION }),
      });
      const txt = await r.text();
      let data: { error?: string; payUrl?: string } | null = null;
      try { data = JSON.parse(txt); } catch { return res.status(502).json({ error: 'Planilha respondeu inválido.' }); }
      if (!data || data.error) return res.status(400).json({ error: data?.error || 'Não foi possível registrar o aceite.' });
      if (!data.payUrl) return res.status(409).json({ error: 'Aceite registrado, mas o link de pagamento ainda não está pronto. Fale com a organizadora.' });
      return res.status(200).json({ payUrl: data.payUrl });
    } catch (e) {
      console.error('[api/contrato POST]', e);
      return res.status(500).json({ error: 'Erro ao registrar o aceite.' });
    }
  }

  return res.status(405).json({ error: 'method not allowed' });
}

// isValidCPF verificado fora do bundle (dígitos verificadores): aceita 52998224725 /
// 111.444.777-35 / 168.995.350-09; rejeita repetidos, DV errado, curto, vazio, com letra.
