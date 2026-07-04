// ============================================================
// ENSAIO FOTOGRÁFICO EM JOINVILLE — Google Apps Script
// Cole este código no editor do Google Apps Script
// e publique como Web App (acesso: qualquer pessoa)
//
// Script Properties necessárias (Configurações → Script Properties):
//   RESEND_API_KEY  →  re_xxxxxxxxxxxxxxxxxxxxxxxx
// ============================================================

// Preço em centavos. Tiers de venda:
//   lote 0 (pré-venda curta): até 15/05 23:59  → 140000 / 190000 / 220000
//   lote 1: 16/05 → 31/05                     → 160000 / 210000 / 260000
//   lote 2: 01/06 em diante (preço cheio)     → 180000 / 240000 / 280000
// Planilha de produção. Recriada limpa em 2026-05-21: a original ficou lenta
// (cada acesso via SpreadsheetApp levava ~25s — provável bloat de histórico de
// revisões). O script abre a planilha por ID (openById) em vez de
// getActiveSpreadsheet(), pra não depender do vínculo de container.
const SHEET_ID = '1e8PA6anb12YRD5jn-0Ei0mM1SkaB9RkZhfsz-7qlqQA';

const LOTE1_START_MS = new Date('2026-05-16T00:00:00-03:00').getTime();
const LOTE2_START_MS = new Date('2026-06-01T00:00:00-03:00').getTime();

const CFG = {
  WORK_START_H: 9,
  WORK_END_H: 19,
  BUFFER_MIN: 10,
  SLOT_STEP_MIN: 10,
  PENDING_BLOCK_H: 168,         // horas que o slot fica bloqueado p/ pgmto pendente (7d — cobre validade do boleto MP)
  ANDRE_NOTIFY_MIN: 30,         // minutos até Mariane receber aviso de pagamento não concluído
  get PACKAGES() {
    const now = Date.now();
    let priceLem, priceEco, priceCom;
    if (now >= LOTE2_START_MS)      { priceLem = 180000; priceEco = 240000; priceCom = 280000; }
    else if (now >= LOTE1_START_MS) { priceLem = 160000; priceEco = 210000; priceCom = 260000; }
    else                            { priceLem = 140000; priceEco = 190000; priceCom = 220000; }
    return {
      lembranca: { name: 'Lembrança', duration: 30,  price: priceLem, color: '#6A0DAD', textColor: '#FFFFFF', bold: false, maxBailarinas: 2 },
      economico: { name: 'Econômico', duration: 60,  price: priceEco, color: '#0277BD', textColor: '#FFFFFF', bold: true,  maxBailarinas: 3 },
      completo:  { name: 'Completo',  duration: 120, price: priceCom, color: '#BF360C', textColor: '#FFFFFF', bold: false, maxBailarinas: 4 },
    };
  },
  DATES_START:  '2026-07-20',
  DATES_END:    '2026-08-02',
  ANDRE_EMAIL:    'andreffotografia@gmail.com',
  MARIANE_EMAIL:  'mariane.sslourenco@gmail.com',
  FROM_EMAIL:     'Ensaio Joinville <confirmacao@ensaiofotograficoemjoinville.com>',
  SITE_URL:       'https://www.ensaiofotograficoemjoinville.com',
  ADMIN_URL:      'https://www.ensaiofotograficoemjoinville.com/admin',
};

// ── Colunas de "Agendamentos" (referência — leitura/escrita usa header-based detection) ──
// ID, Data, Início, Fim, Pacote, Duração (min), Valor (R$),
// Nome, E-mail, WhatsApp, Instagram Cliente, Instagram Bailarina, Nome Bailarina, Nº Bailarinas,
// Stripe Session, Stripe Payment, Status, Criado em, Atualizado em,
// Rem1Sent, Rem2Sent, Rem3Sent, AndreNotified, ExpiryWarnSent, Source, Sessões Pagas
//
// Multi-pagador (split): "Stripe Session" pode conter N session IDs comma-separated
// (ex: "sess_abc,sess_def,sess_ghi" pra 3 pagadores). "Sessões Pagas" rastreia os
// IDs que já confirmaram pagamento (subset de "Stripe Session"). Status fica como
// "Pago Parcial" enquanto faltar e vai pra "Confirmado" quando o último pagar.
// "Stripe Payment" também vira comma-separated com os payment IDs correspondentes.

// ── Helpers de tempo ──────────────────────────────────────────
function timeToMin(hhmm) {
  const str = hhmm ? hhmm.toString() : '00:00';
  const parts = str.split(':');
  return parseInt(parts[0]) * 60 + parseInt(parts[1] || 0);
}
function minToTime(min) {
  return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
}
function nowIso() { return new Date().toISOString(); }
function genBookingId() { return 'AG-' + Date.now().toString(36).toUpperCase(); }
function formatDateBR(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return d + '/' + m + '/' + y;
}

// ── Sheet helpers ─────────────────────────────────────────────
function getSheet(name) {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(name);
}

// ── RESEND key ────────────────────────────────────────────────
function getResendKey() {
  return PropertiesService.getScriptProperties().getProperty('RESEND_API_KEY') || '';
}

// ── Log ───────────────────────────────────────────────────────
function addLog(action, bookingId, detail, origin) {
  const sh = getSheet('Log');
  if (!sh) return;
  sh.appendRow([nowIso(), action, bookingId || '', detail || '', origin || '']);
}

// ── Mapa header → índice (header-based column detection) ──────
// Usado para escrever/ler em "Agendamentos" sem assumir posição fixa.
function _colMap(sa) {
  const numCols = sa.getLastColumn();
  const hdrs    = sa.getRange(1, 1, 1, numCols).getValues()[0];
  const map = {};
  hdrs.forEach((h, i) => { map[String(h).trim()] = i; });
  return map;
}
// Retorna número 1-indexed da coluna para uso com getRange.
// Se não achar pelo header, usa fallback1 (1-indexed).
function _col1(map, name, fallback1) {
  const i = map[name];
  return (i !== undefined && i >= 0) ? (i + 1) : fallback1;
}
// Retorna o valor da linha pela coluna (header-based).
function _val(row, map, name, fallback0) {
  const i = map[name];
  if (i !== undefined && i >= 0) return row[i];
  return fallback0 !== undefined ? row[fallback0] : '';
}

