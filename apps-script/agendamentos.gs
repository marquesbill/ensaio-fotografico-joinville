// ============================================================
// ENSAIO FOTOGRÁFICO EM JOINVILLE — Google Apps Script
// Cole este código no editor do Google Apps Script
// e publique como Web App (acesso: qualquer pessoa)
//
// Script Properties necessárias (Configurações → Script Properties):
//   RESEND_API_KEY  →  re_xxxxxxxxxxxxxxxxxxxxxxxx
// ============================================================

const CFG = {
  WORK_START_H: 9,
  WORK_END_H: 19,
  BUFFER_MIN: 15,
  SLOT_STEP_MIN: 15,
  PENDING_BLOCK_H: 24,          // horas que o slot fica bloqueado para pagamento pendente
  ANDRE_NOTIFY_MIN: 30,         // minutos até André receber aviso de pagamento não concluído
  PACKAGES: {
    lembranca: { name: 'Lembrança', duration: 30,  price: 140000, color: '#6A0DAD', textColor: '#FFFFFF', bold: false },
    economico: { name: 'Econômico', duration: 90,  price: 190000, color: '#0277BD', textColor: '#FFFFFF', bold: true  },
    completo:  { name: 'Completo',  duration: 120, price: 220000, color: '#BF360C', textColor: '#FFFFFF', bold: false },
  },
  DATES_START:  '2026-07-20',
  DATES_END:    '2026-08-02',
  ANDRE_EMAIL:  'andreffotografia@gmail.com',
  FROM_EMAIL:   'Ensaio Joinville <confirmacao@ensaiofotograficoemjoinville.com>',
  SITE_URL:     'https://www.ensaiofotograficoemjoinville.com',
};

// ── Colunas de "Agendamentos" (índices 0-based para .getValues()) ──
// 0:ID  1:Data  2:Início  3:Fim  4:Pacote  5:Duração  6:Valor
// 7:Nome  8:E-mail  9:WhatsApp  10:StripeSession  11:StripePayment
// 12:Status  13:Criado em  14:Atualizado em
// 15:Rem1Sent  16:Rem2Sent  17:Rem3Sent  18:AndreNotified

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
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
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

// ── Inicialização das abas ────────────────────────────────────
function initSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

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
    'Nome','E-mail','WhatsApp','Stripe Session','Stripe Payment',
    'Status','Criado em','Atualizado em',
    'Rem1Sent','Rem2Sent','Rem3Sent','AndreNotified'
  ];
  ensureSheet('Agendamentos', agHeaders, '#4CAF50');
  ensureSheet('Bloqueios',    ['Data','Início','Fim','Motivo'],                '#FF9800');
  ensureSheet('Log',          ['Timestamp','Ação','Booking ID','Detalhe','Origem'], '#2196F3');

  // Ensure new columns exist in an already-populated Agendamentos sheet
  const sa = getSheet('Agendamentos');
  if (sa && sa.getLastRow() > 0) {
    const existingHeaders = sa.getRange(1, 1, 1, sa.getLastColumn()).getValues()[0];
    if (existingHeaders.indexOf('Rem1Sent') === -1) {
      const lc = sa.getLastColumn();
      sa.getRange(1, lc + 1).setValue('Rem1Sent');
      sa.getRange(1, lc + 2).setValue('Rem2Sent');
      sa.getRange(1, lc + 3).setValue('Rem3Sent');
      sa.getRange(1, lc + 4).setValue('AndreNotified');
      sa.getRange(1, 1, 1, lc + 4)
        .setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff');
    }
  }

  buildCalendarSheet();
  buildClientesSheet();

  return ContentService.createTextOutput(JSON.stringify({ ok: true, msg: 'Sheets inicializadas' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Calendário visual ─────────────────────────────────────────
function buildCalendarSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let cal = ss.getSheetByName('Calendário');
  if (cal) ss.deleteSheet(cal);
  cal = ss.insertSheet('Calendário');
  cal.setTabColor('#9C27B0');

  const startDate = new Date(CFG.DATES_START + 'T12:00:00');
  const endDate   = new Date(CFG.DATES_END   + 'T12:00:00');
  const dates = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1))
    dates.push(new Date(d));

  const times = [];
  for (let m = CFG.WORK_START_H * 60; m < CFG.WORK_END_H * 60; m += CFG.SLOT_STEP_MIN)
    times.push(minToTime(m));

  const DOW = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const MON = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago'];

  const headerRow = ['Horário', ...dates.map(d =>
    DOW[d.getDay()] + '\n' + d.getDate() + ' ' + MON[d.getMonth()]
  )];
  cal.appendRow(headerRow);
  cal.getRange(1, 1, 1, headerRow.length)
    .setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff')
    .setHorizontalAlignment('center').setWrap(true);
  cal.setRowHeight(1, 45);

  times.forEach((t, ri) => {
    cal.appendRow([t, ...dates.map(() => '')]);
    const r = ri + 2;
    cal.getRange(r, 1).setFontColor('#444444').setFontWeight('bold').setHorizontalAlignment('right');
    if (ri % 4 === 0)
      cal.getRange(r, 1, 1, headerRow.length).setBackground('#f0f0f0');
  });

  cal.setColumnWidth(1, 65);
  for (let c = 2; c <= dates.length + 1; c++) cal.setColumnWidth(c, 130);
  cal.setFrozenRows(1);
  cal.setFrozenColumns(1);

  refreshCalendar();
}

