import { useState, useEffect, useCallback } from 'react';
import {
  LogOut, Calendar, List, ChevronLeft, ChevronRight,
  X, AlertCircle, Check, Loader2, RefreshCw, Search,
} from 'lucide-react';

/* ─────────────────────────── types ─────────────────────────── */
interface Booking {
  id:            string;
  date:          string;   // "2026-07-05"
  start:         string;   // "09:00"
  end:           string;
  package:       string;   // display name or key
  price?:        number;
  name:          string;
  email?:        string;
  whatsapp?:     string;
  stripeSession?: string;
  status:        string;   // "Confirmado" | "Pendente" | "Cancelado"
  createdAt?:    string;
}

interface Slot { time: string; available: boolean }

const API = import.meta.env.DEV ? '' : '';

const PACKAGES = [
  { key: 'lembranca', name: 'Lembrança',  duration: 30,  price: 1400 },
  { key: 'economico', name: 'Econômico',  duration: 90,  price: 1900 },
  { key: 'completo',  name: 'Completo',   duration: 120, price: 2200 },
];

const PKG_KEY: Record<string, string> = {
  'Lembrança': 'lembranca', 'lembranca': 'lembranca',
  'Econômico': 'economico', 'economico': 'economico',
  'Completo':  'completo',  'completo':  'completo',
};

const STATUS_COLOR: Record<string, string> = {
  Confirmado: 'bg-green-100 text-green-700 border-green-200',
  Pendente:   'bg-amber-100  text-amber-700  border-amber-200',
  Cancelado:  'bg-gray-100  text-gray-500  border-gray-200',
};

const STATUS_DOT: Record<string, string> = {
  Confirmado: 'bg-green-500',
  Pendente:   'bg-amber-400',
  Cancelado:  'bg-gray-400',
};

function fmtDate(d: string) {
  if (!d) return '';
  // Handle ISO datetime like "2026-07-28T03:00:00.000Z" or plain "2026-07-28"
  const datePart = d.includes('T') ? d.split('T')[0] : d;
  const [y, m, day] = datePart.split('-');
  return `${day}/${m}/${y}`;
}

function fmtTime(t: string) {
  if (!t) return '';
  // Handle ISO datetime like "1899-12-30T18:06:00.000Z" or plain "18:06"
  if (t.includes('T')) return t.split('T')[1].substring(0, 5);
  return t.substring(0, 5);
}

function monthDays(year: number, month: number) {
  // Returns array of Date objects for the calendar grid (including leading/trailing blanks as null)
  const first   = new Date(year, month, 1).getDay();  // 0=Sun
  const total   = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(d);
  return cells;
}

const PT_MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const PT_DAYS   = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