// ── Inicialização das abas ────────────────────────────────────
function initSheets() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  function ensureSheet(name, headers, tabColor) {
    let sh = ss.getSheetByName(name);
    if (!sh) { sh = ss.insertSheet(name); sh.setTabColor(tabColor); }
    if (sh.getLastRow() === 0) {
      sh.appendRow(headers);
      sh.getRange(1, 1, 1, headers.length)
        .setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff');
      sh.setFrozenRows(1);
    }
    return sh;
  }

  const agHeaders = [
    'ID','Data','Início','Fim','Pacote','Duração (min)','Valor (R$)',
    'Nome','E-mail','WhatsApp','Instagram Cliente','Instagram Bailarina','Nome Bailarina','Nº Bailarinas',
    'Stripe Session','Stripe Payment','Status','Criado em','Atualizado em',
    'Rem1Sent','Rem2Sent','Rem3Sent','AndreNotified','ExpiryWarnSent','Source','Sessões Pagas','Nomes Pagadores','Valores Pagadores','Links Pagadores','Emails Pagadores'
  ];
  ensureSheet('Agendamentos', agHeaders, '#4CAF50');
  ensureSheet('Bloqueios',    ['Data','Início','Fim','Motivo'],                '#FF9800');
  ensureSheet('Log',          ['Timestamp','Ação','Booking ID','Detalhe','Origem'], '#2196F3');

  // Ensure new columns exist in an already-populated Agendamentos sheet
  const sa = getSheet('Agendamentos');
  if (sa && sa.getLastRow() > 0) {
    const existingHeaders = sa.getRange(1, 1, 1, sa.getLastColumn()).getValues()[0];
    if (existingHeaders.indexOf('Instagram Cliente') === -1) {
      // New fields added — reinitialise headers fully via initSheets
      addLog('HEADERS_DESATUALIZADOS', '', 'Execute initSheets para adicionar novos campos', 'sistema');
    }
  }

  buildClientesSheet();

  return ContentService.createTextOutput(JSON.stringify({ ok: true, msg: 'Sheets inicializadas' }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ── Aba Clientes ──────────────────────────────────────────────
function buildClientesSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let cl = ss.getSheetByName('Clientes');
  if (!cl) { cl = ss.insertSheet('Clientes'); cl.setTabColor('#009688'); }
  else      { cl.clearContents(); }

  const headers = ['Nome','E-mail','WhatsApp','Instagram','Instagram Bailarina','Nome Bailarina','Nº Bailarinas',
                   'Último pacote','Última data','Qtd ensaios','Status atual','Último ID'];
  cl.appendRow(headers);
  cl.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff');
  cl.setFrozenRows(1);

  const sa = getSheet('Agendamentos');
  if (!sa || sa.getLastRow() < 2) {
    for (let c = 1; c <= headers.length; c++) cl.autoResizeColumn(c);
    return;
  }

  // Header-based column detection (works com schema antigo e novo)
  const numCols = sa.getLastColumn();
  const hdrs    = sa.getRange(1, 1, 1, numCols).getValues()[0];
  const ci = {};
  hdrs.forEach((h, i) => { ci[String(h).trim()] = i; });
  const get = (row, name) => {
    const i = ci[name];
    return i !== undefined && i >= 0 ? row[i] : '';
  };

  const data = sa.getRange(2, 1, sa.getLastRow() - 1, numCols).getValues();
  const byKey = {};

  data.forEach(row => {
    const email = String(get(row, 'E-mail') || '').trim().toLowerCase();
    const wa    = String(get(row, 'WhatsApp') || '').trim();
    const key   = email || wa;
    if (!key) return;

    const createdRaw = get(row, 'Criado em');
    const createdTs  = createdRaw ? new Date(createdRaw).getTime() : 0;

    if (!byKey[key]) byKey[key] = { count: 0, latest: row, latestTs: createdTs };
    byKey[key].count++;
    if (createdTs >= byKey[key].latestTs) {
      byKey[key].latest   = row;
      byKey[key].latestTs = createdTs;
    }
  });

  const rows = Object.keys(byKey).map(k => {
    const { count, latest } = byKey[k];
    const pkgKey   = get(latest, 'Pacote');
    const pkg      = CFG.PACKAGES[pkgKey] || {};
    const dateRaw  = get(latest, 'Data');
    const dateStr  = dateRaw ? (typeof dateRaw === 'string'
                       ? dateRaw
                       : Utilities.formatDate(dateRaw, 'America/Sao_Paulo', 'yyyy-MM-dd')) : '';
    return [
      get(latest, 'Nome'),
      get(latest, 'E-mail'),
      get(latest, 'WhatsApp'),
      get(latest, 'Instagram Cliente'),
      get(latest, 'Instagram Bailarina'),
      get(latest, 'Nome Bailarina'),
      Number(get(latest, 'Nº Bailarinas')) || 1,
      pkg.name || pkgKey,
      formatDateBR(dateStr),
      count,
      get(latest, 'Status'),
      get(latest, 'ID'),
    ];
  });

  // Sort by name asc (pt-BR)
  rows.sort((a, b) => String(a[0] || '').localeCompare(String(b[0] || ''), 'pt-BR'));

  if (rows.length > 0) {
    cl.getRange(2, 1, rows.length, headers.length).setValues(rows);
    for (let i = 0; i < rows.length; i++) {
      const bg = i % 2 === 0 ? '#E8F5E9' : '#C8E6C9';
      cl.getRange(i + 2, 1, 1, headers.length).setBackground(bg).setFontColor('#1B5E20');
    }
  }

  for (let c = 1; c <= headers.length; c++) cl.autoResizeColumn(c);
}

// ── Disponibilidade ───────────────────────────────────────────
function getWorkIntervals(dateStr) {
  const intervals = [{ start: CFG.WORK_START_H * 60, end: CFG.WORK_END_H * 60 }];
  const blocks = getSheet('Bloqueios');
  if (!blocks || blocks.getLastRow() < 2) return intervals;

  const bData = blocks.getRange(2, 1, blocks.getLastRow() - 1, 4).getValues();
  bData.forEach(([bDate, bStart, bEnd]) => {
    const bKey = typeof bDate === 'string' ? bDate : Utilities.formatDate(bDate, 'America/Sao_Paulo', 'yyyy-MM-dd');
    if (bKey !== dateStr) return;
    const bS = timeToMin(bStart);
    const bE = timeToMin(bEnd);
    intervals.forEach((iv, i) => {
      if (bS < iv.end && bE > iv.start) {
        if      (bS <= iv.start && bE >= iv.end)  intervals.splice(i, 1);
        else if (bS <= iv.start)                  intervals[i].start = bE;
        else if (bE >= iv.end)                    intervals[i].end   = bS;
        else intervals.splice(i, 1, { start: iv.start, end: bS }, { start: bE, end: iv.end });
      }
    });
  });
  return intervals;
}

function getBookingsForDate(dateStr) {
  const sa = getSheet('Agendamentos');
  if (!sa || sa.getLastRow() < 2) return [];
  const cm      = _colMap(sa);
  const numCols = sa.getLastColumn();
  const data    = sa.getRange(2, 1, sa.getLastRow() - 1, numCols).getValues();
  const now     = Date.now();

  return data.filter(row => {
    const status = String(_val(row, cm, 'Status') || '').trim();
    const dRaw   = _val(row, cm, 'Data');
    const d      = dRaw ? (typeof dRaw === 'string'
                    ? dRaw
                    : Utilities.formatDate(dRaw, 'America/Sao_Paulo', 'yyyy-MM-dd')) : '';
    if (d !== dateStr) return false;
    // Especial (gerenciado pela Mari): bloqueia o intervalo SEM prazo de expiração,
    // enquanto não for cancelado/expirado manualmente — o grupo pode levar dias pra pagar.
    if (String(_val(row, cm, 'Pacote') || '') === 'especial') {
      return status === 'Pendente' || status === 'Pago Parcial' || status === 'Confirmado';
    }
    // Status "Pago Parcial" também bloqueia slot — agendamento já tem dinheiro
    // entrando, só falta um ou mais pagadores fecharem o split.
    if (status === 'Confirmado' || status === 'Pago Parcial') return true;
    if (status === 'Pendente') {
      const criadoEm = _val(row, cm, 'Criado em');
      const ageH     = criadoEm ? (now - new Date(criadoEm).getTime()) / 3600000 : 0;
      return ageH < CFG.PENDING_BLOCK_H; // bloqueia por até 72h
    }
    return false;
  }).map(row => ({
    start: timeToMin(_toHHMM(_val(row, cm, 'Início'))),
    end:   timeToMin(_toHHMM(_val(row, cm, 'Fim'))),
  }));
}

// Helper: formata "2026-08-01" em "01 de agosto de 2026 · Sábado"
function _fmtDateLong(dateStr) {
  if (!dateStr) return '';
  const parts = String(dateStr).split('-');
  if (parts.length !== 3) return dateStr;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  const months = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  const days   = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
  const dt  = new Date(Date.UTC(y, m - 1, d, 12));
  return String(d).padStart(2, '0') + ' de ' + months[m - 1] + ' de ' + y + ' · ' + days[dt.getUTCDay()];
}

// Helper: converte valor de célula de tempo (Date ou string) em "HH:mm"
function _toHHMM(v) {
  if (v === null || v === undefined || v === '') return '00:00';
  if (v instanceof Date) return Utilities.formatDate(v, 'America/Sao_Paulo', 'HH:mm');
  if (typeof v === 'string') {
    // Já pode estar como "HH:mm" ou ser uma string de Date — tenta parsing
    if (/^\d{1,2}:\d{2}/.test(v)) return v.slice(0, 5);
    const parsed = new Date(v);
    if (!isNaN(parsed.getTime())) return Utilities.formatDate(parsed, 'America/Sao_Paulo', 'HH:mm');
  }
  return '00:00';
}

// Retorna os dados PÚBLICOS de um agendamento Especial (p/ a página compartilhável):
// lista de pagadores (nome, valor, link, pago?) + total/data/status. null se não achar
// ou se não for 'especial' (só Especial é exposto publicamente).
function getEspecialPublic(id) {
  const sa = getSheet('Agendamentos');
  if (!sa || sa.getLastRow() < 2) return null;
  const cm   = _colMap(sa);
  const data = sa.getRange(2, 1, sa.getLastRow() - 1, sa.getLastColumn()).getValues();
  for (let r = 0; r < data.length; r++) {
    const row = data[r];
    if (String(_val(row, cm, 'ID') || '') !== id) continue;
    if (String(_val(row, cm, 'Pacote') || '') !== 'especial') return null;
    const names    = String(_val(row, cm, 'Nomes Pagadores')  || '').split(',');
    const values   = String(_val(row, cm, 'Valores Pagadores') || '').split(',');
    const urls     = String(_val(row, cm, 'Links Pagadores')   || '').split('|');
    const sessions = String(_val(row, cm, 'Stripe Session')    || '').split(',');
    const paidArr  = String(_val(row, cm, 'Sessões Pagas')     || '').split(',').filter(Boolean);
    const paidSet  = {}; paidArr.forEach(function(s) { paidSet[s] = true; });
    const payers = sessions.map(function(sid, i) {
      return {
        name:  (names[i] || '').trim() || ('Pagador ' + (i + 1)),
        value: Number(values[i] || 0),
        url:   (urls[i] || '').trim(),
        paid:  !!paidSet[sid],
      };
    });
    const dRaw   = _val(row, cm, 'Data');
    const dateStr = dRaw ? (typeof dRaw === 'string'
      ? dRaw : Utilities.formatDate(dRaw, 'America/Sao_Paulo', 'yyyy-MM-dd')) : '';
    const status = String(_val(row, cm, 'Status') || '');
    return {
      id:         id,
      clientName: _val(row, cm, 'Nome') || '',
      date:       dateStr,
      start:      _toHHMM(_val(row, cm, 'Início')),
      end:        _toHHMM(_val(row, cm, 'Fim')),
      total:      Number(_val(row, cm, 'Valor (R$)') || 0),
      status:     status,
      allPaid:    status === 'Confirmado',
      payers:     payers,
    };
  }
  return null;
}

function computeAvailableSlots(dateStr, pkgKey, durationOverride) {
  // durationOverride (min): usado pelo pacote 'especial' (duração livre). Sem override,
  // usa a duração fixa do pacote de catálogo.
  let duration;
  if (durationOverride != null && Number(durationOverride) > 0) {
    duration = Number(durationOverride);
  } else {
    const pkg = CFG.PACKAGES[pkgKey];
    if (!pkg) return [];
    duration = pkg.duration;
  }
  const needed    = duration + CFG.BUFFER_MIN;
  const bookings  = getBookingsForDate(dateStr);
  const intervals = getWorkIntervals(dateStr);
  const slots     = [];

  intervals.forEach(({ start: ivStart, end: ivEnd }) => {
    for (let t = ivStart; t + needed <= ivEnd; t += CFG.SLOT_STEP_MIN) {
      const slotEnd = t + duration;
      // Buffer aplicado dos dois lados: o slot novo precisa terminar
      // ao menos BUFFER_MIN antes do início de uma reserva existente
      // E começar ao menos BUFFER_MIN depois do fim dela.
      const blocked = bookings.some(b =>
        t < b.end + CFG.BUFFER_MIN &&
        slotEnd + CFG.BUFFER_MIN > b.start
      );
      if (!blocked) slots.push(minToTime(t));
    }
  });
  return slots;
}

// ── E-mail via Resend ─────────────────────────────────────────
function sendEmailViaResend(to, subject, html) {
  try {
    MailApp.sendEmail({ to: to, subject: subject, htmlBody: html });
    return true;
  } catch (err) {
    addLog('EMAIL_ERRO', '', err.toString(), 'sendEmailViaResend');
    return false;
  }
}

function _emailFooter() {
  return `
    <tr><td style="background:#f9fafb;padding:16px 40px;text-align:center;border-top:1px solid #e5e7eb;">
      <p style="color:#9ca3af;font-size:11px;margin:0;">
        Dúvidas? WhatsApp <strong>(11) 5196-0627</strong> ·
        © 2026 Ensaio Fotográfico em Joinville
      </p>
    </td></tr>`;
}

function _emailHeader(title) {
  return `
    <tr><td style="background:linear-gradient(135deg,#7a3f8f,#e87060);padding:28px 40px;text-align:center;">
      <h1 style="color:#ffffff;margin:0;font-size:20px;font-weight:800;">Ensaio Fotográfico em Joinville</h1>
      <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px;">Hotel Le Village · 20 Jul – 02 Ago 2026</p>
      <p style="color:#ffe082;margin:8px 0 0;font-size:15px;font-weight:700;">${title}</p>
    </td></tr>`;
}

function _bookingSummaryRows(booking) {
  const valorNum   = parseFloat(booking.valor);
  const valorLabel = isNaN(valorNum) ? booking.valor : 'R$ ' + valorNum.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  const pkgInfo    = CFG.PACKAGES[booking.pacote] || {};
  const numB       = Number(booking.numBailarinas) || 1;
  return `
    <table width="100%" style="border-collapse:collapse;">
      <tr><td style="color:#6b7280;padding:5px 0;font-size:13px;">Pacote</td>
          <td style="color:#111827;font-size:13px;font-weight:600;text-align:right;">${pkgInfo.name || booking.pacote}</td></tr>
      <tr><td style="color:#6b7280;padding:5px 0;font-size:13px;">Nº Bailarinas</td>
          <td style="color:#111827;font-size:13px;font-weight:600;text-align:right;">${numB}</td></tr>
      <tr><td style="color:#6b7280;padding:5px 0;font-size:13px;">Data</td>
          <td style="color:#111827;font-size:13px;font-weight:600;text-align:right;">${formatDateBR(booking.data)}</td></tr>
      <tr><td style="color:#6b7280;padding:5px 0;font-size:13px;">Horário</td>
          <td style="color:#111827;font-size:13px;font-weight:600;text-align:right;">${booking.inicio}</td></tr>
      <tr><td style="color:#6b7280;padding:5px 0;font-size:13px;border-top:1px solid #e5e7eb;">Valor</td>
          <td style="color:#7a3f8f;font-size:14px;font-weight:700;text-align:right;border-top:1px solid #e5e7eb;">${valorLabel}</td></tr>
    </table>`;
}

function sendReminderEmail(booking, num) {
  const subjects = {
    1: '⏰ Seu horário está reservado — finalize o pagamento',
    2: '🔔 Lembrete: pagamento pendente do seu ensaio',
    3: '⚠️ Último lembrete — seu horário expira em breve',
  };
  const intros = {
    1: 'Você acabou de reservar um horário. Finalize o pagamento para confirmar sua vaga!',
    2: 'Já se passaram 2 horas desde a sua reserva. Seu horário ainda <strong>não está confirmado</strong> pois o pagamento está pendente.',
    3: 'Faltam apenas 2 horas para seu horário ser liberado. Este é seu último lembrete!',
  };

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
  ${_emailHeader(subjects[num])}
  <tr><td style="padding:28px 40px;">
    <p style="color:#374151;font-size:15px;margin:0 0 12px;">Olá, <strong>${booking.nome}</strong>!</p>
    <p style="color:#6b7280;font-size:14px;margin:0 0 20px;">${intros[num]}</p>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
      ${_bookingSummaryRows(booking)}
    </div>
    <div style="text-align:center;margin-bottom:20px;">
      <a href="${CFG.SITE_URL}/agendamento" style="display:inline-block;background:linear-gradient(135deg,#7a3f8f,#e87060);color:#ffffff;font-weight:700;font-size:14px;text-decoration:none;padding:13px 32px;border-radius:50px;">
        Finalizar Pagamento
      </a>
    </div>
  </td></tr>
  ${_emailFooter()}
</table>
</td></tr>
</table>
</body></html>`;

  const ok = sendEmailViaResend(booking.email, subjects[num], html);
  if (ok) addLog('LEMBRETE_' + num, booking.id, 'Enviado para ' + booking.email, 'sendReminderEmail');
}

function sendVendedoraNotification(booking) {
  const valorNum   = parseFloat(booking.valor);
  const valorLabel = isNaN(valorNum) ? booking.valor : 'R$ ' + valorNum.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  const pkgInfo    = CFG.PACKAGES[booking.pacote] || {};

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
  <tr><td style="background:#7a3f8f;padding:20px 28px;">
    <h2 style="color:#ffffff;margin:0;font-size:17px;">⏳ Pagamento pendente há 30 min</h2>
    <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px;">O cliente ainda não finalizou o pagamento online.</p>
  </td></tr>
  <tr><td style="padding:24px 28px;">
    <table width="100%" style="border-collapse:collapse;">
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;width:120px;">Nome</td>
          <td style="font-weight:600;font-size:13px;">${booking.nome}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">E-mail</td>
          <td style="font-size:13px;">${booking.email}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">WhatsApp</td>
          <td style="font-weight:600;font-size:14px;color:#7a3f8f;">${booking.whatsapp}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">Bailarina</td>
          <td style="font-size:13px;">${booking.nomeBailarina || '—'}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">Nº Bailarinas</td>
          <td style="font-weight:600;font-size:13px;">${Number(booking.numBailarinas) || 1}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">Pacote</td>
          <td style="font-size:13px;">${pkgInfo.name || booking.pacote}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">Data</td>
          <td style="font-size:13px;">${formatDateBR(booking.data)} às ${booking.inicio} – ${booking.fim}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;border-top:1px solid #e5e7eb;">Valor</td>
          <td style="font-weight:700;font-size:14px;color:#7a3f8f;border-top:1px solid #e5e7eb;">${valorLabel}</td></tr>
    </table>
    <div style="margin-top:16px;padding:12px 16px;background:#fff8f0;border-left:3px solid #e87060;border-radius:4px;font-size:13px;color:#555;line-height:1.5;">
      O horário escolhido ainda está disponível. Você pode entrar em contato para ajudar o cliente a concluir.
    </div>
    <div style="margin-top:16px;text-align:center;">
      <a href="${toWaLink(booking.whatsapp, 'Oi ' + booking.nome + '! Vi que você começou um agendamento no site do ensaio em Joinville mas não concluiu. Posso te ajudar a finalizar? 😊')}" style="display:inline-block;background:#128C7E;color:#fff;font-weight:bold;font-size:14px;text-decoration:none;padding:12px 28px;border-radius:8px;">
        💬 Abrir conversa no WhatsApp
      </a>
    </div>
    <p style="font-size:12px;color:#9ca3af;margin-top:14px;text-align:center;">Toque no botão para abrir direto o chat com o cliente.</p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  const subject = '🔔 ' + booking.nome + ' não concluiu o pagamento — ' + formatDateBR(booking.data) + ' às ' + booking.inicio;
  const ok = sendEmailViaResend(CFG.MARIANE_EMAIL, subject, html);
  if (ok) addLog('VENDEDORA_NOTIFICADA', booking.id, 'Mariane notificada sobre ' + booking.nome, 'sendVendedoraNotification');
}

function toWaLink(phone, msg) {
  // Coerção defensiva: a coluna WhatsApp do Sheet às vezes vem como número
  // (ex: 47999999999), e phone.replace quebraria com "is not a function" —
  // foi o que derrubou o processReminders e travou o Apps Script inteiro.
  const digits     = String(phone == null ? '' : phone).replace(/\D/g, '');
  const normalized = digits.length >= 12 ? digits : '55' + digits;
  return 'https://wa.me/' + normalized + '?text=' + encodeURIComponent(msg);
}

function sendAdmin48hNotification(booking) {
  const valorNum   = parseFloat(booking.valor);
  const valorLabel = isNaN(valorNum) ? booking.valor : 'R$ ' + valorNum.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  const pkgInfo    = CFG.PACKAGES[booking.pacote] || {};
  const waLink     = toWaLink(booking.whatsapp, 'Oi ' + booking.nome + '! Vi que você ainda não concluiu o pagamento do seu ensaio em Joinville. Posso te ajudar? 😊');

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
  <tr><td style="background:linear-gradient(135deg,#7a3f8f,#e87060);padding:20px 28px;">
    <h2 style="color:#ffffff;margin:0;font-size:17px;">⏰ Link não pago — 48 horas</h2>
    <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px;">O cliente ainda não concluiu o pagamento do link que você enviou.</p>
  </td></tr>
  <tr><td style="padding:24px 28px;">
    <table width="100%" style="border-collapse:collapse;">
      <tr><td style="color:#6b7280;padding:7px 0;font-size:13px;width:130px;">Cliente</td>
          <td style="font-weight:600;font-size:13px;">${booking.nome}</td></tr>
      <tr><td style="color:#6b7280;padding:7px 0;font-size:13px;">WhatsApp</td>
          <td style="font-weight:600;font-size:14px;color:#7a3f8f;">${booking.whatsapp}</td></tr>
      <tr><td style="color:#6b7280;padding:7px 0;font-size:13px;">Pacote</td>
          <td style="font-size:13px;">${pkgInfo.name || booking.pacote}</td></tr>
      <tr><td style="color:#6b7280;padding:7px 0;font-size:13px;">Data</td>
          <td style="font-size:13px;">${formatDateBR(booking.data)} às ${booking.inicio} – ${booking.fim}</td></tr>
      <tr><td style="color:#6b7280;padding:7px 0;font-size:13px;border-top:1px solid #e5e7eb;">Valor</td>
          <td style="font-weight:700;font-size:14px;color:#7a3f8f;border-top:1px solid #e5e7eb;">${valorLabel}</td></tr>
    </table>
    <div style="margin-top:20px;text-align:center;">
      <a href="${waLink}" style="display:inline-block;background:#128C7E;color:#fff;font-weight:bold;font-size:14px;text-decoration:none;padding:12px 28px;border-radius:8px;">
        💬 Abrir conversa no WhatsApp
      </a>
    </div>
    <p style="font-size:12px;color:#9ca3af;margin-top:14px;text-align:center;">Toque no botão para abrir direto o chat com o cliente.</p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  const subject = '⏰ ' + booking.nome + ' não pagou há 48h — ' + formatDateBR(booking.data) + ' às ' + booking.inicio;
  const ok = sendEmailViaResend(CFG.MARIANE_EMAIL, subject, html);
  if (ok) addLog('ADMIN_48H_NOTIFICADA', booking.id, 'Mariane notificada (48h) sobre ' + booking.nome, 'sendAdmin48hNotification');
}

function sendExpiryWarning(booking) {
  const valorNum   = parseFloat(booking.valor);
  const valorLabel = isNaN(valorNum) ? booking.valor : 'R$ ' + valorNum.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  const pkgInfo    = CFG.PACKAGES[booking.pacote] || {};

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
  <tr><td style="background:#e87060;padding:20px 28px;">
    <h2 style="color:#ffffff;margin:0;font-size:17px;">🚨 Agendamento expira em 8 horas!</h2>
    <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px;">O cliente ainda não confirmou o pagamento.</p>
  </td></tr>
  <tr><td style="padding:24px 28px;">
    <table width="100%" style="border-collapse:collapse;">
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;width:120px;">Nome</td>
          <td style="font-weight:600;font-size:13px;">${booking.nome}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">E-mail</td>
          <td style="font-size:13px;">${booking.email}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">WhatsApp</td>
          <td style="font-weight:600;font-size:14px;color:#e87060;">${booking.whatsapp}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">Bailarina</td>
          <td style="font-size:13px;">${booking.nomeBailarina || '—'}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">Nº Bailarinas</td>
          <td style="font-weight:600;font-size:13px;">${Number(booking.numBailarinas) || 1}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">Pacote</td>
          <td style="font-size:13px;">${pkgInfo.name || booking.pacote}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">Data</td>
          <td style="font-size:13px;">${formatDateBR(booking.data)} às ${booking.inicio} – ${booking.fim}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;border-top:1px solid #e5e7eb;">Valor</td>
          <td style="font-weight:700;font-size:14px;color:#e87060;border-top:1px solid #e5e7eb;">${valorLabel}</td></tr>
    </table>
    <p style="font-size:13px;color:#374151;margin-top:20px;line-height:1.6;">
      Se o cliente já concluiu o pagamento por outro meio, ou se desistiu do agendamento,
      atualize o status no painel administrativo para liberar ou confirmar o horário.
    </p>
    <p style="text-align:center;margin:20px 0 0;">
      <a href="${CFG.ADMIN_URL}" style="display:inline-block;background:#e87060;color:#fff;text-decoration:none;padding:10px 24px;border-radius:8px;font-size:13px;font-weight:600;">
        Abrir Painel Admin
      </a>
    </p>
    <p style="color:#9ca3af;font-size:12px;margin-top:16px;border-top:1px solid #f0f0f0;padding-top:12px;">
      Se nenhuma ação for tomada, o slot será liberado automaticamente em 8 horas.
    </p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  const subject = '🚨 Expira em 8h: ' + booking.nome + ' — ' + formatDateBR(booking.data) + ' às ' + booking.inicio;
  const ok = sendEmailViaResend(CFG.MARIANE_EMAIL, subject, html);
  if (ok) addLog('EXPIRY_WARNING', booking.id, 'Aviso de expiração enviado para Mariane — ' + booking.nome, 'sendExpiryWarning');
}

// ── processReminders (trigger a cada 5 min) ───────────────────
function processReminders() {
  const sa = getSheet('Agendamentos');
  if (!sa || sa.getLastRow() < 2) return;

  const cm      = _colMap(sa);
  const numCols = sa.getLastColumn();
  const data    = sa.getRange(2, 1, sa.getLastRow() - 1, numCols).getValues();
  const now     = Date.now();

  data.forEach((row, i) => {
    const status = String(_val(row, cm, 'Status', 15) || '').trim();
    if (status !== 'Pendente') return;
    // Especial é gerenciado manualmente pela Mari: não expira nem dispara lembrete.
    if (String(_val(row, cm, 'Pacote', 4) || '') === 'especial') return;
    const criadoEm = _val(row, cm, 'Criado em', 16);
    if (!criadoEm) return;

    const rowNum   = i + 2;
    const ageMin   = (now - new Date(criadoEm).getTime()) / 60000;
    const dataRaw  = _val(row, cm, 'Data', 1);
    const dataStr  = dataRaw ? (typeof dataRaw === 'string'
                       ? dataRaw
                       : Utilities.formatDate(dataRaw, 'America/Sao_Paulo', 'yyyy-MM-dd')) : '';
    const booking = {
      id:       _val(row, cm, 'ID', 0),
      data:     dataStr,
      inicio:   _toHHMM(_val(row, cm, 'Início', 2)),
      fim:      _toHHMM(_val(row, cm, 'Fim',    3)),
      pacote:   _val(row, cm, 'Pacote', 4),
      valor:    _val(row, cm, 'Valor (R$)', 6),
      nome:     _val(row, cm, 'Nome', 7),
      email:    _val(row, cm, 'E-mail', 8),
      whatsapp: _val(row, cm, 'WhatsApp', 9),
      instagram:          _val(row, cm, 'Instagram Cliente'),
      instagramBailarina: _val(row, cm, 'Instagram Bailarina'),
      nomeBailarina:      _val(row, cm, 'Nome Bailarina'),
      numBailarinas:      Number(_val(row, cm, 'Nº Bailarinas')) || 1,
      criadoEm: criadoEm,
    };

    // 24h sem pagamento → expirar e liberar slot
    if (ageMin >= CFG.PENDING_BLOCK_H * 60) {
      sa.getRange(rowNum, _col1(cm, 'Status', 16)).setValue('Expirado');
      sa.getRange(rowNum, _col1(cm, 'Atualizado em', 18)).setValue(nowIso());
      addLog('PENDENTE_EXPIRADO', booking.id, 'Expirou após 3 dias', 'sistema');
      return;
    }

    const source = _val(row, cm, 'Source') || 'site';

    // Aviso de expiração para Mariane: 8h antes do prazo de 3 dias
    if (ageMin >= (CFG.PENDING_BLOCK_H * 60 - 8 * 60) && !_val(row, cm, 'ExpiryWarnSent')) {
      sendExpiryWarning(booking);
      sa.getRange(rowNum, _col1(cm, 'ExpiryWarnSent', 23)).setValue(nowIso());
    }

    // ── Avisos para Mariane por tipo de origem ─────────────────
    // Site: 30min sem pagar → avisa que cliente começou mas não concluiu
    if (source === 'site' && ageMin >= 30 && !_val(row, cm, 'AndreNotified')) {
      sendVendedoraNotification(booking);
      sa.getRange(rowNum, _col1(cm, 'AndreNotified', 22)).setValue(nowIso());
    }
    // Admin (link gerado por Mariane): 48h sem pagar → avisa para fazer follow-up
    if (source === 'admin' && ageMin >= 48 * 60 && !_val(row, cm, 'Rem1Sent')) {
      sendAdmin48hNotification(booking);
      sa.getRange(rowNum, _col1(cm, 'Rem1Sent', 19)).setValue(nowIso());
    }
  });
}

// ── Booking CRUD ──────────────────────────────────────────────
/**
 * Self-healing: garante que uma coluna existe na aba. Adiciona no fim se faltar.
 * Usado pra evoluir schema sem rodar initSheets manual (multi-pagador é o caso).
 * Retorna o índice 0-based da coluna.
 */
function _ensureColumn(sa, headerName) {
  const lastCol = sa.getLastColumn();
  const hdrs = sa.getRange(1, 1, 1, lastCol).getValues()[0];
  for (let i = 0; i < hdrs.length; i++) {
    if (String(hdrs[i]).trim() === headerName) return i;
  }
  // Falta — append
  sa.getRange(1, lastCol + 1).setValue(headerName)
    .setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff');
  return lastCol; // 0-based do novo header
}

function createPending(data) {
  const { date, start, packageKey, name, email, whatsapp,
          instagram, instagramBailarina, nomeBailarina, numBailarinas,
          stripeSession, source, customValue, payerNames, payerValues, payerUrls, payerEmails } = data;

  const isEspecial = packageKey === 'especial';

  // Especial (freeform, criado pela Mari): duração, valor total e nº de bailarinas
  // LIVRES, sem teto de catálogo. Os 3 pacotes seguem o template fixo de sempre.
  let duration, valorReais, maxNb, pkgName;
  if (isEspecial) {
    duration = Number(data.durationMin);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Especial: duração (min) inválida.');
    valorReais = Number(customValue);
    if (!Number.isFinite(valorReais) || valorReais <= 0) throw new Error('Especial: valor total inválido.');
    maxNb   = Infinity;
    pkgName = 'Especial';
  } else {
    const pkg = CFG.PACKAGES[packageKey];
    if (!pkg) throw new Error('Pacote inválido: ' + packageKey);
    // customValue chega em REAIS; pkg.price em centavos. Sem customValue → catálogo.
    // Sanity: >= 0 e <= catálogo (admin só desconta, não cobra a mais nos 3 fixos).
    const pkgPriceReais = pkg.price / 100;
    valorReais = (typeof customValue === 'number' && customValue >= 0 && customValue <= pkgPriceReais)
      ? customValue
      : pkgPriceReais;
    duration = pkg.duration;
    maxNb    = pkg.maxBailarinas;
    pkgName  = pkg.name;
  }

  const nb = Number(numBailarinas);
  if (!Number.isInteger(nb) || nb < 1 || nb > maxNb) {
    throw new Error(isEspecial
      ? 'Especial: nº de bailarinas deve ser inteiro >= 1.'
      : 'Nº Bailarinas deve estar entre 1 e ' + maxNb + ' para o pacote ' + pkgName);
  }

  // ── Revalidação anti-race-condition (usa a duração custom no Especial) ──
  const livres = computeAvailableSlots(date, packageKey, isEspecial ? duration : undefined);
  if (livres.indexOf(start) === -1) {
    addLog('SLOT_CONFLITO', '',
      'Tentativa de reservar slot já ocupado: ' + date + ' ' + start + ' (' + pkgName + ') por ' + name,
      source === 'admin' ? 'painel' : 'site');
    throw new Error('Esse horário acabou de ser reservado por outra pessoa. Por favor, escolha outro.');
  }

  const endTime   = minToTime(timeToMin(start) + duration);
  const bookingId = genBookingId();
  const now       = nowIso();

  const sa = getSheet('Agendamentos');
  // Self-healing: garante colunas novas (multi-pagador) antes de montar a linha.
  _ensureColumn(sa, 'Sessões Pagas');
  _ensureColumn(sa, 'Nomes Pagadores');
  _ensureColumn(sa, 'Valores Pagadores');   // valor cobrado de cada pagador (paralelo aos nomes)
  _ensureColumn(sa, 'Links Pagadores');     // URL de pagamento de cada pagador (p/ página pública)
  _ensureColumn(sa, 'Emails Pagadores');    // e-mail de cada pagador (paralelo aos nomes) — Especial
  const cm = _colMap(sa);

  // payerNames pode chegar como array ou string comma-separated — normaliza pra
  // CSV paralelo a "Stripe Session" (1 nome por pagador, mesma ordem).
  const payerNamesCsv = Array.isArray(payerNames)
    ? payerNames.map(function(n) { return String(n || '').trim(); }).join(',')
    : String(payerNames || '');
  // Valores por pagador em REAIS (mesma ordem/qtd dos nomes). Usado no Especial p/
  // cobrar cada um o seu; a soma = "Valor (R$)" total.
  const payerValuesCsv = Array.isArray(payerValues)
    ? payerValues.map(function(v) { return (Number(v) || 0).toFixed(2); }).join(',')
    : String(payerValues || '');
  // URLs de pagamento (1 por pagador, mesma ordem). Pipe-separated: URL pode conter vírgula.
  const payerUrlsCsv = Array.isArray(payerUrls)
    ? payerUrls.map(function(u) { return String(u || ''); }).join('|')
    : String(payerUrls || '');
  // E-mails dos pagadores (1 por pagador, mesma ordem). CSV — e-mail não tem vírgula.
  const payerEmailsCsv = Array.isArray(payerEmails)
    ? payerEmails.map(function(e) { return String(e || '').trim(); }).join(',')
    : String(payerEmails || '');

  // Monta a linha header-by-header — funciona com schema antigo ou novo.
  const numCols = Math.max(sa.getLastColumn(), 23);
  const newRow  = new Array(numCols).fill('');
  const set = (name, value, fallback0) => {
    const i = cm[name] !== undefined ? cm[name] : fallback0;
    if (i !== undefined && i >= 0) newRow[i] = value;
  };
  set('ID',                    bookingId,                          0);
  set('Data',                  date,                               1);
  set('Início',                start,                              2);
  set('Fim',                   endTime,                            3);
  set('Pacote',                packageKey,                         4);
  set('Duração (min)',         duration,                           5);
  set('Valor (R$)',            valorReais.toFixed(2),              6);
  set('Nome',                  name,                               7);
  set('E-mail',                email,                              8);
  set('WhatsApp',              whatsapp,                           9);
  set('Instagram Cliente',     instagram          || '');
  set('Instagram Bailarina',   instagramBailarina || '');
  set('Nome Bailarina',        nomeBailarina      || '');
  set('Nº Bailarinas',         Number(numBailarinas) || 1);
  set('Stripe Session',        stripeSession      || '',           13);
  set('Stripe Payment',        '',                                 14);
  set('Status',                'Pendente',                         15);
  set('Criado em',             now,                                16);
  set('Atualizado em',         now,                                17);
  set('Source',                source || 'site');
  set('Nomes Pagadores',       payerNamesCsv);
  set('Valores Pagadores',     payerValuesCsv);
  set('Links Pagadores',       payerUrlsCsv);
  set('Emails Pagadores',      payerEmailsCsv);

  sa.appendRow(newRow);

  try { buildClientesSheet(); } catch (e) { addLog('CLIENTES_REBUILD_ERRO', bookingId, String(e), 'sistema'); }

  addLog('PENDENTE_CRIADO', bookingId,
    name + ' | ' + pkgName + ' | ' + date + ' ' + start + '–' + endTime + ' | Stripe: ' + stripeSession,
    source === 'admin' ? 'painel' : 'site');

  return { ok: true, bookingId: bookingId, endTime: endTime };
}

function confirmBooking(data) {
  const { stripeSession, stripePayment } = data;
  // Origem real do log: 'webhook' (pagamento via gateway) ou 'painel'
  // (confirmação manual via confirmPart). Antes era chumbado 'webhook' sempre,
  // o que escondia confirmações manuais nos logs.
  const logOrigin = data.origin || 'webhook';
  const sa = getSheet('Agendamentos');
  if (!sa || sa.getLastRow() < 2) throw new Error('Planilha vazia');

  // Self-healing: garante colunas multi-pagador. Auto-migra sheets antigas
  // sem precisar rodar initSheets manualmente.
  _ensureColumn(sa, 'Sessões Pagas');
  _ensureColumn(sa, 'Nomes Pagadores');

  const cm      = _colMap(sa);
  const numCols = sa.getLastColumn();
  const rows    = sa.getRange(2, 1, sa.getLastRow() - 1, numCols).getValues();
  const iSes    = cm['Stripe Session'] !== undefined ? cm['Stripe Session'] : 13;

  // Multi-pagador: o campo "Stripe Session" pode ser "sess1,sess2,sess3" pra
  // splits. Match por inclusão na lista de IDs (split por vírgula) — preserva
  // backward compat com bookings single-session (lista com 1 elemento).
  const splitCsv = function(v) {
    return String(v || '').split(',').map(function(s) { return s.trim(); }).filter(function(s) { return !!s; });
  };
  const idx = rows.findIndex(function(r) {
    return splitCsv(r[iSes]).indexOf(stripeSession) !== -1;
  });
  if (idx < 0) throw new Error('Session não encontrada: ' + stripeSession);

  const row     = rows[idx];
  const shRow   = idx + 2;
  const thisId  = _val(row, cm, 'ID', 0);
  const dataRaw = _val(row, cm, 'Data', 1);
  const dateStr = dataRaw ? (typeof dataRaw === 'string'
                    ? dataRaw
                    : Utilities.formatDate(dataRaw, 'America/Sao_Paulo', 'yyyy-MM-dd')) : '';
  const prevStatus = String(_val(row, cm, 'Status') || '').trim();
  const thisStart  = timeToMin(_toHHMM(_val(row, cm, 'Início', 2)));
  const thisEnd    = timeToMin(_toHHMM(_val(row, cm, 'Fim',    3)));

  // Snapshot das listas de sessions (total e pagas) ANTES de aplicar este evento
  const totalSessions = splitCsv(_val(row, cm, 'Stripe Session', 13));
  const prevPaidList  = splitCsv(_val(row, cm, 'Sessões Pagas'));
  const prevPaidSet   = {};
  prevPaidList.forEach(function(s) { prevPaidSet[s] = true; });
  const totalCount    = totalSessions.length || 1;
  const wasAlreadyPaid = !!prevPaidSet[stripeSession];

  // Nomes dos pagadores (paralelo a "Stripe Session" por posição). Permite
  // dizer "Ana pagou (2/4) · falta Bruna, Carla" no e-mail parcial pra Mari.
  const payerNames  = splitCsv(_val(row, cm, 'Nomes Pagadores'));
  // Emails/valores dos pagadores (paralelos a "Stripe Session"). Especial: o webhook
  // usa isto pra mandar "sua parte confirmada" pra quem pagou e "ensaio confirmado"
  // pra todos. splitCsv preserva posição (não filtra vazios? filtra — mas p/ Especial
  // e-mail é obrigatório, então todas as posições vêm preenchidas).
  const payerEmails = splitCsv(_val(row, cm, 'Emails Pagadores'));
  const payerValues = splitCsv(_val(row, cm, 'Valores Pagadores'));
  const thisPos    = totalSessions.indexOf(stripeSession);
  const thisPayerName  = (thisPos >= 0 && payerNames[thisPos])  ? payerNames[thisPos]  : '';
  const thisPayerEmail = (thisPos >= 0 && payerEmails[thisPos]) ? payerEmails[thisPos] : '';

  // Resposta-base reusada nos retornos abaixo
  const baseReturn = {
    bookingId:        thisId,
    date:             dateStr,
    start:            _toHHMM(_val(row, cm, 'Início', 2)),
    end:              _toHHMM(_val(row, cm, 'Fim',    3)),
    name:             _val(row, cm, 'Nome',     7),
    email:            _val(row, cm, 'E-mail',   8),
    whatsapp:         _val(row, cm, 'WhatsApp', 9),
    package:          _val(row, cm, 'Pacote',   4),
    duration:         Number(_val(row, cm, 'Duração (min)')) || 0,
    numBailarinas:    Number(_val(row, cm, 'Nº Bailarinas')) || 1,
    valor:            parseFloat(_val(row, cm, 'Valor (R$)', 6)) || 0,
    totalSessions:    totalCount,
    paidPayerName:    thisPayerName,
    paidPayerEmail:   thisPayerEmail,
    isEspecial:       String(_val(row, cm, 'Pacote', 4)).toLowerCase() === 'especial',
    payerNames:       payerNames,
    payerEmails:      payerEmails,
    payerValues:      payerValues,
  };

  // ── Guarda: booking CANCELADO ────────────────────────────────
  // Cenário: a Mari regerou o link → este booking virou "Cancelado" e um novo
  // pending nasceu. Se um webhook ATRASADO/duplicado chegar para a sessão
  // antiga, NÃO re-confirma o cancelado (era o bug latente). Em vez disso,
  // alerta o André — pode ser um pagamento real num link que foi invalidado,
  // o que exige atenção humana (reembolso ou remarcação).
  if (prevStatus === 'Cancelado') {
    addLog('PAGAMENTO_EM_CANCELADO', thisId,
      'Confirmação chegou para booking CANCELADO (origem ' + logOrigin + '). Session: ' +
      stripeSession + ' | payment: ' + stripePayment + ' — IGNORADO (não re-confirma).', logOrigin);
    // Só alerta o André se foi pagamento de GATEWAY (webhook) — confirmação
    // manual num cancelado é ação consciente da Mari, não precisa alarme.
    if (logOrigin === 'webhook') {
      try {
        MailApp.sendEmail({
          to:       CFG.ANDRE_EMAIL,
          subject:  '⚠️ Pagamento recebido em reserva CANCELADA — ' + (_val(row, cm, 'Nome', 7) || ''),
          htmlBody: '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;">' +
            '<h2 style="color:#b91c1c;">Pagamento em reserva cancelada</h2>' +
            '<p>Um pagamento (webhook) chegou para uma reserva que já estava <strong>Cancelada</strong> ' +
            '(provavelmente o link foi regerado depois). O sistema NÃO re-confirmou.</p>' +
            '<p><strong>Cliente:</strong> ' + (_val(row, cm, 'Nome', 7) || '') + '<br>' +
            '<strong>Booking:</strong> ' + thisId + '<br>' +
            '<strong>Data:</strong> ' + formatDateBR(dateStr) + ' ' + _toHHMM(_val(row, cm, 'Início', 2)) + '<br>' +
            '<strong>Session:</strong> ' + stripeSession + '<br>' +
            '<strong>Payment:</strong> ' + stripePayment + '</p>' +
            '<p><strong>Ação:</strong> verifique no gateway se há pagamento real. Se sim, decida reembolso ou remarcação.</p></div>',
        });
      } catch (e) { addLog('CANCELADO_ALERT_ERRO', thisId, String(e), logOrigin); }
    }
    return Object.assign({
      ok:               true,
      alreadyConfirmed: true,   // webhook lê isso e não dispara e-mail de "confirmado"
      fullyConfirmed:   false,
      wasCancelled:     true,
      paidCount:        prevPaidList.length,
      conflict:         false,
    }, baseReturn);
  }

  // ── Idempotência ─────────────────────────────────────────────
  // (a) Booking já está "Confirmado" — webhook anterior fechou tudo. Pula tudo.
  // (b) Este session específico já estava em "Sessões Pagas" — retry pro mesmo
  //     pagamento (ASAAS dispara PAYMENT_CONFIRMED + PAYMENT_RECEIVED).
  // Em ambos, webhook lê `alreadyConfirmed=true` e não reenvia e-mails.
  if (prevStatus === 'Confirmado' || wasAlreadyPaid) {
    return Object.assign({
      ok:               true,
      alreadyConfirmed: true,
      fullyConfirmed:   prevStatus === 'Confirmado',
      paidCount:        prevPaidList.length,
      conflict:         false,
    }, baseReturn);
  }

  // ── Revalidação anti-conflito (boleto pago tardiamente) ──────
  // Se este booking estava Expirado (passou de 7d) e a confirmação
  // chegou agora, é possível que outra pessoa já tenha reservado
  // o mesmo slot. Detecta e alerta admin antes de marcar Confirmado.
  let conflictAlert = null;
  const conflicting = rows.filter((r, i) => {
    if (i === idx) return false;
    const st = String(_val(r, cm, 'Status') || '').trim();
    if (st !== 'Confirmado' && st !== 'Pendente' && st !== 'Pago Parcial') return false;
    const rDateRaw = _val(r, cm, 'Data');
    const rDate    = rDateRaw ? (typeof rDateRaw === 'string'
                       ? rDateRaw
                       : Utilities.formatDate(rDateRaw, 'America/Sao_Paulo', 'yyyy-MM-dd')) : '';
    if (rDate !== dateStr) return false;
    const rStart = timeToMin(_toHHMM(_val(r, cm, 'Início')));
    const rEnd   = timeToMin(_toHHMM(_val(r, cm, 'Fim')));
    // overlap test (intervalos abertos): a < b.end AND a.end > b
    return thisStart < rEnd && thisEnd > rStart;
  });

  if (conflicting.length > 0) {
    const conflictIds = conflicting.map(r => _val(r, cm, 'ID', 0) + ' (' + String(_val(r, cm, 'Status') || '').trim() + ', ' + _val(r, cm, 'Nome', 7) + ')').join(', ');
    conflictAlert = {
      thisBookingId: thisId,
      thisName:      _val(row, cm, 'Nome', 7),
      thisEmail:     _val(row, cm, 'E-mail', 8),
      conflictIds,
      conflictRows:  conflicting,
      prevStatus,
    };
    addLog('CONFLITO_PAGAMENTO', thisId,
      'Pago: ' + thisId + ' (estava ' + prevStatus + ') | Slot já ocupado por: ' + conflictIds, 'webhook');
  }

  // ── Aplica o pagamento à lista de "Sessões Pagas" ────────────
  // Acumula esse session no set de pagos (+1) e decide o status final.
  const newPaidList = prevPaidList.slice();
  newPaidList.push(stripeSession);
  const newPaidCount = newPaidList.length;
  const fullyConfirmed = newPaidCount >= totalCount;
  const finalStatus = fullyConfirmed ? 'Confirmado' : 'Pago Parcial';

  // "Stripe Payment" também vira lista (1 payment por session, mesma ordem
  // dos pagamentos chegando). Mantém o último valor por compat com leitura legacy.
  const prevPayments = splitCsv(_val(row, cm, 'Stripe Payment', 15));
  const newPayments  = prevPayments.slice();
  newPayments.push(stripePayment || '');

  sa.getRange(shRow, _col1(cm, 'Stripe Payment', 15)).setValue(newPayments.join(','));
  sa.getRange(shRow, _col1(cm, 'Status',         16)).setValue(finalStatus);
  sa.getRange(shRow, _col1(cm, 'Atualizado em',  18)).setValue(nowIso());
  // "Sessões Pagas" pode não existir em planilhas antigas — defensivo
  if (cm['Sessões Pagas'] !== undefined) {
    sa.getRange(shRow, cm['Sessões Pagas'] + 1).setValue(newPaidList.join(','));
  }

  // Só rebuilda Clientes quando fecha 100% (otimização — buildClientesSheet é
  // pesado e não precisa rodar a cada pagamento parcial).
  if (fullyConfirmed) buildClientesSheet();
  addLog(fullyConfirmed ? 'PAGAMENTO_CONFIRMADO' : 'PAGAMENTO_PARCIAL', thisId,
    'Stripe session: ' + stripeSession + ' | payment: ' + stripePayment +
    ' | ' + newPaidCount + '/' + totalCount + ' pagos' +
    (conflictAlert ? ' | ⚠️ CONFLITO com ' + conflictAlert.conflictIds : ''),
    logOrigin);

  // Dispara email de conflito DEPOIS de marcar Confirmado/Parcial (o cliente já
  // pagou, recebe email normal; vocês recebem alerta separado pra resolver).
  // Só vale a pena alertar se o booking fechou 100% — parcial ainda pode ser
  // cancelado por estorno antes de fechar.
  if (conflictAlert && fullyConfirmed) {
    try {
      const subj = '🚨 CONFLITO DE AGENDA — pagamento recebido em slot já ocupado';
      const lines = conflictAlert.conflictRows.map(r =>
        '• ' + _val(r, cm, 'ID', 0) + ' — ' + _val(r, cm, 'Nome', 7) +
        ' (' + _val(r, cm, 'E-mail', 8) + ') · ' +
        String(_val(r, cm, 'Status') || '').trim()
      ).join('<br>');
      const html = '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;">' +
        '<h2 style="color:#b91c1c;margin:0 0 12px;">🚨 Conflito de agendamento</h2>' +
        '<p>Um pagamento chegou para um slot que <strong>já está ocupado por outra reserva</strong>. Isso normalmente acontece quando o cliente paga o boleto depois do prazo, e outro cliente reservou o mesmo horário no meio-tempo.</p>' +
        '<p><strong>Pagamento recém-confirmado:</strong><br>' +
        '• ' + conflictAlert.thisBookingId + ' — ' + conflictAlert.thisName + ' (' + conflictAlert.thisEmail + ')<br>' +
        '<em>Status anterior: ' + conflictAlert.prevStatus + '</em></p>' +
        '<p><strong>Slot já ocupado por:</strong><br>' + lines + '</p>' +
        '<p><strong>Ação necessária:</strong> entrar em contato com o cliente e oferecer reembolso ou remarcação. O sistema marcou o booking como Confirmado, então a aba Agendamentos agora tem dois agendamentos no mesmo horário.</p>' +
        '<p>Data: ' + formatDateBR(dateStr) + ' · ' + minToTime(thisStart) + '–' + minToTime(thisEnd) + '</p>' +
        '</div>';
      MailApp.sendEmail({
        to:       CFG.ANDRE_EMAIL,
        cc:       CFG.MARIANE_EMAIL,
        subject:  subj,
        htmlBody: html,
      });
    } catch (e) {
      addLog('CONFLITO_EMAIL_ERRO', thisId, String(e), 'webhook');
    }
  }

  // Nomes dos pagadores que AINDA faltam (sessions em totalSessions e não em
  // newPaidList). Usado no e-mail parcial pra Mari saber quem cobrar.
  const newPaidSet = {};
  newPaidList.forEach(function(s) { newPaidSet[s] = true; });
  const pendingPayerNames = [];
  totalSessions.forEach(function(sid, i) {
    if (!newPaidSet[sid]) {
      pendingPayerNames.push(payerNames[i] || ('Pagador ' + (i + 1)));
    }
  });

  return Object.assign({
    ok: true,
    alreadyConfirmed:   false,
    fullyConfirmed:     fullyConfirmed,
    paidCount:          newPaidCount,
    pendingPayerNames:  pendingPayerNames,
    conflict:           fullyConfirmed && !!conflictAlert,
  }, baseReturn);
}

// ── Confirmação manual (admin) ────────────────────────────────
// Diferente de confirmBooking (que casa por session e faz tracking parcial),
// esta confirma a reserva INTEIRA pelo bookingId — marca TODAS as sessions
// como pagas e status 'Confirmado' de uma vez. Usada quando a Mari confirma
// pagamento na mão (cliente pagou fora do link, ou pra fechar um split que
// recebeu por outro meio). Funciona em single e split. Idempotente.
function forceConfirmBooking(data) {
  const { bookingId, stripePayment } = data;
  const sa = getSheet('Agendamentos');
  if (!sa || sa.getLastRow() < 2) throw new Error('Planilha vazia');

  _ensureColumn(sa, 'Sessões Pagas');
  _ensureColumn(sa, 'Nomes Pagadores');

  const cm      = _colMap(sa);
  const numCols = sa.getLastColumn();
  const rows    = sa.getRange(2, 1, sa.getLastRow() - 1, numCols).getValues();
  const iId     = cm['ID'] !== undefined ? cm['ID'] : 0;
  const idx     = rows.findIndex(function(r) { return r[iId] === bookingId; });
  if (idx < 0) throw new Error('Booking não encontrado: ' + bookingId);

  const row   = rows[idx];
  const shRow = idx + 2;
  const splitCsv = function(v) {
    return String(v || '').split(',').map(function(s) { return s.trim(); }).filter(function(s) { return !!s; });
  };
  const dataRaw = _val(row, cm, 'Data', 1);
  const dateStr = dataRaw ? (typeof dataRaw === 'string'
                    ? dataRaw
                    : Utilities.formatDate(dataRaw, 'America/Sao_Paulo', 'yyyy-MM-dd')) : '';
  const prevStatus = String(_val(row, cm, 'Status') || '').trim();

  const baseReturn = {
    bookingId:     _val(row, cm, 'ID', 0),
    date:          dateStr,
    start:         _toHHMM(_val(row, cm, 'Início', 2)),
    end:           _toHHMM(_val(row, cm, 'Fim',    3)),
    name:          _val(row, cm, 'Nome',     7),
    email:         _val(row, cm, 'E-mail',   8),
    whatsapp:      _val(row, cm, 'WhatsApp', 9),
    package:       _val(row, cm, 'Pacote',   4),
    numBailarinas: Number(_val(row, cm, 'Nº Bailarinas')) || 1,
    valor:         parseFloat(_val(row, cm, 'Valor (R$)', 6)) || 0,
  };

  // Idempotência — já confirmado, não reescreve nem redispara nada.
  if (prevStatus === 'Confirmado') {
    return Object.assign({ ok: true, alreadyConfirmed: true }, baseReturn);
  }

  const allSessions = splitCsv(_val(row, cm, 'Stripe Session', 13));
  sa.getRange(shRow, _col1(cm, 'Stripe Payment', 15)).setValue(stripePayment || ('admin-manual-' + Date.now()));
  sa.getRange(shRow, _col1(cm, 'Status',         16)).setValue('Confirmado');
  sa.getRange(shRow, _col1(cm, 'Atualizado em',  18)).setValue(nowIso());
  // Marca todas as sessions como pagas (pra UI do split refletir 100% pago).
  if (cm['Sessões Pagas'] !== undefined && allSessions.length > 0) {
    sa.getRange(shRow, cm['Sessões Pagas'] + 1).setValue(allSessions.join(','));
  }

  buildClientesSheet();
  addLog('CONFIRMACAO_MANUAL', baseReturn.bookingId,
    'Admin confirmou manualmente (estava ' + prevStatus + ', ' + (allSessions.length || 1) + ' pagador(es))', 'painel');

  return Object.assign({ ok: true, alreadyConfirmed: false }, baseReturn);
}

function cancelBooking(data) {
  const { bookingId, reason, origin } = data;
  const sa = getSheet('Agendamentos');
  if (!sa || sa.getLastRow() < 2) throw new Error('Planilha vazia');

  const cm      = _colMap(sa);
  const numCols = sa.getLastColumn();
  const rows    = sa.getRange(2, 1, sa.getLastRow() - 1, numCols).getValues();
  const iId     = cm['ID'] !== undefined ? cm['ID'] : 0;
  const idx     = rows.findIndex(r => r[iId] === bookingId);
  if (idx < 0) throw new Error('Booking não encontrado: ' + bookingId);

  const shRow = idx + 2;
  sa.getRange(shRow, _col1(cm, 'Status',        16)).setValue('Cancelado');
  sa.getRange(shRow, _col1(cm, 'Atualizado em', 18)).setValue(nowIso());

  try { buildClientesSheet(); } catch (e) { addLog('CLIENTES_REBUILD_ERRO', bookingId, String(e), 'sistema'); }
  addLog('CANCELADO', bookingId, reason || 'sem motivo', origin || 'painel');
  return { ok: true };
}

/**
 * Multi-pagador: substitui UMA das sessions do split por uma nova,
 * mantendo as outras intactas. Usado quando Mari clica "Regerar link
 * do pagador X" no painel — Vercel já cancelou o link antigo no gateway
 * e criou um novo, aqui só atualizamos o ID na Sheet.
 *
 * Falha (defensivamente) se a session antiga já está em "Sessões Pagas"
 * (não faz sentido regerar um link que já foi pago).
 */
function regenerateSplitLink(data) {
  const { bookingId, oldStripeSession, newStripeSession } = data;
  if (!bookingId || !oldStripeSession || !newStripeSession) {
    throw new Error('Parâmetros faltando: bookingId/oldStripeSession/newStripeSession');
  }
  const sa = getSheet('Agendamentos');
  if (!sa || sa.getLastRow() < 2) throw new Error('Planilha vazia');

  const cm      = _colMap(sa);
  const numCols = sa.getLastColumn();
  const rows    = sa.getRange(2, 1, sa.getLastRow() - 1, numCols).getValues();
  const iId     = cm['ID'] !== undefined ? cm['ID'] : 0;
  const idx     = rows.findIndex(function(r) { return r[iId] === bookingId; });
  if (idx < 0) throw new Error('Booking não encontrado: ' + bookingId);

  const row   = rows[idx];
  const shRow = idx + 2;
  const splitCsv = function(v) {
    return String(v || '').split(',').map(function(s) { return s.trim(); }).filter(function(s) { return !!s; });
  };
  const sessions = splitCsv(_val(row, cm, 'Stripe Session', 13));
  const paidSet  = {};
  splitCsv(_val(row, cm, 'Sessões Pagas')).forEach(function(s) { paidSet[s] = true; });

  const pos = sessions.indexOf(oldStripeSession);
  if (pos < 0) throw new Error('Session antiga não está nessa reserva: ' + oldStripeSession);
  if (paidSet[oldStripeSession]) throw new Error('Esta parte já foi paga — não pode regerar');

  sessions[pos] = newStripeSession;
  sa.getRange(shRow, _col1(cm, 'Stripe Session', 13)).setValue(sessions.join(','));
  sa.getRange(shRow, _col1(cm, 'Atualizado em',  18)).setValue(nowIso());
  addLog('LINK_REGERADO', bookingId,
    'Pagador ' + (pos + 1) + '/' + sessions.length + ' — ' + oldStripeSession + ' → ' + newStripeSession,
    'painel');
  return { ok: true, sessions: sessions, position: pos };
}

function editBooking(data) {
  const { bookingId, name, email, whatsapp,
          instagram, instagramBailarina, nomeBailarina, numBailarinas } = data;
  const sa = getSheet('Agendamentos');
  if (!sa || sa.getLastRow() < 2) throw new Error('Planilha vazia');

  const cm      = _colMap(sa);
  const numCols = sa.getLastColumn();
  const rows    = sa.getRange(2, 1, sa.getLastRow() - 1, numCols).getValues();
  const iId     = cm['ID'] !== undefined ? cm['ID'] : 0;
  const idx     = rows.findIndex(r => r[iId] === bookingId);
  if (idx < 0) throw new Error('Booking não encontrado: ' + bookingId);

  const shRow = idx + 2;
  const setIf = (header, fallback1, value) => {
    const col = cm[header] !== undefined ? cm[header] + 1 : fallback1;
    // Para colunas Instagram/Bailarina, só escreve se header existe (-1 = skip)
    if (col > 0) sa.getRange(shRow, col).setValue(value);
  };
  setIf('Nome',                 8,  name);
  setIf('E-mail',               9,  email);
  setIf('WhatsApp',             10, whatsapp || '');
  // Estas três só existem no schema novo — não cria coluna se header não existir
  if (cm['Instagram Cliente']    !== undefined) sa.getRange(shRow, cm['Instagram Cliente']    + 1).setValue(instagram          || '');
  if (cm['Instagram Bailarina']  !== undefined) sa.getRange(shRow, cm['Instagram Bailarina']  + 1).setValue(instagramBailarina || '');
  if (cm['Nome Bailarina']       !== undefined) sa.getRange(shRow, cm['Nome Bailarina']       + 1).setValue(nomeBailarina      || '');
  if (cm['Nº Bailarinas']        !== undefined && numBailarinas !== undefined) {
    sa.getRange(shRow, cm['Nº Bailarinas'] + 1).setValue(Number(numBailarinas) || 1);
  }
  sa.getRange(shRow, _col1(cm, 'Atualizado em', 18)).setValue(nowIso());

  buildClientesSheet();
  addLog('EDITADO', bookingId, 'Dados atualizados: ' + name, 'painel');

  return { ok: true, bookingId: bookingId };
}

function releasePendingSlots() {
  // Agora delegado para processReminders (mantido por compatibilidade)
  processReminders();
  return { ok: true };
}

// ── Backup ────────────────────────────────────────────────────
// Cria um arquivo NOVO de planilha no Drive com cópia integral
// da aba "Agendamentos" (valores + formatação). Não toca em nada.
// Logs no painel. Retorna a URL do backup no log de execução.
function backupAgendamentos() {
  const src = getSheet('Agendamentos');
  if (!src) throw new Error('Aba Agendamentos não encontrada');

  const stamp = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm');
  const name  = 'Agendamentos backup ' + stamp;
  const dest  = SpreadsheetApp.create(name);

  // Copia a aba original para o destino e remove a "Sheet1" default
  const copied = src.copyTo(dest);
  copied.setName('Agendamentos');
  const def = dest.getSheetByName('Sheet1') || dest.getSheets()[0];
  if (def && def.getName() !== 'Agendamentos') dest.deleteSheet(def);

  const url = dest.getUrl();
  Logger.log('Backup criado: ' + url);
  addLog('BACKUP_CRIADO', '', 'Arquivo: ' + name + ' | URL: ' + url, 'sistema');
  return url;
}

// ── Cleanup ───────────────────────────────────────────────────
// Mantém em "Agendamentos" só Confirmado + Pendente.
// Tudo o mais (Cancelado, Expirado, lixo com status inválido) vai
// pra "Agendamentos Arquivados" com timestamp de arquivamento.
// RODAR DEPOIS DE backupAgendamentos().
function cleanupAgendamentos() {
  const sa = getSheet('Agendamentos');
  if (!sa) throw new Error('Aba Agendamentos não encontrada');
  if (sa.getLastRow() < 2) {
    Logger.log('Nada a fazer — planilha vazia');
    return { kept: 0, archived: 0 };
  }

  const numCols = sa.getLastColumn();
  const hdrs    = sa.getRange(1, 1, 1, numCols).getValues()[0];
  const rows    = sa.getRange(2, 1, sa.getLastRow() - 1, numCols).getValues();

  // Detecta coluna Status dinamicamente (header-based)
  let iStatus = hdrs.findIndex(h => String(h).trim() === 'Status');
  if (iStatus < 0) {
    const hasInsta = hdrs.findIndex(h => String(h).trim() === 'Instagram Cliente') >= 0;
    iStatus = hasInsta ? 15 : 12;
  }

  const VALID = { 'Confirmado': true, 'Pendente': true };
  const kept    = [];
  const archive = [];
  rows.forEach(function (r) {
    const status = String(r[iStatus] || '').trim();
    if (VALID[status]) kept.push(r); else archive.push(r);
  });

  // Garante aba de arquivo
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let arch = ss.getSheetByName('Agendamentos Arquivados');
  if (!arch) {
    arch = ss.insertSheet('Agendamentos Arquivados');
    arch.setTabColor('#9E9E9E');
    arch.appendRow([].concat(hdrs, ['Arquivado em']));
    arch.getRange(1, 1, 1, hdrs.length + 1)
      .setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff');
    arch.setFrozenRows(1);
  }

  // Anexa linhas arquivadas com timestamp
  if (archive.length > 0) {
    const now = nowIso();
    const archRows = archive.map(function (r) { return [].concat(r, [now]); });
    const startRow = arch.getLastRow() + 1;
    arch.getRange(startRow, 1, archRows.length, archRows[0].length).setValues(archRows);
  }

  // Reescreve Agendamentos só com as linhas mantidas
  sa.getRange(2, 1, sa.getLastRow() - 1, numCols).clearContent();
  if (kept.length > 0) {
    sa.getRange(2, 1, kept.length, numCols).setValues(kept);
  }

  const msg = 'Mantidas: ' + kept.length + ' | Arquivadas: ' + archive.length;
  Logger.log(msg);
  addLog('CLEANUP_EXECUTADO', '', msg, 'sistema');
  return { kept: kept.length, archived: archive.length };
}

// ── Reenvia o email de confirmação de uma reserva ─────────────
// Lê os dados da reserva pelo bookingId e envia o mesmo HTML do
// webhook, com CC para André + Mariane por padrão.
function resendBookingConfirmationEmail(bookingId, extraCc) {
  const sa = getSheet('Agendamentos');
  if (!sa) throw new Error('Aba Agendamentos não encontrada');

  const cm      = _colMap(sa);
  const numCols = sa.getLastColumn();
  const rows    = sa.getRange(2, 1, sa.getLastRow() - 1, numCols).getValues();
  const iId     = cm['ID'] !== undefined ? cm['ID'] : 0;
  const idx     = rows.findIndex(r => r[iId] === bookingId);
  if (idx < 0) throw new Error('Booking não encontrado: ' + bookingId);
  const row = rows[idx];

  const pkgKey   = _val(row, cm, 'Pacote', 4);
  const pkg      = CFG.PACKAGES[pkgKey] || { name: pkgKey, duration: 0, price: 0 };
  const dataRaw  = _val(row, cm, 'Data', 1);
  const dateStr  = dataRaw ? (typeof dataRaw === 'string'
                    ? dataRaw
                    : Utilities.formatDate(dataRaw, 'America/Sao_Paulo', 'yyyy-MM-dd')) : '';
  const start    = _toHHMM(_val(row, cm, 'Início', 2));
  const endTime  = _toHHMM(_val(row, cm, 'Fim',    3));
  const name     = String(_val(row, cm, 'Nome',  7) || '');
  const email    = String(_val(row, cm, 'E-mail', 8) || '').trim();
  const numB     = Number(_val(row, cm, 'Nº Bailarinas')) || 1;
  const valorNum = parseFloat(_val(row, cm, 'Valor (R$)', 6)) || (pkg.price / 100);
  const valorLabel = 'R$ ' + valorNum.toLocaleString('pt-BR', { minimumFractionDigits: 2 });

  if (!email) throw new Error('Reserva não tem email cadastrado');

  // CC default: André + Mariane. Pode adicionar mais com extraCc (string separada por vírgula).
  const ccList = [CFG.ANDRE_EMAIL, CFG.MARIANE_EMAIL];
  if (extraCc) String(extraCc).split(',').forEach(e => { const t = e.trim(); if (t) ccList.push(t); });
  const cc = ccList.join(',');

  const HERO_IMG_URL = 'https://www.ensaiofotograficoemjoinville.com/email-hero.jpg';
  const firstName    = String(name || '').trim().split(/\s+/)[0] || name;
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Reserva confirmada</title>
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
          <span style="display:inline-block;font-family:Georgia,'Times New Roman',serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#7a3f8f;border:1px solid #e8d8f0;border-radius:30px;padding:6px 16px;">Reserva Confirmada</span>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 40px 4px;text-align:center;">
          <p style="margin:0;font-family:Georgia,'Cormorant Garamond',serif;font-size:30px;line-height:1.2;color:#1a1a1a;font-weight:400;font-style:italic;">Olá, <strong style="font-weight:600;">${firstName}</strong>.</p>
        </td>
      </tr>
      <tr>
        <td style="padding:18px 56px 32px;text-align:center;">
          <p style="margin:0;font-family:Georgia,serif;font-size:14px;line-height:1.65;color:#555;">Recebemos sua reserva. Os detalhes do seu ensaio estão registrados abaixo — guarde este e-mail para referência.</p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px 8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #eee;">
            <tr><td style="padding:18px 0;border-bottom:1px solid #eee;">
              <p style="margin:0 0 4px;font-family:Georgia,serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">Data</p>
              <p style="margin:0;font-family:Georgia,serif;font-size:16px;color:#1a1a1a;">${_fmtDateLong(dateStr)}</p>
            </td></tr>
            <tr><td style="padding:18px 0;border-bottom:1px solid #eee;">
              <p style="margin:0 0 4px;font-family:Georgia,serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">Horário</p>
              <p style="margin:0;font-family:Georgia,serif;font-size:16px;color:#1a1a1a;">${start} — ${endTime}</p>
            </td></tr>
            <tr><td style="padding:18px 0;border-bottom:1px solid #eee;">
              <p style="margin:0 0 4px;font-family:Georgia,serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">Pacote</p>
              <p style="margin:0;font-family:Georgia,serif;font-size:16px;color:#1a1a1a;">${pkg.name} · ${pkg.duration} minutos</p>
            </td></tr>
            <tr><td style="padding:18px 0;border-bottom:1px solid #eee;">
              <p style="margin:0 0 4px;font-family:Georgia,serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">Grupo</p>
              <p style="margin:0;font-family:Georgia,serif;font-size:16px;color:#1a1a1a;">${numB} ${numB === 1 ? 'bailarina' : 'bailarinas'}</p>
            </td></tr>
            <tr><td style="padding:18px 0;border-bottom:1px solid #eee;">
              <p style="margin:0 0 4px;font-family:Georgia,serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">Local</p>
              <p style="margin:0;font-family:Georgia,serif;font-size:16px;color:#1a1a1a;"><a href="https://www.google.com/maps/search/Hotel+Le+Village+Joinville+SC" style="color:#1a1a1a;text-decoration:none;">Hotel Le Village</a></p>
              <p style="margin:2px 0 0;font-family:Georgia,serif;font-size:13px;color:#777;">Sala Esmeralda · Joinville · SC</p>
            </td></tr>
            <tr><td style="padding:18px 0;">
              <p style="margin:0 0 4px;font-family:Georgia,serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">Valor</p>
              <p style="margin:0;font-family:Georgia,serif;font-size:18px;color:#7a3f8f;font-weight:600;">${valorLabel}</p>
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
          <p style="margin:0;font-family:Georgia,serif;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#bbb;">Código da reserva · <span style="color:#777;font-family:monospace;letter-spacing:1px;">${bookingId}</span></p>
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

  MailApp.sendEmail({
    to:       email,
    cc:       cc,
    subject:  `Reserva confirmada — ${pkg.name} · ${formatDateBR(dateStr)} às ${start}`,
    htmlBody: html,
  });
  addLog('CONFIRMACAO_REENVIADA', bookingId,
    'Reenvio para ' + email + ' (CC: ' + cc + ')', 'painel');
  return { ok: true, to: email, cc: cc };
}

// ── Preview do email de confirmação (NÃO envia ao cliente) ────
// Útil pra testar mudanças visuais sem incomodar o cliente.
// Manda só pra você (TO) e Mari (CC). Por padrão usa a reserva
// AG-MP4NLPGZ (Adrielly). Pra usar outra, passe o bookingId.
function previewConfirmationEmail(bookingId) {
  const targetId = bookingId || 'AG-MP4NLPGZ';

  const sa = getSheet('Agendamentos');
  if (!sa) throw new Error('Aba Agendamentos não encontrada');
  const cm      = _colMap(sa);
  const numCols = sa.getLastColumn();
  const rows    = sa.getRange(2, 1, sa.getLastRow() - 1, numCols).getValues();
  const iId     = cm['ID'] !== undefined ? cm['ID'] : 0;
  const idx     = rows.findIndex(r => r[iId] === targetId);
  if (idx < 0) throw new Error('Booking não encontrado: ' + targetId);
  const row = rows[idx];

  const pkgKey   = _val(row, cm, 'Pacote', 4);
  const pkg      = CFG.PACKAGES[pkgKey] || { name: pkgKey, duration: 0, price: 0 };
  const dataRaw  = _val(row, cm, 'Data', 1);
  const dateStr  = dataRaw ? (typeof dataRaw === 'string'
                    ? dataRaw
                    : Utilities.formatDate(dataRaw, 'America/Sao_Paulo', 'yyyy-MM-dd')) : '';
  const start    = _toHHMM(_val(row, cm, 'Início', 2));
  const endTime  = _toHHMM(_val(row, cm, 'Fim',    3));
  const name     = String(_val(row, cm, 'Nome',  7) || '');
  const numB     = Number(_val(row, cm, 'Nº Bailarinas')) || 1;
  const valorNum = parseFloat(_val(row, cm, 'Valor (R$)', 6)) || (pkg.price / 100);
  const valorLabel = 'R$ ' + valorNum.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  const firstName = String(name || '').trim().split(/\s+/)[0] || name;
  const HERO_IMG_URL = 'https://www.ensaiofotograficoemjoinville.com/email-hero.jpg';

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Reserva confirmada</title>
</head>
<body style="margin:0;padding:0;background:#f5f0fa;font-family:Georgia,'Cormorant Garamond','Times New Roman',serif;color:#1a1a1a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f0fa;padding:32px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:6px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
      <tr><td style="background:#fef3c7;color:#92400e;padding:10px;text-align:center;font-family:Georgia,serif;font-size:12px;font-weight:bold;border-bottom:1px solid #fbbf24;">⚠️ PREVIEW — esse email não foi enviado para o cliente</td></tr>
      <tr><td style="line-height:0;"><img src="${HERO_IMG_URL}" alt="" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;"></td></tr>
      <tr><td style="padding:36px 40px 0;text-align:center;"><span style="display:inline-block;font-family:Georgia,'Times New Roman',serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#7a3f8f;border:1px solid #e8d8f0;border-radius:30px;padding:6px 16px;">Reserva Confirmada</span></td></tr>
      <tr><td style="padding:24px 40px 4px;text-align:center;"><p style="margin:0;font-family:Georgia,'Cormorant Garamond',serif;font-size:30px;line-height:1.2;color:#1a1a1a;font-weight:400;font-style:italic;">Olá, <strong style="font-weight:600;">${firstName}</strong>.</p></td></tr>
      <tr><td style="padding:18px 56px 32px;text-align:center;"><p style="margin:0;font-family:Georgia,serif;font-size:14px;line-height:1.65;color:#555;">Recebemos sua reserva. Os detalhes do seu ensaio estão registrados abaixo — guarde este e-mail para referência.</p></td></tr>
      <tr><td style="padding:0 40px 8px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #eee;">
          <tr><td style="padding:18px 0;border-bottom:1px solid #eee;"><p style="margin:0 0 4px;font-family:Georgia,serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">Data</p><p style="margin:0;font-family:Georgia,serif;font-size:16px;color:#1a1a1a;">${_fmtDateLong(dateStr)}</p></td></tr>
          <tr><td style="padding:18px 0;border-bottom:1px solid #eee;"><p style="margin:0 0 4px;font-family:Georgia,serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">Horário</p><p style="margin:0;font-family:Georgia,serif;font-size:16px;color:#1a1a1a;">${start} — ${endTime}</p></td></tr>
          <tr><td style="padding:18px 0;border-bottom:1px solid #eee;"><p style="margin:0 0 4px;font-family:Georgia,serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">Pacote</p><p style="margin:0;font-family:Georgia,serif;font-size:16px;color:#1a1a1a;">${pkg.name} · ${pkg.duration} minutos</p></td></tr>
          <tr><td style="padding:18px 0;border-bottom:1px solid #eee;"><p style="margin:0 0 4px;font-family:Georgia,serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">Grupo</p><p style="margin:0;font-family:Georgia,serif;font-size:16px;color:#1a1a1a;">${numB} ${numB === 1 ? 'bailarina' : 'bailarinas'}</p></td></tr>
          <tr><td style="padding:18px 0;border-bottom:1px solid #eee;"><p style="margin:0 0 4px;font-family:Georgia,serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">Local</p><p style="margin:0;font-family:Georgia,serif;font-size:16px;color:#1a1a1a;"><a href="https://www.google.com/maps/search/Hotel+Le+Village+Joinville+SC" style="color:#1a1a1a;text-decoration:none;">Hotel Le Village</a></p><p style="margin:2px 0 0;font-family:Georgia,serif;font-size:13px;color:#777;">Sala Esmeralda · Joinville · SC</p></td></tr>
          <tr><td style="padding:18px 0;"><p style="margin:0 0 4px;font-family:Georgia,serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">Valor</p><p style="margin:0;font-family:Georgia,serif;font-size:18px;color:#7a3f8f;font-weight:600;">${valorLabel}</p></td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:32px 40px 24px;text-align:center;border-top:1px solid #eee;"><p style="margin:0;font-family:Georgia,serif;font-size:13px;line-height:1.6;color:#666;">Em caso de dúvida ou necessidade de remarcação, fale conosco pelo</p><p style="margin:6px 0 0;font-family:Georgia,serif;font-size:14px;line-height:1.6;"><a href="https://wa.me/5511519606272" style="color:#128C7E;text-decoration:none;font-weight:600;white-space:nowrap;">WhatsApp (11) 5196-0627</a></p></td></tr>
      <tr><td style="padding:0 40px 24px;text-align:center;"><p style="margin:0;font-family:Georgia,serif;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#bbb;">Código da reserva · <span style="color:#777;font-family:monospace;letter-spacing:1px;">${targetId}</span></p></td></tr>
      <tr><td style="padding:20px 40px 28px;text-align:center;background:#fafafa;border-top:1px solid #eee;"><p style="margin:0;font-family:Georgia,serif;font-size:12px;color:#999;">© 2026 André Ferreira Fotografia</p><p style="margin:4px 0 0;font-family:Georgia,serif;font-size:12px;"><a href="https://www.instagram.com/affotografia" style="color:#7a3f8f;text-decoration:none;">@affotografia</a></p></td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  MailApp.sendEmail({
    to:       CFG.ANDRE_EMAIL,
    subject:  `[PREVIEW] Reserva confirmada — ${pkg.name} · ${formatDateBR(dateStr)} às ${start}`,
    htmlBody: html,
  });
  Logger.log('Preview enviado só para ' + CFG.ANDRE_EMAIL);
  addLog('PREVIEW_EMAIL', targetId, 'Preview do template enviado para ' + CFG.ANDRE_EMAIL, 'sistema');
  return { ok: true, sentTo: CFG.ANDRE_EMAIL };
}

// ── Diagnóstico: simula o cálculo de slots ────────────────────
// Roda direto do editor (não precisa deploy) e mostra:
//  - O que getBookingsForDate enxerga
//  - Quais slots ficam disponíveis pra cada pacote
function debugSlotsFor(dateStr) {
  if (!dateStr) dateStr = '2026-07-26'; // muda aqui se quiser testar outra data
  const blocked = getBookingsForDate(dateStr);
  Logger.log('Data testada: ' + dateStr);
  Logger.log('Reservas que bloqueiam slots: ' + JSON.stringify(blocked.map(b => ({
    inicio: minToTime(b.start), fim: minToTime(b.end)
  }))));
  Object.keys(CFG.PACKAGES).forEach(k => {
    const slots = computeAvailableSlots(dateStr, k);
    Logger.log(k + ' (' + slots.length + ' slots): ' + slots.join(', '));
  });
}

// ── Diagnóstico: inspecionar headers atuais ───────────────────
// Roda e mostra no Execution log o nome de cada coluna e
// uma amostra da 1ª linha de dados, para você verificar se há
// desalinhamento entre headers e valores.
function inspectAgendamentosHeaders() {
  const sa = getSheet('Agendamentos');
  if (!sa) { Logger.log('Aba não existe'); return; }
  const numCols = sa.getLastColumn();
  const hdrs = sa.getRange(1, 1, 1, numCols).getValues()[0];
  const sample = sa.getLastRow() >= 2
    ? sa.getRange(2, 1, 1, numCols).getValues()[0]
    : new Array(numCols).fill('');
  const lines = ['col | letter | header | sample'];
  for (let i = 0; i < numCols; i++) {
    const letter = String.fromCharCode(65 + (i % 26)) +
                   (i >= 26 ? String.fromCharCode(65 + Math.floor(i / 26) - 1) : '');
    const h = hdrs[i] === undefined || hdrs[i] === '' ? '(vazio)' : String(hdrs[i]);
    const v = sample[i] instanceof Date
              ? Utilities.formatDate(sample[i], 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm')
              : String(sample[i] || '').slice(0, 40);
    lines.push((i + 1).toString().padStart(2) + '  | ' + letter.padEnd(3) + '   | ' + h.padEnd(22) + ' | ' + v);
  }
  const out = lines.join('\n');
  Logger.log(out);
  addLog('SCHEMA_INSPECIONADO', '', 'numCols=' + numCols + ' | headers=[' + hdrs.join('|') + ']', 'sistema');
  return out;
}

// ── Reparo de headers + limpeza de reminder columns ───────────
// 1) Adiciona headers em colunas "tail" que estiverem vazias
//    (Rem1Sent, Rem2Sent, Rem3Sent, AndreNotified, ExpiryWarnSent, Source)
// 2) Limpa o lixo em Rem1..ExpiryWarnSent (dados embaralhados de versões antigas)
// 3) Para cada Pendente, marca os reminders cujo prazo JÁ PASSOU
//    com o "Atualizado em" — assim o processReminders não dispara
//    emails atrasados em massa.
function repairHeaders() {
  const sa = getSheet('Agendamentos');
  if (!sa) throw new Error('Aba Agendamentos não existe');
  const numCols = Math.max(sa.getLastColumn(), 23);
  const hdrs    = sa.getRange(1, 1, 1, numCols).getValues()[0];

  const expectedNew = ['ID','Data','Início','Fim','Pacote','Duração (min)','Valor (R$)',
                       'Nome','E-mail','WhatsApp','Instagram Cliente','Instagram Bailarina','Nome Bailarina',
                       'Stripe Session','Stripe Payment','Status','Criado em','Atualizado em',
                       'Rem1Sent','Rem2Sent','Rem3Sent','AndreNotified','ExpiryWarnSent','Source'];
  const expectedOld = ['ID','Data','Início','Fim','Pacote','Duração (min)','Valor (R$)',
                       'Nome','E-mail','WhatsApp','Stripe Session','Stripe Payment','Status','Criado em','Atualizado em',
                       'Rem1Sent','Rem2Sent','Rem3Sent','AndreNotified','ExpiryWarnSent','Source'];

  const statusIdx = hdrs.findIndex(h => String(h).trim() === 'Status');
  let expected;
  if (statusIdx === 15) expected = expectedNew;
  else if (statusIdx === 12) expected = expectedOld;
  else throw new Error('Não consigo determinar schema. Rode inspectAgendamentosHeaders primeiro.');

  // ── 1. Adiciona headers faltantes ───────────────────────────
  const newHdrs = hdrs.slice();
  let headersAdded = 0;
  for (let i = 0; i < expected.length; i++) {
    const cur = String(newHdrs[i] || '').trim();
    if (!cur) { newHdrs[i] = expected[i]; headersAdded++; }
  }
  while (newHdrs.length < expected.length) newHdrs.push('');
  sa.getRange(1, 1, 1, newHdrs.length).setValues([newHdrs]);
  sa.getRange(1, 1, 1, newHdrs.length)
    .setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff');

  // Re-lê headers para construir o map atualizado
  const cm = _colMap(sa);

  // ── 2. Limpa as 5 colunas de reminders + Source nas linhas de dados ──
  if (sa.getLastRow() >= 2) {
    const reminderCols = ['Rem1Sent','Rem2Sent','Rem3Sent','AndreNotified','ExpiryWarnSent'];
    reminderCols.forEach(name => {
      const col1 = _col1(cm, name, -1);
      if (col1 > 0) {
        sa.getRange(2, col1, sa.getLastRow() - 1, 1).clearContent();
      }
    });
  }

  // ── 3. Inibe lembretes para Pendentes velhos ────────────────
  let inhibited = 0;
  if (sa.getLastRow() >= 2) {
    const rows = sa.getRange(2, 1, sa.getLastRow() - 1, sa.getLastColumn()).getValues();
    const now  = Date.now();
    rows.forEach((row, i) => {
      const status = String(_val(row, cm, 'Status') || '').trim();
      if (status !== 'Pendente') return;
      const criadoEm = _val(row, cm, 'Criado em');
      if (!criadoEm) return;
      const rowNum = i + 2;
      const ageMin = (now - new Date(criadoEm).getTime()) / 60000;
      const stamp  = nowIso();
      // Site 30min
      if (ageMin >= 30) {
        const c = _col1(cm, 'AndreNotified', -1);
        if (c > 0) sa.getRange(rowNum, c).setValue(stamp);
      }
      // Admin 48h
      if (ageMin >= 48 * 60) {
        const c = _col1(cm, 'Rem1Sent', -1);
        if (c > 0) sa.getRange(rowNum, c).setValue(stamp);
      }
      // Expiry warning (8h antes do prazo de 72h)
      if (ageMin >= (CFG.PENDING_BLOCK_H * 60 - 8 * 60)) {
        const c = _col1(cm, 'ExpiryWarnSent', -1);
        if (c > 0) sa.getRange(rowNum, c).setValue(stamp);
      }
      inhibited++;
    });
  }

  const msg = 'Schema: ' + (expected === expectedNew ? 'novo' : 'antigo') +
              ' | headers adicionados: ' + headersAdded +
              ' | linhas Pendente com reminders inibidos: ' + inhibited;
  Logger.log(msg);
  addLog('HEADERS_REPARADOS', '', msg, 'sistema');
  return msg;
}

// ── Diagnóstico: envia email de confirmação SAMPLE via Resend ───
// Manda pro CFG.ANDRE_EMAIL um email igual ao que o cliente recebe
// quando o pagamento é confirmado. Usa o mesmo path (Resend) do
// resto dos emails do Apps Script — bom pra verificar se a
// configuração de envio está OK.
function sendTestConfirmationEmail() {
  const fakeBooking = {
    id:        'AG-TESTE-XYZ',
    nome:      'TESTE — André',
    email:     CFG.ANDRE_EMAIL,
    whatsapp:  '(47) 99999-9999',
    data:      '2026-07-28',
    inicio:    '14:00',
    fim:       '16:00',
    pacote:    'completo',
    valor:     '2200.00',
    nomeBailarina:      'Bailarina Teste',
    instagramBailarina: '@bailarina_teste',
    numBailarinas:      2,
    criadoEm:  new Date().toISOString(),
  };
  const pkgInfo = CFG.PACKAGES[fakeBooking.pacote];
  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
<div style="background:#fef3c7;border:1px solid #fbbf24;color:#92400e;padding:12px;text-align:center;font-size:12px;font-weight:bold;">
  ⚠️ EMAIL DE TESTE — não é uma reserva real
</div>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
  ${_emailHeader('✅ Reserva Confirmada')}
  <tr><td style="padding:28px 40px;">
    <p style="color:#374151;font-size:15px;margin:0 0 12px;">Olá, <strong>${fakeBooking.nome}</strong>!</p>
    <p style="color:#6b7280;font-size:14px;margin:0 0 20px;">Seu pagamento foi confirmado e sua reserva está garantida. Anote os detalhes abaixo.</p>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
      ${_bookingSummaryRows(fakeBooking)}
    </div>
    <p style="color:#9ca3af;font-size:12px;margin:0;">ID: ${fakeBooking.id}</p>
  </td></tr>
  ${_emailFooter()}
</table>
</td></tr>
</table>
</body></html>`;
  const ok = sendEmailViaResend(CFG.ANDRE_EMAIL,
    `[TESTE] Reserva confirmada — ${pkgInfo.name} · 28/07/2026 às 14:00`,
    html);
  const msg = ok
    ? 'Email enviado pra ' + CFG.ANDRE_EMAIL + ' via Resend — confira caixa de entrada + spam'
    : 'Falha ao enviar — veja Execution log';
  Logger.log(msg);
  addLog('TEST_EMAIL_ENVIADO', '', msg, 'sistema');
  return msg;
}

// ── Diagnóstico: envia os emails INTERNOS (André + Mariane) ────
// Mesmas mensagens disparadas pelo webhook quando o cliente paga
// via site, mas via Resend (em vez de Gmail SMTP do webhook).
function sendTestInternalNotifications() {
  const fake = {
    name:          'Cliente Teste',
    email:         'cliente.teste@example.com',
    whatsapp:      '(47) 99999-9999',
    date:          '2026-07-28',
    time:          '14:00',
    endTime:       '16:00',
    packageName:   'Completo',
    duration:      120,
    price:         2200,
    installments:  3,
    bookingId:     'AG-TESTE-XYZ',
    paymentId:     'TEST-MP-1234567',
    numBailarinas: 2,
    nomeBailarina: 'Bailarina Teste',
  };

  // Email pro André (texto simples)
  const andreHtml = `
<div style="background:#fef3c7;border:1px solid #fbbf24;color:#92400e;padding:12px;text-align:center;font-size:12px;font-weight:bold;margin-bottom:12px;">
  ⚠️ EMAIL DE TESTE — não é uma reserva real
</div>
<p><strong>Nova reserva confirmada</strong><br>
Cliente: ${fake.name}<br>
E-mail: ${fake.email}<br>
WhatsApp: ${fake.whatsapp}<br>
Data: ${formatDateBR(fake.date)}<br>
Horário: ${fake.time}–${fake.endTime}<br>
Pacote: ${fake.packageName}<br>
Nº Bailarinas: ${fake.numBailarinas}<br>
Valor: R$ ${fake.price}<br>
Parcelas: ${fake.installments}x<br>
Booking ID: ${fake.bookingId}<br>MP Payment: ${fake.paymentId}</p>`;

  const okAndre = sendEmailViaResend(CFG.ANDRE_EMAIL,
    `[TESTE] Nova reserva: ${fake.name} — ${fake.packageName} 28/07/2026 ${fake.time}`,
    andreHtml);

  // Email pra Mariane (template HTML cuidado)
  const marianeHtml = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
<div style="background:#fef3c7;border:1px solid #fbbf24;color:#92400e;padding:12px;text-align:center;font-size:12px;font-weight:bold;">
  ⚠️ EMAIL DE TESTE — não é uma reserva real
</div>
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
          <td style="font-weight:600;font-size:13px;">${fake.name}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">E-mail</td>
          <td style="font-size:13px;">${fake.email}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">WhatsApp</td>
          <td style="font-weight:600;font-size:14px;color:#7a3f8f;">${fake.whatsapp}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">Pacote</td>
          <td style="font-size:13px;">${fake.packageName}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">Nº Bailarinas</td>
          <td style="font-weight:600;font-size:13px;">${fake.numBailarinas}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">Data</td>
          <td style="font-size:13px;">${formatDateBR(fake.date)} às ${fake.time} – ${fake.endTime}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;border-top:1px solid #e5e7eb;">Valor pago</td>
          <td style="font-weight:700;font-size:14px;color:#7a3f8f;border-top:1px solid #e5e7eb;">R$ ${fake.price.toFixed(2).replace('.', ',')} em ${fake.installments}x</td></tr>
    </table>
    <p style="font-size:12px;color:#9ca3af;margin-top:16px;border-top:1px solid #f0f0f0;padding-top:12px;">
      Booking ID: ${fake.bookingId}
    </p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  const okMari = sendEmailViaResend(CFG.MARIANE_EMAIL,
    `[TESTE] ✅ ${fake.name} concluiu o pagamento — ${fake.packageName} · ${formatDateBR(fake.date)} às ${fake.time}`,
    marianeHtml);

  const msg = 'André: ' + (okAndre ? 'ok' : 'FALHOU') +
              ' | Mariane: ' + (okMari ? 'ok' : 'FALHOU');
  Logger.log(msg);
  addLog('TEST_INTERNAL_NOTIF', '', msg, 'sistema');
  return msg;
}

// ── Migração: adiciona coluna "Nº Bailarinas" ────────────────
// Insere a coluna logo após "Nome Bailarina" (ou no fim se não achar).
// Preenche 1 como default em todas as linhas existentes.
// Idempotente: se a coluna já existir, só retorna sem mexer.
function migrateAddNumBailarinas() {
  const sa = getSheet('Agendamentos');
  if (!sa) throw new Error('Aba Agendamentos não existe');

  const numCols = sa.getLastColumn();
  const hdrs    = sa.getRange(1, 1, 1, numCols).getValues()[0];
  if (hdrs.findIndex(h => String(h).trim() === 'Nº Bailarinas') >= 0) {
    const msg = 'Coluna já existe — nada a fazer';
    Logger.log(msg); return msg;
  }

  // Acha a posição (1-indexed) de "Nome Bailarina" para inserir depois
  const nomeBIdx = hdrs.findIndex(h => String(h).trim() === 'Nome Bailarina');
  const insertAfter = nomeBIdx >= 0 ? (nomeBIdx + 1) : numCols; // 1-indexed
  sa.insertColumnAfter(insertAfter);
  const newColPos = insertAfter + 1;

  // Header
  sa.getRange(1, newColPos).setValue('Nº Bailarinas')
    .setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff');

  // Preenche 1 em todas as linhas de dados
  const lastRow = sa.getLastRow();
  if (lastRow >= 2) {
    const fill = Array.from({ length: lastRow - 1 }, () => [1]);
    sa.getRange(2, newColPos, fill.length, 1).setValues(fill);
  }

  const msg = 'Coluna "Nº Bailarinas" inserida na posição ' + newColPos +
              ' | linhas preenchidas com 1: ' + Math.max(0, lastRow - 1);
  Logger.log(msg);
  addLog('MIGRATION_NUMBAILARINAS', '', msg, 'sistema');
  return msg;
}

// ── Mover "Agendamentos Arquivados" para o backup mais recente ────
// e apagar a aba Sheet1 default da planilha principal, se existir.
function moveArchivedToBackup() {
  const mainSs = SpreadsheetApp.openById(SHEET_ID);
  const src    = mainSs.getSheetByName('Agendamentos Arquivados');
  if (!src) throw new Error('Aba "Agendamentos Arquivados" não existe');

  // Acha o backup mais recente no Drive (criado por backupAgendamentos)
  const it = DriveApp.searchFiles(
    'title contains "Agendamentos backup" and mimeType = "application/vnd.google-apps.spreadsheet" and trashed = false'
  );
  let mostRecent = null;
  while (it.hasNext()) {
    const f = it.next();
    if (!mostRecent || f.getDateCreated() > mostRecent.getDateCreated()) mostRecent = f;
  }
  if (!mostRecent) throw new Error('Nenhum backup encontrado. Rode backupAgendamentos() primeiro.');

  const backupSs = SpreadsheetApp.openById(mostRecent.getId());

  // Se já existir aba "Agendamentos Arquivados" no backup, renomeia a anterior
  const existing = backupSs.getSheetByName('Agendamentos Arquivados');
  if (existing) {
    const stamp = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd HHmm');
    existing.setName('Agendamentos Arquivados (' + stamp + ')');
  }

  // Copia a aba para o backup
  const copied = src.copyTo(backupSs);
  copied.setName('Agendamentos Arquivados');

  // Remove do principal
  mainSs.deleteSheet(src);

  // Limpa Sheet1 do principal se existir e estiver vazio
  let sheet1Removed = false;
  const sheet1 = mainSs.getSheetByName('Sheet1') || mainSs.getSheetByName('Página1');
  if (sheet1 && sheet1.getLastRow() <= 1 && sheet1.getLastColumn() <= 1) {
    // Apps Script não deixa apagar a última aba — protege contra isso
    if (mainSs.getSheets().length > 1) {
      mainSs.deleteSheet(sheet1);
      sheet1Removed = true;
    }
  }

  const url = backupSs.getUrl();
  const msg = 'Movida para: ' + mostRecent.getName() +
              ' (' + url + ')' +
              (sheet1Removed ? ' | Sheet1 removida do principal' : '');
  Logger.log(msg);
  addLog('ARQUIVO_MOVIDO', '', msg, 'sistema');
  return msg;
}

// ── Triggers ──────────────────────────────────────────────────
// Execute setupTriggers() manualmente UMA vez para instalar
// (autoriza acessos quando perguntar)
function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('processReminders').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('onEditAgendamentos')
    .forSpreadsheet(SpreadsheetApp.openById(SHEET_ID))
    .onEdit()
    .create();
  addLog('TRIGGER_INSTALADO', '', 'processReminders (5min) + onEditAgendamentos', 'sistema');
}
// Compat: alias do nome antigo
function setupTrigger() { setupTriggers(); }

