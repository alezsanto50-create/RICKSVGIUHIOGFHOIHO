import React, { useMemo, useState } from 'react';
import type { Transaction } from '../types';
import { addDaysISO, formatBRL, formatShortDateBR, getMonthLabelBR, getTodayBR, getWeekdayShortBR } from '../lib/formatters';
import { useLocalDraft } from '../lib/storage';

interface RevenueChartProps {
  transactions: Transaction[];
}

interface ChartPoint {
  key: string;
  label: string;
  fullLabel: string;
  entradas: number;
  saidas: number;
  lucro: number;
}

export const RevenueChart: React.FC<RevenueChartProps> = ({ transactions }) => {
  const [period, setPeriod] = useLocalDraft<'semanal' | 'mensal'>('chart_period', 'semanal');
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const today = getTodayBR();

  const points: ChartPoint[] = useMemo(() => {
    if (period === 'semanal') {
      const list: ChartPoint[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = addDaysISO(today, -i);
        let entradas = 0;
        let saidas = 0;
        for (const t of transactions) {
          if (t.date === d) {
            if (t.type === 'entrada') entradas += t.amount;
            else saidas += t.amount;
          }
        }
        list.push({
          key: d,
          label: getWeekdayShortBR(d),
          fullLabel: `${getWeekdayShortBR(d)}, ${formatShortDateBR(d)}`,
          entradas,
          saidas,
          lucro: entradas - saidas,
        });
      }
      return list;
    }

    // Mensal: últimos 6 meses
    const [yearStr, monthStr] = today.split('-');
    const curYear = Number(yearStr);
    const curMonth = Number(monthStr);
    const list: ChartPoint[] = [];
    for (let i = 5; i >= 0; i--) {
      const dt = new Date(Date.UTC(curYear, curMonth - 1 - i, 1));
      const ym = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
      let entradas = 0;
      let saidas = 0;
      for (const t of transactions) {
        if (t.date.startsWith(ym)) {
          if (t.type === 'entrada') entradas += t.amount;
          else saidas += t.amount;
        }
      }
      const lbl = getMonthLabelBR(ym);
      list.push({
        key: ym,
        label: lbl,
        fullLabel: lbl.toUpperCase(),
        entradas,
        saidas,
        lucro: entradas - saidas,
      });
    }
    return list;
  }, [transactions, period, today]);

  const maxVal = useMemo(() => {
    const rawMax = points.reduce((acc, p) => Math.max(acc, p.entradas, p.saidas), 0);
    return rawMax > 0 ? rawMax * 1.15 : 500;
  }, [points]);

  const selectedPoint = activeIndex !== null ? points[activeIndex] : points[points.length - 1];

  return (
    <section className="rounded-[22px] apple-glass p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">Evolução Financeira</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            {period === 'semanal' ? 'Entradas e despesas dos últimos 7 dias' : 'Consolidado mensal dos últimos 6 meses'}
          </p>
        </div>

        <div className="relative grid grid-cols-2 p-1 rounded-2xl apple-glass-well self-start sm:self-auto w-44">
          <div
            aria-hidden="true"
            className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-xl apple-btn-gold pointer-events-none transition-transform duration-300 ease-[cubic-bezier(0.32,1.25,0.36,1)]"
            style={{ transform: `translateX(${period === 'mensal' ? '100%' : '0%'})` }}
          />
          <button
            type="button"
            onClick={() => {
              setPeriod('semanal');
              setActiveIndex(null);
            }}
            className={`relative z-10 px-3.5 py-2 text-xs font-semibold rounded-xl apple-tab-spring whitespace-nowrap min-h-[36px] ${
              period === 'semanal' ? 'text-[#09090B]' : 'text-zinc-300/85 hover:text-white'
            }`}
          >
            Semanal
          </button>
          <button
            type="button"
            onClick={() => {
              setPeriod('mensal');
              setActiveIndex(null);
            }}
            className={`relative z-10 px-3.5 py-2 text-xs font-semibold rounded-xl apple-tab-spring whitespace-nowrap min-h-[36px] ${
              period === 'mensal' ? 'text-[#09090B]' : 'text-zinc-300/85 hover:text-white'
            }`}
          >
            Mensal
          </button>
        </div>
      </div>

      {/* Selected Bar Readout */}
      {selectedPoint && (
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 py-2.5 border-y border-white/[0.06] text-xs">
          <span className="font-semibold text-[#E6C65C]">{selectedPoint.fullLabel}</span>
          <span className="text-zinc-400">
            Entradas: <strong className="font-mono tabular-nums text-emerald-400">{formatBRL(selectedPoint.entradas)}</strong>
          </span>
          <span className="text-zinc-400">
            Despesas: <strong className="font-mono tabular-nums text-rose-400">{formatBRL(selectedPoint.saidas)}</strong>
          </span>
          <span className="text-zinc-400">
            Resultado: <strong className="font-mono tabular-nums text-white">{formatBRL(selectedPoint.lucro)}</strong>
          </span>
        </div>
      )}

      {/* Interactive Chart */}
      <div className="mt-5 h-52 flex items-end justify-between gap-2 sm:gap-3 pt-4">
        {points.map((pt, idx) => {
          const hIn = Math.max(4, Math.round((pt.entradas / maxVal) * 148));
          const hOut = pt.saidas > 0 ? Math.max(4, Math.round((pt.saidas / maxVal) * 148)) : 0;
          const isSelected = activeIndex === idx || (activeIndex === null && idx === points.length - 1);

          return (
            <button
              key={pt.key}
              type="button"
              onClick={() => setActiveIndex(idx)}
              onMouseEnter={() => setActiveIndex(idx)}
              className={`flex-1 flex flex-col items-center justify-end h-full rounded-2xl py-2 px-1 apple-tab-spring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${
                isSelected
                  ? 'bg-white/[0.09] shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]'
                  : 'hover:bg-white/[0.05]'
              }`}
            >
              <div className="w-full flex items-end justify-center gap-1 h-[152px]">
                <div
                  className={`w-3 sm:w-4 rounded-t-md transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                    isSelected ? 'bg-[#E6C65C] shadow-[0_0_14px_rgba(230,198,92,0.4)]' : 'bg-[#D4AF37]/80'
                  }`}
                  style={{ height: `${pt.entradas > 0 ? hIn : 4}px` }}
                  title={`Entradas: ${formatBRL(pt.entradas)}`}
                />
                {pt.saidas > 0 && (
                  <div
                    className="w-2.5 sm:w-3 rounded-t-md bg-rose-500/80 transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
                    style={{ height: `${hOut}px` }}
                    title={`Despesas: ${formatBRL(pt.saidas)}`}
                  />
                )}
              </div>
              <span className={`mt-2 text-[11px] font-medium whitespace-nowrap ${isSelected ? 'text-[#E6C65C]' : 'text-zinc-400'}`}>
                {pt.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-3 flex items-center gap-5 text-xs text-zinc-400">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-[#D4AF37]" />
          Entradas
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-rose-500/80" />
          Despesas
        </span>
      </div>
    </section>
  );
};
