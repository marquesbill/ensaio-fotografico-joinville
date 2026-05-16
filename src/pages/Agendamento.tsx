import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle, ChevronLeft, ChevronRight, Clock, Calendar, User, Loader2, AlertCircle, Sun, Sunset, Moon } from 'lucide-react';
import { initMercadoPago, Payment } from '@mercadopago/sdk-react';

// ── Constants ─────────────────────────────────────────────────
// Troca automática de preço entre lotes
const LOTE1_START_MS = new Date('2026-05-16T00:00:00-03:00').getTime();
const LOTE2_START_MS = new Date('2026-07-01T00:00:00-03:00').getTime();
function getPackages() {
  const now = Date.now();
  let prices: { lembranca: number; economico: number; completo: number };
  if (now >= LOTE2_START_MS)      prices = { lembranca: 1800, economico: 2400, completo: 2800 };
  else if (now >= LOTE1_START_MS) prices = { lembranca: 1600, economico: 2100, completo: 2600 };
  else                            prices = { lembranca: 1400, economico: 1900, completo: 2200 };
  return [
    {
      key: 'lembranca' as const,
      name: 'Lembrança',
      duration: 30,
      price: prices.lembranca,
      maxBailarinas: 2,
      desc: 'Ideal para uma lembrança especial do festival.',
      features: ['30 min de sessão', 'Até 2 pessoas', 'Fotos editadas em alta resolução'],
      calBg: '#F0F0F0', calText: '#000000', calBold: false,
      popular: false,
    },
    {
      key: 'economico' as const,
      name: 'Econômico',
      duration: 60,
      price: prices.economico,
      maxBailarinas: 3,
      desc: 'Experiência completa com tempo para explorar diferentes looks.',
      features: ['60 min de sessão', 'Até 3 pessoas', 'Fotos editadas em alta resolução'],
      calBg: '#888888', calText: '#FFFFFF', calBold: true,
      popular: true,
    },
    {
      key: 'completo' as const,
      name: 'Completo',
      duration: 120,
      price: prices.completo,
      maxBailarinas: 4,
      desc: 'A experiência mais rica, com máxima liberdade criativa.',
      features: ['120 min de sessão', 'Até 4 pessoas', 'Fotos editadas em alta resolução'],
      calBg: '#404040', calText: '#FFFFFF', calBold: false,
      popular: false,
    },
  ];
}
function nextPriceSwitch(): number | null {
  const now = Date.now();
  if (now < LOTE1_START_MS) return LOTE1_START_MS;
  if (now < LOTE2_START_MS) return LOTE2_START_MS;
  return null;
}
type PkgKey = 'lembranca' | 'economico' | 'completo';

// Hook que recalcula PACKAGES e força re-render quando o relógio
// cruza a próxima troca de lote (caso o cliente esteja na página).
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

const DATES_START = new Date('2026-07-20T12:00:00');
const DATES_END   = new Date('2026-08-02T12:00:00');
const DOW = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const MON = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

type Period = 'manha' | 'tarde' | 'noite';

const PERIODS: { key: Period; label: string; sub: string; Icon: typeof Sun }[] = [
  { key: 'manha', label: 'Manhã',  sub: '9h às 12h',       Icon: Sun    },
  { key: 'tarde', label: 'Tarde',  sub: '12h às 18h',      Icon: Sunset },
  { key: 'noite', label: 'Noite',  sub: '18h em diante',   Icon: Moon   },
];

function allDates() {
  const out: Date[] = [];
  for (let d = new Date(DATES_START); d <= DATES_END; d.setDate(d.getDate() + 1))
    out.push(new Date(d));
  return out;
}

function toDateStr(d: Date) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function formatDateFull(dateStr: string) {
  const [y, m, d] = dateStr.split('-');
  const dt = new Date(Number(y), Number(m) - 1, Number(d));
  return `${DOW[dt.getDay()]}, ${dt.getDate()} de ${MON[dt.getMonth()]} de ${y}`;
}

function slotsByPeriod(slots: string[], period: Period): string[] {
  return slots.filter(t => {
    const h = parseInt(t.split(':')[0]);
    if (period === 'manha') return h >= 0  && h < 12;
    if (period === 'tarde') return h >= 12 && h < 18;
    return h >= 18;
  });
}