// ── onEdit: registra edições manuais na planilha ───────────────
// Disparado automaticamente quando alguém edita uma célula em "Agendamentos".
// Apenas registra no Log — efeitos colaterais (e-mails, etc.) ficam por conta
// das ações do painel admin para evitar envios não autorizados.
function onEditAgendamentos(e) {
  try {
    if (!e || !e.range) return;
    const sh = e.range.getSheet();
    if (sh.getName() !== 'Agendamentos') return;
    const row = e.range.getRow();
    if (row < 2) return; // ignora alteração no cabeçalho

    const numCols = sh.getLastColumn();
    const col     = e.range.getColumn();
    const hdrs    = sh.getRange(1, 1, 1, numCols).getValues()[0];
    const colName = String(hdrs[col - 1] || ('Coluna ' + col)).trim();

    // Evita loop com a coluna que o próprio trigger atualiza
    if (colName === 'Atualizado em') return;

    const id      = sh.getRange(row, 1).getValue();
    const nomeIdx = hdrs.findIndex(h => String(h).trim() === 'Nome');
    const nome    = nomeIdx >= 0 ? sh.getRange(row, nomeIdx + 1).getValue() : '';

    const fmt = v => {
      if (v === undefined || v === null || v === '') return '(vazio)';
      if (v instanceof Date) return Utilities.formatDate(v, 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm');
      return String(v);
    };
    const oldV = fmt(e.oldValue);
    const newV = fmt(e.value);

    let user = 'desconhecido';
    try {
      user = (e.user && e.user.getEmail && e.user.getEmail()) ||
             (Session.getActiveUser && Session.getActiveUser().getEmail()) ||
             'desconhecido';
    } catch (_) {}

    // Toca "Atualizado em" para refletir a edição externa
    const updIdx = hdrs.findIndex(h => String(h).trim() === 'Atualizado em');
    if (updIdx >= 0) sh.getRange(row, updIdx + 1).setValue(nowIso());

    addLog('EDICAO_MANUAL',
           id || '',
           user + ' alterou "' + colName + '" de ' + (nome || '?') +
           ': "' + oldV + '" → "' + newV + '"',
           'planilha');

    // Rebuilda aba Clientes pra refletir a edição manual
    try { buildClientesSheet(); }
    catch (e2) { addLog('CLIENTES_REBUILD_ERRO', id || '', String(e2), 'planilha'); }
  } catch (err) {
    try { addLog('ERRO_ONEDIT', '', String(err && err.message || err), 'planilha'); } catch (_) {}
  }
}

// ── HTTP handlers ─────────────────────────────────────────────
function doGet(e) {
  const action = (e.parameter && e.parameter.action) || '';
  let result;

  try {
    if (action === 'init') {
      return initSheets();
    } else if (action === 'slots') {
      const date = e.parameter.date;
      const pkg  = e.parameter.package;
      if (!date || !pkg) throw new Error('date e package são obrigatórios');
      // 'especial' tem duração livre — chega em &duration=<min>.
      const dur = pkg === 'especial' ? Number(e.parameter.duration) : undefined;
      result = { slots: computeAvailableSlots(date, pkg, dur) };
    } else if (action === 'allSlots') {
      const date = e.parameter.date;
      if (!date) throw new Error('date é obrigatório');
      result = {};
      Object.keys(CFG.PACKAGES).forEach(k => { result[k] = computeAvailableSlots(date, k); });
    } else if (action === 'especialById') {
      // Dados públicos de UM Especial (página compartilhável). Só campos seguros.
      const id = e.parameter.id;
      if (!id) throw new Error('id é obrigatório');
      result = getEspecialPublic(id);
    } else if (action === 'bookings') {
      const sa = getSheet('Agendamentos');
      if (!sa || sa.getLastRow() < 2) { result = []; }
      else {
        const TZ      = 'America/Sao_Paulo';
        const numCols = sa.getLastColumn();
        // Build header→index map so we handle both old and new schema
        const hdrs = sa.getRange(1, 1, 1, numCols).getValues()[0];
        const ci   = {};
        hdrs.forEach(function(h, i) { ci[String(h).trim()] = i; });
        // Fallback indices for old schema (no Instagram/Bailarina cols)
        const iId       = ci['ID']                   ?? 0;
        const iDate     = ci['Data']                 ?? 1;
        const iStart    = ci['Início']               ?? 2;
        const iEnd      = ci['Fim']                  ?? 3;
        const iPkg      = ci['Pacote']               ?? 4;
        const iPrice    = ci['Valor (R$)']           ?? 6;
        const iNome     = ci['Nome']                 ?? 7;
        const iEmail    = ci['E-mail']               ?? 8;
        const iWa       = ci['WhatsApp']             ?? 9;
        const iInsta    = ci['Instagram Cliente']    ?? -1;
        const iInstaB   = ci['Instagram Bailarina']  ?? -1;
        const iNomeB    = ci['Nome Bailarina']       ?? -1;
        const iNumB     = ci['Nº Bailarinas']        ?? -1;
        const iSession  = ci['Stripe Session']       ?? (iInsta === -1 ? 10 : 13);
        const iStatus   = ci['Status']               ?? (iInsta === -1 ? 12 : 15);
        const iCreated  = ci['Criado em']            ?? (iInsta === -1 ? 13 : 16);
        const iPaidSes  = ci['Sessões Pagas']        ?? -1;
        const iPayerNm  = ci['Nomes Pagadores']      ?? -1;
        const iPayerEm  = ci['Emails Pagadores']     ?? -1;
        const splitCsv  = function(v) {
          return String(v || '').split(',').map(function(s) { return s.trim(); }).filter(function(s) { return !!s; });
        };
        // fmt* defensivos: uma célula de data/hora gravada como NÚMERO (não Date/string)
        // fazia Utilities.formatDate/.toISOString() estourar — e isso derrubava a lista
        // INTEIRA (action=bookings devolvia HTML de erro, painel quebrava). Agora célula
        // ruim vira String(v) e a linha ruim (qualquer throw) vira objeto mínimo, nunca
        // deixando UMA linha corromper todo o carregamento do admin.
        var fmtDate = function(v) { try { return v ? (typeof v === 'string' ? v : Utilities.formatDate(v, TZ, 'yyyy-MM-dd')) : ''; } catch (e) { return String(v); } };
        var fmtTime = function(v) { try { return v ? (typeof v === 'string' ? v : Utilities.formatDate(v, TZ, 'HH:mm')) : ''; } catch (e) { return String(v); } };
        var fmtIso  = function(v) { try { return v ? (typeof v === 'string' ? v : (v && v.toISOString ? v.toISOString() : String(v))) : ''; } catch (e) { return String(v); } };
        result = sa.getRange(2, 1, sa.getLastRow() - 1, numCols).getValues().map(function(r) {
          try {
          // Multi-pagador: expõe lista de sessions + lista pagas + nomes pra UI
          // mostrar "2/4 pagos", nome por pagador e botão "regerar".
          var sessions  = splitCsv(r[iSession]);
          var paidList  = iPaidSes >= 0 ? splitCsv(r[iPaidSes]) : [];
          // payerNames NÃO usa splitCsv (que filtra vazios) — precisa preservar
          // posições; um pagador pode ter nome em branco. Split manual sem filtro.
          var payerNames = iPayerNm >= 0
            ? String(r[iPayerNm] || '').split(',').map(function(s) { return s.trim(); })
            : [];
          var payerEmails = iPayerEm >= 0
            ? String(r[iPayerEm] || '').split(',').map(function(s) { return s.trim(); })
            : [];
          return {
            id:                  r[iId],
            date:                fmtDate(r[iDate]),
            start:               fmtTime(r[iStart]),
            end:                 fmtTime(r[iEnd]),
            package:             r[iPkg],
            price:               r[iPrice],
            name:                r[iNome],
            email:               r[iEmail],
            whatsapp:            r[iWa],
            instagram:           iInsta  >= 0 ? r[iInsta]  : '',
            instagramBailarina:  iInstaB >= 0 ? r[iInstaB] : '',
            nomeBailarina:       iNomeB  >= 0 ? r[iNomeB]  : '',
            numBailarinas:       iNumB   >= 0 ? Number(r[iNumB]) || 1 : 1,
            stripeSession:       r[iSession],
            stripeSessions:      sessions,       // array (1 ou N elementos)
            paidSessions:        paidList,       // array (subset de stripeSessions)
            payerNames:          payerNames,     // array paralelo a stripeSessions
            payerEmails:         payerEmails,    // idem (Especial) — só admin vê
            splitCount:          sessions.length,
            paidCount:           paidList.length,
            status:              r[iStatus],
            createdAt:           fmtIso(r[iCreated]),
          };
          } catch (rowErr) {
            // Linha malformada não pode derrubar a lista toda — devolve o mínimo pra UI.
            return { id: String(r[iId] || ''), name: String(r[iNome] || ''), status: r[iStatus],
                     package: r[iPkg], date: '', start: '', end: '', _rowError: String(rowErr) };
          }
        });
      }
    } else if (action === 'getPendingForReminders') {
      const sa = getSheet('Agendamentos');
      if (!sa || sa.getLastRow() < 2) {
        result = { site30min: [], admin48h: [] };
      } else {
        const TZ      = 'America/Sao_Paulo';
        const numCols = Math.max(sa.getLastColumn(), 24);
        const rows    = sa.getRange(2, 1, sa.getLastRow() - 1, numCols).getValues();
        const now     = Date.now();
        const site30min = [];
        const admin48h  = [];

        rows.forEach(function(r) {
          if (r[15] !== 'Pendente') return;
          const criadoEm = r[16];
          if (!criadoEm) return;
          const ageMin = (now - new Date(criadoEm).getTime()) / 60000;
          const source = r[23] || 'site';

          const booking = {
            id:            r[0],
            date:          r[1] ? (typeof r[1] === 'string' ? r[1] : Utilities.formatDate(r[1], TZ, 'yyyy-MM-dd')) : '',
            start:         r[2] ? (typeof r[2] === 'string' ? r[2] : Utilities.formatDate(r[2], TZ, 'HH:mm')) : '',
            end:           r[3] ? (typeof r[3] === 'string' ? r[3] : Utilities.formatDate(r[3], TZ, 'HH:mm')) : '',
            package:       r[4],
            price:         r[6],
            name:          r[7],
            email:         r[8],
            whatsapp:      r[9],
            nomeBailarina: r[12],
            createdAt:     typeof criadoEm === 'string' ? criadoEm : criadoEm.toISOString(),
            source:        source,
          };

          // 30min site: age >= 30min, source=site, AndreNotified (col 21) vazio
          if (source === 'site' && ageMin >= 30 && !r[21]) {
            site30min.push(booking);
          }
          // 48h admin: age >= 48h, source=admin, Rem1Sent (col 18) vazio
          if (source === 'admin' && ageMin >= 48 * 60 && !r[18]) {
            admin48h.push(booking);
          }
        });

        result = { site30min: site30min, admin48h: admin48h };
      }
    } else if (action === 'ping') {
      result = { ok: true, ts: new Date().toISOString() };
    } else {
      result = { error: 'Ação desconhecida: ' + action };
    }
  } catch (err) {
    result = { error: err.message };
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let body, result;
  try {
    body = JSON.parse(e.postData.contents);
    const action = body.action;

    if      (action === 'createPending')        result = createPending(body);
    else if (action === 'confirmBooking')       result = confirmBooking(body);
    else if (action === 'forceConfirmBooking')  result = forceConfirmBooking(body);
    else if (action === 'cancelBooking')        result = cancelBooking(body);
    else if (action === 'editBooking')          result = editBooking(body);
    else if (action === 'regenerateSplitLink')  result = regenerateSplitLink(body);
    else if (action === 'resendConfirmation') result = resendBookingConfirmationEmail(body.bookingId, body.extraCc);
    else if (action === 'releasePending')  result = releasePendingSlots();
    else if (action === 'initSheets')      { initSheets(); result = { ok: true }; }
    else if (action === 'buildClientes')   { buildClientesSheet(); result = { ok: true }; }
    else if (action === 'addLog') {
      // Accept both formats:
      //   {logAction, bookingId, detail, origin}  — legacy / internal
      //   {message, bookingId?, origin?}          — Vercel admin endpoints
      if (body.message !== undefined && body.logAction === undefined && body.detail === undefined) {
        addLog('LOG', body.bookingId || '', body.message, body.origin || 'painel');
      } else {
        addLog(body.logAction, body.bookingId, body.detail, body.origin);
      }
      result = { ok: true };
    } else if (action === 'markReminderSent') {
      const { bookingId, type } = body;
      const sa      = getSheet('Agendamentos');
      const cm      = _colMap(sa);
      const numCols = sa.getLastColumn();
      const rows    = sa.getRange(2, 1, sa.getLastRow() - 1, numCols).getValues();
      const iId     = cm['ID'] !== undefined ? cm['ID'] : 0;
      const idx     = rows.findIndex(function(r) { return r[iId] === bookingId; });
      if (idx < 0) throw new Error('Booking não encontrado: ' + bookingId);
      const rowNum = idx + 2;
      const ts     = nowIso();
      if (type === 'site30min') {
        sa.getRange(rowNum, _col1(cm, 'AndreNotified', 22)).setValue(ts);
      } else if (type === 'admin48h') {
        sa.getRange(rowNum, _col1(cm, 'Rem1Sent',      19)).setValue(ts);
      }
      addLog('REMINDER_SENT', bookingId, 'Tipo: ' + type, 'cron-reminders');
      result = { ok: true };
    } else {
      result = { error: 'Ação desconhecida: ' + action };
    }
  } catch (err) {
    addLog('ERRO_POST', '', err.message, 'doPost');
    result = { error: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}
