// ============================================================
// ENSAIO FOTOGRÁFICO EM JOINVILLE — Google Apps Script
// Cole este código no editor do Google Apps Script
// e publique como Web App (acesso: qualquer pessoa)
// ============================================================

const CFG = {
  WORK_START_H: 9,
  WORK_END_H: 19,
  BUFFER_MIN: 15,
  SLOT_STEP_MIN: 15,           // granularidade do calendário visual
  PENDING_TIMEOUT_MIN: 30,
  PACKAGES: {
    lembranca: { name: 'Lembrança',  duration: 30,  price: 140000, color: '#F0F0F0', textColor: '#000000', bold: false },
    economico: { name: 'Econômico',  duration: 90,  price: 190000, color: '#888888', textColor: '#FFFFFF', bold: true  },
    completo:  { name: 'Completo',   duration: 120, price: 220000, color: '#404040', textColor: '#FFFFFF', bold: false },
  },
  DATES_START: '2026-07-20',
  DATES_END:   '2026-08-02',
};

// ── Helpers de tempo ──────────────────────────────────────────
function timeToMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
function minToTime(min) {
  return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
}
function dateId(date, time) { return date + 'T' + time; }

function nowIso() { return new Date().toISOString(); }

function genBookingId() {
  return 'AG-' + Date.now().toString(36).toUpperCase();
}

// ── Sheet helpers ─────────────────────────────────────────────
function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name);
}

// ── Inicialização das abas ────────────────────────────────────
function initSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  function ensureSheet(name, headers, tabColor) {
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.setTabColor(tabColor);
    }
    if (sh.getLastRow() === 0) {
      sh.appendRow(headers);
      sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#222222').setFontColor('#ffffff');
      sh.setFrozenRows(1);
    }
    return sh;
  }

  // Agendamentos
  ensureSheet('Agendamentos', [
    'ID','Data','Início','Fim','Pacote','Duração (min)','Valor (R$)',
    'Nome','E-mail','WhatsApp','Stripe Session','Stripe Payment',
    'Status','Criado em','Atualizado em'
  ], '#4CAF50');

  // Bloqueios manuais
  ensureSheet('Bloqueios', [
    'Data','Início','Fim','Motivo'
  ], '#FF9800');

  // Log
  ensureSheet('Log', [
    'Timestamp','Ação','Booking ID','Detalhe','Origem'
  ], '#2196F3');

  // Calendário visual — gerado pelo script
  buildCalendarSheet();

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

  // Build date list
  const dates = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    dates.push(new Date(d));
  }

  // Build time rows (09:00 → 18:45 in 15-min steps)
  const times = [];
  for (let m = CFG.WORK_START_H * 60; m < CFG.WORK_END_H * 60; m += CFG.SLOT_STEP_MIN) {
    times.push(minToTime(m));
  }

  // Header row
  const headerRow = ['Horário', ...dates.map(d => {
    const dd = d.getDate().toString().padStart(2,'0');
    const mm = (d.getMonth()+1).toString().padStart(2,'0');
    const dow = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][d.getDay()];
    return `${dow}\n${dd}/${mm}`;
  })];
  cal.appendRow(headerRow);
  const hRange = cal.getRange(1, 1, 1, headerRow.length);
  hRange.setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff')
        .setHorizontalAlignment('center').setWrap(true);
  cal.setRowHeight(1, 40);

  // Time rows
  times.forEach((t, ri) => {
    const row = [t, ...dates.map(() => '')];
    cal.appendRow(row);
    cal.getRange(ri + 2, 1).setFontColor('#666666').setFontWeight('bold').setHorizontalAlignment('right');
    if (ri % 4 === 0) {
      cal.getRange(ri + 2, 1, 1, headerRow.length).setBackground('#f9f9f9');
    }
  });

  // Column widths
  cal.setColumnWidth(1, 65);
  for (let c = 2; c <= dates.length + 1; c++) cal.setColumnWidth(c, 110);

  // Freeze
  cal.setFrozenRows(1);
  cal.setFrozenColumns(1);

  // Repopulate from existing bookings
  refreshCalendar();
}

function refreshCalendar() {
  const sh  = getSheet('Agendamentos');
  if (!sh || sh.getLastRow() < 2) return;
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, 15).getValues();
  data.forEach(row => {
    const status = row[12];
    if (status === 'Confirmado' || status === 'Pendente') {
      paintCalendarSlot(row[1], row[2], row[3], row[7], row[4], status);
    }
  });
}

