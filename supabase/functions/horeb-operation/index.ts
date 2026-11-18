import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { z } from 'npm:zod@4.1.13';
import { operate, requiresSupervisor } from '../../../src/domain/operations.ts';
import { combineBranches, type BranchRow } from '../../../src/domain/sharedState.ts';
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
        comboCount: z.number().int().min(1).max(100).optional(),
        items: orderItemsSchema.optional(),
        paymentLines: lines,
      }),
    }),
    z.object({ action: z.literal('capture'), orderId: id, lines }),
    z.object({ action: z.literal('confirm'), lineId: id, reference: z.string().trim().max(60).optional() }),
    z.object({ action: z.literal('advance'), orderId: id }),
    z.object({ action: z.literal('deliver'), orderId: id }),
    z.object({ action: z.literal('emit'), orderId: id, simulateFailure: z.boolean() }),
    z.object({ action: z.literal('reprint'), orderId: id }),
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

  const { data: previous, error: eventError } = await admin.from('horeb_operations')
    .select('operation_id').eq('operation_id', operationId).eq('branch_id', branch).eq('actor_id', actor).maybeSingle();
  const { data: current, error: readError } = await admin.from('horeb_branch_state')
    .select('branch_id,version,updated_at,state').eq('branch_id', branch).single();
  if (!current || readError || eventError) return reply({ error: 'No se pudo cargar la sucursal.' }, 503);
  if (previous) return reply({ row: current });
  if (current.version !== version) return reply({ row: current, error: 'Otro equipo actualizó la sucursal. Revisa el estado y vuelve a intentar.' }, 409);

  const combined = combineBranches([current as BranchRow]);

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

  const { data, error } = await admin.rpc('horeb_commit_operation', {
    p_branch_id: branch,
    p_expected_version: version,
    p_state: result.state,
    p_operation_id: operationId,
    p_actor_id: actor,
    p_action: operation.action,
  }).maybeSingle();
  if (error) return reply({ error: 'No se pudo guardar la operación.' }, 503);
  if (!data) return reply({ error: 'La sucursal cambió antes de guardar. Actualiza y vuelve a intentar.' }, 409);
  const persisted = data as BranchRow;
  const order = result.order && persisted.state.orders?.find((item) => item.folio === result.order?.folio);

  if (['updateSettings', 'confirm', 'reprint', 'closeShift', 'openShift', 'movement'].includes(operation.action)) {
    const latestAudit = persisted.state.auditLogs?.[0];
    await admin.from('horeb_audit_logs').insert({
      branch_id: branch,
      actor_id: actor,
      actor_label: actorLabel,
      category: latestAudit?.category ?? 'operacion',
      action: operation.action,
      summary: latestAudit?.message ?? `${operation.action} ejecutado por ${actorLabel}`,
      metadata: operation,
    }).catch(() => {});
  }

  return reply({ row: persisted, order });
});
