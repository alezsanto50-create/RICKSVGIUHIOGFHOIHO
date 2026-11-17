import React, { useState } from 'react';
import { ArrowRight, Eye, EyeOff, Lock, Mail } from 'lucide-react';
import editorialHeroImg from '../assets/images/trindade_hero_barber_editorial_1794821002617.jpg';
import emblemBadgeImg from '../assets/images/trindade_emblem_badge.png';
import { apiRequest, setStoredToken } from '../lib/api';
import { handleGlassPointerMove } from '../lib/glassEffects';
import { useLocalDraft } from '../lib/storage';
import type { User } from '../types';

interface LoginScreenProps {
  onLoginSuccess: (user: User) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [email, setEmail] = useLocalDraft('login_email', '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [photoFailed, setPhotoFailed] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiRequest<{ token: string; user: User }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setStoredToken(res.token);
      onLoginSuccess(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao autenticar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-black text-zinc-100 overflow-hidden flex flex-col justify-between pt-safe">
      {/* Full-bleed Architectural Editorial Backdrop */}
      <div className="fixed inset-0 pointer-events-none">
        {!photoFailed ? (
          <img
            src={editorialHeroImg}
            alt="Interior arquitetônico da Barbearia Trindade"
            referrerPolicy="no-referrer"
            onError={() => setPhotoFailed(true)}
            className="w-full h-full object-cover object-center scale-[1.01] opacity-50 lg:opacity-70"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#16161C] via-[#0A0A0D] to-black" />
        )}
        {/* Solid Black Top Framing + Measured Directional Contrast Scrim */}
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black via-black/85 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/60 to-black lg:bg-gradient-to-r lg:from-black/50 lg:via-black/82 lg:to-black" />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/65" />
      </div>

      {/* Main Responsive Stage */}
      <div className="relative z-10 flex-1 w-full max-w-7xl mx-auto px-4 sm:px-8 lg:px-12 py-5 sm:py-10 lg:py-12 grid lg:grid-cols-12 gap-6 lg:gap-12 items-center">
        {/* Brand Centerpiece & Editorial Statement */}
        <section className="lg:col-span-7 flex flex-col items-center text-center lg:items-start lg:text-left apple-view-enter">
          <div className="relative">
            <img
              src={emblemBadgeImg}
              alt="Brasão Barbearia Trindade Est. 2018"
              referrerPolicy="no-referrer"
              className="w-20 h-20 sm:w-28 sm:h-28 lg:w-32 lg:h-32 object-contain rounded-full drop-shadow-[0_18px_40px_rgba(0,0,0,0.85)] select-none transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:scale-105"
            />
          </div>

          <div className="mt-3 sm:mt-6 flex items-center gap-2.5 text-[11px] sm:text-xs font-semibold tracking-[0.2em] uppercase text-[#E6C65C]">
            <span>Barbearia Trindade</span>
          </div>

          <h1 className="mt-2 sm:mt-3 text-xl sm:text-4xl lg:text-[2.75rem] font-bold tracking-tight text-white leading-[1.15] max-w-xl [text-wrap:balance]">
            Gestão financeira e operacional com precisão executiva.
          </h1>

          <p className="mt-3 text-sm sm:text-base text-zinc-300/90 leading-relaxed max-w-lg hidden sm:block">
            Controle entradas, saídas, mensalidades via PIX, atendimentos e fechamento de caixa diário em uma plataforma elegante feita para o seu celular.
          </p>
        </section>

        {/* Elevated Apple Liquid Glass Access Surface */}
        <section className="lg:col-span-5 w-full max-w-md mx-auto lg:max-w-none apple-stagger-2">
          <div
            onPointerMove={handleGlassPointerMove}
            className="apple-glass-modal apple-spotlight rounded-[26px] sm:rounded-[28px] p-5 sm:p-8"
          >
            <div className="pb-5 border-b border-white/[0.09]">
              <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Acessar Sistema</h2>
              <p className="text-xs sm:text-sm text-zinc-400 mt-1">
                Entre com suas credenciais autorizadas.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="login-email" className="block text-xs font-medium text-zinc-300 mb-1.5">
                  E-mail de Acesso
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="login-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="seu@email.com"
                    className="w-full min-h-[48px] pl-10 pr-4 rounded-2xl apple-glass-well text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#E6C65C] focus:ring-2 focus:ring-[#D4AF37]/25 transition-all"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="login-password" className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Senha
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Digite sua senha"
                    className="w-full min-h-[48px] pl-10 pr-12 rounded-2xl apple-glass-well text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#E6C65C] focus:ring-2 focus:ring-[#D4AF37]/25 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-white transition-colors"
                    aria-label="Mostrar ou ocultar senha"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="rounded-2xl border border-rose-500/35 bg-rose-500/12 backdrop-blur-md px-4 py-3 text-xs font-medium text-rose-200">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[50px] mt-2 rounded-2xl apple-btn-gold font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.985] transition-all disabled:opacity-60"
              >
                <span>{loading ? 'Autenticando...' : 'Entrar no Sistema'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            <div className="mt-6 pt-4 border-t border-white/[0.08] flex items-center justify-between text-[11px] text-zinc-400">
              <span>Gestão Inteligente</span>
              <span>Acesso protegido</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