function paintCalendarSlot(dateStr, startTime, endTime, clientName, packageKey, status) {
  const cal = getSheet('Calendário');
  if (!cal) return;

  // Find column for date
  const dates = [];
  const s = new Date(CFG.DATES_START + 'T12:00:00');
  const e = new Date(CFG.DATES_END   + 'T12:00:00');
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) dates.push(d.toISOString().split('T')[0]);

  const dateKey = typeof dateStr === 'string' ? dateStr : Utilities.formatDate(dateStr, 'America/Sao_Paulo', 'yyyy-MM-dd');
  const colIdx  = dates.indexOf(dateKey);
  if (colIdx < 0) return;
  const col = colIdx + 2; // col 1 = Horário, col 2 = first date

  // Find rows
  const startMin = timeToMin(startTime);
  const endMin   = timeToMin(endTime);
  const pkg      = CFG.PACKAGES[packageKey] || CFG.PACKAGES['lembranca'];
  const bgColor  = status === 'Pendente' ? '#DDDDDD' : pkg.color;
  const fgColor  = status === 'Pendente' ? '#888888' : pkg.textColor;
  const bold     = status === 'Pendente' ? false : pkg.bold;

  // Row 1 = header, row 2 = 09:00
  const baseMin  = CFG.WORK_START_H * 60;
  const rowStart = Math.round((startMin - baseMin) / CFG.SLOT_STEP_MIN) + 2;
  const rowEnd   = Math.round((endMin   - baseMin) / CFG.SLOT_STEP_MIN) + 1; // exclusive

  for (let r = rowStart; r <= rowEnd; r++) {
    const cell = cal.getRange(r, col);
    cell.setBackground(bgColor).setFontColor(fgColor).setFontWeight(bold ? 'bold' : 'normal');
    if (r === rowStart) {
      const label = status === 'Pendente'
        ? '⏳ ' + clientName
        : clientName + '\n(' + pkg.name + ')';
      cell.setValue(label).setWrap(true);
    }
  }

  // Buffer row (after endTime)
  const bufferRow = rowEnd + 1;
  if (bufferRow <= cal.getLastRow()) {
    const bc = cal.getRange(bufferRow, col);
    bc.setBackground('#eeeeee').setValue('').setFontColor('#aaaaaa');
  }
}

function clearCalendarSlot(dateStr, startTime, endTime) {
  const cal = getSheet('Calendário');
  if (!cal) return;
  const dates = [];
  const s = new Date(CFG.DATES_START + 'T12:00:00');
  const e = new Date(CFG.DATES_END   + 'T12:00:00');
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) dates.push(d.toISOString().split('T')[0]);

  const dateKey = typeof dateStr === 'string' ? dateStr : Utilities.formatDate(dateStr, 'America/Sao_Paulo', 'yyyy-MM-dd');
  const colIdx  = dates.indexOf(dateKey);
  if (colIdx < 0) return;
  const col = colIdx + 2;

  const startMin = timeToMin(startTime);
  const endMin   = timeToMin(endTime);
  const baseMin  = CFG.WORK_START_H * 60;
  const rowStart = Math.round((startMin - baseMin) / CFG.SLOT_STEP_MIN) + 2;
  const rowEnd   = Math.round((endMin   - baseMin) / CFG.SLOT_STEP_MIN) + 2; // include buffer

  for (let r = rowStart; r <= rowEnd; r++) {
    if (r > cal.getLastRow()) break;
    const cell = cal.getRange(r, col);
    cell.clearContent().setBackground(null).setFontColor(null).setFontWeight('normal');
    if (r % 4 === 0) cell.setBackground('#f9f9f9'); // restore stripe
  }
}

// ── Disponibilidade & slots ───────────────────────────────────
function getWorkIntervals(dateStr) {
  // Returns [{start, end}] after removing manual blocks
  const blocks = getSheet('Bloqueios');
  const intervals = [{ start: CFG.WORK_START_H * 60, end: CFG.WORK_END_H * 60 }];
  if (!blocks || blocks.getLastRow() < 2) return intervals;

  const bData = blocks.getRange(2, 1, blocks.getLastRow() - 1, 4).getValues();
  bData.forEach(([bDate, bStart, bEnd]) => {
    const bKey = typeof bDate === 'string' ? bDate : Utilities.formatDate(bDate, 'America/Sao_Paulo', 'yyyy-MM-dd');
    if (bKey !== dateStr) return;
    const bS = timeToMin(bStart);
    const bE = timeToMin(bEnd);
    // Subtract from intervals (simple: treat as single block)
    intervals.forEach((iv, i) => {
      if (bS < iv.end && bE > iv.start) {
        // Split or trim
        if (bS <= iv.start && bE >= iv.end) {
          intervals.splice(i, 1);
        } else if (bS <= iv.start) {
          intervals[i].start = bE;
        } else if (bE >= iv.end) {
          intervals[i].end = bS;
        } else {
          intervals.splice(i, 1, { start: iv.start, end: bS }, { start: bE, end: iv.end });
        }
      }
    });
  });
  return intervals;
}

