import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';
import { decodeAsaasRef } from './_asaas';



const LOTE1_START_MS = new Date('2026-05-16T00:00:00-03:00').getTime();
const LOTE2_START_MS = new Date('2026-07-01T00:00:00-03:00').getTime();
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

function fmtDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

// Template de email (inline; antes era módulo compartilhado mas Vercel
// não estava bundlando da pasta lib/).
const HERO_IMG_URL = 'https://www.ensaiofotograficoemjoinville.com/email-hero.jpg';
const MONTHS_PT = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const DAYS_PT   = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];

function fmtDateLong(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return `${String(d).padStart(2, '0')} de ${MONTHS_PT[m - 1]} de ${y} · ${DAYS_PT[dt.getUTCDay()]}`;
}

const VARIANT_CFG: Record<string, { tag: string; intro: string; tagColor: string }> = {
  confirmed:   { tag: 'Reserva Confirmada', intro: 'Recebemos sua reserva. Os detalhes do seu ensaio estão registrados abaixo — guarde este e-mail para referência.', tagColor: '#7a3f8f' },
  rescheduled: { tag: 'Reserva Remarcada',  intro: 'Seu ensaio foi remarcado. Confira abaixo o novo horário e demais detalhes.', tagColor: '#7a3f8f' },
  cancelled:   { tag: 'Reserva Cancelada',  intro: 'Sua reserva foi cancelada. Os detalhes do ensaio que foi cancelado estão registrados abaixo. Em caso de dúvida, fale conosco.', tagColor: '#b91c1c' },
};

