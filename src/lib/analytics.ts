/**
 * Helper unificado de analytics — dispara para Microsoft Clarity, Meta Pixel e GA4 (gtag).
 * Tolera ausência de qualquer um dos trackers (ad-blocker, lazy load) sem quebrar.
 *
 * Uso:
 *   track.event('package_select', { package: 'lembranca', value: 1600 });
 *   track.tag('chosen_package', 'lembranca');
 *   track.upgrade('checkout_reached');
 */

type EventParams = Record<string, string | number | boolean>;

// Eventos do Pixel que mapeiam para nomes oficiais — os demais viram CustomEvent
const PIXEL_STANDARD_EVENTS = new Set([
  'PageView', 'Lead', 'CompleteRegistration', 'Contact', 'InitiateCheckout',
  'AddPaymentInfo', 'Purchase', 'Subscribe', 'ViewContent', 'AddToCart',
  'AddToWishlist', 'Search', 'StartTrial', 'Schedule', 'SubmitApplication',
  'CustomizeProduct', 'Donate', 'FindLocation',
]);

// Gate global: roteamento interno (/admin, /dashboard) não polui métricas.
// Espelha a flag setada pelo script inline no topo do index.html.
const ANALYTICS_DISABLED =
  typeof window !== 'undefined' &&
  (window as unknown as { __skipAnalytics?: boolean }).__skipAnalytics === true;

function safeCall(fn: () => void) {
  if (ANALYTICS_DISABLED) return;
  try { fn(); } catch (e) {
    // tracker bloqueado / não carregado → silencia
    if (import.meta.env.DEV) console.warn('[analytics] tracker call failed', e);
  }
}

export const track = {
  /** Dispara um evento customizado em Clarity + Pixel + GA */
  event(name: string, params?: EventParams) {
    if (typeof window === 'undefined') return;

    safeCall(() => {
      if (window.clarity) window.clarity('event', name);
    });

    safeCall(() => {
      if (window.fbq) {
        // Preserva tipos originais (number/string) — Meta Pixel espera number em campos como `value`
        const pixelParams = params as Record<string, string | number> | undefined;
        if (PIXEL_STANDARD_EVENTS.has(name)) {
          window.fbq('track', name, pixelParams);
        } else {
          // CustomEvent — usa trackCustom para não confundir com Standard Events nos relatórios
          window.fbq('trackCustom', name, pixelParams);
        }
      }
    });

    safeCall(() => {
      if (window.gtag) window.gtag('event', name, params || {});
    });
  },

  /** Define uma tag de segmentação na sessão da Clarity (até 128 chars, max 100 tags) */
  tag(key: string, value: string | number | boolean) {
    if (typeof window === 'undefined') return;
    safeCall(() => {
      if (window.clarity) {
        window.clarity('set', key, String(value).slice(0, 128));
      }
    });
  },

  /** Marca a sessão como prioritária — Clarity mantém a gravação por mais tempo */
  upgrade(reason: string) {
    if (typeof window === 'undefined') return;
    safeCall(() => {
      if (window.clarity) window.clarity('upgrade', reason);
    });
  },

  /** GA4 Enhanced Ecommerce — popula relatórios de Monetização automaticamente */
  ecommerce(eventName:
    | 'view_item_list'
    | 'select_item'
    | 'view_item'
    | 'add_to_cart'
    | 'begin_checkout'
    | 'add_payment_info'
    | 'purchase',
    payload: {
      item_id: string;
      item_name: string;
      price: number;
      quantity?: number;
      currency?: string;
      item_list_id?: string;
      item_list_name?: string;
      transaction_id?: string;
      coupon?: string;
      payment_type?: string;
    },
  ) {
    if (typeof window === 'undefined') return;
    const currency = payload.currency || 'BRL';
    const item = {
      item_id: payload.item_id,
      item_name: payload.item_name,
      price: payload.price,
      quantity: payload.quantity || 1,
      currency,
    };
    const value = payload.price * (payload.quantity || 1);

    safeCall(() => {
      if (!window.gtag) return;
      const gaPayload: Record<string, unknown> = {
        currency,
        value,
        items: [item],
      };
      if (payload.item_list_id) gaPayload.item_list_id = payload.item_list_id;
      if (payload.item_list_name) gaPayload.item_list_name = payload.item_list_name;
      if (payload.transaction_id) gaPayload.transaction_id = payload.transaction_id;
      if (payload.coupon) gaPayload.coupon = payload.coupon;
      if (payload.payment_type) gaPayload.payment_type = payload.payment_type;
      window.gtag('event', eventName, gaPayload);
    });

    // Espelha no Clarity como evento simples (sem o payload — Clarity não suporta)
    safeCall(() => {
      if (window.clarity) window.clarity('event', `ga_${eventName}_${payload.item_id}`);
    });
  },

  /** GA4 recommended event: generate_lead (lead capturado) */
  lead(source: string, value?: number, currency: string = 'BRL') {
    if (typeof window === 'undefined') return;
    safeCall(() => {
      if (!window.gtag) return;
      const payload: Record<string, unknown> = { lead_source: source };
      if (value) { payload.value = value; payload.currency = currency; }
      window.gtag('event', 'generate_lead', payload);
    });
  },

  /** Seta user_properties no GA4 — persistem entre sessões (até 25 props, valor até 36 chars) */
  setUserProperties(props: Record<string, string | number | boolean>) {
    if (typeof window === 'undefined') return;
    safeCall(() => {
      if (!window.gtag) return;
      const sanitized: Record<string, string> = {};
      Object.entries(props).forEach(([k, v]) => {
        // GA4 user property name limits: 24 chars, value: 36 chars
        const key = k.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 24);
        sanitized[key] = String(v).slice(0, 36);
      });
      window.gtag('set', 'user_properties', sanitized);
    });
  },
};

