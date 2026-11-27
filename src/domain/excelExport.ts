import {
  calculateProfitAndLoss,
  ENCARGO_STAGES,
  EXPENSE_CATEGORIES,
  getBranchDisplayName,
  getBranchExpenses,
  getBranchInfo,
  getBranchSupplies,
  getCustomerOrders,
  getGlobalAdminTotals,
  getOrderLineItems,
  getOrderPaymentLines,
  getOrderPendingCents,
  getShiftMetrics,
} from './rules';
import type { BranchId, Customer, DemoState, ExpenseCategory, Order, Shift } from './types';

export type ExcelCell =
  | string
  | number
  | null
  | undefined
  | { value: string | number; format?: 'text' | 'currency' | 'integer' | 'decimal' };

export interface ExcelSheet {
  name: string;
  headers: string[];
  rows: ExcelCell[][];
}

const encoder = new TextEncoder();

// Standard IEEE 802.3 CRC-32 lookup table
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeU16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value & 0xffff, true);
}

function writeU32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

function buildZip(files: Array<{ name: string; content: string | Uint8Array }>): Uint8Array {
  const entries = files.map((file) => {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = typeof file.content === 'string' ? encoder.encode(file.content) : file.content;
    return {
      nameBytes,
      dataBytes,
      crc: crc32(dataBytes),
      offset: 0,
    };
  });

  const now = new Date();
  const dosTime =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((Math.floor(now.getSeconds() / 2)) & 0x1f);
  const dosDate =
    (((Math.max(1980, now.getFullYear()) - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0x0f) << 5) |
    (now.getDate() & 0x1f);

  let localSize = 0;
  let centralSize = 0;
  for (const entry of entries) {
    entry.offset = localSize;
    localSize += 30 + entry.nameBytes.length + entry.dataBytes.length;
    centralSize += 46 + entry.nameBytes.length;
  }

  const totalSize = localSize + centralSize + 22;
  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer);
  let pos = 0;

  // Local file headers + data
  for (const entry of entries) {
    writeU32(view, pos, 0x04034b50); // signature
    writeU16(view, pos + 4, 20); // version needed
    writeU16(view, pos + 6, 0x0800); // UTF-8 flag
    writeU16(view, pos + 8, 0); // store (uncompressed)
    writeU16(view, pos + 10, dosTime);
    writeU16(view, pos + 12, dosDate);
    writeU32(view, pos + 14, entry.crc);
    writeU32(view, pos + 18, entry.dataBytes.length);
    writeU32(view, pos + 22, entry.dataBytes.length);
    writeU16(view, pos + 26, entry.nameBytes.length);
    writeU16(view, pos + 28, 0); // extra length
    pos += 30;
    buffer.set(entry.nameBytes, pos);
    pos += entry.nameBytes.length;
    buffer.set(entry.dataBytes, pos);
    pos += entry.dataBytes.length;
  }

  const centralOffset = pos;
  // Central directory headers
  for (const entry of entries) {
    writeU32(view, pos, 0x02014b50); // signature
    writeU16(view, pos + 4, 20); // version made by
    writeU16(view, pos + 6, 20); // version needed
    writeU16(view, pos + 8, 0x0800); // UTF-8 flag
    writeU16(view, pos + 10, 0); // store
    writeU16(view, pos + 12, dosTime);
    writeU16(view, pos + 14, dosDate);
    writeU32(view, pos + 16, entry.crc);
    writeU32(view, pos + 20, entry.dataBytes.length);
    writeU32(view, pos + 24, entry.dataBytes.length);
    writeU16(view, pos + 28, entry.nameBytes.length);
    writeU16(view, pos + 30, 0); // extra
    writeU16(view, pos + 32, 0); // comment
    writeU16(view, pos + 34, 0); // disk
    writeU16(view, pos + 36, 0); // internal attr
    writeU32(view, pos + 38, 0); // external attr
    writeU32(view, pos + 42, entry.offset);
    pos += 46;
    buffer.set(entry.nameBytes, pos);
    pos += entry.nameBytes.length;
  }

  // End of central directory
  writeU32(view, pos, 0x06054b50);
  writeU16(view, pos + 4, 0);
  writeU16(view, pos + 6, 0);
  writeU16(view, pos + 8, entries.length);
  writeU16(view, pos + 10, entries.length);
  writeU32(view, pos + 12, centralSize);
  writeU32(view, pos + 16, centralOffset);
  writeU16(view, pos + 20, 0);

  return buffer;
}

