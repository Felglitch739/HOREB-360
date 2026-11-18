import { describe, expect, it } from 'vitest';
import { operate, type Operation } from './operations.ts';
import {
  enqueueOfflineOperation,
  flushOfflineQueue,
  readOfflineQueue,
  readOfflineSnapshot,
  replayOfflineQueue,
  writeOfflineQueue,
  writeOfflineSnapshot,
  type QueuedOperation,
  type StorageLike,
} from './offlineQueue.ts';
import { createInitialState, getBranchSettings } from './rules.ts';
import { combineBranches, type BranchRow, type GlobalRecordsBundle } from './sharedState.ts';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
}

function makeBaseRows(): { rows: BranchRow[]; global: GlobalRecordsBundle } {
  const initial = createInitialState();
  return {
    rows: [
      {
        branch_id: 'lomas',
        version: 4,
        state: {
          ...initial,
          orders: [],
          paymentLines: [],
          tickets: {},
          shifts: initial.shifts.filter((s) => s.branchId === 'lomas'),
          machines: initial.machines?.filter((m) => m.branchId === 'lomas') ?? [],
          settings: { lomas: getBranchSettings(initial, 'lomas') },
        },
      },
    ],
    global: {
      customers: [],
      loyaltyEvents: [],
      raffleTickets: [],
      raffleDraws: [],
      nightClosings: [],
    },
  };
}

