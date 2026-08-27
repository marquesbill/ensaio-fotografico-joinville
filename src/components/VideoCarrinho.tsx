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
export function VideoSheet({ videoUrl, poster, numero, noCarrinho, qtd, onCarrinho, onVerCarrinho, onFechar }: {
  videoUrl: string; poster?: string; numero: string;
  noCarrinho: boolean; qtd: number;
  onCarrinho: () => void; onVerCarrinho: () => void; onFechar: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => { videoRef.current?.play().catch(() => {}); }, [videoUrl]);

  // preço contextual: o que ESTE vídeo acrescenta ao pedido, com a conta visível
  const proxQtd  = noCarrinho ? qtd : qtd + 1;
  const custoEste = precoVideos(proxQtd) - precoVideos(proxQtd - 1);
  const ordinal  = `${proxQtd}º vídeo`;

  return (
    // tap/clique fora do vídeo volta para a foto; os filhos interativos dão stopPropagation
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/90" data-clarity-mask="true" onClick={onFechar}>
      <style>{`.v5678::-webkit-media-controls-fullscreen-button{display:none}`}</style>
      <div className="flex items-center justify-between p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <p className="text-white font-headline text-lg italic">Vídeo5678 · foto {Number(numero)}</p>
        <button type="button" onClick={onFechar} aria-label="Fechar"
          className="w-9 h-9 grid place-items-center rounded-full bg-white/15 text-white"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></button>
      </div>

      {/* dentro da interface, nunca fullscreen; sem download nem PiP */}
      <div className="flex-1 min-h-0 grid place-items-center px-6">
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
      </div>

      {/* ações contidas (max-w-sm): no desktop nada de botão de borda a borda */}
      <div className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-2 w-full max-w-sm mx-auto"
        onClick={e => e.stopPropagation()}>
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
            {/* a conta por extenso: sem ela, "R$100" num botão parece contradizer a tabela */}
            <p className="text-center text-white/80 text-[12px]">
              {qtd === 0
                ? `1º vídeo: ${fmt(120)}`
                : `${ordinal}: +${fmt(custoEste)} · pedido vai a ${fmt(precoVideos(proxQtd))}`}
            </p>
            {qtd > 0 && (
              <button type="button" onClick={onVerCarrinho}
                className="w-full py-2.5 rounded-full text-white/90 text-sm font-semibold bg-white/15">
                Ver carrinho ({qtd}) — total {fmt(precoVideos(qtd))}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ─────────────── Carrinho ─────────────── */
export function CarrinhoSheet({ numeros, thumbDe, onRemover, onAbrirVideo, onFechar, onPagar, pagando, erro }: {
  numeros: string[]; thumbDe: (num: string) => string | undefined;
  onRemover: (num: string) => void; onAbrirVideo: (num: string) => void;
  onFechar: () => void; onPagar: () => void; pagando: boolean; erro: string;
}) {
  const [mostraTabela, setMostraTabela] = useState(false);
  const [tabelona, setTabelona] = useState(false);
  const n = numeros.length;
  const total = precoVideos(n);
  const cheio = n * 120;

  const Linha = ({ q }: { q: number }) => (
    <div className={`flex items-baseline justify-between px-3 py-1.5 rounded-lg text-[13px] ${
      q === n ? 'bg-primary/10 font-bold text-primary' : 'text-on-surface-variant'}`}>
      <span>{q} {q === 1 ? 'vídeo' : 'vídeos'}</span>
      <span className="tabular-nums">{fmt(precoVideos(q))}
        <span className="text-[11px] opacity-70"> · {fmt(Math.floor(precoVideos(q) / q))}/vídeo</span>
      </span>
    </div>
  );

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

          {/* ── Seção 2: tabela de referência, dobrada — não se mistura com o pedido ── */}
          <button type="button" onClick={() => setMostraTabela(v => !v)}
            className="w-full py-2.5 mb-2 rounded-full border border-black/10 text-on-surface-variant text-[13px] font-semibold">
            {mostraTabela ? 'Esconder tabela de preços' : 'Ver tabela de preços por quantidade'}
          </button>
          {mostraTabela && (
            <>
              <p className="text-[12px] text-on-surface-variant mb-2">
                Quanto mais vídeos no mesmo pedido, menor o preço de cada um:
              </p>
              <div className="space-y-0.5 mb-2">
                {Array.from({ length: 10 }, (_, i) => <Linha key={i + 1} q={i + 1} />)}
                {tabelona && Array.from({ length: 40 }, (_, i) => <Linha key={i + 11} q={i + 11} />)}
              </div>
              <button type="button" onClick={() => setTabelona(v => !v)}
                className="w-full py-2 mb-3 rounded-full border border-black/10 text-on-surface-variant text-[13px] font-semibold">
                {tabelona ? 'Mostrar menos' : 'Mais de 10 vídeos'}
              </button>
            </>
          )}
        </div>

        <div className="p-5 pt-3 border-t border-black/5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {erro && <p className="text-red-600 text-sm mb-2">{erro}</p>}
          <button type="button" onClick={onPagar} disabled={n === 0 || pagando}
            className="w-full py-3.5 rounded-full text-white font-bold disabled:opacity-40" style={{ background: GRAD }}>
            {pagando ? 'Abrindo o pagamento…' : n === 0 ? 'Carrinho vazio'
              : `Pagar ${fmt(total)} — PIX ou cartão`}
          </button>
          <p className="text-center text-on-surface-variant text-[11px] mt-2">
            Após a confirmação, produzo seus vídeos em 4K e envio o link por e-mail e WhatsApp.
          </p>
        </div>
      </div>
    </div>
  );
}
