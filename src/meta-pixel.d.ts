declare global {
  interface Window {
    fbq: {
      (command: 'track' | 'trackCustom', event: string, params?: Record<string, string | number>): void;
      (command: 'init', pixelId: string, advancedMatching?: {
        em?: string; ph?: string; fn?: string; ln?: string;
        ge?: string; db?: string; ct?: string; st?: string;
        zp?: string; country?: string; external_id?: string;
      }): void;
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
