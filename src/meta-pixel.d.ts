declare global {
  interface Window {
    fbq: (
      command: string,
      event: string,
      params?: Record<string, string | number>
    ) => void;
  }
}
export {};
