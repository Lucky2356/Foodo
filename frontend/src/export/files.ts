import type { ExportModel } from './model';
import { safeText, toBuyRows } from './model';

function isoToDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

/** XLSX with sheets «Меню», «Покупки», «Готовка»: real date cells and numeric quantities. */
export async function buildXlsx(model: ExportModel): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Foodo';
  wb.created = new Date();

  const menu = wb.addWorksheet('Меню');
  menu.columns = [
    { header: 'Дата', key: 'date', width: 12, style: { numFmt: 'dd.mm.yyyy' } },
    { header: 'День', key: 'weekday', width: 14 },
    { header: 'Приём пищи', key: 'slot', width: 13 },
    { header: 'Блюдо', key: 'dish', width: 40 },
    { header: 'Для кого (порции)', key: 'who', width: 34 },
    { header: 'Всего порций', key: 'portions', width: 13, style: { numFmt: 'General' } },
  ];
  for (const r of model.menu) menu.addRow({ ...r, date: isoToDate(r.date), dish: safeText(r.dish), who: safeText(r.who) });

  const shop = wb.addWorksheet('Покупки');
  shop.columns = [
    { header: 'Отдел', key: 'department', width: 22 },
    { header: 'Продукт', key: 'name', width: 34 },
    { header: 'Нужно', key: 'needed', width: 10, style: { numFmt: 'General' } },
    { header: 'Есть дома', key: 'fromPantry', width: 11, style: { numFmt: 'General' } },
    { header: 'Купить', key: 'toBuy', width: 10, style: { numFmt: 'General' } },
    { header: 'Ед.', key: 'unit', width: 7 },
    { header: 'Упаковок', key: 'packages', width: 10 },
    { header: 'Упаковка', key: 'packageSize', width: 12 },
    { header: 'Цена, ₽', key: 'pricePerPackageRub', width: 12, style: { numFmt: '#,##0.00' } },
    { header: 'Цена за', key: 'priceFor', width: 10 },
    { header: 'Сумма, ₽', key: 'costRub', width: 12, style: { numFmt: '#,##0.00' } },
    { header: 'Источник цены', key: 'priceSource', width: 30 },
    { header: 'Отметка', key: 'mark', width: 12 },
  ];
  for (const r of toBuyRows(model)) shop.addRow({ ...r, name: safeText(r.name), department: safeText(r.department), priceSource: safeText(r.priceSource) });
  shop.addRow({});
  shop.addRow(model.totals.purchaseRub !== null ? { name: 'Итого на кассе (известные цены)', costRub: model.totals.purchaseRub } : { name: 'Итого на кассе: цены неизвестны' });
  shop.addRow({ name: model.totals.complete ? 'Все цены известны' : 'Итог неполный: не для всех продуктов известна цена', priceSource: model.totals.budget });

  const cook = wb.addWorksheet('Готовка');
  cook.columns = [
    { header: 'Дата готовки', key: 'date', width: 13, style: { numFmt: 'dd.mm.yyyy' } },
    { header: 'Блюдо', key: 'dish', width: 40 },
    { header: 'Способ', key: 'method', width: 22 },
    { header: 'Порций в партии', key: 'portions', width: 15, style: { numFmt: 'General' } },
    { header: 'Время, мин', key: 'totalMin', width: 11 },
    { header: 'На какие приёмы пищи', key: 'feeds', width: 50 },
  ];
  for (const r of model.cooking) cook.addRow({ ...r, date: isoToDate(r.date), dish: safeText(r.dish) });

  for (const ws of [menu, shop, cook]) {
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

async function fontBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Не удалось загрузить шрифт для PDF.');
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function ru(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** Printable PDF with embedded DejaVu Sans so Cyrillic renders everywhere. */
export async function buildPdf(model: ExportModel, fontBase = 'fonts/'): Promise<Blob> {
  const [{ jsPDF }, autoTable] = await Promise.all([import('jspdf'), import('jspdf-autotable').then((m) => m.default)]);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.addFileToVFS('DejaVuSans.ttf', await fontBase64(`${fontBase}DejaVuSans.ttf`));
  doc.addFont('DejaVuSans.ttf', 'DejaVu', 'normal');
  doc.addFileToVFS('DejaVuSans-Bold.ttf', await fontBase64(`${fontBase}DejaVuSans-Bold.ttf`));
  doc.addFont('DejaVuSans-Bold.ttf', 'DejaVu', 'bold');
  doc.setFont('DejaVu', 'bold');
  doc.setFontSize(18);
  doc.text(model.title, 40, 50);
  doc.setFont('DejaVu', 'normal');
  doc.setFontSize(10);
  doc.text(`Foodo · ${ru(model.generatedOn)}`, 40, 68);
  const common = { styles: { font: 'DejaVu', fontSize: 9, cellPadding: 4 }, headStyles: { font: 'DejaVu', fontStyle: 'bold' as const, fillColor: [46, 106, 78] as [number, number, number] } };
  autoTable(doc, { ...common, startY: 84, head: [['Дата', 'Приём пищи', 'Блюдо', 'Для кого (порции)']], body: model.menu.map((r) => [`${ru(r.date)}, ${r.weekday}`, r.slot, r.dish, r.who]) });
  doc.addPage();
  doc.setFont('DejaVu', 'bold');
  doc.setFontSize(16);
  doc.text('Покупки', 40, 50);
  autoTable(doc, {
    ...common,
    startY: 64,
    head: [['', 'Продукт', 'Купить', 'Упаковки', 'Сумма, ₽']],
    body: toBuyRows(model).map((r) => [
      r.mark ? '✓' : '☐',
      `${r.name}${r.department ? `\n${r.department}` : ''}`,
      r.toBuyText,
      r.packages ? `${r.packages} × ${r.packageSize}` : '',
      r.costRub !== null ? r.costRub.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'нет цены',
    ]),
  });
  const y = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 80;
  doc.setFont('DejaVu', 'normal');
  doc.setFontSize(10);
  doc.text(`Итого (известные цены): ${model.totals.purchaseText} — ${model.totals.complete ? 'все цены известны' : 'итог неполный'}; ${model.totals.budget}.`, 40, y + 20, { maxWidth: 515 });
  doc.addPage();
  doc.setFont('DejaVu', 'bold');
  doc.setFontSize(16);
  doc.text('Готовка', 40, 50);
  autoTable(doc, { ...common, startY: 64, head: [['Дата', 'Блюдо', 'Порций', 'Время', 'На какие приёмы пищи']], body: model.cooking.map((r) => [ru(r.date), `${r.dish}\n${r.method}`, String(r.portions), r.totalMin !== null ? `${r.totalMin} мин` : '', r.feeds]) });
  return doc.output('blob');
}