function getBookingsForDate(dateStr) {
  const sh = getSheet('Agendamentos');
  if (!sh || sh.getLastRow() < 2) return [];
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, 15).getValues();
  return data.filter(row => {
    const status = row[12];
    if (status !== 'Confirmado' && status !== 'Pendente') return false;
    const d = typeof row[1] === 'string' ? row[1] : Utilities.formatDate(row[1], 'America/Sao_Paulo', 'yyyy-MM-dd');
    return d === dateStr;
  }).map(row => ({
    start: timeToMin(row[2]),
    end:   timeToMin(row[3]),
  }));
}

function computeAvailableSlots(dateStr, pkgKey) {
  const pkg = CFG.PACKAGES[pkgKey];
  if (!pkg) return [];
  const needed  = pkg.duration + CFG.BUFFER_MIN; // total time the slot must be free
  const bookings = getBookingsForDate(dateStr);
  const intervals = getWorkIntervals(dateStr);
  const slots = [];

  intervals.forEach(({ start: ivStart, end: ivEnd }) => {
    for (let t = ivStart; t + needed <= ivEnd; t += CFG.SLOT_STEP_MIN) {
      const slotEnd = t + pkg.duration;
      const blocked = bookings.some(b => t < b.end && slotEnd + CFG.BUFFER_MIN > b.start);
      if (!blocked) slots.push(minToTime(t));
    }
  });
  return slots;
}

