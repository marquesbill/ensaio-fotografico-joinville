/**
 * Dashboard — Marketing Analytics J26
 *
 * Layout principal com sidebar de navegação + área de conteúdo.
 * Reusa o sistema de auth do Admin (HMAC token via /api/admin-auth).
 * Acesso: usuários `andre`, `mari`, `elisa` (já cadastrados em api/admin-auth.ts).
 *
 * Páginas planejadas (cada uma é uma view dentro deste shell):
 *  1. Visão Geral — KPIs principais + tendência + canais
 *  2. Aquisição — de onde vem o tráfego, UTM, campanhas
 *  3. Funil de Pacotes — view_item → select → checkout → purchase
 *  4. Engajamento — eventos custom, scroll, tempo, FAQ
 *  5. Pagamentos — métodos, status, falhas
 *  6. Comportamento — device, geo, recorrência
 */

import { useEffect, useState } from 'react';
import {
  LayoutGrid,
  TrendingUp,
  Filter,
  CreditCard,
  MousePointerClick,
  Smartphone,
  LogOut,
  Loader2,
} from 'lucide-react';

import { Overview } from './pages/Overview';
import { Acquisition } from './pages/Acquisition';
import { Funnel } from './pages/Funnel';
import { Engagement } from './pages/Engagement';
import { Payments } from './pages/Payments';

type DashboardPage = 'overview' | 'acquisition' | 'funnel' | 'engagement' | 'payments' | 'behavior';

const NAV: Array<{ key: DashboardPage; label: string; icon: typeof LayoutGrid; status: 'live' | 'wip' }> = [
  { key: 'overview',    label: 'Visão Geral',    icon: LayoutGrid,        status: 'live' },
  { key: 'acquisition', label: 'Aquisição',      icon: TrendingUp,         status: 'live' },
  { key: 'funnel',      label: 'Funil de Pacotes', icon: Filter,           status: 'live' },
  { key: 'engagement',  label: 'Engajamento',    icon: MousePointerClick, status: 'live' },
  { key: 'payments',    label: 'Pagamentos',     icon: CreditCard,        status: 'live' },
  { key: 'behavior',    label: 'Comportamento',  icon: Smartphone,        status: 'wip' },
];

function LoginScreen({ onLogin }: { onLogin: (token: string, user: string) => void }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const r = await fetch('/api/admin-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, pass }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error || 'Erro ao autenticar');
      onLogin(json.token, json.user);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro');
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'linear-gradient(135deg, #0f0a1f 0%, #1a0f2e 50%, #0a0a14 100%)' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="font-headline text-3xl text-white font-black mb-2">Marketing Dashboard</h1>
          <p className="text-[#d4baeb] text-sm">Acesso restrito · J26 — Ensaios Joinville 2026</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6 space-y-4">
          <input
            type="text" placeholder="Usuário" required value={user}
            onChange={(e) => setUser(e.target.value)}
            className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder:text-white/40 focus:ring-2 focus:ring-[#a578bb] focus:outline-none"
          />
          <input
            type="password" placeholder="Senha" required value={pass}
            onChange={(e) => setPass(e.target.value)}
            className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder:text-white/40 focus:ring-2 focus:ring-[#a578bb] focus:outline-none"
          />
          {error && <p className="text-red-300 text-sm">{error}</p>}
          <button
            type="submit" disabled={loading}
            className="w-full py-3 rounded-xl font-bold text-white shadow-lg transition-all disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #7a3f8f, #e87060)' }}
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}

function DashboardShell({ token, user, onLogout }: { token: string; user: string; onLogout: () => void }) {
  const [activePage, setActivePage] = useState<DashboardPage>('overview');

  return (
    <div className="min-h-screen flex" style={{ background: '#0a0a14' }}>
      {/* Sidebar */}
      <aside className="w-64 shrink-0 border-r border-white/5 flex flex-col" style={{ background: '#0f0a1f' }}>
        <div className="px-6 py-6 border-b border-white/5">
          <p className="text-[#c5a3d4] text-xs font-bold tracking-widest uppercase">J26 · Marketing</p>
          <h2 className="font-headline text-xl text-white mt-1">Dashboard</h2>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {NAV.map(({ key, label, icon: Icon, status }) => {
            const active = activePage === key;
            const disabled = status === 'wip';
            return (
              <button
                key={key}
                disabled={disabled}
                onClick={() => !disabled && setActivePage(key)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors text-left
                  ${active ? 'bg-[#7a3f8f]/20 text-white border border-[#e87060]/40' : 'text-[#d4baeb]/70 hover:bg-white/5 hover:text-white'}
                  ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="flex-1 font-medium">{label}</span>
                {status === 'wip' && (
                  <span className="text-[9px] uppercase tracking-wider text-[#c5a3d4]/60 bg-[#7a3f8f]/10 px-1.5 py-0.5 rounded">em breve</span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-white/5">
          <div className="flex items-center gap-3 px-3 py-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-[#7a3f8f]/20 border border-[#a578bb]/30 flex items-center justify-center text-[#d4baeb] text-sm font-bold">
              {user.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">{user}</p>
              <p className="text-[10px] text-[#c5a3d4]/60 uppercase tracking-wider">Acesso ativo</p>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-[#d4baeb]/70 hover:bg-white/5 hover:text-white transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sair
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-x-hidden">
        {activePage === 'overview'    && <Overview token={token} />}
        {activePage === 'acquisition' && <Acquisition token={token} />}
        {activePage === 'funnel'      && <Funnel token={token} />}
        {activePage === 'engagement'  && <Engagement token={token} />}
        {activePage === 'payments'    && <Payments token={token} />}
        {activePage !== 'overview' && activePage !== 'acquisition' && activePage !== 'funnel' && activePage !== 'engagement' && activePage !== 'payments' && (
          <div className="p-10 flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-[#c5a3d4]/60 text-sm uppercase tracking-widest">Em construção</p>
              <p className="text-white font-headline text-2xl mt-2">Página em breve</p>
              <p className="text-[#d4baeb]/50 text-sm mt-3 max-w-sm">Próxima entrega desta página depende de dados do BigQuery (24-48h após primeiro export) ou ativação da Meta Ads API.</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function Dashboard() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('admin_token'));
  const [user,  setUser]  = useState<string | null>(() => localStorage.getItem('admin_user'));

  function handleLogin(t: string, u: string) {
    localStorage.setItem('admin_token', t);
    localStorage.setItem('admin_user', u);
    setToken(t); setUser(u);
  }
  function handleLogout() {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    setToken(null); setUser(null);
  }

  // Verifica se token ainda é válido ao carregar
  useEffect(() => {
    if (!token) return;
    // Se a chamada falhar com 401, faz logout
    fetch('/api/admin-bookings?endpoint=ga4-dashboard&ping=1', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (r.status === 401) handleLogout(); })
      .catch(() => { /* ignore network errors */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!token || !user) return <LoginScreen onLogin={handleLogin} />;
  return <DashboardShell token={token} user={user} onLogout={handleLogout} />;
}
