import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

type Payer = { name: string; value: number; url: string; paid: boolean };
type EspecialData = {
  id: string; clientName: string; date: string; start: string; end: string;
  status: string; allPaid: boolean; payers: Payer[];
};

const brl = (n: number) => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtDate(d: string) {
  if (!d || d.split('-').length !== 3) return d;
  const [y, m, day] = d.split('-').map(Number);
  const meses = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  return `${String(day).padStart(2, '0')} de ${meses[m - 1]} de ${y}`;
}

// Página PÚBLICA do ensaio Especial (link com token que a Mari manda pro grupo).
// Cada pessoa acha seu nome + valor + botão de pagar; mostra quem já pagou.
export default function Especial() {
  const { id } = useParams<{ id: string }>();
  const [data, setData]       = useState<EspecialData | null>(null);
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('t') || '';
    if (!id || !t) { setError('Link inválido ou incompleto.'); setLoading(false); return; }
    fetch(`/api/especial?id=${encodeURIComponent(id)}&t=${encodeURIComponent(t)}`)
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Erro'); return j as EspecialData; })
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : 'Erro ao carregar.'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface grid place-items-center">
        <div className="w-10 h-10 rounded-full border-[3px] border-primary-container border-t-primary animate-spin" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="min-h-screen bg-surface grid place-items-center px-6 text-center">
        <div>
          <p className="font-headline text-2xl text-on-surface mb-2">Link inválido</p>
          <p className="text-on-surface-variant text-sm">{error || 'Não encontramos este ensaio.'} Peça o link atualizado para a organizadora.</p>
        </div>
      </div>
    );
  }

  const paidCount = data.payers.filter(p => p.paid).length;
  const faltam = data.payers.length - paidCount;

  return (
    <div className="min-h-screen bg-surface px-5 py-10">
      <div className="max-w-md mx-auto">
        <header className="text-center mb-6">
          <p className="text-xs font-bold uppercase tracking-widest text-primary mb-1">Ensaio Fotográfico · Joinville 2026</p>
          <h1 className="font-headline text-3xl text-on-surface leading-tight">Ensaio Especial</h1>
          <p className="text-on-surface-variant text-sm mt-2">
            {fmtDate(data.date)} · {data.start}{data.end ? `–${data.end}` : ''}
          </p>
        </header>

        {/* Status */}
        <div
          className="rounded-2xl p-4 mb-5 text-center text-white"
          style={{ background: data.allPaid ? 'linear-gradient(135deg,#16a34a,#15803d)' : 'linear-gradient(135deg,#7a3f8f,#e87060)' }}
        >
          {data.allPaid ? (
            <p className="font-bold text-lg">✅ Ensaio confirmado! Todos pagaram.</p>
          ) : (
            <>
              <p className="font-bold text-lg">{paidCount} de {data.payers.length} pagaram</p>
              <p className="text-white/85 text-sm mt-0.5">Falta{faltam > 1 ? 'm' : ''} {faltam} pagamento{faltam > 1 ? 's' : ''} para confirmar o ensaio.</p>
            </>
          )}
        </div>

        {/* Lista de pagadores */}
        <div className="space-y-3">
          {data.payers.map((p, i) => (
            <div key={i} className="bg-white rounded-2xl border border-black/5 shadow-sm p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold text-on-surface truncate">{p.name}</p>
                <p className="text-on-surface-variant text-sm">{brl(p.value)}</p>
              </div>
              {p.paid ? (
                <span className="shrink-0 inline-flex items-center gap-1 text-sm font-bold text-green-600">✅ Pago</span>
              ) : p.url ? (
                <a
                  href={p.url} target="_blank" rel="noopener noreferrer"
                  className="shrink-0 px-4 py-2 rounded-full text-white text-sm font-bold"
                  style={{ background: 'linear-gradient(135deg,#7a3f8f,#e87060)' }}
                >
                  Pagar
                </a>
              ) : (
                <span className="shrink-0 text-xs text-on-surface-variant">link indisponível</span>
              )}
            </div>
          ))}
        </div>

        <p className="text-center text-on-surface-variant text-xs mt-8">
          Cada pessoa paga sua parte. O ensaio é confirmado quando todos os pagamentos entram.
        </p>
      </div>
    </div>
  );
}
