import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    // HMR desabilitado no AI Studio via DISABLE_HMR; watching off evita flicker em edição por agente.
    hmr: process.env.DISABLE_HMR !== 'true',
    // vite dev não roda as funções de api/ — proxy para produção permite avaliar
    // páginas reais (galeria) no dev local. Endpoints ainda não deployados dão 404.
    proxy: {
      '/api': { target: 'https://www.ensaiofotograficoemjoinville.com', changeOrigin: true },
      // Espelha o rewrite /r2/* do vercel.json: mesmo caminho no dev e em produção.
      '/r2': {
        target: 'https://pub-144050c98b964bdc95d46793863feff0.r2.dev',
        changeOrigin: true,
        rewrite: p => p.replace(/^\/r2/, ''),
      },
    },
  },
});
