import { operate, requiresSupervisor, type Operation } from './operations.ts';
import {
  combineBranches,
  type BranchRole,
  type BranchRow,
  type GlobalRecordsBundle,
} from './sharedState.ts';
import type { BranchId, Customer, DemoState, Order, PaymentMethod } from './types.ts';

export interface OfflineMembership {
  branch_id: BranchId;
  role: BranchRole;
}

export interface OfflineSnapshot {
  userId: string;
  cachedAt: string;
  memberships: OfflineMembership[];
  rows: BranchRow[];
  globalRecords: GlobalRecordsBundle;
}

export interface LocalLineRef {
  localLineId: string;
  method: PaymentMethod;
  occurrence: number;
}

export interface QueuedOperation {
  id: string;
  branchId: BranchId;
  operation: Operation;
  queuedAt: string;
  actorLabel: string;
  autoAssignedFolio?: string;
  localOrderId?: string;
  localCustomerId?: string;
  localLineRefs?: LocalLineRef[];
}

export interface OfflineRejectedItem {
  item: QueuedOperation;
  error: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type RemoteInvokeOutcome =
  | {
      status: 'ok';
      row: BranchRow;
      order?: Order;
      customer?: Customer;
      global?: GlobalRecordsBundle;
    }
  | {
      status: 'conflict';
      row?: BranchRow;
      error: string;
    }
  | {
      status: 'rejected';
      error: string;
    }
  | {
      status: 'network_error';
      error: string;
    };

const SNAPSHOT_PREFIX = 'horeb360.offline.snapshot.v1.';
const QUEUE_PREFIX = 'horeb360.offline.queue.v1.';

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

export function readOfflineSnapshot(userId: string, storage?: StorageLike): OfflineSnapshot | null {
  const store = resolveStorage(storage);
  if (!store || !userId) return null;
  try {
    const raw = store.getItem(SNAPSHOT_PREFIX + userId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OfflineSnapshot>;
    if (!Array.isArray(parsed.rows) || !Array.isArray(parsed.memberships)) return null;
    return {
      userId,
      cachedAt: typeof parsed.cachedAt === 'string' ? parsed.cachedAt : '',
      memberships: parsed.memberships,
      rows: parsed.rows,
      globalRecords: parsed.globalRecords ?? {},
    };
  } catch {
    return null;
  }
}

export function writeOfflineSnapshot(snapshot: OfflineSnapshot, storage?: StorageLike): void {
  const store = resolveStorage(storage);
  if (!store || !snapshot.userId) return;
  try {
    store.setItem(SNAPSHOT_PREFIX + snapshot.userId, JSON.stringify(snapshot));
  } catch {
    // Silenciar errores de cuota para no interrumpir la operación en caja.
  }
}

export function readOfflineQueue(userId: string, storage?: StorageLike): QueuedOperation[] {
  const store = resolveStorage(storage);
  if (!store || !userId) return [];
  try {
    const raw = store.getItem(QUEUE_PREFIX + userId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedOperation[]) : [];
  } catch {
    return [];
  }
}

export function writeOfflineQueue(userId: string, queue: QueuedOperation[], storage?: StorageLike): void {
  const store = resolveStorage(storage);
  if (!store || !userId) return;
  try {
    if (queue.length === 0) {
      store.removeItem(QUEUE_PREFIX + userId);
    } else {
      store.setItem(QUEUE_PREFIX + userId, JSON.stringify(queue));
    }
  } catch {
    // Silenciar si el almacenamiento restringe escritura.
  }
}

function splitBranchAndGlobal(
  nextCombined: DemoState,
  targetRow: BranchRow,
): { row: BranchRow; globalRecords: GlobalRecordsBundle } {
  const {
    customers = [],
    loyaltyEvents = [],
    raffleTickets = [],
    raffleDraws = [],
    nightClosings = [],
    ...branchOnlyState
  } = nextCombined;

  return {
    row: {
      ...targetRow,
      state: branchOnlyState,
    },
    globalRecords: {
      customers,
      loyaltyEvents,
      raffleTickets,
      raffleDraws,
      nightClosings,
    },
  };
}

function countLineRefs(lines: DemoState['paymentLines']): LocalLineRef[] {
  const counts = new Map<PaymentMethod, number>();
  return lines.map((line) => {
    const occurrence = counts.get(line.method) ?? 0;
    counts.set(line.method, occurrence + 1);
    return {
      localLineId: line.id,
      method: line.method,
      occurrence,
    };
  });
}

export function applyBranchOperationLocally(
  baseRows: BranchRow[],
  baseGlobal: GlobalRecordsBundle,
  branchId: BranchId,
  operation: Operation,
  roles: Partial<Record<BranchId, BranchRole>>,
  actorLabel: string,
):
  | {
      ok: true;
      rows: BranchRow[];
      globalRecords: GlobalRecordsBundle;
      combinedState: DemoState;
      order?: Order;
      customer?: Customer;
      addedLineRefs: LocalLineRef[];
    }
  | { ok: false; error: string } {
  const targetRow = baseRows.find((row) => row.branch_id === branchId);
  if (!targetRow) {
    return { ok: false, error: 'Esta sucursal no está disponible en caché local.' };
  }
  const role = roles[branchId];
  if (!role || (requiresSupervisor(operation.action) && role !== 'supervisor')) {
    return { ok: false, error: 'Tu cuenta no puede realizar esta operación en la sucursal.' };
  }

  const branchCombined = combineBranches([targetRow], baseGlobal);
  const priorLineIds = new Set(branchCombined.paymentLines.map((line) => line.id));
  const result = operate(branchCombined, branchId, operation, { role, actorLabel });
  if (!result.ok) {
    return result;
  }

  const split = splitBranchAndGlobal(result.state, targetRow);
  const nextRows = baseRows.map((row) => (row.branch_id === branchId ? split.row : row));
  const targetOrderId =
    result.order?.id ?? (operation.action === 'capture' ? operation.orderId : undefined);
  const addedLines = targetOrderId
    ? result.state.paymentLines.filter(
        (line) => line.orderId === targetOrderId && !priorLineIds.has(line.id),
      )
    : [];

  return {
    ok: true,
    rows: nextRows,
    globalRecords: split.globalRecords,
    combinedState: combineBranches(nextRows, split.globalRecords),
    order: result.order,
    customer: result.customer,
    addedLineRefs: countLineRefs(addedLines),
  };
}

function replaceReplayedIds(
  rows: BranchRow[],
  globalRecords: GlobalRecordsBundle,
  branchId: BranchId,
  replacements: ReadonlyMap<string, string>,
): { rows: BranchRow[]; globalRecords: GlobalRecordsBundle } {
  if (replacements.size === 0) {
    return { rows, globalRecords };
  }
  const mapId = (id: string) => replacements.get(id) ?? id;
  const mapOpt = (id?: string | null) => (id ? replacements.get(id) ?? id : id);

  const nextRows = rows.map((row) => {
    if (row.branch_id !== branchId) return row;
    const saved = row.state;
    const nextTickets: NonNullable<DemoState['tickets']> = {};
    for (const [key, ticket] of Object.entries(saved.tickets ?? {})) {
      const mappedKey = mapId(key);
      nextTickets[mappedKey] = {
        ...ticket,
        orderId: mapId(ticket.orderId),
      };
    }

    return {
      ...row,
      state: {
        ...saved,
        orders: (saved.orders ?? []).map((order) => ({
          ...order,
          id: mapId(order.id),
          customerId: mapOpt(order.customerId) ?? undefined,
        })),
        paymentLines: (saved.paymentLines ?? []).map((line) => ({
          ...line,
          id: mapId(line.id),
          orderId: mapId(line.orderId),
        })),
        tickets: nextTickets,
        machines: (saved.machines ?? []).map((machine) => ({
          ...machine,
          currentOrderId: machine.currentOrderId ? mapId(machine.currentOrderId) : null,
        })),
      },
    };
  });

  const nextGlobal: GlobalRecordsBundle = {
    ...globalRecords,
    customers: (globalRecords.customers ?? []).map((customer) => ({
      ...customer,
      id: mapId(customer.id),
    })),
    loyaltyEvents: (globalRecords.loyaltyEvents ?? []).map((event) => ({
      ...event,
      customerId: mapId(event.customerId),
      orderId: mapId(event.orderId),
    })),
    raffleTickets: (globalRecords.raffleTickets ?? []).map((ticket) => ({
      ...ticket,
      customerId: mapId(ticket.customerId),
      orderId: mapId(ticket.orderId),
    })),
    raffleDraws: (globalRecords.raffleDraws ?? []).map((draw) => ({
      ...draw,
      winnerCustomerId: mapId(draw.winnerCustomerId),
    })),
  };

  return { rows: nextRows, globalRecords: nextGlobal };
}

export function replayOfflineQueue(
  baseRows: BranchRow[],
  baseGlobal: GlobalRecordsBundle,
  queue: QueuedOperation[],
  roles: Partial<Record<BranchId, BranchRole>>,
  defaultActorLabel = 'Caja',
): {
  rows: BranchRow[];
  globalRecords: GlobalRecordsBundle;
  combinedState: DemoState;
} {
  let rows = baseRows;
  let globalRecords = baseGlobal;

  for (const item of queue) {
    const applied = applyBranchOperationLocally(
      rows,
      globalRecords,
      item.branchId,
      item.operation,
      roles,
      item.actorLabel || defaultActorLabel,
    );
    if (applied.ok) {
      const idFixes = new Map<string, string>();
      if (item.localOrderId && applied.order?.id && item.localOrderId !== applied.order.id) {
        idFixes.set(applied.order.id, item.localOrderId);
      }
      if (item.localCustomerId && applied.customer?.id && item.localCustomerId !== applied.customer.id) {
        idFixes.set(applied.customer.id, item.localCustomerId);
      }
      if (item.localLineRefs?.length) {
        for (const freshRef of applied.addedLineRefs) {
          const original = item.localLineRefs.find(
            (ref) => ref.method === freshRef.method && ref.occurrence === freshRef.occurrence,
          );
          if (original && original.localLineId !== freshRef.localLineId) {
            idFixes.set(freshRef.localLineId, original.localLineId);
          }
        }
      }
      const stabilized = replaceReplayedIds(
        applied.rows,
        applied.globalRecords,
        item.branchId,
        idFixes,
      );
      rows = stabilized.rows;
      globalRecords = stabilized.globalRecords;
    }
  }

  return {
    rows,
    globalRecords,
    combinedState: combineBranches(rows, globalRecords),
  };
}

export function enqueueOfflineOperation(params: {
  baseRows: BranchRow[];
  baseGlobal: GlobalRecordsBundle;
  queue: QueuedOperation[];
  roles: Partial<Record<BranchId, BranchRole>>;
  branchId: BranchId;
  operation: Operation;
  operationId: string;
  actorLabel: string;
  now?: string;
}):
  | {
      ok: true;
      nextQueue: QueuedOperation[];
      rows: BranchRow[];
      globalRecords: GlobalRecordsBundle;
      order?: Order;
      customer?: Customer;
    }
  | { ok: false; error: string } {
  const replayed = replayOfflineQueue(
    params.baseRows,
    params.baseGlobal,
    params.queue,
    params.roles,
    params.actorLabel,
  );

  const applied = applyBranchOperationLocally(
    replayed.rows,
    replayed.globalRecords,
    params.branchId,
    params.operation,
    params.roles,
    params.actorLabel,
  );
  if (!applied.ok) {
    return applied;
  }

  const queuedItem: QueuedOperation = {
    id: params.operationId,
    branchId: params.branchId,
    operation: params.operation,
    queuedAt: params.now ?? new Date().toISOString(),
    actorLabel: params.actorLabel,
    autoAssignedFolio:
      params.operation.action === 'create' && !params.operation.input.folio
        ? applied.order?.folio
        : undefined,
    localOrderId: params.operation.action === 'create' ? applied.order?.id : undefined,
    localCustomerId:
      params.operation.action === 'upsertCustomer' ? applied.customer?.id : undefined,
    localLineRefs: applied.addedLineRefs.length > 0 ? applied.addedLineRefs : undefined,
  };

  return {
    ok: true,
    nextQueue: [...params.queue, queuedItem],
    rows: applied.rows,
    globalRecords: applied.globalRecords,
    order: applied.order,
    customer: applied.customer,
  };
}

export function remapOperationIds(operation: Operation, idMap: ReadonlyMap<string, string>): Operation {
  const mapId = (id: string) => idMap.get(id) ?? id;

  switch (operation.action) {
    case 'create':
      return operation.input.customerId
        ? {
            ...operation,
            input: {
              ...operation.input,
              customerId: mapId(operation.input.customerId),
            },
          }
        : operation;
    case 'capture':
    case 'advance':
    case 'deliver':
    case 'emit':
    case 'reprint':
    case 'assignMachines':
    case 'recordWhatsappSent':
      return {
        ...operation,
        orderId: mapId(operation.orderId),
      };
    case 'confirm':
      return {
        ...operation,
        lineId: mapId(operation.lineId),
      };
    case 'upsertCustomer':
      return operation.customer.id
        ? {
            ...operation,
            customer: {
              ...operation.customer,
              id: mapId(operation.customer.id),
            },
          }
        : operation;
    case 'confirmTransferBatch':
      return {
        ...operation,
        items: operation.items.map((item) => ({
          ...item,
          lineId: mapId(item.lineId),
        })),
      };
    default:
      return operation;
  }
}

function recordServerMappings(
  queuedItem: QueuedOperation,
  remappedOp: Operation,
  priorRow: BranchRow | undefined,
  nextRow: BranchRow,
  serverOrder: Order | undefined,
  serverCustomer: Customer | undefined,
  idMap: Map<string, string>,
) {
  let targetServerOrderId: string | undefined;

  if (queuedItem.localOrderId) {
    const priorOrderIds = new Set((priorRow?.state.orders ?? []).map((o) => o.id));
    const resolvedOrder =
      serverOrder ??
      (queuedItem.autoAssignedFolio
        ? nextRow.state.orders?.find((o) => o.folio === queuedItem.autoAssignedFolio)
        : undefined) ??
      nextRow.state.orders?.find((o) => !priorOrderIds.has(o.id));
    if (resolvedOrder) {
      idMap.set(queuedItem.localOrderId, resolvedOrder.id);
      targetServerOrderId = resolvedOrder.id;
    }
  } else if (remappedOp.action === 'capture') {
    targetServerOrderId = remappedOp.orderId;
  }

  if (queuedItem.localCustomerId && serverCustomer?.id) {
    idMap.set(queuedItem.localCustomerId, serverCustomer.id);
  }

  if (queuedItem.localLineRefs?.length && targetServerOrderId) {
    const priorLineIds = new Set((priorRow?.state.paymentLines ?? []).map((line) => line.id));
    const addedLines = (nextRow.state.paymentLines ?? []).filter(
      (line) => line.orderId === targetServerOrderId && !priorLineIds.has(line.id),
    );
    const byMethod = new Map<PaymentMethod, typeof addedLines>();
    for (const line of addedLines) {
      const bucket = byMethod.get(line.method) ?? [];
      bucket.push(line);
      byMethod.set(line.method, bucket);
    }
    for (const ref of queuedItem.localLineRefs) {
      const matched = byMethod.get(ref.method)?.[ref.occurrence];
      if (matched) {
        idMap.set(ref.localLineId, matched.id);
      }
    }
  }
}

export async function flushOfflineQueue(params: {
  queue: QueuedOperation[];
  baseRows: BranchRow[];
  baseGlobal: GlobalRecordsBundle;
  invokeRemote: (
    branch: BranchId,
    version: number,
    operationId: string,
    operation: Operation,
  ) => Promise<RemoteInvokeOutcome>;
  reloadRemote: () => Promise<{ rows: BranchRow[]; globalRecords: GlobalRecordsBundle } | null>;
}): Promise<{
  queue: QueuedOperation[];
  rows: BranchRow[];
  globalRecords: GlobalRecordsBundle;
  syncedCount: number;
  stoppedOffline: boolean;
  rejected: OfflineRejectedItem[];
}> {
  let rows = [...params.baseRows];
  let globalRecords = params.baseGlobal;
  let syncedCount = 0;
  const rejected: OfflineRejectedItem[] = [];
  const idMap = new Map<string, string>();

  for (let idx = 0; idx < params.queue.length; idx += 1) {
    const item = params.queue[idx];
    let currentRow = rows.find((row) => row.branch_id === item.branchId);
    if (!currentRow) {
      rejected.push({ item, error: 'Sucursal no disponible al sincronizar.' });
      continue;
    }

    let opToSend = remapOperationIds(item.operation, idMap);
    if (opToSend.action === 'create' && !opToSend.input.folio && item.autoAssignedFolio) {
      opToSend = {
        ...opToSend,
        input: { ...opToSend.input, folio: item.autoAssignedFolio },
      };
    }

    let attemptOutcome = await params.invokeRemote(
      item.branchId,
      currentRow.version,
      item.id,
      opToSend,
    );

    if (attemptOutcome.status === 'conflict') {
      const conflictRow = attemptOutcome.row;
      if (conflictRow) {
        rows = rows.map((row) => (row.branch_id === conflictRow.branch_id ? conflictRow : row));
      } else {
        const refreshed = await params.reloadRemote();
        if (refreshed) {
          rows = refreshed.rows;
          globalRecords = refreshed.globalRecords;
        }
      }
      currentRow = rows.find((row) => row.branch_id === item.branchId);
      if (currentRow) {
        attemptOutcome = await params.invokeRemote(
          item.branchId,
          currentRow.version,
          item.id,
          opToSend,
        );
      }
    }

    if (
      attemptOutcome.status === 'rejected' &&
      opToSend.action === 'create' &&
      item.autoAssignedFolio &&
      attemptOutcome.error.toLowerCase().includes('folio')
    ) {
      const fallbackOp: Operation = {
        ...opToSend,
        input: { ...opToSend.input, folio: undefined },
      };
      currentRow = rows.find((row) => row.branch_id === item.branchId);
      if (currentRow) {
        opToSend = fallbackOp;
        attemptOutcome = await params.invokeRemote(
          item.branchId,
          currentRow.version,
          item.id,
          opToSend,
        );
      }
    }

    if (attemptOutcome.status === 'network_error') {
      const remaining = params.queue.slice(idx).map((pendingItem) => ({
        ...pendingItem,
        operation: remapOperationIds(pendingItem.operation, idMap),
      }));
      return {
        queue: remaining,
        rows,
        globalRecords,
        syncedCount,
        stoppedOffline: true,
        rejected,
      };
    }

    if (attemptOutcome.status !== 'ok') {
      rejected.push({ item, error: attemptOutcome.error });
      continue;
    }

    recordServerMappings(
      item,
      opToSend,
      currentRow,
      attemptOutcome.row,
      attemptOutcome.order,
      attemptOutcome.customer,
      idMap,
    );

    rows = rows.map((row) =>
      row.branch_id === attemptOutcome.row.branch_id ? attemptOutcome.row : row,
    );
    if (attemptOutcome.global) {
      globalRecords = attemptOutcome.global;
    }
    syncedCount += 1;
  }

  return {
    queue: [],
    rows,
    globalRecords,
    syncedCount,
    stoppedOffline: false,
    rejected,
  };
}
