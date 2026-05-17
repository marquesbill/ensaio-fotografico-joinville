import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App.tsx';
import Agendamento, { AgendamentoSucesso } from './pages/Agendamento.tsx';
import Admin from './pages/Admin.tsx';
import Dashboard from './pages/Dashboard/Dashboard.tsx';
import { trackRouteChanges } from './lib/analytics';
import './index.css';

// Rastreia mudanças de rota da SPA (envia page_view ao GA4 a cada navegação client-side)
trackRouteChanges();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/agendamento" element={<Agendamento />} />
        <Route path="/agendamento/sucesso" element={<AgendamentoSucesso />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
