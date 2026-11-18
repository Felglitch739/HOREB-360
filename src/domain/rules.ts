import { COMBO_PRICE_CENTS, formatMxn } from './money.ts';
import type {
  BranchAuditEntry,
  BranchId,
  BranchInfo,
  BranchSettings,
  CashMovement,
  CatalogItem,
  DemoState,
  EncargoStage,
  Order,
  OrderLineItem,
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

export const DEFAULT_CATALOG: CatalogItem[] = [
  {
    id: 'combo',
    name: 'Combo Lavado + Secado',
    priceCents: COMBO_PRICE_CENTS,
    requiresMachine: true,
    loyaltyCredits: 1,
    pricePendingConfirmation: false,
    active: true,
  },
  {
    id: 'edredon',
    name: 'Edredón King / Matrimonial',
    priceCents: 9500,
    requiresMachine: true,
    loyaltyCredits: 0,
    pricePendingConfirmation: true,
    active: true,
  },
  {
    id: 'detergente',
    name: 'Kit Detergente + Suavizante',
    priceCents: 2000,
    requiresMachine: false,
    loyaltyCredits: 0,
    pricePendingConfirmation: true,
    active: true,
  },
  {
    id: 'bolsa',
    name: 'Bolsa Jumbo HOREB',
    priceCents: 3500,
    requiresMachine: false,
    loyaltyCredits: 0,
    pricePendingConfirmation: true,
    active: true,
  },
];

export interface PaymentInputLine {
  method: PaymentMethod;
  amountCents: number;
  cashReceivedCents?: number;
  /** Efectivo siempre inicia confirmado; tarjeta/transferencia pueden iniciar pendientes o confirmados. */
  confirmImmediately?: boolean;
  /** Referencia de terminal o transferencia bancaria capturada al guardar */
  reference?: string;
}

export interface OrderItemInput {
  itemId: string;
  quantity: number;
}

export interface CreateOrderInput {
  branchId: BranchId;
  serviceType: 'autoservicio' | 'encargo';
  folio?: string;
  customerAlias?: string;
  comboCount?: number;
  items?: OrderItemInput[];
  paymentLines: PaymentInputLine[];
  now?: string;
  actorLabel?: string;
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
  allowOperatorReprint: false,
  catalog: DEFAULT_CATALOG,
};

function appendAudit(
  state: DemoState,
  entry: Omit<BranchAuditEntry, 'id'>,
): BranchAuditEntry[] {
  const next: BranchAuditEntry = {
    id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    ...entry,
  };
  return [next, ...(state.auditLogs ?? [])].slice(0, 120);
}

export function getBranchCatalog(state: DemoState, branchId: BranchId): CatalogItem[] {
  const saved = state.settings?.[branchId];
  const basePrice = saved?.comboPriceCents ?? DEFAULT_BRANCH_SETTINGS.comboPriceCents;
  const savedList = saved?.catalog;
  if (!savedList || savedList.length === 0) {
    return DEFAULT_CATALOG.map((item) =>
      item.id === 'combo' ? { ...item, priceCents: basePrice } : { ...item },
    );
  }
  const byId = new Map(savedList.map((item) => [item.id, item]));
  const merged = DEFAULT_CATALOG.map((def) => {
    const existing = byId.get(def.id);
    if (!existing) {
      return def.id === 'combo' ? { ...def, priceCents: basePrice } : { ...def };
    }
    return {
      ...def,
      ...existing,
    };
  });
  for (const extra of savedList) {
    if (!DEFAULT_CATALOG.some((def) => def.id === extra.id)) {
      merged.push(extra);
    }
  }
  return merged;
}

export function getOrderLineItems(order: Order): OrderLineItem[] {
  if (order.items && order.items.length > 0) return order.items;
  return [
    {
      itemId: 'combo',
      name: 'Combo Lavado + Secado',
      quantity: order.comboCount,
      unitPriceCents: order.unitPriceCents,
      lineTotalCents: order.totalCents,
      requiresMachine: true,
      loyaltyCredits: 1,
    },
  ];
}

export function getBranchSettings(state: DemoState, branchId: BranchId): BranchSettings {
  const saved = state.settings?.[branchId];
  const catalog = getBranchCatalog(state, branchId);
  const comboItem = catalog.find((item) => item.id === 'combo');
  return {
    ...DEFAULT_BRANCH_SETTINGS,
    ...(saved ?? {}),
    comboPriceCents: comboItem?.priceCents ?? saved?.comboPriceCents ?? DEFAULT_BRANCH_SETTINGS.comboPriceCents,
    allowOperatorReprint: saved?.allowOperatorReprint ?? false,
    catalog,
  };
}

export function updateBranchSettings(
  state: DemoState,
  branchId: BranchId,
  patch: Partial<BranchSettings>,
  actorLabel = 'Supervisión',
  now = new Date().toISOString(),
): DomainResult<BranchSettings> {
  const current = getBranchSettings(state, branchId);
  const currentCatalog = getBranchCatalog(state, branchId);
  let nextCatalog = currentCatalog;

  if (patch.catalog && patch.catalog.length > 0) {
    const patchMap = new Map(patch.catalog.map((item) => [item.id, item]));
    const validated: CatalogItem[] = [];
    for (const baseItem of currentCatalog) {
      const incoming = patchMap.get(baseItem.id);
      if (!incoming) {
        validated.push(baseItem);
        continue;
      }
      if (!Number.isSafeInteger(incoming.priceCents) || incoming.priceCents < 100 || incoming.priceCents > 10_000_000) {
        return { ok: false, error: `El precio de "${baseItem.name}" debe ser al menos $1.00 MXN.` };
      }
      const cleanName = incoming.name.trim().slice(0, 80);
      if (!cleanName) {
        return { ok: false, error: 'El nombre del producto no puede quedar vacío.' };
      }
      validated.push({
        ...baseItem,
        ...incoming,
        name: cleanName,
      });
    }
    nextCatalog = validated;
  }

  let comboPriceCents = patch.comboPriceCents ?? current.comboPriceCents;
  const comboInPatchCatalog = patch.catalog?.find((item) => item.id === 'combo');
  if (comboInPatchCatalog) {
    comboPriceCents = comboInPatchCatalog.priceCents;
  } else if (patch.comboPriceCents !== undefined) {
    nextCatalog = nextCatalog.map((item) =>
      item.id === 'combo' ? { ...item, priceCents: patch.comboPriceCents! } : item,
    );
  }

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
    allowOperatorReprint: patch.allowOperatorReprint ?? current.allowOperatorReprint ?? false,
    catalog: nextCatalog,
  };

  let auditLogs = state.auditLogs ?? [];
  for (const prevItem of currentCatalog) {
    const nextItem = nextCatalog.find((item) => item.id === prevItem.id);
    if (nextItem && nextItem.priceCents !== prevItem.priceCents) {
      auditLogs = appendAudit(
        { ...state, auditLogs },
        {
          branchId,
          category: 'precio',
          message: `Precio actualizado en ${prevItem.name}: ${formatMxn(prevItem.priceCents)} → ${formatMxn(nextItem.priceCents)}`,
          previousValue: formatMxn(prevItem.priceCents),
          nextValue: formatMxn(nextItem.priceCents),
          actor: actorLabel,
          createdAt: now,
        },
      );
    }
  }
  if (
    patch.allowOperatorReprint !== undefined &&
    patch.allowOperatorReprint !== (current.allowOperatorReprint ?? false)
  ) {
    auditLogs = appendAudit(
      { ...state, auditLogs },
      {
        branchId,
        category: 'ticket',
        message: patch.allowOperatorReprint
          ? 'Se habilitó la reimpresión de comprobantes para Caja.'
          : 'Se restringió la reimpresión de comprobantes solo a Supervisión.',
        actor: actorLabel,
        createdAt: now,
      },
    );
  }

  return {
    ok: true,
    state: {
      ...state,
      settings: {
        ...(state.settings ?? {}),
        [branchId]: next,
      },
      auditLogs,
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

  const catalog = getBranchCatalog(state, input.branchId);
  let orderItems: OrderLineItem[] = [];

  if (input.items && input.items.length > 0) {
    const mergedByItemId = new Map<string, number>();
    for (const rawItem of input.items) {
      if (!Number.isInteger(rawItem.quantity) || rawItem.quantity < 1 || rawItem.quantity > 200) {
        return { ok: false, error: 'Cada partida debe tener una cantidad válida entre 1 y 200.' };
      }
      mergedByItemId.set(rawItem.itemId, (mergedByItemId.get(rawItem.itemId) ?? 0) + rawItem.quantity);
    }
    for (const [itemId, quantity] of mergedByItemId.entries()) {
      const product = catalog.find((entry) => entry.id === itemId && entry.active);
      if (!product) {
        return { ok: false, error: `El producto "${itemId}" no está disponible en ${getBranchInfo(input.branchId).name}.` };
      }
      const lineTotalCents = quantity * product.priceCents;
      if (!Number.isSafeInteger(lineTotalCents)) {
        return { ok: false, error: 'El importe calculado supera el límite permitido.' };
      }
      orderItems.push({
        itemId: product.id,
        name: product.name,
        quantity,
        unitPriceCents: product.priceCents,
        lineTotalCents,
        requiresMachine: product.requiresMachine,
        loyaltyCredits: product.loyaltyCredits,
      });
    }
  } else {
    const comboProduct = catalog.find((entry) => entry.id === 'combo') ?? DEFAULT_CATALOG[0];
    const comboCount = input.comboCount ?? 1;
    if (!Number.isSafeInteger(comboCount * comboProduct.priceCents) || !Number.isInteger(comboCount) || comboCount < 1) {
      return { ok: false, error: 'La cantidad de combos debe ser al menos 1.' };
    }
    orderItems = [
      {
        itemId: comboProduct.id,
        name: comboProduct.name,
        quantity: comboCount,
        unitPriceCents: comboProduct.priceCents,
        lineTotalCents: comboCount * comboProduct.priceCents,
        requiresMachine: comboProduct.requiresMachine,
        loyaltyCredits: comboProduct.loyaltyCredits,
      },
    ];
  }

  const totalCents = orderItems.reduce((sum, item) => sum + item.lineTotalCents, 0);
  const comboCount = Math.max(
    1,
    orderItems
      .filter((item) => item.requiresMachine || item.itemId === 'combo')
      .reduce((sum, item) => sum + item.quantity, 0) ||
      orderItems.reduce((sum, item) => sum + item.quantity, 0),
  );
  const comboLine = orderItems.find((item) => item.itemId === 'combo');
  const unitPriceCents = comboLine?.unitPriceCents ?? orderItems[0]?.unitPriceCents ?? getBranchSettings(state, input.branchId).comboPriceCents;

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
    items: orderItems,
    totalCents,
    encargoStage: input.serviceType === 'encargo' ? 'recibido' : null,
    orderStatus: 'en_proceso',
    createdAt: now,
    deliveredAt: null,
  };

  const payment = input.serviceType === 'encargo' && input.paymentLines.length === 0
    ? null
    : buildPaymentLines(order, input.paymentLines, openShift, now, input.actorLabel);
  if (payment && !payment.ok) return payment;

  const ticket: TicketState = {
    orderId,
    folio,
    status: 'no_emitido',
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    issuedAt: null,
    reprintCount: 0,
    lastReprintedAt: null,
    lastReprintedBy: null,
    simulated: true,
  };

  let auditLogs = state.auditLogs ?? [];
  for (const line of payment?.lines ?? []) {
    if (line.status === 'confirmado' && line.method !== 'efectivo') {
      auditLogs = appendAudit(
        { ...state, auditLogs },
        {
          branchId: input.branchId,
          category: 'pago',
          message:
            line.method === 'tarjeta'
              ? `Pago en terminal aprobado en ${folio} (${formatMxn(line.amountCents)})${line.reference ? ` · Ref: ${line.reference}` : ''}`
              : `Transferencia verificada en ${folio} (${formatMxn(line.amountCents)})${line.reference ? ` · Ref: ${line.reference}` : ''}`,
          actor: line.confirmedBy ?? input.actorLabel ?? 'Mostrador',
          createdAt: now,
        },
      );
    }
  }

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
    auditLogs,
  };

  return { ok: true, state: nextState, data: order };
}

