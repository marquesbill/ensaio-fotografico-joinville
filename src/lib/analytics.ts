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

function safeCall(fn: () => void) {
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
        const stringParams = params
          ? Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))
          : undefined;
        if (PIXEL_STANDARD_EVENTS.has(name)) {
          window.fbq('track', name, stringParams as Record<string, string>);
        } else {
          window.fbq('trackCustom', name, stringParams as Record<string, string>);
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

  /** Identifica usuário (use só com PII com consentimento — ex. após payment success) */
  identify(userId: string, friendlyName?: string) {
    if (typeof window === 'undefined') return;
    safeCall(() => {
      if (window.clarity) window.clarity('identify', userId, undefined, undefined, friendlyName);
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
  const LOTE2 = new Date('2026-07-01T00:00:00-03:00').getTime();
  if (now >= LOTE2) return 'lote2';
  if (now >= LOTE1) return 'lote1';
  return 'lote0';
}

let sessionInitialized = false;

export function initSessionContext() {
  if (sessionInitialized || typeof window === 'undefined') return;
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

    track.tag('traffic_source', parseTrafficSource());
    track.tag('device_bucket', deviceBucket());
    track.tag('viewport_width', window.innerWidth);
    track.tag('viewport_height', window.innerHeight);
    track.tag('orientation', window.innerWidth > window.innerHeight ? 'landscape' : 'portrait');
    track.tag('language', navigator.language);
    track.tag('platform', navigator.platform);
    track.tag('connection_type', connectionType());
    track.tag('price_tier', currentPriceTier());
    track.tag('referrer_host', document.referrer ? new URL(document.referrer).host : 'none');
    track.tag('landing_path', url.pathname);

    // Visitante recorrente?
    const hasVisited = localStorage.getItem('vfj_visited');
    track.tag('is_returning_visitor', hasVisited ? 'true' : 'false');
    if (!hasVisited) {
      try { localStorage.setItem('vfj_visited', '1'); } catch { /* private mode */ }
    } else {
      try {
        const visits = Number(localStorage.getItem('vfj_visit_count') || '0') + 1;
        localStorage.setItem('vfj_visit_count', String(visits));
        track.tag('visit_count', visits);
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
  if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return () => {};
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
  if (typeof window === 'undefined') return;
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

/** Rastreia tempo gasto na página antes de sair (envia em beacon ao unload) */
export function trackTimeOnPage() {
  if (typeof window === 'undefined') return;
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
