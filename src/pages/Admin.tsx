import { useState, useEffect, useCallback, useRef } from 'react';
import {
  LogOut, Calendar, List,
  X, AlertCircle, Check, Loader2, RefreshCw, Search, Link2, CheckCircle, Copy, Plus, Pencil,
} from 'lucide-react';

/* ─────────────────────────── types ─────────────────────────── */
interface Booking {
  id:                   string;
  date:                 string;   // "2026-07-05"
  start:                string;   // "09:00"
  end:                  string;
  package:              string;   // display name or key
  price?:               number;
  name:                 string;
  email?:               string;
  whatsapp?:            string;
  instagram?:           string;
  instagramBailarina?:  string;
  nomeBailarina?:       string;
  numBailarinas?:       number;
  stripeSession?:       string;
  status:               string;   // "Confirmado" | "Pendente" | "Cancelado"
  createdAt?:           string;
}

interface Slot { time: string; available: boolean }

const API = import.meta.env.DEV ? '' : '';

const LOTE1_START_MS = new Date('2026-05-16T00:00:00-03:00').getTime();
const LOTE2_START_MS = new Date('2026-07-01T00:00:00-03:00').getTime();
function getPackages() {
  const now = Date.now();
  if (now >= LOTE2_START_MS) {
    return [
      { key: 'lembranca', name: 'Lembrança',  duration: 30,  price: 1800, maxBailarinas: 2 },
      { key: 'economico', name: 'Econômico',  duration: 60,  price: 2400, maxBailarinas: 3 },
      { key: 'completo',  name: 'Completo',   duration: 120, price: 2800, maxBailarinas: 4 },
    ];
  }
  if (now >= LOTE1_START_MS) {
    return [
      { key: 'lembranca', name: 'Lembrança',  duration: 30,  price: 1600, maxBailarinas: 2 },
      { key: 'economico', name: 'Econômico',  duration: 60,  price: 2100, maxBailarinas: 3 },
      { key: 'completo',  name: 'Completo',   duration: 120, price: 2600, maxBailarinas: 4 },
    ];
  }
  return [
    { key: 'lembranca', name: 'Lembrança',  duration: 30,  price: 1400, maxBailarinas: 2 },
    { key: 'economico', name: 'Econômico',  duration: 60,  price: 1900, maxBailarinas: 3 },
    { key: 'completo',  name: 'Completo',   duration: 120, price: 2200, maxBailarinas: 4 },
  ];
}
function nextPriceSwitch(): number | null {
  const now = Date.now();
  if (now < LOTE1_START_MS) return LOTE1_START_MS;
  if (now < LOTE2_START_MS) return LOTE2_START_MS;
  return null;
}
function usePackages() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const next = nextPriceSwitch();
    if (!next) return;
    const ms = next - Date.now();
    if (ms > 0 && ms < 90 * 24 * 60 * 60 * 1000) {
      const t = setTimeout(() => setTick(n => n + 1), ms + 500);
      return () => clearTimeout(t);
    }
  }, []);
  return getPackages();
}
const MAX_BAILARINAS: Record<string, number> = {
  lembranca: 2, economico: 3, completo: 4,
  'Lembrança': 2, 'Econômico': 3, 'Completo': 4,
};

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

const RANGE_START = '2026-07-20';
const RANGE_END   = '2026-08-02';
const DAY_FROM    = 8;    // 08:00
const DAY_TO      = 20;   // 20:00
const SLOT_PX     = 11;   // px per 15-min slot  (aumentado para caber tudo sem scroll da página)
const COL_PX      = 72;   // px per day column
const GUTTER_PX   = 38;   // px for time-label column

function timeToMins(t: string) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function getRange(): string[] {
  const out: string[] = [];
  let d = new Date(RANGE_START + 'T12:00:00Z');
  const end = new Date(RANGE_END + 'T12:00:00Z');
  while (d <= end) {
    out.push(d.toISOString().split('T')[0]);
    d = new Date(d.getTime() + 86_400_000);
  }
  return out;
}

const PT_WD = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

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
  const PACKAGES = usePackages();
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