/* ---------------------------------------------------------------------------
 * Auto-tracking de contexto de sessão.
 * Roda uma única vez quando o app monta. Coleta UTM, referrer, device, etc.
 * ------------------------------------------------------------------------- */

function parseTrafficSource(): string {
  const url = new URL(window.location.href);
  const utm = url.searchParams.get('utm_source');
  if (utm) return `utm_${utm.toLowerCase()}`;

  const ref = document.referrer;
  if (!ref) return 'direct';

  try {
    const host = new URL(ref).host.toLowerCase();
    if (host.includes('google') || host.includes('bing') || host.includes('duckduckgo') || host.includes('yahoo')) return 'organic_search';
    if (host.includes('facebook') || host.includes('fb.com') || host.includes('fb.me')) return 'facebook';
    if (host.includes('instagram')) return 'instagram';
    if (host.includes('tiktok')) return 'tiktok';
    if (host.includes('youtube') || host.includes('youtu.be')) return 'youtube';
    if (host.includes('twitter') || host.includes('x.com')) return 'twitter';
    if (host.includes('wa.me') || host.includes('whatsapp')) return 'whatsapp';
    if (host.includes('linkedin')) return 'linkedin';
    if (host === window.location.host) return 'internal';
    return `referral_${host}`;
  } catch {
    return 'unknown';
  }
}

function deviceBucket(): string {
  const w = window.innerWidth;
  if (w < 640) return 'mobile';
  if (w < 1024) return 'tablet';
  return 'desktop';
}

function connectionType(): string {
  const c = (navigator as unknown as { connection?: { effectiveType?: string } }).connection;
  return c?.effectiveType || 'unknown';
}

function currentPriceTier(): string {
  const now = Date.now();
  const LOTE1 = new Date('2026-05-16T00:00:00-03:00').getTime();
  const LOTE2 = new Date('2026-06-01T00:00:00-03:00').getTime();
  if (now >= LOTE2) return 'lote2';
  if (now >= LOTE1) return 'lote1';
  return 'lote0';
}

let sessionInitialized = false;

export function initSessionContext() {
  if (sessionInitialized || typeof window === 'undefined' || ANALYTICS_DISABLED) return;
  sessionInitialized = true;

  // Aguarda Clarity carregar (script async); polling curto
  const setAll = () => {
    if (!window.clarity) return false;

    const url = new URL(window.location.href);
    const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];
    utmKeys.forEach(k => {
      const v = url.searchParams.get(k);
      if (v) track.tag(k, v);
    });

    const ctx = {
      traffic_source: parseTrafficSource(),
      device_bucket: deviceBucket(),
      orientation: window.innerWidth > window.innerHeight ? 'landscape' : 'portrait',
      language: navigator.language,
      platform: navigator.platform,
      connection_type: connectionType(),
      price_tier: currentPriceTier(),
      referrer_host: document.referrer ? new URL(document.referrer).host : 'none',
      landing_path: url.pathname,
    };
    Object.entries(ctx).forEach(([k, v]) => track.tag(k, v));
    track.tag('viewport_width', window.innerWidth);
    track.tag('viewport_height', window.innerHeight);
    // Mirror context tags como user_properties no GA4 pra segmentação cross-session
    track.setUserProperties(ctx);

    // Visitante recorrente?
    const hasVisited = localStorage.getItem('vfj_visited');
    track.tag('is_returning_visitor', hasVisited ? 'true' : 'false');
    track.setUserProperties({ is_returning_visitor: hasVisited ? 'true' : 'false' });
    if (!hasVisited) {
      try { localStorage.setItem('vfj_visited', '1'); } catch { /* private mode */ }
    } else {
      try {
        const visits = Number(localStorage.getItem('vfj_visit_count') || '0') + 1;
        localStorage.setItem('vfj_visit_count', String(visits));
        track.tag('visit_count', visits);
        track.setUserProperties({ visit_count: visits });
      } catch { /* ignore */ }
    }
    return true;
  };

  if (!setAll()) {
    let tries = 0;
    const t = setInterval(() => {
      if (setAll() || ++tries > 20) clearInterval(t);
    }, 500);
  }
}

