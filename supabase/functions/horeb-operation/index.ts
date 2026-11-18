import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { z } from 'npm:zod@4.1.13';
import { operate, requiresSupervisor } from '../../../src/domain/operations.ts';
import {
  combineBranches,
  mapDbCustomer,
  mapDbLoyaltyEvent,
  mapDbNightClosing,
  mapDbRaffleDraw,
  mapDbRaffleTicket,
  type BranchRow,
  type DbCustomerRow,
  type DbLoyaltyEventRow,
  type DbNightClosingRow,
  type DbRaffleDrawRow,
  type DbRaffleTicketRow,
} from '../../../src/domain/sharedState.ts';
import { canReprintTicket, getBranchInfo } from '../../../src/domain/rules.ts';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};

const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const url = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const id = z.string().trim().min(1).max(120);
const amount = z.number().int().min(0).max(100_000_000);
const lines = z.array(z.object({
  method: z.enum(['efectivo', 'tarjeta', 'transferencia']),
  amountCents: amount.positive(),
  cashReceivedCents: amount.optional(),
  confirmImmediately: z.boolean().optional(),
  reference: z.string().trim().max(60).optional(),
})).max(3);

const orderItemsSchema = z.array(z.object({
  itemId: z.string().trim().min(1).max(40),
  quantity: z.number().int().min(1).max(200),
})).min(1).max(20);

const catalogItemSchema = z.object({
  id: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(80),
  priceCents: amount.min(100).max(10_000_000),
  requiresMachine: z.boolean(),
  loyaltyCredits: z.number().int().min(0).max(10),
  pricePendingConfirmation: z.boolean().optional(),
  active: z.boolean(),
});

const machineIdsSchema = z.array(z.string().trim().min(1).max(60)).max(20);

const requestSchema = z.object({
  branch: z.enum(['lomas', 'trevino', 'sucursal-3']),
  version: z.number().int().min(0).max(2147483646),
  operationId: z.uuid(),
  operation: z.discriminatedUnion('action', [
    z.object({
      action: z.literal('create'),
      input: z.object({
        serviceType: z.enum(['autoservicio', 'encargo']),
        folio: z.string().trim().max(30).optional(),
        customerAlias: z.string().trim().max(100).optional(),
        customerId: z.string().trim().max(120).optional(),
        redeemFreeCombo: z.boolean().optional(),
        comboCount: z.number().int().min(1).max(100).optional(),
        items: orderItemsSchema.optional(),
        machineIds: machineIdsSchema.optional(),
        paymentLines: lines,
      }),
    }),
    z.object({ action: z.literal('capture'), orderId: id, lines }),
    z.object({ action: z.literal('confirm'), lineId: id, reference: z.string().trim().max(60).optional() }),
    z.object({ action: z.literal('advance'), orderId: id, machineIds: machineIdsSchema.optional() }),
    z.object({ action: z.literal('deliver'), orderId: id }),
    z.object({ action: z.literal('emit'), orderId: id, simulateFailure: z.boolean() }),
    z.object({ action: z.literal('reprint'), orderId: id }),
    z.object({
      action: z.literal('upsertMachine'),
      machine: z.object({
        id: id.optional(),
        code: z.string().trim().min(1).max(12),
        name: z.string().trim().min(1).max(50),
        kind: z.enum(['lavadora', 'secadora']),
      }),
    }),
    z.object({ action: z.literal('deleteMachine'), machineId: id }),
    z.object({ action: z.literal('seedSampleMachines') }),
    z.object({
      action: z.literal('setMachineStatus'),
      machineId: id,
      status: z.enum(['disponible', 'fuera_de_servicio']),
      reason: z.string().trim().max(100).optional(),
    }),
    z.object({ action: z.literal('assignMachines'), orderId: id, machineIds: machineIdsSchema }),
    z.object({ action: z.literal('recordWhatsappSent'), orderId: id }),
    z.object({
      action: z.literal('upsertCustomer'),
      customer: z.object({
        id: id.optional(),
        name: z.string().trim().min(1).max(80),
        phone: z.string().trim().min(8).max(20),
        contactConsent: z.boolean(),
      }),
    }),
    z.object({
      action: z.literal('runRaffleDraw'),
      year: z.number().int().min(2025).max(2100).optional(),
      notes: z.string().trim().max(140).optional(),
      winnerTicketId: id.optional(),
    }),
    z.object({ action: z.literal('seedSampleCustomers') }),
    z.object({
      action: z.literal('runNightClosing'),
      closingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      enforce2300Rule: z.boolean().optional(),
    }),
    z.object({
      action: z.literal('confirmTransferBatch'),
      items: z.array(z.object({
        lineId: id,
        reference: z.string().trim().max(60).optional(),
      })).min(1).max(50),
    }),
    z.object({ action: z.literal('openShift'), amount }),
    z.object({ action: z.literal('closeShift'), amount }),
    z.object({
      action: z.literal('movement'),
      kind: z.enum(['entrada', 'retiro']),
      amount: amount.positive(),
      reason: z.string().trim().min(1).max(100),
    }),
    z.object({
      action: z.literal('updateSettings'),
      settings: z.object({
        comboPriceCents: amount.min(100).max(10_000_000).optional(),
        businessName: z.string().trim().min(1).max(80).optional(),
        branchPhone: z.string().trim().max(40).optional(),
        scheduleText: z.string().trim().max(80).optional(),
        ticketFooter: z.string().trim().max(160).optional(),
        defaultPaperWidth: z.enum(['80mm', '58mm']).optional(),
        allowOperatorReprint: z.boolean().optional(),
        catalog: z.array(catalogItemSchema).min(1).max(20).optional(),
      }),
    }),
  ]),
});

