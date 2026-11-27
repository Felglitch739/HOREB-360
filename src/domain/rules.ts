import { COMBO_PRICE_CENTS, formatMxn } from './money.ts';
import type {
  BranchAuditEntry,
  BranchExpense,
  BranchId,
  BranchInfo,
  BranchSettings,
  CashMovement,
  CatalogItem,
  Customer,
  DemoState,
  EncargoStage,
  ExpenseCategory,
  LoyaltyEvent,
  Machine,
  MachineKind,
  MachineStatus,
  Order,
  OrderLineItem,
  PaymentLine,
  PaymentMethod,
  RaffleDraw,
  RaffleTicket,
  Shift,
  ShiftClosingSummary,
  SupplyItem,
  TicketState,
} from './types.ts';

export const BRANCHES: BranchInfo[] = [
  { id: 'lomas', name: 'Lomas', folioPrefix: 'LOM' },
  { id: 'trevino', name: 'Treviño', folioPrefix: 'TRE' },
  { id: 'sucursal-3', name: 'Sucursal 3 (por confirmar)', folioPrefix: 'S3', provisional: true },
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
  customerId?: string;
  redeemFreeCombo?: boolean;
  comboCount?: number;
  items?: OrderItemInput[];
  machineIds?: string[];
  paymentLines: PaymentInputLine[];
  allowPartialPayment?: boolean;
  promisedDeliveryAt?: string | null;
  weightKg?: number | null;
  notes?: string | null;
  manualDiscountCents?: number;
  now?: string;
  actorLabel?: string;
}

export function getBranchMachines(state: DemoState, branchId: BranchId): Machine[] {
  return (state.machines ?? [])
    .filter((m) => m.branchId === branchId)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'lavadora' ? -1 : 1;
      return a.code.localeCompare(b.code, 'es-MX', { numeric: true });
    });
}