function _buildDateColMap() {
  const map = {};
  let ci = 2;
  const s = new Date(CFG.DATES_START + 'T12:00:00');
  const e = new Date(CFG.DATES_END   + 'T12:00:00');
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    const ds = Utilities.formatDate(d, 'America/Sao_Paulo', 'yyyy-MM-dd');
    map[ds] = ci++;
  }
  return map;
}

function _buildTimeRowMap(cal) {
  const map = {};
  if (cal.getLastRow() < 2) return map;
  const vals = cal.getRange(2, 1, cal.getLastRow() - 1, 1).getValues();
  vals.forEach((r, i) => { if (r[0]) map[r[0].toString()] = i + 2; });
  return map;
}

function _statusIndicator(status, criadoEm) {
  if (status === 'Confirmado') return '🟢';
  const ageMin = criadoEm ? (Date.now() - new Date(criadoEm).getTime()) / 60000 : 999;
  return ageMin < 30 ? '🟡' : '🔴';
}

function refreshCalendar() {
  const cal = getSheet('Calendário');
  const sa  = getSheet('Agendamentos');
  if (!cal || !sa || sa.getLastRow() < 2) return;

  const numTimeRows = cal.getLastRow() - 1;
  const numDateCols = cal.getLastColumn() - 1;
  if (numTimeRows < 1 || numDateCols < 1) return;

  // Bulk-clear data cells
  const emptyVals = Array(numTimeRows).fill(null).map(() => Array(numDateCols).fill(''));
  const bgVals    = Array(numTimeRows).fill(null).map((_, i) => Array(numDateCols).fill(i % 4 === 0 ? '#f0f0f0' : '#ffffff'));
  const fgVals    = Array(numTimeRows).fill(null).map(() => Array(numDateCols).fill('#444444'));
  const fwVals    = Array(numTimeRows).fill(null).map(() => Array(numDateCols).fill('normal'));
  const dataRange = cal.getRange(2, 2, numTimeRows, numDateCols);
  dataRange.setValues(emptyVals);
  dataRange.setBackgrounds(bgVals);
  dataRange.setFontColors(fgVals);
  dataRange.setFontWeights(fwVals);

  const dateColMap = _buildDateColMap();
  const timeRowMap = _buildTimeRowMap(cal);
  const numCols    = sa.getLastColumn();
  const data = sa.getRange(2, 1, sa.getLastRow() - 1, numCols).getValues();

  data.forEach(row => {
    const status = row[12];
    if (status !== 'Confirmado' && status !== 'Pendente') return;

    const dateStr  = row[1] ? (typeof row[1] === 'string' ? row[1] : Utilities.formatDate(row[1], 'America/Sao_Paulo', 'yyyy-MM-dd')) : '';
    const startStr = row[2] ? row[2].toString() : '';
    const endStr   = row[3] ? row[3].toString() : '';
    const pkgKey   = row[4];
    const nome     = row[7];
    const criadoEm = row[13];
    const pkg      = CFG.PACKAGES[pkgKey] || CFG.PACKAGES.completo;

    const colIdx = dateColMap[dateStr];
    if (!colIdx) return;

    const indicator = _statusIndicator(status, criadoEm);
    const startMin  = timeToMin(startStr);
    const endMin    = timeToMin(endStr);

    for (let m = startMin; m < endMin; m += CFG.SLOT_STEP_MIN) {
      const rowIdx = timeRowMap[minToTime(m)];
      if (!rowIdx) continue;
      const cell = cal.getRange(rowIdx, colIdx);
      cell.setBackground(pkg.color).setFontColor(pkg.textColor)
          .setFontWeight('bold').setWrap(true)
          .setHorizontalAlignment('center').setVerticalAlignment('middle');
      cell.setValue(m === startMin ? indicator + ' ' + nome + '\n' + pkg.name : '▓');
    }
  });
}

