import { COMBO_PRICE_CENTS, formatMxn } from './money.ts';
import type {
  BranchId,
  BranchInfo,
  BranchSettings,
  CashMovement,
  DemoState,
  EncargoStage,
  Order,
  PaymentLine,
  PaymentMethod,
  Shift,
  ShiftClosingSummary,
  TicketState,
} from './types.ts';

export const BRANCHES: BranchInfo[] = [
  { id: 'lomas', name: 'Lomas', folioPrefix: 'LOM' },
  { id: 'trevino', name: 'Treviño', folioPrefix: 'TRE' },
  { id: 'sucursal-3', name: 'Sucursal 3', folioPrefix: 'S3' },
];

export const ENCARGO_STAGES: { id: EncargoStage; label: string }[] = [
  { id: 'recibido', label: 'Recibido' },
  { id: 'lavado', label: 'Lavado' },
  { id: 'secado', label: 'Secado' },
  { id: 'listo', label: 'Listo' },
  { id: 'entregado', label: 'Entregado' },
];

export interface PaymentInputLine {
  method: PaymentMethod;
  amountCents: number;
  cashReceivedCents?: number;
  /** Efectivo siempre inicia confirmado; tarjeta/transferencia pueden iniciar pendientes o confirmados. */
  confirmImmediately?: boolean;
}

export interface CreateOrderInput {
  branchId: BranchId;
  serviceType: 'autoservicio' | 'encargo';
  folio?: string;
  customerAlias?: string;
  comboCount?: number;
  paymentLines: PaymentInputLine[];
  now?: string;
}

export type DomainResult<T> =
  | { ok: true; state: DemoState; data: T }
  | { ok: false; error: string };

export function createInitialState(now = new Date().toISOString()): DemoState {
  const shifts: Shift[] = BRANCHES.map((b) => ({
    id: `shift-${b.id}-1`,
    branchId: b.id,
    number: 1,
    status: 'abierto',
    openedAt: now,
    closedAt: null,
    closingSummary: null,
  }));

  return {
    activeBranchId: 'lomas',
    orders: [],
    paymentLines: [],
    tickets: {},
    shifts,
    nextFolioSeq: {
      lomas: 1,
      trevino: 1,
      'sucursal-3': 1,
    },
  };
}

export const DEFAULT_BRANCH_SETTINGS: BranchSettings = {
  comboPriceCents: COMBO_PRICE_CENTS,
  businessName: 'LAVANDERÍA HOREB',
  branchPhone: '',
  scheduleText: 'Lun–Sáb 8:00 a 20:00',
  ticketFooter: '¡Gracias por su preferencia! Conserve este comprobante para recoger su encargo.',
  defaultPaperWidth: '80mm',
};

export function getBranchSettings(state: DemoState, branchId: BranchId): BranchSettings {
  return {
    ...DEFAULT_BRANCH_SETTINGS,
    ...(state.settings?.[branchId] ?? {}),
  };
}

export function updateBranchSettings(
  state: DemoState,
  branchId: BranchId,
  patch: Partial<BranchSettings>,
): DomainResult<BranchSettings> {
  const current = getBranchSettings(state, branchId);
  const comboPriceCents = patch.comboPriceCents ?? current.comboPriceCents;
  if (!Number.isSafeInteger(comboPriceCents) || comboPriceCents < 100 || comboPriceCents > 10_000_000) {
    return { ok: false, error: 'El precio del combo debe ser al menos $1.00 MXN.' };
  }
  const businessName = (patch.businessName ?? current.businessName).trim();
  if (!businessName) {
    return { ok: false, error: 'Captura el nombre comercial para el comprobante.' };
  }
  const defaultPaperWidth = patch.defaultPaperWidth ?? current.defaultPaperWidth;
  if (defaultPaperWidth !== '80mm' && defaultPaperWidth !== '58mm') {
    return { ok: false, error: 'Selecciona un tamaño de papel válido (80mm o 58mm).' };
  }

  const next: BranchSettings = {
    comboPriceCents,
    businessName: businessName.slice(0, 80),
    branchPhone: (patch.branchPhone ?? current.branchPhone).trim().slice(0, 40),
    scheduleText: (patch.scheduleText ?? current.scheduleText).trim().slice(0, 80),
    ticketFooter: (patch.ticketFooter ?? current.ticketFooter).trim().slice(0, 160),
    defaultPaperWidth,
  };

  return {
    ok: true,
    state: {
      ...state,
      settings: {
        ...(state.settings ?? {}),
        [branchId]: next,
      },
    },
    data: next,
  };
}