export function buildSampleBranchMachines(
  branchId: BranchId,
  now = new Date().toISOString(),
): Machine[] {
  const count = branchId === 'sucursal-3' ? 7 : 8;
  const washers: Machine[] = Array.from({ length: count }, (_, idx) => ({
    id: `${branchId}-L${idx + 1}`,
    branchId,
    code: `L${idx + 1}`,
    name: `Lavadora #${idx + 1}`,
    kind: 'lavadora',
    model: 'LG Giant C Max',
    capacityKg: 15,
    status: 'disponible',
    currentOrderId: null,
    currentOrderFolio: null,
    cycles: (idx + 1) * 14,
    updatedAt: now,
  }));
  const dryers: Machine[] = Array.from({ length: count }, (_, idx) => ({
    id: `${branchId}-S${idx + 1}`,
    branchId,
    code: `S${idx + 1}`,
    name: `Secadora #${idx + 1}`,
    kind: 'secadora',
    model: 'LG Giant C Pro',
    capacityKg: 16,
    status: 'disponible',
    currentOrderId: null,
    currentOrderFolio: null,
    cycles: (idx + 1) * 11,
    updatedAt: now,
  }));
  return [...washers, ...dryers];
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
    const existingIds = new Set(currentCatalog.map((item) => item.id));
    for (const incoming of patch.catalog) {
      if (existingIds.has(incoming.id)) continue;
      const cleanId = incoming.id.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(0, 40);
      const cleanName = incoming.name.trim().slice(0, 80);
      if (!cleanId || !cleanName) {
        return { ok: false, error: 'El nuevo producto debe incluir un nombre válido.' };
      }
      if (!Number.isSafeInteger(incoming.priceCents) || incoming.priceCents < 100 || incoming.priceCents > 10_000_000) {
        return { ok: false, error: `El precio de "${cleanName}" debe ser al menos $1.00 MXN.` };
      }
      existingIds.add(cleanId);
      validated.push({
        id: cleanId,
        name: cleanName,
        priceCents: incoming.priceCents,
        requiresMachine: Boolean(incoming.requiresMachine),
        loyaltyCredits: Number.isInteger(incoming.loyaltyCredits) ? Math.max(0, Math.min(10, incoming.loyaltyCredits)) : 0,
        pricePendingConfirmation: Boolean(incoming.pricePendingConfirmation),
        active: incoming.active !== false,
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
    branchDisplayName:
      patch.branchDisplayName !== undefined
        ? patch.branchDisplayName.trim().slice(0, 60) || undefined
        : current.branchDisplayName,
    branchAddress:
      patch.branchAddress !== undefined
        ? patch.branchAddress.trim().slice(0, 120) || undefined
        : current.branchAddress,
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
  for (const nextItem of nextCatalog) {
    if (!currentCatalog.some((prevItem) => prevItem.id === nextItem.id)) {
      auditLogs = appendAudit(
        { ...state, auditLogs },
        {
          branchId,
          category: 'precio',
          message: `Producto agregado al catálogo: ${nextItem.name} (${formatMxn(nextItem.priceCents)})`,
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

export function getBranchDisplayName(state: DemoState, branchId: BranchId): string {
  return state.settings?.[branchId]?.branchDisplayName?.trim() || getBranchInfo(branchId).name;
}

export interface DailyRevenueTrendResult {
  days: Array<{ date: Date; totalCents: number }>;
  periodTotalCents: number;
  historicalTotalCents: number;
  startDate: Date;
  endDate: Date;
  anchoredToHistory: boolean;
}

/**
 * Fuente única de verdad para la tendencia de ingresos diarios confirmados.
 * Si hoy no hay movimientos pero existen cobros confirmados previos, ancla la ventana
 * a la fecha de actividad más reciente para mostrar datos reales consistentes.
 */
export function buildDailyRevenueTrend(
  state: DemoState,
  orderIds: Set<string>,
  daysCount = 7,
  referenceDate = new Date(),
): DailyRevenueTrendResult {
  const confirmedLines = state.paymentLines.filter(
    (line) => line.status === 'confirmado' && orderIds.has(line.orderId),
  );
  const historicalTotalCents = confirmedLines.reduce((sum, line) => sum + line.amountCents, 0);

  const todayEnd = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate() + 1,
  );
  const windowStartToday = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate() - (daysCount - 1),
  );

  let hasActivityInCurrentWindow = false;
  let latestTimestamp = 0;

  for (const line of confirmedLines) {
    const rawIso = line.confirmedAt ?? line.createdAt;
    const ms = new Date(rawIso).getTime();
    if (!Number.isFinite(ms)) continue;
    if (ms > latestTimestamp) latestTimestamp = ms;
    if (ms >= windowStartToday.getTime() && ms < todayEnd.getTime()) {
      hasActivityInCurrentWindow = true;
    }
  }

  const anchoredToHistory = !hasActivityInCurrentWindow && latestTimestamp > 0;
  const anchor = anchoredToHistory ? new Date(latestTimestamp) : referenceDate;

  const days = Array.from({ length: daysCount }, (_, index) => {
    const date = new Date(
      anchor.getFullYear(),
      anchor.getMonth(),
      anchor.getDate() - (daysCount - 1) + index,
    );
    const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    const totalCents = confirmedLines.reduce((sum, line) => {
      const ts = new Date(line.confirmedAt ?? line.createdAt);
      return ts >= date && ts < end ? sum + line.amountCents : sum;
    }, 0);
    return { date, totalCents };
  });

  const periodTotalCents = days.reduce((sum, d) => sum + d.totalCents, 0);
  return {
    days,
    periodTotalCents,
    historicalTotalCents,
    startDate: days[0]?.date ?? referenceDate,
    endDate: days[days.length - 1]?.date ?? referenceDate,
    anchoredToHistory,
  };
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
  const confirmed = { efectivo: 0, tarjeta: 0, transferencia: 0 };
  let pendingCents = branchOrders.reduce((sum, order) => sum + order.totalCents, 0);
  for (const line of state.paymentLines) {
    if (line.status !== 'confirmado' || !orderIds.has(line.orderId)) continue;
    confirmed[line.method] += line.amountCents;
    pendingCents -= line.amountCents;
  }
  const { efectivo: cashCents, tarjeta: cardCents, transferencia: transferCents } = confirmed;

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

  const rawTotalCents = orderItems.reduce((sum, item) => sum + item.lineTotalCents, 0);
  const comboCount = Math.max(
    1,
    orderItems
      .filter((item) => item.requiresMachine || item.itemId === 'combo')
      .reduce((sum, item) => sum + item.quantity, 0) ||
      orderItems.reduce((sum, item) => sum + item.quantity, 0),
  );
  const comboLine = orderItems.find((item) => item.itemId === 'combo');
  const unitPriceCents = comboLine?.unitPriceCents ?? orderItems[0]?.unitPriceCents ?? getBranchSettings(state, input.branchId).comboPriceCents;

  const customer = input.customerId
    ? (state.customers ?? []).find((c) => c.id === input.customerId)
    : undefined;
  if (input.customerId && !customer) {
    return { ok: false, error: 'Cliente no encontrado en el catálogo.' };
  }

  let freeCombosRedeemed = 0;
  let loyaltyDiscountCents = 0;
  if (input.redeemFreeCombo) {
    if (!customer) {
      return { ok: false, error: 'Selecciona la ficha del cliente para canjear el combo gratis.' };
    }
    if (customer.freeCombosAvailable < 1) {
      return { ok: false, error: 'Este cliente aún no tiene combos gratis habilitados.' };
    }
    if (!comboLine || comboLine.quantity < 1) {
      return { ok: false, error: 'Agrega al menos 1 Combo Lavado + Secado para canjear el premio.' };
    }
    freeCombosRedeemed = 1;
    loyaltyDiscountCents = comboLine.unitPriceCents;
  }

  const manualDiscountCents =
    input.manualDiscountCents && Number.isSafeInteger(input.manualDiscountCents) && input.manualDiscountCents > 0
      ? Math.min(input.manualDiscountCents, Math.max(0, rawTotalCents - loyaltyDiscountCents))
      : 0;

  const totalCents = Math.max(0, rawTotalCents - loyaltyDiscountCents - manualDiscountCents);

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
      ? input.customerAlias?.trim() || customer?.name || ''
      : customer?.name || 'Autoservicio';

  if (input.serviceType === 'encargo' && !customerAlias) {
    return {
      ok: false,
      error: 'Captura el nombre o referencia del cliente para registrar el encargo.',
    };
  }

  const orderId = `ord-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const requestedMachineIds = Array.from(new Set(input.machineIds ?? []));
  let nextMachines = state.machines ?? [];
  let assignedLabels: string[] = [];

  if (requestedMachineIds.length > 0) {
    const check = validateMachinesAvailableForOrder(state, input.branchId, requestedMachineIds);
    if (!check.ok) return check;
    assignedLabels = check.machines.map((m) => `${m.code} (${m.name})`);
    const selectedSet = new Set(requestedMachineIds);
    nextMachines = nextMachines.map((m) =>
      selectedSet.has(m.id)
        ? {
            ...m,
            status: 'en_uso',
            currentOrderId: orderId,
            currentOrderFolio: folio,
            updatedAt: now,
            updatedBy: input.actorLabel ?? 'Mostrador',
          }
        : m,
    );
  }

  const cleanWeight =
    input.weightKg !== undefined && input.weightKg !== null && Number.isFinite(input.weightKg) && input.weightKg > 0
      ? Math.round(input.weightKg * 100) / 100
      : null;
  const cleanNotes = input.notes?.trim().slice(0, 160) || null;
  const cleanPromised = input.promisedDeliveryAt?.trim().slice(0, 40) || null;

  const order: Order = {
    id: orderId,
    folio,
    branchId: input.branchId,
    shiftId: openShift.id,
    serviceType: input.serviceType,
    customerAlias,
    customerId: customer?.id ?? null,
    customerPhone: customer?.phone ?? null,
    comboCount,
    unitPriceCents,
    items: orderItems,
    freeCombosRedeemed,
    loyaltyDiscountCents,
    manualDiscountCents: manualDiscountCents > 0 ? manualDiscountCents : undefined,
    loyaltyProcessedAt: null,
    totalCents,
    encargoStage: input.serviceType === 'encargo' ? 'recibido' : null,
    orderStatus: 'en_proceso',
    assignedMachineIds: requestedMachineIds,
    assignedMachineLabels: assignedLabels,
    promisedDeliveryAt: cleanPromised,
    weightKg: cleanWeight,
    notes: cleanNotes,
    createdAt: now,
    deliveredAt: null,
  };

  const allowPartial = Boolean(input.allowPartialPayment && input.serviceType === 'encargo');
  const payment = (input.serviceType === 'encargo' && input.paymentLines.length === 0 && totalCents > 0) ||
    (totalCents === 0 && input.paymentLines.length === 0)
    ? null
    : buildPaymentLines(order, input.paymentLines, openShift, now, input.actorLabel, {
        targetAmountCents: totalCents,
        allowPartial,
      });
  if (payment && !payment.ok) return payment;

  let nextCustomers = state.customers ?? [];
  let nextLoyaltyEvents = state.loyaltyEvents ?? [];
  let auditLogs = state.auditLogs ?? [];

  if (freeCombosRedeemed > 0 && customer) {
    nextCustomers = nextCustomers.map((c) =>
      c.id === customer.id
        ? { ...c, freeCombosAvailable: Math.max(0, c.freeCombosAvailable - freeCombosRedeemed) }
        : c,
    );
    nextLoyaltyEvents = [
      ...nextLoyaltyEvents,
      {
        id: `ley-${orderId}-redeem`,
        customerId: customer.id,
        orderId,
        branchId: input.branchId,
        eventType: 'free_combo_redeemed',
        delta: -freeCombosRedeemed,
        createdAt: now,
        note: `Combo gratis canjeado en ${folio}`,
      },
    ];
    auditLogs = appendAudit(
      { ...state, auditLogs },
      {
        branchId: input.branchId,
        category: 'lealtad',
        message: `${customer.name} aplicó 1 combo gratis en ${folio} (-${formatMxn(loyaltyDiscountCents)})`,
        actor: input.actorLabel ?? 'Mostrador',
        createdAt: now,
      },
    );
  }

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
    machines: nextMachines,
    customers: nextCustomers,
    loyaltyEvents: nextLoyaltyEvents,
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
  options: { targetAmountCents?: number; allowPartial?: boolean; suffix?: string } = {},
): { ok: true; lines: PaymentLine[] } | { ok: false; error: string } {
  if (input.length === 0) {
    return { ok: false, error: 'Captura al menos un método de pago.' };
  }
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
  const targetAmountCents = options.targetAmountCents ?? order.totalCents;
  const sum = input.reduce((total, line) => total + line.amountCents, 0);
  if (options.allowPartial) {
    if (sum <= 0 || sum > targetAmountCents) {
      return {
        ok: false,
        error: `El anticipo (${formatMxn(sum)}) debe ser mayor a $0.00 y no superar ${formatMxn(targetAmountCents)}.`,
      };
    }
  } else if (sum !== targetAmountCents) {
    return {
      ok: false,
      error: `El reparto de pago (${formatMxn(sum)}) debe sumar exactamente ${formatMxn(targetAmountCents)}.`,
    };
  }
  const suffix = options.suffix ? `-${options.suffix}` : '';
  return {
    ok: true,
    lines: input.map((line) => {
      const confirmed = line.method === 'efectivo' || Boolean(line.confirmImmediately);
      const cleanRef = line.reference?.trim().slice(0, 60) || null;
      return {
        id: `pay-${order.id}-${line.method}${suffix}`,
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
  const existingLines = getOrderPaymentLines(state, orderId);
  const alreadyRecordedCents = existingLines.reduce((sum, line) => sum + line.amountCents, 0);
  const remainingToRecordCents = order.totalCents - alreadyRecordedCents;
  if (remainingToRecordCents <= 0) {
    return { ok: false, error: 'El folio ya tiene un cobro registrado.' };
  }
  const shift = getOpenShift(state, order.branchId);
  if (!shift) return { ok: false, error: 'Abre un turno para registrar el cobro.' };
  const payment = buildPaymentLines(order, input, shift, now, actorLabel, {
    targetAmountCents: remainingToRecordCents,
    suffix: existingLines.length > 0 ? String(existingLines.length + 1) : '',
  });
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

  const withConfirmation: DemoState = {
    ...state,
    paymentLines: state.paymentLines.map((p) => (p.id === paymentLineId ? updated : p)),
    auditLogs,
  };

  return {
    ok: true,
    state: evaluateOrderLoyalty(withConfirmation, order.id, now),
    data: updated,
  };
}

function validateMachinesAvailableForOrder(
  state: DemoState,
  branchId: BranchId,
  machineIds: string[],
  excludeOrderId?: string,
): { ok: true; machines: Machine[] } | { ok: false; error: string } {
  const branchMachines = getBranchMachines(state, branchId);
  const found: Machine[] = [];
  for (const machineId of machineIds) {
    const machine = branchMachines.find((m) => m.id === machineId);
    if (!machine) {
      return { ok: false, error: 'Una de las máquinas seleccionadas no pertenece a esta sucursal.' };
    }
    if (machine.status === 'fuera_de_servicio') {
      return { ok: false, error: `La máquina ${machine.code} está marcada fuera de servicio.` };
    }
    if (machine.status === 'en_uso' && machine.currentOrderId !== excludeOrderId) {
      return {
        ok: false,
        error: `La máquina ${machine.code} ya está ocupada por el folio ${machine.currentOrderFolio ?? machine.currentOrderId}.`,
      };
    }
    const occupiedByOtherOrder = state.orders.find(
      (order) =>
        order.branchId === branchId &&
        order.id !== excludeOrderId &&
        order.orderStatus !== 'entregado' &&
        (order.assignedMachineIds ?? []).includes(machineId),
    );
    if (occupiedByOtherOrder) {
      return {
        ok: false,
        error: `La máquina ${machine.code} ya está asignada al folio ${occupiedByOtherOrder.folio}.`,
      };
    }
    found.push(machine);
  }
  return { ok: true, machines: found };
}

function releaseMachinesForOrder(
  machines: Machine[],
  orderId: string,
  options: { incrementCycles?: boolean; now: string; actorLabel?: string },
): Machine[] {
  return machines.map((m) => {
    if (m.currentOrderId !== orderId) return m;
    return {
      ...m,
      status: m.status === 'fuera_de_servicio' ? 'fuera_de_servicio' : 'disponible',
      currentOrderId: null,
      currentOrderFolio: null,
      cycles: options.incrementCycles ? m.cycles + 1 : m.cycles,
      updatedAt: options.now,
      updatedBy: options.actorLabel ?? m.updatedBy,
    };
  });
}

export function buildOrderReadyWhatsappMessage(
  order: Order,
  branchName: string,
  pendingCents: number,
): string {
  const balanceNote =
    pendingCents > 0 ? ` Saldo pendiente: ${formatMxn(pendingCents)}.` : ' Pagado en su totalidad.';
  return `Hola ${order.customerAlias}, tu encargo Folio ${order.folio} en Lavandería Horeb (${branchName}) ya está LISTO para recoger.${balanceNote}`;
}

export function upsertMachine(
  state: DemoState,
  branchId: BranchId,
  input: {
    id?: string;
    code: string;
    name: string;
    kind: MachineKind;
    model?: string;
    serialNumber?: string;
    capacityKg?: number;
  },
  actorLabel = 'Supervisión',
  now = new Date().toISOString(),
): DomainResult<Machine> {
  const code = input.code.trim().toUpperCase().slice(0, 12);
  const name = input.name.trim().slice(0, 50);
  if (!code || !name) {
    return { ok: false, error: 'Captura el código (ej. L1) y el nombre del equipo.' };
  }
  const existingList = state.machines ?? [];
  const duplicateCode = existingList.find(
    (m) => m.branchId === branchId && m.code.toUpperCase() === code && m.id !== input.id,
  );
  if (duplicateCode) {
    return { ok: false, error: `Ya existe un equipo con el código ${code} en esta sucursal.` };
  }

  const cleanModel = input.model?.trim().slice(0, 60) || undefined;
  const cleanSerial = input.serialNumber?.trim().slice(0, 50) || undefined;
  const cleanCap =
    input.capacityKg !== undefined && Number.isFinite(input.capacityKg) && input.capacityKg > 0
      ? Math.round(input.capacityKg * 10) / 10
      : undefined;

  const target = input.id ? existingList.find((m) => m.id === input.id && m.branchId === branchId) : undefined;
  const saved: Machine = target
    ? {
        ...target,
        code,
        name,
        kind: input.kind,
        model: cleanModel,
        serialNumber: cleanSerial,
        capacityKg: cleanCap,
        updatedAt: now,
        updatedBy: actorLabel,
      }
    : {
        id: `${branchId}-${code.toLowerCase().replace(/[^a-z0-9]/g, '')}-${Date.now().toString(36)}`,
        branchId,
        code,
        name,
        kind: input.kind,
        model: cleanModel,
        serialNumber: cleanSerial,
        capacityKg: cleanCap,
        status: 'disponible',
        currentOrderId: null,
        currentOrderFolio: null,
        cycles: 0,
        updatedAt: now,
        updatedBy: actorLabel,
      };

  const nextMachines = target
    ? existingList.map((m) => (m.id === saved.id ? saved : m))
    : [...existingList, saved];

  const auditLogs = appendAudit(state, {
    branchId,
    category: 'equipo',
    message: target ? `Equipo actualizado: ${saved.code} (${saved.name})` : `Equipo agregado al padrón: ${saved.code} (${saved.name})`,
    actor: actorLabel,
    createdAt: now,
  });

  return { ok: true, state: { ...state, machines: nextMachines, auditLogs }, data: saved };
}

export function deleteMachine(
  state: DemoState,
  branchId: BranchId,
  machineId: string,
  actorLabel = 'Supervisión',
  now = new Date().toISOString(),
): DomainResult<{ id: string }> {
  const existing = (state.machines ?? []).find((m) => m.id === machineId && m.branchId === branchId);
  if (!existing) return { ok: false, error: 'Equipo no encontrado en esta sucursal.' };
  if (existing.status === 'en_uso' || existing.currentOrderId) {
    return { ok: false, error: `Libera primero el equipo ${existing.code} antes de eliminarlo.` };
  }
  const nextMachines = (state.machines ?? []).filter((m) => m.id !== machineId);
  const auditLogs = appendAudit(state, {
    branchId,
    category: 'equipo',
    message: `Equipo dado de baja del padrón: ${existing.code} (${existing.name})`,
    actor: actorLabel,
    createdAt: now,
  });
  return { ok: true, state: { ...state, machines: nextMachines, auditLogs }, data: { id: machineId } };
}

export function seedSampleMachinesForBranch(
  state: DemoState,
  branchId: BranchId,
  actorLabel = 'Supervisión',
  now = new Date().toISOString(),
): DomainResult<Machine[]> {
  if (getBranchMachines(state, branchId).length > 0) {
    return { ok: false, error: 'Esta sucursal ya tiene máquinas registradas.' };
  }
  const sample = buildSampleBranchMachines(branchId, now);
  const auditLogs = appendAudit(state, {
    branchId,
    category: 'equipo',
    message: `Padrón de prueba cargado (${sample.length} equipos base editables).`,
    actor: actorLabel,
    createdAt: now,
  });
  return {
    ok: true,
    state: { ...state, machines: [...(state.machines ?? []), ...sample], auditLogs },
    data: sample,
  };
}

export function setMachineStatus(
  state: DemoState,
  branchId: BranchId,
  machineId: string,
  status: Extract<MachineStatus, 'disponible' | 'fuera_de_servicio'>,
  options: { reason?: string; actorLabel?: string; now?: string } = {},
): DomainResult<Machine> {
  const now = options.now ?? new Date().toISOString();
  const actorLabel = options.actorLabel?.trim() || 'Personal';
  const existing = (state.machines ?? []).find((m) => m.id === machineId && m.branchId === branchId);
  if (!existing) return { ok: false, error: 'Máquina no encontrada.' };

  if (existing.status === 'en_uso' && status === 'fuera_de_servicio') {
    return {
      ok: false,
      error: `La máquina ${existing.code} está en uso en el folio ${existing.currentOrderFolio ?? ''}. Libérala o reasigna la orden primero.`,
    };
  }

  const releasedOrderId = existing.status === 'en_uso' ? existing.currentOrderId : null;
  const updated: Machine = {
    ...existing,
    status,
    currentOrderId: null,
    currentOrderFolio: null,
    cycles: releasedOrderId ? existing.cycles + 1 : existing.cycles,
    outOfServiceReason: status === 'fuera_de_servicio' ? options.reason?.trim().slice(0, 100) || null : null,
    updatedAt: now,
    updatedBy: actorLabel,
  };

  const nextOrders = releasedOrderId
    ? state.orders.map((o) =>
        o.id === releasedOrderId
          ? {
              ...o,
              assignedMachineIds: (o.assignedMachineIds ?? []).filter((id) => id !== machineId),
              assignedMachineLabels: (o.assignedMachineLabels ?? []).filter((label) => !label.startsWith(`${existing.code} `)),
            }
          : o,
      )
    : state.orders;

  const auditLogs = appendAudit(state, {
    branchId,
    category: 'equipo',
    message:
      status === 'fuera_de_servicio'
        ? `Máquina ${existing.code} marcada FUERA DE SERVICIO${updated.outOfServiceReason ? ` (${updated.outOfServiceReason})` : ''}`
        : releasedOrderId
          ? `Máquina ${existing.code} liberada y marcada disponible`
          : `Máquina ${existing.code} habilitada como disponible`,
    actor: actorLabel,
    createdAt: now,
  });

  return {
    ok: true,
    state: {
      ...state,
      orders: nextOrders,
      machines: (state.machines ?? []).map((m) => (m.id === machineId ? updated : m)),
      auditLogs,
    },
    data: updated,
  };
}

export function assignOrderMachines(
  state: DemoState,
  orderId: string,
  machineIds: string[],
  actorLabel = 'Personal',
  now = new Date().toISOString(),
): DomainResult<Order> {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, error: 'Orden no encontrada.' };
  if (order.orderStatus === 'entregado') {
    return { ok: false, error: 'No se pueden asignar máquinas a una orden ya entregada.' };
  }

  const uniqueIds = Array.from(new Set(machineIds));
  if (uniqueIds.length > 0) {
    const check = validateMachinesAvailableForOrder(state, order.branchId, uniqueIds, order.id);
    if (!check.ok) return check;
  }

  let nextMachines = releaseMachinesForOrder(state.machines ?? [], order.id, {
    incrementCycles: false,
    now,
    actorLabel,
  });

  const selectedSet = new Set(uniqueIds);
  const labels: string[] = [];
  nextMachines = nextMachines.map((m) => {
    if (!selectedSet.has(m.id)) return m;
    labels.push(`${m.code} (${m.name})`);
    return {
      ...m,
      status: 'en_uso',
      currentOrderId: order.id,
      currentOrderFolio: order.folio,
      updatedAt: now,
      updatedBy: actorLabel,
    };
  });

  const updatedOrder: Order = {
    ...order,
    assignedMachineIds: uniqueIds,
    assignedMachineLabels: labels,
  };

  const auditLogs = appendAudit(state, {
    branchId: order.branchId,
    category: 'equipo',
    message:
      labels.length > 0
        ? `Equipos asignados a ${order.folio}: ${labels.map((l) => l.split(' ')[0]).join(', ')}`
        : `Equipos liberados en folio ${order.folio}`,
    actor: actorLabel,
    createdAt: now,
  });

  return {
    ok: true,
    state: {
      ...state,
      orders: state.orders.map((o) => (o.id === orderId ? updatedOrder : o)),
      machines: nextMachines,
      auditLogs,
    },
    data: updatedOrder,
  };
}

export function advanceEncargoStage(
  state: DemoState,
  orderId: string,
  options: { machineIds?: string[]; actorLabel?: string; now?: string } = {},
): DomainResult<Order> {
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

  const now = options.now ?? new Date().toISOString();
  const actorLabel = options.actorLabel?.trim() || 'Personal';
  const requestedMachineIds = Array.from(new Set(options.machineIds ?? []));

  if (requestedMachineIds.length > 0 && (nextStage === 'lavado' || nextStage === 'secado')) {
    const check = validateMachinesAvailableForOrder(state, order.branchId, requestedMachineIds, order.id);
    if (!check.ok) return check;
  }

  // Al avanzar de etapa, libera las máquinas asignadas a la etapa anterior y cuenta su ciclo.
  let nextMachines = releaseMachinesForOrder(state.machines ?? [], order.id, {
    incrementCycles: true,
    now,
    actorLabel,
  });

  let nextAssignedIds: string[] = [];
  let nextAssignedLabels: string[] = [];

  if (requestedMachineIds.length > 0 && (nextStage === 'lavado' || nextStage === 'secado')) {
    const selectedSet = new Set(requestedMachineIds);
    nextMachines = nextMachines.map((m) => {
      if (!selectedSet.has(m.id)) return m;
      nextAssignedIds.push(m.id);
      nextAssignedLabels.push(`${m.code} (${m.name})`);
      return {
        ...m,
        status: 'en_uso',
        currentOrderId: order.id,
        currentOrderFolio: order.folio,
        updatedAt: now,
        updatedBy: actorLabel,
      };
    });
  }

  const branchName = getBranchInfo(order.branchId).name;
  const pendingCents = getOrderPendingCents(state, order.id);

  const updated: Order = {
    ...order,
    encargoStage: nextStage,
    orderStatus: nextStage === 'listo' ? 'listo' : 'en_proceso',
    assignedMachineIds: nextAssignedIds,
    assignedMachineLabels: nextAssignedLabels,
    whatsappPreparedAt: nextStage === 'listo' ? now : order.whatsappPreparedAt,
    whatsappMessage:
      nextStage === 'listo'
        ? buildOrderReadyWhatsappMessage(order, branchName, pendingCents)
        : order.whatsappMessage,
  };

  return {
    ok: true,
    state: {
      ...state,
      orders: state.orders.map((o) => (o.id === orderId ? updated : o)),
      machines: nextMachines,
    },
    data: updated,
  };
}

export function recordOrderWhatsappSent(
  state: DemoState,
  orderId: string,
  actorLabel = 'Personal',
  now = new Date().toISOString(),
): DomainResult<Order> {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, error: 'Orden no encontrada.' };
  if (order.serviceType !== 'encargo' || (order.encargoStage !== 'listo' && order.encargoStage !== 'entregado')) {
    return { ok: false, error: 'El encargo debe estar en etapa Listo para registrar el aviso de WhatsApp.' };
  }
  const branchName = getBranchInfo(order.branchId).name;
  const pendingCents = getOrderPendingCents(state, order.id);
  const updated: Order = {
    ...order,
    whatsappPreparedAt: order.whatsappPreparedAt ?? now,
    whatsappMessage: order.whatsappMessage ?? buildOrderReadyWhatsappMessage(order, branchName, pendingCents),
    whatsappSentAt: now,
    whatsappSentBy: actorLabel,
  };
  const auditLogs = appendAudit(state, {
    branchId: order.branchId,
    category: 'aviso',
    message: `Aviso de WhatsApp registrado como enviado para ${order.folio}`,
    actor: actorLabel,
    createdAt: now,
  });
  return {
    ok: true,
    state: {
      ...state,
      orders: state.orders.map((o) => (o.id === orderId ? updated : o)),
      auditLogs,
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
  const nextState: DemoState = {
    ...state,
    orders: state.orders.map((o) => (o.id === orderId ? updated : o)),
    machines: releaseMachinesForOrder(state.machines ?? [], orderId, { incrementCycles: false, now }),
  };
  const withLoyalty = evaluateOrderLoyalty(nextState, orderId, now);
  return {
    ok: true,
    state: withLoyalty,
    data: withLoyalty.orders.find((o) => o.id === orderId)!,
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
    const evaluated = evaluateOrderLoyalty(state, orderId, options.now ?? ticket.issuedAt ?? new Date().toISOString());
    return { ok: true, state: evaluated, data: evaluated.tickets[orderId] ?? ticket };
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

  const nextState: DemoState = {
    ...state,
    orders: order.serviceType === 'autoservicio'
      ? state.orders.map((item) => item.id === orderId ? { ...item, orderStatus: 'completado' } : item)
      : state.orders,
    tickets: { ...state.tickets, [orderId]: issued },
  };

  const withLoyalty = evaluateOrderLoyalty(nextState, orderId, now);

  return {
    ok: true,
    state: withLoyalty,
    data: issued,
  };
}

export function getCustomers(state: DemoState): Customer[] {
  return [...(state.customers ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'es-MX'));
}

export function getCustomerOrders(state: DemoState, customerId: string): Order[] {
  return state.orders
    .filter((o) => o.customerId === customerId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function upsertCustomer(
  state: DemoState,
  branchId: BranchId,
  input: { id?: string; name: string; phone: string; contactConsent: boolean },
  actorLabel = 'Mostrador',
  now = new Date().toISOString(),
): DomainResult<Customer> {
  const name = input.name.trim().slice(0, 80);
  const digits = input.phone.replace(/\D/g, '').slice(0, 15);
  if (!name) {
    return { ok: false, error: 'Captura el nombre completo del cliente.' };
  }
  if (digits.length < 8) {
    return { ok: false, error: 'Captura un teléfono de al menos 8 dígitos.' };
  }

  const existingList = state.customers ?? [];
  const duplicatePhone = existingList.find((c) => c.phone.replace(/\D/g, '') === digits && c.id !== input.id);
  if (duplicatePhone) {
    return {
      ok: false,
      error: `Ya existe un cliente registrado con el teléfono ${digits} (${duplicatePhone.name}).`,
    };
  }

  const target = input.id ? existingList.find((c) => c.id === input.id) : undefined;
  const saved: Customer = target
    ? { ...target, name, phone: digits, contactConsent: input.contactConsent }
    : {
        id: `cust-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        phone: digits,
        contactConsent: input.contactConsent,
        combosTowardFree: 0,
        freeCombosAvailable: 0,
        createdAt: now,
        createdBranchId: branchId,
      };

  const nextCustomers = target
    ? existingList.map((c) => (c.id === saved.id ? saved : c))
    : [saved, ...existingList];

  const auditLogs = appendAudit(state, {
    branchId,
    category: 'lealtad',
    message: target ? `Ficha de cliente actualizada: ${saved.name}` : `Cliente registrado: ${saved.name} (${saved.phone})`,
    actor: actorLabel,
    createdAt: now,
  });

  return { ok: true, state: { ...state, customers: nextCustomers, auditLogs }, data: saved };
}

export function isOrderCompletedAndPaid(state: DemoState, orderId: string): boolean {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return false;
  if (!isOrderFullyPaid(state, orderId)) return false;
  const ticket = state.tickets[orderId];
  if (!ticket || ticket.status !== 'emitido') return false;
  if (order.serviceType === 'autoservicio') {
    return order.orderStatus === 'completado';
  }
  return order.encargoStage === 'entregado';
}

export function evaluateOrderLoyalty(
  state: DemoState,
  orderId: string,
  now = new Date().toISOString(),
): DemoState {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order || !order.customerId) return state;
  if (order.loyaltyProcessedAt) return state;

  const existingEvents = state.loyaltyEvents ?? [];
  if (
    existingEvents.some(
      (ev) =>
        ev.orderId === orderId &&
        (ev.eventType === 'combos_earned' || ev.eventType === 'raffle_ticket_issued'),
    )
  ) {
    return state;
  }

  if (!isOrderCompletedAndPaid(state, orderId)) return state;

  const customer = (state.customers ?? []).find((c) => c.id === order.customerId);
  if (!customer) return state;

  const totalLoyaltyCombos = getOrderLineItems(order).reduce(
    (sum, item) => sum + (item.loyaltyCredits ?? 0) * item.quantity,
    0,
  );
  const freeRedeemed = order.freeCombosRedeemed ?? 0;
  const paidCombos = Math.max(0, totalLoyaltyCombos - freeRedeemed);

  const combinedProgress = customer.combosTowardFree + paidCombos;
  const unlockedFree = Math.floor(combinedProgress / 10);
  const nextProgress = combinedProgress % 10;
  const nextFreeAvailable = customer.freeCombosAvailable + unlockedFree;

  const newEvents: LoyaltyEvent[] = [];
  if (paidCombos > 0) {
    newEvents.push({
      id: `ley-${orderId}-earned`,
      customerId: customer.id,
      orderId,
      branchId: order.branchId,
      eventType: 'combos_earned',
      delta: paidCombos,
      createdAt: now,
      note: `${paidCombos} combo(s) pagado(s) y completado(s) en ${order.folio}`,
    });
  }
  if (unlockedFree > 0) {
    newEvents.push({
      id: `ley-${orderId}-unlocked`,
      customerId: customer.id,
      orderId,
      branchId: order.branchId,
      eventType: 'free_combo_unlocked',
      delta: unlockedFree,
      createdAt: now,
      note: `10 combos alcanzados en ${order.folio}: ${unlockedFree} combo gratis habilitado`,
    });
  }

  const existingTickets = state.raffleTickets ?? [];
  const nextTickets = [...existingTickets];
  let auditLogs = state.auditLogs ?? [];

  if (freeRedeemed > 0 && !existingTickets.some((t) => t.orderId === orderId)) {
    const year = new Date(now).getFullYear();
    const countYear = nextTickets.filter((t) => t.year === year).length;
    const ticketCode = `RIFA-${year}-${String(countYear + 1).padStart(4, '0')}`;
    const raffleTicket: RaffleTicket = {
      id: `rt-${orderId}`,
      ticketCode,
      year,
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      orderId,
      orderFolio: order.folio,
      branchId: order.branchId,
      issuedAt: now,
    };
    nextTickets.push(raffleTicket);
    newEvents.push({
      id: `ley-${orderId}-raffle`,
      customerId: customer.id,
      orderId,
      branchId: order.branchId,
      eventType: 'raffle_ticket_issued',
      delta: 1,
      createdAt: now,
      note: `Boleto ${ticketCode} emitido al completar combo gratis (${order.folio})`,
    });
    auditLogs = appendAudit(
      { ...state, auditLogs },
      {
        branchId: order.branchId,
        category: 'rifa',
        message: `Boleto ${ticketCode} emitido para ${customer.name} al completar ${order.folio}`,
        actor: 'Sistema lealtad',
        createdAt: now,
      },
    );
  }

  const nextCustomers = (state.customers ?? []).map((c) =>
    c.id === customer.id
      ? {
          ...c,
          combosTowardFree: nextProgress,
          freeCombosAvailable: nextFreeAvailable,
        }
      : c,
  );

  const nextOrders = state.orders.map((o) =>
    o.id === orderId ? { ...o, loyaltyProcessedAt: now } : o,
  );

  return {
    ...state,
    customers: nextCustomers,
    orders: nextOrders,
    loyaltyEvents: [...existingEvents, ...newEvents],
    raffleTickets: nextTickets,
    auditLogs,
  };
}

export function getEligibleRaffleTickets(state: DemoState, year: number): RaffleTicket[] {
  const wonIds = new Set((state.raffleDraws ?? []).map((d) => d.winnerTicketId));
  return (state.raffleTickets ?? []).filter((t) => t.year === year && !wonIds.has(t.id));
}

export function runManualRaffleDraw(
  state: DemoState,
  branchId: BranchId,
  options: { year?: number; notes?: string; winnerTicketId?: string; actorLabel?: string; now?: string } = {},
): DomainResult<RaffleDraw> {
  const now = options.now ?? new Date().toISOString();
  const year = options.year ?? new Date(now).getFullYear();
  const eligible = getEligibleRaffleTickets(state, year);
  if (eligible.length === 0) {
    return { ok: false, error: `No hay boletos elegibles disponibles para la rifa ${year}.` };
  }

  const picked = options.winnerTicketId
    ? eligible.find((t) => t.id === options.winnerTicketId)
    : eligible[Math.floor(Math.random() * eligible.length)];
  if (!picked) {
    return { ok: false, error: 'El boleto seleccionado no es elegible para este sorteo.' };
  }

  const actorLabel = options.actorLabel?.trim() || 'Supervisión';
  const draw: RaffleDraw = {
    id: `draw-${year}-${Date.now().toString(36)}`,
    year,
    drawnAt: now,
    drawnBy: actorLabel,
    winnerTicketId: picked.id,
    winnerTicketCode: picked.ticketCode,
    winnerCustomerId: picked.customerId,
    winnerCustomerName: picked.customerName,
    winnerCustomerPhone: picked.customerPhone,
    eligibleTicketsCount: eligible.length,
    notes: options.notes?.trim().slice(0, 140) || undefined,
  };

  const auditLogs = appendAudit(state, {
    branchId,
    category: 'rifa',
    message: `Sorteo ${year} realizado: ganador ${picked.ticketCode} (${picked.customerName}) entre ${eligible.length} boleto(s)`,
    actor: actorLabel,
    createdAt: now,
  });

  return {
    ok: true,
    state: {
      ...state,
      raffleDraws: [draw, ...(state.raffleDraws ?? [])],
      auditLogs,
    },
    data: draw,
  };
}

export function seedSampleCustomersForTesting(
  state: DemoState,
  branchId: BranchId,
  actorLabel = 'Supervisión',
  now = new Date().toISOString(),
): DomainResult<Customer[]> {
  if ((state.customers ?? []).length > 0) {
    return { ok: false, error: 'Ya existen clientes registrados.' };
  }
  const c1: Customer = {
    id: 'cust-demo-1',
    name: 'María Fernanda López',
    phone: '8681234567',
    contactConsent: true,
    combosTowardFree: 9,
    freeCombosAvailable: 0,
    createdAt: now,
    createdBranchId: branchId,
  };
  const c2: Customer = {
    id: 'cust-demo-2',
    name: 'Carlos Eduardo Garza',
    phone: '8689876543',
    contactConsent: true,
    combosTowardFree: 4,
    freeCombosAvailable: 1,
    createdAt: now,
    createdBranchId: branchId,
  };
  const year = new Date(now).getFullYear();
  const demoTicket: RaffleTicket = {
    id: 'rt-demo-1',
    ticketCode: `RIFA-${year}-0001`,
    year,
    customerId: c2.id,
    customerName: c2.name,
    customerPhone: c2.phone,
    orderId: 'ord-demo-free',
    orderFolio: 'LOM-0000',
    branchId,
    issuedAt: now,
  };

  const auditLogs = appendAudit(state, {
    branchId,
    category: 'lealtad',
    message: 'Clientes y boleto ficticios cargados para prueba de lealtad y rifa.',
    actor: actorLabel,
    createdAt: now,
  });

  return {
    ok: true,
    state: {
      ...state,
      customers: [c1, c2],
      raffleTickets: [demoTicket],
      auditLogs,
    },
    data: [c1, c2],
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

export const EXPENSE_CATEGORIES: Array<{
  id: ExpenseCategory;
  label: string;
  defaultUnit: string;
}> = [
  { id: 'insumos', label: 'Insumos (jabón, suavizante, bolsas)', defaultUnit: 'garrafa' },
  { id: 'renta', label: 'Renta de local', defaultUnit: 'mes' },
  { id: 'luz', label: 'Electricidad (CFE)', defaultUnit: 'recibo' },
  { id: 'agua', label: 'Agua potable', defaultUnit: 'recibo' },
  { id: 'gas', label: 'Gas / Caldera', defaultUnit: 'carga' },
  { id: 'sueldos', label: 'Sueldos y nómina', defaultUnit: 'nómina' },
  { id: 'mantenimiento', label: 'Mantenimiento y refacciones', defaultUnit: 'servicio' },
];

export const DEFAULT_SUPPLY_ITEMS: Array<{
  name: string;
  unitLabel: string;
  unitCostCents: number;
  notes?: string;
}> = [
  { name: 'Jabón para lavadora', unitLabel: 'unidad', unitCostCents: 7000, notes: 'Presentación estándar de mostrador' },
  { name: 'Jabón líquido', unitLabel: 'garrafa', unitCostCents: 18000, notes: 'Detergente líquido de alta eficiencia' },
  { name: 'Suavizante concentrado', unitLabel: 'garrafa', unitCostCents: 12500 },
  { name: 'Cloro / Quitamanchas', unitLabel: 'litro', unitCostCents: 4500 },
  { name: 'Bolsas para encargo', unitLabel: 'paquete', unitCostCents: 9500 },
];

const localIsoDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Matamoros',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function toBranchDateKey(isoOrDate: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrDate)) return isoOrDate;
  const parsed = new Date(isoOrDate);
  if (Number.isNaN(parsed.getTime())) return isoOrDate.slice(0, 10);
  return localIsoDateFormatter.format(parsed);
}

export function getBranchExpenses(state: DemoState, branches?: BranchId[]): BranchExpense[] {
  const list = state.expenses ?? [];
  const filtered = branches ? list.filter((e) => branches.includes(e.branchId)) : list;
  return [...filtered].sort((a, b) =>
    a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date),
  );
}

export function getBranchSupplies(state: DemoState, branches?: BranchId[]): SupplyItem[] {
  const list = state.supplyCatalog ?? [];
  const filtered = branches ? list.filter((s) => branches.includes(s.branchId)) : list;
  return [...filtered].sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export function upsertSupplyItem(
  state: DemoState,
  branchId: BranchId,
  input: {
    id?: string;
    name: string;
    unitLabel: string;
    unitCostCents: number;
    notes?: string;
  },
  actorLabel = 'Supervisión',
  now = new Date().toISOString(),
): DomainResult<SupplyItem> {
  const cleanName = input.name.trim().slice(0, 80);
  const cleanUnit = input.unitLabel.trim().slice(0, 24) || 'unidad';
  const cleanNotes = input.notes?.trim().slice(0, 120) || undefined;
  if (!cleanName) {
    return { ok: false, error: 'Ingresa el nombre del insumo (ej. Jabón líquido).' };
  }
  if (!Number.isSafeInteger(input.unitCostCents) || input.unitCostCents < 100 || input.unitCostCents > 50_000_000) {
    return { ok: false, error: 'El costo unitario debe ser al menos $1.00 MXN.' };
  }

  const list = state.supplyCatalog ?? [];
  const existing = input.id ? list.find((s) => s.id === input.id && s.branchId === branchId) : undefined;
  if (input.id && !existing) {
    return { ok: false, error: 'No se encontró el insumo en la sucursal seleccionada.' };
  }
  const duplicate = list.find(
    (s) =>
      s.branchId === branchId &&
      s.id !== existing?.id &&
      s.name.toLowerCase() === cleanName.toLowerCase() &&
      s.unitLabel.toLowerCase() === cleanUnit.toLowerCase(),
  );
  if (duplicate) {
    return { ok: false, error: `Ya existe "${cleanName}" (${cleanUnit}) en ${getBranchDisplayName(state, branchId)}.` };
  }

  const item: SupplyItem = {
    id: existing?.id ?? `sup-${branchId}-${crypto.randomUUID()}`,
    branchId,
    name: cleanName,
    unitLabel: cleanUnit,
    unitCostCents: input.unitCostCents,
    notes: cleanNotes,
    updatedAt: now,
    updatedBy: actorLabel,
  };

  const nextList = existing
    ? list.map((s) => (s.id === existing.id ? item : s))
    : [item, ...list];

  const auditEntry: BranchAuditEntry = {
    id: `aud-${crypto.randomUUID()}`,
    branchId,
    category: 'gasto',
    message: existing
      ? `Insumo actualizado: ${item.name} (${formatMxn(item.unitCostCents)} MXN/${item.unitLabel})`
      : `Insumo registrado: ${item.name} (${formatMxn(item.unitCostCents)} MXN/${item.unitLabel})`,
    actor: actorLabel,
    createdAt: now,
    previousValue: existing ? formatMxn(existing.unitCostCents) : undefined,
    nextValue: formatMxn(item.unitCostCents),
  };

  return {
    ok: true,
    state: {
      ...state,
      supplyCatalog: nextList,
      auditLogs: [auditEntry, ...(state.auditLogs ?? [])].slice(0, 120),
    },
    data: item,
  };
}

export function deleteSupplyItem(
  state: DemoState,
  branchId: BranchId,
  supplyId: string,
  actorLabel = 'Supervisión',
  now = new Date().toISOString(),
): DomainResult<SupplyItem> {
  const list = state.supplyCatalog ?? [];
  const target = list.find((s) => s.id === supplyId && s.branchId === branchId);
  if (!target) {
    return { ok: false, error: 'Insumo no encontrado en esta sucursal.' };
  }
  const auditEntry: BranchAuditEntry = {
    id: `aud-${crypto.randomUUID()}`,
    branchId,
    category: 'gasto',
    message: `Insumo eliminado: ${target.name} (${target.unitLabel})`,
    actor: actorLabel,
    createdAt: now,
  };
  return {
    ok: true,
    state: {
      ...state,
      supplyCatalog: list.filter((s) => s.id !== supplyId),
      auditLogs: [auditEntry, ...(state.auditLogs ?? [])].slice(0, 120),
    },
    data: target,
  };
}

export function upsertExpense(
  state: DemoState,
  branchId: BranchId,
  input: {
    id?: string;
    date: string;
    category: ExpenseCategory;
    concept: string;
    unitLabel?: string;
    quantity: number;
    unitCostCents: number;
    supplyItemId?: string | null;
    notes?: string;
  },
  actorLabel = 'Supervisión',
  now = new Date().toISOString(),
): DomainResult<BranchExpense> {
  const date = input.date.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: 'Selecciona una fecha válida (YYYY-MM-DD).' };
  }
  const cleanConcept = input.concept.trim().slice(0, 100);
  if (!cleanConcept) {
    return { ok: false, error: 'Describe el concepto del gasto.' };
  }
  const qty = Math.round(input.quantity * 100) / 100;
  if (!Number.isFinite(qty) || qty <= 0 || qty > 10_000) {
    return { ok: false, error: 'La cantidad debe ser mayor a 0 y menor o igual a 10,000.' };
  }
  if (!Number.isSafeInteger(input.unitCostCents) || input.unitCostCents < 100 || input.unitCostCents > 50_000_000) {
    return { ok: false, error: 'El costo unitario debe ser al menos $1.00 MXN.' };
  }

  const totalCents = Math.round(qty * input.unitCostCents);
  const categoryMeta = EXPENSE_CATEGORIES.find((c) => c.id === input.category);
  const cleanUnit = input.unitLabel?.trim().slice(0, 24) || categoryMeta?.defaultUnit || 'unidad';
  const cleanNotes = input.notes?.trim().slice(0, 160) || undefined;

  const list = state.expenses ?? [];
  const existing = input.id ? list.find((e) => e.id === input.id && e.branchId === branchId) : undefined;
  if (input.id && !existing) {
    return { ok: false, error: 'No se encontró el gasto en esta sucursal.' };
  }

  const expense: BranchExpense = {
    id: existing?.id ?? `exp-${branchId}-${crypto.randomUUID()}`,
    branchId,
    date,
    category: input.category,
    concept: cleanConcept,
    unitLabel: cleanUnit,
    quantity: qty,
    unitCostCents: input.unitCostCents,
    totalCents,
    supplyItemId: input.supplyItemId ?? null,
    notes: cleanNotes,
    createdAt: existing?.createdAt ?? now,
    createdBy: existing?.createdBy ?? actorLabel,
    updatedAt: now,
  };

  const nextList = existing
    ? list.map((e) => (e.id === existing.id ? expense : e))
    : [expense, ...list];

  const auditEntry: BranchAuditEntry = {
    id: `aud-${crypto.randomUUID()}`,
    branchId,
    category: 'gasto',
    message: `${existing ? 'Gasto editado' : 'Gasto registrado'} (${categoryMeta?.label ?? input.category}): ${expense.concept} · ${expense.quantity} × ${formatMxn(expense.unitCostCents)} = ${formatMxn(expense.totalCents)} MXN`,
    actor: actorLabel,
    createdAt: now,
    previousValue: existing ? formatMxn(existing.totalCents) : undefined,
    nextValue: formatMxn(expense.totalCents),
  };

  return {
    ok: true,
    state: {
      ...state,
      expenses: nextList,
      auditLogs: [auditEntry, ...(state.auditLogs ?? [])].slice(0, 120),
    },
    data: expense,
  };
}

export function deleteExpense(
  state: DemoState,
  branchId: BranchId,
  expenseId: string,
  actorLabel = 'Supervisión',
  now = new Date().toISOString(),
): DomainResult<BranchExpense> {
  const list = state.expenses ?? [];
  const target = list.find((e) => e.id === expenseId && e.branchId === branchId);
  if (!target) {
    return { ok: false, error: 'No se encontró el gasto a eliminar.' };
  }
  const auditEntry: BranchAuditEntry = {
    id: `aud-${crypto.randomUUID()}`,
    branchId,
    category: 'gasto',
    message: `Gasto eliminado: ${target.concept} (${formatMxn(target.totalCents)} MXN)`,
    actor: actorLabel,
    createdAt: now,
  };
  return {
    ok: true,
    state: {
      ...state,
      expenses: list.filter((e) => e.id !== expenseId),
      auditLogs: [auditEntry, ...(state.auditLogs ?? [])].slice(0, 120),
    },
    data: target,
  };
}

export interface ProfitAndLossSummary {
  revenueCents: number;
  expensesCents: number;
  suppliesCents: number;
  netProfitCents: number;
  marginPct: number | null;
  expenseCount: number;
  confirmedLinesCount: number;
  byCategory: Array<{
    category: ExpenseCategory;
    label: string;
    totalCents: number;
    count: number;
    sharePct: number;
  }>;
  byBranch: Array<{
    branchId: BranchId;
    branchName: string;
    revenueCents: number;
    expensesCents: number;
    suppliesCents: number;
    netProfitCents: number;
    marginPct: number | null;
    expenseCount: number;
  }>;
}

export function calculateProfitAndLoss(
  state: DemoState,
  options: {
    branches?: BranchId[];
    fromDate?: string;
    toDate?: string;
  } = {},
): ProfitAndLossSummary {
  const targetBranches = options.branches && options.branches.length > 0
    ? options.branches
    : BRANCHES.map((b) => b.id);
  const branchSet = new Set(targetBranches);
  const fromDate = options.fromDate?.trim() || undefined;
  const toDate = options.toDate?.trim() || undefined;
  const inRange = (dateKey: string) => {
    if (fromDate && dateKey < fromDate) return false;
    if (toDate && dateKey > toDate) return false;
    return true;
  };

  const orderBranchMap = new Map<string, BranchId>();
  for (const ord of state.orders) {
    if (branchSet.has(ord.branchId)) {
      orderBranchMap.set(ord.id, ord.branchId);
    }
  }

  const revenueByBranch = new Map<BranchId, number>();
  let confirmedLinesCount = 0;
  for (const line of state.paymentLines) {
    if (line.status !== 'confirmado') continue;
    const ordBranch = orderBranchMap.get(line.orderId);
    if (!ordBranch) continue;
    const dateKey = toBranchDateKey(line.confirmedAt ?? line.createdAt);
    if (!inRange(dateKey)) continue;
    confirmedLinesCount += 1;
    revenueByBranch.set(ordBranch, (revenueByBranch.get(ordBranch) ?? 0) + line.amountCents);
  }

  const scopedExpenses = getBranchExpenses(state, targetBranches).filter((exp) => inRange(exp.date));
  const categoryTotals = new Map<ExpenseCategory, { totalCents: number; count: number }>();
  const expensesByBranch = new Map<BranchId, { totalCents: number; suppliesCents: number; count: number }>();

  for (const exp of scopedExpenses) {
    const cat = categoryTotals.get(exp.category) ?? { totalCents: 0, count: 0 };
    cat.totalCents += exp.totalCents;
    cat.count += 1;
    categoryTotals.set(exp.category, cat);

    const bStats = expensesByBranch.get(exp.branchId) ?? { totalCents: 0, suppliesCents: 0, count: 0 };
    bStats.totalCents += exp.totalCents;
    if (exp.category === 'insumos') bStats.suppliesCents += exp.totalCents;
    bStats.count += 1;
    expensesByBranch.set(exp.branchId, bStats);
  }

  const revenueCents = targetBranches.reduce((sum, b) => sum + (revenueByBranch.get(b) ?? 0), 0);
  const expensesCents = scopedExpenses.reduce((sum, e) => sum + e.totalCents, 0);
  const suppliesCents = categoryTotals.get('insumos')?.totalCents ?? 0;
  const netProfitCents = revenueCents - expensesCents;
  const marginPct = revenueCents > 0 ? Math.round((netProfitCents / revenueCents) * 1000) / 10 : null;

  const byCategory = EXPENSE_CATEGORIES.map((cat) => {
    const entry = categoryTotals.get(cat.id) ?? { totalCents: 0, count: 0 };
    return {
      category: cat.id,
      label: cat.label,
      totalCents: entry.totalCents,
      count: entry.count,
      sharePct: expensesCents > 0 ? Math.round((entry.totalCents / expensesCents) * 1000) / 10 : 0,
    };
  });

  const byBranch = targetBranches.map((branchId) => {
    const bRev = revenueByBranch.get(branchId) ?? 0;
    const bExp = expensesByBranch.get(branchId) ?? { totalCents: 0, suppliesCents: 0, count: 0 };
    const bNet = bRev - bExp.totalCents;
    return {
      branchId,
      branchName: getBranchDisplayName(state, branchId),
      revenueCents: bRev,
      expensesCents: bExp.totalCents,
      suppliesCents: bExp.suppliesCents,
      netProfitCents: bNet,
      marginPct: bRev > 0 ? Math.round((bNet / bRev) * 1000) / 10 : null,
      expenseCount: bExp.count,
    };
  });

  return {
    revenueCents,
    expensesCents,
    suppliesCents,
    netProfitCents,
    marginPct,
    expenseCount: scopedExpenses.length,
    confirmedLinesCount,
    byCategory,
    byBranch,
  };
}