function paintCalendarSlot(dateStr, startTime, endTime, clientName, packageKey, status, criadoEm) {
  const cal = getSheet('Calendário');
  if (!cal) return;
  const dateColMap = _buildDateColMap();
  const timeRowMap = _buildTimeRowMap(cal);
  const colIdx = dateColMap[typeof dateStr === 'string' ? dateStr : Utilities.formatDate(dateStr, 'America/Sao_Paulo', 'yyyy-MM-dd')];
  if (!colIdx) return;
  const pkg       = CFG.PACKAGES[packageKey] || CFG.PACKAGES.completo;
  const indicator = _statusIndicator(status, criadoEm);
  const startMin  = timeToMin(startTime);
  const endMin    = timeToMin(endTime);
  for (let m = startMin; m < endMin; m += CFG.SLOT_STEP_MIN) {
    const rowIdx = timeRowMap[minToTime(m)];
    if (!rowIdx) continue;
    const cell = cal.getRange(rowIdx, colIdx);
    cell.setBackground(pkg.color).setFontColor(pkg.textColor)
        .setFontWeight('bold').setWrap(true)
        .setHorizontalAlignment('center').setVerticalAlignment('middle');
    cell.setValue(m === startMin ? indicator + ' ' + clientName + '\n' + pkg.name : '▓');
  }
}

function clearCalendarSlot(dateStr, startTime, endTime) {
  const cal = getSheet('Calendário');
  if (!cal) return;
  const dateColMap = _buildDateColMap();
  const timeRowMap = _buildTimeRowMap(cal);
  const colIdx = dateColMap[typeof dateStr === 'string' ? dateStr : Utilities.formatDate(dateStr, 'America/Sao_Paulo', 'yyyy-MM-dd')];
  if (!colIdx) return;
  const startMin = timeToMin(startTime);
  const endMin   = timeToMin(endTime);
  for (let m = startMin; m < endMin; m += CFG.SLOT_STEP_MIN) {
    const rowIdx = timeRowMap[minToTime(m)];
    if (!rowIdx) continue;
    const ri = rowIdx - 2; // 0-based
    cal.getRange(rowIdx, colIdx)
      .clearContent()
      .setBackground(ri % 4 === 0 ? '#f0f0f0' : '#ffffff')
      .setFontColor('#444444').setFontWeight('normal').setWrap(false);
  }
}