// ── Step indicator ────────────────────────────────────────────
function Steps({ step }: { step: number }) {
  const labels = ['Pacote', 'Data', 'Horário', 'Seus dados'];
  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {labels.map((l, i) => (
        <div key={i} className="flex items-center">
          <div className="flex flex-col items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all
              ${i + 1 < step ? 'bg-primary text-white' : i + 1 === step ? 'bg-primary text-white ring-4 ring-primary/20' : 'bg-surface-container text-on-surface-variant'}`}>
              {i + 1 < step ? <CheckCircle className="w-4 h-4" /> : i + 1}
            </div>
            <span className={`text-[10px] mt-1 font-semibold uppercase tracking-wide ${i + 1 === step ? 'text-primary' : 'text-on-surface-variant'}`}>{l}</span>
          </div>
          {i < labels.length - 1 && (
            <div className={`w-12 h-0.5 mb-4 mx-1 transition-all ${i + 1 < step ? 'bg-primary' : 'bg-surface-container-high'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Floating WhatsApp Button ──────────────────────────────────
function WhatsAppButton() {
  return (
    <motion.a
      className="fixed bottom-8 right-8 z-50 w-14 h-14 bg-[#25D366] text-white rounded-full flex items-center justify-center shadow-2xl"
      href={`https://wa.me/551151960627?text=${encodeURIComponent('Olá, tenho uma dúvida sobre o ensaio em Joinville!')}`}
      target="_blank"
      rel="noopener noreferrer"
      initial={{ scale: 0 }}
      animate={{
        scale: 1,
        boxShadow: [
          '0 0 15px 5px rgba(37,211,102,0.5)',
          '0 0 25px 10px rgba(37,211,102,0.65)',
          '0 0 15px 5px rgba(37,211,102,0.5)',
        ],
      }}
      transition={{
        scale: { type: 'spring', stiffness: 260, damping: 20, delay: 0.5 },
        boxShadow: { duration: 2, repeat: Infinity, ease: 'easeInOut', delay: 1.5 },
      }}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.95 }}
    >
      <svg className="w-7 h-7 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.246 2.248 3.484 5.232 3.483 8.413-.003 6.557-5.338 11.892-11.893 11.892-1.997-.001-3.951-.5-5.688-1.448l-6.308 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.438 9.889-9.886.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z" />
      </svg>
    </motion.a>
  );
}

// ── Main page ─────────────────────────────────────────────────
export default function Agendamento() {
  const [step, setStep]               = useState(1);
  const [pkg, setPkg]                 = useState<PkgKey | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [slots, setSlots]             = useState<Record<PkgKey, string[]> | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError]   = useState('');
  const [selectedPeriod, setSelectedPeriod] = useState<Period | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [form, setForm]               = useState({ nome: '', email: '', whatsapp: '', instagram: '', numBailarinas: 1 });
  const [formErrors, setFormErrors]   = useState({ nome: '', email: '', whatsapp: '', numBailarinas: '' });
  const [submitting, setSubmitting]   = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [preferenceId, setPreferenceId] = useState<string | null>(null);

  const dates = allDates();
  const PACKAGES = usePackages();
  const selectedPkg = PACKAGES.find(p => p.key === pkg);

  // Quando o pacote muda, reclampa Nº Bailarinas ao máximo permitido
  useEffect(() => {
    if (!selectedPkg) return;
    setForm(f => f.numBailarinas > selectedPkg.maxBailarinas
      ? { ...f, numBailarinas: selectedPkg.maxBailarinas }
      : f);
  }, [selectedPkg]);

  // Load slots when date changes
  useEffect(() => {
    if (!selectedDate) return;
    setSlots(null); setSlotsError(''); setSelectedTime(null); setSelectedPeriod(null);
    setLoadingSlots(true);
    fetch(`/api/slots?date=${selectedDate}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setSlots(data as Record<PkgKey, string[]>);
      })
      .catch(e => setSlotsError(e.message))
      .finally(() => setLoadingSlots(false));
  }, [selectedDate]);

  const availableSlots: string[] = (pkg && slots) ? (slots[pkg] || []) : [];

  // Periods that have at least one slot
  const availablePeriods = PERIODS.filter(p => slotsByPeriod(availableSlots, p.key).length > 0);
  const periodSlots = selectedPeriod ? slotsByPeriod(availableSlots, selectedPeriod) : [];

  // Called on submit — only checks format (empty fields are already blocked by disabled button)
  function validateForm(): boolean {
    const errors = { nome: '', email: '', whatsapp: '', numBailarinas: '' };

    if (form.nome.trim().split(/\s+/).length < 2) {
      errors.nome = 'Informe nome e sobrenome. Ex: Maria Silva';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      errors.email = 'E-mail inválido. Ex: maria@gmail.com';
    }
    const digits = form.whatsapp.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 11) {
      errors.whatsapp = 'Número inválido. Ex: (47) 99999-9999';
    }
    const nb  = Number(form.numBailarinas);
    const max = selectedPkg?.maxBailarinas ?? 1;
    if (!Number.isInteger(nb) || nb < 1 || nb > max) {
      errors.numBailarinas = `Informe entre 1 e ${max} bailarinas`;
    }

    setFormErrors(errors);
    return !errors.nome && !errors.email && !errors.whatsapp && !errors.numBailarinas;
  }

  // Inline validators — only fire when field has content
  function validateNome(value: string) {
    if (!value.trim()) { setFormErrors(fe => ({ ...fe, nome: '' })); return; }
    setFormErrors(fe => ({
      ...fe,
      nome: value.trim().split(/\s+/).length < 2 ? 'Informe nome e sobrenome. Ex: Maria Silva' : '',
    }));
  }
  function validateEmail(value: string) {
    if (!value.trim()) { setFormErrors(fe => ({ ...fe, email: '' })); return; }
    setFormErrors(fe => ({
      ...fe,
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? '' : 'E-mail inválido. Ex: maria@gmail.com',
    }));
  }
  function validateWhatsapp(value: string) {
    if (!value.trim()) { setFormErrors(fe => ({ ...fe, whatsapp: '' })); return; }
    const digits = value.replace(/\D/g, '');
    setFormErrors(fe => ({
      ...fe,
      whatsapp: digits.length >= 10 && digits.length <= 11 ? '' : 'Número inválido. Ex: (47) 99999-9999',
    }));
  }

  // Initialise MP SDK once (idempotent)
  useEffect(() => {
    initMercadoPago(import.meta.env.VITE_MP_PUBLIC_KEY as string, { locale: 'pt-BR' });
  }, []);

  async function handleCheckout() {
    if (!validateForm()) return;
    if (!pkg || !selectedDate || !selectedTime || !form.nome || !form.email || !form.whatsapp) return;
    setSubmitting(true); setSubmitError('');
    try {
      const res = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selectedDate, time: selectedTime, packageKey: pkg, name: form.nome, email: form.email, whatsapp: form.whatsapp, instagram: form.instagram, numBailarinas: form.numBailarinas }),
      });
      const data = await res.json();
      // Slot acabou de ser reservado por outra pessoa — recarrega slots e volta o usuário pra escolher
      if (res.status === 409) {
        setSelectedTime(null);
        setSlots(null);
        fetch(`/api/slots?date=${selectedDate}&t=${Date.now()}`)
          .then(r => r.json())
          .then(d => setSlots(d as Record<PkgKey, string[]>))
          .catch(() => {});
        setStep(3); // volta pra tela de escolha de horário
        throw new Error(data.error || 'Esse horário não está mais disponível.');
      }
      if (data.error) throw new Error(data.error);
      setPreferenceId(data.preferenceId);
      setStep(5);
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : 'Erro ao criar sessão de pagamento.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePaymentSubmit(formData: Record<string, unknown>) {
    if (!pkg || !selectedDate || !selectedTime || !preferenceId) return;
    try {
      const res = await fetch('/api/process-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formData,
          preferenceId,
          date: selectedDate, time: selectedTime, packageKey: pkg,
          name: form.nome, email: form.email, whatsapp: form.whatsapp, instagram: form.instagram,
          numBailarinas: form.numBailarinas,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.status === 'approved') {
        window.location.href = '/agendamento/sucesso';
      } else if (data.status === 'pending') {
        // PIX or boleto — success page handles pending too
        window.location.href = '/agendamento/sucesso';
      } else {
        throw new Error('Pagamento recusado. Verifique os dados e tente novamente.');
      }
    } catch (e: unknown) {
      throw e; // re-throw so the Brick shows its own error state
    }
  }

  const canGoStep2 = !!pkg;
  const canGoStep3 = !!selectedDate;
  const canGoStep4 = !!selectedTime;
  const canSubmit  = form.nome.trim() && form.email.trim() && form.whatsapp.trim()
                     && Number.isInteger(form.numBailarinas)
                     && form.numBailarinas >= 1
                     && form.numBailarinas <= (selectedPkg?.maxBailarinas ?? 1);

  return (
    <div className="min-h-screen bg-surface" style={{ fontFamily: 'inherit' }}>
      {/* Header */}
      <div className="-mx-0 mb-8 pt-7 pb-5 px-6 text-center" style={{ background: 'linear-gradient(135deg, #7a3f8f, #e87060)' }}>
        <a href="/" className="inline-block mb-4 transition-opacity hover:opacity-80">
          <img src="/logo-w.png" alt="Ensaio Fotográfico em Joinville" className="h-12 mx-auto" />
        </a>
        <h1 className="font-headline text-2xl md:text-3xl text-white font-black uppercase tracking-tight drop-shadow">
          Agendar Ensaio
        </h1>
        <p className="text-white/80 text-sm mt-1">Hotel Le Village · Joinville · 20 Jul – 02 Ago 2026</p>
      </div>

      <div className="max-w-2xl mx-auto px-4 pb-20">
        <Steps step={step} />

        <AnimatePresence mode="sync">

          {/* ── Step 1: Package ── */}
          {step === 1 && (
            <motion.div key="step1"
              initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }}
              transition={{ duration: 0.25 }}
            >
              <h2 className="text-xl font-bold text-on-surface mb-5 text-center">Escolha seu pacote</h2>
              <div className="space-y-4">
                {PACKAGES.map(p => (
                  <button key={p.key} type="button"
                    onClick={() => setPkg(p.key)}
                    className={`w-full text-left rounded-2xl border-2 p-5 transition-all relative
                      ${pkg === p.key ? 'border-primary bg-primary/5 shadow-md' : 'border-outline-variant bg-white/80 hover:border-primary/50'}`}
                  >
                    {p.popular && (
                      <span className="absolute -top-3 left-6 text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full text-white"
                        style={{ background: 'linear-gradient(135deg,#7a3f8f,#e87060)' }}>Mais Procurado</span>
                    )}
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-headline font-bold text-lg text-on-surface">{p.name}</span>
                          <span className="flex items-center gap-1 text-xs text-on-surface-variant"><Clock className="w-3 h-3" />{p.duration}min</span>
                        </div>
                        <p className="text-sm text-on-surface-variant mb-2">{p.desc}</p>
                        <ul className="space-y-0.5">
                          {p.features.map(f => (
                            <li key={f} className="text-xs text-on-surface-variant flex items-center gap-1.5">
                              <CheckCircle className="w-3 h-3 text-primary shrink-0" />{f}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-black text-2xl text-on-surface leading-none">R$ {p.price.toLocaleString('pt-BR')}</p>
                        <p className="text-xs text-on-surface-variant mt-0.5">à vista</p>
                        <p className="text-xs text-primary font-semibold mt-1.5">
                          6x R$ {(p.price / 6).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                        <p className="text-[10px] text-on-surface-variant">sem juros</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              <motion.button
                disabled={!canGoStep2}
                onClick={() => setStep(2)}
                className="w-full mt-6 py-4 rounded-full font-bold text-white text-lg disabled:opacity-40 transition-all"
                style={{ background: 'linear-gradient(135deg,#7a3f8f,#e87060)' }}
                whileTap={{ scale: 0.98 }}
              >
                Continuar <ChevronRight className="inline w-5 h-5" />
              </motion.button>
            </motion.div>
          )}

          {/* ── Step 2: Date ── */}
          {step === 2 && (
            <motion.div key="step2"
              initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }}
              transition={{ duration: 0.25 }}
            >
              <h2 className="text-xl font-bold text-on-surface mb-1 text-center">Escolha a data</h2>
              <p className="text-center text-sm text-on-surface-variant mb-5">20 de julho a 02 de agosto de 2026</p>

              {/* Scrollable date strip */}
              <div className="flex gap-2 overflow-x-auto pb-2 snap-x snap-mandatory">
                {dates.map(d => {
                  const ds = toDateStr(d);
                  const isSelected = ds === selectedDate;
                  const dow = DOW[d.getDay()];
                  return (
                    <button key={ds} type="button"
                      onClick={() => { setSelectedDate(ds); setSelectedTime(null); setSelectedPeriod(null); }}
                      className={`shrink-0 snap-start flex flex-col items-center justify-center rounded-xl p-3 min-w-[64px] border-2 transition-all
                        ${isSelected ? 'border-primary bg-primary text-white' : 'border-outline-variant bg-white/90 hover:border-primary/50 text-on-surface'}`}
                    >
                      <span className="text-[10px] font-semibold uppercase tracking-wider opacity-75">{dow}</span>
                      <span className="text-xl font-black leading-tight">{d.getDate()}</span>
                      <span className="text-[10px] opacity-75">{MON[d.getMonth()]}</span>
                    </button>
                  );
                })}
              </div>

              {selectedDate && (
                <p className="text-center text-sm text-primary font-semibold mt-4">{formatDateFull(selectedDate)}</p>
              )}

              <div className="flex gap-3 mt-6">
                <button type="button" onClick={() => setStep(1)}
                  className="flex-1 py-3 rounded-full border-2 border-outline-variant text-on-surface font-bold hover:bg-surface-container transition-colors">
                  <ChevronLeft className="inline w-4 h-4" /> Voltar
                </button>
                <motion.button disabled={!canGoStep3} onClick={() => setStep(3)}
                  className="flex-1 py-3 rounded-full font-bold text-white disabled:opacity-40 transition-all"
                  style={{ background: 'linear-gradient(135deg,#7a3f8f,#e87060)' }}
                  whileTap={{ scale: 0.98 }}>
                  Continuar <ChevronRight className="inline w-4 h-4" />
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* ── Step 3: Period → Time slot ── */}
          {step === 3 && (
            <motion.div key="step3"
              initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }}
              transition={{ duration: 0.25 }}
            >
              <h2 className="text-xl font-bold text-on-surface mb-1 text-center">Escolha o horário</h2>
              <p className="text-center text-sm text-on-surface-variant mb-5">
                {selectedDate && formatDateFull(selectedDate)} · {selectedPkg?.name} ({selectedPkg?.duration}min)
              </p>

              {loadingSlots && (
                <div className="flex flex-col items-center py-12 gap-3 text-primary">
                  <Loader2 className="w-8 h-8 animate-spin" />
                  <span className="text-sm">Verificando disponibilidade…</span>
                </div>
              )}

              {slotsError && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm mb-4">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  {slotsError}
                </div>
              )}

              {!loadingSlots && !slotsError && slots && (
                <>
                  {availableSlots.length === 0 ? (
                    <div className="text-center py-10 text-on-surface-variant">
                      <Calendar className="w-10 h-10 mx-auto mb-3 opacity-30" />
                      <p className="font-semibold">Sem horários disponíveis nesta data para este pacote.</p>
                      <p className="text-sm mt-1">Tente outra data.</p>
                    </div>
                  ) : (
                    <>
                      {/* Period selection */}
                      {!selectedPeriod && (
                        <div className="grid grid-cols-3 gap-3 mb-2">
                          {availablePeriods.map(({ key, label, sub, Icon }) => (
                            <button key={key} type="button"
                              onClick={() => setSelectedPeriod(key)}
                              className="flex flex-col items-center gap-2 rounded-2xl border-2 border-outline-variant bg-white/90 hover:border-primary/60 hover:bg-primary/5 py-5 px-2 transition-all"
                            >
                              <Icon className="w-7 h-7 text-primary" />
                              <span className="font-bold text-on-surface text-base">{label}</span>
                              <span className="text-xs text-on-surface-variant">{sub}</span>
                              <span className="text-xs text-primary font-semibold">{slotsByPeriod(availableSlots, key).length} horários</span>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Time slots for selected period */}
                      {selectedPeriod && (
                        <div>
                          <div className="flex items-center gap-2 mb-4">
                            <button type="button"
                              onClick={() => { setSelectedPeriod(null); setSelectedTime(null); }}
                              className="flex items-center gap-1 text-sm text-primary font-semibold hover:opacity-70 transition-opacity">
                              <ChevronLeft className="w-4 h-4" />
                              {PERIODS.find(p => p.key === selectedPeriod)?.label}
                            </button>
                            <span className="text-on-surface-variant text-sm">
                              — {PERIODS.find(p => p.key === selectedPeriod)?.sub}
                            </span>
                          </div>
                          <div className="grid grid-cols-4 gap-2">
                            {periodSlots.map(t => (
                              <button key={t} type="button"
                                onClick={() => setSelectedTime(t)}
                                className={`py-3 rounded-xl border-2 font-bold text-base transition-all
                                  ${selectedTime === t ? 'border-primary bg-primary text-white' : 'border-outline-variant bg-white/90 text-on-surface hover:border-primary/50'}`}
                              >{t}</button>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              <div className="flex gap-3 mt-6">
                <button type="button" onClick={() => { setStep(2); setSelectedPeriod(null); setSelectedTime(null); }}
                  className="flex-1 py-3 rounded-full border-2 border-outline-variant text-on-surface font-bold hover:bg-surface-container transition-colors">
                  <ChevronLeft className="inline w-4 h-4" /> Voltar
                </button>
                <motion.button disabled={!canGoStep4} onClick={() => setStep(4)}
                  className="flex-1 py-3 rounded-full font-bold text-white disabled:opacity-40 transition-all"
                  style={{ background: 'linear-gradient(135deg,#7a3f8f,#e87060)' }}
                  whileTap={{ scale: 0.98 }}>
                  Continuar <ChevronRight className="inline w-4 h-4" />
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* ── Step 4: Personal info + checkout ── */}
          {step === 4 && (
            <motion.div key="step4"
              initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }}
              transition={{ duration: 0.25 }}
            >
              <h2 className="text-xl font-bold text-on-surface mb-5 text-center">Seus dados</h2>

              {/* Summary card */}
              <div className="rounded-2xl p-4 mb-6 border border-primary/20 bg-primary/5">
                <p className="text-sm font-bold text-primary mb-2 uppercase tracking-wide">Resumo da reserva</p>
                <div className="space-y-1 text-sm text-on-surface">
                  <div className="flex justify-between"><span className="text-on-surface-variant">Pacote</span><span className="font-bold">{selectedPkg?.name} · {selectedPkg?.duration}min</span></div>
                  <div className="flex justify-between"><span className="text-on-surface-variant">Data</span><span className="font-bold">{selectedDate && formatDateFull(selectedDate)}</span></div>
                  <div className="flex justify-between"><span className="text-on-surface-variant">Horário</span><span className="font-bold">{selectedTime}</span></div>
                  <div className="flex justify-between items-end pt-2 border-t border-primary/20">
                    <span className="font-bold">Total</span>
                    <div className="text-right">
                      <span className="font-black text-primary text-base block">R$ {selectedPkg?.price.toLocaleString('pt-BR')}</span>
                      <span className="text-[11px] text-on-surface-variant">
                        ou 6x R$ {selectedPkg ? (selectedPkg.price / 6).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''} sem juros
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <form className="space-y-4" noValidate onSubmit={e => { e.preventDefault(); handleCheckout(); }}>
                {/* Nome */}
                <div>
                  <label className="block text-sm font-semibold text-on-surface mb-1.5">
                    <User className="inline w-4 h-4 mr-1" />Nome completo
                  </label>
                  <input
                    className={`w-full bg-white/90 border focus:ring-2 focus:ring-primary focus:bg-white rounded-xl px-4 py-3 text-on-surface font-medium shadow-sm transition-colors ${formErrors.nome ? 'border-red-400 bg-red-50/50' : 'border-outline-variant'}`}
                    placeholder="Ex: Maria Silva"
                    type="text" autoComplete="off"
                    value={form.nome}
                    onChange={e => { const v = e.target.value; setForm(f => ({ ...f, nome: v })); validateNome(v); }}
                  />
                  {formErrors.nome && (
                    <p className="mt-1.5 text-xs text-red-600 flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />{formErrors.nome}
                    </p>
                  )}
                </div>

                {/* E-mail */}
                <div>
                  <label className="block text-sm font-semibold text-on-surface mb-1.5">E-mail</label>
                  <input
                    className={`w-full bg-white/90 border focus:ring-2 focus:ring-primary focus:bg-white rounded-xl px-4 py-3 text-on-surface font-medium shadow-sm transition-colors ${formErrors.email ? 'border-red-400 bg-red-50/50' : 'border-outline-variant'}`}
                    placeholder="Ex: maria@gmail.com"
                    type="text" autoComplete="off"
                    value={form.email}
                    onChange={e => { const v = e.target.value; setForm(f => ({ ...f, email: v })); validateEmail(v); }}
                  />
                  {formErrors.email && (
                    <p className="mt-1.5 text-xs text-red-600 flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />{formErrors.email}
                    </p>
                  )}
                </div>

                {/* WhatsApp */}
                <div>
                  <label className="block text-sm font-semibold text-on-surface mb-1.5">WhatsApp</label>
                  <input
                    className={`w-full bg-white/90 border focus:ring-2 focus:ring-primary focus:bg-white rounded-xl px-4 py-3 text-on-surface font-medium shadow-sm transition-colors ${formErrors.whatsapp ? 'border-red-400 bg-red-50/50' : 'border-outline-variant'}`}
                    placeholder="Ex: (47) 99999-9999"
                    type="text" autoComplete="off"
                    value={form.whatsapp}
                    onChange={e => { const v = e.target.value; setForm(f => ({ ...f, whatsapp: v })); validateWhatsapp(v); }}
                  />
                  {formErrors.whatsapp && (
                    <p className="mt-1.5 text-xs text-red-600 flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />{formErrors.whatsapp}
                    </p>
                  )}
                </div>

                {/* Nº Bailarinas */}
                <div>
                  <label className="block text-sm font-semibold text-on-surface mb-1.5">
                    Nº Bailarinas
                    <span className="font-normal text-on-surface-variant text-xs"> (quantas vão posar? máx. {selectedPkg?.maxBailarinas ?? 1} no {selectedPkg?.name})</span>
                  </label>
                  <select
                    className={`w-full bg-white/90 border focus:ring-2 focus:ring-primary focus:bg-white rounded-xl px-4 py-3 text-on-surface font-medium shadow-sm transition-colors appearance-none ${formErrors.numBailarinas ? 'border-red-400 bg-red-50/50' : 'border-outline-variant'}`}
                    value={form.numBailarinas}
                    onChange={e => {
                      const nb = parseInt(e.target.value, 10) || 1;
                      setForm(f => ({ ...f, numBailarinas: nb }));
                      setFormErrors(fe => ({ ...fe, numBailarinas: '' }));
                    }}
                  >
                    {Array.from({ length: selectedPkg?.maxBailarinas ?? 1 }, (_, i) => i + 1).map(n => (
                      <option key={n} value={n}>{n} {n === 1 ? 'bailarina' : 'bailarinas'}</option>
                    ))}
                  </select>
                  {formErrors.numBailarinas && (
                    <p className="mt-1.5 text-xs text-red-600 flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />{formErrors.numBailarinas}
                    </p>
                  )}
                </div>

                {/* Instagram */}
                <div>
                  <label className="block text-sm font-semibold text-on-surface mb-1.5">Instagram <span className="font-normal text-on-surface-variant text-xs">(opcional)</span></label>
                  <input
                    className="w-full bg-white/90 border border-outline-variant focus:ring-2 focus:ring-primary focus:bg-white rounded-xl px-4 py-3 text-on-surface font-medium shadow-sm transition-colors"
                    placeholder="@seuperfil"
                    type="text" autoComplete="off"
                    value={form.instagram}
                    onChange={e => setForm(f => ({ ...f, instagram: e.target.value }))}
                  />
                </div>

                {submitError && (
                  <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-sm">
                    <AlertCircle className="w-4 h-4 shrink-0" />{submitError}
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setStep(3)}
                    className="flex-1 py-3 rounded-full border-2 border-outline-variant text-on-surface font-bold hover:bg-surface-container transition-colors">
                    <ChevronLeft className="inline w-4 h-4" /> Voltar
                  </button>
                  <motion.button
                    type="submit"
                    disabled={!canSubmit || submitting}
                    className="flex-1 py-3 rounded-full font-bold text-white disabled:opacity-40 transition-all flex items-center justify-center gap-2"
                    style={{ background: 'linear-gradient(135deg,#7a3f8f,#e87060)' }}
                    whileTap={{ scale: 0.98 }}>
                    {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Aguarde…</> : <>Ir para pagamento</>}
                  </motion.button>
                </div>

                <p className="text-xs text-center text-on-surface-variant pt-1">
                  Pagamento seguro via Mercado Pago · O horário é confirmado após o pagamento.
                </p>
              </form>
            </motion.div>
          )}

          {/* ── Step 5: Payment Brick ── */}
          {step === 5 && preferenceId && selectedPkg && (
            <motion.div key="step5"
              initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }}
              className="w-full max-w-lg mx-auto"
            >
              <h2 className="font-headline text-2xl font-black text-on-surface mb-1">Pagamento</h2>
              <p className="text-sm text-on-surface-variant mb-6">
                {selectedPkg.name} · {selectedDate ? selectedDate.split('-').reverse().join('/') : ''} às {selectedTime}
              </p>

              <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
                <Payment
                  initialization={{
                    amount: selectedPkg.price,
                    preferenceId,
                  }}
                  customization={{
                    paymentMethods: {
                      creditCard: 'all',
                      debitCard:  'all',
                      ticket:     'all',
                      bankTransfer: 'all',
                      maxInstallments: 6,
                    },
                    visual: {
                      style: {
                        theme: 'default',
                      },
                    },
                  }}
                  onSubmit={async ({ formData }) => {
                    await handlePaymentSubmit(formData as Record<string, unknown>);
                  }}
                  onError={(error) => {
                    console.error('[Payment Brick]', error);
                  }}
                />
              </div>

              <button onClick={() => setStep(4)}
                className="mt-4 w-full py-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors flex items-center justify-center gap-1">
                <ChevronLeft className="w-4 h-4" /> Voltar e alterar dados
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* WhatsApp button visible in steps 1–3 */}
      {step < 4 && <WhatsAppButton />}
    </div>
  );
}

// ── Success page ──────────────────────────────────────────────
export function AgendamentoSucesso() {
  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center px-4">
      <motion.div
        className="max-w-md w-full text-center p-10 rounded-3xl"
        style={{ background: 'rgba(80,55,100,0.72)', backdropFilter: 'blur(18px)', border: '1px solid rgba(164,109,181,0.30)' }}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
      >
        <CheckCircle className="w-16 h-16 text-purple-300 mx-auto mb-4 drop-shadow" />
        <h1 className="font-headline text-3xl text-white font-black mb-2">Reserva Confirmada!</h1>
        <p className="text-purple-200 mb-6 leading-relaxed">
          Seu pagamento foi aprovado. Você receberá um e-mail com todos os detalhes em instantes.
        </p>
        <p className="text-purple-300 text-sm mb-8">
          Dúvidas? WhatsApp <strong className="text-white">(11) 5196-0627</strong>
        </p>
        <a href="/" className="inline-block px-8 py-3 rounded-full bg-white text-purple-800 font-bold hover:bg-purple-50 transition-colors">
          Voltar ao início
        </a>
      </motion.div>
    </div>
  );
}
