import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';

const EMAIL_BG_URL  = 'https://www.ensaiofotograficoemjoinville.com/email-bg3.jpg';
const SCRIPT_URL    = process.env.SHEETS_SCRIPT_URL!;
const MP_TOKEN      = process.env.MERCADOPAGO_ACCESS_TOKEN!;
const GMAIL_USER    = process.env.GMAIL_USER!;
const GMAIL_PASS    = process.env.GMAIL_APP_PASSWORD!;
const ANDRE_EMAIL   = 'andreffotografia@gmail.com';
const MARIANE_EMAIL = 'mariane.sslourenco@gmail.com';

const transporter = nodemailer.createTransport({
  host:   'smtp.gmail.com',
  port:   587,
  secure: false,
  auth: { user: GMAIL_USER, pass: GMAIL_PASS },
});

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
  numBailarinas: number;
}) {
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><style>
  body{font-family:Georgia,serif;background:#f5f0fa;margin:0;padding:0}
  .header{background:linear-gradient(135deg,#7a3f8f,#e87060);padding:32px 32px 24px;text-align:center}
  .header h1{color:#fff;font-size:22px;margin:0 0 4px;letter-spacing:.5px}
  .header p{color:rgba(255,255,255,.85);font-size:13px;margin:0}
  .body{padding:32px}
  .tag{display:inline-block;background:#7a3f8f;color:#fff;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;border-radius:20px;padding:4px 12px;margin-bottom:16px}
  h2{font-size:20px;color:#352D39;margin:0 0 20px}
  .card{background:rgba(249,246,252,0.88);border:1px solid #e8d8f0;border-radius:12px;padding:20px;margin-bottom:20px}
  .row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #eee;font-size:14px}
  .row:last-child{border:none}
  .label{color:#888}
  .value{font-weight:bold;color:#352D39}
  .id{font-size:11px;color:#aaa;text-align:center;margin-top:8px;font-family:monospace}
  .footer{background:rgba(249,246,252,0.88);padding:20px 32px;text-align:center;font-size:12px;color:#aaa;border-top:1px solid #eee}
  .footer a{color:#7a3f8f}
</style></head>
<body>
<div style="max-width:560px;margin:32px auto;background-color:#fff;background-image:url('${EMAIL_BG_URL}');background-size:cover;background-position:center;background-repeat:no-repeat;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10)"
     background="${EMAIL_BG_URL}">
  <div class="header">
    <h1>Ensaio Fotográfico em Joinville</h1>
    <p>André Ferreira · @affotografia</p>
  </div>
  <div class="body">
    <span class="tag">Reserva Confirmada</span>
    <h2>Olá, ${data.name}!</h2>
    <p style="color:#555;font-size:14px;line-height:1.6">Seu pagamento foi aprovado e seu horário está garantido. Anote os detalhes abaixo.</p>
    <div class="card">
      <div class="row"><span class="label">Data:</span><span class="value">${fmtDate(data.date)}</span></div>
      <div class="row"><span class="label">Horário:</span><span class="value">${data.time} – ${data.endTime}</span></div>
      <div class="row"><span class="label">Pacote:</span><span class="value">${data.packageName} (${data.duration}min)</span></div>
      <div class="row"><span class="label">Nº Bailarinas:</span><span class="value">${data.numBailarinas}</span></div>
      <div class="row"><span class="label">Local:</span><span class="value"><a href="https://www.google.com/maps/search/Hotel+Le+Village+Joinville+SC" style="color:#7a3f8f;text-decoration:none;font-weight:bold;">Hotel Le Village · Sala Esmeralda · Joinville/SC</a></span></div>
      <div class="row"><span class="label">Valor pago:</span><span class="value">R$ ${data.price}</span></div>
    </div>
    <p style="font-size:13px;color:#666;line-height:1.6">Em caso de dúvidas ou necessidade de remarcação, entre em contato pelo <a href="https://wa.me/5511519606272?text=Ol%C3%A1%2C+vim+pelo+email+de+confirma%C3%A7%C3%A3o+do+meu+ensa%C3%ADo+fotogr%C3%A1fico+em+Joinville%21" style="color:#128C7E;font-weight:bold;text-decoration:none;">WhatsApp (11) 5196-0627</a>.</p>
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
  const htmlBody = emailHtml({
    name, date, time, endTime,
    packageName: pkg.name, duration: pkg.duration,
    price: pkg.price.toFixed(2).replace('.', ','),
    bookingId,
    numBailarinas,
  });
  try {
    await transporter.sendMail({
      from:    `"Ensaio Joinville" <${GMAIL_USER}>`,
      to:      email,
      subject: `Reserva confirmada — ${pkg.name} · ${date.split('-').reverse().join('/')} às ${time}`,
      html:    htmlBody,
    });
  } catch (e) {
    console.error('[webhook] sendMail client error', e);
  }

  // 3. Notify André
  try {
    await transporter.sendMail({
      from:    `"Ensaio Joinville" <${GMAIL_USER}>`,
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
    console.error('[webhook] sendMail andre error', e);
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

    await transporter.sendMail({
      from:    `"Ensaio Joinville" <${GMAIL_USER}>`,
      to:      MARIANE_EMAIL,
      subject: `✅ ${name} concluiu o pagamento — ${pkg.name} · ${fmtDate(date)} às ${time}`,
      html:    marianeHtml,
    });
  } catch (e) {
    console.error('[webhook] sendMail mariane error', e);
  }

  return res.status(200).json({ received: true });
}
