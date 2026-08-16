import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { track, initSessionContext, trackScrollDepth, trackTimeOnPage } from '../lib/analytics';

// thumb: miniatura da grade (.../t/<arquivo> no R2). Ausente no demo local → cai em url.
type Foto = { id: string; url: string; thumb?: string };
type Dados = {
  clientName: string; date: string; start: string; packageName: string; numBailarinas: number;
  accepted: boolean; surveyed: boolean; photos: Foto[]; downloadUrl?: string; heroUrl?: string;
  // "58% 27%" pronto pro CSS object-position (posição do rosto, via Vision no macOS); ausente = center.
  heroFocus?: string;
  termoVersion: string;
  // Galeria temporariamente fora do ar (Script Property GALERIA_MANUTENCAO no .gs).
  maintenance?: boolean;
};

function fmtDate(d: string) {
  if (!d || d.split('-').length !== 3) return d;
  const [y, m, day] = d.split('-').map(Number);
  const meses = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  return `${String(day).padStart(2, '0')} de ${meses[m - 1]} de ${y}`;
}
const maskCPF = (v: string) => v.replace(/\D/g, '').slice(0, 11)
  .replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');

/* ── Texto de agradecimento (palavras do André) ── */
const AGRADECIMENTO = [
  'Durante as duas semanas do Festival a sala Esmeralda do Hotel Le Village foi meu estúdio. Foi um prazer te receber.',
  'Quero agradecer pela confiança no meu trabalho e pela entrega e disposição durante a sessão.',
  'Editei tudo com muito cuidado. Espero que você goste tanto das imagens quanto eu gostei de produzi-las.',
];

const INSTAGRAM = (
  <>
    Se for postar, me marca que vou adorar!{' '}
    <a href="https://www.instagram.com/affotografia" target="_blank" rel="noopener"
      className="font-bold text-primary">@affotografia</a>
  </>
);

/* ── Autorização de uso de imagem — adaptada do modelo em papel do André.
 * Identificação: responsável por nome (da planilha) + CPF; menor por nome + nascimento.
 * A revogabilidade (ex nunc) é o que sustenta a autorização gratuita de imagem de menor. */
const AUTORIZACAO_MENOR = (nome: string) =>
  `Na qualidade de responsável legal por ${nome || 'a bailarina identificada acima'}, AUTORIZO o uso da imagem do menor em todo e qualquer material fotográfico, para ser utilizada em publicações digitais ou impressas por André Marques Ferreira, CPF 075.694.504-69. A autorização abrange todo o material de divulgação do fotógrafo: portfólio, site, redes sociais, folhetos em geral, folder de apresentação e anúncios em revistas e jornais. É concedida a título gratuito, em todo o território nacional e no exterior, sem que nada haja a ser reclamado a título de direitos conexos à imagem. Declaro que o outro genitor não se opõe a esta autorização. Posso revogá-la a qualquer tempo por escrito, preservado o material já publicado ou impresso.`;

const AUTORIZACAO_ADULTO =
  'AUTORIZO o uso da minha imagem em todo e qualquer material fotográfico, para ser utilizada em publicações digitais ou impressas por André Marques Ferreira, CPF 075.694.504-69. A autorização abrange todo o material de divulgação do fotógrafo: portfólio, site, redes sociais, folhetos em geral, folder de apresentação e anúncios em revistas e jornais. É concedida a título gratuito, em todo o território nacional e no exterior, sem que nada haja a ser reclamado a título de direitos conexos à imagem. Posso revogá-la a qualquer tempo por escrito, preservado o material já publicado ou impresso.';

/* ── Perguntas da pesquisa (2, múltipla escolha, no primeiro download) ── */
const Q1 = { titulo: 'Como você chegou até mim?', opcoes: [
  'Anúncio no Instagram', 'Perfil no Instagram', 'Indicação de uma amiga',
  'Professora ou escola', 'Vi no festival', 'Google', 'Já acompanhava seu trabalho'] };
const Q2 = { titulo: 'O que pesou na decisão de fechar o ensaio?', opcoes: [
  'As fotos que vi no portfólio', 'Alguém me indicou', 'O preço e o parcelamento',
  'A professora ou a escola sugeriu', 'Ser durante o festival', 'Confiança no seu trabalho'] };