/* ---------------------------------------------------------------------------
 * Helpers globais que podem ser usados em qualquer componente
 * ------------------------------------------------------------------------- */

/** Helper para rastrear quando um elemento entra no viewport (intersection observer) */
export function trackInView(el: Element, eventName: string, threshold = 0.5) {
  if (typeof window === 'undefined' || !('IntersectionObserver' in window) || ANALYTICS_DISABLED) return () => {};
  const fired = new Set<string>();
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting && !fired.has(eventName)) {
        fired.add(eventName);
        track.event(eventName);
      }
    });
  }, { threshold });
  obs.observe(el);
  return () => obs.disconnect();
}

/** Rastreia profundidade de scroll (25%, 50%, 75%, 100%) — uma vez por sessão */
export function trackScrollDepth() {
  if (typeof window === 'undefined' || ANALYTICS_DISABLED) return;
  const fired = new Set<number>();
  const handler = () => {
    const scrolled = window.scrollY + window.innerHeight;
    const total = document.documentElement.scrollHeight;
    const pct = Math.floor((scrolled / total) * 100);
    [25, 50, 75, 100].forEach(threshold => {
      if (pct >= threshold && !fired.has(threshold)) {
        fired.add(threshold);
        track.event(`scroll_depth_${threshold}`);
      }
    });
  };
  window.addEventListener('scroll', handler, { passive: true });
  return () => window.removeEventListener('scroll', handler);
}

/**
 * Rastreia mudanças de rota no React Router (SPA) — envia `page_view` ao GA4
 * e custom event ao Clarity. Chamar uma vez no componente raiz (App.tsx).
 *
 * Como o site usa react-router-dom, alternativamente poderíamos importar
 * useLocation, mas pra não criar dependência forte usamos popstate + pushState patch.
 */
export function trackRouteChanges() {
  if (typeof window === 'undefined' || ANALYTICS_DISABLED) return;
  let currentPath = window.location.pathname + window.location.search;

  const sendPageView = (newPath: string) => {
    if (newPath === currentPath) return;
    currentPath = newPath;
    safeCall(() => {
      if (window.gtag) {
        window.gtag('event', 'page_view', {
          page_path: newPath,
          page_location: window.location.origin + newPath,
          page_title: document.title,
        });
      }
    });
    safeCall(() => {
      if (window.clarity) window.clarity('event', `spa_pageview_${newPath.replace(/[^a-z0-9]/gi, '_').slice(0, 50)}`);
    });
    safeCall(() => {
      if (window.fbq) window.fbq('track', 'PageView');
    });
  };

  // Patch history.pushState/replaceState
  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);
  history.pushState = function (...args) {
    const r = origPush(...args);
    setTimeout(() => sendPageView(window.location.pathname + window.location.search), 0);
    return r;
  };
  history.replaceState = function (...args) {
    const r = origReplace(...args);
    setTimeout(() => sendPageView(window.location.pathname + window.location.search), 0);
    return r;
  };
  // Botão voltar/avançar do browser
  window.addEventListener('popstate', () => {
    sendPageView(window.location.pathname + window.location.search);
  });
}

/** Rastreia tempo gasto na página antes de sair (envia em beacon ao unload) */
export function trackTimeOnPage() {
  if (typeof window === 'undefined' || ANALYTICS_DISABLED) return;
  const start = Date.now();
  const handler = () => {
    const seconds = Math.round((Date.now() - start) / 1000);
    // bucket pra reduzir cardinalidade
    let bucket = 'long';
    if (seconds < 10) bucket = 'bounce_lt10s';
    else if (seconds < 30) bucket = 'short_10_30s';
    else if (seconds < 60) bucket = 'medium_30_60s';
    else if (seconds < 180) bucket = 'engaged_1_3min';
    else if (seconds < 600) bucket = 'long_3_10min';
    else bucket = 'very_long_10min+';
    track.tag('exit_time_bucket', bucket);
    track.tag('total_seconds_on_page', seconds);
  };
  window.addEventListener('pagehide', handler);
  window.addEventListener('beforeunload', handler);
}