/* ─────────────────── New Booking Modal ─────────────────────── */
function NewBookingModal({
  onClose, onSubmit, loading,
}: {
  onClose: () => void;
  onSubmit: (data: { name: string; email: string; whatsapp: string; instagram: string; instagramBailarina: string; nomeBailarina: string; numBailarinas: number; date: string; time: string; packageKey: string }, confirm: boolean) => void;
  loading: boolean;
}) {
  const PACKAGES = usePackages();
  const [name,                setName]                = useState('');
  const [email,               setEmail]               = useState('');
  const [whatsapp,            setWhatsapp]            = useState('');
  const [instagram,           setInstagram]           = useState('');
  const [instagramBailarina,  setInstagramBailarina]  = useState('');
  const [nomeBailarina,       setNomeBailarina]       = useState('');
  const [numBailarinas,       setNumBailarinas]       = useState<number>(1);
  const [pkgKey,              setPkgKey]              = useState('lembranca');
  const [date,     setDate]     = useState('');
  const [time,     setTime]     = useState('');
  const [slots,    setSlots]    = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);

  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    if (!date) { setSlots([]); setTime(''); return; }
    setSlotsLoading(true);
    fetch(`${API}/api/slots?date=${date}`)
      .then(r => r.json())
      .then((data: Record<string, string[]>) => {
        const times = data[pkgKey] ?? [];
        setSlots(times.map(t => ({ time: t, available: true })));
        setTime('');
      })
      .catch(() => setSlots([]))
      .finally(() => setSlotsLoading(false));
  }, [date, pkgKey]);

  const canSubmit = name.trim() && email.trim() && date && time && pkgKey
                    && Number.isInteger(numBailarinas) && numBailarinas >= 1 && numBailarinas <= 9;

  function submit(confirm: boolean) {
    if (!canSubmit) return;
    onSubmit({
      name: name.trim(), email: email.trim(), whatsapp: whatsapp.trim(),
      instagram: instagram.trim(), instagramBailarina: instagramBailarina.trim(), nomeBailarina: nomeBailarina.trim(),
      numBailarinas,
      date, time, packageKey: pkgKey,
    }, confirm);
  }

  return (
    <Overlay onClose={onClose}>
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
             style={{ background: 'linear-gradient(135deg,#7a3f8f,#e87060)' }}>
          <Plus size={18} className="text-white" />
        </div>
        <div>
          <h2 className="text-base font-bold text-[#352D39]">Novo Agendamento</h2>
          <p className="text-xs text-gray-400">Criado pelo painel admin</p>
        </div>
      </div>

      <div className="space-y-3">
        {/* Client info */}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Nome *</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
              value={name} onChange={e => setName(e.target.value)} placeholder="Nome completo"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">E-mail *</label>
            <input
              type="email"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
              value={email} onChange={e => setEmail(e.target.value)} placeholder="email@exemplo.com"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">WhatsApp</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
              value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="(00) 00000-0000"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Instagram do cliente</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
              value={instagram} onChange={e => setInstagram(e.target.value)} placeholder="@usuario"
            />
          </div>
        </div>

        {/* Bailarina */}
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Nome da bailarina</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
              value={nomeBailarina} onChange={e => setNomeBailarina(e.target.value)} placeholder="Nome completo"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Nº Bailarinas * (máx {MAX_BAILARINAS[pkgKey] ?? 4})</label>
            <select
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200 bg-white"
              value={numBailarinas}
              onChange={e => setNumBailarinas(parseInt(e.target.value, 10) || 1)}
            >
              {Array.from({ length: MAX_BAILARINAS[pkgKey] ?? 4 }, (_, i) => i + 1).map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <div className="col-span-3">
            <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Instagram da bailarina</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
              value={instagramBailarina} onChange={e => setInstagramBailarina(e.target.value)} placeholder="@bailarina"
            />
          </div>
        </div>

        {/* Package */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Pacote *</label>
          <select
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
            value={pkgKey} onChange={e => {
              const k = e.target.value;
              setPkgKey(k);
              setTime('');
              const max = MAX_BAILARINAS[k] ?? 4;
              setNumBailarinas(n => n > max ? max : n);
            }}
          >
            {PACKAGES.map(p => (
              <option key={p.key} value={p.key}>{p.name} — {p.duration}min — R$ {p.price}</option>
            ))}
          </select>
        </div>

        {/* Date */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Data *</label>
            <input
              type="date" min={today}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
              value={date} onChange={e => setDate(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">
              Horário *
              {slotsLoading && <Loader2 size={11} className="inline animate-spin ml-1" />}
            </label>
            {!date ? (
              <p className="text-xs text-gray-400 pt-2.5">Escolha a data primeiro</p>
            ) : !slotsLoading && slots.length === 0 ? (
              <p className="text-xs text-gray-400 pt-2.5">Sem horários disponíveis</p>
            ) : (
              <select
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200 disabled:opacity-50"
                value={time} onChange={e => setTime(e.target.value)} disabled={slotsLoading}
              >
                <option value="">— Selecione —</option>
                {slots.map(s => <option key={s.time} value={s.time}>{s.time}</option>)}
              </select>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-5 space-y-2">
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => submit(false)}
            disabled={!canSubmit || loading}
            className="flex items-center justify-center gap-2 py-2.5 rounded-lg border border-[#7a3f8f] text-[#7a3f8f] text-sm font-semibold hover:bg-purple-50 disabled:opacity-50 transition-colors"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
            Criar + gerar link
          </button>
          <button
            onClick={() => submit(true)}
            disabled={!canSubmit || loading}
            className="flex items-center justify-center gap-2 py-2.5 rounded-lg border border-green-400 text-green-700 text-sm font-semibold hover:bg-green-50 disabled:opacity-50 transition-colors"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
            Confirmar direto
          </button>
        </div>
        <p className="text-[10px] text-center text-gray-400">
          "Criar + gerar link" cria o agendamento pendente e retorna um link MP (3 dias).<br />
          "Confirmar direto" confirma imediatamente sem necessidade de pagamento online.
        </p>
      </div>
    </Overlay>
  );
}

/* ─────────────────── Edit Booking Modal ────────────────────── */
function EditBookingModal({
  booking, onClose, onSubmit, loading,
}: {
  booking: Booking;
  onClose: () => void;
  onSubmit: (data: { name: string; email: string; whatsapp: string; instagram: string; instagramBailarina: string; nomeBailarina: string; numBailarinas: number }) => void;
  loading: boolean;
}) {
  // Defensive: Sheets pode devolver number/null para campos como WhatsApp.
  // Convertendo tudo pra string para .trim() não quebrar.
  const s = (v: unknown) => v === null || v === undefined ? '' : String(v);
  const [name,               setName]               = useState(s(booking.name));
  const [email,              setEmail]              = useState(s(booking.email));
  const [whatsapp,           setWhatsapp]           = useState(s(booking.whatsapp));
  const [instagram,          setInstagram]          = useState(s(booking.instagram));
  const [instagramBailarina, setInstagramBailarina] = useState(s(booking.instagramBailarina));
  const [nomeBailarina,      setNomeBailarina]      = useState(s(booking.nomeBailarina));
  const maxNb = MAX_BAILARINAS[booking.package] ?? 4;
  const initialNb = (() => {
    const n = Math.floor(Number(booking.numBailarinas));
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.min(n, maxNb);
  })();
  const [numBailarinas, setNumBailarinas] = useState<number>(initialNb);

  // numBailarinas tem default seguro, então não bloqueia o save.
  const canSave = name.trim() && email.trim();

  return (
    <Overlay onClose={onClose}>
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
             style={{ background: 'linear-gradient(135deg,#7a3f8f,#e87060)' }}>
          <Pencil size={16} className="text-white" />
        </div>
        <div>
          <h2 className="text-base font-bold text-[#352D39]">Editar Agendamento</h2>
          <p className="text-xs text-gray-400">
            {fmtDate(booking.date)} · {fmtTime(booking.start)}–{fmtTime(booking.end)} · {booking.package}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Nome *</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
              value={name} onChange={e => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">E-mail *</label>
            <input
              type="email"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
              value={email} onChange={e => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">WhatsApp</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
              value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="(00) 00000-0000"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Instagram do cliente</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
              value={instagram} onChange={e => setInstagram(e.target.value)} placeholder="@usuario"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Nome da bailarina</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
              value={nomeBailarina} onChange={e => setNomeBailarina(e.target.value)} placeholder="Nome completo"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Nº Bailarinas * (máx {MAX_BAILARINAS[booking.package] ?? 4})</label>
            <select
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200 bg-white"
              value={numBailarinas}
              onChange={e => setNumBailarinas(parseInt(e.target.value, 10) || 1)}
            >
              {Array.from({ length: MAX_BAILARINAS[booking.package] ?? 4 }, (_, i) => i + 1).map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <div className="col-span-3">
            <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Instagram da bailarina</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
              value={instagramBailarina} onChange={e => setInstagramBailarina(e.target.value)} placeholder="@bailarina"
            />
          </div>
        </div>
      </div>

      <p className="text-[10px] text-gray-400 mt-3">
        Para alterar data, horário ou pacote use o botão <strong>Remarcar</strong>.
      </p>

      <div className="flex gap-3 mt-4">
        <button
          onClick={onClose}
          className="flex-1 border border-gray-200 rounded-lg py-2.5 text-sm text-gray-600 hover:bg-gray-50"
        >Cancelar</button>
        <button
          onClick={() => canSave && onSubmit({ name: name.trim(), email: email.trim(), whatsapp: whatsapp.trim(), instagram: instagram.trim(), instagramBailarina: instagramBailarina.trim(), nomeBailarina: nomeBailarina.trim(), numBailarinas })}
          disabled={!canSave || loading}
          className="flex-1 text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
          style={{ background: 'linear-gradient(135deg,#7a3f8f,#e87060)' }}
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Salvar alterações
        </button>
      </div>
    </Overlay>
  );
}

/* ─────────────────── Payment Link Modal ────────────────────── */
function PaymentLinkModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <Overlay onClose={onClose}>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
             style={{ background: 'linear-gradient(135deg,#7a3f8f,#e87060)' }}>
          <Link2 size={18} className="text-white" />
        </div>
        <div>
          <h2 className="text-base font-bold text-[#352D39]">Link de Pagamento</h2>
          <p className="text-xs text-gray-500">Válido por 7 dias · Mercado Pago</p>
        </div>
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 mb-4 break-all text-xs text-gray-700 font-mono select-all">
        {url}
      </div>

      <div className="flex gap-3">
        <button
          onClick={copy}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border border-[#7a3f8f] text-[#7a3f8f] text-sm font-semibold hover:bg-purple-50 transition-colors"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Copiado!' : 'Copiar link'}
        </button>
        <a
          href={url} target="_blank" rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-white text-sm font-semibold transition-opacity hover:opacity-90"
          style={{ background: 'linear-gradient(135deg,#7a3f8f,#e87060)' }}
        >
          <Link2 size={14} /> Abrir
        </a>
      </div>
    </Overlay>
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

/* ─────────────────── Timeline View ─────────────────────────── */
function TimelineView({
  bookings, onCancel, onReschedule, onGetPaymentLink, onConfirmPayment, onEdit, onResendEmail,
}: {
  bookings: Booking[];
  onCancel: (b: Booking) => void;
  onReschedule: (b: Booking) => void;
  onGetPaymentLink: (b: Booking) => void;
  onConfirmPayment: (b: Booking) => void;
  onEdit: (b: Booking) => void;
  onResendEmail: (b: Booking) => void;
}) {
  const [sel, setSel]       = useState<Booking | null>(null);
  const [slotPx, setSlotPx] = useState(SLOT_PX);
  const scrollRef            = useRef<HTMLDivElement>(null);

  const dates      = getRange();
  const totalSlots = (DAY_TO - DAY_FROM) * 4;
  const bodyH      = totalSlots * slotPx;

  // Fit all hours in the visible area — recompute whenever the container resizes
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const compute = () => {
      const available = el.clientHeight - 48; // 48 = day-header row (h-12)
      const px = Math.max(8, Math.floor(available / totalSlots));
      setSlotPx(px);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [totalSlots]);

  const byDate = bookings.reduce<Record<string, Booking[]>>((acc, b) => {
    (acc[b.date] ??= []).push(b); return acc;
  }, {});

  const hours = Array.from({ length: DAY_TO - DAY_FROM + 1 }, (_, i) => DAY_FROM + i);

  return (
    <div className="h-full flex flex-col">
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-x-auto">
        <div style={{ display: 'flex', minWidth: GUTTER_PX + dates.length * COL_PX }}>

          {/* Time gutter */}
          <div style={{ width: GUTTER_PX, flexShrink: 0 }} className="sticky left-0 bg-white z-10">
            <div style={{ height: 48 }} className="border-b border-gray-100" />
            <div className="relative" style={{ height: bodyH }}>
              {hours.map(h => (
                <div key={h}
                     style={{ position: 'absolute', top: (h - DAY_FROM) * 4 * slotPx - 7, right: 6 }}
                     className="text-[10px] text-gray-300 leading-none select-none">
                  {String(h).padStart(2,'0')}:00
                </div>
              ))}
            </div>
          </div>

          {/* Day columns */}
          {dates.map(date => {
            const d       = new Date(date + 'T12:00:00Z');
            const dow     = d.getUTCDay();
            const day     = d.getUTCDate();
            const mon     = d.getUTCMonth() + 1;
            const weekend = dow === 0 || dow === 6;
            const dayBks  = (byDate[date] ?? []).filter(b => !['Cancelado','Expirado'].includes((b.status ?? '').trim()));

            return (
              <div key={date} style={{ width: COL_PX, flexShrink: 0 }}>
                {/* Header */}
                <div className={`h-12 flex flex-col items-center justify-center border-b border-l border-gray-100 ${weekend ? 'bg-purple-50/50' : ''}`}>
                  <span className="text-[9px] font-medium text-gray-400 uppercase tracking-wider select-none">{PT_WD[dow]}</span>
                  <span className="text-sm font-bold text-[#352D39]">{String(day).padStart(2,'0')}/{String(mon).padStart(2,'0')}</span>
                </div>

                {/* Body */}
                <div className={`relative border-l border-gray-100 ${weekend ? 'bg-purple-50/20' : ''}`}
                     style={{ height: bodyH }}>
                  {/* Grid lines */}
                  {Array.from({ length: totalSlots }, (_, i) => (
                    <div key={i}
                         className={`absolute inset-x-0 border-t ${i % 4 === 0 ? 'border-gray-100' : 'border-gray-50'}`}
                         style={{ top: i * slotPx }}
                    />
                  ))}

                  {/* Events */}
                  {dayBks.map(b => {
                    const sm     = timeToMins(b.start) - DAY_FROM * 60;
                    const em     = timeToMins(b.end)   - DAY_FROM * 60;
                    const top    = (sm / 15) * slotPx + 1;
                    const height = Math.max((em - sm) / 15 * slotPx - 2, 18);
                    const cls    = (b.status ?? '').trim() === 'Confirmado'
                      ? 'bg-green-100 border-green-300 text-green-800'
                      : 'bg-red-100 border-red-300 text-red-800';
                    return (
                      <button key={b.id}
                              style={{ position: 'absolute', top, left: 3, right: 3, height }}
                              className={`rounded border ${cls} px-1.5 py-0.5 text-left overflow-hidden w-full hover:brightness-95 transition-all ${sel?.id === b.id ? 'ring-2 ring-offset-1 ring-[#7a3f8f]' : ''}`}
                              onClick={() => setSel(sel?.id === b.id ? null : b)}>
                        <p className="text-[10px] font-semibold leading-tight truncate">{b.name}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-4 mt-3 text-xs text-gray-400">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-green-300" />Confirmado</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-red-300" />Pendente</span>
      </div>

      {/* Detail card */}
      {sel && (
        <div className="mt-4 bg-white border border-gray-200 rounded-xl p-4 shadow-sm max-w-xs">
          <div className="flex items-start justify-between mb-2">
            <div>
              <p className="font-semibold text-sm text-[#352D39]">{sel.name}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {fmtDate(sel.date)} · {fmtTime(sel.start)}–{fmtTime(sel.end)} · {sel.package}
              </p>
              {sel.email              && <p className="text-xs text-gray-400 mt-0.5">{sel.email}</p>}
              {sel.whatsapp           && <p className="text-xs text-gray-400">{sel.whatsapp}</p>}
              {sel.instagram          && <p className="text-xs text-gray-400">📷 {sel.instagram}</p>}
              {sel.nomeBailarina      && <p className="text-xs text-purple-600 font-medium mt-0.5">💃 {sel.nomeBailarina}</p>}
              {sel.instagramBailarina && <p className="text-xs text-purple-400">📷 {sel.instagramBailarina}</p>}
              <p className="text-xs text-purple-600 mt-0.5">👯 Nº Bailarinas: <strong>{sel.numBailarinas ?? 1}</strong></p>
              {sel.price != null && (
                <p className="text-xs font-medium text-[#352D39] mt-1">
                  R$ {Number(sel.price).toFixed(2).replace('.', ',')}
                </p>
              )}
            </div>
            <button onClick={() => setSel(null)} className="text-gray-300 hover:text-gray-500 ml-2 shrink-0">
              <X size={14} />
            </button>
          </div>
          {sel.status === 'Pendente' && (
            <div className="flex gap-2 mt-3">
              <button onClick={() => { onGetPaymentLink(sel); setSel(null); }}
                      className="flex-1 text-xs py-1.5 rounded-lg border border-[#7a3f8f] text-[#7a3f8f] hover:bg-purple-50 font-medium flex items-center justify-center gap-1">
                <Link2 size={11} /> Link pgmto
              </button>
              <button onClick={() => { onConfirmPayment(sel); setSel(null); }}
                      className="flex-1 text-xs py-1.5 rounded-lg border border-green-300 text-green-600 hover:bg-green-50 font-medium flex items-center justify-center gap-1">
                <CheckCircle size={11} /> Confirmar pgmto
              </button>
            </div>
          )}
          {sel.status === 'Confirmado' && (
            <div className="flex gap-2 mt-3">
              <button onClick={() => { onResendEmail(sel); setSel(null); }}
                      className="flex-1 text-xs py-1.5 rounded-lg border border-blue-300 text-blue-600 hover:bg-blue-50 font-medium flex items-center justify-center gap-1">
                ✉️ Reenviar email
              </button>
            </div>
          )}
          <div className="flex gap-2 mt-2">
            <button onClick={() => { onEdit(sel); setSel(null); }}
                    className="flex-1 text-xs py-1.5 rounded-lg border border-[#7a3f8f] text-[#7a3f8f] hover:bg-purple-50 font-medium flex items-center justify-center gap-1">
              <Pencil size={10} /> Editar
            </button>
            <button onClick={() => { onReschedule(sel); setSel(null); }}
                    className="flex-1 text-xs py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 font-medium">
              Remarcar
            </button>
            <button onClick={() => { onCancel(sel); setSel(null); }}
                    className="flex-1 text-xs py-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 font-medium">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────── BookingCard ───────────────────────────── */
function BookingCard({
  booking, onCancel, onReschedule, onGetPaymentLink, onConfirmPayment, onEdit, onResendEmail,
}: {
  booking: Booking;
  onCancel: (b: Booking) => void;
  onReschedule: (b: Booking) => void;
  onGetPaymentLink: (b: Booking) => void;
  onConfirmPayment: (b: Booking) => void;
  onEdit: (b: Booking) => void;
  onResendEmail: (b: Booking) => void;
}) {
  const active    = booking.status !== 'Cancelado';
  const pending   = booking.status === 'Pendente';
  const confirmed = booking.status === 'Confirmado';
  return (
    <div className={`rounded-xl border p-4 ${STATUS_COLOR[booking.status] ?? 'bg-gray-50 border-gray-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-sm text-[#352D39]">{booking.name}</p>
          <p className="text-xs text-gray-500 mt-0.5">{fmtTime(booking.start)} – {fmtTime(booking.end)} · {booking.package}</p>
          {booking.email              && <p className="text-xs text-gray-400 mt-0.5">{booking.email}</p>}
          {booking.whatsapp           && <p className="text-xs text-gray-400">{booking.whatsapp}</p>}
          {booking.instagram          && <p className="text-xs text-gray-400">📷 {booking.instagram}</p>}
          {booking.nomeBailarina      && <p className="text-xs text-purple-600 font-medium mt-0.5">💃 {booking.nomeBailarina}</p>}
          {booking.instagramBailarina && <p className="text-xs text-purple-400">📷 {booking.instagramBailarina}</p>}
          <p className="text-xs text-purple-600 mt-0.5">👯 Nº Bailarinas: <strong>{booking.numBailarinas ?? 1}</strong></p>
          {booking.price != null && (
            <p className="text-xs font-medium text-[#352D39] mt-1">R$ {Number(booking.price).toFixed(2).replace('.', ',')}</p>
          )}
        </div>
        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${STATUS_COLOR[booking.status] ?? ''}`}>
          {booking.status}
        </span>
      </div>
      {pending && (
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => onGetPaymentLink(booking)}
            className="flex-1 text-xs py-1.5 rounded-lg border border-[#7a3f8f] text-[#7a3f8f] font-semibold hover:bg-white/60 transition-colors flex items-center justify-center gap-1"
          ><Link2 size={11} /> Link pgmto</button>
          <button
            onClick={() => onConfirmPayment(booking)}
            className="flex-1 text-xs py-1.5 rounded-lg border border-green-400 text-green-600 font-semibold hover:bg-green-50 transition-colors flex items-center justify-center gap-1"
          ><CheckCircle size={11} /> Confirmar pgmto</button>
        </div>
      )}
      {active && (
        <div className="flex gap-2 mt-2">
          <button
            onClick={() => onEdit(booking)}
            className="flex-1 text-xs py-1.5 rounded-lg border border-[#7a3f8f] text-[#7a3f8f] font-semibold hover:bg-purple-50 transition-colors flex items-center justify-center gap-1"
          ><Pencil size={10} /> Editar</button>
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
      {confirmed && (
        <button
          onClick={() => onResendEmail(booking)}
          className="w-full text-xs py-1.5 rounded-lg border border-blue-300 text-blue-600 font-semibold hover:bg-blue-50 transition-colors mt-2 flex items-center justify-center gap-1"
        >✉️ Reenviar email de confirmação</button>
      )}
    </div>
  );
}

/* ─────────────────── Booking List ──────────────────────────── */
function BookingList({
  bookings,
  onCancel,
  onReschedule,
  onGetPaymentLink,
  onConfirmPayment,
  onEdit,
  onResendEmail,
}: {
  bookings: Booking[];
  onCancel: (b: Booking) => void;
  onReschedule: (b: Booking) => void;
  onGetPaymentLink: (b: Booking) => void;
  onConfirmPayment: (b: Booking) => void;
  onEdit: (b: Booking) => void;
  onResendEmail: (b: Booking) => void;
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
                    <div className="flex flex-wrap gap-1.5 justify-end">
                      {b.status === 'Pendente' && (<>
                        <button
                          onClick={() => onGetPaymentLink(b)}
                          className="text-xs px-2.5 py-1.5 rounded-lg border border-[#7a3f8f] text-[#7a3f8f] hover:bg-purple-50 font-medium flex items-center gap-1"
                        ><Link2 size={11} /> Link pgmto</button>
                        <button
                          onClick={() => onConfirmPayment(b)}
                          className="text-xs px-2.5 py-1.5 rounded-lg border border-green-300 text-green-600 hover:bg-green-50 font-medium flex items-center gap-1"
                        ><CheckCircle size={11} /> Confirmar pgmto</button>
                      </>)}
                      {b.status === 'Confirmado' && (
                        <button
                          onClick={() => onResendEmail(b)}
                          className="text-xs px-2.5 py-1.5 rounded-lg border border-blue-300 text-blue-600 hover:bg-blue-50 font-medium flex items-center gap-1"
                        >✉️ Reenviar email</button>
                      )}
                      <button
                        onClick={() => onEdit(b)}
                        className="text-xs px-2.5 py-1.5 rounded-lg border border-[#7a3f8f] text-[#7a3f8f] hover:bg-purple-50 font-medium flex items-center gap-1"
                      ><Pencil size={11} /> Editar</button>
                      <button
                        onClick={() => onReschedule(b)}
                        className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 font-medium"
                      >Remarcar</button>
                      <button
                        onClick={() => onCancel(b)}
                        className="text-xs px-2.5 py-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 font-medium"
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
          <BookingCard key={b.id} booking={b} onCancel={onCancel} onReschedule={onReschedule}
                       onGetPaymentLink={onGetPaymentLink} onConfirmPayment={onConfirmPayment} onEdit={onEdit}
                       onResendEmail={onResendEmail} />
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
  const [view,     setView]     = useState<'timeline' | 'list'>('timeline');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  const [cancelTarget,     setCancelTarget]     = useState<Booking | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<Booking | null>(null);
  const [editTarget,       setEditTarget]       = useState<Booking | null>(null);
  const [actionLoading,    setActionLoading]    = useState(false);
  const [toast,            setToast]            = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const [paymentLinkUrl,   setPaymentLinkUrl]   = useState<string | null>(null);
  const [showNewBooking,   setShowNewBooking]   = useState(false);

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

  // Auto-refresh: a cada 15s, refaz o fetch em background.
  // Pausa quando: aba escondida, modal aberto, ou ação em andamento.
  useEffect(() => {
    const POLL_MS = 15_000;
    const isBusy = () =>
      !!cancelTarget || !!rescheduleTarget || !!editTarget ||
      showNewBooking || actionLoading || !!paymentLinkUrl ||
      document.visibilityState !== 'visible';

    const silentRefetch = async () => {
      if (isBusy()) return;
      try {
        const r = await fetch(`${API}/api/admin-bookings`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) return;
        const json = await r.json();
        const raw: Booking[] = Array.isArray(json) ? json : (json.bookings ?? []);
        setBookings(raw.map(b => ({
          ...b,
          date:  b.date?.includes('T')  ? b.date.split('T')[0]            : (b.date  ?? ''),
          start: b.start?.includes('T') ? b.start.split('T')[1].slice(0,5) : (b.start ?? ''),
          end:   b.end?.includes('T')   ? b.end.split('T')[1].slice(0,5)   : (b.end   ?? ''),
        })));
      } catch { /* silent */ }
    };

    const id = window.setInterval(silentRefetch, POLL_MS);
    // Refresh imediato quando a aba volta a ficar visível
    const onVis = () => { if (document.visibilityState === 'visible' && !isBusy()) silentRefetch(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [token, cancelTarget, rescheduleTarget, editTarget, showNewBooking, actionLoading, paymentLinkUrl]);

  async function handleCancel(booking: Booking, reason: string) {
    setActionLoading(true);
    try {
      const r = await fetch(`${API}/api/admin-bookings`, {
        method: 'POST', headers,
        body: JSON.stringify({
          action:        'cancel',
          bookingId:     booking.id,
          reason,
          name:          booking.name,
          email:         booking.email ?? '',
          date:          booking.date,
          time:          booking.start,
          endTime:       booking.end,
          packageKey:    PKG_KEY[booking.package] ?? 'lembranca',
          numBailarinas: booking.numBailarinas ?? 1,
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
      const r = await fetch(`${API}/api/admin-bookings`, {
        method: 'POST', headers,
        body: JSON.stringify({
          action:        'reschedule',
          bookingId:     booking.id,
          name:          booking.name,
          email:         booking.email ?? '',
          whatsapp:      booking.whatsapp ?? '',
          oldDate:       booking.date,
          oldTime:       booking.start,
          newDate,
          newTime,
          packageKey:    pkgKey,
          numBailarinas: booking.numBailarinas ?? 1,
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

  async function handleCreateBooking(
    data: { name: string; email: string; whatsapp: string; instagram: string; instagramBailarina: string; nomeBailarina: string; numBailarinas: number; date: string; time: string; packageKey: string },
    confirm: boolean,
  ) {
    setActionLoading(true);
    try {
      const r = await fetch(`${API}/api/admin-bookings`, {
        method: 'POST', headers,
        body: JSON.stringify({ action: 'create', ...data, confirm }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error || 'Erro');
      setShowNewBooking(false);
      if (!confirm && json.paymentUrl) {
        setPaymentLinkUrl(json.paymentUrl);
      } else {
        setToast({ msg: `Agendamento de ${data.name} criado e confirmado`, type: 'ok' });
      }
      await fetchBookings();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : 'Erro ao criar agendamento', type: 'err' });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleEditBooking(
    booking: Booking,
    data: { name: string; email: string; whatsapp: string; instagram: string; instagramBailarina: string; nomeBailarina: string; numBailarinas: number },
  ) {
    setActionLoading(true);
    try {
      const r = await fetch(`${API}/api/admin-bookings`, {
        method: 'POST', headers,
        body: JSON.stringify({ action: 'edit', bookingId: booking.id, ...data }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'Erro');
      setToast({ msg: `Agendamento de ${data.name} atualizado`, type: 'ok' });
      setEditTarget(null);
      await fetchBookings();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : 'Erro ao editar', type: 'err' });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleGetPaymentLink(booking: Booking) {
    setActionLoading(true);
    try {
      const r = await fetch(`${API}/api/admin-bookings`, {
        method: 'POST', headers,
        body: JSON.stringify({
          action:        'paymentLink',
          bookingId:     booking.id,
          name:          booking.name,
          email:         booking.email ?? '',
          whatsapp:      booking.whatsapp ?? '',
          date:          booking.date,
          time:          booking.start,
          packageKey:    PKG_KEY[booking.package] ?? 'lembranca',
          numBailarinas: booking.numBailarinas ?? 1,
        }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error || 'Erro');
      setPaymentLinkUrl(json.url);
      await fetchBookings();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : 'Erro ao gerar link', type: 'err' });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleConfirmPayment(booking: Booking) {
    setActionLoading(true);
    try {
      const r = await fetch(`${API}/api/admin-bookings`, {
        method: 'POST', headers,
        body: JSON.stringify({
          action:        'confirm',
          bookingId:     booking.id,
          stripeSession: booking.stripeSession ?? '',
          name:          booking.name,
          email:         booking.email ?? '',
          whatsapp:      booking.whatsapp ?? '',
          date:          booking.date,
          time:          booking.start,
          packageKey:    PKG_KEY[booking.package] ?? 'lembranca',
          numBailarinas: booking.numBailarinas ?? 1,
        }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error || 'Erro');
      setToast({ msg: `Pagamento de ${booking.name} confirmado manualmente`, type: 'ok' });
      await fetchBookings();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : 'Erro ao confirmar', type: 'err' });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleResendEmail(booking: Booking) {
    if (!confirm(`Reenviar email de confirmação para ${booking.name} (${booking.email})? André e Mari receberão em cópia.`)) return;
    setActionLoading(true);
    try {
      const r = await fetch(`${API}/api/admin-bookings`, {
        method: 'POST', headers,
        body:   JSON.stringify({ action: 'resendConfirmation', bookingId: booking.id }),
      });
      const json = await r.json();
      if (!r.ok || json.error) throw new Error(json.error || 'Erro ao reenviar');
      setToast({ msg: `Email reenviado para ${booking.name}`, type: 'ok' });
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : 'Erro ao reenviar email', type: 'err' });
    } finally {
      setActionLoading(false);
    }
  }

  const norm = (s?: string) => (s ?? '').trim().toLowerCase();
  const confirmed = bookings.filter(b => norm(b.status) === 'confirmado').length;
  const pending   = bookings.filter(b => norm(b.status) === 'pendente').length;
  const cancelled = bookings.filter(b => norm(b.status) === 'cancelado').length;
  const expired   = bookings.filter(b => norm(b.status) === 'expirado').length;

  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 shrink-0 z-40">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                 style={{ background: 'linear-gradient(135deg,#7a3f8f,#e87060)' }}>
              <Calendar size={16} className="text-white" />
            </div>
            <span className="font-bold text-[#352D39] text-sm hidden sm:block">Painel Admin · Ensaio Joinville</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 hidden sm:block mr-1">
              Olá, <strong className="text-[#352D39]">{user}</strong>
            </span>
            {/* Novo Agendamento */}
            <button
              onClick={() => setShowNewBooking(true)}
              className="flex items-center gap-1.5 text-sm font-semibold text-white px-3 py-1.5 rounded-lg transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(135deg,#7a3f8f,#e87060)' }}
            >
              <Plus size={14} /> <span className="hidden sm:block">Novo agendamento</span>
              <span className="sm:hidden">Novo</span>
            </button>
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

      <main className="flex-1 overflow-hidden flex flex-col max-w-7xl w-full mx-auto px-4 py-4">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 mb-3 shrink-0">
          {[
            { label: 'Confirmados', value: confirmed, color: 'text-green-600', bg: 'bg-green-50',  border: 'border-green-100' },
            { label: 'Pendentes',   value: pending,   color: 'text-red-600',   bg: 'bg-red-50',    border: 'border-red-100'   },
            { label: 'Cancelados',  value: cancelled, color: 'text-gray-500',  bg: 'bg-gray-50',   border: 'border-gray-100'  },
            { label: 'Expirados',   value: expired,   color: 'text-orange-500',bg: 'bg-orange-50', border: 'border-orange-100'},
          ].map(s => (
            <div key={s.label} className={`${s.bg} border ${s.border} rounded-xl px-4 py-3 text-center`}>
              <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* View toggle */}
        <div className="flex gap-2 mb-3 shrink-0">
          <button
            onClick={() => setView('timeline')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              view === 'timeline'
                ? 'text-white shadow-sm'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
            style={view === 'timeline' ? { background: 'linear-gradient(135deg,#7a3f8f,#e87060)' } : {}}
          >
            <Calendar size={15} /> Agenda
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

        {/* Content — fills remaining height, scrolls internally */}
        <div className="flex-1 overflow-hidden bg-white rounded-2xl border border-gray-100 shadow-sm">
          {error ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-red-600 text-sm">
                <AlertCircle size={20} className="mx-auto mb-2" /> {error}
              </div>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 size={24} className="animate-spin text-[#7a3f8f]" />
            </div>
          ) : (
            <div className={`h-full p-5 ${view === 'timeline' ? 'overflow-hidden' : 'overflow-auto'}`}>
              {view === 'timeline'
                ? <TimelineView bookings={bookings} onCancel={setCancelTarget} onReschedule={setRescheduleTarget}
                                onGetPaymentLink={handleGetPaymentLink} onConfirmPayment={handleConfirmPayment} onEdit={setEditTarget}
                                onResendEmail={handleResendEmail} />
                : <BookingList  bookings={bookings} onCancel={setCancelTarget} onReschedule={setRescheduleTarget}
                                onGetPaymentLink={handleGetPaymentLink} onConfirmPayment={handleConfirmPayment} onEdit={setEditTarget}
                                onResendEmail={handleResendEmail} />
              }
            </div>
          )}
        </div>
      </main>

      {/* Modals */}
      {showNewBooking && (
        <NewBookingModal
          onClose={() => setShowNewBooking(false)}
          onSubmit={handleCreateBooking}
          loading={actionLoading}
        />
      )}
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
      {editTarget && (
        <EditBookingModal
          booking={editTarget}
          onClose={() => setEditTarget(null)}
          onSubmit={data => handleEditBooking(editTarget, data)}
          loading={actionLoading}
        />
      )}

      {/* Payment link modal */}
      {paymentLinkUrl && (
        <PaymentLinkModal url={paymentLinkUrl} onClose={() => setPaymentLinkUrl(null)} />
      )}

      {/* Action loading overlay (for get-payment-link / confirm-payment, not modals) */}
      {actionLoading && !cancelTarget && !rescheduleTarget && !editTarget && !showNewBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
             style={{ background: 'rgba(0,0,0,0.25)' }}>
          <div className="bg-white rounded-2xl px-8 py-6 shadow-2xl flex items-center gap-3">
            <Loader2 size={20} className="animate-spin text-[#7a3f8f]" />
            <span className="text-sm font-medium text-[#352D39]">Processando…</span>
          </div>
        </div>
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
