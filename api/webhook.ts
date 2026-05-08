import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { Resend } from 'resend';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const resend  = new Resend(process.env.RESEND_API_KEY!);
const SCRIPT_URL  = process.env.SHEETS_SCRIPT_URL!;
const ANDRE_EMAIL = 'andreffotografia@gmail.com';

// Vercel disables bodyParser for webhooks — we need the raw body
export const config = { api: { bodyParser: false } };

async function getRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(typeof c === 'string' ? Buffer.from(c) : c));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function fmtDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function emailHtml(data: {
  name: string; date: string; time: string; endTime: string;
  packageName: string; duration: number; price: string; bookingId: string;
}) {
  return `
<!DOCTYPE html>
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
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig     = req.headers['stripe-signature'] as string;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[webhook] signature error:', msg);
    return res.status(400).send(`Webhook Error: ${msg}`);
  }

  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true });
  }

  const session  = event.data.object as Stripe.Checkout.Session;
  const meta     = session.metadata!;
  const { date, time, packageKey, name, email, whatsapp } = meta;

  const PACKAGES: Record<string, { name: string; duration: number; price: number }> = {
    lembranca: { name: 'Lembrança',  duration: 30,  price: 1400 },
    economico: { name: 'Econômico',  duration: 90,  price: 1900 },
    completo:  { name: 'Completo',   duration: 120, price: 2200 },
  };
  const pkg = PACKAGES[packageKey] || { name: packageKey, duration: 0, price: 0 };

  // Compute end time
  const [sh, sm] = time.split(':').map(Number);
  const endMin = sh * 60 + sm + pkg.duration;
  const endTime = String(Math.floor(endMin / 60)).padStart(2, '0') + ':' + String(endMin % 60).padStart(2, '0');

  // 1. Confirm booking in Sheets
  let bookingId = '';
  try {
    const r = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'confirmBooking',
        stripeSession: session.id,
        stripePayment: (session.payment_intent as string) || '',
      }),
    });
    const json = await r.json();
    bookingId = json.bookingId || '';
  } catch (e) {
    console.error('[webhook] confirmBooking error', e);
  }

  // 2. Send confirmation email to client
  const htmlBody = emailHtml({ name, date, time, endTime, packageName: pkg.name, duration: pkg.duration, price: pkg.price.toFixed(2).replace('.', ','), bookingId });
  try {
    await resend.emails.send({
      from: 'Ensaio Joinville <confirmacao@ensaiofotograficoemjoinville.com>',
      to:   email,
      subject: `Reserva confirmada — ${pkg.name} · ${date.split('-').reverse().join('/')} às ${time}`,
      html: htmlBody,
    });
  } catch (e) {
    console.error('[webhook] resend client error', e);
  }

  // 3. Notify André
  try {
    await resend.emails.send({
      from: 'Ensaio Joinville <confirmacao@ensaiofotograficoemjoinville.com>',
      to:   ANDRE_EMAIL,
      subject: `Nova reserva: ${name} — ${pkg.name} ${date.split('-').reverse().join('/')} ${time}`,
      html: `<p><strong>Nova reserva confirmada</strong><br>
Cliente: ${name}<br>E-mail: ${email}<br>WhatsApp: ${whatsapp}<br>
Data: ${fmtDate(date)}<br>Horário: ${time}–${endTime}<br>
Pacote: ${pkg.name}<br>Valor: R$ ${pkg.price}<br>
Booking ID: ${bookingId}<br>Stripe Session: ${session.id}</p>`,
    });
  } catch (e) {
    console.error('[webhook] resend andre error', e);
  }

  return res.status(200).json({ received: true });
}
