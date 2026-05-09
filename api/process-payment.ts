import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';

const MP_TOKEN    = process.env.MERCADOPAGO_ACCESS_TOKEN!;
const SCRIPT_URL  = process.env.SHEETS_SCRIPT_URL!;
const SITE_URL    = process.env.SITE_URL || 'https://www.ensaiofotograficoemjoinville.com';
const resend      = new Resend(process.env.RESEND_API_KEY!);
const ANDRE_EMAIL = 'andreffotografia@gmail.com';

const PACKAGES: Record<string, { name: string; duration: number; price: number }> = {
  lembranca: { name: 'Lembrança',  duration: 30,  price: 1400 },
  economico: { name: 'Econômico',  duration: 90,  price: 1900 },
  completo:  { name: 'Completo',   duration: 120, price: 2200 },
};

function fmtDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function emailHtml(data: {
  name: string; date: string; time: string; endTime: string;
  packageName: string; duration: number; price: string; bookingId: string;
}) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><style>
  body{font-family:Georgia,serif;background:#f5f0fa;margin:0;padding:0}
  .wrap{max-width:560px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10)}
  .header{background:linear-gradient(135deg,#7a3f8f,#e87060);padding:32px 32px 24px;text-align:center}
  .header h1{color:#fff;font-size:22px;margin:0 0 4px;letter-spacing:.5px}
  .header p{color:rgba(255,255,255,.85);font-size:13px;margin:0}
  .body{padding:32px}
  .tag{display:inline-block;background:#7a3f8f;color:#fff;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;border-radius:20px;padding:4px 12px;margin-bottom:16px}
  h2{font-size:20px;color:#352D39;margin:0 0 20px}
  .card{background:#f9f6fc;border:1px solid #e8d8f0;border-radius:12px;padding:20px;margin-bottom:20px}
  .row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee;font-size:14px}
  .row:last-child{border:none}
  .label{color:#888}
  .value{font-weight:bold;color:#352D39}
  .id{font-size:11px;color:#aaa;text-align:center;margin-top:8px;font-family:monospace}
  .footer{background:#f9f6fc;padding:20px 32px;text-align:center;font-size:12px;color:#aaa;border-top:1px solid #eee}
  .footer a{color:#7a3f8f}
</style></head>
<body>
<div class="wrap">
  <div class="header">
    <h1>Ensaio Fotográfico em Joinville</h1>
    <p>André Ferreira · @affotografia</p>
  </div>
  <div class="body">
    <span class="tag">Reserva Confirmada</span>
    <h2>Olá, ${data.name}!</h2>
    <p style="color:#555;font-size:14px;line-height:1.6">Seu pagamento foi aprovado e seu horário está garantido. Anote os detalhes abaixo.</p>
    <div class="card">
      <div class="row"><span class="label">Data</span><span class="value">${fmtDate(data.date)}</span></div>
      <div class="row"><span class="label">Horário</span><span class="value">${data.time} – ${data.endTime}</span></div>
      <div class="row"><span class="label">Pacote</span><span class="value">${data.packageName} (${data.duration}min)</span></div>
      <div class="row"><span class="label">Local</span><span class="value">Hotel Le Village · Sala Esmeralda · Joinville/SC</span></div>
      <div class="row"><span class="label">Valor pago</span><span class="value">R$ ${data.price}</span></div>
    </div>
    <p style="font-size:13px;color:#666;line-height:1.6">Em caso de dúvidas ou necessidade de remarcação, entre em contato pelo WhatsApp <strong>(11) 5196-0627</strong>.</p>
    <p class="id">Código da reserva: ${data.bookingId}</p>
  </div>
  <div class="footer">
    © 2026 André Ferreira Fotografia · Joinville, SC<br>
    <a href="https://www.instagram.com/affotografia">@affotografia</a>
  </div>
</div>
</body></html>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    formData,          // tokenized card data from Brick
    preferenceId,
    date, time, packageKey, name, email, whatsapp,
  } = req.body as {
    formData: {
      token?: string;
      installments?: number;
      payment_method_id?: string;
      issuer_id?: string | number;
      payer?: { email?: string; identification?: { type: string; number: string } };
      transaction_amount?: number;
      payment_type?: string;
    };
    preferenceId: string;
    date: string; time: string; packageKey: string;
    name: string; email: string; whatsapp: string;
  };

  const pkg = PACKAGES[packageKey];
  if (!pkg) return res.status(400).json({ error: 'Pacote inválido' });

  // Build payment payload
  const paymentBody: Record<string, unknown> = {
    transaction_amount: pkg.price,
    installments:       formData.installments ?? 1,
    payment_method_id:  formData.payment_method_id,
    payer: {
      email: email,
      ...(formData.payer?.identification ? { identification: formData.payer.identification } : {}),
    },
    external_reference: JSON.stringify({ date, time, packageKey, name, email, whatsapp }),
    notification_url:   `${SITE_URL}/api/webhook`,
    description: `Ensaio Fotográfico em Joinville — Pacote ${pkg.name}`,
  };

  // Card payment needs token + issuer_id
  if (formData.token) {
    paymentBody.token    = formData.token;
    paymentBody.issuer_id = formData.issuer_id;
  }

  let payment: { id: number; status: string; status_detail?: string; point_of_interaction?: unknown };
  try {
    const r = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${MP_TOKEN}`,
        'X-Idempotency-Key': preferenceId,
      },
      body: JSON.stringify(paymentBody),
    });
    payment = await r.json() as typeof payment;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[process-payment] MP error', msg);
    return res.status(500).json({ error: msg });
  }

  if (payment.status === 'rejected') {
    return res.status(402).json({ error: 'Pagamento recusado', detail: payment.status_detail });
  }

  // Compute end time
  const [sh, sm] = time.split(':').map(Number);
  const endMin   = sh * 60 + sm + pkg.duration;
  const endTime  = String(Math.floor(endMin / 60)).padStart(2, '0') + ':' + String(endMin % 60).padStart(2, '0');

  // For approved card payments → confirm immediately
  // For pending (PIX/boleto) → webhook will confirm
  let bookingId = '';
  if (payment.status === 'approved') {
    try {
      const r = await fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action:        'confirmBooking',
          stripeSession: preferenceId,
          stripePayment: String(payment.id),
        }),
      });
      const json = await r.json();
      bookingId = json.bookingId || '';
    } catch (e) {
      console.error('[process-payment] confirmBooking error', e);
    }

    // Send emails
    const htmlBody = emailHtml({
      name, date, time, endTime,
      packageName: pkg.name, duration: pkg.duration,
      price: pkg.price.toFixed(2).replace('.', ','),
      bookingId,
    });
    await Promise.allSettled([
      resend.emails.send({
        from:    'Ensaio Joinville <confirmacao@ensaiofotograficoemjoinville.com>',
        to:      email,
        subject: `Reserva confirmada — ${pkg.name} · ${fmtDate(date)} às ${time}`,
        html:    htmlBody,
      }),
      resend.emails.send({
        from:    'Ensaio Joinville <confirmacao@ensaiofotograficoemjoinville.com>',
        to:      ANDRE_EMAIL,
        subject: `Nova reserva: ${name} — ${pkg.name} ${fmtDate(date)} ${time}`,
        html:    `<p><strong>Nova reserva confirmada</strong><br>
Cliente: ${name}<br>E-mail: ${email}<br>WhatsApp: ${whatsapp}<br>
Data: ${fmtDate(date)}<br>Horário: ${time}–${endTime}<br>
Pacote: ${pkg.name}<br>Valor: R$ ${pkg.price}<br>
Parcelas: ${formData.installments ?? 1}x<br>
Booking ID: ${bookingId}<br>MP Payment: ${payment.id}</p>`,
      }),
    ]);
  }

  return res.status(200).json({
    status:               payment.status,
    paymentId:            payment.id,
    point_of_interaction: payment.point_of_interaction, // PIX QR code data
    bookingId,
  });
}