// ── Aba Clientes ──────────────────────────────────────────────
function buildClientesSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let cl = ss.getSheetByName('Clientes');
  if (!cl) { cl = ss.insertSheet('Clientes'); cl.setTabColor('#009688'); }
  else      { cl.clearContents(); }

  const headers = ['Nome','E-mail','WhatsApp','Pacote','Duração','Data','Horário de início','Valor (R$)','Confirmado em','ID'];
  cl.appendRow(headers);
  cl.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff');
  cl.setFrozenRows(1);

  const sa = getSheet('Agendamentos');
  if (!sa || sa.getLastRow() < 2) {
    for (let c = 1; c <= headers.length; c++) cl.autoResizeColumn(c);
    return;
  }

  const numCols = Math.max(sa.getLastColumn(), 15);
  const data = sa.getRange(2, 1, sa.getLastRow() - 1, numCols).getValues();
  const rows = [];

  data.forEach(row => {
    if (row[12] !== 'Confirmado') return;
    const pkg       = CFG.PACKAGES[row[4]] || {};
    const valorNum  = parseFloat(row[6]);
    const valorLabel = isNaN(valorNum) ? row[6] : 'R$ ' + valorNum.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const dateStr   = row[1] ? (typeof row[1] === 'string' ? row[1] : Utilities.formatDate(row[1], 'America/Sao_Paulo', 'yyyy-MM-dd')) : '';
    rows.push([
      row[7], row[8], row[9],
      pkg.name || row[4],
      (pkg.duration || row[5]) + ' min',
      formatDateBR(dateStr),
      row[2] ? row[2].toString() : '',
      valorLabel,
      row[14] || '',
      row[0],
    ]);
  });

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
  const numCols = Math.max(sa.getLastColumn(), 15);
  const data = sa.getRange(2, 1, sa.getLastRow() - 1, numCols).getValues();
  const now  = Date.now();

  return data.filter(row => {
    const status = row[12];
    const d = row[1] ? (typeof row[1] === 'string' ? row[1] : Utilities.formatDate(row[1], 'America/Sao_Paulo', 'yyyy-MM-dd')) : '';
    if (d !== dateStr) return false;
    if (status === 'Confirmado') return true;
    if (status === 'Pendente') {
      const criadoEm = row[13];
      const ageH = criadoEm ? (now - new Date(criadoEm).getTime()) / 3600000 : 0;
      return ageH < CFG.PENDING_BLOCK_H; // bloqueia por até 24h
    }
    return false;
  }).map(row => ({
    start: timeToMin(row[2] ? row[2].toString() : '00:00'),
    end:   timeToMin(row[3] ? row[3].toString() : '00:00'),
  }));
}

function computeAvailableSlots(dateStr, pkgKey) {
  const pkg = CFG.PACKAGES[pkgKey];
  if (!pkg) return [];
  const needed    = pkg.duration + CFG.BUFFER_MIN;
  const bookings  = getBookingsForDate(dateStr);
  const intervals = getWorkIntervals(dateStr);
  const slots     = [];

  intervals.forEach(({ start: ivStart, end: ivEnd }) => {
    for (let t = ivStart; t + needed <= ivEnd; t += CFG.SLOT_STEP_MIN) {
      const slotEnd = t + pkg.duration;
      const blocked = bookings.some(b => t < b.end && slotEnd + CFG.BUFFER_MIN > b.start);
      if (!blocked) slots.push(minToTime(t));
    }
  });
  return slots;
}

