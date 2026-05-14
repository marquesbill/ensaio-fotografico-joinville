import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';
import { buildBookingEmailHtml, fmtDateBR as fmtDate } from '../lib/emailTemplate';

const MP_TOKEN      = process.env.MERCADOPAGO_ACCESS_TOKEN!;
const SCRIPT_URL    = process.env.SHEETS_SCRIPT_URL!;
const ANDRE_EMAIL   = 'andreffotografia@gmail.com';
const MARIANE_EMAIL = 'mariane.sslourenco@gmail.com';
const FROM_EMAIL    = 'Ensaio Joinville <confirmacao@ensaiofotograficoemjoinville.com>';

const resend = new Resend(process.env.RESEND_API_KEY!);

const PACKAGES: Record<string, { name: string; duration: number; price: number }> = {
  lembranca: { name: 'Lembrança',  duration: 30,  price: 1400 },
  economico: { name: 'Econômico',  duration: 90,  price: 1900 },
  completo:  { name: 'Completo',   duration: 120, price: 2200 },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const body = req.body as {
    type?: string;
    action?: string;
    data?: { id?: string | number };
  };

  if (body.type !== 'payment') {
    return res.status(200).json({ received: true });
  }

  const paymentId = body.data?.id;
  if (!paymentId) return res.status(400).json({ error: 'Missing payment id' });

  // Fetch full payment details from MP
  let payment: {
    status: string;
    preference_id: string;
    id: number;
    external_reference?: string;
    installments?: number;
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

  // Parse booking data from external_reference
  let meta: { date: string; time: string; packageKey: string; name: string; email: string; whatsapp: string; numBailarinas?: number };
  try {
    meta = JSON.parse(payment.external_reference || '{}');
  } catch {
    console.error('[webhook] invalid external_reference');
    return res.status(400).json({ error: 'Invalid external_reference' });
  }

  const { date, time, packageKey, name, email, whatsapp } = meta;
  const numBailarinas = Number(meta.numBailarinas) || 1;
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
        stripeSession: payment.preference_id,
        stripePayment: String(payment.id),
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
Parcelas: ${payment.installments || 1}x<br>
Booking ID: ${bookingId}<br>MP Payment: ${payment.id}</p>`,
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
          <td style="font-weight:700;font-size:14px;color:#7a3f8f;border-top:1px solid #e5e7eb;">R$ ${pkg.price.toFixed(2).replace('.', ',')}${payment.installments && payment.installments > 1 ? ` em ${payment.installments}x` : ''}</td></tr>
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
