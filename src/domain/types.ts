export type BranchId = 'lomas' | 'trevino' | 'sucursal-3';

export interface BranchInfo {
  id: BranchId;
  name: string;
  folioPrefix: string;
  provisional?: boolean;
}

export type ServiceType = 'autoservicio' | 'encargo';

export type EncargoStage = 'recibido' | 'lavado' | 'secado' | 'listo' | 'entregado';

export type OrderStatus = 'en_proceso' | 'listo' | 'completado' | 'entregado';

export type PaymentMethod = 'efectivo' | 'tarjeta' | 'transferencia';

export type PaymentLineStatus = 'confirmado' | 'pendiente';

export interface PaymentLine {
  id: string;
  orderId: string;
  method: PaymentMethod;
  /** Monto en centavos enteros MXN (ej. 7000 = $70.00) */
  amountCents: number;
  cashReceivedCents?: number;
  status: PaymentLineStatus;
  /** Referencia de terminal (Clip) o movimiento bancario (Nu) */
  reference?: string | null;
  createdAt: string;
  confirmedAt: string | null;
  /** Usuario o correo que confirmó el pago externo */
  confirmedBy?: string | null;
  /** Turno abierto en el que se confirmó este ingreso */
  confirmedShiftId: string | null;
}

export type TicketStatus = 'no_emitido' | 'fallo' | 'emitido';

export interface TicketState {
  orderId: string;
  folio: string;
  status: TicketStatus;
  attempts: number;
  lastAttemptAt: string | null;
  lastError: string | null;
  issuedAt: string | null;
  reprintCount?: number;
  lastReprintedAt?: string | null;
  lastReprintedBy?: string | null;
  simulated: true;
}

export interface CatalogItem {
  id: string;
  name: string;
  /** Precio unitario vigente en centavos MXN */
  priceCents: number;
  /** Indica si consume lavadora/secadora al operar */
  requiresMachine: boolean;
  /** Créditos de combo que aporta al programa de lealtad por unidad */
  loyaltyCredits: number;
  /** Marca si el precio es de referencia y falta confirmar con Carlos */
  pricePendingConfirmation?: boolean;
  active: boolean;
}

export interface OrderLineItem {
  itemId: string;
  name: string;
  quantity: number;
  /** Precio unitario congelado al guardar la orden */
  unitPriceCents: number;
  lineTotalCents: number;
  requiresMachine?: boolean;
  loyaltyCredits?: number;
}

export type MachineKind = 'lavadora' | 'secadora';

export type MachineStatus = 'disponible' | 'en_uso' | 'fuera_de_servicio';

export interface Machine {
  id: string;
  branchId: BranchId;
  code: string;
  name: string;
  kind: MachineKind;
  model?: string;
  serialNumber?: string;
  capacityKg?: number;
  status: MachineStatus;
  currentOrderId: string | null;
  currentOrderFolio?: string | null;
  cycles: number;
  outOfServiceReason?: string | null;
  updatedAt: string;
  updatedBy?: string | null;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  contactConsent: boolean;
  /** Avance actual de combos pagados y completados hacia el 10° combo gratis (0..9+) */
  combosTowardFree: number;
  /** Combos gratis habilitados por cada 10 combos pagados y completados */
  freeCombosAvailable: number;
  createdAt: string;
  createdBranchId?: BranchId;
}

export type LoyaltyEventType =
  | 'combos_earned'
  | 'free_combo_unlocked'
  | 'free_combo_redeemed'
  | 'raffle_ticket_issued';

export interface LoyaltyEvent {
  id: string;
  customerId: string;
  orderId: string;
  branchId: BranchId;
  eventType: LoyaltyEventType;
  delta: number;
  createdAt: string;
  note?: string;
}

export interface RaffleTicket {
  id: string;
  ticketCode: string;
  year: number;
  customerId: string;
  customerName: string;
  customerPhone: string;
  orderId: string;
  orderFolio: string;
  branchId: BranchId;
  issuedAt: string;
}

export interface RaffleDraw {
  id: string;
  year: number;
  drawnAt: string;
  drawnBy: string;
  winnerTicketId: string;
  winnerTicketCode: string;
  winnerCustomerId: string;
  winnerCustomerName: string;
  winnerCustomerPhone: string;
  eligibleTicketsCount: number;
  notes?: string;
}