// ── E-mail via Resend ─────────────────────────────────────────
function sendEmailViaResend(to, subject, html) {
  const key = getResendKey();
  if (!key) {
    addLog('EMAIL_ERRO', '', 'RESEND_API_KEY não configurada em Script Properties', 'sendEmailViaResend');
    return false;
  }
  try {
    const resp = UrlFetchApp.fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      payload: JSON.stringify({ from: CFG.FROM_EMAIL, to: [to], subject: subject, html: html }),
      muteHttpExceptions: true,
    });
    const code = resp.getResponseCode();
    if (code >= 400) {
      addLog('EMAIL_ERRO', '', 'Resend HTTP ' + code + ': ' + resp.getContentText(), 'sendEmailViaResend');
      return false;
    }
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
  return `
    <table width="100%" style="border-collapse:collapse;">
      <tr><td style="color:#6b7280;padding:5px 0;font-size:13px;">Pacote</td>
          <td style="color:#111827;font-size:13px;font-weight:600;text-align:right;">${pkgInfo.name || booking.pacote}</td></tr>
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

function sendAndreNotification(booking) {
  const valorNum   = parseFloat(booking.valor);
  const valorLabel = isNaN(valorNum) ? booking.valor : 'R$ ' + valorNum.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  const pkgInfo    = CFG.PACKAGES[booking.pacote] || {};

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
  <tr><td style="background:#BF360C;padding:20px 28px;">
    <h2 style="color:#ffffff;margin:0;font-size:17px;">🔴 Pagamento pendente há 30 min — cliente não pagou</h2>
  </td></tr>
  <tr><td style="padding:24px 28px;">
    <table width="100%" style="border-collapse:collapse;">
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;width:120px;">Nome</td>
          <td style="font-weight:600;font-size:13px;">${booking.nome}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">E-mail</td>
          <td style="font-size:13px;">${booking.email}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">WhatsApp</td>
          <td style="font-weight:600;font-size:14px;color:#BF360C;">${booking.whatsapp}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">Pacote</td>
          <td style="font-size:13px;">${pkgInfo.name || booking.pacote}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">Data</td>
          <td style="font-size:13px;">${formatDateBR(booking.data)} às ${booking.inicio}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;border-top:1px solid #e5e7eb;">Valor</td>
          <td style="font-weight:700;font-size:14px;color:#BF360C;border-top:1px solid #e5e7eb;">${valorLabel}</td></tr>
    </table>
    <p style="color:#9ca3af;font-size:12px;margin-top:16px;border-top:1px solid #f0f0f0;padding-top:12px;">
      O horário fica bloqueado por 24h a partir da reserva. Se o pagamento não for concluído, o slot é liberado automaticamente.
    </p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  const subject = '🔴 Pagamento pendente: ' + booking.nome + ' — ' + formatDateBR(booking.data);
  const ok = sendEmailViaResend(CFG.ANDRE_EMAIL, subject, html);
  if (ok) addLog('ANDRE_NOTIFICADO', booking.id, 'Notificado sobre ' + booking.nome, 'sendAndreNotification');
}

// ── processReminders (trigger a cada 5 min) ───────────────────
function processReminders() {
  const sa = getSheet('Agendamentos');
  if (!sa || sa.getLastRow() < 2) return;

  const numCols = Math.max(sa.getLastColumn(), 19);
  const data    = sa.getRange(2, 1, sa.getLastRow() - 1, numCols).getValues();
  const now     = Date.now();
  let   calendarChanged = false;

  data.forEach((row, i) => {
    if (row[12] !== 'Pendente') return;
    const criadoEm = row[13];
    if (!criadoEm) return;

    const rowNum  = i + 2;
    const ageMin  = (now - new Date(criadoEm).getTime()) / 60000;
    const booking = {
      id:       row[0],
      data:     row[1] ? (typeof row[1] === 'string' ? row[1] : Utilities.formatDate(row[1], 'America/Sao_Paulo', 'yyyy-MM-dd')) : '',
      inicio:   row[2] ? row[2].toString() : '',
      fim:      row[3] ? row[3].toString() : '',
      pacote:   row[4],
      valor:    row[6],
      nome:     row[7],
      email:    row[8],
      whatsapp: row[9],
      criadoEm: criadoEm,
    };

    // 24h sem pagamento → expirar e liberar slot
    if (ageMin >= CFG.PENDING_BLOCK_H * 60) {
      sa.getRange(rowNum, 13).setValue('Expirado');
      sa.getRange(rowNum, 15).setValue(nowIso());
      clearCalendarSlot(booking.data, booking.inicio, booking.fim);
      addLog('PENDENTE_EXPIRADO', booking.id, 'Expirou após 24h', 'processReminders');
      calendarChanged = true;
      return;
    }

    // Lembrete 1: após 5 min
    if (ageMin >= 5 && !row[15]) {
      sendReminderEmail(booking, 1);
      sa.getRange(rowNum, 16).setValue(nowIso());
    }
    // Lembrete 2: após 2h
    if (ageMin >= 120 && !row[16]) {
      sendReminderEmail(booking, 2);
      sa.getRange(rowNum, 17).setValue(nowIso());
    }
    // Lembrete 3: após 22h
    if (ageMin >= 22 * 60 && !row[17]) {
      sendReminderEmail(booking, 3);
      sa.getRange(rowNum, 18).setValue(nowIso());
    }
    // Notificação para André: após 30 min
    if (ageMin >= CFG.ANDRE_NOTIFY_MIN && !row[18]) {
      sendAndreNotification(booking);
      sa.getRange(rowNum, 19).setValue(nowIso());
    }

    // Atualiza indicador no calendário (🟡 → 🔴 quando passa de 30 min)
    calendarChanged = true;
  });

  if (calendarChanged) refreshCalendar();
}

// ── Booking CRUD ──────────────────────────────────────────────
function createPending(data) {
  const { date, start, packageKey, name, email, whatsapp, stripeSession } = data;
  const pkg = CFG.PACKAGES[packageKey];
  if (!pkg) throw new Error('Pacote inválido: ' + packageKey);

  const endTime   = minToTime(timeToMin(start) + pkg.duration);
  const bookingId = genBookingId();
  const now       = nowIso();

  const sa = getSheet('Agendamentos');
  sa.appendRow([
    bookingId, date, start, endTime, packageKey, pkg.duration,
    (pkg.price / 100).toFixed(2), name, email, whatsapp,
    stripeSession || '', '', 'Pendente', now, now,
    '', '', '', ''
  ]);

  paintCalendarSlot(date, start, endTime, name, packageKey, 'Pendente', now);
  addLog('PENDENTE_CRIADO', bookingId,
    name + ' | ' + (pkg.name) + ' | ' + date + ' ' + start + '–' + endTime + ' | Stripe: ' + stripeSession, 'webhook');

  return { ok: true, bookingId: bookingId, endTime: endTime };
}

function confirmBooking(data) {
  const { stripeSession, stripePayment } = data;
  const sa = getSheet('Agendamentos');
  if (!sa || sa.getLastRow() < 2) throw new Error('Planilha vazia');

  const numCols = Math.max(sa.getLastColumn(), 15);
  const rows    = sa.getRange(2, 1, sa.getLastRow() - 1, numCols).getValues();
  const idx     = rows.findIndex(r => r[10] === stripeSession);
  if (idx < 0) throw new Error('Session não encontrada: ' + stripeSession);

  const row  = rows[idx];
  const shRow = idx + 2;
  sa.getRange(shRow, 12).setValue(stripePayment || '');
  sa.getRange(shRow, 13).setValue('Confirmado');
  sa.getRange(shRow, 15).setValue(nowIso());

  const dateStr = row[1] ? (typeof row[1] === 'string' ? row[1] : Utilities.formatDate(row[1], 'America/Sao_Paulo', 'yyyy-MM-dd')) : '';
  clearCalendarSlot(dateStr, row[2] ? row[2].toString() : '', row[3] ? row[3].toString() : '');
  paintCalendarSlot(dateStr, row[2] ? row[2].toString() : '', row[3] ? row[3].toString() : '', row[7], row[4], 'Confirmado', row[13]);

  buildClientesSheet();
  addLog('PAGAMENTO_CONFIRMADO', row[0],
    'Stripe session: ' + stripeSession + ' | payment: ' + stripePayment, 'webhook');

  return {
    ok: true,
    bookingId: row[0], date: dateStr,
    start: row[2] ? row[2].toString() : '',
    end:   row[3] ? row[3].toString() : '',
    name: row[7], email: row[8], whatsapp: row[9], package: row[4]
  };
}

function cancelBooking(data) {
  const { bookingId, reason, origin } = data;
  const sa = getSheet('Agendamentos');
  if (!sa || sa.getLastRow() < 2) throw new Error('Planilha vazia');

  const numCols = Math.max(sa.getLastColumn(), 15);
  const rows    = sa.getRange(2, 1, sa.getLastRow() - 1, numCols).getValues();
  const idx     = rows.findIndex(r => r[0] === bookingId);
  if (idx < 0) throw new Error('Booking não encontrado: ' + bookingId);

  const row   = rows[idx];
  const shRow = idx + 2;
  sa.getRange(shRow, 13).setValue('Cancelado');
  sa.getRange(shRow, 15).setValue(nowIso());

  const dateStr = row[1] ? (typeof row[1] === 'string' ? row[1] : Utilities.formatDate(row[1], 'America/Sao_Paulo', 'yyyy-MM-dd')) : '';
  clearCalendarSlot(dateStr, row[2] ? row[2].toString() : '', row[3] ? row[3].toString() : '');
  addLog('CANCELADO', bookingId, reason || 'sem motivo', origin || 'admin');

  return { ok: true };
}

function releasePendingSlots() {
  // Agora delegado para processReminders (mantido por compatibilidade)
  processReminders();
  return { ok: true };
}

// ── Trigger ───────────────────────────────────────────────────
function setupTrigger() {
  // Execute manualmente UMA vez para instalar o trigger
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('processReminders')
    .timeBased().everyMinutes(5).create();
  addLog('TRIGGER_INSTALADO', '', 'processReminders a cada 5min', 'setupTrigger');
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
      result = { slots: computeAvailableSlots(date, pkg) };
    } else if (action === 'allSlots') {
      const date = e.parameter.date;
      if (!date) throw new Error('date é obrigatório');
      result = {};
      Object.keys(CFG.PACKAGES).forEach(k => { result[k] = computeAvailableSlots(date, k); });
    } else if (action === 'bookings') {
      const sa = getSheet('Agendamentos');
      if (!sa || sa.getLastRow() < 2) { result = []; }
      else {
        const TZ = 'America/Sao_Paulo';
        result = sa.getRange(2, 1, sa.getLastRow() - 1, 15).getValues().map(r => ({
          id:       r[0],
          date:     r[1] ? (typeof r[1] === 'string' ? r[1] : Utilities.formatDate(r[1], TZ, 'yyyy-MM-dd')) : '',
          start:    r[2] ? (typeof r[2] === 'string' ? r[2] : Utilities.formatDate(r[2], TZ, 'HH:mm'))      : '',
          end:      r[3] ? (typeof r[3] === 'string' ? r[3] : Utilities.formatDate(r[3], TZ, 'HH:mm'))      : '',
          package:  r[4],
          price:    r[6],
          name:     r[7],
          email:    r[8],
          whatsapp: r[9],
          status:   r[12],
        }));
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

    if      (action === 'createPending')   result = createPending(body);
    else if (action === 'confirmBooking')  result = confirmBooking(body);
    else if (action === 'cancelBooking')   result = cancelBooking(body);
    else if (action === 'releasePending')  result = releasePendingSlots();
    else if (action === 'initSheets')      { initSheets(); result = { ok: true }; }
    else if (action === 'refreshCalendar') { refreshCalendar(); result = { ok: true }; }
    else if (action === 'buildClientes')   { buildClientesSheet(); result = { ok: true }; }
    else if (action === 'addLog') {
      addLog(body.logAction, body.bookingId, body.detail, body.origin);
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
