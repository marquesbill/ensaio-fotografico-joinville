import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

type BookingInfo = {
  clientName: string; date: string; start: string; end: string;
  packageName: string; value: number; payUrl: string; accepted: boolean;
  contractVersion: string;
};

const brl = (n: number) => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtDate(d: string) {
  if (!d || d.split('-').length !== 3) return d;
  const [y, m, day] = d.split('-').map(Number);
  const meses = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  return `${String(day).padStart(2, '0')} de ${meses[m - 1]} de ${y}`;
}

// Máscara CPF 000.000.000-00 conforme digita.
function maskCPF(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

// ── Texto do contrato (versão 2026-07-17 — PENDENTE de revisão do advogado) ──
// Fonte: ~/Downloads/Contrato_J26_Ensaios.docx. A versão fica registrada no aceite.
const CONTRATO: Array<{ h: string; ps: string[] }> = [
  { h: '', ps: [
    'CONTRATADO: André Marques Ferreira, fotógrafo, inscrito no CPF nº 075.694.504-69, empresário individual sob o CNPJ nº 33.896.468/0001-65 (André Ferreira Fotografia), doravante "FOTÓGRAFO".',
    'CONTRATANTE: pessoa identificada no formulário de agendamento (nome completo, CPF, telefone e e-mail informados no ato da reserva), doravante "CLIENTE". Quando a pessoa fotografada for menor de 18 anos, o CLIENTE declara ser seu responsável legal e responde integralmente pelas obrigações deste termo.',
  ] },
  { h: '1. Objeto', ps: [
    '1.1. Ensaio fotográfico de dança em estúdio, realizado no Estúdio Bailatina — Sala Esmeralda, Le Village, Joinville/SC, na data e horário confirmados no agendamento, com a duração correspondente ao pacote contratado, conforme descrito na confirmação de reserva enviada ao CLIENTE.',
    '1.2. A confirmação de reserva (com pacote, valor, data, horário e duração) integra este termo para todos os fins.',
  ] },
  { h: '2. Figurinos e pertences', ps: [
    '2.1. Figurinos, sapatilhas, adereços e objetos pessoais são de responsabilidade exclusiva do CLIENTE, que deve levá-los prontos para uso no dia da sessão. O FOTÓGRAFO não se responsabiliza por danos, perdas ou extravios desses itens.',
  ] },
  { h: '3. Horário, atraso e não comparecimento', ps: [
    '3.1. A sessão inicia e termina nos horários agendados. Atrasos do CLIENTE descontam do tempo de sessão, sem direito a extensão ou abatimento, em razão da agenda sequencial de ensaios do evento.',
    '3.2. O não comparecimento do CLIENTE ao ensaio, sem comunicação prévia nos prazos da cláusula 4, implica a perda integral dos valores pagos, sem direito a reagendamento, reembolso ou crédito, considerando que o horário foi reservado com exclusividade e não pôde ser oferecido a outra pessoa.',
  ] },
  { h: '4. Reagendamento e cancelamento', ps: [
    '4.1. O CLIENTE tem direito a 1 (um) reagendamento gratuito, solicitado com no mínimo 48 (quarenta e oito) horas de antecedência, sujeito à disponibilidade de agenda do FOTÓGRAFO durante o período do evento.',
    '4.2. Em caso de doença da pessoa fotografada, comprovada por atestado, o reagendamento poderá ser solicitado com até 24 (vinte e quatro) horas de antecedência, sem custo, sujeito à disponibilidade de agenda.',
    '4.3. Reagendamentos adicionais, quando houver disponibilidade, estão sujeitos a taxa de R$ 200,00 (duzentos reais) cada.',
    '4.4. Em caso de desistência definitiva comunicada por escrito com no mínimo 7 (sete) dias de antecedência, o CLIENTE será reembolsado dos valores pagos, retida a multa de 20% (vinte por cento) do valor do pacote a título de reserva de agenda. Com antecedência inferior a 7 (sete) dias, a retenção será de 50% (cinquenta por cento). O reembolso da diferença será feito em até 30 (trinta) dias corridos.',
    '4.5. Caso o FOTÓGRAFO não possa realizar a sessão por caso fortuito ou força maior, oferecerá reagendamento dentro do período do evento; sendo impossível o reagendamento, devolverá integralmente todos os valores pagos em até 15 (quinze) dias corridos, dando-se as partes por quitadas.',
  ] },
  { h: '5. Entrega', ps: [
    '5.1. As fotografias serão entregues por link digital, em JPG de alta resolução, após seleção, edição e tratamento realizados pelo FOTÓGRAFO, no prazo de até 30 (trinta) dias corridos contados da sessão.',
    '5.2. A curadoria (seleção das imagens a editar) e o tratamento de imagem seguem o critério técnico e artístico do FOTÓGRAFO, que é parte essencial do serviço contratado. Não são fornecidos arquivos RAW nem imagens sem tratamento.',
    '5.3. O link de entrega permanecerá disponível por 12 (doze) meses contados da entrega, cabendo ao CLIENTE realizar o download e a guarda dos arquivos nesse período.',
  ] },
  { h: '6. Valor e pagamento', ps: [
    '6.1. O CLIENTE pagará ao FOTÓGRAFO o valor do pacote indicado na confirmação de reserva, nas condições e datas ali estabelecidas. A reserva de data e horário somente se confirma com o pagamento do sinal; enquanto não confirmado o pagamento, o horário permanece disponível para agendamento por outras pessoas, sem qualquer garantia de reserva.',
    '6.2. Nos agendamentos realizados com menos de 7 (sete) dias de antecedência da data do ensaio, o pagamento integral deverá estar confirmado até o horário de início da sessão. Não confirmado o pagamento até esse momento, o horário será considerado vago e livre, podendo ser ocupado por outro cliente, sem que caiba ao CLIENTE qualquer reclamação ou direito de reagendamento.',
    '6.3. Em caso de inadimplemento de parcela, a entrega das imagens fica suspensa até a quitação, incidindo multa de 2% (dois por cento), juros de 1% (um por cento) ao mês e correção monetária.',
  ] },
  { h: '7. Direitos autorais e uso das imagens pelo cliente', ps: [
    '7.1. As fotografias são obra protegida pela Lei nº 9.610/1998, pertencendo os direitos autorais ao FOTÓGRAFO.',
    '7.2. Ao CLIENTE é concedida licença de uso pessoal e privado das imagens entregues, por prazo indeterminado e intransferível. É permitido o compartilhamento em redes sociais e meios pessoais, mantido o crédito ao FOTÓGRAFO (@affotografia).',
    '7.3. É vedado o uso comercial das imagens pelo CLIENTE ou por terceiros (venda, licenciamento, publicidade, materiais de escolas ou marcas), salvo autorização escrita do FOTÓGRAFO, sob pena de multa de 100% (cem por cento) do valor do contrato, sem prejuízo de perdas e danos.',
  ] },
  { h: '8. Divulgação pelo fotógrafo', ps: [
    '8.1. O FOTÓGRAFO somente utilizará imagens da pessoa fotografada em portfólio, redes sociais, site ou material de divulgação mediante autorização expressa e específica do CLIENTE, formalizada em Termo de Autorização de Uso de Imagem próprio, assinado no dia da sessão. Sem essa autorização, as imagens não serão publicadas pelo FOTÓGRAFO.',
  ] },
  { h: '9. Proteção de dados (LGPD)', ps: [
    '9.1. Os dados pessoais coletados no agendamento e neste termo serão tratados exclusivamente para a execução deste contrato, emissão de documentos fiscais, entrega das imagens e comunicação com o CLIENTE, nos termos da Lei nº 13.709/2018. Dados de menores são tratados com o consentimento do responsável legal, manifestado pelo aceite deste termo.',
  ] },
  { h: '10. Sessões com menores de idade', ps: [
    '10.1. Pessoas menores de 18 anos somente serão fotografadas com a presença do responsável legal, ou de adulto por ele expressamente indicado, durante toda a sessão.',
  ] },
  { h: '11. Registro paralelo', ps: [
    '11.1. Não é permitida a captação paralela de fotos ou vídeos por outros fotógrafos ou videomakers profissionais durante a sessão. Registros pessoais de bastidores pelo responsável são permitidos, desde que não interfiram no trabalho.',
  ] },
  { h: '12. Aceite eletrônico', ps: [
    '12.1. Este termo é aceito eletronicamente pelo CLIENTE no ato da reserva, mediante confirmação expressa (clique/registro de aceite), com registro de data, hora e identificação. As partes reconhecem a validade jurídica do aceite eletrônico, nos termos do art. 107 do Código Civil e da MP nº 2.200-2/2001.',
  ] },
  { h: '13. Disposições finais', ps: [
    '13.1. Este contrato rege-se pelo Código de Defesa do Consumidor (Lei nº 8.078/1990) e, subsidiariamente, pelo Código Civil.',
    '13.2. Fica eleito o foro da Comarca de Joinville/SC, ressalvado o direito do consumidor de optar pelo foro de seu domicílio, na forma da lei.',
  ] },
];

// Página PÚBLICA de aceite do contrato (link com token que a Mari manda ao cliente).
// Opção A: o botão "Ir para pagamento" só aparece DEPOIS do aceite registrado.
export default function Contrato() {
  const { id } = useParams<{ id: string }>();
  const [data, setData]       = useState<BookingInfo | null>(null);
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(true);

  const [checked, setChecked] = useState(false);
  const [cpf, setCpf]         = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [payUrl, setPayUrl]   = useState('');       // preenchido após aceite → libera pagamento
  const [formError, setFormError] = useState('');

  const t = new URLSearchParams(window.location.search).get('t') || '';
  const isDemo = id === 'demo';   // demo local (vite dev não roda as funções): sem rede

  useEffect(() => {
    if (isDemo) {
      setData({ clientName: 'Maria Clara Ribeiro', date: '2026-07-28', start: '14:10', end: '14:40',
        packageName: 'Lembrança', value: 1800, payUrl: 'https://www.asaas.com/c/demo-link', accepted: false,
        contractVersion: '2026-07-17' });
      setLoading(false); return;
    }
    if (!id || !t) { setError('Link inválido ou incompleto.'); setLoading(false); return; }
    fetch(`/api/contrato?id=${encodeURIComponent(id)}&t=${encodeURIComponent(t)}`)
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Erro'); return j as BookingInfo; })
      .then(d => { setData(d); if (d.accepted) setPayUrl(d.payUrl); })
      .catch(e => setError(e instanceof Error ? e.message : 'Erro ao carregar.'))
      .finally(() => setLoading(false));
  }, [id, t]);

  async function handleAccept() {
    if (!checked || cpf.replace(/\D/g, '').length !== 11 || submitting) return;
    setSubmitting(true); setFormError('');
    if (isDemo) { setTimeout(() => { setPayUrl('https://www.asaas.com/c/demo-link'); setSubmitting(false); }, 500); return; }
    try {
      const r = await fetch(`/api/contrato?id=${encodeURIComponent(id!)}&t=${encodeURIComponent(t)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpf: cpf.replace(/\D/g, '') }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Não foi possível registrar o aceite.');
      setPayUrl(j.payUrl);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Erro ao registrar o aceite.');
    } finally {
      setSubmitting(false);
    }
  }

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
          <p className="text-on-surface-variant text-sm">{error || 'Não encontramos este agendamento.'} Peça o link atualizado para a organizadora.</p>
        </div>
      </div>
    );
  }

  const firstName = data.clientName.trim().split(/\s+/)[0] || data.clientName;
  const cpfComplete = cpf.replace(/\D/g, '').length === 11;

  return (
    <div className="min-h-screen bg-surface px-5 py-10">
      <div className="max-w-xl mx-auto">
        <header className="text-center mb-6">
          <p className="text-xs font-bold uppercase tracking-widest text-primary mb-1">Ensaio Fotográfico · Joinville 2026</p>
          <h1 className="font-headline text-3xl text-on-surface leading-tight">Termo de contratação</h1>
          <p className="text-on-surface-variant text-sm mt-2">
            {firstName} · {fmtDate(data.date)} · {data.start}{data.end ? `–${data.end}` : ''}
          </p>
        </header>

        {/* Resumo da reserva */}
        <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4 mb-5">
          <p className="text-xs uppercase tracking-widest text-on-surface-variant mb-2">Sua reserva</p>
          <div className="grid grid-cols-2 gap-y-1 text-sm">
            <span className="text-on-surface-variant">Pacote</span><span className="text-on-surface font-medium text-right">{data.packageName}</span>
            <span className="text-on-surface-variant">Data</span><span className="text-on-surface font-medium text-right">{fmtDate(data.date)}</span>
            <span className="text-on-surface-variant">Horário</span><span className="text-on-surface font-medium text-right">{data.start}{data.end ? `–${data.end}` : ''}</span>
            <span className="text-on-surface-variant">Valor</span><span className="text-on-surface font-medium text-right">{brl(data.value)}</span>
          </div>
        </div>

        {/* Corpo do contrato */}
        <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5 mb-5 max-h-[46vh] overflow-y-auto">
          <h2 className="font-headline text-lg text-on-surface leading-snug">Termo de Contratação de Serviços Fotográficos</h2>
          <p className="text-on-surface-variant text-xs mb-4">J26 — Ensaios de Dança | Festival de Dança de Joinville 2026</p>
          {CONTRATO.map((sec, i) => (
            <div key={i} className="mb-3">
              {sec.h && <p className="font-bold text-on-surface text-sm mt-3 mb-1">{sec.h}</p>}
              {sec.ps.map((p, j) => (
                <p key={j} className="text-on-surface-variant text-[13px] leading-relaxed mb-1.5">{p}</p>
              ))}
            </div>
          ))}
        </div>

        {payUrl ? (
          /* Já aceitou → libera pagamento */
          <div className="bg-white rounded-2xl border border-green-200 shadow-sm p-5 text-center">
            <p className="font-bold text-green-600 mb-1">✅ Aceite registrado</p>
            <p className="text-on-surface-variant text-sm mb-4">Obrigado, {firstName}. Agora é só concluir o pagamento para garantir sua reserva.</p>
            <a
              href={payUrl} target="_blank" rel="noopener noreferrer"
              className="block w-full py-3 rounded-full text-white font-bold"
              style={{ background: 'linear-gradient(135deg,#7a3f8f,#e87060)' }}
            >
              Ir para pagamento
            </a>
          </div>
        ) : (
          /* Formulário de aceite */
          <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
            <label className="block text-sm text-on-surface font-medium mb-1">CPF do responsável pela contratação</label>
            <input
              type="text" inputMode="numeric" placeholder="000.000.000-00"
              value={cpf} onChange={e => setCpf(maskCPF(e.target.value))}
              className="w-full border border-black/10 rounded-xl px-4 py-3 text-on-surface mb-4 outline-none focus:border-primary"
            />
            <label className="flex items-start gap-3 cursor-pointer mb-4">
              <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} className="mt-1 w-5 h-5 accent-[#7a3f8f]" />
              <span className="text-sm text-on-surface leading-relaxed">Li e concordo com os termos acima do contrato de contratação do ensaio.</span>
            </label>
            {formError && <p className="text-red-600 text-sm mb-3">{formError}</p>}
            <button
              type="button" onClick={handleAccept}
              disabled={!checked || !cpfComplete || submitting}
              className="w-full py-3 rounded-full text-white font-bold disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'linear-gradient(135deg,#7a3f8f,#e87060)' }}
            >
              {submitting ? 'Registrando…' : 'Aceitar e ir para pagamento'}
            </button>
            <p className="text-center text-on-surface-variant text-xs mt-3">
              Ao aceitar, registramos nome, CPF, data e hora do aceite (assinatura eletrônica, art. 107 CC).
            </p>
          </div>
        )}

        <p className="text-center text-on-surface-variant text-xs mt-8">
          Dúvidas? Fale com a organizadora pelo WhatsApp. · Contrato v{data.contractVersion}
        </p>
      </div>
    </div>
  );
}
