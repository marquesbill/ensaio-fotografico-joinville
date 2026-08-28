import { useEffect, useRef, useState } from 'react';

/* ── Vídeos 5678: player inline + carrinho com desconto progressivo ──────────
 * Mobile-first: os dois são bottom-sheets (como o ModalPesquisa). O player NÃO
 * é tela cheia e não oferece download (preview 360p com marca d'água — o 4K só
 * existe depois da compra). O preço exibido aqui é cortesia; quem manda é o
 * servidor (api/videos-checkout.ts recalcula pela quantidade). */

const GRAD = 'linear-gradient(135deg,#7a3f8f,#e87060)';
// alvo de toque de 44px (mínimo da Apple) — cabeçalho e setas do palco
const ICO = 'w-11 h-11 shrink-0 grid place-items-center rounded-full bg-white/10 border border-white/20 text-white';

// Curva fechada com o André (27/08/2026) — espelho de api/videos-checkout.ts.
const TABELA = [0, 120, 220, 320, 400, 460, 520];
export const precoVideos = (n: number) => (n <= 0 ? 0 : n <= 6 ? TABELA[n] : 520 + 60 * (n - 6));

const fmt = (v: number) => `R$ ${v.toLocaleString('pt-BR')}`;

/* ─────────────── Player ─────────────── */
export function VideoSheet({ videoUrl, poster, numero, posicao, total, noCarrinho, qtd,
  onCarrinho, onVerCarrinho, onVerPrecos, onNavegar, onVerFoto, onFechar }: {
  videoUrl: string; poster?: string; numero: string;
  /** posição deste vídeo entre os que têm vídeo (1-based) e o total */
  posicao: number; total: number;
  noCarrinho: boolean; qtd: number;
  onCarrinho: () => void; onVerCarrinho: () => void; onVerPrecos: () => void;
  /** -1 = vídeo anterior, +1 = próximo (só chamado quando existe) */
  onNavegar: (passo: -1 | 1) => void;
  onVerFoto: () => void; onFechar: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [tocando, setTocando] = useState(true);
  useEffect(() => { videoRef.current?.play().catch(() => {}); }, [videoUrl]);

  const temAnt = posicao > 1, temProx = posicao < total;

  const alternaPlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    const v = videoRef.current; if (!v) return;
    if (v.paused) v.play().catch(() => {}); else v.pause();
  };

  // setas do teclado no desktop; no celular quem navega é o swipe (abaixo)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && temProx) onNavegar(1);
      if (e.key === 'ArrowLeft'  && temAnt)  onNavegar(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [temAnt, temProx, onNavegar]);

  // swipe horizontal simples: o <video> tem controles próprios, então o gesto
  // fica na MOLDURA em volta dele, não no elemento (senão briga com o scrub).
  const toque = useRef({ x: 0, y: 0 });
  const inicioToque = (e: React.TouchEvent) => {
    toque.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const fimToque = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - toque.current.x;
    const dy = e.changedTouches[0].clientY - toque.current.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;   // vertical = não é troca
    if (dx < 0 && temProx) onNavegar(1);
    if (dx > 0 && temAnt)  onNavegar(-1);
  };

  return (
    /* Fundo OPACO: com bg-black/90 o lightbox aparecia por baixo e os botões de lá
     * "vazavam" atrás destes. Três faixas fixas — cabeçalho, palco, ações —, nenhuma
     * sobreposta. Tap fora do vídeo volta para a foto. */
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#0e0a16]" data-clarity-mask="true" onClick={onFechar}>
      <div className="shrink-0 h-14 pt-[env(safe-area-inset-top)] box-content flex items-center gap-2.5 px-3"
        onClick={e => e.stopPropagation()}>
        {/* o X do player volta para a FOTO (o X da foto é que sai para a galeria) */}
        <button type="button" onClick={onVerFoto} aria-label="Fechar o vídeo e ver a foto" className={ICO}>
          <svg width="15" height="15" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-white font-headline text-[17px] italic leading-tight truncate">Vídeo5678 · foto {Number(numero)}</p>
          {total > 1 && <p className="text-white/55 text-[11px] tabular-nums mt-0.5">vídeo {posicao} de {total}</p>}
        </div>
        <button type="button" onClick={qtd > 0 ? onVerCarrinho : onVerPrecos}
          aria-label={qtd > 0 ? `Ver carrinho com ${qtd} vídeos` : 'Ver preços'}
          className={`${ICO} relative`}>
          {qtd > 0 ? (
            <>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="9" cy="20" r="1.6" /><circle cx="17" cy="20" r="1.6" />
                <path d="M2 3h3l2.6 12.5a1.6 1.6 0 0 0 1.6 1.3h7.9a1.6 1.6 0 0 0 1.6-1.3L21 8H6" />
              </svg>
              <span className="absolute -top-0.5 -right-0.5 min-w-[19px] h-[19px] px-1 rounded-full text-[11px] font-extrabold grid place-items-center border-2 border-[#0e0a16] text-white"
                style={{ background: GRAD }}>{qtd}</span>
            </>
          ) : <span className="text-[15px] font-bold">R$</span>}
        </button>
      </div>

      {/* Palco: setas nas FAIXAS LATERAIS (nunca sobre o vídeo) e vídeo contido por
          object-contain — com aspect-ratio no elemento ele estourava a moldura. */}
      <div className="flex-1 min-h-0 grid items-center gap-1 px-1"
        style={{ gridTemplateColumns: '52px minmax(0,1fr) 52px' }}
        onTouchStart={inicioToque} onTouchEnd={fimToque}>
        {temAnt ? (
          <button type="button" aria-label="Vídeo anterior" onClick={e => { e.stopPropagation(); onNavegar(-1); }}
            className={`${ICO} justify-self-center text-2xl`}>‹</button>
        ) : <span />}

        <div className="relative h-full w-full" onClick={alternaPlay}>
          <video
            ref={videoRef} src={videoUrl} poster={poster}
            playsInline loop preload="metadata"
            onPlay={() => setTocando(true)} onPause={() => setTocando(false)}
            onContextMenu={e => e.preventDefault()}
            className="absolute inset-0 h-full w-full object-contain"
          />
          {/* Controles PRÓPRIOS (sem `controls`): é a única forma de não ter tela cheia
              nem PiP no iPhone — o Safari iOS ignora controlsList e disablePictureInPicture. */}
          {!tocando && (
            <span className="absolute inset-0 grid place-items-center pointer-events-none">
              <span className="w-16 h-16 rounded-full bg-black/55 border border-white/30 grid place-items-center">
                {/* triângulo desenhado: o emoji ▶ varia por plataforma e sai torto */}
                <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" className="ml-1">
                  <path d="M6 3.5 L22 13 L6 22.5 Z" fill="#fff" />
                </svg>
              </span>
            </span>
          )}
        </div>

        {temProx ? (
          <button type="button" aria-label="Próximo vídeo" onClick={e => { e.stopPropagation(); onNavegar(1); }}
            className={`${ICO} justify-self-center text-2xl`}>›</button>
        ) : <span />}
      </div>

      {/* Ações: faixa própria, com respiro (20px de borda, 12px entre elementos) */}
      <div className="shrink-0 px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] flex flex-col gap-3 w-full max-w-sm mx-auto"
        onClick={e => e.stopPropagation()}>
        {/* Já no carrinho vira ESTADO, não botão: tirar é só no carrinho (decisão do
            André, 28/08) — evita a mãe tirar sem querer ao tocar duas vezes. */}
        {noCarrinho ? (
          <div className="w-full h-[54px] rounded-full border-[1.5px] border-white/30 bg-white/[0.07] text-white/85 text-[16px] font-bold grid place-items-center">
            ✓ Já está no carrinho
          </div>
        ) : (
          <button type="button" onClick={onCarrinho}
            className="w-full h-[54px] rounded-full text-white text-[17px] font-extrabold" style={{ background: GRAD }}>
            Colocar no carrinho
          </button>
        )}
        <div className="flex gap-3">
          {qtd > 0 && (
            <button type="button" onClick={onVerCarrinho}
              className="flex-1 h-[46px] px-4 rounded-full text-white text-[15px] font-bold" style={{ background: GRAD }}>
              Ver carrinho ({qtd})
            </button>
          )}
          <button type="button" onClick={onVerPrecos}
            className="flex-1 h-[46px] px-4 rounded-full bg-white/10 border border-white/20 text-white text-[15px] font-semibold">
            Tabela de preços
          </button>
        </div>
        <p className="text-center text-white/55 text-[12px] leading-relaxed">
          Prévia com marca d’água.<br />O vídeo final é entregue em 4K, sem marca.
        </p>
      </div>
    </div>
  );
}

