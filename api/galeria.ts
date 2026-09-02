import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac } from 'crypto';

const SCRIPT_URL = process.env.SHEETS_SCRIPT_URL!;

// INLINE (não importar de _*.ts — o bundler da Vercel não inclui e a função crasha).
const SECRET = process.env.ADMIN_SECRET || 'dev-secret-change-me';
function galeriaToken(id: string): string {
  return createHmac('sha256', SECRET).update('galeria:' + id).digest('hex').slice(0, 24);
}


// Versão do termo aceito na galeria (fica gravada no registro do aceite).
export const TERMO_VERSION = '2026-07-17';

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

// Demo do endpoint (só para exercitar /api/galeria?id=demo sem planilha; a página /galeria/demo
// não passa por aqui). Aponta para o carrossel — public/img0..13.jpg estão corrompidos.
const DEMO_PHOTOS = ['baunilha_1462-Enhanced-NR.jpg', 'germana_0107-Enhanced-NR.jpg',
  'join25_12.jpg', 'join25_2208.jpg', 'jon25_3088.jpg', 'jon25_4812.jpg']
  .map((f, i) => ({ id: String(i), url: `/carrossel/${f}`, thumb: `/carrossel/${f}` }));
const DEMO = {
  clientName: 'Ana Paula Consolino', date: '2026-07-24', start: '12:00',
  packageName: 'Completo', numBailarinas: 1,
  accepted: false, surveyed: false,
  photos: DEMO_PHOTOS,
  downloadUrl: 'https://adobe.ly/exemplo-galeria',
  heroUrl: '/carrossel/germana_0107-Enhanced-NR.jpg',
};

/** POST no Apps Script; devolve JSON ou lança erro legível (nunca .json() cru — pode vir HTML). */
async function gs(action: string, body: Record<string, unknown>) {
  const r = await fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: SECRET, action, ...body }),
  });
  const txt = await r.text();
  try { return JSON.parse(txt) as Record<string, unknown>; }
  catch { throw new Error('A planilha respondeu em formato inválido.'); }
}

// Endpoint PÚBLICO da galeria de entrega. Token: /api/galeria?id=<id>&t=<token>.
//   GET                     → dados do ensaio + estado (aceitou? respondeu?) + fotos
//   POST action=aceite      → termos + autorização de imagem + dados do menor
//   POST action=pesquisa    → 2 respostas; devolve o link de download em alta

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const id = String(req.query.id || '').trim();
  const t  = String(req.query.t  || '').trim();
  if (!id || !t) return res.status(400).json({ error: 'Link inválido (faltam parâmetros).' });

  const isDemo = id === 'demo';
  if (!isDemo && t !== galeriaToken(id)) return res.status(403).json({ error: 'Link inválido.' });

  const fwd = req.headers['x-forwarded-for'];
  const ip  = (Array.isArray(fwd) ? fwd[0] : fwd || '').split(',')[0].trim() || 'desconhecido';
  const ua  = String(req.headers['user-agent'] || '').slice(0, 200);

  try {
    if (req.method === 'GET') {
      if (isDemo) return res.status(200).json({ ...DEMO, termoVersion: TERMO_VERSION });
      const r = await fetch(
        `${SCRIPT_URL}?secret=${encodeURIComponent(SECRET)}&action=galeriaById&id=${encodeURIComponent(id)}&t=${Date.now()}`,
        { cache: 'no-store' },
      );
      const txt = await r.text();
      let data: Record<string, unknown> | null = null;
      try { data = JSON.parse(txt); } catch { return res.status(502).json({ error: 'A planilha respondeu em formato inválido.' }); }
      if (data && data.maintenance) return res.status(200).json({ maintenance: true });
      if (!data || data.error) return res.status(404).json({ error: 'Galeria não encontrada.' });
      // Log de acesso (analytics de servidor: hora, IP, dispositivo). Não derruba a página se falhar.
      gs('logGaleriaAcesso', { id, ip, userAgent: ua }).catch(() => {});
      // O link de download só sai depois da pesquisa respondida.
      if (!data.surveyed) delete data.downloadUrl;
      return res.status(200).json({ ...data, termoVersion: TERMO_VERSION });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

    const body   = (req.body ?? {}) as Record<string, unknown>;
    const action = String(body.action || '');

    /* ── Portão 1: termos + autorização de imagem ────────────────────────── */
    if (action === 'aceite') {
      const cpf     = String(body.cpf || '').replace(/\D/g, '');
      const autoriza = body.autoriza === true;
      const menor    = body.menor === true;
      const bNome    = String(body.bailarinaNome || '').trim();
      const bNasc    = String(body.bailarinaNascimento || '').trim();

      if (!isValidCPF(cpf)) return res.status(400).json({ error: 'CPF inválido.' });
      // Menor: nome + data de nascimento identificam a autorização (CPF é o do responsável).
      if (menor && (!bNome || bNome.length < 3)) return res.status(400).json({ error: 'Informe o nome completo da bailarina.' });
      if (menor && !/^\d{4}-\d{2}-\d{2}$/.test(bNasc)) return res.status(400).json({ error: 'Informe a data de nascimento.' });

      if (isDemo) return res.status(200).json({ ok: true });
      const data = await gs('recordGaleriaAceite', {
        id, cpf, autoriza, menor, bailarinaNome: bNome, bailarinaNascimento: bNasc,
        ip, userAgent: ua, termoVersion: TERMO_VERSION,
      });
      if (data.error) return res.status(400).json({ error: String(data.error) });
      return res.status(200).json({ ok: true });
    }

    /* ── Portão 2: pesquisa (libera o download em alta) ──────────────────── */
    if (action === 'pesquisa') {
      const q1 = String(body.q1 || '').trim();
      const q2 = String(body.q2 || '').trim();
      if (!q1 || !q2) return res.status(400).json({ error: 'Responda as duas perguntas.' });

      if (isDemo) return res.status(200).json({ downloadUrl: DEMO.downloadUrl });
      const data = await gs('recordGaleriaPesquisa', { id, q1, q2, ip, userAgent: ua });
      if (data.error)   return res.status(400).json({ error: String(data.error) });
      if (!data.downloadUrl) return res.status(409).json({ error: 'Resposta registrada, mas o link de download ainda não está pronto. Fale com a gente pelo WhatsApp.' });
      return res.status(200).json({ downloadUrl: String(data.downloadUrl) });
    }

    return res.status(400).json({ error: 'Ação desconhecida.' });
  } catch (e) {
    console.error('[api/galeria]', e);
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Erro inesperado.' });
  }
}
