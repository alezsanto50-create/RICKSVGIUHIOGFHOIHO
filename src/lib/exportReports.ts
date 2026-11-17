import { PAYMENT_LABELS, type CashClosing, type PaymentMethod, type Transaction } from '../types';
import { formatBRL, formatDateBR } from './formatters';

export interface ReportExportPayload {
  title: string;
  periodLabel: string;
  totalRevenue: number;
  totalExpenses: number;
  estimatedProfit: number;
  appointmentsCount: number;
  paymentBreakdown: Array<{ method: PaymentMethod; total: number; count: number }>;
  topServices: Array<{ name: string; count: number; total: number }>;
  transactions: Transaction[];
}

export function exportReportCSV(payload: ReportExportPayload) {
  const lines: string[] = [];
  lines.push(`"Barbearia Trindade - ${payload.title}"`);
  lines.push(`"Período";"${payload.periodLabel}"`);
  lines.push(`"Faturamento";"${payload.totalRevenue.toFixed(2).replace('.', ',')}"`);
  lines.push(`"Despesas";"${payload.totalExpenses.toFixed(2).replace('.', ',')}"`);
  lines.push(`"Lucro Estimado";"${payload.estimatedProfit.toFixed(2).replace('.', ',')}"`);
  lines.push(`"Atendimentos";"${payload.appointmentsCount}"`);
  lines.push('');
  lines.push('"Data";"Hora";"Tipo";"Categoria";"Descrição";"Pagamento";"Valor (R$)"');

  for (const tx of payload.transactions) {
    const tipo = tx.type === 'entrada' ? 'Entrada' : 'Saída';
    const pag = PAYMENT_LABELS[tx.paymentMethod] || tx.paymentMethod;
    const val = tx.amount.toFixed(2).replace('.', ',');
    const clean = (s: string) => `"${String(s || '').replace(/"/g, '""')}"`;
    lines.push([clean(formatDateBR(tx.date)), clean(tx.time), clean(tipo), clean(tx.category), clean(tx.description), clean(pag), clean(val)].join(';'));
  }

  const csvContent = '\uFEFF' + lines.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `barbearia-trindade-relatorio-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function exportReportPDF(payload: ReportExportPayload) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Header band
  doc.setFillColor(12, 12, 16);
  doc.rect(0, 0, 210, 34, 'F');
  doc.setTextColor(212, 175, 55);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text('BARBEARIA TRINDADE', 14, 15);
  doc.setTextColor(228, 228, 231);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`${payload.title} · Período: ${payload.periodLabel}`, 14, 23);
  doc.setFontSize(8.5);
  doc.setTextColor(161, 161, 170);
  doc.text(`Emitido em ${new Date().toLocaleString('pt-BR')}`, 14, 29);

  // Summary KPIs
  autoTable(doc, {
    startY: 40,
    head: [['Faturamento', 'Despesas', 'Lucro Estimado', 'Atendimentos']],
    body: [[
      formatBRL(payload.totalRevenue),
      formatBRL(payload.totalExpenses),
      formatBRL(payload.estimatedProfit),
      String(payload.appointmentsCount),
    ]],
    theme: 'grid',
    headStyles: { fillColor: [24, 24, 30], textColor: [212, 175, 55], fontStyle: 'bold' },
    bodyStyles: { textColor: [24, 24, 27], fontSize: 10, fontStyle: 'bold' },
    margin: { left: 14, right: 14 },
  });

  // Payment methods + Top Services side summary
  const afterKpiY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  autoTable(doc, {
    startY: afterKpiY,
    head: [['Forma de Pagamento', 'Qtd.', 'Total Recebido']],
    body: payload.paymentBreakdown.map((p) => [PAYMENT_LABELS[p.method], String(p.count), formatBRL(p.total)]),
    theme: 'striped',
    headStyles: { fillColor: [30, 30, 38], textColor: [255, 255, 255] },
    margin: { left: 14, right: 14 },
  });

  if (payload.topServices.length > 0) {
    const afterPayY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
    autoTable(doc, {
      startY: afterPayY,
      head: [['Serviços Mais Vendidos', 'Atendimentos', 'Faturamento']],
      body: payload.topServices.map((s) => [s.name, String(s.count), formatBRL(s.total)]),
      theme: 'striped',
      headStyles: { fillColor: [30, 30, 38], textColor: [255, 255, 255] },
      margin: { left: 14, right: 14 },
    });
  }

  const afterSrvY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  autoTable(doc, {
    startY: afterSrvY,
    head: [['Data', 'Hora', 'Tipo', 'Categoria', 'Descrição', 'Pagamento', 'Valor']],
    body: payload.transactions.slice(0, 120).map((t) => [
      formatDateBR(t.date),
      t.time,
      t.type === 'entrada' ? 'Entrada' : 'Saída',
      t.category,
      t.description,
      PAYMENT_LABELS[t.paymentMethod],
      formatBRL(t.amount),
    ]),
    theme: 'striped',
    styles: { fontSize: 8 },
    headStyles: { fillColor: [24, 24, 30], textColor: [212, 175, 55] },
    margin: { left: 14, right: 14 },
  });

  doc.save(`barbearia-trindade-relatorio-${new Date().toISOString().slice(0, 10)}.pdf`);
}

export async function exportCashClosingPDF(closing: CashClosing) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  doc.setFillColor(12, 12, 16);
  doc.rect(0, 0, 210, 34, 'F');
  doc.setTextColor(212, 175, 55);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text('BARBEARIA TRINDADE — FECHAMENTO DIÁRIO', 14, 15);
  doc.setTextColor(228, 228, 231);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Data do Caixa: ${formatDateBR(closing.date)} · Responsável: ${closing.closedBy}`, 14, 24);

  autoTable(doc, {
    startY: 42,
    head: [['Indicador do Caixa', 'Valor']],
    body: [
      ['Saldo Inicial do Dia', formatBRL(closing.openingBalance)],
      ['Total Recebido (Entradas)', formatBRL(closing.totalReceived)],
      ['  • Total em Dinheiro', formatBRL(closing.totalCash)],
      ['  • Total em PIX', formatBRL(closing.totalPix)],
      ['  • Total em Cartão (Débito + Crédito)', formatBRL(closing.totalCard)],
      ['     - Cartão de Débito', formatBRL(closing.totalDebit)],
      ['     - Cartão de Crédito', formatBRL(closing.totalCredit)],
      ['Total de Despesas (Saídas)', formatBRL(closing.totalExpenses)],
      ['Saldo Final em Caixa', formatBRL(closing.finalBalance)],
      ['Dinheiro Contado na Gaveta', closing.countedCash !== null ? formatBRL(closing.countedCash) : 'Não informado'],
      ['Atendimentos Realizados', String(closing.appointmentsCount)],
      ['Observações', closing.notes || 'Sem observações'],
    ],
    theme: 'grid',
    headStyles: { fillColor: [24, 24, 30], textColor: [212, 175, 55] },
    styles: { fontSize: 10 },
    margin: { left: 14, right: 14 },
  });

  doc.save(`fechamento-caixa-${closing.date}.pdf`);
}