function buildPaymentLines(
  order: Order,
  input: PaymentInputLine[],
  shift: Shift,
  now: string,
  actorLabel = 'Mostrador',
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
      const cleanRef = line.reference?.trim().slice(0, 60) || null;
      return {
        id: `pay-${order.id}-${line.method}`,
        orderId: order.id,
        method: line.method,
        amountCents: line.amountCents,
        cashReceivedCents: line.cashReceivedCents,
        status: confirmed ? 'confirmado' : 'pendiente',
        reference: cleanRef,
        createdAt: now,
        confirmedAt: confirmed ? now : null,
        confirmedBy: confirmed ? actorLabel : null,
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
  actorLabel = 'Mostrador',
): DomainResult<Order> {
  const order = state.orders.find((item) => item.id === orderId && item.serviceType === 'encargo');
  if (!order) return { ok: false, error: 'Encargo no encontrado.' };
  if (getOrderPaymentLines(state, orderId).length > 0) {
    return { ok: false, error: 'El folio ya tiene un cobro registrado.' };
  }
  const shift = getOpenShift(state, order.branchId);
  if (!shift) return { ok: false, error: 'Abre un turno para registrar el cobro.' };
  const payment = buildPaymentLines(order, input, shift, now, actorLabel);
  if (!payment.ok) return payment;

  let auditLogs = state.auditLogs ?? [];
  for (const line of payment.lines) {
    if (line.status === 'confirmado' && line.method !== 'efectivo') {
      auditLogs = appendAudit(
        { ...state, auditLogs },
        {
          branchId: order.branchId,
          category: 'pago',
          message:
            line.method === 'tarjeta'
              ? `Pago en terminal aprobado en ${order.folio} (${formatMxn(line.amountCents)})${line.reference ? ` · Ref: ${line.reference}` : ''}`
              : `Transferencia verificada en ${order.folio} (${formatMxn(line.amountCents)})${line.reference ? ` · Ref: ${line.reference}` : ''}`,
          actor: line.confirmedBy ?? actorLabel,
          createdAt: now,
        },
      );
    }
  }

  return {
    ok: true,
    state: { ...state, paymentLines: [...state.paymentLines, ...payment.lines], auditLogs },
    data: order,
  };
}

export function confirmPaymentLine(
  state: DemoState,
  paymentLineId: string,
  now = new Date().toISOString(),
  details: { reference?: string; actorLabel?: string } = {},
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

  const cleanRef = details.reference?.trim().slice(0, 60) || line.reference || null;
  const actorLabel = details.actorLabel?.trim() || 'Personal en turno';

  const updated: PaymentLine = {
    ...line,
    status: 'confirmado',
    reference: cleanRef,
    confirmedAt: now,
    confirmedBy: actorLabel,
    confirmedShiftId: openShift.id,
  };

  const auditLogs = appendAudit(state, {
    branchId: order.branchId,
    category: 'pago',
    message:
      line.method === 'tarjeta'
        ? `Pago aprobado en terminal confirmado en ${order.folio} (${formatMxn(line.amountCents)})${cleanRef ? ` · Ref: ${cleanRef}` : ''}`
        : `Transferencia verificada en ${order.folio} (${formatMxn(line.amountCents)})${cleanRef ? ` · Ref: ${cleanRef}` : ''}`,
    actor: actorLabel,
    createdAt: now,
  });

  return {
    ok: true,
    state: {
      ...state,
      paymentLines: state.paymentLines.map((p) => (p.id === paymentLineId ? updated : p)),
      auditLogs,
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
    reprintCount: ticket.reprintCount ?? 0,
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

export function canReprintTicket(
  state: DemoState,
  order: Order,
  actorRole: 'operator' | 'supervisor',
): boolean {
  if (actorRole === 'supervisor') return true;
  return Boolean(getBranchSettings(state, order.branchId).allowOperatorReprint);
}

export function reprintTicket(
  state: DemoState,
  orderId: string,
  options: { actorRole: 'operator' | 'supervisor'; actorLabel?: string; now?: string },
): DomainResult<TicketState> {
  const ticket = state.tickets[orderId];
  const order = state.orders.find((o) => o.id === orderId);
  if (!ticket || !order) {
    return { ok: false, error: 'Orden o comprobante no encontrado.' };
  }
  if (ticket.status !== 'emitido') {
    return { ok: false, error: 'Emite primero el comprobante antes de reimprimir.' };
  }
  if (!canReprintTicket(state, order, options.actorRole)) {
    return { ok: false, error: 'La reimpresión de comprobantes requiere autorización de Supervisión.' };
  }

  const now = options.now ?? new Date().toISOString();
  const actorLabel = options.actorLabel?.trim() || (options.actorRole === 'supervisor' ? 'Supervisión' : 'Caja');
  const nextCount = (ticket.reprintCount ?? 0) + 1;

  const updated: TicketState = {
    ...ticket,
    reprintCount: nextCount,
    lastReprintedAt: now,
    lastReprintedBy: actorLabel,
  };

  const auditLogs = appendAudit(state, {
    branchId: order.branchId,
    category: 'ticket',
    message: `Reimpresión #${nextCount} del comprobante ${order.folio}`,
    actor: actorLabel,
    createdAt: now,
  });

  return {
    ok: true,
    state: {
      ...state,
      tickets: { ...state.tickets, [orderId]: updated },
      auditLogs,
    },
    data: updated,
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
