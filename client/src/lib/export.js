import { fdate } from './format';

const cell = (col, v) => {
  if (v == null) return '';
  if (col.type === 'date') return fdate(v);
  if (col.type === 'money' || col.type === 'number' || col.type === 'percent') return Number(v) || 0;
  return String(v);
};

export async function exportExcel({ title, columns, rows, totals }) {
  const XLSX = await import('xlsx');
  const data = rows.map((r) => Object.fromEntries(columns.map((c) => [c.label, cell(c, r[c.key])])));
  if (totals && Object.keys(totals).length) {
    data.push(Object.fromEntries(columns.map((c, i) => [c.label, i === 0 ? 'TOTAL' : totals[c.key] ?? ''])));
  }
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = columns.map((c) => ({ wch: Math.max(10, c.label.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  XLSX.writeFile(wb, `${title.replace(/[^\w-]+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export async function exportPdf({ title, subtitle, columns, rows, totals }) {
  const { jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF({ orientation: columns.length > 7 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  doc.setFontSize(14);
  doc.text(title, 40, 36);
  if (subtitle) {
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(subtitle, 40, 52);
  }
  const fmt = (c, v) => {
    if (v == null || v === '') return '';
    if (c.type === 'money') return (Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (c.type === 'date') return fdate(v);
    return String(v);
  };
  const body = rows.map((r) => columns.map((c) => fmt(c, r[c.key])));
  const foot = totals && Object.keys(totals).length ? [columns.map((c, i) => (i === 0 ? 'TOTAL' : totals[c.key] != null ? fmt(c, totals[c.key]) : ''))] : undefined;
  autoTable(doc, {
    startY: 64,
    head: [columns.map((c) => c.label.replace('₹', 'Rs.'))], // core PDF fonts have no rupee glyph
    body,
    foot,
    styles: { fontSize: 7.5, cellPadding: 3 },
    headStyles: { fillColor: [219, 39, 119] },
    footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: 'bold' },
    columnStyles: Object.fromEntries(columns.map((c, i) => [i, { halign: ['money', 'number', 'percent'].includes(c.type) ? 'right' : 'left' }])),
    // subtotal rows (e.g. "Day total") flagged with bold: true by the report
    didParseCell: (d) => { if (d.section === 'body' && rows[d.row.index]?.bold) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fillColor = [245, 245, 245]; } },
  });
  doc.save(`${title.replace(/[^\w-]+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`);
}