export interface Order {
  id: string;
  folio: string;
  branchId: BranchId;
  shiftId: string;
  serviceType: ServiceType;
  /** Nombre o referencia del cliente para encargos */
  customerAlias: string;
  customerId?: string | null;
  customerPhone?: string | null;
  comboCount: number;
  /** Precio unitario en centavos enteros (7000 = $70.00) */
  unitPriceCents: number;
  /** Partidas con precio unitario congelado al momento de guardar */
  items?: OrderLineItem[];
  /** Cantidad de combos gratis canjeados en esta orden */
  freeCombosRedeemed?: number;
  /** Descuento aplicado por lealtad en centavos */
  loyaltyDiscountCents?: number;
  /** Descuento manual en centavos */
  manualDiscountCents?: number;
  /** Marca cuando esta orden ya otorgó sus puntos / recompensa / boleto (evita duplicados) */
  loyaltyProcessedAt?: string | null;
  /** Total en centavos enteros */
  totalCents: number;
  encargoStage: EncargoStage | null;
  orderStatus: OrderStatus;
  assignedMachineIds?: string[];
  assignedMachineLabels?: string[];
  promisedDeliveryAt?: string | null;
  weightKg?: number | null;
  notes?: string | null;
  whatsappPreparedAt?: string | null;
  whatsappMessage?: string | null;
  whatsappSentAt?: string | null;
  whatsappSentBy?: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export type ExpenseCategory =
  | 'insumos'
  | 'renta'
  | 'luz'
  | 'agua'
  | 'gas'
  | 'sueldos'
  | 'mantenimiento';

export interface SupplyItem {
  id: string;
  branchId: BranchId;
  name: string;
  unitLabel: string;
  /** Costo unitario en centavos enteros MXN (ej. 7000 = $70.00 MXN) */
  unitCostCents: number;
  notes?: string;
  updatedAt: string;
  updatedBy?: string | null;
}

export interface BranchExpense {
  id: string;
  branchId: BranchId;
  /** Fecha del gasto en formato YYYY-MM-DD */
  date: string;
  category: ExpenseCategory;
  concept: string;
  unitLabel?: string;
  quantity: number;
  /** Costo unitario en centavos enteros MXN */
  unitCostCents: number;
  /** Total en centavos enteros MXN = Math.round(quantity * unitCostCents) */
  totalCents: number;
  supplyItemId?: string | null;
  notes?: string;
  createdAt: string;
  createdBy?: string | null;
  updatedAt: string;
}

export interface BranchAuditEntry {
  id: string;
  branchId: BranchId;
  category:
    | 'precio'
    | 'pago'
    | 'ticket'
    | 'caja'
    | 'equipo'
    | 'aviso'
    | 'lealtad'
    | 'rifa'
    | 'cierre_nocturno'
    | 'conciliacion'
    | 'gasto';
  message: string;
  actor: string;
  createdAt: string;
  previousValue?: string;
  nextValue?: string;
}

export interface NightClosingReport {
  id: string;
  branchId: BranchId;
  closingDate: string; // YYYY-MM-DD (zona America/Matamoros)
  shiftId: string | null;
  shiftNumber: number | null;
  wasAutoClosed: boolean;
  expectedCashCents: number;
  countedCashCents: number;
  confirmedCardCents: number;
  confirmedTransferCents: number;
  pendingTransferCents: number;
  pendingBalanceCents: number;
  pendingDeliveryCount: number;
  pendingDeliveryAmountCents: number;
  totalConfirmedCents: number;
  reportText: string;
  executedAt: string;
  executedBy: string;
}

export interface ShiftClosingSummary {
  expectedCashCents: number;
  countedCashCents: number;
  differenceCents: number;
  confirmedCardCents: number;
  confirmedTransferCents: number;
  pendingBalanceCents: number;
  totalConfirmedCents: number;
}

export interface CashMovement {
  kind: 'entrada' | 'retiro';
  amountCents: number;
  reason: string;
  createdAt: string;
}

export interface Shift {
  id: string;
  branchId: BranchId;
  number: number;
  status: 'abierto' | 'cerrado';
  openedAt: string;
  closedAt: string | null;
  closingSummary: ShiftClosingSummary | null;
  openingCashCents?: number;
  cashMovements?: CashMovement[];
}

export interface BranchSettings {
  comboPriceCents: number;
  branchDisplayName?: string;
  branchAddress?: string;
  businessName: string;
  branchPhone: string;
  scheduleText: string;
  ticketFooter: string;
  defaultPaperWidth: '80mm' | '58mm';
  /** Catálogo editable de servicios y productos de mostrador */
  catalog?: CatalogItem[];
  /** Si Caja puede reimprimir un comprobante ya emitido sin Supervisión */
  allowOperatorReprint?: boolean;
}

export interface DemoState {
  activeBranchId: BranchId;
  orders: Order[];
  paymentLines: PaymentLine[];
  tickets: Record<string, TicketState>;
  shifts: Shift[];
  nextFolioSeq: Record<BranchId, number>;
  settings?: Partial<Record<BranchId, BranchSettings>>;
  machines?: Machine[];
  customers?: Customer[];
  loyaltyEvents?: LoyaltyEvent[];
  raffleTickets?: RaffleTicket[];
  raffleDraws?: RaffleDraw[];
  nightClosings?: NightClosingReport[];
  auditLogs?: BranchAuditEntry[];
  expenses?: BranchExpense[];
  supplyCatalog?: SupplyItem[];
}