/* ── Termo (resumo na tela; texto integral em /contrato) ── */
const TERMO_RESUMO = [
  'As fotografias são obra protegida (Lei 9.610/98) e pertencem ao FOTÓGRAFO. Você recebe licença de uso pessoal e privado, por prazo indeterminado, podendo compartilhar em redes sociais e meios pessoais mantendo o crédito a @affotografia.',
  'É vedado o uso comercial das imagens por você ou por terceiros (venda, licenciamento, publicidade, material de escolas ou marcas) sem autorização escrita.',
  'A curadoria e o tratamento seguem o critério técnico e artístico do FOTÓGRAFO. Não são fornecidos arquivos RAW nem imagens sem tratamento.',
  'O link de entrega permanece disponível por 12 (doze) meses. Seus dados são tratados apenas para a execução deste contrato, nos termos da LGPD (Lei 13.709/2018).',
];

export default function Galeria() {
  const { id } = useParams<{ id: string }>();
  const t = new URLSearchParams(window.location.search).get('t') || '';

  const [dados, setDados]     = useState<Dados | null>(null);
  const [erro, setErro]       = useState('');
  const [loading, setLoading] = useState(true);

  // Portão 1
  const [cpf, setCpf]         = useState('');
  const [menor, setMenor]     = useState<boolean | null>(null);
  const [bNome, setBNome]     = useState('');
  const [bNasc, setBNasc]     = useState('');
  const [autoriza, setAutoriza] = useState(false);   // desmarcado por padrão; NÃO bloqueia o acesso
  const [enviando, setEnviando] = useState(false);
  const [erroForm, setErroForm] = useState('');

  // Galeria
  const [aberta, setAberta]       = useState<number | null>(null);
  const [showPesquisa, setShowPesquisa] = useState(false);
  const [downloadUrl, setDownloadUrl]   = useState('');
  const toqueX = useRef(0);              // x inicial do swipe no lightbox

  const isDemo = id === 'demo';   // demo local (vite dev não roda as funções): sem rede

  const post = useCallback(async (payload: Record<string, unknown>) => {
    if (isDemo) {
      await new Promise(r => setTimeout(r, 400));
      return { ok: true, downloadUrl: 'https://exemplo.invalid/download-demo' } as Record<string, unknown>;
    }
    const r = await fetch(`/api/galeria?id=${encodeURIComponent(id!)}&t=${encodeURIComponent(t)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Erro inesperado.');
    return j as Record<string, unknown>;
  }, [id, t, isDemo]);

  useEffect(() => {
    if (isDemo) {
      setDados({
        clientName: 'Ana Paula Consolino', date: '2026-07-24', start: '12:00',
        packageName: 'Completo', numBailarinas: 1, accepted: false, surveyed: false,
        photos: ['baunilha_1462-Enhanced-NR.jpg','baunilha_1504-Enhanced-NR.jpg','germana_0107-Enhanced-NR.jpg',
          'germana_0164-Enhanced-NR.jpg','join25_12.jpg','join25_15.jpg','join25_18.jpg','join25_2208.jpg',
          'join25_2215.jpg','jon25_3088.jpg','jon25_3092.jpg','jon25_4812.jpg']
          .map((f, i) => ({ id: `demo-${i}`, url: `/carrossel/${f}` })),
        heroUrl: '/carrossel/germana_0107-Enhanced-NR.jpg',   // hero vindo do próprio ensaio
        termoVersion: '2026-07-17',
      });
      setLoading(false); return;
    }
    if (!id || !t) { setErro('Link inválido ou incompleto.'); setLoading(false); return; }
    fetch(`/api/galeria?id=${encodeURIComponent(id)}&t=${encodeURIComponent(t)}`)
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Erro'); return j as Dados; })
      .then(d => { setDados(d); if (d.downloadUrl) setDownloadUrl(d.downloadUrl); })
      .catch(e => setErro(e instanceof Error ? e.message : 'Erro ao carregar.'))
      .finally(() => setLoading(false));
  }, [id, t]);

  const abrirFoto = useCallback((i: number) => {
    setAberta(i);
    track.event('galeria_foto_aberta', { foto: i + 1 });
  }, []);

  // Navegação circular do lightbox, compartilhada por botões, teclado e swipe.
  const nav = useCallback((passo: number) => {
    setAberta(a => {
      const n = dados?.photos.length ?? 0;
      if (a === null || n === 0) return a;   // a pode ser 0: comparar com null, não truthiness
      return (a + passo + n) % n;
    });
  }, [dados]);

  useEffect(() => {
    if (aberta === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape')     setAberta(null);
      if (e.key === 'ArrowRight') nav(1);
      if (e.key === 'ArrowLeft')  nav(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [aberta, nav]);

  /* ── Analytics — Clarity + GA4 pelo helper único de src/lib/analytics.ts ──────
   * Só o que agrega: id da reserva, contagens e respostas de múltipla escolha.
   * Nome, CPF e nascimento NUNCA são enviados. As fotos e o nome da cliente ficam
   * fora da gravação do Clarity via data-clarity-mask, mais abaixo — o modo padrão
   * (Balanced) mascara caixas de input e números, mas não mascara imagem nenhuma. */
  useEffect(() => {
    initSessionContext();
    trackTimeOnPage();
    const offScroll = trackScrollDepth();
    return () => { offScroll?.(); };
  }, []);

  const jaMarcou = useRef(false);
  useEffect(() => {
    if (!dados || dados.maintenance || jaMarcou.current) return;   // `dados` muda de novo no aceite; isto roda uma vez
    jaMarcou.current = true;
    track.tag('pagina', 'galeria');
    track.tag('galeria_id', id || '');
    track.tag('galeria_fotos', dados.photos.length);
    track.tag('galeria_pacote', dados.packageName);
    track.event('galeria_abriu', {
      fotos:     dados.photos.length,
      aceitou:   dados.accepted ? 'sim' : 'nao',
      respondeu: dados.surveyed ? 'sim' : 'nao',
    });
  }, [dados, id]);

  async function enviarAceite() {
    if (enviando) return;
    setErroForm('');
    if (cpf.replace(/\D/g, '').length !== 11) return setErroForm('Informe o CPF do responsável pela contratação.');
    if (menor === null) return setErroForm('Informe se a bailarina é menor de 18 anos.');
    if (menor && (!bNome.trim() || !bNasc)) return setErroForm('Preencha o nome e a data de nascimento da bailarina.');
    setEnviando(true);
    try {
      await post({ action: 'aceite', cpf: cpf.replace(/\D/g, ''), autoriza, menor,
        bailarinaNome: bNome.trim(), bailarinaNascimento: bNasc });
      setDados(d => (d ? { ...d, accepted: true } : d));
      track.tag('galeria_menor',    menor ? 'sim' : 'nao');
      track.tag('galeria_autoriza', autoriza ? 'sim' : 'nao');
      track.event('galeria_aceite', { menor: menor ? 'sim' : 'nao', autoriza: autoriza ? 'sim' : 'nao' });
      window.scrollTo({ top: 0 });
    } catch (e) {
      setErroForm(e instanceof Error ? e.message : 'Não foi possível registrar.');
    } finally { setEnviando(false); }
  }

  function pedirDownload() {
    if (downloadUrl) {
      track.event('galeria_download');
      window.open(downloadUrl, '_blank', 'noopener');
      return;
    }
    track.event('galeria_pesquisa_vista');
    setShowPesquisa(true);
  }

  if (loading) {
    return <div className="min-h-screen bg-surface grid place-items-center">
      <div className="w-10 h-10 rounded-full border-[3px] border-primary-container border-t-primary animate-spin" />
    </div>;
  }
  if (dados?.maintenance) {
    return <div className="min-h-screen bg-surface grid place-items-center px-6 text-center">
      <div className="max-w-md">
        <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-primary mb-4">Ensaio Fotográfico · Joinville 2026</p>
        <p className="font-headline text-3xl italic text-on-surface mb-3">Um instante…</p>
        <p className="text-on-surface-variant text-sm leading-relaxed">
          Estou fazendo os últimos ajustes nas suas fotos. Volte a abrir este mesmo link
          em breve — aviso pelo WhatsApp assim que estiver tudo pronto.
        </p>
        <p className="font-headline text-lg italic text-on-surface mt-6">André Ferreira</p>
      </div>
    </div>;
  }
  if (erro || !dados) {
    return <div className="min-h-screen bg-surface grid place-items-center px-6 text-center">
      <div>
        <p className="font-headline text-2xl text-on-surface mb-2">Link inválido</p>
        <p className="text-on-surface-variant text-sm">{erro || 'Não encontramos esta galeria.'} Peça o link atualizado pelo WhatsApp.</p>
      </div>
    </div>;
  }

  const primeiro = dados.clientName.trim().split(/\s+/)[0] || dados.clientName;

  /* ─────────────── PORTÃO 1: agradecimento + termo + autorização ─────────────── */
  if (!dados.accepted) {
    return (
      <div className="min-h-screen bg-surface">
        {/* data-clarity-mask: a abertura agora é uma foto da própria bailarina,
            então entra na mesma regra das outras — fora da gravação de sessão. */}
        <div data-clarity-mask="true" className="relative h-[46vh] min-h-[280px] overflow-hidden bg-[#161c29]">
          {/* object-center: o assunto fica no meio do quadro; num hero largo o corte
              tira das bordas e preserva o centro. A imagem fixa do site é só o
              último recurso, para uma galeria que ainda não tem fotos na planilha. */}
          <img src={dados.heroUrl || '/galeria-hero.jpg'} alt="" fetchPriority="high"
            style={{ objectPosition: dados.heroFocus || 'center' }}
            className="absolute inset-0 w-full h-full object-cover opacity-80" />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg,rgba(17,20,30,.35) 0%,rgba(17,20,30,.85) 100%)' }} />
          <div className="absolute inset-0 flex flex-col items-center justify-end text-center px-6 pb-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-white/70">Ensaio Fotográfico · Joinville 2026</p>
            <h1 className="font-headline text-4xl md:text-5xl text-white mt-3 italic">Suas fotos chegaram.</h1>
          </div>
        </div>

        <div className="max-w-xl mx-auto px-5 py-10">
          <p data-clarity-mask="true" className="font-headline text-2xl text-on-surface mb-1">Olá, {primeiro}.</p>
          <p className="text-xs uppercase tracking-widest text-on-surface-variant mb-5">
            {fmtDate(dados.date)} · {dados.packageName}
          </p>
          {AGRADECIMENTO.map((p, i) => (
            <p key={i} className="text-on-surface-variant leading-relaxed mb-4">{p}</p>
          ))}
          <p className="text-on-surface-variant leading-relaxed mb-4">{INSTAGRAM}</p>
          <p className="font-headline text-xl italic text-on-surface mb-8">André Ferreira</p>

          <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
            <p className="text-xs uppercase tracking-widest text-primary font-bold mb-3">
              Para abrir a galeria, confirme abaixo
            </p>

            <div className="max-h-40 overflow-y-auto pr-2 mb-5 border-l-2 border-primary-container pl-3">
              {TERMO_RESUMO.map((p, i) => (
                <p key={i} className="text-[13px] leading-relaxed text-on-surface-variant mb-2">{p}</p>
              ))}
              <p className="text-[11px] text-on-surface-variant/70 mt-2">Termo de contratação v{dados.termoVersion}.</p>
            </div>

            <label className="block text-sm font-medium text-on-surface mb-1">CPF do responsável pela contratação</label>
            <input
              type="text" inputMode="numeric" placeholder="000.000.000-00" value={cpf}
              onChange={e => setCpf(maskCPF(e.target.value))}
              className="w-full border border-black/10 rounded-xl px-4 py-3 mb-5 outline-none focus:border-primary"
            />

            <p className="text-sm font-medium text-on-surface mb-2">A bailarina fotografada é menor de 18 anos?</p>
            <div className="flex gap-3 mb-4">
              {[['Sim', true], ['Não', false]].map(([rot, val]) => (
                <button key={String(val)} type="button" onClick={() => setMenor(val as boolean)}
                  className={`flex-1 py-3 rounded-xl border text-sm font-semibold transition-colors ${
                    menor === val ? 'border-primary bg-primary/5 text-primary' : 'border-black/10 text-on-surface-variant'}`}>
                  {rot as string}
                </button>
              ))}
            </div>

            {menor === true && (
              <div className="mb-4 rounded-xl bg-surface-container-low p-4">
                <p className="text-[12px] text-on-surface-variant mb-3">
                  Para a autorização de uso de imagem de menor, preciso identificar a bailarina.
                </p>
                <label className="block text-sm font-medium text-on-surface mb-1">Nome completo da bailarina</label>
                <input type="text" value={bNome} onChange={e => setBNome(e.target.value)}
                  className="w-full border border-black/10 rounded-xl px-4 py-3 mb-3 outline-none focus:border-primary" />
                <label className="block text-sm font-medium text-on-surface mb-1">Data de nascimento</label>
                <input type="date" value={bNasc} onChange={e => setBNasc(e.target.value)}
                  className="w-full border border-black/10 rounded-xl px-4 py-3 outline-none focus:border-primary" />
              </div>
            )}

            <div className="rounded-xl border border-black/10 p-4 mb-5">
              <p className="text-[11px] uppercase tracking-widest text-primary font-bold mb-2">
                Autorização de uso de imagem
              </p>
              {/* O texto interpola o nome da bailarina menor — corpo de página, que o
                  Balanced não mascara. Fica fora da gravação. */}
              <div data-clarity-mask="true" className="max-h-32 overflow-y-auto pr-2 mb-3">
                <p className="text-[12px] leading-relaxed text-on-surface-variant">
                  {menor === true ? AUTORIZACAO_MENOR(bNome.trim()) : AUTORIZACAO_ADULTO}
                </p>
              </div>
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={autoriza} onChange={e => setAutoriza(e.target.checked)}
                  className="mt-0.5 w-5 h-5 accent-[#843c9a] shrink-0" />
                <span className="text-sm text-on-surface font-medium leading-relaxed">Autorizo</span>
              </label>
            </div>

            {erroForm && <p className="text-red-600 text-sm mb-3">{erroForm}</p>}
            <button type="button" onClick={enviarAceite} disabled={enviando}
              className="w-full py-3.5 rounded-full text-white font-bold disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg,#7a3f8f,#e87060)' }}>
              {enviando ? 'Um instante…' : 'Avançar para as fotos'}
            </button>
            <p className="text-center text-on-surface-variant text-[11px] mt-3">
              Ao avançar você declara que aceita os Termos e Condições acima. Registramos nome, CPF,
              data e hora deste aceite (assinatura eletrônica, art. 107 CC e MP 2.200-2/2001).
            </p>
          </div>
        </div>
      </div>
    );
  }

  /* ─────────────── GALERIA ─────────────── */
  return (
    <div className="min-h-screen bg-surface pb-28">
      <header className="px-5 pt-8 pb-5 max-w-6xl mx-auto">
        <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-primary">Ensaio Fotográfico · Joinville 2026</p>
        <h1 data-clarity-mask="true" className="font-headline text-3xl text-on-surface mt-1">{dados.clientName}</h1>
        <p className="text-on-surface-variant text-sm mt-1">
          {fmtDate(dados.date)} · {dados.packageName}
        </p>
        <p className="text-on-surface-variant text-sm mt-2">{INSTAGRAM}</p>
      </header>

      {/* data-clarity-mask: as fotos são de bailarinas, boa parte menores de idade — elas
          não podem entrar na gravação de sessão. O modo Balanced do Clarity mascara input
          e números, mas NÃO mascara imagem; sem este atributo os retratos subiriam. */}
      <div data-clarity-mask="true"
        className="px-5 max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-3">
        {dados.photos.map((f, i) => (
          <button key={f.id} type="button" onClick={() => abrirFoto(i)}
            aria-label={`Abrir foto ${i + 1} de ${dados.photos.length}`}
            className="group relative aspect-[2/3] overflow-hidden rounded-lg bg-black/5 cursor-zoom-in">
            {/* A grade usa a miniatura (~70 KB); os 2048 px só abrem no lightbox. */}
            <img src={f.thumb || f.url} alt="" loading="lazy" decoding="async"
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
          </button>
        ))}
      </div>

      {/* Barra fixa de download */}
      <div className="fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t border-black/5 px-5 py-3">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-on-surface truncate">
              {dados.photos.length} {dados.photos.length === 1 ? 'imagem' : 'imagens'} em alta resolução
            </p>
            <p className="text-[11px] text-on-surface-variant">Disponível até junho de 2027</p>
          </div>
          <button onClick={pedirDownload} className="px-5 py-2.5 rounded-full text-white text-sm font-bold"
            style={{ background: 'linear-gradient(135deg,#7a3f8f,#e87060)' }}>
            Baixar
          </button>
        </div>
      </div>

      {/* Lightbox */}
      {aberta !== null && (
        <div data-clarity-mask="true"
          className="fixed inset-0 z-50 bg-black/92 flex flex-col" onClick={() => setAberta(null)}>
          <div className="flex-1 grid place-items-center p-4"
            onClick={e => e.stopPropagation()}
            onTouchStart={e => { toqueX.current = e.changedTouches[0].clientX; }}
            onTouchEnd={e => {
              const dx = e.changedTouches[0].clientX - toqueX.current;
              if (Math.abs(dx) > 50) nav(dx < 0 ? 1 : -1);   // arrastou para a esquerda = próxima
            }}>
            <img src={dados.photos[aberta].url} alt="" className="max-h-[80vh] max-w-full object-contain" />
          </div>
          <div className="p-4 flex items-center justify-center gap-3" onClick={e => e.stopPropagation()}>
            <button onClick={() => nav(-1)} aria-label="Foto anterior"
              className="px-5 py-2.5 rounded-full bg-white/10 text-white text-sm">←</button>
            <button onClick={() => nav(1)} aria-label="Próxima foto"
              className="px-5 py-2.5 rounded-full bg-white/10 text-white text-sm">→</button>
          </div>
          <p className="absolute top-5 left-5 text-white/60 text-xs tabular-nums">
            {aberta + 1} / {dados.photos.length}
          </p>
          <button onClick={() => setAberta(null)} aria-label="Fechar"
            className="absolute top-4 right-4 text-white/70 text-2xl">×</button>
        </div>
      )}

      {showPesquisa && <ModalPesquisa post={post} onPronto={(url, q1, q2) => {
        setDownloadUrl(url); setShowPesquisa(false);
        setDados(d => (d ? { ...d, surveyed: true } : d));
        // As respostas já vão para a planilha; aqui elas viram filtro no Clarity e no GA4.
        track.tag('pesquisa_origem',  q1);
        track.tag('pesquisa_decisao', q2);
        track.event('galeria_pesquisa_ok', { origem: q1, decisao: q2 });
        track.event('galeria_download');
        window.open(url, '_blank', 'noopener');
      }} onFechar={() => setShowPesquisa(false)} />}
    </div>
  );
}

/* ─────────────── Portão 2: pesquisa (aparece no primeiro download) ─────────────── */
function ModalPesquisa({ post, onPronto, onFechar }: {
  post: (p: Record<string, unknown>) => Promise<Record<string, unknown>>;
  onPronto: (url: string, q1: string, q2: string) => void; onFechar: () => void;
}) {
  const [q1, setQ1] = useState(''); const [q2, setQ2] = useState('');
  const [erro, setErro] = useState(''); const [enviando, setEnviando] = useState(false);

  async function enviar() {
    if (!q1 || !q2 || enviando) return;
    setEnviando(true); setErro('');
    try {
      const j = await post({ action: 'pesquisa', q1, q2 });
      onPronto(String(j.downloadUrl || ''), q1, q2);
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro.'); setEnviando(false); }
  }

  const Bloco = ({ p, val, set }: { p: typeof Q1; val: string; set: (v: string) => void }) => (
    <div className="mb-5">
      <p className="font-headline text-lg text-on-surface mb-3">{p.titulo}</p>
      <div className="flex flex-wrap gap-2">
        {p.opcoes.map(o => (
          <button key={o} type="button" onClick={() => set(o)}
            className={`px-3.5 py-2 rounded-full text-[13px] border transition-colors ${
              val === o ? 'border-primary bg-primary text-white' : 'border-black/10 text-on-surface-variant'}`}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end md:items-center justify-center p-0 md:p-6">
      <div className="bg-white w-full md:max-w-lg rounded-t-3xl md:rounded-3xl p-6 max-h-[92vh] overflow-y-auto">
        <p className="text-[11px] uppercase tracking-widest text-primary font-bold mb-1">Antes de baixar</p>
        <p className="text-on-surface-variant text-sm mb-5">
          Duas perguntas rápidas — elas me ajudam a planejar os ensaios do ano que vem.
        </p>
        <Bloco p={Q1} val={q1} set={setQ1} />
        <Bloco p={Q2} val={q2} set={setQ2} />
        {erro && <p className="text-red-600 text-sm mb-3">{erro}</p>}
        <button onClick={enviar} disabled={!q1 || !q2 || enviando}
          className="w-full py-3.5 rounded-full text-white font-bold disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg,#7a3f8f,#e87060)' }}>
          {enviando ? 'Um instante…' : 'Responder e baixar as fotos'}
        </button>
        <button onClick={onFechar} className="w-full py-3 text-on-surface-variant text-sm">Agora não</button>
      </div>
    </div>
  );
}
