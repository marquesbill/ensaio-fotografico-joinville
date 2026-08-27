import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Lightbox com física de iOS (referência: app Fotos do iPhone).
 *
 * - Swipe horizontal segue o dedo 1:1; soltar anima o snap com a curva de sheet
 *   da Apple (cubic-bezier(0.32, 0.72, 0, 1)). Sem loop: nas pontas, rubber-band.
 * - Double-tap: zoom 2.5x no ponto tocado; outro double-tap volta a 1x.
 * - Pinch: zoom contínuo 1–4x ancorado no centro dos dedos; <1x volta com mola.
 * - Com zoom, arrastar faz pan (limitado às bordas da foto); swipe de foto só a 1x.
 * - Swipe vertical a 1x: a foto acompanha o dedo, encolhe e o fundo esmaece;
 *   soltar além do limiar fecha (gesto canônico do iOS).
 * - prefers-reduced-motion: todas as transições viram instantâneas.
 *
 * Gestos em Touch Events nativos (não Pointer): Safari iOS entrega os dois toques
 * do pinch no MESMO touchmove, e `touch-action: none` no overlay impede o Safari
 * de puxar o pinch para o zoom da página — a raiz do "canvas gigante" da versão antiga.
 */

type Foto = { id: string; url: string; thumb?: string };

const CURVA = 'cubic-bezier(0.32, 0.72, 0, 1)';   // easing das sheets do iOS
const DUR_SNAP = 380;                              // ms — snap de slide
const DUR_ZOOM = 300;                              // ms — zoom de double-tap
const ZOOM_TAP = 2.5;
const ZOOM_MAX = 4;
const FECHA_DY = 90;                               // px de arrasto vertical p/ fechar

const reduzMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export default function GaleriaLightbox({ fotos, inicial, onFechar, onFoto, temVideo, onVideo, carrinhoQtd = 0, onCarrinho }: {
  fotos: Foto[];
  inicial: number;
  onFechar: () => void;
  /** chamada a cada foto exibida (abertura e navegação) — alimenta o GA4/Clarity */
  onFoto: (indice: number) => void;
  /** Vídeos 5678 (opcional): quando a foto atual tem vídeo, o chrome ganha o botão */
  temVideo?: (indice: number) => boolean;
  onVideo?: (indice: number) => void;
  carrinhoQtd?: number;
  onCarrinho?: () => void;
}) {
  const [indice, setIndice] = useState(inicial);
  const [chrome, setChrome] = useState(true);      // contador/fechar somem no zoom

  const trackRef = useRef<HTMLDivElement>(null);   // trilho horizontal dos slides
  const imgRef   = useRef<HTMLImageElement>(null); // <img> do slide atual (zoom/pan)
  const fundoRef = useRef<HTMLDivElement>(null);   // backdrop (opacidade no arrasto)

  // Estado dos gestos fora do React: 60fps sem re-render.
  const g = useRef({
    modo: 'nenhum' as 'nenhum' | 'slide' | 'fechar' | 'zoom-pan' | 'pinch',
    x0: 0, y0: 0, t0: 0,                 // início do toque
    dx: 0, dy: 0,
    escala: 1, tx: 0, ty: 0,             // transform atual da foto (zoom/pan)
    escalaIni: 1, txIni: 0, tyIni: 0,    // no início do gesto
    distIni: 0, midIni: { x: 0, y: 0 },  // pinch
    ultimoTap: 0,
  });

  const n = fotos.length;

  // espelho do índice para handlers registrados uma única vez (resize)
  const indiceRef = useRef(inicial);
  indiceRef.current = indice;

  /* Medida do palco em PX, nunca `vw`.
   * `100vw` e `window.innerWidth` divergem (barra de rolagem no desktop, barra de
   * URL no Safari iOS): dimensionar o slide num e deslocar o trilho no outro
   * acumula alguns px de erro por foto — a imagem "foge" do centro da tela. */
  const palcoRef = useRef<HTMLDivElement>(null);
  const [larg, setLarg] = useState(0);
  const medidas = useRef({ w: 0, h: 0 });
  const vw = () => medidas.current.w || window.innerWidth;
  const vh = () => medidas.current.h || window.innerHeight;

  /* ── helpers de estilo (imperativos, sem re-render) ── */

  const setTrack = useCallback((x: number, animar: boolean) => {
    const el = trackRef.current; if (!el) return;
    el.style.transition = animar && !reduzMotion() ? `transform ${DUR_SNAP}ms ${CURVA}` : 'none';
    el.style.transform = `translate3d(${x}px,0,0)`;
  }, []);

  const setImg = useCallback((animar: boolean) => {
    const el = imgRef.current; if (!el) return;
    const { escala, tx, ty } = g.current;
    el.style.transition = animar && !reduzMotion() ? `transform ${DUR_ZOOM}ms ${CURVA}` : 'none';
    el.style.transform = `translate3d(${tx}px,${ty}px,0) scale(${escala})`;
  }, []);

  // Pan não pode deslocar a foto para fora da moldura: limita pela sobra do zoom.
  const limitaPan = useCallback(() => {
    const el = imgRef.current; if (!el) return;
    const st = g.current;
    const sobraX = Math.max(0, (el.clientWidth  * st.escala - vw()) / 2);
    const sobraY = Math.max(0, (el.clientHeight * st.escala - vh()) / 2);
    st.tx = clamp(st.tx, -sobraX, sobraX);
    st.ty = clamp(st.ty, -sobraY, sobraY);
  }, []);

  const zoomPara = useCallback((escala: number, cx: number, cy: number, animar = true) => {
    const st = g.current;
    const alvo = clamp(escala, 1, ZOOM_MAX);
    if (alvo === 1) { st.escala = 1; st.tx = 0; st.ty = 0; }
    else {
      // mantém o ponto (cx,cy) da tela fixo durante a mudança de escala
      const fator = alvo / st.escala;
      st.tx = (st.tx - (cx - vw() / 2)) * fator + (cx - vw() / 2);
      st.ty = (st.ty - (cy - vh() / 2)) * fator + (cy - vh() / 2);
      st.escala = alvo;
      limitaPan();
    }
    setImg(animar);
    setChrome(st.escala === 1);
  }, [limitaPan, setImg]);

  /* ── navegação ── */

  const irPara = useCallback((novo: number, animar = true) => {
    const alvo = clamp(novo, 0, n - 1);
    g.current.escala = 1; g.current.tx = 0; g.current.ty = 0;
    setImg(false);
    setTrack(-alvo * vw(), animar);
    if (alvo !== indice) { setIndice(alvo); onFoto(alvo); }
    setChrome(true);
  }, [n, indice, onFoto, setImg, setTrack]);

  /* ── ciclo de vida ── */

  const jaAbriu = useRef(false);   // StrictMode roda o efeito 2x em dev; o evento conta 1x
  useEffect(() => {
    // trava o scroll da página atrás do lightbox
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!jaAbriu.current) { jaAbriu.current = true; onFoto(inicial); }
    return () => { document.body.style.overflow = overflow; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mede o palco antes da primeira pintura e a cada giro do aparelho; reposiciona
  // o trilho na foto ATUAL (ler `indice` aqui pegaria o valor do mount).
  useLayoutEffect(() => {
    const medir = () => {
      const el = palcoRef.current;
      medidas.current = { w: el?.clientWidth || window.innerWidth, h: el?.clientHeight || window.innerHeight };
      setLarg(medidas.current.w);
      setTrack(-indiceRef.current * medidas.current.w, false);
    };
    medir();
    window.addEventListener('resize', medir);
    window.addEventListener('orientationchange', medir);
    return () => {
      window.removeEventListener('resize', medir);
      window.removeEventListener('orientationchange', medir);
    };
  }, [setTrack]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar();
      if (e.key === 'ArrowRight') irPara(indice + 1);
      if (e.key === 'ArrowLeft')  irPara(indice - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [indice, irPara, onFechar]);

  /* ── gestos ── */

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const st = g.current;
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      st.modo = 'pinch';
      st.distIni = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      st.midIni = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
      st.escalaIni = st.escala; st.txIni = st.tx; st.tyIni = st.ty;
      return;
    }
    const t = e.touches[0];
    st.x0 = t.clientX; st.y0 = t.clientY; st.t0 = performance.now();
    st.dx = 0; st.dy = 0;
    st.txIni = st.tx; st.tyIni = st.ty;
    st.modo = st.escala > 1 ? 'zoom-pan' : 'nenhum';   // a 1x decide na 1ª direção
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const st = g.current;

    if (st.modo === 'pinch' && e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const mid = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
      const bruta = st.escalaIni * (dist / st.distIni);
      // abaixo de 1x, resistência (rubber-band) em vez de encolher livre
      st.escala = bruta >= 1 ? Math.min(bruta, ZOOM_MAX) : 1 - (1 - bruta) * 0.35;
      const fator = st.escala / st.escalaIni;
      st.tx = (st.txIni - (st.midIni.x - vw() / 2)) * fator + (mid.x - vw() / 2);
      st.ty = (st.tyIni - (st.midIni.y - vh() / 2)) * fator + (mid.y - vh() / 2);
      setImg(false);
      setChrome(false);
      return;
    }

    const t = e.touches[0];
    st.dx = t.clientX - st.x0;
    st.dy = t.clientY - st.y0;

    if (st.modo === 'zoom-pan') {
      st.tx = st.txIni + st.dx;
      st.ty = st.tyIni + st.dy;
      limitaPan();
      setImg(false);
      return;
    }

    if (st.modo === 'nenhum') {
      if (Math.abs(st.dx) < 6 && Math.abs(st.dy) < 6) return;   // ainda é tap
      st.modo = Math.abs(st.dx) > Math.abs(st.dy) ? 'slide' : 'fechar';
    }

    if (st.modo === 'slide') {
      let dx = st.dx;
      // rubber-band nas pontas: além da 1ª/última foto o dedo "pesa" 3x menos
      if ((indice === 0 && dx > 0) || (indice === n - 1 && dx < 0)) dx = dx / 3;
      setTrack(-indice * vw() + dx, false);
    } else {
      // arrasto vertical: foto acompanha, encolhe, fundo esmaece (dismiss do iOS)
      const dy = st.dy;
      const progresso = clamp(Math.abs(dy) / (vh() / 2), 0, 1);
      const el = imgRef.current;
      if (el) {
        el.style.transition = 'none';
        el.style.transform = `translate3d(${st.dx * 0.4}px,${dy}px,0) scale(${1 - progresso * 0.25})`;
      }
      if (fundoRef.current) fundoRef.current.style.opacity = String(1 - progresso * 0.75);
    }
  }, [indice, n, limitaPan, setImg, setTrack]);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    const st = g.current;

    if (st.modo === 'pinch') {
      if (e.touches.length > 0) { st.modo = 'zoom-pan'; return; }   // sobrou 1 dedo
      if (st.escala < 1.05) zoomPara(1, 0, 0);
      else { limitaPan(); setImg(true); }
      st.modo = 'nenhum';
      return;
    }
    if (e.touches.length > 0) return;

    if (st.modo === 'zoom-pan') {
      st.modo = 'nenhum';
      // tap duplo com zoom ativo: volta a 1x
      const agora = performance.now();
      if (Math.abs(st.dx) < 6 && Math.abs(st.dy) < 6) {
        if (agora - st.ultimoTap < 300) { zoomPara(1, 0, 0); st.ultimoTap = 0; return; }
        st.ultimoTap = agora;
      }
      return;
    }

    if (st.modo === 'slide') {
      const rapido = Math.abs(st.dx) / Math.max(1, performance.now() - st.t0) > 0.5;  // px/ms
      const passou = Math.abs(st.dx) > vw() * 0.3 || rapido;
      irPara(passou ? indice + (st.dx < 0 ? 1 : -1) : indice);
      st.modo = 'nenhum';
      return;
    }

    if (st.modo === 'fechar') {
      st.modo = 'nenhum';
      if (Math.abs(st.dy) > FECHA_DY) { onFechar(); return; }
      // não passou do limiar: volta com a mesma curva
      const el = imgRef.current;
      if (el) {
        el.style.transition = reduzMotion() ? 'none' : `transform ${DUR_ZOOM}ms ${CURVA}`;
        el.style.transform = 'translate3d(0,0,0) scale(1)';
      }
      if (fundoRef.current) {
        fundoRef.current.style.transition = `opacity ${DUR_ZOOM}ms ${CURVA}`;
        fundoRef.current.style.opacity = '1';
      }
      return;
    }

    // tap simples / double-tap a 1x
    const agora = performance.now();
    if (Math.abs(st.dx) < 6 && Math.abs(st.dy) < 6) {
      if (agora - st.ultimoTap < 300) {
        zoomPara(st.escala > 1 ? 1 : ZOOM_TAP, st.x0, st.y0);
        st.ultimoTap = 0;
      } else {
        st.ultimoTap = agora;
        // tap simples alterna o chrome (como no Fotos) — espera p/ não engolir o double-tap
        setTimeout(() => {
          if (g.current.ultimoTap === agora && g.current.escala === 1) setChrome(c => !c);
        }, 310);
      }
    }
    st.modo = 'nenhum';
  }, [indice, irPara, limitaPan, onFechar, setImg, zoomPara]);

  /* ── render ── */

  // 3 slides vivos (anterior/atual/próximo): vizinhos pré-carregados, DOM enxuto.
  const vivos = [indice - 1, indice, indice + 1].filter(i => i >= 0 && i < n);

  return (
    <div
      ref={palcoRef}
      data-clarity-mask="true"
      role="dialog" aria-modal="true" aria-label={`Foto ${indice + 1} de ${n}`}
      className="fixed inset-0 z-50 overflow-hidden select-none"
      style={{ touchAction: 'none' }}
      onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
    >
      <style>{`
        /* NENHUMA animação de opacity na entrada: o clock de animação congela em
           aba de fundo / renderer sem frames, e o overlay ficaria transparente
           enquanto a animação não roda. O fundo já nasce preto; a entrada é o
           scale da foto — que é como o app Fotos do iOS abre. */
        @keyframes lb-palco { from { scale: .97 } to { scale: 1 } }
        @media (prefers-reduced-motion: reduce) {
          .lb-anima { animation-duration: 0.01ms !important; }
        }
      `}</style>
      <div ref={fundoRef} className="absolute inset-0 bg-black" />

      <div ref={trackRef} className="absolute inset-0 flex lb-anima"
        style={{
          width: larg ? larg * n : undefined,
          animation: `lb-palco ${DUR_SNAP}ms ${CURVA}`,
        }}>
        {/* slide em flex, não grid: max-h-full da img precisa resolver contra o slide —
            num grid o track implícito cresce pro max-content e a foto estoura a tela.
            Largura em px medidos (nunca 100vw) — ver comentário de `palcoRef`. */}
        {fotos.map((f, i) => (
          <div key={f.id} className="h-full flex items-center justify-center shrink-0" style={{ width: larg || undefined }}>
            {vivos.includes(i) && (
              <img
                ref={i === indice ? imgRef : undefined}
                src={f.url} alt="" draggable={false} decoding="async"
                className="max-h-full max-w-full object-contain"
              />
            )}
          </div>
        ))}
      </div>

      {/* chrome: some no zoom e no tap simples */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4 pt-[max(1rem,env(safe-area-inset-top))]"
        style={{
          opacity: chrome ? 1 : 0, pointerEvents: chrome ? 'auto' : 'none',
          transition: reduzMotion() ? 'none' : `opacity 200ms ${CURVA}`,
          background: 'linear-gradient(180deg, rgba(0,0,0,.45), transparent)',
        }}>
        <p className="text-white/80 text-[13px] tabular-nums font-medium">{indice + 1} de {n}</p>
        <button type="button" onClick={onFechar} aria-label="Fechar"
          className="w-9 h-9 grid place-items-center rounded-full bg-white/15 text-white backdrop-blur-sm">
          {/* SVG em vez do caractere ×: o glifo assenta fora do centro óptico do círculo */}
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Vídeos 5678: barra inferior no chrome. stopPropagation nos touch events —
          sem isso o tap no botão entra na máquina de gestos e alterna o chrome. */}
      {temVideo?.(indice) && (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
          onTouchStart={e => e.stopPropagation()} onTouchMove={e => e.stopPropagation()} onTouchEnd={e => e.stopPropagation()}
          style={{
            opacity: chrome ? 1 : 0, pointerEvents: chrome ? 'auto' : 'none',
            transition: reduzMotion() ? 'none' : `opacity 200ms ${CURVA}`,
            background: 'linear-gradient(0deg, rgba(0,0,0,.55), transparent)',
          }}>
          <button type="button" onClick={() => onVideo?.(indice)}
            className="px-6 py-3 rounded-full text-white text-sm font-bold shadow-lg"
            style={{ background: 'linear-gradient(135deg,#7a3f8f,#e87060)' }}>
            ▶ Vídeo5678 desta foto
          </button>
          {carrinhoQtd > 0 && (
            <button type="button" onClick={() => onCarrinho?.()} aria-label={`Ver carrinho com ${carrinhoQtd} vídeos`}
              className="flex items-center gap-1.5 px-4 py-3 rounded-full bg-black/60 border border-white/40 text-white text-sm font-bold backdrop-blur-sm">
              {/* carrinho em SVG branco: o emoji sai cinza e some no fundo cinza */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="9" cy="20" r="1.6" /><circle cx="17" cy="20" r="1.6" />
                <path d="M2 3h3l2.6 12.5a1.6 1.6 0 0 0 1.6 1.3h7.9a1.6 1.6 0 0 0 1.6-1.3L21 8H6" />
              </svg>
              {carrinhoQtd}
            </button>
          )}
        </div>
      )}

      {/* setas: só desktop (hover real); no touch o gesto é o controle */}
      <div className="max-md:hidden" style={{ opacity: chrome ? 1 : 0, transition: `opacity 200ms ${CURVA}` }}>
        {indice > 0 && (
          <button type="button" onClick={() => irPara(indice - 1)} aria-label="Foto anterior"
            className="absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 grid place-items-center rounded-full bg-white/10 hover:bg-white/20 text-white text-lg transition-colors">
            ←
          </button>
        )}
        {indice < n - 1 && (
          <button type="button" onClick={() => irPara(indice + 1)} aria-label="Próxima foto"
            className="absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 grid place-items-center rounded-full bg-white/10 hover:bg-white/20 text-white text-lg transition-colors">
            →
          </button>
        )}
      </div>
    </div>
  );
}