function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'POST') return reply({ error: 'Método inválido.' }, 405);
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return reply({ error: 'Inicia sesión para continuar.' }, 401);
  const { data: authData } = await admin.auth.getUser(auth.slice(7));
  if (!authData.user) return reply({ error: 'Tu sesión ya no es válida.' }, 401);

  const raw = await request.text();
  if (raw.length > 32_768) return reply({ error: 'La solicitud es demasiado grande.' }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return reply({ error: 'Operación inválida.' }, 400); }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return reply({ error: 'Revisa los datos de la operación.' }, 400);
  const { branch, operation, version, operationId } = parsed.data;
  const actor = authData.user.id;
  const actorLabel = authData.user.email ?? actor;

  const { data: membership, error: membershipError } = await admin.from('horeb_memberships')
    .select('role').eq('user_id', actor).eq('branch_id', branch).maybeSingle();
  if (membershipError) return reply({ error: 'No se pudo validar tu acceso.' }, 503);
  if (!membership || (requiresSupervisor(operation.action) && membership.role !== 'supervisor')) {
    return reply({ error: 'Tu cuenta no puede realizar esta operación en la sucursal.' }, 403);
  }

  const [previousRes, currentRes, custRes, loyaltyRes, ticketsRes, drawsRes, ncRes] = await Promise.all([
    admin.from('horeb_operations').select('operation_id').eq('operation_id', operationId).eq('branch_id', branch).eq('actor_id', actor).maybeSingle(),
    admin.from('horeb_branch_state').select('branch_id,version,updated_at,state').eq('branch_id', branch).single(),
    admin.from('horeb_customers').select('*'),
    admin.from('horeb_loyalty_events').select('*'),
    admin.from('horeb_raffle_tickets').select('*'),
    admin.from('horeb_raffle_draws').select('*').order('drawn_at', { ascending: false }),
    admin.from('horeb_night_closings').select('*').order('closing_date', { ascending: false }),
  ]);

  const current = currentRes.data;
  if (!current || currentRes.error || previousRes.error || custRes.error || loyaltyRes.error || ticketsRes.error || drawsRes.error || ncRes.error) {
    return reply({ error: 'No se pudo cargar la sucursal.' }, 503);
  }
  if (previousRes.data) return reply({ row: current });
  if (current.version !== version) {
    return reply({ row: current, error: 'Otro equipo actualizó la sucursal. Revisa el estado y vuelve a intentar.' }, 409);
  }

  const prevCustomers = (custRes.data as DbCustomerRow[]).map(mapDbCustomer);
  const prevLoyalty = (loyaltyRes.data as DbLoyaltyEventRow[]).map(mapDbLoyaltyEvent);
  const prevTickets = (ticketsRes.data as DbRaffleTicketRow[]).map(mapDbRaffleTicket);
  const prevDraws = (drawsRes.data as DbRaffleDrawRow[]).map(mapDbRaffleDraw);
  const prevClosings = (ncRes.data as DbNightClosingRow[]).map(mapDbNightClosing);

  const combined = combineBranches([current as BranchRow], {
    customers: prevCustomers,
    loyaltyEvents: prevLoyalty,
    raffleTickets: prevTickets,
    raffleDraws: prevDraws,
    nightClosings: prevClosings,
  });

  if (operation.action === 'reprint') {
    const targetOrder = combined.orders.find((o) => o.id === operation.orderId);
    if (!targetOrder) return reply({ error: 'Orden no encontrada.' }, 404);
    if (!canReprintTicket(combined, targetOrder, membership.role as 'operator' | 'supervisor')) {
      return reply({ error: 'La reimpresión de comprobantes requiere autorización de Supervisión.' }, 403);
    }
  }

  if (operation.action === 'create' && operation.input.folio) {
    const prefix = getBranchInfo(branch).folioPrefix;
    if (!new RegExp('^' + prefix + '-[0-9]{1,12}$').test(operation.input.folio.toUpperCase())) {
      return reply({ error: 'Usa el prefijo ' + prefix + ' y números para el folio.' }, 422);
    }
  }

  const result = operate(combined, branch, operation, {
    role: membership.role as 'operator' | 'supervisor',
    actorLabel,
  });
  if (!result.ok) return reply(result, 422);

  // Guardamos solo estado propio de la sucursal en JSONB; clientes, lealtad y rifa viven en sus tablas globales
  const {
    customers: nextCustomers = [],
    loyaltyEvents: nextLoyalty = [],
    raffleTickets: nextTickets = [],
    raffleDraws: nextDraws = [],
    nightClosings: nextClosings = [],
    ...branchOnlyState
  } = result.state;

  const { data, error } = await admin.rpc('horeb_commit_operation', {
    p_branch_id: branch,
    p_expected_version: version,
    p_state: branchOnlyState,
    p_operation_id: operationId,
    p_actor_id: actor,
    p_action: operation.action,
  }).maybeSingle();
  if (error) return reply({ error: 'No se pudo guardar la operación.' }, 503);
  if (!data) return reply({ error: 'La sucursal cambió antes de guardar. Actualiza y vuelve a intentar.' }, 409);

  // Persistir cambios globales con restricciones idempotentes en BD
  const prevCustMap = new Map(prevCustomers.map((c) => [c.id, JSON.stringify(c)]));
  const changedCustomers = nextCustomers.filter((c) => prevCustMap.get(c.id) !== JSON.stringify(c));
  if (changedCustomers.length > 0) {
    await admin.from('horeb_customers').upsert(
      changedCustomers.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        contact_consent: c.contactConsent,
        combos_toward_free: c.combosTowardFree,
        free_combos_available: c.freeCombosAvailable,
        created_branch_id: c.createdBranchId ?? branch,
        created_at: c.createdAt,
        updated_at: new Date().toISOString(),
      })),
    );
  }

  const prevEventIds = new Set(prevLoyalty.map((e) => e.id));
  const addedEvents = nextLoyalty.filter((e) => !prevEventIds.has(e.id));
  if (addedEvents.length > 0) {
    await admin.from('horeb_loyalty_events').upsert(
      addedEvents.map((e) => ({
        id: e.id,
        customer_id: e.customerId,
        order_id: e.orderId,
        branch_id: e.branchId,
        event_type: e.eventType,
        delta: e.delta,
        note: e.note ?? null,
        created_at: e.createdAt,
      })),
      { onConflict: 'order_id,event_type', ignoreDuplicates: true },
    );
  }

  const prevTicketIds = new Set(prevTickets.map((t) => t.id));
  const addedTickets = nextTickets.filter((t) => !prevTicketIds.has(t.id));
  if (addedTickets.length > 0) {
    await admin.from('horeb_raffle_tickets').upsert(
      addedTickets.map((t) => ({
        id: t.id,
        ticket_code: t.ticketCode,
        year: t.year,
        customer_id: t.customerId,
        customer_name: t.customerName,
        customer_phone: t.customerPhone,
        order_id: t.orderId,
        order_folio: t.orderFolio,
        branch_id: t.branchId,
        issued_at: t.issuedAt,
      })),
      { onConflict: 'order_id', ignoreDuplicates: true },
    );
  }

  const prevDrawIds = new Set(prevDraws.map((d) => d.id));
  const addedDraws = nextDraws.filter((d) => !prevDrawIds.has(d.id));
  if (addedDraws.length > 0) {
    await admin.from('horeb_raffle_draws').insert(
      addedDraws.map((d) => ({
        id: d.id,
        year: d.year,
        drawn_at: d.drawnAt,
        drawn_by: d.drawnBy,
        winner_ticket_id: d.winnerTicketId,
        winner_ticket_code: d.winnerTicketCode,
        winner_customer_id: d.winnerCustomerId,
        winner_customer_name: d.winnerCustomerName,
        winner_customer_phone: d.winnerCustomerPhone,
        eligible_tickets_count: d.eligibleTicketsCount,
        notes: d.notes ?? null,
      })),
    );
  }

  const prevClosingIds = new Set(prevClosings.map((c) => c.id));
  const addedClosings = nextClosings.filter((c) => !prevClosingIds.has(c.id));
  if (addedClosings.length > 0) {
    await admin.from('horeb_night_closings').upsert(
      addedClosings.map((r) => ({
        id: r.id,
        branch_id: r.branchId,
        closing_date: r.closingDate,
        shift_id: r.shiftId,
        shift_number: r.shiftNumber,
        was_auto_closed: r.wasAutoClosed,
        expected_cash_cents: r.expectedCashCents,
        counted_cash_cents: r.countedCashCents,
        confirmed_card_cents: r.confirmedCardCents,
        confirmed_transfer_cents: r.confirmedTransferCents,
        pending_transfer_cents: r.pendingTransferCents,
        pending_balance_cents: r.pendingBalanceCents,
        pending_delivery_count: r.pendingDeliveryCount,
        pending_delivery_amount_cents: r.pendingDeliveryAmountCents,
        total_confirmed_cents: r.totalConfirmedCents,
        report_text: r.reportText,
        executed_at: r.executedAt,
        executed_by: r.executedBy,
      })),
      { onConflict: 'branch_id,closing_date', ignoreDuplicates: true },
    );
  }

  const persisted = data as BranchRow;
  const order = result.order && persisted.state.orders?.find((item) => item.folio === result.order?.folio);

  if (
    [
      'updateSettings',
      'confirm',
      'reprint',
      'closeShift',
      'openShift',
      'movement',
      'upsertMachine',
      'deleteMachine',
      'setMachineStatus',
      'assignMachines',
      'recordWhatsappSent',
      'upsertCustomer',
      'runRaffleDraw',
      'runNightClosing',
      'confirmTransferBatch',
    ].includes(operation.action)
  ) {
    const latestAudit = persisted.state.auditLogs?.[0];
    try {
      await admin.from('horeb_audit_logs').insert({
        branch_id: branch,
        actor_id: actor,
        actor_label: actorLabel,
        category: latestAudit?.category ?? 'operacion',
        action: operation.action,
        summary: latestAudit?.message ?? `${operation.action} ejecutado por ${actorLabel}`,
        metadata: operation,
      });
    } catch {
      // No interrumpir la respuesta si falla el registro secundario de auditoría
    }
  }

  return reply({
    row: persisted,
    order,
    customer: result.customer,
    global: {
      customers: nextCustomers,
      loyaltyEvents: nextLoyalty,
      raffleTickets: nextTickets,
      raffleDraws: nextDraws,
      nightClosings: nextClosings,
    },
  });
});
