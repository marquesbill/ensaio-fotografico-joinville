import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';

/* Disparo do e-mail "Guia de Preparação" (corpo HTML + PDF anexo).
 * Endpoint utilitário, protegido por GUIA_SECRET (header x-guia-secret).
 * O anexo usa `path`: o Resend baixa o PDF direto do site — nada de base64 aqui.
 * ponytail: one-off do envio de jul/2026; remover depois da campanha. */

const FROM_EMAIL = 'Ensaio Joinville <confirmacao@ensaiofotograficoemjoinville.com>';
const SITE = 'https://www.ensaiofotograficoemjoinville.com';
const PDF_URL = `${SITE}/guia-preparacao-ensaio.pdf`;
const PDF_FILENAME = 'Guia de Preparação para o Ensaio.pdf';
const SUBJECT = 'Seu guia de preparação — Festival de Dança de Joinville ✦';
const MAX_PER_CALL = 15; // 15 × (550ms throttle + chamada) cabe folgado nos 60s

const resend = new Resend(process.env.RESEND_API_KEY);

const HTML = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<title>Seu guia de preparação — Festival de Dança de Joinville</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style>
  /* Empilha as duas colunas do índice no mobile; ignorado por clientes sem @media (fica 2 colunas). */
  @media only screen and (max-width:620px) {
    .card { width:100% !important; }
    .pad { padding-left:26px !important; padding-right:26px !important; }
    .col { display:block !important; width:100% !important; }
    .h1 { font-size:27px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#e2dbd3;-webkit-font-smoothing:antialiased;">
<div style="display:none;font-size:1px;color:#e2dbd3;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">Tudo para brilhar em frente à câmera. Leia com calma, alguns dias antes do ensaio.&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e2dbd3;">
<tr><td align="center" style="padding:36px 12px 48px;">

<table role="presentation" class="card" width="620" cellpadding="0" cellspacing="0" border="0" style="width:620px;max-width:620px;background:#f8f5f2;">

  <!-- HERO (imagem única — o composto original não sobrevive a e-mail) -->
  <tr><td style="line-height:0;font-size:0;background:#161c29;">
    <img src="https://www.ensaiofotograficoemjoinville.com/guia-hero.jpg" width="620" alt="Guia de Preparação — Ensaio Fotográfico em Joinville · tudo para brilhar em frente à câmera" style="display:block;width:100%;max-width:620px;height:auto;border:0;outline:none;text-decoration:none;" />
  </td></tr>

  <!-- BODY -->
  <tr><td class="pad" style="padding:52px 52px 0;background:#f8f5f2;">
    <p class="h1" style="margin:0;font-family:'Playfair Display',Georgia,'Times New Roman',serif;font-weight:500;font-size:34px;line-height:1.2;color:#252833;">O seu ensaio começa <em style="font-style:italic;color:#92485e;">antes</em> do ensaio.</p>
    <p style="margin:24px 0 0;font-family:Lato,-apple-system,'Helvetica Neue',Arial,sans-serif;font-size:16px;line-height:1.78;color:#3a3d47;">Para que cada minuto em frente à câmera no <strong>Festival de Dança de Joinville</strong> seja usado no que realmente importa — <em style="color:#92485e;">fazer fotos lindas</em> — preparei um guia com tudo o que a bailarina precisa saber para aproveitar o ensaio ao máximo.</p>
    <p style="margin:18px 0 0;font-family:Lato,-apple-system,'Helvetica Neue',Arial,sans-serif;font-size:16px;line-height:1.78;color:#3a3d47;">Ele vai <strong>em anexo, em PDF</strong>. Leiam com calma alguns dias antes — a bailarina e quem a acompanha, juntas. É rapidinho e faz toda a diferença.</p>
  </td></tr>

  <!-- ANEXO -->
  <tr><td class="pad" style="padding:36px 52px 0;background:#f8f5f2;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid #e4dcd8;">
      <tr><td colspan="3" style="line-height:0;font-size:0;height:2px;background:#a55894;">&nbsp;</td></tr>
      <tr>
        <td width="74" valign="middle" style="padding:24px 0 24px 24px;">
          <table role="presentation" width="52" cellpadding="0" cellspacing="0" border="0" style="width:52px;height:66px;background:#ffffff;border:1px solid #ddd3cd;">
            <tr><td align="center" valign="bottom" style="height:66px;padding:0 0 11px;font-family:Lato,Arial,sans-serif;font-size:10px;letter-spacing:2px;color:#92485e;font-weight:bold;">PDF</td></tr>
          </table>
        </td>
        <td valign="middle" style="padding:24px 12px;">
          <p style="margin:0;font-family:'Playfair Display',Georgia,serif;font-size:20px;color:#252833;">Guia de Preparação</p>
          <p style="margin:4px 0 0;font-family:Lato,Arial,sans-serif;font-size:13px;color:#7b7e8a;">PDF · 10 páginas · leitura de 5 minutos</p>
        </td>
        <td valign="middle" align="right" style="padding:24px 24px 24px 0;">
          <span style="display:inline-block;font-family:Lato,Arial,sans-serif;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#92485e;border:1px solid #d9a9b3;padding:6px 11px;font-weight:bold;white-space:nowrap;">Em anexo</span>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- NO GUIA, VOCÊ ENCONTRA -->
  <tr><td class="pad" style="padding:44px 52px 0;background:#f8f5f2;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="40" style="line-height:0;font-size:0;"><table role="presentation" width="40" cellpadding="0" cellspacing="0" border="0"><tr><td style="height:2px;background:#a55894;line-height:0;font-size:0;">&nbsp;</td></tr></table></td>
      <td style="padding-left:14px;font-family:Lato,Arial,sans-serif;font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#92485e;font-weight:bold;">No guia, você encontra</td>
    </tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;">
      <tr>
        <td class="col" width="50%" valign="top" style="padding:15px 19px 15px 0;border-top:1px solid #e4dcd8;">
          <p style="margin:0;font-family:'Playfair Display',Georgia,serif;font-size:17px;color:#252833;">Na véspera</p>
          <p style="margin:3px 0 0;font-family:Lato,Arial,sans-serif;font-size:12px;color:#7b7e8a;">cuidados que aparecem na foto</p>
        </td>
        <td class="col" width="50%" valign="top" style="padding:15px 0 15px 19px;border-top:1px solid #e4dcd8;">
          <p style="margin:0;font-family:'Playfair Display',Georgia,serif;font-size:17px;color:#252833;">Maquiagem &amp; coque</p>
          <p style="margin:3px 0 0;font-family:Lato,Arial,sans-serif;font-size:12px;color:#7b7e8a;">o tom certo e os retoques</p>
        </td>
      </tr>
      <tr>
        <td class="col" width="50%" valign="top" style="padding:15px 19px 15px 0;border-top:1px solid #e4dcd8;">
          <p style="margin:0;font-family:'Playfair Display',Georgia,serif;font-size:17px;color:#252833;">Roupas &amp; figurinos</p>
          <p style="margin:3px 0 0;font-family:Lato,Arial,sans-serif;font-size:12px;color:#7b7e8a;">os três looks prediletos</p>
        </td>
        <td class="col" width="50%" valign="top" style="padding:15px 0 15px 19px;border-top:1px solid #e4dcd8;">
          <p style="margin:0;font-family:'Playfair Display',Georgia,serif;font-size:17px;color:#252833;">Sapatilhas &amp; acessórios</p>
          <p style="margin:3px 0 0;font-family:Lato,Arial,sans-serif;font-size:12px;color:#7b7e8a;">nos pés e nos detalhes</p>
        </td>
      </tr>
      <tr>
        <td class="col" width="50%" valign="top" style="padding:15px 19px 15px 0;border-top:1px solid #e4dcd8;">
          <p style="margin:0;font-family:'Playfair Display',Georgia,serif;font-size:17px;color:#252833;">Poses &amp; movimentos</p>
          <p style="margin:3px 0 0;font-family:Lato,Arial,sans-serif;font-size:12px;color:#7b7e8a;">referências por nível</p>
        </td>
        <td class="col" width="50%" valign="top" style="padding:15px 0 15px 19px;border-top:1px solid #e4dcd8;">
          <p style="margin:0;font-family:'Playfair Display',Georgia,serif;font-size:17px;color:#252833;">Checklist do dia</p>
          <p style="margin:3px 0 0;font-family:Lato,Arial,sans-serif;font-size:12px;color:#7b7e8a;">tudo na bolsa, sem esquecer</p>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- ANTES DE SAIR DE CASA + LOCAL -->
  <tr><td class="pad" style="padding:42px 52px 0;background:#f8f5f2;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#22293c;">
      <tr><td style="line-height:0;font-size:0;height:2px;background:#a55894;">&nbsp;</td></tr>
      <tr><td style="padding:32px 34px;">
        <p style="margin:0;font-family:Lato,Arial,sans-serif;font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#d16d7f;font-weight:bold;">Antes de sair de casa</p>
        <p style="margin:14px 0 0;font-family:Lato,Arial,sans-serif;font-size:15px;line-height:1.72;color:#e8e9ed;">Chegue <strong style="color:#ffffff;">10 a 15 minutos antes</strong> do horário reservado, já com o coque e a maquiagem prontos. Assim sobra tempo para alongar, respirar e fotografar com calma.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;">
          <tr><td style="padding-top:18px;border-top:1px solid #3a4155;font-family:Lato,Arial,sans-serif;font-size:14px;line-height:1.62;color:#d6d8df;"><strong style="color:#ffffff;">Hotel Le Village</strong> · Sala Esmeralda<br />Av. Dr. Albano Schulz, 815 — Centro · Joinville/SC</td></tr>
        </table>
        <p style="margin:14px 0 0;"><a href="https://maps.app.goo.gl/4kd63qtVzoxj8ZhH7" style="font-family:Lato,Arial,sans-serif;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#d16d7f;font-weight:bold;text-decoration:none;border-bottom:1px solid #d16d7f;padding-bottom:3px;">Abrir no mapa &#10230;</a></p>
      </td></tr>
    </table>
  </td></tr>

  <!-- ASSINATURA -->
  <tr><td class="pad" style="padding:44px 52px 0;background:#f8f5f2;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="padding-top:34px;border-top:1px solid #e4dcd8;">
        <p style="margin:0;font-family:'Playfair Display',Georgia,serif;font-style:italic;font-size:22px;line-height:1.5;color:#252833;">Qualquer dúvida, é só me chamar. Até o ensaio!</p>
        <p style="margin:12px 0 0;font-family:Lato,Arial,sans-serif;font-size:14px;color:#7b7e8a;">André Ferreira · <a href="https://instagram.com/affotografia" style="color:#92485e;text-decoration:none;">@affotografia</a></p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:26px;">
          <tr><td style="background:#161c29;">
            <a href="https://wa.me/551151960627" style="display:inline-block;padding:16px 28px;font-family:Lato,Arial,sans-serif;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;color:#ffffff;text-decoration:none;">Falar no WhatsApp <span style="color:#d16d7f;">&#10230;</span></a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="height:46px;line-height:46px;font-size:0;background:#f8f5f2;">&nbsp;</td></tr>

  <!-- FOOTER -->
  <tr><td align="center" style="background:#12151f;padding:42px 44px 46px;">
    <img src="https://www.ensaiofotograficoemjoinville.com/guia-footer-logo.jpg" width="196" alt="Festival de Dança de Joinville" style="display:block;width:196px;max-width:196px;height:auto;border:0;outline:none;" />
    <p style="margin:20px 0 0;font-family:Lato,Arial,sans-serif;font-size:13px;line-height:1.75;color:#b9bcc6;">André Ferreira Fotografia · <a href="https://instagram.com/affotografia" style="color:#b9bcc6;text-decoration:none;">@affotografia</a><br />WhatsApp (11) 5196-0627</p>
    <p style="margin:14px 0 0;font-family:Lato,Arial,sans-serif;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#70737d;">© 2026 · Ensaio no Festival de Dança de Joinville</p>
  </td></tr>

</table>

<table role="presentation" class="card" width="620" cellpadding="0" cellspacing="0" border="0" style="width:620px;max-width:620px;">
  <tr><td align="center" style="padding:18px 12px 0;font-family:Lato,Arial,sans-serif;font-size:11px;line-height:1.6;color:#a79e95;">Você recebeu este e-mail porque tem um ensaio fotográfico reservado conosco.</td></tr>
</table>

</td></tr>
</table>
</body>
</html>
`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const secret = process.env.GUIA_SECRET;
  if (!secret) return res.status(500).json({ error: 'GUIA_SECRET não configurado' });
  if (req.headers['x-guia-secret'] !== secret) return res.status(401).json({ error: 'Não autorizado' });

  const { emails, subjectPrefix } = (req.body ?? {}) as { emails?: string[]; subjectPrefix?: string };
  if (!Array.isArray(emails) || emails.length === 0) return res.status(400).json({ error: 'emails: string[] é obrigatório' });
  if (emails.length > MAX_PER_CALL) return res.status(400).json({ error: `máximo ${MAX_PER_CALL} por chamada — envie em lotes` });

  const results: Array<{ email: string; ok: boolean; id?: string; error?: string }> = [];
  for (const to of emails) {
    if (typeof to !== 'string' || !to.includes('@')) { results.push({ email: String(to), ok: false, error: 'e-mail inválido' }); continue; }
    try {
      const { data, error } = await resend.emails.send({
        from: FROM_EMAIL,
        to,
        subject: (subjectPrefix ?? '') + SUBJECT,
        html: HTML,
        attachments: [{ filename: PDF_FILENAME, path: PDF_URL }],
      });
      if (error != null) results.push({ email: to, ok: false, error: JSON.stringify(error) });
      else results.push({ email: to, ok: true, id: data?.id });
    } catch (e) {
      results.push({ email: to, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
    await new Promise(r => setTimeout(r, 550));
  }

  const sent = results.filter(r => r.ok).length;
  return res.status(200).json({ sent, failed: results.length - sent, results });
}
