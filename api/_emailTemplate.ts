// Template de email compartilhado entre todos os endpoints admin
// (admin-confirm, admin-create-booking, admin-reschedule, admin-cancel)
// e o webhook. Editorial, com hero image e tipografia serifada.

const HERO_IMG_URL = 'https://www.ensaiofotograficoemjoinville.com/email-hero.jpg';

const MONTHS_PT = ['janeiro','fevereiro','março','abril','maio','junho',
                   'julho','agosto','setembro','outubro','novembro','dezembro'];
const DAYS_PT   = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira',
                   'Quinta-feira','Sexta-feira','Sábado'];

export function fmtDateBR(dateStr: string) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

export function fmtDateLong(dateStr: string) {
  // "2026-08-01" → "01 de agosto de 2026 · Sábado"
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return `${String(d).padStart(2, '0')} de ${MONTHS_PT[m - 1]} de ${y} · ${DAYS_PT[dt.getUTCDay()]}`;
}

export interface BookingEmailData {
  name:          string;
  date:          string;        // "2026-08-01"
  time:          string;        // "15:30"
  endTime:       string;        // "17:30"
  packageName:   string;        // "Completo"
  duration:      number;        // 120
  price:         string;        // pre-formatted "2.200,00"
  bookingId:     string;
  numBailarinas: number;
}

export type EmailVariant = 'confirmed' | 'rescheduled' | 'cancelled';

const VARIANT_CONFIG: Record<EmailVariant, { tag: string; intro: string; valorLabel: string; tagColor: string }> = {
  confirmed: {
    tag:        'Reserva Confirmada',
    intro:      'Recebemos sua reserva. Os detalhes do seu ensaio estão registrados abaixo — guarde este e-mail para referência.',
    valorLabel: 'Valor',
    tagColor:   '#7a3f8f',
  },
  rescheduled: {
    tag:        'Reserva Remarcada',
    intro:      'Seu ensaio foi remarcado. Confira abaixo o novo horário e demais detalhes.',
    valorLabel: 'Valor',
    tagColor:   '#7a3f8f',
  },
  cancelled: {
    tag:        'Reserva Cancelada',
    intro:      'Sua reserva foi cancelada. Os detalhes do ensaio que foi cancelado estão registrados abaixo. Em caso de dúvida, fale conosco.',
    valorLabel: 'Valor',
    tagColor:   '#b91c1c',
  },
};

export function buildBookingEmailHtml(data: BookingEmailData, variant: EmailVariant): string {
  const cfg       = VARIANT_CONFIG[variant];
  const firstName = String(data.name || '').trim().split(/\s+/)[0] || data.name;
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${cfg.tag}</title>
</head>
<body style="margin:0;padding:0;background:#f5f0fa;font-family:Georgia,'Cormorant Garamond','Times New Roman',serif;color:#1a1a1a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f0fa;padding:32px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:6px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
      <tr>
        <td style="line-height:0;">
          <img src="${HERO_IMG_URL}" alt="" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;">
        </td>
      </tr>
      <tr>
        <td style="padding:36px 40px 0;text-align:center;">
          <span style="display:inline-block;font-family:Georgia,'Times New Roman',serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${cfg.tagColor};border:1px solid #e8d8f0;border-radius:30px;padding:6px 16px;">${cfg.tag}</span>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 40px 4px;text-align:center;">
          <p style="margin:0;font-family:Georgia,'Cormorant Garamond',serif;font-size:30px;line-height:1.2;color:#1a1a1a;font-weight:400;font-style:italic;">Olá, <strong style="font-weight:600;">${firstName}</strong>.</p>
        </td>
      </tr>
      <tr>
        <td style="padding:18px 56px 32px;text-align:center;">
          <p style="margin:0;font-family:Georgia,serif;font-size:14px;line-height:1.65;color:#555;">${cfg.intro}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px 8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #eee;">
            <tr><td style="padding:18px 0;border-bottom:1px solid #eee;">
              <p style="margin:0 0 4px;font-family:Georgia,serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">Data</p>
              <p style="margin:0;font-family:Georgia,serif;font-size:16px;color:#1a1a1a;">${fmtDateLong(data.date)}</p>
            </td></tr>
            <tr><td style="padding:18px 0;border-bottom:1px solid #eee;">
              <p style="margin:0 0 4px;font-family:Georgia,serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">Horário</p>
              <p style="margin:0;font-family:Georgia,serif;font-size:16px;color:#1a1a1a;">${data.time} — ${data.endTime}</p>
            </td></tr>
            <tr><td style="padding:18px 0;border-bottom:1px solid #eee;">
              <p style="margin:0 0 4px;font-family:Georgia,serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">Pacote</p>
              <p style="margin:0;font-family:Georgia,serif;font-size:16px;color:#1a1a1a;">${data.packageName} · ${data.duration} minutos</p>
            </td></tr>
            <tr><td style="padding:18px 0;border-bottom:1px solid #eee;">
              <p style="margin:0 0 4px;font-family:Georgia,serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">Grupo</p>
              <p style="margin:0;font-family:Georgia,serif;font-size:16px;color:#1a1a1a;">${data.numBailarinas} ${data.numBailarinas === 1 ? 'bailarina' : 'bailarinas'}</p>
            </td></tr>
            <tr><td style="padding:18px 0;border-bottom:1px solid #eee;">
              <p style="margin:0 0 4px;font-family:Georgia,serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">Local</p>
              <p style="margin:0;font-family:Georgia,serif;font-size:16px;color:#1a1a1a;"><a href="https://www.google.com/maps/search/Hotel+Le+Village+Joinville+SC" style="color:#1a1a1a;text-decoration:none;">Hotel Le Village</a></p>
              <p style="margin:2px 0 0;font-family:Georgia,serif;font-size:13px;color:#777;">Sala Esmeralda · Joinville · SC</p>
            </td></tr>
            <tr><td style="padding:18px 0;">
              <p style="margin:0 0 4px;font-family:Georgia,serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">${cfg.valorLabel}</p>
              <p style="margin:0;font-family:Georgia,serif;font-size:18px;color:#7a3f8f;font-weight:600;">R$ ${data.price}</p>
            </td></tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:32px 40px 24px;text-align:center;border-top:1px solid #eee;">
          <p style="margin:0;font-family:Georgia,serif;font-size:13px;line-height:1.6;color:#666;">Em caso de dúvida ou necessidade de remarcação, fale conosco pelo</p>
          <p style="margin:6px 0 0;font-family:Georgia,serif;font-size:14px;line-height:1.6;"><a href="https://wa.me/5511519606272" style="color:#128C7E;text-decoration:none;font-weight:600;white-space:nowrap;">WhatsApp (11) 5196-0627</a></p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px 24px;text-align:center;">
          <p style="margin:0;font-family:Georgia,serif;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#bbb;">Código da reserva · <span style="color:#777;font-family:monospace;letter-spacing:1px;">${data.bookingId}</span></p>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 40px 28px;text-align:center;background:#fafafa;border-top:1px solid #eee;">
          <p style="margin:0;font-family:Georgia,serif;font-size:12px;color:#999;">© 2026 André Ferreira Fotografia</p>
          <p style="margin:4px 0 0;font-family:Georgia,serif;font-size:12px;"><a href="https://www.instagram.com/affotografia" style="color:#7a3f8f;text-decoration:none;">@affotografia</a></p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}
