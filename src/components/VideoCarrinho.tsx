import { useEffect, useRef, useState } from 'react';

/* ── Vídeos 5678: player inline + carrinho com desconto progressivo ──────────
 * Mobile-first: os dois são bottom-sheets (como o ModalPesquisa). O player NÃO
 * é tela cheia e não oferece download (preview 360p com marca d'água — o 4K só
 * existe depois da compra). O preço exibido aqui é cortesia; quem manda é o
 * servidor (api/videos-checkout.ts recalcula pela quantidade). */

const GRAD = 'linear-gradient(135deg,#7a3f8f,#e87060)';

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
  useEffect(() => { videoRef.current?.play().catch(() => {}); }, [videoUrl]);

  const temAnt = posicao > 1, temProx = posicao < total;

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
    // tap/clique fora do vídeo volta para a foto; os filhos interativos dão stopPropagation
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/90" data-clarity-mask="true" onClick={onFechar}>
      <style>{`.v5678::-webkit-media-controls-fullscreen-button{display:none}`}</style>
      <div className="flex items-center justify-between p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div>
          <p className="text-white font-headline text-lg italic">Vídeo5678 · foto {Number(numero)}</p>
          {total > 1 && <p className="text-white/60 text-[12px] tabular-nums">vídeo {posicao} de {total}</p>}
        </div>
        <button type="button" onClick={onFechar} aria-label="Fechar"
          className="w-9 h-9 grid place-items-center rounded-full bg-white/15 text-white"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></button>
      </div>

      {/* dentro da interface, nunca fullscreen; sem download nem PiP */}
      <div className="relative flex-1 min-h-0 grid place-items-center px-6"
        onTouchStart={inicioToque} onTouchEnd={fimToque}>
        <video
          ref={videoRef} src={videoUrl} poster={poster}
          playsInline controls loop preload="metadata"
          controlsList="nodownload nofullscreen noremoteplayback noplaybackrate"
          disablePictureInPicture
          onClick={e => e.stopPropagation()}
          onContextMenu={e => e.preventDefault()}
          className="v5678 max-h-full max-w-full rounded-xl"
          style={{ aspectRatio: '9/16' }}
        />
        {/* setas grandes e sempre visíveis: público não-técnico não descobre swipe sozinho */}
        {temAnt && (
          <button type="button" aria-label="Vídeo anterior"
            onClick={e => { e.stopPropagation(); onNavegar(-1); }}
            className="absolute left-1 top-1/2 -translate-y-1/2 w-11 h-11 grid place-items-center rounded-full bg-black/60 border border-white/25 text-white text-xl backdrop-blur-sm">
            ‹
          </button>
        )}
        {temProx && (
          <button type="button" aria-label="Próximo vídeo"
            onClick={e => { e.stopPropagation(); onNavegar(1); }}
            className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 grid place-items-center rounded-full bg-black/60 border border-white/25 text-white text-xl backdrop-blur-sm">
            ›
          </button>
        )}
      </div>

      {/* ações contidas (max-w-sm): no desktop nada de botão de borda a borda */}
      <div className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-2 w-full max-w-sm mx-auto"
        onClick={e => e.stopPropagation()}>
        <button type="button" onClick={onVerFoto}
          className="w-full py-2.5 rounded-full text-white/90 text-sm font-semibold bg-white/15">
          🖼 Ver a foto deste vídeo
        </button>
        <p className="text-center text-white/70 text-[12px]">
          Prévia com marca d’água — o vídeo final é entregue em 4K, sem marca.
        </p>
        {noCarrinho ? (
          <div className="flex gap-2">
            <button type="button" onClick={onCarrinho}
              className="flex-1 py-3 rounded-full text-white/90 text-sm font-semibold bg-white/15">
              ✓ No carrinho — remover
            </button>
            <button type="button" onClick={onVerCarrinho}
              className="flex-1 py-3 rounded-full text-white text-sm font-bold" style={{ background: GRAD }}>
              Ver carrinho ({qtd})
            </button>
          </div>
        ) : (
          <>
            <button type="button" onClick={onCarrinho}
              className="w-full py-3.5 rounded-full text-white font-bold" style={{ background: GRAD }}>
              Colocar no carrinho
            </button>
            <div className="flex gap-2">
              {qtd > 0 && (
                <button type="button" onClick={onVerCarrinho}
                  className="flex-1 py-2.5 rounded-full text-white/90 text-sm font-semibold bg-white/15">
                  Ver carrinho ({qtd})
                </button>
              )}
              <button type="button" onClick={onVerPrecos}
                className="flex-1 py-2.5 rounded-full text-white/90 text-sm font-semibold bg-white/15">
                {qtd > 0 ? 'Tabela de preços' : 'Ver preços'}
              </button>
            </div>
          </>
        )}
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
              <div className="flex flex-wrap gap-2 mb-2">
                {numeros.map(num => (
                  <div key={num} className="relative">
                    <button type="button" onClick={() => onAbrirVideo(num)}
                      className="block w-16 h-24 rounded-lg overflow-hidden bg-black/5">
                      {thumbDe(num)
                        ? <img src={thumbDe(num)} alt="" className="w-full h-full object-cover" />
                        : <span className="grid place-items-center h-full text-xs">{Number(num)}</span>}
                    </button>
                    <button type="button" onClick={() => onRemover(num)} aria-label={`Remover vídeo ${Number(num)}`}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 grid place-items-center rounded-full bg-black/70 text-white text-[11px] leading-none">×</button>
                    <p className="text-center text-[10px] text-on-surface-variant mt-0.5">{Number(num)}</p>
                  </div>
                ))}
              </div>
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