export function getBranchInfo(branchId: BranchId): BranchInfo {
  const found = BRANCHES.find((b) => b.id === branchId);
  if (!found) throw new Error(`Sucursal desconocida: ${branchId}`);
  return found;
}

export function suggestNextFolio(state: DemoState, branchId: BranchId): string {
  const branch = getBranchInfo(branchId);
  const usedFolios = new Set(state.orders.map((order) => order.folio));
  let sequence = state.nextFolioSeq[branchId] ?? 1;
  let candidate = `${branch.folioPrefix}-${String(sequence).padStart(4, '0')}`;
  while (usedFolios.has(candidate)) {
    sequence += 1;
    candidate = `${branch.folioPrefix}-${String(sequence).padStart(4, '0')}`;
  }
  return candidate;
}

export function getOpenShift(state: DemoState, branchId: BranchId): Shift | undefined {
  return state.shifts.find((s) => s.branchId === branchId && s.status === 'abierto');
}

export function getOrderPaymentLines(state: DemoState, orderId: string): PaymentLine[] {
  return state.paymentLines.filter((p) => p.orderId === orderId);
}

export function getOrderPendingCents(state: DemoState, orderId: string): number {
  const order = state.orders.find((item) => item.id === orderId);
  return order ? order.totalCents - getOrderConfirmedCents(state, orderId) : 0;
}

export function getOrderConfirmedCents(state: DemoState, orderId: string): number {
  return getOrderPaymentLines(state, orderId)
    .filter((p) => p.status === 'confirmado')
    .reduce((acc, p) => acc + p.amountCents, 0);
}

export function isOrderFullyPaid(state: DemoState, orderId: string): boolean {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return false;
  const lines = getOrderPaymentLines(state, orderId);
  const confirmed = lines
    .filter((p) => p.status === 'confirmado')
    .reduce((acc, p) => acc + p.amountCents, 0);
  return confirmed === order.totalCents && lines.every((p) => p.status === 'confirmado');
}

/**
 * Calcula los totales en vivo de un turno abierto (o el resumen guardado si está cerrado).
 * Los ingresos confirmados se atribuyen al turno abierto en que se confirmaron (`confirmedShiftId`).
 * El saldo pendiente corresponde a las líneas pendientes de órdenes de esa sucursal.
 */
export function getShiftMetrics(state: DemoState, shiftId: string): ShiftClosingSummary {
  const shift = state.shifts.find((s) => s.id === shiftId);
  if (!shift) {
    return {
      expectedCashCents: 0,
      countedCashCents: 0,
      differenceCents: 0,
      confirmedCardCents: 0,
      confirmedTransferCents: 0,
      pendingBalanceCents: 0,
      totalConfirmedCents: 0,
    };
  }

  if (shift.status === 'cerrado' && shift.closingSummary) {
    return shift.closingSummary;
  }

  const confirmedInShift = state.paymentLines.filter(
    (p) => p.status === 'confirmado' && p.confirmedShiftId === shift.id,
  );

  const confirmedCashCents = confirmedInShift
    .filter((p) => p.method === 'efectivo')
    .reduce((sum, p) => sum + p.amountCents, 0);

  const movements = shift.cashMovements ?? [];
  const expectedCashCents = (shift.openingCashCents ?? 0) + confirmedCashCents
    + movements.reduce((sum, item) => sum + (item.kind === 'entrada' ? item.amountCents : -item.amountCents), 0);
  const confirmedCardCents = confirmedInShift
    .filter((p) => p.method === 'tarjeta')
    .reduce((sum, p) => sum + p.amountCents, 0);

  const confirmedTransferCents = confirmedInShift
    .filter((p) => p.method === 'transferencia')
    .reduce((sum, p) => sum + p.amountCents, 0);

  const pendingBalanceCents = state.orders
    .filter((order) => order.branchId === shift.branchId)
    .reduce((sum, order) => sum + getOrderPendingCents(state, order.id), 0);

  const totalConfirmedCents =
    confirmedCashCents + confirmedCardCents + confirmedTransferCents;

  return {
    expectedCashCents,
    countedCashCents: expectedCashCents,
    differenceCents: 0,
    confirmedCardCents,
    confirmedTransferCents,
    pendingBalanceCents,
    totalConfirmedCents,
  };
}

