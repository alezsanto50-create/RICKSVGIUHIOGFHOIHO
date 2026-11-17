import React, { useMemo } from 'react';
import { ArrowDownRight, ArrowUpRight, Bell, Calculator, Plus, Scissors, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { PAYMENT_LABELS, type AppSettings, type Appointment, type Subscriber, type Transaction } from '../types';
import { addDaysISO, calcDeltaPercent, formatBRL, formatDateBR, getTodayBR } from '../lib/formatters';
import { handleGlassPointerMove } from '../lib/glassEffects';
import { useLocalDraft } from '../lib/storage';
import { RevenueChart } from './RevenueChart';

interface DashboardViewProps {
  settings: AppSettings;
  transactions: Transaction[];
  appointments: Appointment[];
  subscribers: Subscriber[];
  onQuickAction: (action: 'appointment' | 'entrada' | 'saida' | 'closing' | 'subscriptions') => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  settings,
  transactions,
  appointments,
  subscribers,
  onQuickAction,
}) => {
  const [mobileAnalyticsTab, setMobileAnalyticsTab] = useLocalDraft<'grafico' | 'comparativo'>('dash_mobile_tab', 'grafico');
  const today = getTodayBR();
  const yesterday = addDaysISO(today, -1);

  const metrics = useMemo(() => {
    let totalAllIn = 0;
    let totalAllOut = 0;
    let todayIn = 0;
    let todayOut = 0;
    let yesterdayIn = 0;

    let weekCurrentIn = 0;
    let weekPrevIn = 0;
    let monthCurrentIn = 0;
    let monthPrevIn = 0;

    const weekStart = addDaysISO(today, -6);
    const prevWeekStart = addDaysISO(today, -13);
    const prevWeekEnd = addDaysISO(today, -7);

    const currentYM = today.slice(0, 7);
    const [yNum, mNum] = today.split('-').map(Number);
    const prevMonthDt = new Date(Date.UTC(yNum, mNum - 2, 1));
    const prevYM = `${prevMonthDt.getUTCFullYear()}-${String(prevMonthDt.getUTCMonth() + 1).padStart(2, '0')}`;

    for (const t of transactions) {
      if (t.type === 'entrada') {
        totalAllIn += t.amount;
        if (t.date === today) todayIn += t.amount;
        if (t.date === yesterday) yesterdayIn += t.amount;
        if (t.date >= weekStart && t.date <= today) weekCurrentIn += t.amount;
        if (t.date >= prevWeekStart && t.date <= prevWeekEnd) weekPrevIn += t.amount;
        if (t.date.startsWith(currentYM)) monthCurrentIn += t.amount;
        if (t.date.startsWith(prevYM)) monthPrevIn += t.amount;
      } else {
        totalAllOut += t.amount;
        if (t.date === today) todayOut += t.amount;
      }
    }

    const currentCashBalance = settings.openingCashBalance + totalAllIn - totalAllOut;
    const todayProfit = todayIn - todayOut;
    const todayAppointments = appointments.filter((a) => a.date === today);
    const yesterdayAppointments = appointments.filter((a) => a.date === yesterday);

    return {
      currentCashBalance,
      todayIn,
      todayOut,
      todayProfit,
      todayApptCount: todayAppointments.length,
      yesterdayApptCount: yesterdayAppointments.length,
      todayAppointments: todayAppointments.slice(0, 5),
      dayDelta: calcDeltaPercent(todayIn, yesterdayIn),
      yesterdayIn,
      weekCurrentIn,
      weekPrevIn,
      weekDelta: calcDeltaPercent(weekCurrentIn, weekPrevIn),
      monthCurrentIn,
      monthPrevIn,
      monthDelta: calcDeltaPercent(monthCurrentIn, monthPrevIn),
    };
  }, [transactions, appointments, settings.openingCashBalance, today, yesterday]);

  const dailyProgress = settings.dailyGoal > 0 ? Math.min(100, Math.round((metrics.todayIn / settings.dailyGoal) * 100)) : 0;

  const dueReminders = useMemo(() => {
    const soon = addDaysISO(today, 3);
    return subscribers.filter((s) => s.status === 'ativo' && s.nextDueDate <= soon);
  }, [subscribers, today]);

  return (
    <div className="space-y-4 sm:space-y-6">
      {dueReminders.length > 0 && (
        <button
          type="button"
          onClick={() => onQuickAction('subscriptions')}
          className="w-full min-h-[48px] rounded-[22px] apple-glass border-amber-400/35 bg-amber-500/10 px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-amber-500/15 transition-colors"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Bell className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="text-xs sm:text-sm font-medium text-zinc-100 truncate">
              <strong className="text-amber-300">{dueReminders.length} lembrete(s) de mensalidade</strong> vencendo ou em atraso
            </span>
          </div>
          <span className="text-xs font-semibold text-[#E6C65C] whitespace-nowrap shrink-0">Cobrar PIX →</span>
        </button>
      )}

      {/* Top Apple Liquid Glass Hero Cash Balance */}
      <div
        onPointerMove={handleGlassPointerMove}
        className="rounded-[24px] sm:rounded-[26px] apple-glass-hero apple-spotlight p-4 sm:p-6"
      >
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 sm:gap-5">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-[#E6C65C]">
              <Wallet className="w-4 h-4" />
              <span>Saldo Atual do Caixa</span>
              <span aria-hidden="true">·</span>
              <span className="text-zinc-300/80">{formatDateBR(today)}</span>
            </div>
            <p className="mt-1.5 sm:mt-2 text-3xl sm:text-4xl font-bold font-mono tabular-nums tracking-tight text-white">
              {formatBRL(metrics.currentCashBalance)}
            </p>
            <div className="mt-2 hidden sm:flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-300/80">
              <span>
                Meta do dia: <strong className="font-mono tabular-nums text-white">{formatBRL(settings.dailyGoal)}</strong> ({dailyProgress}%)
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Ticket médio hoje:{' '}
                <strong className="font-mono tabular-nums text-white">
                  {metrics.todayApptCount > 0 ? formatBRL(metrics.todayIn / metrics.todayApptCount) : formatBRL(0)}
                </strong>
              </span>
            </div>
            {settings.dailyGoal > 0 && (
              <div className="mt-2.5 w-full max-w-sm h-1.5 rounded-full bg-white/[0.1] overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#D4AF37] to-[#F3DF98] transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
                  style={{ width: `${dailyProgress}%` }}
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 sm:flex sm:flex-wrap items-center gap-2 sm:gap-2.5">
            <button
              type="button"
              onClick={() => onQuickAction('appointment')}
              className="min-h-[42px] sm:min-h-[44px] px-2.5 sm:px-4 py-2 rounded-2xl apple-btn-gold font-semibold text-xs sm:text-sm flex items-center justify-center gap-1.5 sm:gap-2 whitespace-nowrap shrink-0"
            >
              <Scissors className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
              <span className="sm:hidden">Atender</span>
              <span className="hidden sm:inline">Novo Atendimento</span>
            </button>
            <button
              type="button"
              onClick={() => onQuickAction('entrada')}
              className="min-h-[42px] sm:min-h-[44px] px-2.5 sm:px-4 py-2 rounded-2xl border border-emerald-400/30 bg-emerald-500/14 text-emerald-300 font-semibold text-xs sm:text-sm flex items-center justify-center gap-1 sm:gap-1.5 hover:bg-emerald-500/22 apple-tab-spring whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
              <span>Entrada</span>
            </button>
            <button
              type="button"
              onClick={() => onQuickAction('saida')}
              className="min-h-[42px] sm:min-h-[44px] px-2.5 sm:px-4 py-2 rounded-2xl border border-rose-400/30 bg-rose-500/14 text-rose-300 font-semibold text-xs sm:text-sm flex items-center justify-center gap-1 sm:gap-1.5 hover:bg-rose-500/22 apple-tab-spring whitespace-nowrap shrink-0"
            >
              <TrendingDown className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
              <span>Despesa</span>
            </button>
            <button
              type="button"
              onClick={() => onQuickAction('closing')}
              className="hidden sm:flex min-h-[44px] px-4 py-2.5 rounded-2xl apple-glass-well text-zinc-100 font-semibold text-xs sm:text-sm items-center justify-center gap-1.5 hover:bg-white/[0.12] apple-tab-spring whitespace-nowrap shrink-0"
            >
              <Calculator className="w-4 h-4 shrink-0" />
              <span>Fechar Caixa</span>
            </button>
          </div>
        </div>
      </div>

      {/* 4 Primary Apple Glass KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
        <div
          onPointerMove={handleGlassPointerMove}
          className="rounded-[20px] sm:rounded-[22px] apple-glass apple-glass-interactive apple-spotlight apple-stagger-1 p-3.5 sm:p-5"
        >
          <p className="relative z-10 text-xs font-medium text-zinc-300">Faturamento do Dia</p>
          <p className="relative z-10 mt-1.5 sm:mt-2 text-lg sm:text-2xl font-bold font-mono tabular-nums text-emerald-400">
            {formatBRL(metrics.todayIn)}
          </p>
          <p className="relative z-10 mt-1.5 text-xs text-zinc-400/80 hidden sm:block">
            Ontem: <span className="font-mono tabular-nums text-zinc-200">{formatBRL(metrics.yesterdayIn)}</span>
          </p>
        </div>

        <div
          onPointerMove={handleGlassPointerMove}
          className="rounded-[20px] sm:rounded-[22px] apple-glass apple-glass-interactive apple-spotlight apple-stagger-2 p-3.5 sm:p-5"
        >
          <p className="relative z-10 text-xs font-medium text-zinc-300">Despesas do Dia</p>
          <p className="relative z-10 mt-1.5 sm:mt-2 text-lg sm:text-2xl font-bold font-mono tabular-nums text-rose-400">
            {formatBRL(metrics.todayOut)}
          </p>
          <p className="relative z-10 mt-1.5 text-xs text-zinc-400/80 hidden sm:block">Saídas registradas hoje</p>
        </div>

        <div
          onPointerMove={handleGlassPointerMove}
          className="rounded-[20px] sm:rounded-[22px] apple-glass apple-glass-interactive apple-spotlight apple-stagger-3 p-3.5 sm:p-5"
        >
          <p className="relative z-10 text-xs font-medium text-zinc-300">Lucro Estimado</p>
          <p className={`relative z-10 mt-1.5 sm:mt-2 text-lg sm:text-2xl font-bold font-mono tabular-nums ${metrics.todayProfit >= 0 ? 'text-[#E6C65C]' : 'text-rose-400'}`}>
            {formatBRL(metrics.todayProfit)}
          </p>
          <p className="relative z-10 mt-1.5 text-xs text-zinc-400/80 hidden sm:block">
            Margem:{' '}
            <span className="font-mono tabular-nums text-zinc-200">
              {metrics.todayIn > 0 ? `${Math.round((metrics.todayProfit / metrics.todayIn) * 100)}%` : '0%'}
            </span>
          </p>
        </div>

        <div
          onPointerMove={handleGlassPointerMove}
          className="rounded-[20px] sm:rounded-[22px] apple-glass apple-glass-interactive apple-spotlight apple-stagger-4 p-3.5 sm:p-5"
        >
          <p className="relative z-10 text-xs font-medium text-zinc-300">Atendimentos</p>
          <p className="relative z-10 mt-1.5 sm:mt-2 text-lg sm:text-2xl font-bold font-mono tabular-nums text-white">
            {metrics.todayApptCount}
          </p>
          <p className="relative z-10 mt-1.5 text-xs text-zinc-400/80 hidden sm:block">
            Ontem: <span className="font-mono tabular-nums text-zinc-200">{metrics.yesterdayApptCount}</span>
          </p>
        </div>
      </div>

      {/* Mobile Segmented Switcher for Analytics (keeps screen clean & uncluttered) */}
      <div className="lg:hidden relative grid grid-cols-2 p-1 rounded-2xl apple-glass-well">
        <div
          aria-hidden="true"
          className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-xl apple-btn-gold pointer-events-none transition-transform duration-300 ease-[cubic-bezier(0.32,1.25,0.36,1)]"
          style={{ transform: `translateX(${mobileAnalyticsTab === 'comparativo' ? '100%' : '0%'})` }}
        />
        <button
          type="button"
          onClick={() => setMobileAnalyticsTab('grafico')}
          className={`relative z-10 min-h-[38px] rounded-xl text-xs font-semibold apple-tab-spring ${
            mobileAnalyticsTab === 'grafico' ? 'text-[#09090B]' : 'text-zinc-300 hover:text-white'
          }`}
        >
          Gráfico
        </button>
        <button
          type="button"
          onClick={() => setMobileAnalyticsTab('comparativo')}
          className={`relative z-10 min-h-[38px] rounded-xl text-xs font-semibold apple-tab-spring ${
            mobileAnalyticsTab === 'comparativo' ? 'text-[#09090B]' : 'text-zinc-300 hover:text-white'
          }`}
        >
          Comparação
        </button>
      </div>

      {/* Main Content Split: Chart + Period Comparisons */}
      <div className="grid lg:grid-cols-3 gap-4 sm:gap-6 items-start">
        <div className={`lg:col-span-2 ${mobileAnalyticsTab === 'grafico' ? 'block' : 'hidden lg:block'}`}>
          <RevenueChart transactions={transactions} />
        </div>

        {/* Period Comparisons */}
        <section className={`rounded-[22px] apple-glass p-4 sm:p-5 space-y-3.5 sm:space-y-4 ${mobileAnalyticsTab === 'comparativo' ? 'block' : 'hidden lg:block'}`}>
          <div>
            <h2 className="text-base font-semibold text-white">Comparação de Períodos</h2>
            <p className="text-xs text-zinc-400 mt-0.5 hidden sm:block">Desempenho atual vs período anterior</p>
          </div>

          <div className="divide-y divide-white/[0.06]">
            {/* Dia */}
            <div className="py-3 first:pt-1">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Hoje vs Ontem</span>
                {metrics.dayDelta !== null && (
                  <span className={`flex items-center gap-0.5 font-mono font-semibold ${metrics.dayDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {metrics.dayDelta >= 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                    {metrics.dayDelta >= 0 ? '+' : ''}{metrics.dayDelta.toFixed(1)}%
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-base font-bold font-mono tabular-nums text-white">{formatBRL(metrics.todayIn)}</span>
                <span className="text-xs font-mono tabular-nums text-zinc-500">ant: {formatBRL(metrics.yesterdayIn)}</span>
              </div>
            </div>

            {/* Semana */}
            <div className="py-3">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Últimos 7 dias vs 7 anteriores</span>
                {metrics.weekDelta !== null && (
                  <span className={`flex items-center gap-0.5 font-mono font-semibold ${metrics.weekDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {metrics.weekDelta >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                    {metrics.weekDelta >= 0 ? '+' : ''}{metrics.weekDelta.toFixed(1)}%
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-base font-bold font-mono tabular-nums text-white">{formatBRL(metrics.weekCurrentIn)}</span>
                <span className="text-xs font-mono tabular-nums text-zinc-500">ant: {formatBRL(metrics.weekPrevIn)}</span>
              </div>
            </div>

            {/* Mês */}
            <div className="py-3 last:pb-1">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Mês Atual vs Mês Anterior</span>
                {metrics.monthDelta !== null && (
                  <span className={`flex items-center gap-0.5 font-mono font-semibold ${metrics.monthDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {metrics.monthDelta >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                    {metrics.monthDelta >= 0 ? '+' : ''}{metrics.monthDelta.toFixed(1)}%
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-base font-bold font-mono tabular-nums text-white">{formatBRL(metrics.monthCurrentIn)}</span>
                <span className="text-xs font-mono tabular-nums text-zinc-500">ant: {formatBRL(metrics.monthPrevIn)}</span>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Latest Appointments Today */}
      <section className="rounded-[22px] apple-glass p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white">Últimos Atendimentos de Hoje</h2>
            <p className="text-xs text-zinc-400 mt-0.5 hidden sm:block">Registros vinculados diretamente ao caixa</p>
          </div>
          <button
            type="button"
            onClick={() => onQuickAction('appointment')}
            className="text-xs font-semibold text-[#D4AF37] hover:text-[#E6C65C] whitespace-nowrap min-h-[36px] px-2"
          >
            + Registrar
          </button>
        </div>

        {metrics.todayAppointments.length === 0 ? (
          <div className="py-6 sm:py-8 text-center">
            <p className="text-xs sm:text-sm text-zinc-400">Nenhum atendimento registrado hoje.</p>
            <button
              type="button"
              onClick={() => onQuickAction('appointment')}
              className="hidden sm:inline-flex mt-3 min-h-[44px] px-4 py-2 rounded-xl apple-btn-gold text-xs font-semibold items-center justify-center"
            >
              Registrar Primeiro Atendimento
            </button>
          </div>
        ) : (
          <div className="mt-4 divide-y divide-white/[0.06]">
            {metrics.todayAppointments.map((apt) => (
              <div key={apt.id} className="py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">
                    {apt.serviceName}
                    {apt.clientName ? ` — ${apt.clientName}` : ''}
                  </p>
                  <p className="text-xs text-zinc-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono">{apt.time}</span>
                    <span aria-hidden="true">·</span>
                    <span>{PAYMENT_LABELS[apt.paymentMethod]}</span>
                    <span aria-hidden="true">·</span>
                    <span>{apt.barberName}</span>
                  </p>
                </div>
                <span className="text-sm font-bold font-mono tabular-nums text-emerald-400 shrink-0">
                  {formatBRL(apt.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
