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
  createdAt: string;
  confirmedAt: string | null;
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
  simulated: true;
}

export interface Order {
  id: string;
  folio: string;
  branchId: BranchId;
  shiftId: string;
  serviceType: ServiceType;
  /** Alias ficticio para encargos */
  customerAlias: string;
  comboCount: number;
  /** Precio unitario en centavos enteros (7000 = $70.00) */
  unitPriceCents: number;
  /** Total en centavos enteros */
  totalCents: number;
  encargoStage: EncargoStage | null;
  orderStatus: OrderStatus;
  createdAt: string;
  deliveredAt: string | null;
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

export interface DemoState {
  activeBranchId: BranchId;
  orders: Order[];
  paymentLines: PaymentLine[];
  tickets: Record<string, TicketState>;
  shifts: Shift[];
  nextFolioSeq: Record<BranchId, number>;
}