export interface BranchAdminSummary {
  branch: BranchInfo;
  cashCents: number;
  cardCents: number;
  transferCents: number;
  pendingCents: number;
  totalConfirmedCents: number;
  orderCount: number;
  openShiftNumber: number | null;
}

export function getBranchSummary(state: DemoState, branchId: BranchId): BranchAdminSummary {
  const branch = getBranchInfo(branchId);
  const branchOrders = state.orders.filter((o) => o.branchId === branchId);
  const orderIds = new Set(branchOrders.map((o) => o.id));
  const lines = state.paymentLines.filter((p) => orderIds.has(p.orderId));

  const cashCents = lines
    .filter((p) => p.status === 'confirmado' && p.method === 'efectivo')
    .reduce((s, p) => s + p.amountCents, 0);
  const cardCents = lines
    .filter((p) => p.status === 'confirmado' && p.method === 'tarjeta')
    .reduce((s, p) => s + p.amountCents, 0);
  const transferCents = lines
    .filter((p) => p.status === 'confirmado' && p.method === 'transferencia')
    .reduce((s, p) => s + p.amountCents, 0);
  const pendingCents = branchOrders.reduce(
    (sum, order) => sum + getOrderPendingCents(state, order.id), 0,
  );

  const openShift = getOpenShift(state, branchId);

  return {
    branch,
    cashCents,
    cardCents,
    transferCents,
    pendingCents,
    totalConfirmedCents: cashCents + cardCents + transferCents,
    orderCount: branchOrders.length,
    openShiftNumber: openShift ? openShift.number : null,
  };
}

export function getGlobalAdminTotals(state: DemoState, branches = BRANCHES.map((branch) => branch.id)) {
  const byBranch = branches.map((branch) => getBranchSummary(state, branch));
  const totals = byBranch.reduce(
    (acc, item) => ({
      cashCents: acc.cashCents + item.cashCents,
      cardCents: acc.cardCents + item.cardCents,
      transferCents: acc.transferCents + item.transferCents,
      pendingCents: acc.pendingCents + item.pendingCents,
      totalConfirmedCents: acc.totalConfirmedCents + item.totalConfirmedCents,
      orderCount: acc.orderCount + item.orderCount,
    }),
    {
      cashCents: 0,
      cardCents: 0,
      transferCents: 0,
      pendingCents: 0,
      totalConfirmedCents: 0,
      orderCount: 0,
    },
  );
  return { byBranch, totals };
}

