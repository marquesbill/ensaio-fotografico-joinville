import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App.tsx';
import { trackRouteChanges } from './lib/analytics';
import './index.css';

// 3.1 — code-split: as rotas pesadas saem do bundle inicial da home.
//   /agendamento  -> @mercadopago/sdk-react (Brick de checkout)
//   /dashboard    -> recharts + telas de analytics (~5k linhas)
//   /admin        -> painel da Mari (~2,3k linhas)
// A home ('/') segue eager (é o LCP). Cada rota vira um chunk próprio, baixado só ao visitar.
const Agendamento = lazy(() => import('./pages/Agendamento.tsx'));
const AgendamentoSucesso = lazy(() =>
  import('./pages/Agendamento.tsx').then(m => ({ default: m.AgendamentoSucesso })),
);
const Admin = lazy(() => import('./pages/Admin.tsx'));
const Dashboard = lazy(() => import('./pages/Dashboard/Dashboard.tsx'));
const Especial = lazy(() => import('./pages/Especial.tsx'));   // página pública do pacote Especial (token)
const Contrato = lazy(() => import('./pages/Contrato.tsx'));   // página pública de aceite do contrato (token)
const Galeria  = lazy(() => import('./pages/Galeria.tsx'));    // galeria de entrega das fotos (token)

// Loader enquanto o chunk da rota baixa (a home nunca o mostra — App é eager).
function PageLoader() {
  return (
    <div className="min-h-screen grid place-items-center bg-surface">
      <div className="w-10 h-10 rounded-full border-[3px] border-primary-container border-t-primary animate-spin" />
    </div>
  );
}

// Rastreia mudanças de rota da SPA (envia page_view ao GA4 a cada navegação client-side)
trackRouteChanges();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* reducedMotion="user": respeita o prefers-reduced-motion do SO em todos os
        motion.* (corta movimento/escala, mantém opacidade). Cobre App + Agendamento. */}
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<App />} />
            <Route path="/agendamento" element={<Agendamento />} />
            <Route path="/agendamento/sucesso" element={<AgendamentoSucesso />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/especial/:id" element={<Especial />} />
            <Route path="/contrato/:id" element={<Contrato />} />
            <Route path="/galeria/:id" element={<Galeria />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </MotionConfig>
  </StrictMode>,
);