/* ─────────────────────────── Login ─────────────────────────── */
function LoginScreen({ onLogin }: { onLogin: (token: string, user: string) => void }) {
  const [user, setUser]     = useState('');
  const [pass, setPass]     = useState('');
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const r    = await fetch(`${API}/api/admin-auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, pass }),
      });
      const json = await r.json();
      if (!r.ok) { setError(json.error || 'Erro ao entrar'); return; }
      onLogin(json.token, json.user);
    } catch {
      setError('Erro de conexão');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center"
         style={{ background: 'linear-gradient(135deg,#7a3f8f 0%,#e87060 100%)' }}>
      <div className="bg-white rounded-2xl shadow-2xl p-10 w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
               style={{ background: 'linear-gradient(135deg,#7a3f8f,#e87060)' }}>
            <Calendar className="text-white" size={28} />
          </div>
          <h1 className="text-xl font-bold text-[#352D39]">Painel Administrativo</h1>
          <p className="text-sm text-gray-500 mt-1">Ensaio Fotográfico em Joinville</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Usuário</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
              value={user} onChange={e => setUser(e.target.value)} required autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Senha</label>
            <input
              type="password"
              className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
              value={pass} onChange={e => setPass(e.target.value)} required
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 rounded-lg px-3 py-2 text-sm">
              <AlertCircle size={14} /> {error}
            </div>
          )}

          <button
            type="submit" disabled={loading}
            className="w-full py-3 rounded-lg text-white font-semibold text-sm flex items-center justify-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg,#7a3f8f,#e87060)' }}
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : null}
            Entrar
          </button>
        </form>
      </div>
    </div>
  );
}

/* ─────────────────── Cancel Modal ──────────────────────────── */
function CancelModal({
  booking, onClose, onConfirm, loading,
}: {
  booking: Booking;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  loading: boolean;
}) {
  const [reason, setReason] = useState('');
  return (
    <Overlay onClose={onClose}>
      <h2 className="text-lg font-bold text-[#352D39] mb-1">Cancelar Agendamento</h2>
      <p className="text-sm text-gray-500 mb-5">
        {booking.name} · {fmtDate(booking.date)} às {fmtTime(booking.start)}
      </p>
      <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Motivo do cancelamento</label>
      <textarea
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200 h-24 resize-none"
        value={reason} onChange={e => setReason(e.target.value)}
        placeholder="Descreva o motivo..."
      />
      <div className="flex gap-3 mt-5">
        <button
          onClick={onClose}
          className="flex-1 border border-gray-200 rounded-lg py-2.5 text-sm text-gray-600 hover:bg-gray-50"
        >Voltar</button>
        <button
          onClick={() => reason.trim() && onConfirm(reason.trim())}
          disabled={!reason.trim() || loading}
          className="flex-1 bg-red-500 hover:bg-red-600 text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : null}
          Confirmar cancelamento
        </button>
      </div>
    </Overlay>
  );
}

/* ─────────────────── Reschedule Modal ──────────────────────── */
function RescheduleModal({
  booking, onClose, onConfirm, loading,
}: {
  booking: Booking;
  onClose: () => void;
  onConfirm: (newDate: string, newTime: string, packageKey: string) => void;
  loading: boolean;
}) {
  const [newDate, setNewDate]         = useState('');
  const [newTime, setNewTime]         = useState('');
  const [pkgKey,  setPkgKey]          = useState(PKG_KEY[booking.package] || 'lembranca');
  const [slots,   setSlots]           = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);

  useEffect(() => {
    if (!newDate) { setSlots([]); setNewTime(''); return; }
    setSlotsLoading(true);
    fetch(`${API}/api/slots?date=${newDate}`)
      .then(r => r.json())
      .then((data: Record<string, string[]>) => {
        const times = data[pkgKey] ?? [];
        setSlots(times.map(t => ({ time: t, available: true })));
        setNewTime('');
      })
      .catch(() => setSlots([]))
      .finally(() => setSlotsLoading(false));
  }, [newDate, pkgKey]);

  const today = new Date().toISOString().split('T')[0];

  return (
    <Overlay onClose={onClose}>
      <h2 className="text-lg font-bold text-[#352D39] mb-1">Remarcar Agendamento</h2>
      <p className="text-sm text-gray-500 mb-5">
        {booking.name} · atual: {fmtDate(booking.date)} às {fmtTime(booking.start)}
      </p>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Pacote</label>
          <select
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
            value={pkgKey} onChange={e => { setPkgKey(e.target.value); setNewTime(''); }}
          >
            {PACKAGES.map(p => (
              <option key={p.key} value={p.key}>{p.name} — {p.duration}min — R$ {p.price}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Nova data</label>
          <input
            type="date" min={today}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
            value={newDate} onChange={e => setNewDate(e.target.value)}
          />
        </div>

        {newDate && (
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">
              Horário disponível
              {slotsLoading && <Loader2 size={12} className="inline animate-spin ml-2" />}
            </label>
            {!slotsLoading && slots.length === 0 && (
              <p className="text-sm text-gray-400">Nenhum horário disponível nessa data</p>
            )}
            <div className="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto">
              {slots.map(s => (
                <button
                  key={s.time}
                  onClick={() => setNewTime(s.time)}
                  className={`border rounded-lg py-2 text-sm font-medium transition-colors ${
                    newTime === s.time
                      ? 'bg-[#7a3f8f] border-[#7a3f8f] text-white'
                      : 'border-gray-200 text-gray-700 hover:border-[#7a3f8f] hover:text-[#7a3f8f]'
                  }`}
                >{s.time}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-3 mt-6">
        <button
          onClick={onClose}
          className="flex-1 border border-gray-200 rounded-lg py-2.5 text-sm text-gray-600 hover:bg-gray-50"
        >Voltar</button>
        <button
          onClick={() => newDate && newTime && onConfirm(newDate, newTime, pkgKey)}
          disabled={!newDate || !newTime || loading}
          className="flex-1 text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
          style={{ background: 'linear-gradient(135deg,#7a3f8f,#e87060)' }}
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : null}
          Confirmar remarcação
        </button>
      </div>
    </Overlay>
  );
}

/* ─────────────────── Overlay wrapper ───────────────────────── */
function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: 'rgba(0,0,0,0.45)' }}
         onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
          <X size={18} />
        </button>
        {children}
      </div>
    </div>
  );
}

/* ─────────────────── Toast ──────────────────────────────────── */
function Toast({ msg, type, onDone }: { msg: string; type: 'ok' | 'err'; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3500); return () => clearTimeout(t); }, [onDone]);
  return (
    <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-5 py-3 shadow-lg text-sm font-medium flex items-center gap-2 ${
      type === 'ok' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
    }`}>
      {type === 'ok' ? <Check size={16} /> : <AlertCircle size={16} />}
      {msg}
    </div>
  );
}