export function createOrder(state: DemoState, input: CreateOrderInput): DomainResult<Order> {
  const now = input.now ?? new Date().toISOString();
  const openShift = getOpenShift(state, input.branchId);
  if (!openShift) {
    return {
      ok: false,
      error: `No hay un turno abierto en ${getBranchInfo(input.branchId).name}. Abre un turno en Caja antes de registrar ventas.`,
    };
  }

  const unitPriceCents = getBranchSettings(state, input.branchId).comboPriceCents;
  const comboCount = input.comboCount ?? 1;
  if (!Number.isSafeInteger(comboCount * unitPriceCents) || !Number.isInteger(comboCount) || comboCount < 1) {
    return { ok: false, error: 'La cantidad de combos debe ser al menos 1.' };
  }

  const totalCents = comboCount * unitPriceCents;

  const nextFolio = suggestNextFolio(state, input.branchId);
  const folio = (input.folio?.trim() || nextFolio).toUpperCase();
  if (state.orders.some((o) => o.folio === folio)) {
    return {
      ok: false,
      error: `El folio ${folio} ya existe. Usa otro folio.`,
    };
  }

  const customerAlias =
    input.serviceType === 'encargo'
      ? input.customerAlias?.trim() || ''
      : 'Autoservicio';

  if (input.serviceType === 'encargo' && !customerAlias) {
    return {
      ok: false,
      error: 'Captura el nombre o referencia del cliente para registrar el encargo.',
    };
  }

  const orderId = `ord-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const order: Order = {
    id: orderId,
    folio,
    branchId: input.branchId,
    shiftId: openShift.id,
    serviceType: input.serviceType,
    customerAlias,
    comboCount,
    unitPriceCents,
    totalCents,
    encargoStage: input.serviceType === 'encargo' ? 'recibido' : null,
    orderStatus: 'en_proceso',
    createdAt: now,
    deliveredAt: null,
  };

  const payment = input.serviceType === 'encargo' && input.paymentLines.length === 0
    ? null
    : buildPaymentLines(order, input.paymentLines, openShift, now);
  if (payment && !payment.ok) return payment;

  const ticket: TicketState = {
    orderId,
    folio,
    status: 'no_emitido',
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    issuedAt: null,
    simulated: true,
  };

  const nextState: DemoState = {
    ...state,
    orders: [order, ...state.orders],
    paymentLines: [...state.paymentLines, ...(payment?.lines ?? [])],
    tickets: {
      ...state.tickets,
      [orderId]: ticket,
    },
    nextFolioSeq: folio === nextFolio
      ? { ...state.nextFolioSeq, [input.branchId]: Number(nextFolio.split('-').at(-1)) + 1 }
      : state.nextFolioSeq,
  };

  return { ok: true, state: nextState, data: order };
}

function buildPaymentLines(
  order: Order,
  input: PaymentInputLine[],
  shift: Shift,
  now: string,
): { ok: true; lines: PaymentLine[] } | { ok: false; error: string } {
  if (input.some((line) => !Number.isSafeInteger(line.amountCents) || line.amountCents <= 0)) {
    return { ok: false, error: 'Los importes deben ser centavos enteros positivos.' };
  }
  if (input.some((line) => line.cashReceivedCents !== undefined && (
    line.method !== 'efectivo' || !Number.isSafeInteger(line.cashReceivedCents) || line.cashReceivedCents < line.amountCents
  ))) {
    return { ok: false, error: 'El efectivo recibido debe cubrir el importe aplicado.' };
  }
  if (new Set(input.map((line) => line.method)).size !== input.length) {
    return { ok: false, error: 'Usa cada método de pago una sola vez.' };
  }
  const sum = input.reduce((total, line) => total + line.amountCents, 0);
  if (sum !== order.totalCents) {
    return {
      ok: false,
      error: `El reparto de pago (${formatMxn(sum)}) debe sumar exactamente ${formatMxn(order.totalCents)}.`,
    };
  }
  return {
    ok: true,
    lines: input.map((line) => {
      const confirmed = line.method === 'efectivo' || Boolean(line.confirmImmediately);
      return {
        id: `pay-${order.id}-${line.method}`,
        orderId: order.id,
        method: line.method,
        amountCents: line.amountCents,
        cashReceivedCents: line.cashReceivedCents,
        status: confirmed ? 'confirmado' : 'pendiente',
        createdAt: now,
        confirmedAt: confirmed ? now : null,
        confirmedShiftId: confirmed ? shift.id : null,
      };
    }),
  };
}

export function captureEncargoPayment(
  state: DemoState,
  orderId: string,
  input: PaymentInputLine[],
  now = new Date().toISOString(),
): DomainResult<Order> {
  const order = state.orders.find((item) => item.id === orderId && item.serviceType === 'encargo');
  if (!order) return { ok: false, error: 'Encargo no encontrado.' };
  if (getOrderPaymentLines(state, orderId).length > 0) {
    return { ok: false, error: 'El folio ya tiene un cobro registrado.' };
  }
  const shift = getOpenShift(state, order.branchId);
  if (!shift) return { ok: false, error: 'Abre un turno para registrar el cobro.' };
  const payment = buildPaymentLines(order, input, shift, now);
  if (!payment.ok) return payment;
  return {
    ok: true,
    state: { ...state, paymentLines: [...state.paymentLines, ...payment.lines] },
    data: order,
  };
}

export function confirmPaymentLine(
  state: DemoState,
  paymentLineId: string,
  now = new Date().toISOString(),
): DomainResult<PaymentLine> {
  const line = state.paymentLines.find((p) => p.id === paymentLineId);
  if (!line) {
    return { ok: false, error: 'Componente de pago no encontrado.' };
  }
  if (line.status === 'confirmado') {
    return { ok: false, error: 'Este pago ya está confirmado.' };
  }

  const order = state.orders.find((o) => o.id === line.orderId);
  if (!order) {
    return { ok: false, error: 'Orden asociada no encontrada.' };
  }

  const openShift = getOpenShift(state, order.branchId);
  if (!openShift) {
    return {
      ok: false,
      error: `Abre un turno en ${getBranchInfo(order.branchId).name} para registrar la confirmación del cobro.`,
    };
  }

  const updated: PaymentLine = {
    ...line,
    status: 'confirmado',
    confirmedAt: now,
    confirmedShiftId: openShift.id,
  };

  return {
    ok: true,
    state: {
      ...state,
      paymentLines: state.paymentLines.map((p) => (p.id === paymentLineId ? updated : p)),
    },
    data: updated,
  };
}

export function advanceEncargoStage(state: DemoState, orderId: string): DomainResult<Order> {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, error: 'Orden no encontrada.' };
  if (order.serviceType !== 'encargo' || !order.encargoStage) {
    return { ok: false, error: 'Solo los encargos tienen flujo por etapas.' };
  }

  const transitions: Record<EncargoStage, EncargoStage | null> = {
    recibido: 'lavado',
    lavado: 'secado',
    secado: 'listo',
    listo: null,
    entregado: null,
  };

  const nextStage = transitions[order.encargoStage];
  if (!nextStage) {
    return { ok: false, error: 'El encargo ya está listo o entregado.' };
  }

  const updated: Order = {
    ...order,
    encargoStage: nextStage,
    orderStatus: nextStage === 'listo' ? 'listo' : 'en_proceso',
  };

  return {
    ok: true,
    state: {
      ...state,
      orders: state.orders.map((o) => (o.id === orderId ? updated : o)),
    },
    data: updated,
  };
}

export function canDeliverOrder(state: DemoState, orderId: string): {
  allowed: boolean;
  reason?: string;
} {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return { allowed: false, reason: 'Orden no encontrada.' };
  if (order.serviceType !== 'encargo') {
    return { allowed: false, reason: 'Autoservicio no requiere entrega de encargo.' };
  }
  if (order.encargoStage === 'entregado') {
    return { allowed: false, reason: 'La orden ya fue entregada.' };
  }
  if (order.encargoStage !== 'listo') {
    return { allowed: false, reason: 'La orden debe estar en etapa Listo antes de entregar.' };
  }
  if (!isOrderFullyPaid(state, orderId)) {
    return { allowed: false, reason: 'Confirma todo el pago antes de entregar.' };
  }
  const ticket = state.tickets[orderId];
  if (!ticket || ticket.status !== 'emitido') {
    return { allowed: false, reason: 'Emite el comprobante antes de entregar.' };
  }
  return { allowed: true };
}

export function deliverEncargoOrder(
  state: DemoState,
  orderId: string,
  now = new Date().toISOString(),
): DomainResult<Order> {
  const check = canDeliverOrder(state, orderId);
  if (!check.allowed) {
    return { ok: false, error: check.reason ?? 'No se puede entregar la orden.' };
  }
  const order = state.orders.find((o) => o.id === orderId)!;
  const updated: Order = {
    ...order,
    encargoStage: 'entregado',
    orderStatus: 'entregado',
    deliveredAt: now,
  };
  return {
    ok: true,
    state: {
      ...state,
      orders: state.orders.map((o) => (o.id === orderId ? updated : o)),
    },
    data: updated,
  };
}

export function emitTicket(
  state: DemoState,
  orderId: string,
  options: { simulateFailure?: boolean; now?: string } = {},
): DomainResult<TicketState> {
  const ticket = state.tickets[orderId];
  const order = state.orders.find((o) => o.id === orderId);
  if (!ticket || !order) {
    return { ok: false, error: 'Orden o ticket no encontrado.' };
  }
  if (!isOrderFullyPaid(state, orderId)) {
    return { ok: false, error: 'Confirma el pago completo antes de emitir el ticket.' };
  }
  if (ticket.status === 'emitido') {
    return { ok: true, state, data: ticket };
  }

  const now = options.now ?? new Date().toISOString();
  const attempts = ticket.attempts + 1;

  if (options.simulateFailure) {
    const failed: TicketState = {
      ...ticket,
      status: 'fallo',
      attempts,
      lastAttemptAt: now,
      lastError: 'No se pudo imprimir el comprobante. El folio y el pago siguen guardados.',
    };
    return {
      ok: true,
      state: {
        ...state,
        tickets: { ...state.tickets, [orderId]: failed },
      },
      data: failed,
    };
  }

  const issued: TicketState = {
    ...ticket,
    status: 'emitido',
    attempts,
    lastAttemptAt: now,
    lastError: null,
    issuedAt: now,
  };

  return {
    ok: true,
    state: {
      ...state,
      orders: order.serviceType === 'autoservicio'
        ? state.orders.map((item) => item.id === orderId ? { ...item, orderStatus: 'completado' } : item)
        : state.orders,
      tickets: { ...state.tickets, [orderId]: issued },
    },
    data: issued,
  };
}

export function closeShift(
  state: DemoState,
  branchId: BranchId,
  countedCashCents: number,
  now = new Date().toISOString(),
): DomainResult<Shift> {
  const openShift = getOpenShift(state, branchId);
  if (!openShift) {
    return {
      ok: false,
      error: `No hay turno abierto en ${getBranchInfo(branchId).name}.`,
    };
  }
  if (!Number.isSafeInteger(countedCashCents) || countedCashCents < 0) {
    return { ok: false, error: 'El efectivo contado debe ser un monto válido en centavos.' };
  }

  const metrics = getShiftMetrics(state, openShift.id);
  const closingSummary: ShiftClosingSummary = {
    ...metrics,
    countedCashCents,
    differenceCents: countedCashCents - metrics.expectedCashCents,
  };

  const closed: Shift = {
    ...openShift,
    status: 'cerrado',
    closedAt: now,
    closingSummary,
  };

  return {
    ok: true,
    state: {
      ...state,
      shifts: state.shifts.map((s) => (s.id === openShift.id ? closed : s)),
    },
    data: closed,
  };
}

export function openNewShift(
  state: DemoState,
  branchId: BranchId,
  now = new Date().toISOString(),
  openingCashCents = 0,
): DomainResult<Shift> {
  if (!Number.isSafeInteger(openingCashCents) || openingCashCents < 0) {
    return { ok: false, error: 'Revisa el fondo inicial.' };
  }
  const existingOpen = getOpenShift(state, branchId);
  if (existingOpen) {
    return {
      ok: false,
      error: `Ya existe un turno abierto (#${existingOpen.number}) en ${getBranchInfo(branchId).name}.`,
    };
  }

  const branchShifts = state.shifts.filter((s) => s.branchId === branchId);
  const nextNumber =
    branchShifts.reduce((max, s) => Math.max(max, s.number), 0) + 1;

  const newShift: Shift = {
    id: `shift-${branchId}-${nextNumber}`,
    branchId,
    number: nextNumber,
    openingCashCents,
    status: 'abierto',
    openedAt: now,
    closedAt: null,
    closingSummary: null,
  };

  return {
    ok: true,
    state: {
      ...state,
      shifts: [newShift, ...state.shifts],
    },
    data: newShift,
  };
}

export function recordCashMovement(
  state: DemoState,
  branchId: BranchId,
  kind: CashMovement['kind'],
  amountCents: number,
  reason: string,
  now = new Date().toISOString(),
): DomainResult<Shift> {
  const shift = getOpenShift(state, branchId);
  if (!shift) return { ok: false, error: 'Abre un turno para registrar movimientos.' };
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || !reason.trim()) {
    return { ok: false, error: 'Captura un importe mayor a cero y un motivo.' };
  }
  const expected = getShiftMetrics(state, shift.id).expectedCashCents;
  if (kind === 'retiro' && amountCents > expected) {
    return { ok: false, error: 'El retiro supera el efectivo esperado en caja.' };
  }
  const movement = { kind, amountCents, reason: reason.trim(), createdAt: now };
  const updated = { ...shift, cashMovements: [...(shift.cashMovements ?? []), movement] };
  return {
    ok: true,
    state: { ...state, shifts: state.shifts.map((item) => item.id === shift.id ? updated : item) },
    data: updated,
  };
}