function buildBookingEmailHtml(data: {
  name: string; date: string; time: string; endTime: string;
  packageName: string; duration: number; price: string; bookingId: string;
  numBailarinas: number;
}, variant: 'confirmed' | 'rescheduled' | 'cancelled'): string {
  const cfg = VARIANT_CFG[variant];
  const firstName = String(data.name || '').trim().split(/\s+/)[0] || data.name;
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${cfg.tag}</title></head>
<body style="margin:0;padding:0;background:#f5f0fa;font-family:Georgia,'Cormorant Garamond','Times New Roman',serif;color:#1a1a1a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f0fa;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:6px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
<tr><td style="line-height:0;"><img src="${HERO_IMG_URL}" alt="" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;"></td></tr>
<tr><td style="padding:36px 40px 0;text-align:center;"><span style="display:inline-block;font-family:Georgia,'Times New Roman',serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${cfg.tagColor};border:1px solid #e8d8f0;border-radius:30px;padding:6px 16px;">${cfg.tag}</span></td></tr>
<tr><td style="padding:24px 40px 4px;text-align:center;"><p style="margin:0;font-family:Georgia,'Cormorant Garamond',serif;font-size:30px;line-height:1.2;color:#1a1a1a;font-weight:400;font-style:italic;">Olá, <strong style="font-weight:600;">${firstName}</strong>.</p></td></tr>
<tr><td style="padding:18px 56px 32px;text-align:center;"><p style="margin:0;font-family:Georgia,serif;font-size:14px;line-height:1.65;color:#555;">${cfg.intro}</p></td></tr>
<tr><td style="padding:0 40px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #eee;">
<tr><td style="padding:18px 0;border-bottom:1px solid #eee;"><p style="margin:0 0 4px;font-family:Georgia,serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">Data</p><p style="margin:0;font-family:Georgia,serif;font-size:16px;color:#1a1a1a;">${fmtDateLong(data.date)}</p></td></tr>
<tr><td style="padding:18px 0;border-bottom:1px solid #eee;"><p style="margin:0 0 4px;font-family:Georgia,serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">Horário</p><p style="margin:0;font-family:Georgia,serif;font-size:16px;color:#1a1a1a;">${data.time} — ${data.endTime}</p></td></tr>
<tr><td style="padding:18px 0;border-bottom:1px solid #eee;"><p style="margin:0 0 4px;font-family:Georgia,serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">Pacote</p><p style="margin:0;font-family:Georgia,serif;font-size:16px;color:#1a1a1a;">${data.packageName} · ${data.duration} minutos</p></td></tr>
<tr><td style="padding:18px 0;border-bottom:1px solid #eee;"><p style="margin:0 0 4px;font-family:Georgia,serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">Grupo</p><p style="margin:0;font-family:Georgia,serif;font-size:16px;color:#1a1a1a;">${data.numBailarinas} ${data.numBailarinas === 1 ? 'bailarina' : 'bailarinas'}</p></td></tr>
<tr><td style="padding:18px 0;border-bottom:1px solid #eee;"><p style="margin:0 0 4px;font-family:Georgia,serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">Local</p><p style="margin:0;font-family:Georgia,serif;font-size:16px;color:#1a1a1a;"><a href="https://www.google.com/maps/search/Hotel+Le+Village+Joinville+SC" style="color:#1a1a1a;text-decoration:none;">Hotel Le Village</a></p><p style="margin:2px 0 0;font-family:Georgia,serif;font-size:13px;color:#777;">Sala Esmeralda · Joinville · SC</p></td></tr>
<tr><td style="padding:18px 0;"><p style="margin:0 0 4px;font-family:Georgia,serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">Valor</p><p style="margin:0;font-family:Georgia,serif;font-size:18px;color:#7a3f8f;font-weight:600;">R$ ${data.price}</p></td></tr>
</table></td></tr>
<tr><td style="padding:32px 40px 24px;text-align:center;border-top:1px solid #eee;"><p style="margin:0;font-family:Georgia,serif;font-size:13px;line-height:1.6;color:#666;">Em caso de dúvida ou necessidade de remarcação, fale conosco pelo</p><p style="margin:6px 0 0;font-family:Georgia,serif;font-size:14px;line-height:1.6;"><a href="https://wa.me/5511519606272" style="color:#128C7E;text-decoration:none;font-weight:600;white-space:nowrap;">WhatsApp (11) 5196-0627</a></p></td></tr>
<tr><td style="padding:0 40px 24px;text-align:center;"><p style="margin:0;font-family:Georgia,serif;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#bbb;">Código da reserva · <span style="color:#777;font-family:monospace;letter-spacing:1px;">${data.bookingId}</span></p></td></tr>
<tr><td style="padding:20px 40px 28px;text-align:center;background:#fafafa;border-top:1px solid #eee;"><p style="margin:0;font-family:Georgia,serif;font-size:12px;color:#999;">© 2026 André Ferreira Fotografia</p><p style="margin:4px 0 0;font-family:Georgia,serif;font-size:12px;"><a href="https://www.instagram.com/affotografia" style="color:#7a3f8f;text-decoration:none;">@affotografia</a></p></td></tr>
</table></td></tr></table></body></html>`;
}

const MP_TOKEN          = process.env.MERCADOPAGO_ACCESS_TOKEN!;
const SCRIPT_URL        = process.env.SHEETS_SCRIPT_URL!;
const ASAAS_WEBHOOK_TOK = process.env.ASAAS_WEBHOOK_TOKEN || '';
const ANDRE_EMAIL   = 'andreffotografia@gmail.com';
const MARIANE_EMAIL = 'mariane.sslourenco@gmail.com';
const FROM_EMAIL    = 'Ensaio Joinville <confirmacao@ensaiofotograficoemjoinville.com>';

const resend = new Resend(process.env.RESEND_API_KEY!);

// ─── Tipo unificado pós-normalização ───────────────────────────
// Independente do gateway, mapeamos para essa forma antes de continuar.
type NormalizedPayment = {
  gateway:        'mp' | 'asaas';
  externalSlotId: string;          // pareia com o `stripeSession` no Sheets
  paymentId:      string;          // ID interno do gateway (pra log)
  externalRef:    string;          // JSON com meta do booking
  installments:   number;
  billingType?:   string;          // PIX | CREDIT_CARD | BOLETO | UNDEFINED (ASAAS); ausente em MP
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const PACKAGES = getPackages();
  if (req.method !== 'POST') return res.status(405).end();

  // Detecta o gateway pelo formato do payload:
  //  - ASAAS envia `{ event, payment }`
  //  - MP    envia `{ type: 'payment', data: { id } }`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = req.body as any;
  const isAsaas = typeof body?.event === 'string' && body?.payment;
  const isMp    = body?.type === 'payment';

  let normalized: NormalizedPayment;

  if (isAsaas) {
    // Autenticação opcional via header asaas-access-token (definido no painel ASAAS)
    if (ASAAS_WEBHOOK_TOK) {
      const got = (req.headers['asaas-access-token'] || req.headers['Asaas-Access-Token'] || '') as string;
      if (got !== ASAAS_WEBHOOK_TOK) {
        console.warn('[webhook] ASAAS token mismatch');
        return res.status(401).json({ error: 'Invalid webhook token' });
      }
    }

    const evt = body.event as string;
    const pay = body.payment as {
      id: string; status: string; paymentLink?: string;
      externalReference?: string; installmentCount?: number; billingType?: string;
    };

    // Apenas eventos definitivos de confirmação avançam o fluxo:
    //  - PAYMENT_CONFIRMED → cartão capturado
    //  - PAYMENT_RECEIVED  → boleto/PIX recebido
    // Outros eventos (CREATED, AUTHORIZED, PENDING…) são apenas reconhecidos.
    if (evt !== 'PAYMENT_CONFIRMED' && evt !== 'PAYMENT_RECEIVED') {
      return res.status(200).json({ received: true, event: evt, status: pay?.status });
    }
    if (!pay?.paymentLink || !pay?.externalReference) {
      console.error('[webhook] ASAAS payment without paymentLink or externalReference', pay);
      return res.status(400).json({ error: 'Missing paymentLink or externalReference' });
    }

    normalized = {
      gateway:        'asaas',
      externalSlotId: pay.paymentLink,            // ID do Link no Sheets
      paymentId:      pay.id,
      externalRef:    pay.externalReference,
      installments:   pay.installmentCount || 1,
      billingType:    pay.billingType,
    };
  } else if (isMp) {
    const paymentId = body.data?.id;
    if (!paymentId) return res.status(400).json({ error: 'Missing payment id' });

    let payment: {
      status: string; preference_id: string; id: number;
      external_reference?: string; installments?: number;
    };
    try {
      const r = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${MP_TOKEN}` },
      });
      payment = await r.json();
    } catch (err) {
      console.error('[webhook] failed to fetch MP payment', err);
      return res.status(500).json({ error: 'Failed to fetch payment' });
    }

    if (payment.status !== 'approved') {
      return res.status(200).json({ received: true, status: payment.status });
    }

    normalized = {
      gateway:        'mp',
      externalSlotId: payment.preference_id,
      paymentId:      String(payment.id),
      externalRef:    payment.external_reference || '',
      installments:   payment.installments || 1,
    };
  } else {
    // payload desconhecido — ack pra evitar retries infinitos do gateway
    return res.status(200).json({ received: true, ignored: true });
  }

  // Parse booking data from external_reference
  // - MP usa formato JSON canon: {date,time,packageKey,name,email,whatsapp,numBailarinas}
  // - ASAAS usa formato compacto (chaves de 1 letra) por causa do limite de 100 chars
  let meta: { date: string; time: string; packageKey: string; name: string; email: string; whatsapp: string; numBailarinas: number };
  if (normalized.gateway === 'asaas') {
    const d = decodeAsaasRef(normalized.externalRef);
    meta = { ...d, numBailarinas: d.numBailarinas };
  } else {
    try {
      const j = JSON.parse(normalized.externalRef || '{}') as Partial<typeof meta>;
      meta = {
        date: j.date || '', time: j.time || '', packageKey: j.packageKey || '',
        name: j.name || '', email: j.email || '', whatsapp: j.whatsapp || '',
        numBailarinas: Number(j.numBailarinas) || 1,
      };
    } catch {
      console.error('[webhook] invalid external_reference');
      return res.status(400).json({ error: 'Invalid external_reference' });
    }
  }

  const { date, time, packageKey, name, email, whatsapp, numBailarinas } = meta;
  const pkg = PACKAGES[packageKey] || { name: packageKey, duration: 0, price: 0 };

  const [sh, sm] = time.split(':').map(Number);
  const endMin   = sh * 60 + sm + pkg.duration;
  const endTime  = String(Math.floor(endMin / 60)).padStart(2, '0') + ':' + String(endMin % 60).padStart(2, '0');

  // 1. Confirm booking in Sheets
  let bookingId = '';
  try {
    const r = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action:        'confirmBooking',
        stripeSession: normalized.externalSlotId,
        stripePayment: normalized.paymentId,
        gateway:       normalized.gateway,
      }),
    });
    const json = await r.json();
    bookingId = json.bookingId || '';
  } catch (e) {
    console.error('[webhook] confirmBooking error', e);
  }

  // 2. Send confirmation email to client
  const htmlBody = buildBookingEmailHtml({
    name, date, time, endTime,
    packageName: pkg.name, duration: pkg.duration,
    price: pkg.price.toFixed(2).replace('.', ','),
    bookingId,
    numBailarinas,
  }, 'confirmed');
  try {
    await resend.emails.send({
      from:    FROM_EMAIL,
      to:      email,
      subject: `Reserva confirmada — ${pkg.name} · ${date.split('-').reverse().join('/')} às ${time}`,
      html:    htmlBody,
    });
  } catch (e) {
    console.error('[webhook] Resend client error', e);
  }

  // 3. Notify André
  try {
    await resend.emails.send({
      from:    FROM_EMAIL,
      to:      ANDRE_EMAIL,
      subject: `Nova reserva: ${name} — ${pkg.name} ${date.split('-').reverse().join('/')} ${time}`,
      html:    `<p><strong>Nova reserva confirmada</strong><br>
Cliente: ${name}<br>E-mail: ${email}<br>WhatsApp: ${whatsapp}<br>
Data: ${fmtDate(date)}<br>Horário: ${time}–${endTime}<br>
Pacote: ${pkg.name}<br>Nº Bailarinas: ${numBailarinas}<br>Valor: R$ ${pkg.price}<br>
Parcelas: ${normalized.installments}x<br>
${normalized.billingType ? `Método: ${normalized.billingType}<br>` : ''}
Booking ID: ${bookingId}<br>Gateway: ${normalized.gateway.toUpperCase()} · Payment: ${normalized.paymentId}</p>`,
    });
  } catch (e) {
    console.error('[webhook] Resend andre error', e);
  }

  // 4. Notify Mariane
  try {
    const marianeHtml = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
  <tr><td style="background:linear-gradient(135deg,#7a3f8f,#e87060);padding:20px 28px;">
    <h2 style="color:#ffffff;margin:0;font-size:17px;">✅ Pagamento confirmado!</h2>
    <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px;">O cliente concluiu o pagamento do link que você gerou.</p>
  </td></tr>
  <tr><td style="padding:24px 28px;">
    <table width="100%" style="border-collapse:collapse;">
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;width:120px;">Cliente</td>
          <td style="font-weight:600;font-size:13px;">${name}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">E-mail</td>
          <td style="font-size:13px;">${email}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">WhatsApp</td>
          <td style="font-weight:600;font-size:14px;color:#7a3f8f;">${whatsapp || '—'}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">Pacote</td>
          <td style="font-size:13px;">${pkg.name}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">Data</td>
          <td style="font-size:13px;">${fmtDate(date)} às ${time} – ${endTime}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;border-top:1px solid #e5e7eb;">Valor pago</td>
          <td style="font-weight:700;font-size:14px;color:#7a3f8f;border-top:1px solid #e5e7eb;">R$ ${pkg.price.toFixed(2).replace('.', ',')}${normalized.installments > 1 ? ` em ${normalized.installments}x` : ''}</td></tr>
    </table>
    <p style="font-size:12px;color:#9ca3af;margin-top:16px;border-top:1px solid #f0f0f0;padding-top:12px;">
      Booking ID: ${bookingId}
    </p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;

    await resend.emails.send({
      from:    FROM_EMAIL,
      to:      MARIANE_EMAIL,
      subject: `✅ ${name} concluiu o pagamento — ${pkg.name} · ${fmtDate(date)} às ${time}`,
      html:    marianeHtml,
    });
  } catch (e) {
    console.error('[webhook] Resend mariane error', e);
  }

  return res.status(200).json({ received: true });
}
