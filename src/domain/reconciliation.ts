import { formatMxn, parsePesosToCents } from './money.ts';
import {
  closeShift,
  confirmPaymentLine,
  getBranchInfo,
  getOpenShift,
  getOrderPendingCents,
  getShiftMetrics,
} from './rules.ts';
import type {
  BranchId,
  DemoState,
  NightClosingReport,
  Order,
  PaymentLine,
} from './types.ts';

export interface PendingTransferItem {
  line: PaymentLine;
  order: Order;
}

export interface CsvMatchResult {
  rowNumber: number;
  fecha: string;
  referencia: string;
  concepto: string;
  amountCents: number;
  status: 'exact' | 'ambiguous' | 'unmatched';
  matchedLineId?: string;
  matchedFolio?: string;
  candidateFolios: string[];
  reason: string;
}

export interface CsvParseSummary {
  ok: true;
  rows: CsvMatchResult[];
}

export type CsvParseResult = CsvParseSummary | { ok: false; error: string };

export function getMatamorosDateAndHour(nowIso: string): { localDate: string; hour: number } {
  const date = new Date(nowIso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Matamoros',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  const localDate = `${get('year')}-${get('month')}-${get('day')}`;
  const rawHour = Number.parseInt(get('hour'), 10);
  const hour = rawHour === 24 ? 0 : rawHour;
  return { localDate, hour };
}

export function runNightClosingForBranch(
  state: DemoState,
  branchId: BranchId,
  options: {
    closingDate?: string;
    now?: string;
    enforce2300Rule?: boolean;
    actorLabel?: string;
  } = {},
):
  | { ok: true; state: DemoState; data: NightClosingReport; alreadyExecuted: boolean }
  | { ok: false; error: string } {
  const now = options.now ?? new Date().toISOString();
  const { localDate, hour } = getMatamorosDateAndHour(now);

  if (options.enforce2300Rule && hour < 23) {
    return {
      ok: false,
      error: `Aún son las ${String(hour).padStart(2, '0')}:00 en ${getBranchInfo(branchId).name}. El cierre automático aplica a partir de las 23:00.`,
    };
  }

  const closingDate = (options.closingDate?.trim() || localDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(closingDate)) {
    return { ok: false, error: 'Usa formato YYYY-MM-DD para la fecha de cierre nocturno.' };
  }

  const existing = (state.nightClosings ?? []).find(
    (nc) => nc.branchId === branchId && nc.closingDate === closingDate,
  );
  if (existing) {
    return { ok: true, state, data: existing, alreadyExecuted: true };
  }

  let workingState = state;
  const openShift = getOpenShift(workingState, branchId);
  let wasAutoClosed = false;
  let targetShift = openShift;

  if (openShift) {
    const metrics = getShiftMetrics(workingState, openShift.id);
    const closed = closeShift(workingState, branchId, metrics.expectedCashCents, now);
    if (!closed.ok) return closed;
    workingState = closed.state;
    targetShift = closed.data;
    wasAutoClosed = true;
  } else {
    targetShift = [...workingState.shifts]
      .filter((s) => s.branchId === branchId)
      .sort((a, b) => b.number - a.number)[0];
  }

  const shiftMetrics = targetShift
    ? getShiftMetrics(workingState, targetShift.id)
    : {
        expectedCashCents: 0,
        countedCashCents: 0,
        differenceCents: 0,
        confirmedCardCents: 0,
        confirmedTransferCents: 0,
        pendingBalanceCents: 0,
        totalConfirmedCents: 0,
      };

  const branchOrders = workingState.orders.filter((o) => o.branchId === branchId);
  const orderIds = new Set(branchOrders.map((o) => o.id));
  const pendingTransferCents = workingState.paymentLines
    .filter((p) => orderIds.has(p.orderId) && p.method === 'transferencia' && p.status === 'pendiente')
    .reduce((sum, p) => sum + p.amountCents, 0);

  const pendingDeliveryOrders = branchOrders.filter(
    (o) => o.serviceType === 'encargo' && o.encargoStage !== 'entregado',
  );
  const pendingDeliveryCount = pendingDeliveryOrders.length;
  const pendingDeliveryAmountCents = pendingDeliveryOrders.reduce(
    (sum, o) => sum + getOrderPendingCents(workingState, o.id),
    0,
  );

  const branchName = getBranchInfo(branchId).name;
  const actorLabel = options.actorLabel?.trim() || 'Cierre 23:00';
  const reportText = [
    `CIERRE NOCTURNO 23:00 • HOREB 360`,
    `Sucursal: ${branchName} | Fecha: ${closingDate}`,
    `Turno: ${targetShift ? `#${targetShift.number}` : 'Sin turno'} (${wasAutoClosed ? 'Cerrado automáticamente' : 'Ya estaba cerrado manualmente'})`,
    `------------------------------------`,
    `• Efectivo esperado turno: ${formatMxn(shiftMetrics.expectedCashCents)}`,
    `• Tarjeta confirmada turno: ${formatMxn(shiftMetrics.confirmedCardCents)}`,
    `• Transferencia confirmada turno: ${formatMxn(shiftMetrics.confirmedTransferCents)}`,
    `• Total confirmado turno: ${formatMxn(shiftMetrics.totalConfirmedCents)}`,
    `• Transferencias pendientes sucursal: ${formatMxn(pendingTransferCents)}`,
    `• Encargos pendientes de entregar: ${pendingDeliveryCount} (${formatMxn(pendingDeliveryAmountCents)})`,
  ].join('\n');

  const report: NightClosingReport = {
    id: `nc-${branchId}-${closingDate}`,
    branchId,
    closingDate,
    shiftId: targetShift?.id ?? null,
    shiftNumber: targetShift?.number ?? null,
    wasAutoClosed,
    expectedCashCents: shiftMetrics.expectedCashCents,
    countedCashCents: shiftMetrics.countedCashCents,
    confirmedCardCents: shiftMetrics.confirmedCardCents,
    confirmedTransferCents: shiftMetrics.confirmedTransferCents,
    pendingTransferCents,
    pendingBalanceCents: shiftMetrics.pendingBalanceCents,
    pendingDeliveryCount,
    pendingDeliveryAmountCents,
    totalConfirmedCents: shiftMetrics.totalConfirmedCents,
    reportText,
    executedAt: now,
    executedBy: actorLabel,
  };

  const nextAudit = [
    {
      id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      branchId,
      category: 'cierre_nocturno' as const,
      message: `Cierre nocturno ${closingDate} registrado (${wasAutoClosed ? `turno #${targetShift?.number} cerrado` : 'corte manual previo respetado'})`,
      actor: actorLabel,
      createdAt: now,
    },
    ...(workingState.auditLogs ?? []),
  ].slice(0, 120);

  return {
    ok: true,
    alreadyExecuted: false,
    data: report,
    state: {
      ...workingState,
      nightClosings: [report, ...(workingState.nightClosings ?? [])],
      auditLogs: nextAudit,
    },
  };
}

export function getPendingTransfersForBranch(state: DemoState, branchId: BranchId): PendingTransferItem[] {
  const orderMap = new Map(
    state.orders.filter((o) => o.branchId === branchId).map((o) => [o.id, o]),
  );
  return state.paymentLines
    .filter((line) => line.method === 'transferencia' && line.status === 'pendiente' && orderMap.has(line.orderId))
    .map((line) => ({ line, order: orderMap.get(line.orderId)! }))
    .sort((a, b) => b.order.createdAt.localeCompare(a.order.createdAt));
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function matchBankTransfersCsv(
  state: DemoState,
  branchId: BranchId,
  csvText: string,
): CsvParseResult {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return { ok: false, error: 'El archivo CSV debe incluir encabezados y al menos un movimiento.' };
  }

  const headers = splitCsvLine(lines[0]).map(normalizeHeader);
  const idxFecha = headers.findIndex((h) => h === 'fecha' || h === 'date');
  const idxRef = headers.findIndex((h) => h === 'referencia' || h === 'clave' || h === 'ref');
  const idxImporte = headers.findIndex((h) => h === 'importe' || h === 'monto' || h === 'cantidad');
  const idxConcepto = headers.findIndex((h) => h === 'concepto' || h === 'descripcion' || h === 'nota');

  if (idxFecha === -1 || idxRef === -1 || idxImporte === -1) {
    return {
      ok: false,
      error: 'Columnas requeridas: fecha, referencia, importe (opcional: concepto).',
    };
  }

  const pending = getPendingTransfersForBranch(state, branchId);
  const preliminary: CsvMatchResult[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const fecha = cols[idxFecha] ?? '';
    const referencia = cols[idxRef] ?? '';
    const concepto = idxConcepto >= 0 ? (cols[idxConcepto] ?? '') : '';
    const amountCents = parsePesosToCents(cols[idxImporte] ?? '');

    if (amountCents === null || amountCents <= 0) {
      return { ok: false, error: `Importe inválido en la fila ${i + 1} (${cols[idxImporte] ?? ''}).` };
    }

    const searchHaystack = `${referencia} ${concepto}`.toUpperCase();
    const sameAmount = pending.filter((item) => item.line.amountCents === amountCents);
    const folioMatch = sameAmount.filter((item) => searchHaystack.includes(item.order.folio.toUpperCase()));

    let candidates = folioMatch.length > 0 ? folioMatch : sameAmount;
    let status: CsvMatchResult['status'] = 'unmatched';
    let reason = 'Sin transferencia pendiente por ese importe.';

    if (candidates.length === 1) {
      status = 'exact';
      reason =
        folioMatch.length === 1
          ? 'Coincidencia exacta por folio e importe.'
          : 'Coincidencia única por importe.';
    } else if (candidates.length > 1) {
      status = 'ambiguous';
      reason = `Hay ${candidates.length} transferencias pendientes por ${formatMxn(amountCents)}. Confirmar manualmente.`;
    } else {
      // ¿El folio coincide pero con otro monto? Marcar como ambiguo para revisión manual
      const folioWrongAmount = pending.filter((item) => searchHaystack.includes(item.order.folio.toUpperCase()));
      if (folioWrongAmount.length > 0) {
        candidates = folioWrongAmount;
        status = 'ambiguous';
        reason = 'El folio coincide pero el importe difiere. Revisar manualmente.';
      }
    }

    preliminary.push({
      rowNumber: i + 1,
      fecha,
      referencia,
      concepto,
      amountCents,
      status,
      matchedLineId: status === 'exact' ? candidates[0].line.id : undefined,
      matchedFolio: status === 'exact' ? candidates[0].order.folio : undefined,
      candidateFolios: candidates.map((c) => c.order.folio),
      reason,
    });
  }

  // Si dos filas exactas del mismo CSV reclaman la misma línea de pago, ambas pasan a ambiguo!
  const claimCounts = new Map<string, number>();
  for (const row of preliminary) {
    if (row.status === 'exact' && row.matchedLineId) {
      claimCounts.set(row.matchedLineId, (claimCounts.get(row.matchedLineId) ?? 0) + 1);
    }
  }

  const finalRows = preliminary.map((row) => {
    if (row.status === 'exact' && row.matchedLineId && (claimCounts.get(row.matchedLineId) ?? 0) > 1) {
      return {
        ...row,
        status: 'ambiguous' as const,
        matchedLineId: undefined,
        reason: 'Movimiento duplicado para el mismo folio en el archivo. Confirmar manualmente.',
      };
    }
    return row;
  });

  return { ok: true, rows: finalRows };
}

export function confirmTransferBatch(
  state: DemoState,
  confirmations: Array<{ lineId: string; reference?: string }>,
  actorLabel = 'Conciliación Nu',
  now = new Date().toISOString(),
): { ok: true; state: DemoState; confirmedCount: number } | { ok: false; error: string } {
  if (confirmations.length === 0) {
    return { ok: false, error: 'Selecciona al menos una transferencia verificada para confirmar.' };
  }
  let working = state;
  let count = 0;
  for (const item of confirmations) {
    const res = confirmPaymentLine(working, item.lineId, now, {
      reference: item.reference,
      actorLabel,
    });
    if (!res.ok) return res;
    working = res.state;
    count += 1;
  }
  return { ok: true, state: working, confirmedCount: count };
}
