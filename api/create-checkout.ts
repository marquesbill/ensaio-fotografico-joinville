import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';

// ── Solicitação de agendamento (fluxo público NOVO) ─────────────────────────
// O site NÃO cria mais pagamento nem pending: a pessoa escolhe pacote/data/
// hora, preenche os dados e envia uma SOLICITAÇÃO. A Mari recebe o relatório
// por e-mail e fecha pelo WhatsApp; o agendamento real (com link de pagamento)
// é criado exclusivamente pelo painel admin (api/admin-bookings action create).
// O nome do arquivo segue 'create-checkout' pra não mudar rota/analytics.

const LOTE1_START_MS = new Date('2026-05-16T00:00:00-03:00').getTime();
const LOTE2_START_MS = new Date('2026-06-01T00:00:00-03:00').getTime();
function getPackages() {
  const now = Date.now();
  if (now >= LOTE2_START_MS) {
    return {
      lembranca: { name: 'Lembrança', duration: 30,  price: 1800, maxBailarinas: 2 },
      economico: { name: 'Econômico', duration: 60,  price: 2400, maxBailarinas: 3 },
      completo:  { name: 'Completo',  duration: 120, price: 2800, maxBailarinas: 4 },
    };
  }
  if (now >= LOTE1_START_MS) {
    return {
      lembranca: { name: 'Lembrança', duration: 30,  price: 1600, maxBailarinas: 2 },
      economico: { name: 'Econômico', duration: 60,  price: 2100, maxBailarinas: 3 },
      completo:  { name: 'Completo',  duration: 120, price: 2600, maxBailarinas: 4 },
    };
  }
  return {
    lembranca: { name: 'Lembrança', duration: 30,  price: 1400, maxBailarinas: 2 },
    economico: { name: 'Econômico', duration: 60,  price: 1900, maxBailarinas: 3 },
    completo:  { name: 'Completo',  duration: 120, price: 2200, maxBailarinas: 4 },
  };
}
type PkgKey = 'lembranca' | 'economico' | 'completo';

const SCRIPT_URL    = process.env.SHEETS_SCRIPT_URL!;
const SECRET = process.env.ADMIN_SECRET || 'dev-secret-change-me';
const ANDRE_EMAIL   = 'andreffotografia@gmail.com';
const MARIANE_EMAIL = 'mariane.sslourenco@gmail.com';
const FROM_EMAIL    = 'Ensaio Joinville <confirmacao@ensaiofotograficoemjoinville.com>';
const resend        = new Resend(process.env.RESEND_API_KEY!);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const PACKAGES = getPackages();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const { date, time, packageKey, name, email, whatsapp, instagram, numBailarinas } = req.body as {
    date: string; time: string; packageKey: PkgKey;
    name: string; email: string; whatsapp: string;
    instagram?: string; numBailarinas?: number;
  };

  if (!date || !time || !packageKey || !name || !email || !whatsapp) {
    return res.status(400).json({ error: 'Campos obrigatórios faltando' });
  }
  const pkg = PACKAGES[packageKey];
  if (!pkg) return res.status(400).json({ error: 'Pacote inválido' });
  // Venda do Completo INTERROMPIDA (agenda cheia, jul/2026) — trava real do
  // fluxo público; a UI mostra ESGOTADO mas quem manda é aqui.
  if (packageKey === 'completo') {
    return res.status(400).json({ error: 'O pacote Completo está esgotado.' });
  }
  // Datas fora da janela pública (ex.: 19/07, dia extra só-admin) não são
  // solicitáveis pelo site — a UI nem as oferece; trava explícita por garantia.
  if (date < '2026-07-20' || date > '2026-08-02') {
    return res.status(400).json({ error: 'Data fora do período de agendamento.' });
  }
  const nb = Number(numBailarinas);
  if (!Number.isInteger(nb) || nb < 1 || nb > pkg.maxBailarinas) {
    return res.status(400).json({ error: `Nº Bailarinas deve estar entre 1 e ${pkg.maxBailarinas} para o pacote ${pkg.name}` });
  }

  try {
    // Pre-flight: o slot ainda está livre? Evita a Mari receber pedido de
    // horário já tomado (o slot NÃO é reservado aqui — só na criação via admin).
    try {
      const slotsRes  = await fetch(`${SCRIPT_URL}?secret=${encodeURIComponent(SECRET)}&action=slots&date=${encodeURIComponent(date)}&package=${encodeURIComponent(packageKey)}&t=${Date.now()}`, { cache: 'no-store' });
      const slotsJson = await slotsRes.json() as { slots?: string[] };
      const livres    = Array.isArray(slotsJson.slots) ? slotsJson.slots : [];
      if (!livres.includes(time)) {
        return res.status(409).json({ error: 'Esse horário acabou de ser reservado por outra pessoa. Por favor, escolha outro.' });
      }
    } catch (e) {
      console.error('[create-checkout] pre-flight slot check failed', e);
      // Falha do pre-flight não bloqueia — a Mari valida na hora de agendar.
    }

    const dateLabel = date.split('-').reverse().join('/');
    const waDigits  = String(whatsapp).replace(/\D/g, '');
    const waLink    = waDigits ? `https://wa.me/55${waDigits.replace(/^55/, '')}` : '';

    // Relatório pra Mari (cc André) — ela fecha pelo WhatsApp e cria no painel.
    const { error } = await resend.emails.send({
      from:    FROM_EMAIL,
      to:      MARIANE_EMAIL,
      cc:      ANDRE_EMAIL,
      subject: `📩 Solicitação de agendamento: ${name} — ${pkg.name} ${dateLabel} ${time}`,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;">
<h2 style="color:#7a3f8f;margin:0 0 12px;">Nova solicitação de agendamento (site)</h2>
<p>A pessoa escolheu pacote, data e horário no site e pediu contato. <strong>Nada foi reservado nem cobrado</strong> — feche pelo WhatsApp e crie o agendamento no painel admin.</p>
<p><strong>Nome:</strong> ${name}<br>
<strong>WhatsApp:</strong> ${waLink ? `<a href="${waLink}">${whatsapp}</a>` : whatsapp}<br>
<strong>E-mail:</strong> ${email}<br>
<strong>Instagram:</strong> ${instagram || '—'}</p>
<p><strong>Pacote:</strong> ${pkg.name} · ${pkg.duration} min · R$ ${pkg.price.toLocaleString('pt-BR')}<br>
<strong>Data:</strong> ${dateLabel}<br>
<strong>Horário:</strong> ${time}<br>
<strong>Nº bailarinas:</strong> ${nb}</p>
<p style="font-size:12px;color:#6b7280;">O horário NÃO está bloqueado na agenda — ele só sai do ar quando você criar o agendamento no painel.</p>
</div>`,
    });
    if (error) {
      // E-mail é o coração do fluxo novo: sem ele a Mari não fica sabendo.
      console.error('[create-checkout] Resend error', error);
      return res.status(500).json({ error: 'Erro ao enviar sua solicitação. Tente novamente.' });
    }

    // Log na planilha (rastreabilidade) — best-effort.
    await fetch(SCRIPT_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ secret: SECRET, action: 'addLog', message: `SOLICITAÇÃO site: ${name} (${whatsapp}) — ${pkg.name} ${dateLabel} ${time} · ${nb} bailarina(s)`, origin: 'site' }),
    }).catch(() => {});

    return res.status(200).json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[create-checkout]', msg);
    return res.status(500).json({ error: msg });
  }
}