describe('offlineQueue: operación local y resincronización', () => {
  it('valida reglas de negocio offline y re-reproduce órdenes y pagos encadenados', () => {
    const { rows: baseRows, global: baseGlobal } = makeBaseRows();
    const roles = { lomas: 'supervisor' as const };

    const badOp = enqueueOfflineOperation({
      baseRows,
      baseGlobal,
      queue: [],
      roles,
      branchId: 'lomas',
      operation: {
        action: 'create',
        input: {
          serviceType: 'autoservicio',
          items: [{ itemId: 'combo', quantity: 1 }],
          paymentLines: [],
        },
      },
      operationId: 'op-bad',
      actorLabel: 'felix_mf@horeb.mx',
    });
    expect(badOp.ok).toBe(false);

    const step1 = enqueueOfflineOperation({
      baseRows,
      baseGlobal,
      queue: [],
      roles,
      branchId: 'lomas',
      operation: {
        action: 'create',
        input: {
          serviceType: 'encargo',
          customerAlias: 'Ana Offline',
          items: [{ itemId: 'combo', quantity: 1 }],
          paymentLines: [],
        },
      },
      operationId: 'op-1',
      actorLabel: 'felix_mf@horeb.mx',
    });
    expect(step1.ok).toBe(true);
    if (!step1.ok || !step1.order) return;

    const step2 = enqueueOfflineOperation({
      baseRows,
      baseGlobal,
      queue: step1.nextQueue,
      roles,
      branchId: 'lomas',
      operation: {
        action: 'capture',
        orderId: step1.order.id,
        lines: [
          { method: 'efectivo', amountCents: 3500, cashReceivedCents: 3500 },
          { method: 'transferencia', amountCents: 3500, confirmImmediately: false },
        ],
      },
      operationId: 'op-2',
      actorLabel: 'felix_mf@horeb.mx',
    });
    expect(step2.ok).toBe(true);
    if (!step2.ok) return;

    const pendingTransfer = step2.rows[0].state.paymentLines?.find(
      (line) => line.method === 'transferencia' && line.status === 'pendiente',
    );
    expect(pendingTransfer).toBeTruthy();

    const step3 = enqueueOfflineOperation({
      baseRows,
      baseGlobal,
      queue: step2.nextQueue,
      roles,
      branchId: 'lomas',
      operation: {
        action: 'confirm',
        lineId: pendingTransfer!.id,
        reference: 'MANUAL-OFFLINE-01',
      },
      operationId: 'op-3',
      actorLabel: 'felix_mf@horeb.mx',
    });
    expect(step3.ok).toBe(true);
    if (!step3.ok) return;

    // La versión base del servidor NO se altera hasta sincronizar
    expect(baseRows[0].version).toBe(4);
    expect(step3.nextQueue).toHaveLength(3);

    // Reconstrucción exacta tras recarga sin internet
    const replayed = replayOfflineQueue(baseRows, baseGlobal, step3.nextQueue, roles, 'felix_mf@horeb.mx');
    expect(replayed.combinedState.orders).toHaveLength(1);
    expect(replayed.combinedState.paymentLines.every((l) => l.status === 'confirmado')).toBe(true);
  });

  it('sincroniza al reconectar remapeando IDs generados por servidor y recupera 409 / colisión de folio', async () => {
    const { rows: clientBaseRows, global: clientBaseGlobal } = makeBaseRows();
    const roles = { lomas: 'supervisor' as const };

    // Estado en el servidor que avanzó a versión 5 y ya ocupó el folio LOM-0001
    let serverRow: BranchRow = {
      ...structuredClone(clientBaseRows[0]),
      version: 5,
    };
    const existingServerOrder = operate(combineBranches([serverRow], clientBaseGlobal), 'lomas', {
      action: 'create',
      input: {
        serviceType: 'autoservicio',
        customerAlias: 'Otro equipo',
        items: [{ itemId: 'combo', quantity: 1 }],
        paymentLines: [{ method: 'efectivo', amountCents: 7000, cashReceivedCents: 7000 }],
      },
    });
    if (!existingServerOrder.ok) throw new Error('Setup error');
    serverRow = { ...serverRow, state: existingServerOrder.state };
    let serverGlobal = clientBaseGlobal;

    const q1 = enqueueOfflineOperation({
      baseRows: clientBaseRows,
      baseGlobal: clientBaseGlobal,
      queue: [],
      roles,
      branchId: 'lomas',
      operation: {
        action: 'create',
        input: {
          serviceType: 'encargo',
          customerAlias: 'Cliente Offline',
          items: [{ itemId: 'combo', quantity: 1 }],
          paymentLines: [{ method: 'transferencia', amountCents: 7000, confirmImmediately: false }],
        },
      },
      operationId: 'sync-op-1',
      actorLabel: 'felix_mf@horeb.mx',
    });
    if (!q1.ok || !q1.order) throw new Error('q1 failed');
    const offlineLine = q1.rows[0].state.paymentLines![0];

    const q2 = enqueueOfflineOperation({
      baseRows: clientBaseRows,
      baseGlobal: clientBaseGlobal,
      queue: q1.nextQueue,
      roles,
      branchId: 'lomas',
      operation: {
        action: 'confirm',
        lineId: offlineLine.id,
        reference: 'REF-BANCO-99',
      },
      operationId: 'sync-op-2',
      actorLabel: 'felix_mf@horeb.mx',
    });
    if (!q2.ok) throw new Error('q2 failed');

    let serverSeq = 0;
    const flushed = await flushOfflineQueue({
      queue: q2.nextQueue,
      baseRows: clientBaseRows,
      baseGlobal: clientBaseGlobal,
      reloadRemote: async () => ({ rows: [serverRow], globalRecords: serverGlobal }),
      invokeRemote: async (_branch, expectedVersion, _opId, op: Operation) => {
        if (expectedVersion !== serverRow.version) {
          return { status: 'conflict', row: serverRow, error: 'Versión desactualizada.' };
        }
        const combined = combineBranches([serverRow], serverGlobal);
        const res = operate(combined, 'lomas', op, { role: 'supervisor', actorLabel: 'felix_mf@horeb.mx' });
        if (!res.ok) {
          return { status: 'rejected', error: res.error };
        }
        serverSeq += 1;
        // Simular que el servidor genera IDs distintos al cliente offline
        let mappedOrder = res.order;
        const nextState = structuredClone(res.state);
        if (op.action === 'create' && mappedOrder) {
          const oldId = mappedOrder.id;
          const srvId = `srv-ord-${serverSeq}`;
          nextState.orders = nextState.orders.map((o) => (o.id === oldId ? { ...o, id: srvId } : o));
          nextState.paymentLines = nextState.paymentLines.map((l) =>
            l.orderId === oldId ? { ...l, orderId: srvId, id: `srv-pay-${serverSeq}` } : l,
          );
          if (nextState.tickets[oldId]) {
            nextState.tickets[srvId] = { ...nextState.tickets[oldId], orderId: srvId };
            delete nextState.tickets[oldId];
          }
          mappedOrder = nextState.orders.find((o) => o.id === srvId);
        }
        serverRow = { ...serverRow, version: serverRow.version + 1, state: nextState };
        return { status: 'ok', row: serverRow, order: mappedOrder, global: serverGlobal };
      },
    });

    expect(flushed.stoppedOffline).toBe(false);
    expect(flushed.syncedCount).toBe(2);
    expect(flushed.queue).toHaveLength(0);
    expect(flushed.rejected).toHaveLength(0);
    expect(serverRow.state.orders).toHaveLength(2);
    expect(serverRow.state.orders?.some((o) => o.folio === 'LOM-0002' && o.customerAlias === 'Cliente Offline')).toBe(true);
    expect(serverRow.state.paymentLines?.every((l) => l.status === 'confirmado')).toBe(true);
  });

  it('detiene sincronización limpiamente si vuelve a caer la red a mitad de la cola', async () => {
    const { rows, global } = makeBaseRows();
    const roles = { lomas: 'operator' as const };
    const q1 = enqueueOfflineOperation({
      baseRows: rows,
      baseGlobal: global,
      queue: [],
      roles,
      branchId: 'lomas',
      operation: {
        action: 'create',
        input: {
          serviceType: 'autoservicio',
          customerAlias: 'Uno',
          items: [{ itemId: 'combo', quantity: 1 }],
          paymentLines: [{ method: 'efectivo', amountCents: 7000, cashReceivedCents: 7000 }],
        },
      },
      operationId: 'net-1',
      actorLabel: 'caja@horeb.mx',
    });
    if (!q1.ok) throw new Error('q1 failed');
    const q2 = enqueueOfflineOperation({
      baseRows: rows,
      baseGlobal: global,
      queue: q1.nextQueue,
      roles,
      branchId: 'lomas',
      operation: {
        action: 'create',
        input: {
          serviceType: 'autoservicio',
          customerAlias: 'Dos',
          items: [{ itemId: 'combo', quantity: 1 }],
          paymentLines: [{ method: 'efectivo', amountCents: 7000, cashReceivedCents: 7000 }],
        },
      },
      operationId: 'net-2',
      actorLabel: 'caja@horeb.mx',
    });
    if (!q2.ok) throw new Error('q2 failed');

    let calls = 0;
    let srvRow = structuredClone(rows[0]);
    const res = await flushOfflineQueue({
      queue: q2.nextQueue,
      baseRows: rows,
      baseGlobal: global,
      reloadRemote: async () => null,
      invokeRemote: async (_b, _v, _id, op) => {
        calls += 1;
        if (calls === 2) {
          return { status: 'network_error', error: 'Sin internet' };
        }
        const opRes = operate(combineBranches([srvRow], global), 'lomas', op);
        if (!opRes.ok) return { status: 'rejected', error: opRes.error };
        srvRow = { ...srvRow, version: srvRow.version + 1, state: opRes.state };
        return { status: 'ok', row: srvRow, order: opRes.order, global };
      },
    });

    expect(res.stoppedOffline).toBe(true);
    expect(res.syncedCount).toBe(1);
    expect(res.queue).toHaveLength(1);
    expect(res.queue[0].id).toBe('net-2');
  });

  it('persiste snapshot y cola por usuario en almacenamiento local', () => {
    const storage = createMemoryStorage();
    const { rows, global } = makeBaseRows();

    writeOfflineSnapshot(
      {
        userId: 'user-1',
        cachedAt: '2026-11-18T17:00:00Z',
        memberships: [{ branch_id: 'lomas', role: 'supervisor' }],
        rows,
        globalRecords: global,
      },
      storage,
    );

    const queue: QueuedOperation[] = [
      {
        id: 'op-local-1',
        branchId: 'lomas',
        operation: { action: 'reprint', orderId: 'ord-1' },
        queuedAt: '2026-11-18T17:01:00Z',
        actorLabel: 'felix_mf@horeb.mx',
      },
    ];
    writeOfflineQueue('user-1', queue, storage);

    expect(readOfflineSnapshot('user-1', storage)?.rows[0].branch_id).toBe('lomas');
    expect(readOfflineSnapshot('other-user', storage)).toBeNull();
    expect(readOfflineQueue('user-1', storage)).toHaveLength(1);

    writeOfflineQueue('user-1', [], storage);
    expect(readOfflineQueue('user-1', storage)).toHaveLength(0);
  });
});
