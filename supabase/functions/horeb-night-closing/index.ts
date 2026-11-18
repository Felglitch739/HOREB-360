import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { z } from 'npm:zod@4.1.13';
import { runNightClosingForBranch } from '../../../src/domain/reconciliation.ts';
import { BRANCHES } from '../../../src/domain/rules.ts';
import {
  combineBranches,
  mapDbNightClosing,
  type BranchRow,
  type DbNightClosingRow,
} from '../../../src/domain/sharedState.ts';
import type { BranchId } from '../../../src/domain/types.ts';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};

const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const url = Deno.env.get('SUPABASE_URL')!;
const cronSecret = Deno.env.get('HOREB_NIGHT_CLOSING_SECRET');
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const bodySchema = z.object({
  branch: z.enum(['lomas', 'trevino', 'sucursal-3']).optional(),
  closingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  enforce2300Rule: z.boolean().optional(),
  nowOverride: z.string().datetime().optional(),
}).optional();

function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'POST') return reply({ error: 'Método inválido.' }, 405);

  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return reply({ error: 'Autorización requerida.' }, 401);
  const token = auth.slice(7);

  let actorLabel = 'Cron 23:00';
  let actorId: string | null = null;
  let allowedBranches: BranchId[] = BRANCHES.map((b) => b.id);

  if (cronSecret && token === cronSecret) {
    actorLabel = 'Automatización 23:00';
  } else {
    const { data: authData } = await admin.auth.getUser(token);
    if (!authData.user) return reply({ error: 'Sesión inválida.' }, 401);
    actorId = authData.user.id;
    actorLabel = authData.user.email ?? actorId;
    const { data: memberships, error: memErr } = await admin
      .from('horeb_memberships')
      .select('branch_id,role')
      .eq('user_id', actorId)
      .eq('role', 'supervisor');
    if (memErr || !memberships?.length) {
      return reply({ error: 'Solo Supervisión o el programador 23:00 pueden ejecutar este cierre.' }, 403);
    }
    allowedBranches = memberships.map((m) => m.branch_id as BranchId);
  }

  let parsedBody: z.infer<typeof bodySchema> = undefined;
  const raw = await request.text();
  if (raw.trim()) {
    try {
      const json = JSON.parse(raw);
      const checked = bodySchema.safeParse(json);
      if (!checked.success) return reply({ error: 'Parámetros inválidos.' }, 400);
      parsedBody = checked.data;
    } catch {
      return reply({ error: 'JSON inválido.' }, 400);
    }
  }

  const targetBranches = parsedBody?.branch
    ? allowedBranches.filter((b) => b === parsedBody!.branch)
    : allowedBranches;

  const results: Array<{ branchId: BranchId; status: 'created' | 'already_executed' | 'skipped' | 'error'; report?: unknown; error?: string }> = [];

  for (const branchId of targetBranches) {
    const [rowRes, ncRes] = await Promise.all([
      admin.from('horeb_branch_state').select('branch_id,version,updated_at,state').eq('branch_id', branchId).single(),
      admin.from('horeb_night_closings').select('*').eq('branch_id', branchId),
    ]);
    if (rowRes.error || !rowRes.data || ncRes.error) {
      results.push({ branchId, status: 'error', error: 'No se pudo cargar la sucursal.' });
      continue;
    }

    const row = rowRes.data as BranchRow;
    const closings = (ncRes.data as DbNightClosingRow[]).map(mapDbNightClosing);
    const combined = combineBranches([row], { nightClosings: closings });

    const outcome = runNightClosingForBranch(combined, branchId, {
      closingDate: parsedBody?.closingDate,
      now: parsedBody?.nowOverride,
      enforce2300Rule: parsedBody?.enforce2300Rule ?? !parsedBody?.closingDate,
      actorLabel,
    });

    if (!outcome.ok) {
      results.push({ branchId, status: 'skipped', error: outcome.error });
      continue;
    }

    if (outcome.alreadyExecuted) {
      results.push({ branchId, status: 'already_executed', report: outcome.data });
      continue;
    }

    const { nightClosings: _nc, customers: _c, loyaltyEvents: _l, raffleTickets: _rt, raffleDraws: _rd, ...branchOnlyState } = outcome.state;

    if (actorId) {
      const { error: commitErr } = await admin.rpc('horeb_commit_operation', {
        p_branch_id: branchId,
        p_expected_version: row.version,
        p_state: branchOnlyState,
        p_operation_id: crypto.randomUUID(),
        p_actor_id: actorId,
        p_action: 'runNightClosing',
      }).maybeSingle();
      if (commitErr) {
        results.push({ branchId, status: 'error', error: 'Conflicto de versión al guardar cierre.' });
        continue;
      }
    } else {
      await admin
        .from('horeb_branch_state')
        .update({ state: branchOnlyState, version: row.version + 1, updated_at: new Date().toISOString() })
        .eq('branch_id', branchId)
        .eq('version', row.version);
    }

    const r = outcome.data;
    await admin.from('horeb_night_closings').upsert(
      {
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
      },
      { onConflict: 'branch_id,closing_date', ignoreDuplicates: true },
    );

    results.push({ branchId, status: 'created', report: r });
  }

  return reply({ ok: true, results });
});