// ── doGet ─────────────────────────────────────────────────────
function doGet(e) {
  const action = (e.parameter && e.parameter.action) || '';
  let result;

  try {
    if (action === 'init') {
      return initSheets();
    }

    if (action === 'slots') {
      const date   = e.parameter.date;   // yyyy-MM-dd
      const pkg    = e.parameter.package; // lembranca | economico | completo
      if (!date || !pkg) throw new Error('date e package são obrigatórios');
      result = { slots: computeAvailableSlots(date, pkg) };
    }

    else if (action === 'allSlots') {
      // Returns all packages' slots for a date (for display)
      const date = e.parameter.date;
      if (!date) throw new Error('date é obrigatório');
      result = {};
      Object.keys(CFG.PACKAGES).forEach(k => {
        result[k] = computeAvailableSlots(date, k);
      });
    }

    else if (action === 'bookings') {
      const sh = getSheet('Agendamentos');
      if (!sh || sh.getLastRow() < 2) { result = []; }
      else {
        const data = sh.getRange(2, 1, sh.getLastRow() - 1, 15).getValues();
        result = data.map(r => ({
          id: r[0], date: r[1], start: r[2], end: r[3], package: r[4],
          name: r[7], status: r[12]
        }));
      }
    }

    else {
      result = { error: 'Ação desconhecida: ' + action };
    }
  } catch (err) {
    result = { error: err.message };
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── doPost ────────────────────────────────────────────────────
function doPost(e) {
  let body, result;
  try {
    body = JSON.parse(e.postData.contents);
    const action = body.action;

    if (action === 'createPending') {
      result = createPending(body);
    } else if (action === 'confirmBooking') {
      result = confirmBooking(body);
    } else if (action === 'cancelBooking') {
      result = cancelBooking(body);
    } else if (action === 'releasePending') {
      result = releasePendingSlots();
    } else if (action === 'addLog') {
      addLog(body.logAction, body.bookingId, body.detail, body.origin);
      result = { ok: true };
    } else {
      result = { error: 'Ação desconhecida: ' + action };
    }
  } catch (err) {
    result = { error: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Booking CRUD ──────────────────────────────────────────────
function createPending(data) {
  const { date, start, packageKey, name, email, whatsapp, stripeSession } = data;
  const pkg = CFG.PACKAGES[packageKey];
  if (!pkg) throw new Error('Pacote inválido: ' + packageKey);

  const startMin  = timeToMin(start);
  const endMin    = startMin + pkg.duration;
  const endTime   = minToTime(endMin);
  const bookingId = genBookingId();
  const now       = nowIso();

  const sh = getSheet('Agendamentos');
  sh.appendRow([
    bookingId, date, start, endTime, packageKey, pkg.duration,
    (pkg.price / 100).toFixed(2), name, email, whatsapp,
    stripeSession || '', '', 'Pendente', now, now
  ]);

  paintCalendarSlot(date, start, endTime, name, packageKey, 'Pendente');
  addLog('PENDENTE_CRIADO', bookingId,
    `${name} | ${pkg.name} | ${date} ${start}–${endTime} | Stripe: ${stripeSession}`, 'webhook');

  return { ok: true, bookingId, endTime };
}

function confirmBooking(data) {
  const { stripeSession, stripePayment } = data;
  const sh = getSheet('Agendamentos');
  if (!sh || sh.getLastRow() < 2) throw new Error('Planilha vazia');

  const range = sh.getRange(2, 1, sh.getLastRow() - 1, 15);
  const rows  = range.getValues();
  const idx   = rows.findIndex(r => r[10] === stripeSession);
  if (idx < 0) throw new Error('Session não encontrada: ' + stripeSession);

  const row  = rows[idx];
  const shRow = idx + 2;
  sh.getRange(shRow, 12).setValue(stripePayment || '');
  sh.getRange(shRow, 13).setValue('Confirmado');
  sh.getRange(shRow, 15).setValue(nowIso());

  // Update calendar: repaint as confirmed
  const date  = row[1];
  const start = row[2];
  const end   = row[3];
  const name  = row[7];
  const pkg   = row[4];
  clearCalendarSlot(date, start, end);
  paintCalendarSlot(date, start, end, name, pkg, 'Confirmado');

  addLog('PAGAMENTO_CONFIRMADO', row[0],
    `Stripe session: ${stripeSession} | payment: ${stripePayment}`, 'webhook');

  return { ok: true, bookingId: row[0], date, start, end, name, email: row[8], whatsapp: row[9], package: pkg };
}

function cancelBooking(data) {
  const { bookingId, reason, origin } = data;
  const sh = getSheet('Agendamentos');
  if (!sh || sh.getLastRow() < 2) throw new Error('Planilha vazia');

  const range = sh.getRange(2, 1, sh.getLastRow() - 1, 15);
  const rows  = range.getValues();
  const idx   = rows.findIndex(r => r[0] === bookingId);
  if (idx < 0) throw new Error('Booking não encontrado: ' + bookingId);

  const shRow = idx + 2;
  const row   = rows[idx];
  sh.getRange(shRow, 13).setValue('Cancelado');
  sh.getRange(shRow, 15).setValue(nowIso());

  clearCalendarSlot(row[1], row[2], row[3]);
  addLog('CANCELADO', bookingId, reason || 'sem motivo', origin || 'admin');

  return { ok: true };
}

function releasePendingSlots() {
  const sh = getSheet('Agendamentos');
  if (!sh || sh.getLastRow() < 2) return { ok: true, released: 0 };

  const range = sh.getRange(2, 1, sh.getLastRow() - 1, 15);
  const rows  = range.getValues();
  const cutoff = Date.now() - CFG.PENDING_TIMEOUT_MIN * 60 * 1000;
  let released = 0;

  rows.forEach((row, i) => {
    if (row[12] !== 'Pendente') return;
    const created = new Date(row[13]).getTime();
    if (created < cutoff) {
      const shRow = i + 2;
      sh.getRange(shRow, 13).setValue('Expirado');
      sh.getRange(shRow, 15).setValue(nowIso());
      clearCalendarSlot(row[1], row[2], row[3]);
      addLog('PENDENTE_EXPIRADO', row[0], `Expirou após ${CFG.PENDING_TIMEOUT_MIN}min`, 'trigger');
      released++;
    }
  });
  return { ok: true, released };
}

// ── Log ───────────────────────────────────────────────────────
function addLog(action, bookingId, detail, origin) {
  const sh = getSheet('Log');
  if (!sh) return;
  sh.appendRow([nowIso(), action, bookingId || '', detail || '', origin || '']);
}

// ── Trigger automático a cada 30min ──────────────────────────
function setupTrigger() {
  // Execute this function once manually to install the trigger
  ScriptApp.newTrigger('releasePendingSlots')
    .timeBased().everyMinutes(30).create();
}