/* ─────────────────── Calendar View ─────────────────────────── */
function CalendarView({
  bookings,
  onCancel,
  onReschedule,
}: {
  bookings: Booking[];
  onCancel: (b: Booking) => void;
  onReschedule: (b: Booking) => void;
}) {
  const now   = new Date();
  const [yr,  setYr]  = useState(now.getFullYear());
  const [mo,  setMo]  = useState(now.getMonth());
  const [sel, setSel] = useState<string | null>(null);  // "YYYY-MM-DD"

  const cells = monthDays(yr, mo);

  // map date string → bookings
  const byDate = bookings.reduce<Record<string, Booking[]>>((acc, b) => {
    (acc[b.date] ??= []).push(b);
    return acc;
  }, {});

  function prevMonth() {
    if (mo === 0) { setMo(11); setYr(yr - 1); } else setMo(mo - 1);
    setSel(null);
  }
  function nextMonth() {
    if (mo === 11) { setMo(0); setYr(yr + 1); } else setMo(mo + 1);
    setSel(null);
  }

  const selBookings = sel ? (byDate[sel] ?? []) : [];

  return (
    <div className="flex gap-6 flex-col lg:flex-row">
      {/* Calendar grid */}
      <div className="flex-1">
        {/* Month header */}
        <div className="flex items-center justify-between mb-4">
          <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-gray-100">
            <ChevronLeft size={18} />
          </button>
          <h2 className="text-base font-bold text-[#352D39]">{PT_MONTHS[mo]} {yr}</h2>
          <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-gray-100">
            <ChevronRight size={18} />
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 mb-2">
          {PT_DAYS.map(d => (
            <div key={d} className="text-center text-xs font-semibold text-gray-400 py-1">{d}</div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, i) => {
            if (!day) return <div key={i} />;
            const key = `${yr}-${String(mo + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
            const bks = byDate[key] ?? [];
            const isSelected = sel === key;
            const isToday = key === now.toISOString().split('T')[0];
            return (
              <button
                key={i}
                onClick={() => setSel(isSelected ? null : key)}
                className={`relative rounded-xl p-2 min-h-[52px] flex flex-col items-center transition-all border ${
                  isSelected
                    ? 'border-[#7a3f8f] bg-purple-50 shadow-sm'
                    : bks.length > 0
                    ? 'border-purple-100 bg-purple-50/30 hover:bg-purple-50'
                    : 'border-transparent hover:bg-gray-50'
                }`}
              >
                <span className={`text-xs font-semibold ${
                  isToday ? 'bg-[#7a3f8f] text-white rounded-full w-5 h-5 flex items-center justify-center' : 'text-[#352D39]'
                }`}>{day}</span>
                {bks.length > 0 && (
                  <div className="flex flex-wrap gap-0.5 justify-center mt-1">
                    {bks.slice(0, 4).map((b, j) => (
                      <span key={j} className={`w-2 h-2 rounded-full ${STATUS_DOT[b.status] ?? 'bg-gray-400'}`} />
                    ))}
                    {bks.length > 4 && <span className="text-[9px] text-gray-400">+{bks.length - 4}</span>}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex gap-4 mt-4 text-xs text-gray-500">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-500" />Confirmado</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-400" />Pendente</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-gray-400" />Cancelado</span>
        </div>
      </div>

      {/* Day detail */}
      <div className="lg:w-80">
        {sel ? (
          <div>
            <h3 className="text-sm font-bold text-[#352D39] mb-3">{fmtDate(sel)}</h3>
            {selBookings.length === 0 ? (
              <p className="text-sm text-gray-400">Nenhum agendamento neste dia.</p>
            ) : (
              <div className="space-y-3">
                {selBookings
                  .sort((a, b) => a.start.localeCompare(b.start))
                  .map(b => (
                    <BookingCard key={b.id} booking={b} onCancel={onCancel} onReschedule={onReschedule} />
                  ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-32 text-sm text-gray-400">
            Selecione um dia no calendário
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────── BookingCard ───────────────────────────── */
function BookingCard({
  booking, onCancel, onReschedule,
}: {
  booking: Booking;
  onCancel: (b: Booking) => void;
  onReschedule: (b: Booking) => void;
}) {
  const active = booking.status !== 'Cancelado';
  return (
    <div className={`rounded-xl border p-4 ${STATUS_COLOR[booking.status] ?? 'bg-gray-50 border-gray-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-sm text-[#352D39]">{booking.name}</p>
          <p className="text-xs text-gray-500 mt-0.5">{fmtTime(booking.start)} – {fmtTime(booking.end)} · {booking.package}</p>
          {booking.email && <p className="text-xs text-gray-400 mt-0.5">{booking.email}</p>}
          {booking.whatsapp && <p className="text-xs text-gray-400">{booking.whatsapp}</p>}
          {booking.price != null && (
            <p className="text-xs font-medium text-[#352D39] mt-1">R$ {Number(booking.price).toFixed(2).replace('.', ',')}</p>
          )}
        </div>
        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${STATUS_COLOR[booking.status] ?? ''}`}>
          {booking.status}
        </span>
      </div>
      {active && (
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => onReschedule(booking)}
            className="flex-1 text-xs py-1.5 rounded-lg border border-current font-semibold hover:bg-white/60 transition-colors"
          >Remarcar</button>
          <button
            onClick={() => onCancel(booking)}
            className="flex-1 text-xs py-1.5 rounded-lg border border-red-300 text-red-500 font-semibold hover:bg-red-50 transition-colors"
          >Cancelar</button>
        </div>
      )}
    </div>
  );
}

/* ─────────────────── Booking List ──────────────────────────── */
function BookingList({
  bookings,
  onCancel,
  onReschedule,
}: {
  bookings: Booking[];
  onCancel: (b: Booking) => void;
  onReschedule: (b: Booking) => void;
}) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [month,  setMonth]  = useState('');

  const filtered = bookings.filter(b => {
    if (status && b.status !== status) return false;
    if (month  && !b.date.startsWith(month)) return false;
    if (search) {
      const q = search.toLowerCase();
      return b.name.toLowerCase().includes(q)
          || (b.email ?? '').toLowerCase().includes(q)
          || (b.whatsapp ?? '').includes(q);
    }
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date) || b.start.localeCompare(a.start));

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-200 w-52"
            placeholder="Nome, e-mail ou WhatsApp"
            value={search} onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
          value={status} onChange={e => setStatus(e.target.value)}
        >
          <option value="">Todos os status</option>
          <option>Confirmado</option>
          <option>Pendente</option>
          <option>Cancelado</option>
        </select>
        <input
          type="month"
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
          value={month} onChange={e => setMonth(e.target.value)}
        />
        {(search || status || month) && (
          <button
            onClick={() => { setSearch(''); setStatus(''); setMonth(''); }}
            className="text-xs text-gray-400 hover:text-gray-600 px-2"
          >Limpar</button>
        )}
      </div>

      <p className="text-xs text-gray-400 mb-3">{filtered.length} agendamento{filtered.length !== 1 ? 's' : ''}</p>

      {/* Table — desktop */}
      <div className="hidden md:block overflow-x-auto rounded-xl border border-gray-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">Horário</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Pacote</th>
              <th className="px-4 py-3">Valor</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map(b => (
              <tr key={b.id} className="hover:bg-gray-50/50">
                <td className="px-4 py-3 font-medium text-[#352D39]">{fmtDate(b.date)}</td>
                <td className="px-4 py-3 text-gray-600">{fmtTime(b.start)} – {fmtTime(b.end)}</td>
                <td className="px-4 py-3">
                  <p className="font-medium text-[#352D39]">{b.name}</p>
                  {b.email && <p className="text-xs text-gray-400">{b.email}</p>}
                  {b.whatsapp && <p className="text-xs text-gray-400">{b.whatsapp}</p>}
                </td>
                <td className="px-4 py-3 text-gray-600">{b.package}</td>
                <td className="px-4 py-3 text-gray-600">
                  {b.price != null ? `R$ ${Number(b.price).toFixed(2).replace('.', ',')}` : '—'}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${STATUS_COLOR[b.status] ?? 'bg-gray-100 text-gray-500 border-gray-200'}`}>
                    {b.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {b.status !== 'Cancelado' && (
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => onReschedule(b)}
                        className="text-xs px-3 py-1.5 rounded-lg border border-[#7a3f8f] text-[#7a3f8f] hover:bg-purple-50 font-medium"
                      >Remarcar</button>
                      <button
                        onClick={() => onCancel(b)}
                        className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 font-medium"
                      >Cancelar</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-400">
                  Nenhum agendamento encontrado
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Cards — mobile */}
      <div className="md:hidden space-y-3">
        {filtered.map(b => (
          <BookingCard key={b.id} booking={b} onCancel={onCancel} onReschedule={onReschedule} />
        ))}
        {filtered.length === 0 && (
          <p className="text-center text-sm text-gray-400 py-8">Nenhum agendamento encontrado</p>
        )}
      </div>
    </div>
  );
}

/* ─────────────────── Dashboard ─────────────────────────────── */
function Dashboard({
  token, user, onLogout,
}: {
  token: string;
  user: string;
  onLogout: () => void;
}) {
  const [view,     setView]     = useState<'calendar' | 'list'>('calendar');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  const [cancelTarget,     setCancelTarget]     = useState<Booking | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<Booking | null>(null);
  const [actionLoading,    setActionLoading]    = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const fetchBookings = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r    = await fetch(`${API}/api/admin-bookings`, { headers: { Authorization: `Bearer ${token}` } });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error || 'Erro ao carregar');
      // Normalize date/time fields from ISO strings returned by Sheets
      const raw: Booking[] = Array.isArray(json) ? json : (json.bookings ?? []);
      setBookings(raw.map(b => ({
        ...b,
        date:  b.date?.includes('T')  ? b.date.split('T')[0]           : (b.date  ?? ''),
        start: b.start?.includes('T') ? b.start.split('T')[1].slice(0,5) : (b.start ?? ''),
        end:   b.end?.includes('T')   ? b.end.split('T')[1].slice(0,5)   : (b.end   ?? ''),
      })));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro de conexão');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchBookings(); }, [fetchBookings]);

  async function handleCancel(booking: Booking, reason: string) {
    setActionLoading(true);
    try {
      const r = await fetch(`${API}/api/admin-cancel`, {
        method: 'POST', headers,
        body: JSON.stringify({
          bookingId:   booking.id,
          reason,
          name:        booking.name,
          email:       booking.email ?? '',
          date:        booking.date,
          time:        booking.start,
          packageName: booking.package,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'Erro');
      setToast({ msg: 'Agendamento cancelado com sucesso', type: 'ok' });
      setCancelTarget(null);
      await fetchBookings();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : 'Erro ao cancelar', type: 'err' });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReschedule(booking: Booking, newDate: string, newTime: string, pkgKey: string) {
    setActionLoading(true);
    try {
      const r = await fetch(`${API}/api/admin-reschedule`, {
        method: 'POST', headers,
        body: JSON.stringify({
          bookingId:  booking.id,
          name:       booking.name,
          email:      booking.email ?? '',
          whatsapp:   booking.whatsapp ?? '',
          oldDate:    booking.date,
          oldTime:    booking.start,
          newDate,
          newTime,
          packageKey: pkgKey,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'Erro');
      setToast({ msg: 'Agendamento remarcado com sucesso', type: 'ok' });
      setRescheduleTarget(null);
      await fetchBookings();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : 'Erro ao remarcar', type: 'err' });
    } finally {
      setActionLoading(false);
    }
  }

  const confirmed = bookings.filter(b => b.status === 'Confirmado').length;
  const pending   = bookings.filter(b => b.status === 'Pendente').length;
  const cancelled = bookings.filter(b => b.status === 'Cancelado').length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                 style={{ background: 'linear-gradient(135deg,#7a3f8f,#e87060)' }}>
              <Calendar size={16} className="text-white" />
            </div>
            <span className="font-bold text-[#352D39] text-sm hidden sm:block">Painel Admin · Ensaio Joinville</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500 hidden sm:block">
              Olá, <strong className="text-[#352D39]">{user}</strong>
            </span>
            <button
              onClick={fetchBookings} title="Atualizar"
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onLogout}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-red-500 transition-colors px-2 py-1 rounded-lg hover:bg-red-50"
            >
              <LogOut size={15} /> <span className="hidden sm:block">Sair</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Confirmados', value: confirmed, color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-100' },
            { label: 'Pendentes',   value: pending,   color: 'text-amber-600', bg: 'bg-amber-50',  border: 'border-amber-100'  },
            { label: 'Cancelados',  value: cancelled, color: 'text-gray-500',  bg: 'bg-gray-50',   border: 'border-gray-100'   },
          ].map(s => (
            <div key={s.label} className={`${s.bg} border ${s.border} rounded-xl px-4 py-4 text-center`}>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* View toggle */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setView('calendar')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              view === 'calendar'
                ? 'text-white shadow-sm'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
            style={view === 'calendar' ? { background: 'linear-gradient(135deg,#7a3f8f,#e87060)' } : {}}
          >
            <Calendar size={15} /> Calendário
          </button>
          <button
            onClick={() => setView('list')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              view === 'list'
                ? 'text-white shadow-sm'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
            style={view === 'list' ? { background: 'linear-gradient(135deg,#7a3f8f,#e87060)' } : {}}
          >
            <List size={15} /> Lista
          </button>
        </div>

        {/* Content */}
        {error ? (
          <div className="bg-red-50 border border-red-100 rounded-xl p-6 text-center text-red-600 text-sm">
            <AlertCircle size={20} className="mx-auto mb-2" /> {error}
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="animate-spin text-[#7a3f8f]" />
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            {view === 'calendar'
              ? <CalendarView bookings={bookings} onCancel={setCancelTarget} onReschedule={setRescheduleTarget} />
              : <BookingList  bookings={bookings} onCancel={setCancelTarget} onReschedule={setRescheduleTarget} />
            }
          </div>
        )}
      </main>

      {/* Modals */}
      {cancelTarget && (
        <CancelModal
          booking={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onConfirm={reason => handleCancel(cancelTarget, reason)}
          loading={actionLoading}
        />
      )}
      {rescheduleTarget && (
        <RescheduleModal
          booking={rescheduleTarget}
          onClose={() => setRescheduleTarget(null)}
          onConfirm={(d, t, pkg) => handleReschedule(rescheduleTarget, d, t, pkg)}
          loading={actionLoading}
        />
      )}

      {/* Toast */}
      {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}

/* ─────────────────── Root ───────────────────────────────────── */
export default function Admin() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('admin_token'));
  const [user,  setUser]  = useState<string | null>(() => localStorage.getItem('admin_user'));

  function handleLogin(t: string, u: string) {
    localStorage.setItem('admin_token', t);
    localStorage.setItem('admin_user', u);
    setToken(t); setUser(u);
  }

  function handleLogout() {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    setToken(null); setUser(null);
  }

  if (!token || !user) return <LoginScreen onLogin={handleLogin} />;
  return <Dashboard token={token} user={user} onLogout={handleLogout} />;
}
