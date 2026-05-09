import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App.tsx';
import Agendamento, { AgendamentoSucesso } from './pages/Agendamento.tsx';
import Admin from './pages/Admin.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/agendamento" element={<Agendamento />} />
        <Route path="/agendamento/sucesso" element={<AgendamentoSucesso />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