/* ─────────────── Carrinho ─────────────── */
/* ─────────────── Tabela de preços — card PRÓPRIO, só a tabela ─────────────── */
export function TabelaSheet({ qtdAtual, voltarLabel, onVoltar, onFechar }: {
  qtdAtual: number;
  /** ex.: "Voltar para o carrinho" ou "Voltar para o vídeo" */
  voltarLabel: string;
  onVoltar: () => void; onFechar: () => void;
}) {
  const [tabelona, setTabelona] = useState(false);
  const Linha = ({ q }: { q: number }) => (
    <div className={`flex items-baseline justify-between px-3 py-2 rounded-lg text-[15px] ${
      q === qtdAtual ? 'bg-primary/10 font-bold text-primary' : 'text-on-surface-variant'}`}>
      <span>{q} {q === 1 ? 'vídeo' : 'vídeos'}</span>
      <span className="tabular-nums">{fmt(precoVideos(q))}
        <span className="text-[12px] opacity-70"> · {fmt(Math.floor(precoVideos(q) / q))} cada</span>
      </span>
    </div>
  );
  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-end md:items-center justify-center" data-clarity-mask="true">
      <div className="bg-white w-full md:max-w-lg rounded-t-3xl md:rounded-3xl flex flex-col max-h-[92vh]">
        <div className="p-5 pb-3 flex items-center justify-between">
          <p className="font-headline text-xl text-on-surface">Tabela de preços</p>
          <button type="button" onClick={onFechar} aria-label="Fechar"
            className="w-9 h-9 grid place-items-center rounded-full bg-black/5 text-on-surface"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></button>
        </div>
        <div className="px-5 overflow-y-auto flex-1 min-h-0">
          <p className="text-[14px] text-on-surface-variant mb-3">
            Quanto mais vídeos no mesmo pedido, menor o preço de cada um:
          </p>
          <div className="space-y-0.5 mb-2">
            {Array.from({ length: 10 }, (_, i) => <Linha key={i + 1} q={i + 1} />)}
            {tabelona && Array.from({ length: 40 }, (_, i) => <Linha key={i + 11} q={i + 11} />)}
          </div>
          <button type="button" onClick={() => setTabelona(v => !v)}
            className="w-full py-2.5 mb-3 rounded-full border border-black/10 text-on-surface-variant text-[14px] font-semibold">
            {tabelona ? 'Mostrar menos' : 'Mais de 10 vídeos'}
          </button>
        </div>
        <div className="p-5 pt-3 border-t border-black/5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <button type="button" onClick={onVoltar}
            className="w-full py-3.5 rounded-full text-white text-base font-bold" style={{ background: GRAD }}>
            ← {voltarLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function CarrinhoSheet({ numeros, thumbDe, onRemover, onAbrirVideo, onFechar, onPagar, onVerTabela, pagando, erro, email = '' }: {
  numeros: string[]; thumbDe: (num: string) => string | undefined;
  onRemover: (num: string) => void; onAbrirVideo: (num: string) => void;
  onFechar: () => void; onPagar: () => void; onVerTabela: () => void;
  pagando: boolean; erro: string; email?: string;
}) {
  const n = numeros.length;
  const total = precoVideos(n);
  const cheio = n * 120;

  return (
    <div className="fixed inset-0 z-[70] bg-black/60 flex items-end md:items-center justify-center" data-clarity-mask="true">
      <div className="bg-white w-full md:max-w-lg rounded-t-3xl md:rounded-3xl flex flex-col max-h-[92vh]">
        <div className="p-5 pb-3 flex items-center justify-between">
          <p className="font-headline text-xl text-on-surface">Seu carrinho de vídeos</p>
          <button type="button" onClick={onFechar} aria-label="Fechar"
            className="w-9 h-9 grid place-items-center rounded-full bg-black/5 text-on-surface"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></button>
        </div>

        <div className="px-5 overflow-y-auto flex-1 min-h-0">
          {/* ── Seção 1: o que ELA escolheu ── */}
          <p className="text-[11px] uppercase tracking-widest text-primary font-bold mb-2">
            Seus vídeos escolhidos
          </p>
          {n === 0 ? (
            <p className="text-on-surface-variant text-sm py-4 text-center">
              O carrinho está vazio. Abra uma foto e toque em <strong>Vídeo5678</strong>.
            </p>
          ) : (
            <>
              {/* Lista, não grade de miniaturas: o × de 20px no canto era pequeno demais
                  para o público (mães). Cada linha tem "Remover" escrito, com 44px de alvo. */}
              <ul className="mb-3 divide-y divide-black/5">
                {numeros.map(num => (
                  <li key={num} className="flex items-center gap-3 py-2">
                    <button type="button" onClick={() => onAbrirVideo(num)}
                      className="w-14 h-20 shrink-0 rounded-lg overflow-hidden bg-black/5">
                      {thumbDe(num)
                        ? <img src={thumbDe(num)} alt="" className="w-full h-full object-cover" />
                        : <span className="grid place-items-center h-full text-xs">{Number(num)}</span>}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-on-surface">Vídeo da foto {Number(num)}</p>
                      <button type="button" onClick={() => onAbrirVideo(num)}
                        className="text-[13px] text-primary font-semibold underline underline-offset-2">ver de novo</button>
                    </div>
                    <button type="button" onClick={() => onRemover(num)}
                      aria-label={`Remover o vídeo da foto ${Number(num)} do carrinho`}
                      className="h-11 px-4 shrink-0 rounded-full border border-black/15 text-on-surface-variant text-[14px] font-semibold">
                      Remover
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex items-baseline justify-between rounded-xl bg-surface-container-low px-4 py-3 mb-4">
                <span className="text-sm font-bold text-on-surface">{n} {n === 1 ? 'vídeo' : 'vídeos'}</span>
                <span className="text-right">
                  <span className="text-lg font-bold text-on-surface tabular-nums">{fmt(total)}</span>
                  {n > 1 && (
                    <span className="block text-[11px] text-primary font-semibold">
                      você economiza {fmt(cheio - total)}
                    </span>
                  )}
                </span>
              </div>
            </>
          )}

          {/* a tabela mora num card próprio (TabelaSheet) — aqui só a porta de entrada */}
          <button type="button" onClick={onVerTabela}
            className="w-full py-3 mb-3 rounded-full border border-black/10 text-on-surface-variant text-[14px] font-semibold">
            Ver tabela de preços
          </button>
        </div>

        <div className="p-5 pt-3 border-t border-black/5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {erro && <p className="text-red-600 text-sm mb-2">{erro}</p>}
          <button type="button" onClick={onPagar} disabled={n === 0 || pagando}
            className="w-full py-3.5 rounded-full text-white font-bold disabled:opacity-40" style={{ background: GRAD }}>
            {pagando ? 'Abrindo o pagamento…' : n === 0 ? 'Carrinho vazio'
              : `Pagar ${fmt(total)} — PIX ou cartão`}
          </button>
          {/* o e-mail cadastrado personaliza a promessa — a pessoa se reconhece no fluxo */}
          <p className="text-center text-on-surface-variant text-[11px] mt-2">
            Após a confirmação de pagamento, em até 12h seus vídeos em 4K chegarão por um link
            no email{email ? ':' : ' cadastrado.'}
            {email && <strong className="block text-on-surface">{email}</strong>}
          </p>
        </div>
      </div>
    </div>
  );
}
