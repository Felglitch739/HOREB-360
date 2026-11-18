import { createInitialState } from './rules.ts';
import type {
  BranchId,
  BranchSettings,
  Customer,
  DemoState,
  LoyaltyEvent,
  RaffleDraw,
  RaffleTicket,
} from './types.ts';

export type BranchRole = 'operator' | 'supervisor';
export interface BranchRow { branch_id: BranchId; version: number; updated_at?: string; state: Partial<DemoState> }

export interface GlobalRecordsBundle {
  customers?: Customer[];
  loyaltyEvents?: LoyaltyEvent[];
  raffleTickets?: RaffleTicket[];
  raffleDraws?: RaffleDraw[];
}

export interface DbCustomerRow {
  id: string;
  name: string;
  phone: string;
  contact_consent: boolean;
  combos_toward_free: number;
  free_combos_available: number;
  created_branch_id: BranchId | null;
  created_at: string;
}

export interface DbLoyaltyEventRow {
  id: string;
  customer_id: string;
  order_id: string;
  branch_id: BranchId;
  event_type: LoyaltyEvent['eventType'];
  delta: number;
  note: string | null;
  created_at: string;
}

export interface DbRaffleTicketRow {
  id: string;
  ticket_code: string;
  year: number;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  order_id: string;
  order_folio: string;
  branch_id: BranchId;
  issued_at: string;
}

export interface DbRaffleDrawRow {
  id: string;
  year: number;
  drawn_at: string;
  drawn_by: string;
  winner_ticket_id: string;
  winner_ticket_code: string;
  winner_customer_id: string;
  winner_customer_name: string;
  winner_customer_phone: string;
  eligible_tickets_count: number;
  notes: string | null;
}

export function mapDbCustomer(row: DbCustomerRow): Customer {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    contactConsent: row.contact_consent,
    combosTowardFree: row.combos_toward_free,
    freeCombosAvailable: row.free_combos_available,
    createdAt: row.created_at,
    createdBranchId: row.created_branch_id ?? undefined,
  };
}

export function mapDbLoyaltyEvent(row: DbLoyaltyEventRow): LoyaltyEvent {
  return {
    id: row.id,
    customerId: row.customer_id,
    orderId: row.order_id,
    branchId: row.branch_id,
    eventType: row.event_type,
    delta: row.delta,
    note: row.note ?? undefined,
    createdAt: row.created_at,
  };
}

export function mapDbRaffleTicket(row: DbRaffleTicketRow): RaffleTicket {
  return {
    id: row.id,
    ticketCode: row.ticket_code,
    year: row.year,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    orderId: row.order_id,
    orderFolio: row.order_folio,
    branchId: row.branch_id,
    issuedAt: row.issued_at,
  };
}

export function mapDbRaffleDraw(row: DbRaffleDrawRow): RaffleDraw {
  return {
    id: row.id,
    year: row.year,
    drawnAt: row.drawn_at,
    drawnBy: row.drawn_by,
    winnerTicketId: row.winner_ticket_id,
    winnerTicketCode: row.winner_ticket_code,
    winnerCustomerId: row.winner_customer_id,
    winnerCustomerName: row.winner_customer_name,
    winnerCustomerPhone: row.winner_customer_phone,
    eligibleTicketsCount: row.eligible_tickets_count,
    notes: row.notes ?? undefined,
  };
}

export function combineBranches(rows: BranchRow[], global: GlobalRecordsBundle = {}): DemoState {
  const initial = createInitialState();
  const settings: Partial<Record<BranchId, BranchSettings>> = {};
  const state: DemoState = {
    ...initial,
    activeBranchId: rows[0]?.branch_id ?? initial.activeBranchId,
    shifts: [],
    settings,
    machines: [],
    customers: global.customers ? [...global.customers] : [],
    loyaltyEvents: global.loyaltyEvents ? [...global.loyaltyEvents] : [],
    raffleTickets: global.raffleTickets ? [...global.raffleTickets] : [],
    raffleDraws: global.raffleDraws ? [...global.raffleDraws] : [],
    auditLogs: [],
  };
  for (const { branch_id, updated_at, state: saved } of rows) {
    state.orders.push(...(saved.orders ?? []));
    state.paymentLines.push(...(saved.paymentLines ?? []));
    state.shifts.push(...(saved.shifts ?? initial.shifts.filter((shift) => shift.branchId === branch_id).map((shift) => ({ ...shift, openedAt: updated_at ?? shift.openedAt }))));
    Object.assign(state.tickets, saved.tickets ?? {});
    state.nextFolioSeq[branch_id] = saved.nextFolioSeq?.[branch_id] ?? 1;
    if (saved.settings?.[branch_id]) {
      settings[branch_id] = saved.settings[branch_id];
    }
    if (saved.machines?.length) {
      state.machines!.push(...saved.machines);
    }
    if (saved.auditLogs?.length) {
      state.auditLogs!.push(...saved.auditLogs);
    }
  }
  state.orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  state.auditLogs!.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return state;
}
