declare global {
  interface Window {
    fbq: {
      (command: 'track' | 'trackCustom', event: string, params?: Record<string, string | number>): void;
      (command: 'init', pixelId: string): void;
      (command: 'consent', consent: 'grant' | 'revoke'): void;
    };
    clarity: {
      (command: 'event', name: string): void;
      (command: 'set', key: string, value: string | string[]): void;
      (command: 'identify', userId: string, sessionId?: string, pageId?: string, friendlyName?: string): void;
      (command: 'upgrade', reason: string): void;
      (command: 'consent', consent?: boolean): void;
      q?: unknown[];
    };
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}
export {};