function escapeXml(raw: string): string {
  return raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colIndexToLetter(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function sanitizeSheetName(name: string, index: number): string {
  const cleaned = name.replace(/[\\/*?:[\]]/g, '').trim().slice(0, 31);
  return cleaned || `Hoja${index + 1}`;
}

function normalizeCell(cell: ExcelCell): { type: 's' | 'n'; value: string | number; style: number; displayLength: number } {
  if (cell === null || cell === undefined) {
    return { type: 's', value: '', style: 0, displayLength: 0 };
  }
  if (typeof cell === 'number') {
    const safe = Number.isFinite(cell) ? cell : 0;
    const isInt = Number.isInteger(safe);
    return { type: 'n', value: safe, style: isInt ? 3 : 4, displayLength: String(safe).length + 2 };
  }
  if (typeof cell === 'string') {
    return { type: 's', value: cell, style: 0, displayLength: cell.length };
  }
  const { value, format } = cell;
  if (typeof value === 'number' && format !== 'text') {
    const safe = Number.isFinite(value) ? value : 0;
    const style = format === 'currency' ? 2 : format === 'integer' ? 3 : 4;
    const extra = format === 'currency' ? 6 : 2;
    return { type: 'n', value: safe, style, displayLength: safe.toFixed(format === 'integer' ? 0 : 2).length + extra };
  }
  const str = String(value);
  return { type: 's', value: str, style: 0, displayLength: str.length };
}

function buildWorksheetXml(sheet: ExcelSheet): string {
  const colWidths = sheet.headers.map((h) => Math.max(10, h.length + 3));
  const rowXmls: string[] = [];

  // Header row (style 1: bold white on HOREB green)
  const headerCells = sheet.headers
    .map((header, colIdx) => {
      const ref = `${colIndexToLetter(colIdx)}1`;
      return `<c r="${ref}" t="inlineStr" s="1"><is><t>${escapeXml(header)}</t></is></c>`;
    })
    .join('');
  rowXmls.push(`<row r="1" ht="24" customHeight="1">${headerCells}</row>`);

  sheet.rows.forEach((row, rowIdx) => {
    const r = rowIdx + 2;
    const cellsXml = sheet.headers
      .map((_, colIdx) => {
        const norm = normalizeCell(row[colIdx]);
        colWidths[colIdx] = Math.min(44, Math.max(colWidths[colIdx], norm.displayLength + 2));
        const ref = `${colIndexToLetter(colIdx)}${r}`;
        if (norm.type === 'n') {
          return `<c r="${ref}" s="${norm.style}"><v>${norm.value}</v></c>`;
        }
        return `<c r="${ref}" t="inlineStr" s="${norm.style}"><is><t xml:space="preserve">${escapeXml(String(norm.value))}</t></is></c>`;
      })
      .join('');
    rowXmls.push(`<row r="${r}">${cellsXml}</row>`);
  });

  const colsXml = colWidths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join('');

  const lastCol = colIndexToLetter(Math.max(0, sheet.headers.length - 1));
  const lastRow = sheet.rows.length + 1;
  const autoFilter = sheet.headers.length > 0 ? `<autoFilter ref="A1:${lastCol}${lastRow}"/>` : '';

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${colsXml}</cols>` +
    `<sheetData>${rowXmls.join('')}</sheetData>` +
    `${autoFilter}` +
    `</worksheet>`
  );
}

const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts>` +
  `<fonts count="2">` +
  `<font><sz val="11"/><name val="Calibri"/><color rgb="FF172B23"/></font>` +
  `<font><b/><sz val="11"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font>` +
  `</fonts>` +
  `<fills count="3">` +
  `<fill><patternFill patternType="none"/></fill>` +
  `<fill><patternFill patternType="gray125"/></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FF245640"/><bgColor indexed="64"/></patternFill></fill>` +
  `</fills>` +
  `<borders count="2">` +
  `<border><left/><right/><top/><bottom/><diagonal/></border>` +
  `<border><left style="thin"><color rgb="FFD0D8D0"/></left><right style="thin"><color rgb="FFD0D8D0"/></right><top style="thin"><color rgb="FFD0D8D0"/></top><bottom style="thin"><color rgb="FFD0D8D0"/></bottom><diagonal/></border>` +
  `</borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="5">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` + // 0: text
  `<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>` + // 1: header
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` + // 2: currency MXN
  `<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` + // 3: integer
  `<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` + // 4: decimal
  `</cellXfs>` +
  `</styleSheet>`;

export function buildXlsxBytes(sheets: ExcelSheet[]): Uint8Array {
  const safeSheets = sheets.length > 0 ? sheets : [{ name: 'Datos', headers: ['Sin datos'], rows: [] }];
  const usedNames = new Set<string>();
  const normalizedSheets = safeSheets.map((sheet, idx) => {
    let base = sanitizeSheetName(sheet.name, idx);
    let candidate = base;
    let suffix = 2;
    while (usedNames.has(candidate.toLowerCase())) {
      candidate = `${base.slice(0, 28)} ${suffix++}`;
    }
    usedNames.add(candidate.toLowerCase());
    return { ...sheet, name: candidate };
  });

  const sheetOverrides = normalizedSheets
    .map(
      (_, idx) =>
        `<Override PartName="/xl/worksheets/sheet${idx + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('');

  const contentTypesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `${sheetOverrides}` +
    `</Types>`;

  const rootRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const workbookSheetsXml = normalizedSheets
    .map(
      (sheet, idx) =>
        `<sheet name="${escapeXml(sheet.name)}" sheetId="${idx + 1}" r:id="rId${idx + 1}"/>`,
    )
    .join('');

  const workbookXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>${workbookSheetsXml}</sheets>` +
    `</workbook>`;

  const workbookRelsEntries = [
    ...normalizedSheets.map(
      (_, idx) =>
        `<Relationship Id="rId${idx + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${idx + 1}.xml"/>`,
    ),
    `<Relationship Id="rId${normalizedSheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
  ].join('');

  const workbookRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `${workbookRelsEntries}` +
    `</Relationships>`;

  const zipFiles: Array<{ name: string; content: string }> = [
    { name: '[Content_Types].xml', content: contentTypesXml },
    { name: '_rels/.rels', content: rootRelsXml },
    { name: 'xl/workbook.xml', content: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', content: workbookRelsXml },
    { name: 'xl/styles.xml', content: STYLES_XML },
    ...normalizedSheets.map((sheet, idx) => ({
      name: `xl/worksheets/sheet${idx + 1}.xml`,
      content: buildWorksheetXml(sheet),
    })),
  ];

  return buildZip(zipFiles);
}

export function downloadXlsx(filename: string, sheets: ExcelSheet[]) {
  const bytes = buildXlsxBytes(sheets);
  const blob = new Blob([bytes.buffer as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/* ---------------- HOREB 360 Domain Sheet Builders ---------------- */

const mxn = (cents: number): ExcelCell => ({ value: Number((cents / 100).toFixed(2)), format: 'currency' });
const int = (n: number): ExcelCell => ({ value: n, format: 'integer' });
const txt = (s: string | null | undefined): ExcelCell => ({ value: s ?? '', format: 'text' });

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-MX');
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('es-MX', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function slugDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function buildOrdersSheet(state: DemoState, orders: Order[]): ExcelSheet {
  const stageMap = Object.fromEntries(ENCARGO_STAGES.map((s) => [s.id, s.label]));
  return {
    name: 'Órdenes',
    headers: [
      'Folio',
      'Fecha y hora',
      'Sucursal',
      'Servicio',
      'Etapa',
      'Cliente',
      'Teléfono',
      'Conceptos',
      'Total MXN',
      'Confirmado MXN',
      'Pendiente MXN',
      'Efectivo MXN',
      'Tarjeta MXN',
      'Transferencia MXN',
      'Ticket',
    ],
    rows: orders.map((order) => {
      const lines = getOrderPaymentLines(state, order.id);
      const pendingCents = getOrderPendingCents(state, order.id);
      const confirmedCents = lines
        .filter((l) => l.status === 'confirmado')
        .reduce((sum, l) => sum + l.amountCents, 0);
      const cashCents = lines
        .filter((l) => l.status === 'confirmado' && l.method === 'efectivo')
        .reduce((sum, l) => sum + l.amountCents, 0);
      const cardCents = lines
        .filter((l) => l.status === 'confirmado' && l.method === 'tarjeta')
        .reduce((sum, l) => sum + l.amountCents, 0);
      const transferCents = lines
        .filter((l) => l.status === 'confirmado' && l.method === 'transferencia')
        .reduce((sum, l) => sum + l.amountCents, 0);
      const itemsSummary = getOrderLineItems(order)
        .map((it) => `${it.quantity}x ${it.name}`)
        .join(', ');
      const ticketStatus = state.tickets[order.id]?.status ?? 'no_emitido';
      const ticketLabel =
        ticketStatus === 'emitido' ? 'Emitido' : ticketStatus === 'fallo' ? 'Falló' : 'Sin emitir';

      return [
        txt(order.folio),
        txt(fmtDateTime(order.createdAt)),
        txt(getBranchInfo(order.branchId).name),
        txt(order.serviceType === 'encargo' ? 'Encargo' : 'Autoservicio'),
        txt(order.encargoStage ? (stageMap[order.encargoStage] ?? order.encargoStage) : 'Autoservicio'),
        txt(order.customerAlias || 'Mostrador'),
        txt(order.customerPhone ?? ''),
        txt(itemsSummary),
        mxn(order.totalCents),
        mxn(confirmedCents),
        mxn(pendingCents),
        mxn(cashCents),
        mxn(cardCents),
        mxn(transferCents),
        txt(ticketLabel),
      ];
    }),
  };
}

export function buildShiftsSheets(state: DemoState, shifts: Shift[]): ExcelSheet[] {
  const shiftsSheet: ExcelSheet = {
    name: 'Turnos',
    headers: [
      'Sucursal',
      'Turno',
      'Estado',
      'Apertura',
      'Cierre',
      'Fondo inicial MXN',
      'Efectivo esperado MXN',
      'Efectivo contado MXN',
      'Diferencia MXN',
      'Tarjeta MXN',
      'Transferencia MXN',
      'Pendiente MXN',
      'Total confirmado MXN',
    ],
    rows: shifts.map((shift) => {
      const m = getShiftMetrics(state, shift.id);
      return [
        txt(getBranchInfo(shift.branchId).name),
        txt(`#${shift.number}`),
        txt(shift.status === 'abierto' ? 'Abierto' : 'Cerrado'),
        txt(fmtDateTime(shift.openedAt)),
        txt(fmtDateTime(shift.closedAt)),
        mxn(shift.openingCashCents ?? 0),
        mxn(m.expectedCashCents),
        shift.status === 'cerrado' ? mxn(m.countedCashCents) : txt('—'),
        shift.status === 'cerrado' ? mxn(m.differenceCents) : txt('—'),
        mxn(m.confirmedCardCents),
        mxn(m.confirmedTransferCents),
        mxn(m.pendingBalanceCents),
        mxn(m.totalConfirmedCents),
      ];
    }),
  };

  const movementRows: ExcelCell[][] = [];
  for (const shift of shifts) {
    for (const mov of shift.cashMovements ?? []) {
      movementRows.push([
        txt(getBranchInfo(shift.branchId).name),
        txt(`#${shift.number}`),
        txt(mov.kind === 'entrada' ? 'Entrada' : 'Retiro'),
        txt(mov.reason),
        mxn(mov.amountCents),
        txt(fmtDateTime(mov.createdAt)),
      ]);
    }
  }

  const movementsSheet: ExcelSheet = {
    name: 'Movimientos caja',
    headers: ['Sucursal', 'Turno', 'Tipo', 'Motivo', 'Monto MXN', 'Fecha y hora'],
    rows: movementRows,
  };

  return [shiftsSheet, movementsSheet];
}

export function buildCustomersSheet(state: DemoState, customers: Customer[]): ExcelSheet {
  const raffleTickets = state.raffleTickets ?? [];
  return {
    name: 'Clientes',
    headers: [
      'Nombre',
      'Teléfono',
      'Consentimiento WhatsApp',
      'Combos avance (10+1)',
      'Combos gratis',
      'Boletos rifa',
      'Órdenes',
      'Total consumido MXN',
      'Alta',
    ],
    rows: customers.map((customer) => {
      const orders = getCustomerOrders(state, customer.id);
      const totalSpentCents = orders.reduce((sum, o) => sum + o.totalCents, 0);
      const ticketCount = raffleTickets.filter((t) => t.customerId === customer.id).length;
      return [
        txt(customer.name),
        txt(customer.phone),
        txt(customer.contactConsent ? 'Sí' : 'No'),
        int(customer.combosTowardFree),
        int(customer.freeCombosAvailable),
        int(ticketCount),
        int(orders.length),
        mxn(totalSpentCents),
        txt(fmtDate(customer.createdAt)),
      ];
    }),
  };
}

export function exportOrdersToExcel(state: DemoState, orders: Order[], branchSlug: string) {
  downloadXlsx(`horeb360-ordenes-${branchSlug}-${slugDate()}.xlsx`, [
    buildOrdersSheet(state, orders),
  ]);
}

export function exportShiftsToExcel(state: DemoState, shifts: Shift[], branchSlug: string) {
  downloadXlsx(`horeb360-caja-${branchSlug}-${slugDate()}.xlsx`, buildShiftsSheets(state, shifts));
}

export function exportCustomersToExcel(state: DemoState, customers: Customer[]) {
  downloadXlsx(`horeb360-clientes-${slugDate()}.xlsx`, [buildCustomersSheet(state, customers)]);
}

export function exportAdminConsolidatedToExcel(state: DemoState, branches: BranchId[]) {
  const { byBranch, totals } = getGlobalAdminTotals(state, branches);
  const summarySheet: ExcelSheet = {
    name: 'Resumen Sucursales',
    headers: [
      'Sucursal',
      'Turno activo',
      'Folios',
      'Efectivo MXN',
      'Tarjeta MXN',
      'Transferencia MXN',
      'Pendiente MXN',
      'Total confirmado MXN',
    ],
    rows: [
      ...byBranch.map((row) => [
        txt(row.branch.name),
        txt(row.openShiftNumber ? `Turno #${row.openShiftNumber}` : 'Cerrada'),
        int(row.orderCount),
        mxn(row.cashCents),
        mxn(row.cardCents),
        mxn(row.transferCents),
        mxn(row.pendingCents),
        mxn(row.totalConfirmedCents),
      ]),
      [
        txt('TOTAL GENERAL'),
        txt('—'),
        int(totals.orderCount),
        mxn(totals.cashCents),
        mxn(totals.cardCents),
        mxn(totals.transferCents),
        mxn(totals.pendingCents),
        mxn(totals.totalConfirmedCents),
      ],
    ],
  };

  const allowedSet = new Set(branches);
  const orders = state.orders.filter((o) => allowedSet.has(o.branchId));
  const shifts = state.shifts.filter((s) => allowedSet.has(s.branchId));
  const customers = state.customers ?? [];

  downloadXlsx(`horeb360-reporte-ejecutivo-${slugDate()}.xlsx`, [
    summarySheet,
    buildOrdersSheet(state, orders),
    ...buildShiftsSheets(state, shifts),
    buildCustomersSheet(state, customers),
  ]);
}

const EXPENSE_CATEGORY_LABEL = Object.fromEntries(
  EXPENSE_CATEGORIES.map((c) => [c.id, c.label]),
) as Record<ExpenseCategory, string>;

export function buildExpensesAndProfitSheets(
  state: DemoState,
  options: {
    branches: BranchId[];
    fromDate?: string;
    toDate?: string;
    periodLabel?: string;
  },
): ExcelSheet[] {
  const { branches, fromDate, toDate, periodLabel } = options;
  const pnl = calculateProfitAndLoss(state, { branches, fromDate, toDate });
  const expenses = getBranchExpenses(state, branches).filter((exp) => {
    if (fromDate && exp.date < fromDate) return false;
    if (toDate && exp.date > toDate) return false;
    return true;
  });
  const supplies = getBranchSupplies(state, branches);

  const profitSheet: ExcelSheet = {
    name: 'Ganancia Neta',
    headers: [
      'Sucursal',
      'Periodo',
      'Ingresos confirmados MXN',
      'Gastos totales MXN',
      'Gasto en insumos MXN',
      'Ganancia neta MXN',
      'Margen %',
      'Registros de gasto',
    ],
    rows: [
      ...pnl.byBranch.map((row) => [
        txt(row.branchName),
        txt(periodLabel ?? 'Todo el historial'),
        mxn(row.revenueCents),
        mxn(row.expensesCents),
        mxn(row.suppliesCents),
        mxn(row.netProfitCents),
        txt(row.marginPct === null ? '—' : `${row.marginPct}%`),
        int(row.expenseCount),
      ]),
      [
        txt('TOTAL CONSOLIDADO'),
        txt(periodLabel ?? 'Todo el historial'),
        mxn(pnl.revenueCents),
        mxn(pnl.expensesCents),
        mxn(pnl.suppliesCents),
        mxn(pnl.netProfitCents),
        txt(pnl.marginPct === null ? '—' : `${pnl.marginPct}%`),
        int(pnl.expenseCount),
      ],
    ],
  };

  const categorySheet: ExcelSheet = {
    name: 'Gastos por Categoría',
    headers: ['Categoría', 'Registros', 'Total MXN', '% del gasto'],
    rows: pnl.byCategory.map((row) => [
      txt(row.label),
      int(row.count),
      mxn(row.totalCents),
      txt(`${row.sharePct}%`),
    ]),
  };

  const detailSheet: ExcelSheet = {
    name: 'Detalle de Gastos',
    headers: [
      'Fecha',
      'Sucursal',
      'Categoría',
      'Concepto',
      'Cantidad',
      'Unidad',
      'Costo unitario MXN',
      'Total MXN',
      'Notas',
      'Registrado por',
    ],
    rows: expenses.map((exp) => [
      txt(exp.date),
      txt(getBranchDisplayName(state, exp.branchId)),
      txt(EXPENSE_CATEGORY_LABEL[exp.category] ?? exp.category),
      txt(exp.concept),
      { value: exp.quantity, format: 'decimal' },
      txt(exp.unitLabel ?? 'unidad'),
      mxn(exp.unitCostCents),
      mxn(exp.totalCents),
      txt(exp.notes ?? ''),
      txt(exp.createdBy ?? ''),
    ]),
  };

  const supplySheet: ExcelSheet = {
    name: 'Catálogo Insumos',
    headers: ['Sucursal', 'Insumo', 'Unidad', 'Costo unitario MXN', 'Notas'],
    rows: supplies.map((item) => [
      txt(getBranchDisplayName(state, item.branchId)),
      txt(item.name),
      txt(item.unitLabel),
      mxn(item.unitCostCents),
      txt(item.notes ?? ''),
    ]),
  };

  return [profitSheet, categorySheet, detailSheet, supplySheet];
}

export function exportExpensesAndProfitToExcel(
  state: DemoState,
  options: {
    branches: BranchId[];
    fromDate?: string;
    toDate?: string;
    periodLabel?: string;
    slug?: string;
  },
) {
  const sheets = buildExpensesAndProfitSheets(state, options);
  const slug = options.slug ?? (options.branches.length === 1 ? options.branches[0] : 'consolidadas');
  downloadXlsx(`horeb360-gastos-ganancia-${slug}-${slugDate()}.xlsx`, sheets);
}
